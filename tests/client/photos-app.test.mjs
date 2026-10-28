// S5b static and component checks: the legacy Storage path is gone, the photo origin is configurable
// only on localhost, and FotoUpload.js (run against stubs) re-encodes, registers the tags, uploads with
// the user's bearer token, keeps a failed upload retryable under the same id and maps errors to toasts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const text = (p) => readFileSync(join(ROOT, p), 'utf8')
const FOTOS = 'https://photos.example'

test('WP-1a/3e: no Storage upload, public URL or paseo_agregar_foto call is left in src/', () => {
  const files = []
  const walk = (dir) => readdirSync(dir).forEach((e) => (statSync(join(dir, e)).isDirectory() ? walk(join(dir, e)) : files.push(join(dir, e))))
  walk(join(ROOT, 'src'))
  assert.ok(files.length > 30, 'scan sanity')
  for (const f of files) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), /\.storage\b|getPublicUrl|paseo_agregar_foto|paseoAgregarFoto|from\("paseos"\)/, f)
  }
})

test('S5b: the photo origin defaults to production and is overridable only through the localhost hook', () => {
  const src = text('src/lib/authActions.ts')
  assert.match(src, /https:\/\/devdogs-fotos\.devdogsco\.workers\.dev/)
  assert.match(src, /fotos:\s*\(override && override\.fotos\)/, 'override read from the same localhost-only object as url/key')
  assert.match(src, /g\.__ddFotos\s*=\s*cfg\.fotos/)
  assert.match(src, /const override = isLocal \?/, 'the override is gated on localhost')
})

// ---- FotoUpload.js against stubs ----------------------------------------------------------------
const settle = () => new Promise((r) => setTimeout(r, 25))
const src = text('src/components/FotoUpload.js')

function setup({ bitmap = { width: 4000, height: 3000 }, sizes = [900_000], puts = [201], registrar = { data: 'foto-1' }, tags = [{ id: 'p1' }, { id: 'p2' }] } = {}) {
  const log = { rpc: [], puts: [], toasts: [], uploaded: [], toBlob: [], canvas: null }
  const el = () => ({ style: {}, kids: [], on: {}, clicks: 0, files: [], addEventListener(t, f) { this.on[t] = f }, appendChild(c) { this.kids.push(c) }, click() { this.clicks++ } })
  const document = {
    createElement: (tag) => {
      const e = el()
      if (tag === 'canvas') {
        log.canvas = e
        e.getContext = () => ({ drawImage() {} })
        e.toBlob = (cb, type, q) => { log.toBlob.push({ type, q }); cb({ size: sizes[Math.min(log.toBlob.length - 1, sizes.length - 1)], type }) }
      }
      return e
    },
  }
  const queue = [...puts]
  const fetch = (url, init) => {
    log.puts.push({ url, init })
    const status = queue.length > 1 ? queue.shift() : queue[0]
    return status === 'network' ? Promise.reject(new TypeError('failed')) : Promise.resolve({ status, ok: status < 300 })
  }
  const g = {
    __ddFotos: FOTOS,
    __ddUtils: { toast: (m) => log.toasts.push(m) },
    __supa: {
      rpc: (name, args) => { log.rpc.push({ name, args }); return Promise.resolve(registrar) },
      auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'tok-1' } } }) },
    },
  }
  const createImageBitmap = () => Promise.resolve({ ...bitmap, close() {} })
  const URL = { createObjectURL: () => 'blob:preview' }
  const mount = new Function('document', 'createImageBitmap', 'fetch', 'URL', 'globalThis', `${src}; return mount`)(document, createImageBitmap, fetch, URL, g)
  const host = el()
  const update = mount(host, { tags }, { uploaded: (u) => log.uploaded.push(u) })
  const [btn, input] = host.kids
  const pick = async () => { input.files = [{ name: 'a.jpg' }]; input.on.change(); await settle() }
  return { log, update, btn, input, pick, host }
}

