// Browser E2E harness: starts its OWN `muten dev` server, opens Chromium and points
// the app at STAGING through window.__DD_CFG (honoured by src/lib/authActions.ts only
// on localhost / 127.0.0.1). Import-safe: nothing starts until startApp() is called.
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
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

// Production build served statically (dist/ from `muten bundle`), with the SPA fallback hosting gives.
// The dev server injects inline scripts of its own (error overlay), which no CSP can allow, so the
// CSP spec runs against the bundle: that is what ships.
function startBundle() {
  const build = spawnSync(process.execPath, [MUTEN, 'bundle', ROOT], { cwd: ROOT, encoding: 'utf8' })
  if (build.status !== 0) throw new Error(`muten bundle failed:
${build.stdout}
${build.stderr}`)
  const dist = join(ROOT, 'dist')
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' }
  const http = createServer((req, res) => {
    const file = normalize(join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname)))
    const hit = file.startsWith(dist) && existsSync(file) && statSync(file).isFile() ? file : join(dist, 'index.html')
    res.writeHead(200, { 'content-type': types[extname(hit)] || 'application/octet-stream' })
    res.end(readFileSync(hit))
  })
  const url = new Promise((resolve) => http.listen(0, '127.0.0.1', () => resolve(`http://localhost:${http.address().port}`)))
  return { child: { kill: () => http.close() }, url, http }
}

export async function startApp({ bundle = false } = {}) {
  const cfg = loadConfig() // refuses production values
  const server = bundle ? startBundle() : startServer()
  const url = await server.url
  const browser = await chromium.launch()
  return {
    url,
    // One context per page: sessions in localStorage must not leak between tests.
    // The page CSP (meta in index.html) is bypassed except for the CSP spec ({ csp: true }), which
    // runs under the real policy; there the production Supabase and photo Worker origins in the meta are
    // swapped for the staging ones (the only edit), because the app talks to staging through __DD_CFG.
    async newPage({ csp = false } = {}) {
      const context = await browser.newContext({ bypassCSP: !csp })
      await context.addInitScript(({ url, key, fotos }) => { window.__DD_CFG = { url, key, fotos } }, { url: cfg.url, key: cfg.publishableKey, fotos: cfg.fotosUrl })
      if (csp) {
        const stagingHost = new URL(cfg.url).host
        await context.route(/^https?:\/\/(localhost|127\.0\.0\.1)[:/][^?]*$/, async (route) => {
          if (route.request().resourceType() !== 'document') return route.continue()
          const res = await route.fetch()
          const body = (await res.text()).replaceAll('agutaluxzruuthbbagkh.supabase.co', stagingHost).replaceAll('devdogs-fotos.devdogsco.workers.dev', cfg.fotosUrl ? new URL(cfg.fotosUrl).host : 'devdogs-fotos.devdogsco.workers.dev')
          return route.fulfill({ response: res, body })
        })
      }
      return context.newPage()
    },
    async stop() {
      await browser.close()
      // taskkill /T because the dev server is a child of node on Windows too.
      if (bundle) server.http.close()
      else if (process.platform === 'win32') spawn('taskkill', ['/PID', String(server.child.pid), '/T', '/F'], { stdio: 'ignore' })
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
