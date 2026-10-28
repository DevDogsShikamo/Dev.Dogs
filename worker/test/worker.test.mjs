// Photo Worker: authorization is delegated to Supabase (stubbed fetch), storage is a stubbed R2 binding.
// WP-2a/2b, WP-3a/3b/3c/3f, WP-5a/5b and the CORS allow-list; the deployed twin is tests/security/s5-photos.test.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handle } from '../src/index.js'
import { APP0, COMMENT, EXIF, jpeg } from './_jpeg.mjs'

const ID = '0f0f0f0f-0000-4000-8000-000000000001'
const NEG = '0e0e0e0e-0000-4000-8000-000000000002'
const KEY = `f/${NEG}/${ID}.jpg`
const SUPABASE = 'https://stg.supabase.co'
const MB2 = 2 * 1024 * 1024
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// Supabase stub keyed by the bearer token: good = uploader/owner, stranger = row not visible, expired = rejected JWT.
function supabase({ confirm = 204 } = {}) {
  const calls = []
  const fetchImpl = async (url, init) => {
    const u = new URL(url)
    const h = new Headers(init.headers)
    const token = h.get('authorization')?.slice(7)
    calls.push({ path: u.pathname + u.search, token, apikey: h.get('apikey'), body: init.body })
    if (token === 'expired') return json(401, { code: 'PGRST301', message: 'JWT expired' })
    if (u.pathname.endsWith('/foto_subida_autorizar')) return token === 'stranger' ? json(403, { code: '42501' }) : json(200, KEY)
    if (u.pathname.endsWith('/foto_confirmar')) return confirm === 204 ? new Response(null, { status: 204 }) : json(confirm, { code: '42501' })
    if (u.pathname === '/rest/v1/paseo_fotos') return json(200, token === 'stranger' ? [] : [{ id: ID, negocio_id: NEG }])
    return json(404, {})
  }
  return { calls, fetchImpl }
}
function bucket(initial = {}) {
  const store = new Map(Object.entries(initial))
  return {
    store,
    put: async (key, body, opts) => void store.set(key, { bytes: new Uint8Array(body), opts }),
    delete: async (key) => void store.delete(key),
    get: async (key) => (store.has(key) ? { body: new Blob([store.get(key)]).stream(), size: store.get(key).length } : null),
  }
}
const CLEAN = jpeg({ parts: [APP0, COMMENT] })

async function call(method, path, { token = 'good', type = 'image/jpeg', body, origin, sb = supabase(), r2 = bucket(), env = {} } = {}) {
  const headers = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (origin) headers.origin = origin
  if (method === 'PUT') headers['content-type'] = type
  const request = new Request(`https://fotos.test${path}`, { method, headers, body, duplex: 'half' })
  const e = { SUPABASE_URL: SUPABASE, SUPABASE_PUBLISHABLE_KEY: 'pub-key', ALLOWED_ORIGINS: 'https://app.example', BUCKET: r2, ...env }
  const res = await handle(request, e, sb.fetchImpl)
  return { res, sb, r2 }
}
const put = (opts) => call('PUT', `/f/${ID}`, { body: CLEAN, ...opts })
const confirmed = (sb) => sb.calls.some((c) => c.path.endsWith('/foto_confirmar'))

// ---- WP-2a / WP-5a: no usable bearer -> 401 -------------------------------------------------------
for (const [label, token] of [['no header', null], ['expired token', 'expired']]) {
  for (const method of ['GET', 'PUT']) {
    test(`WP-2a/5a: ${method} with ${label} gets 401 and stores or serves nothing`, async () => {
      const { res, sb, r2 } = await call(method, `/f/${ID}`, { token, body: method === 'PUT' ? CLEAN : undefined, r2: bucket({ [KEY]: CLEAN }) })
      assert.equal(res.status, 401)
      assert.equal(res.headers.get('cache-control'), 'private, no-store')
      assert.equal(sb.calls.length, token ? 1 : 0, 'a missing token must not reach Supabase')
      assert.deepEqual([...r2.store.keys()], [KEY], 'the bucket is untouched')
    })
  }
}
test('WP-5a: a non-bearer scheme is 401', async () => {
  const request = new Request(`https://fotos.test/f/${ID}`, { headers: { authorization: 'Basic abc' } })
  assert.equal((await handle(request, { SUPABASE_URL: SUPABASE, BUCKET: bucket() }, supabase().fetchImpl)).status, 401)
})