test('WP-3d: the photo is resized to 1600 px, re-encoded as JPEG, registered with the ticked dogs and uploaded with the bearer token', async () => {
  const t = setup()
  await t.pick()
  assert.deepEqual([t.log.canvas.width, t.log.canvas.height], [1600, 1200])
  assert.deepEqual(t.log.toBlob, [{ type: 'image/jpeg', q: 0.8 }])
  assert.deepEqual(t.log.rpc, [{ name: 'foto_registrar', args: { p_prestaciones: ['p1', 'p2'] } }])
  assert.equal(t.log.puts.length, 1)
  const { url, init } = t.log.puts[0]
  assert.equal(url, `${FOTOS}/f/foto-1`)
  assert.equal(init.method, 'PUT')
  assert.deepEqual(init.headers, { authorization: 'Bearer tok-1', 'content-type': 'image/jpeg' })
  assert.equal(init.body.type, 'image/jpeg')
  assert.equal(t.log.uploaded.length, 1, 'the page is told once')
  assert.deepEqual(t.log.toasts, [])
})

test('WP-3d: a small portrait keeps its size; a result over 1.5 MB is re-encoded at 0.6', async () => {
  const small = setup({ bitmap: { width: 800, height: 1200 } })
  await small.pick()
  assert.deepEqual([small.log.canvas.width, small.log.canvas.height], [800, 1200], 'never upscaled')
  const big = setup({ sizes: [1_800_000, 1_100_000] })
  await big.pick()
  assert.deepEqual(big.log.toBlob.map((b) => b.q), [0.8, 0.6])
  assert.equal(big.log.puts[0].init.body.size, 1_100_000, 'the smaller encoding is the one uploaded')
})

test('P5: the dogs ticked now are the ones registered (the page updates the widget when the walker unticks one)', async () => {
  const t = setup()
  t.update({ tags: [{ id: 'p2' }] })
  await t.pick()
  assert.deepEqual(t.log.rpc[0].args, { p_prestaciones: ['p2'] })
})

test('P5: with no dog ticked nothing is registered or uploaded and the walker is told', async () => {
  const t = setup({ tags: [] })
  await t.pick()
  assert.deepEqual(t.log.rpc, [])
  assert.deepEqual(t.log.puts, [])
  assert.equal(t.log.toasts.length, 1)
  assert.match(t.log.toasts[0], /perro/i)
})

test('a failed upload keeps the photo pending: the retry reuses the same id and does not register again', async () => {
  for (const first of [503, 401, 'network']) {
    const t = setup({ puts: [first, 201] })
    await t.pick()
    assert.equal(t.log.toasts.length, 1, `${first}: one toast`)
    assert.equal(t.log.uploaded.length, 0)
    assert.match(t.btn.textContent, /Reintentar/)
    t.btn.on.click()
    await settle()
    assert.equal(t.log.rpc.length, 1, `${first}: no second foto_registrar`)
    assert.deepEqual(t.log.puts.map((p) => p.url), [`${FOTOS}/f/foto-1`, `${FOTOS}/f/foto-1`])
    assert.equal(t.log.puts[1].init.body, t.log.puts[0].init.body, 'same bytes')
    assert.equal(t.log.uploaded.length, 1)
    assert.doesNotMatch(t.btn.textContent, /Reintentar/)
  }
})

test('errors are mapped to a toast: an invalid or oversized photo is not retried, a registration limit is explained', async () => {
  const bad = setup({ puts: [422] })
  await bad.pick()
  assert.match(bad.log.toasts[0], /no es válida|no es valida/i)
  assert.doesNotMatch(bad.btn.textContent, /Reintentar/)
  bad.btn.on.click()
  assert.equal(bad.input.clicks, 1, 'the next click opens the picker again')
  const big = setup({ puts: [413] })
  await big.pick()
  assert.match(big.log.toasts[0], /grande/i)
  const full = setup({ registrar: { error: { message: 'demasiadas_fotos' } } })
  await full.pick()
  assert.deepEqual(full.log.puts, [], 'nothing is uploaded when registration fails')
  assert.match(full.log.toasts[0], /10 fotos/)
  const late = setup({ registrar: { error: { message: 'fuera_de_ventana' } } })
  await late.pick()
  assert.match(late.log.toasts[0], /hoy o ayer/i)
})
