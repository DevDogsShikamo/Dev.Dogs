// CC-6a: the check-email function takes a domain only and answers only the app's origins.
// Runs the handler directly with an injected resolver (no network, no deployment needed);
// the same file is what the Edge Function serves. Live check after deployment: S6.13.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handle } from '../../supabase/functions/check-email/handler.js'

const APP = 'https://app.devdogs.example'
const deps = (mx = ['mx.example.com']) => ({ resolveMx: async () => mx, origins: [APP] })
const post = (body, origin = APP, extra = {}) =>
  new Request('https://f.example/check-email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}), ...extra },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
const json = async (res) => res.json()

test('a domain from an allowed origin is resolved and answered with that origin only', async () => {
  const res = await handle(post({ domain: 'gmail.com' }), deps())
  assert.equal(res.status, 200)
  assert.deepEqual(await json(res), { valid: true, reason: 'ok' })
  assert.equal(res.headers.get('access-control-allow-origin'), APP)
  assert.match(res.headers.get('vary') || '', /Origin/i)
})

test('no MX records is a valid answer, not an error', async () => {
  const res = await handle(post({ domain: 'nomx.example' }), deps([]))
  assert.deepEqual(await json(res), { valid: false, reason: 'no_mx' })
})

test('a full email is rejected before any lookup', async () => {
  let looked = 0
  const d = { origins: [APP], resolveMx: async () => { looked++; return ['x'] } }
  for (const body of [{ email: 'a@gmail.com' }, { domain: 'a@gmail.com' }, { domain: 'gmail.com', email: 'a@gmail.com' }, { domain: 'x.com', extra: 1 }]) {
    const res = await handle(post(body), d)
    assert.equal(res.status, 400, JSON.stringify(body))
    assert.deepEqual(await json(res), { valid: false, reason: 'bad_request' })
  }
  assert.equal(looked, 0)
})

test('malformed domains and bodies are rejected', async () => {
  const bad = [{ domain: '' }, { domain: 'nodot' }, { domain: 'a b.com' }, { domain: '-x.com' }, { domain: 'x'.repeat(260) + '.com' }, { domain: 5 }, {}, '{oops', '[]', 'null']
  for (const body of bad) assert.equal((await handle(post(body), deps())).status, 400, String(JSON.stringify(body)).slice(0, 40))
})

test('a foreign or missing Origin gets 403 and no allow-origin header', async () => {
  for (const origin of ['https://evil.example', 'https://app.devdogs.example.evil.com', 'null', null]) {
    const res = await handle(post({ domain: 'gmail.com' }, origin), deps())
    assert.equal(res.status, 403, String(origin))
    assert.equal(res.headers.get('access-control-allow-origin'), null, String(origin))
  }
})

test('preflight: allowed origin gets the headers, a foreign one gets nothing', async () => {
  const pre = (origin) => new Request('https://f.example/check-email', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST' } })
  const ok = await handle(pre(APP), deps())
  assert.equal(ok.status, 204)
  assert.equal(ok.headers.get('access-control-allow-origin'), APP)
  assert.match(ok.headers.get('access-control-allow-headers'), /apikey/)
  const no = await handle(pre('https://evil.example'), deps())
  assert.equal(no.status, 403)
  assert.equal(no.headers.get('access-control-allow-origin'), null)
})

test('localhost dev origins (any port) are always allowed, other schemes and hosts are not', async () => {
  for (const origin of ['http://localhost:5173', 'http://127.0.0.1:61234']) assert.equal((await handle(post({ domain: 'gmail.com' }, origin), deps())).status, 200, origin)
  for (const origin of ['https://localhost:5173', 'http://localhost.evil.com:5173', 'http://evil.com:5173/localhost']) assert.equal((await handle(post({ domain: 'gmail.com' }, origin), deps())).status, 403, origin)
})

test('other methods are refused and a resolver failure is an error answer, not a crash', async () => {
  assert.equal((await handle(new Request('https://f.example/x', { method: 'GET', headers: { origin: APP } }), deps())).status, 405)
  const res = await handle(post({ domain: 'gmail.com' }), { origins: [APP], resolveMx: async () => { throw new Error('dns down') } })
  assert.deepEqual(await json(res), { valid: false, reason: 'no_mx' })
})