// ---- WP-2b, WP-5b: reads ----------------------------------------------------------------------------
test('WP-5b/2b: a visible photo is served from the key derived from the row, private and uncached', async () => {
  const { res, sb } = await call('GET', `/f/${ID}`, { r2: bucket({ [KEY]: CLEAN }) })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('cache-control'), 'private, no-store')
  assert.equal(res.headers.get('content-type'), 'image/jpeg')
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), CLEAN)
  assert.equal(sb.calls[0].token, 'good', 'the caller token is forwarded as is')
  assert.equal(sb.calls[0].apikey, 'pub-key')
  assert.match(sb.calls[0].path, new RegExp(`^/rest/v1/paseo_fotos\\?id=eq\\.${ID}`))
})
test('WP-2b: a photo the row hides and a photo that does not exist answer the same 404', async () => {
  const hidden = await call('GET', `/f/${ID}`, { token: 'stranger', r2: bucket({ [KEY]: CLEAN }) })
  const missing = await call('GET', `/f/${ID}`, { r2: bucket() })
  assert.deepEqual([hidden.res.status, missing.res.status], [404, 404])
  assert.equal(await hidden.res.text(), await missing.res.text())
  assert.equal(hidden.res.headers.get('cache-control'), 'private, no-store')
})
test('paths: a malformed id or an unknown route is 404 without asking Supabase; other methods are 405', async () => {
  for (const path of ['/f/not-a-uuid', `/f/${ID}/x`, `/f/${ID}.jpg`, '/f/../x', '/', `/g/${ID}`]) {
    const { res, sb } = await call('GET', path)
    assert.equal(res.status, 404, path)
    assert.equal(sb.calls.length, 0, path)
  }
  for (const method of ['POST', 'DELETE']) assert.equal((await call(method, `/f/${ID}`)).res.status, 405, method)
})

