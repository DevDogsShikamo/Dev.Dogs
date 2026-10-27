// S5a end to end through the photo Worker at FOTOS_URL (the deployed staging Worker, or `wrangler dev` locally) with
// real staging users: WP-2a/2b, WP-3a/3b/3c/3f, WP-4a/4b/4d/4e, WP-5a/5b. Needs FOTOS_URL in .env.test or the environment.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, ids, seed, writePrestaciones } from './_actors.mjs'
import { loadConfig } from './_env.mjs'
import { COMMENT, EXIF, APP0, jpeg } from '../../worker/test/_jpeg.mjs'

const FOTOS = (() => { try { return loadConfig().fotosUrl } catch { return undefined } })()
const opts = FOTOS ? {} : { skip: 'FOTOS_URL is not set: deploy the staging Worker and add it to .env.test (S5a.11)' }
const u = ids.users
const hoy = new Date(Date.now() - 5 * 36e5).toISOString().slice(0, 10)
const CLEAN = jpeg({ parts: [APP0, COMMENT], size: 3000 })
const created = { walks: [], fotos: [], incidentes: [] }

before(() => FOTOS && seed())
after(async () => {
  await admin().from('fotos_reportes').delete().in('foto_id', created.fotos)
  await admin().from('incidentes').delete().in('id', created.incidentes)
  await admin().from('paseo_fotos').delete().in('id', created.fotos)
  await admin().from('prestaciones').delete().in('id', created.walks)
})

const token = async (actor) => (await (await as(actor)).auth.getSession()).data.session.access_token
async function worker(method, id, actor, { body, type = 'image/jpeg', origin, bearer } = {}) {
  const headers = { ...(origin && { origin }), ...(method === 'PUT' && { 'content-type': type }) }
  const t = bearer ?? (actor && (await token(actor)))
  if (t) headers.authorization = `Bearer ${t}`
  return fetch(`${FOTOS}/f/${id}`, { method, headers, body })
}
async function registrar(actor, dogs) {
  const walks = []
  for (const dog of dogs) {
    const ind = dog === ids.perros.dI
    const { data } = await writePrestaciones({
      negocio_id: ind ? ids.negocios.I : ids.negocios.A, perro_id: dog, tipo: 'paseo', servicio_id: ind ? null : ids.servicios.paseoA,
      cuidador_id: u[actor], fecha: hoy, estado: 'en_curso', precio_aplicado: 0, detalle: {},
    })
    walks.push(data[0].id)
  }
  created.walks.push(...walks)
  const res = await (await as(actor)).rpc('foto_registrar', { p_prestaciones: walks })
  assert.equal(res.error, null, res.error?.message)
  created.fotos.push(res.data)
  return res.data
}
const bytes = async (res) => new Uint8Array(await res.arrayBuffer())

test('WP-3f/4d/5b: a clean JPEG is stored for d1+d3; its uploader and the owners of both dogs read it back, private and uncached', opts, async () => {
  const id = await registrar('WALKER_CO', [ids.perros.d1, ids.perros.d3])
  const up = await worker('PUT', id, 'WALKER_CO', { body: CLEAN })
  assert.equal(up.status, 201, await up.text())
  for (const actor of ['WALKER_CO', 'CLIENT', 'COOWNER', 'CLIENT2']) {
    const res = await worker('GET', id, actor)
    assert.equal(res.status, 200, actor)
    assert.equal(res.headers.get('cache-control'), 'private, no-store')
    assert.equal(res.headers.get('content-type'), 'image/jpeg')
    assert.deepEqual(await bytes(res), CLEAN, actor)
  }
  // WP-3a on a stored photo: nobody can overwrite it, not even the uploader.
  for (const actor of ['WALKER_CO', 'CLIENT', 'WALKER_CO2']) assert.equal((await worker('PUT', id, actor, { body: CLEAN })).status, 403, actor)
})

test('WP-4a/4b/2b: group-mates, the business owner, office, other walkers and other tenants get the same 404 as a missing photo', opts, async () => {
  const id = await registrar('WALKER_CO', [ids.perros.d1])
  assert.equal((await worker('PUT', id, 'WALKER_CO', { body: CLEAN })).status, 201)
  const missing = await worker('GET', crypto.randomUUID(), 'CLIENT')
  for (const actor of ['CLIENT3', 'OWNER', 'OFFICE', 'OFFICE_FIN', 'WALKER_CO2', 'WALKER_IND', 'CLIENT_I', 'OTHER']) {
    const res = await worker('GET', id, actor)
    assert.equal(res.status, 404, actor)
    assert.equal(await res.text(), await missing.clone().text(), `${actor}: body differs from a missing photo`)
  }
})

