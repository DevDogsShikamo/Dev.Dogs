// S6 static checks: CC-1b persisted state, CC-5a CSP, CC-6 email check, CC-7a advisory, SR-3a secrets.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { injectCsp } from '../../scripts/csp-inject.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const text = (p) => readFileSync(join(ROOT, p), 'utf8')
const stores = readdirSync(join(ROOT, 'src')).filter((f) => f.endsWith('.store'))

// What each store may keep on the device (design section 7). Anything not listed persists nothing.
const ALLOWED = {
  'auth.store': ['loggedIn', 'userId', 'userName', 'rol', 'negocioId', 'isOwner', 'politicaPendiente', 'sinPerfil', 'aceptacionPendiente', 'negocioNombre'], // routing guards + the business name the client portal shows
  'grupos.store': ['grupos', 'fecha', 'perrosHoy', 'perrosPaseo'], // the walker day agenda
  'calendario.store': ['anchor', 'view', 'sel', 'ocultos'], // UI preferences
  'i18n.store': ['lang'],
}
const FORBIDDEN = /telefono|phone|salari|precio|price|cobr|factur|codigo|\bcode\b|token|email|nota\b|notas|tip\b|propina|invit|slug|foto/i

const persisted = (src) =>
  [...src.matchAll(/^\s*(\w+)\s*=.*:\s*(\S.*?)\s+persist\b/gm)].map(([, name, type]) => ({ name, type }))

test('CC-1b: each store persists only what the design allows (empresa/cliente/catalogo/servicios: nothing)', () => {
  assert.ok(stores.includes('empresa.store') && stores.includes('grupos.store'), 'scan sanity')
  for (const f of stores) {
    const got = persisted(text(`src/${f}`)).map((p) => p.name).sort()
    assert.deepEqual(got, [...(ALLOWED[f] || [])].sort(), `${f} persisted state`)
  }
})

test('CC-1b: no persisted entity carries a phone, price, note, salary, code or email field', () => {
  for (const f of stores) {
    const src = text(`src/${f}`)
    for (const { name, type } of persisted(src)) {
      const entity = type.match(/list<(\w+)>/)?.[1]
      const body = entity && src.match(new RegExp(String.raw`entity\s+${entity}\s*\{([^}]*)\}`))?.[1]
      const fields = (body || name).split(/[\s,]+/).join(' ')
      assert.ok(!FORBIDDEN.test(entity ? fields : name), `${f}: persisted "${name}" (${entity || type}) has a sensitive field`)
    }
  }
})

// The CSP is added by the production build (scripts/csp-inject.mjs): the policy is read from the built shape.
const html = injectCsp(text('index.html'))
const csp = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1]
const directives = Object.fromEntries((csp || '').split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([k, ...v]) => [k, v]))

test('CC-5a: the built index.html carries a CSP meta with the required directives', () => {
  assert.ok(csp, 'CSP meta present')
  assert.deepEqual(directives['script-src'], ["'self'"], 'scripts: self only, no inline')
  assert.deepEqual(directives['default-src'], ["'self'"])
  assert.deepEqual(directives['object-src'], ["'none'"])
  assert.deepEqual(directives['base-uri'], ["'self'"])
  assert.deepEqual(directives['form-action'], ["'self'"])
  assert.deepEqual(directives['worker-src'], ["'self'"])
  assert.deepEqual(directives['manifest-src'], ["'self'"])
  const prod = 'agutaluxzruuthbbagkh.supabase.co'
  const worker = 'https://devdogs-fotos.devdogsco.workers.dev' // production photo Worker (S5b)
  assert.deepEqual(directives['connect-src'], ["'self'", `https://${prod}`, `wss://${prod}`, worker])
  assert.ok(directives['img-src'].includes('https:') && directives['img-src'].includes("'self'"), 'img-src keeps https: (perros.foto_url is free text)')
  assert.ok(directives['img-src'].includes('blob:') && directives['img-src'].includes(worker), 'gallery images are blob: URLs fetched from the Worker')
  assert.ok(!directives['connect-src'].some((o) => /staging/.test(o)), 'the staging Worker is injected by the test server, never shipped')
  assert.ok(!/unsafe-eval|\*(?!\.)/.test(directives['script-src'].join(' ')))
})

test('CC-5a: index.html has no inline script (they live in /boot.js) and no third-party script', () => {
  const tags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
  assert.ok(tags.length >= 2, 'scan sanity')
  for (const [, attrs, body] of tags) {
    assert.match(attrs, /\bsrc="(\/[^"]*)"/, `script without a same-origin src: ${body.trim().slice(0, 40)}`)
    assert.equal(body.trim(), '', 'script tag has inline code')
  }
  assert.ok(tags.some(([, a]) => a.includes('/boot.js')))
  assert.ok(existsSync(join(ROOT, 'public/boot.js')))
  assert.ok(!/<[^>]+\son\w+=/i.test(html), 'no inline event handler attribute')
})

test('CC-6b: the email check posts the domain only (component run against a fetch stub)', async () => {
  const src = text('src/components/EmailCheck.js')
  const calls = []
  const fetch = (url, init) => { calls.push({ url, body: init.body }); return Promise.resolve({ json: () => Promise.resolve({ valid: true }) }) }
  const mount = new Function('fetch', 'globalThis', src + '; return mount')(fetch, { __ddCfg: { url: 'https://x.supabase.co', key: 'k' } })
  const seen = []
  const update = mount({ style: {} }, { nonce: 0 }, { good: () => seen.push('good'), bad: () => seen.push('bad') })
  update({ nonce: 1, email: 'Persona@Gmail.com' })
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://x.supabase.co/functions/v1/check-email')
  assert.deepEqual(JSON.parse(calls[0].body), { domain: 'gmail.com' })
  assert.ok(!/persona|@/i.test(calls[0].body), 'no part of the address leaves the page')
  assert.deepEqual(seen, ['good'])
})

test('CC-7a: npm audit (production deps) reports nothing on xlsx', () => {
  const r = spawnSync('npm', ['audit', '--omit=dev', '--json'], { cwd: ROOT, shell: true, encoding: 'utf8', timeout: 90_000 })
  const report = JSON.parse(r.stdout || '{}')
  assert.ok(report.metadata || report.vulnerabilities, `npm audit gave no report: ${(r.stderr || '').slice(0, 200)}`)
  assert.equal(report.vulnerabilities?.xlsx, undefined, 'xlsx is still flagged')
  const viaXlsx = Object.values(report.vulnerabilities || {}).filter((v) => (v.via || []).some((x) => /xlsx/i.test(typeof x === 'string' ? x : x.name || '')))
  assert.deepEqual(viaXlsx.map((v) => v.name), [], 'nothing is flagged through xlsx')
})

test('SR-3a: sources, public assets and the build output hold no service key, R2 or signing secret', () => {
  // Source maps are skipped: they embed third-party sources (supabase-js docs mention service_role).
  const PATTERN = /service_role|sb_secret_|SERVICE_ROLE|R2_ACCESS|R2_SECRET|r2\.cloudflarestorage|X-Amz-Signature|SIGNING_SECRET|WORKER_SECRET/
  const files = []
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(js|ts|muten|store|html|css|json|webmanifest)$/.test(e)) files.push(p)
    }
  }
  for (const d of ['src', 'public', 'dist']) if (existsSync(join(ROOT, d))) walk(join(ROOT, d))
  files.push(join(ROOT, 'index.html'))
  assert.ok(files.length > 30, 'scan sanity')
  for (const f of files) assert.ok(!PATTERN.test(readFileSync(f, 'utf8')), `${f} matches a secret pattern`)
})