// ---- WP-3: uploads ----------------------------------------------------------------------------------
test('WP-3f: a clean JPEG is stored under the server-chosen key and confirmed with its size', async () => {
  const { res, sb, r2 } = await put()
  assert.equal(res.status, 201)
  assert.deepEqual([...r2.store.keys()], [KEY])
  assert.deepEqual(r2.store.get(KEY).bytes, CLEAN)
  assert.equal(r2.store.get(KEY).opts.httpMetadata.contentType, 'image/jpeg')
  assert.deepEqual(sb.calls.map((c) => c.path), ['/rest/v1/rpc/foto_subida_autorizar', '/rest/v1/rpc/foto_confirmar'])
  assert.deepEqual(JSON.parse(sb.calls[1].body), { p_id: ID, p_bytes: CLEAN.length })
})
test('WP-3f: the size boundary, repeated comments and FFE1 bytes inside the scan are all accepted', async () => {
  for (const file of [jpeg({ size: MB2 }), jpeg({ parts: [APP0, COMMENT, COMMENT] }), jpeg({ scan: [0xff, 0xe1, 0x00, 0xff, 0x00, 0x41] })]) {
    const { res, r2 } = await put({ body: file })
    assert.equal(res.status, 201, `${file.length} bytes`)
    assert.equal(r2.store.size, 1)
  }
})
test('WP-3a: a caller Supabase does not authorize gets 403 and nothing is stored', async () => {
  const { res, r2, sb } = await put({ token: 'stranger' })
  assert.equal(res.status, 403)
  assert.equal(r2.store.size, 0)
  assert.equal(sb.calls.length, 1, 'no confirm after a refusal')
})
test('WP-3b: wrong type, too large (declared or streamed) or not a JPEG is rejected and not stored', async () => {
  const stream = (n) => new ReadableStream({ start(c) { c.enqueue(new Uint8Array(n)); c.close() } })
  const cases = [
    ['png type', { type: 'image/png' }, 415],
    ['no type', { type: '' }, 415],
    ['over 2 MB', { body: jpeg({ size: MB2 + 1 }) }, 413],
    ['over 2 MB, streamed', { body: stream(MB2 + 1) }, 413],
    ['png bytes as jpeg', { body: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]) }, 422],
    ['empty body', { body: new Uint8Array() }, 422],
    ['jpeg without scan', { body: Uint8Array.from([0xff, 0xd8, ...APP0, 0xff, 0xd9]) }, 422],
    ['truncated segment', { body: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x7f, 0xff, 1]) }, 422],
  ]
  for (const [label, opts, status] of cases) {
    const { res, r2, sb } = await put(opts)
    assert.equal(res.status, status, label)
    assert.equal(r2.store.size, 0, `${label}: stored`)
    assert.ok(!confirmed(sb), `${label}: confirmed`)
  }
})
test('WP-3c: an Exif/XMP APP1 segment is rejected wherever it sits before the scan, and nothing is stored', async () => {
  for (const parts of [[APP0, EXIF], [EXIF], [COMMENT, APP0, COMMENT, EXIF]]) {
    const { res, r2, sb } = await put({ body: jpeg({ parts }) })
    assert.equal(res.status, 422)
    assert.equal((await res.json()).error, 'exif_no_permitido')
    assert.equal(r2.store.size, 0)
    assert.ok(!confirmed(sb))
  }
})
test('a failed confirm removes the object it just wrote', async () => {
  const { res, r2 } = await put({ sb: supabase({ confirm: 403 }) })
  assert.equal(res.status, 403)
  assert.equal(r2.store.size, 0)
})

// ---- CORS allow-list --------------------------------------------------------------------------------
test('origins: allowed and localhost get CORS headers, others get 403 before Supabase is asked', async () => {
  const cases = [
    ['https://app.example', 200, true], ['http://localhost:5173', 200, true], ['http://127.0.0.1:3000', 200, true],
    ['https://evil.example', 403, false], ['https://app.example.evil.com', 403, false], ['http://localhost.evil.com', 403, false],
  ]
  for (const [origin, status, cors] of cases) {
    const { res, sb } = await call('GET', `/f/${ID}`, { origin, env: { ALLOW_LOCALHOST: '1' }, r2: bucket({ [KEY]: CLEAN }) })
    assert.equal(res.status, status, origin)
    assert.equal(res.headers.get('access-control-allow-origin'), cors ? origin : null, origin)
    if (!cors) assert.equal(sb.calls.length, 0, origin)
  }
  // Without ALLOW_LOCALHOST localhost is out; a request with no Origin (not a browser) is judged by its token alone.
  assert.equal((await call('GET', `/f/${ID}`, { origin: 'http://localhost:5173', r2: bucket({ [KEY]: CLEAN }) })).res.status, 403)
  assert.equal((await call('GET', `/f/${ID}`, { r2: bucket({ [KEY]: CLEAN }) })).res.status, 200)
})
test('preflight: allowed origins get the method and header list, others 403', async () => {
  const ok = await call('OPTIONS', `/f/${ID}`, { token: null, origin: 'https://app.example' })
  assert.equal(ok.res.status, 204)
  assert.match(ok.res.headers.get('access-control-allow-headers'), /authorization/i)
  assert.match(ok.res.headers.get('access-control-allow-methods'), /PUT/)
  assert.equal((await call('OPTIONS', `/f/${ID}`, { token: null, origin: 'https://evil.example' })).res.status, 403)
})