test('WP-4e: an independent walker uploads and reads own photo; the dog owner of that tenant reads it too', opts, async () => {
  const id = await registrar('WALKER_IND', [ids.perros.dI])
  assert.equal((await worker('PUT', id, 'WALKER_IND', { body: CLEAN })).status, 201)
  for (const actor of ['WALKER_IND', 'CLIENT_I']) assert.equal((await worker('GET', id, actor)).status, 200, actor)
  assert.equal((await worker('GET', id, 'OWNER')).status, 404)
})

test('WP-2a/5a: no token, a garbage token and a tampered token are 401 on read and upload', opts, async () => {
  const id = await registrar('WALKER_CO', [ids.perros.d1])
  const [h, p, s] = (await token('WALKER_CO')).split('.')
  const pastExp = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), exp: 1 })).toString('base64url')
  for (const [label, bearer] of [['garbage', 'not-a-jwt'], ['tampered payload', `${h}.${pastExp}.${s}`], ['wrong signature', `${h}.${p}.${s.split('').reverse().join('')}`]]) {
    assert.equal((await worker('GET', id, null, { bearer })).status, 401, label)
    assert.equal((await worker('PUT', id, null, { bearer, body: CLEAN })).status, 401, label)
  }
  assert.equal((await worker('GET', id, null)).status, 401, 'no header')
  assert.equal((await worker('PUT', id, null, { body: CLEAN })).status, 401, 'no header')
})

test('WP-3b/3c: Exif, a wrong type and an oversized file are rejected, nothing is stored, and the same photo then takes a clean upload', opts, async () => {
  const id = await registrar('WALKER_CO', [ids.perros.d1])
  const attempts = [
    ['Exif APP1', { body: jpeg({ parts: [APP0, EXIF] }) }, 422],
    ['png type', { body: CLEAN, type: 'image/png' }, 415],
    ['over 2 MB', { body: jpeg({ size: 2 * 1024 * 1024 + 1 }) }, 413],
    ['not a jpeg', { body: new Uint8Array([1, 2, 3, 4, 5]) }, 422],
  ]
  for (const [label, o, status] of attempts) assert.equal((await worker('PUT', id, 'WALKER_CO', o)).status, status, label)
  assert.equal((await worker('GET', id, 'WALKER_CO')).status, 404, 'the uploader finds no stored object')
  assert.equal((await admin().from('paseo_fotos').select('estado').eq('id', id).single()).data.estado, 'pendiente')
  assert.equal((await worker('PUT', id, 'WALKER_CO', { body: CLEAN })).status, 201)
  assert.equal((await worker('GET', id, 'WALKER_CO')).status, 200)
})

test('origin allow-list: an unknown browser origin is refused before anything else', opts, async () => {
  const id = await registrar('WALKER_CO', [ids.perros.d1])
  assert.equal((await worker('GET', id, 'WALKER_CO', { origin: 'https://evil.example' })).status, 403)
  assert.equal((await worker('GET', id, 'WALKER_CO', { origin: 'http://localhost:5173' })).headers.get('access-control-allow-origin'), 'http://localhost:5173')
})

// Batch C2: incident evidence. The r/ copy stays in the staging bucket (no lifecycle on r/); it is a few KB.
test('retener: the reporter copies the retained photo to r/, a stranger is refused, and a reported photo is then served to the business', opts, async () => {
  const id = await registrar('WALKER_CO', [ids.perros.d1])
  assert.equal((await worker('PUT', id, 'WALKER_CO', { body: CLEAN })).status, 201)
  const walk = created.walks.at(-1)
  const inc = await (await as('WALKER_CO')).rpc('incidente_reportar', { p_perro: ids.perros.d1, p_prestacion: walk, p_tipo: 'lesion', p_descripcion: 'Cojea de la pata trasera después del paseo.' })
  assert.equal(inc.error, null, inc.error?.message)
  created.incidentes.push(inc.data)
  const retener = async (actor) => fetch(`${FOTOS}/retener/${inc.data}`, { method: 'POST', headers: { authorization: `Bearer ${await token(actor)}` } })
  for (const actor of ['CLIENT2', 'WALKER_CO2']) assert.equal((await retener(actor)).status, 403, actor)
  const ok = await retener('WALKER_CO')
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { copiadas: 1 })
  assert.equal((await (await as('CLIENT')).rpc('foto_reportar', { p_foto: id, p_motivo: 'aparece_persona' })).error, null)
  assert.equal((await worker('GET', id, 'CLIENT')).status, 404, 'hidden from the client')
  const res = await worker('GET', id, 'OWNER')
  assert.equal(res.status, 200, 'kept for the business owner')
  assert.deepEqual(await bytes(res), CLEAN)
})
