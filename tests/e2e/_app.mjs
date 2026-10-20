// Browser E2E harness: starts its OWN `muten dev` server, opens Chromium and points
// the app at STAGING through window.__DD_CFG (honoured by src/lib/authActions.ts only
// on localhost / 127.0.0.1). Import-safe: nothing starts until startApp() is called.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { loadConfig } from '../security/_env.mjs'
import { admin } from '../security/_actors.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const MUTEN = fileURLToPath(new URL('../../node_modules/@muten/core/dist/bin/muten.js', import.meta.url))

// muten dev takes 5173 when free and otherwise a free port, and prints the URL.
function startServer() {
  const child = spawn(process.execPath, [MUTEN, 'dev', ROOT], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
  const url = new Promise((resolve, reject) => {
    let out = ''
    const timer = setTimeout(() => reject(new Error(`muten dev did not report a URL:\n${out}`)), 90_000)
    child.stdout.on('data', (chunk) => {
      out += chunk
      const m = out.match(/http:\/\/localhost:(\d+)\//)
      if (m) {
        clearTimeout(timer)
        resolve(`http://localhost:${m[1]}`)
      }
    })
    child.on('exit', (code) => reject(new Error(`muten dev exited with ${code}:\n${out}`)))
  })
  return { child, url }
}

export async function startApp() {
  const cfg = loadConfig() // refuses production values
  const server = startServer()
  const url = await server.url
  const browser = await chromium.launch()
  return {
    url,
    // One context per page: sessions in localStorage must not leak between tests.
    async newPage() {
      const context = await browser.newContext()
      await context.addInitScript(({ url, key }) => { window.__DD_CFG = { url, key } }, { url: cfg.url, key: cfg.publishableKey })
      return context.newPage()
    },
    async stop() {
      await browser.close()
      // taskkill /T because the dev server is a child of node on Windows too.
      if (process.platform === 'win32') spawn('taskkill', ['/PID', String(server.child.pid), '/T', '/F'], { stdio: 'ignore' })
      else server.child.kill()
    },
  }
}

// Production has email confirmation OFF, so auth.signUp returns a session at once.
// Staging has it ON and a tiny built-in SMTP quota ("email rate limit exceeded"), so
// this stands in for that one Auth call: the user is created confirmed through the
// service role and the page gets the session a password grant returns, in the shape
// signUp expects. Everything after it (provisioning, routing) is the real app.
export async function autoconfirmSignup(page) {
  const cfg = loadConfig()
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' }
  await page.route('**/auth/v1/signup*', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const { email, password, data } = route.request().postDataJSON()
    const created = await admin().auth.admin.createUser({ email, password, email_confirm: true, user_metadata: data })
    if (created.error) return route.fulfill({ status: 422, headers: cors, json: { msg: created.error.message } })
    const res = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: cfg.publishableKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    return route.fulfill({ status: res.status, headers: cors, json: await res.json() })
  })
}
