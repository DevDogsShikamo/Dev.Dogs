// F5b data polish (20261030110001_datos.sql):
//   incidente_reportar(p_id)   the offline outbox replays an incident with its client-generated id: the same id again
//                              from its reporter returns it without a second row; from anyone else it is a refusal
//   perro_foto_autorizar/_confirmar  the owner or office of the dog's business or an active owner of the dog changes
//                              its profile photo (key p/{negocio}/{perro}.jpg); nobody else
//   mi_perro_actualizar        an active owner (principal or co) edits name, breed, size, behaviour, sociability, tips
// Throwaway dogs and users only; the shared fixtures are never changed.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, day, ids, seed, tempUser, writePrestaciones } from './_actors.mjs'
import { dropDog } from './_attacks.mjs'
import { loadConfig } from './_env.mjs'
import { sql } from './_sql.mjs'
import { APP0, COMMENT, jpeg } from '../../worker/test/_jpeg.mjs'

const u = ids.users
const A = ids.negocios.A
const DESC = 'Se soltó de la correa en el parque y volvió a los cinco minutos.'
const ok = (res, what) => assert.equal(res.error, null, `${what}: ${res.error?.message}`)
const denied = (res, what = '') => assert.equal(res.error?.code, '42501', `${what} expected 42501, got ${res.error?.code ?? 'no error'} ${res.error?.message ?? ''}`)
const fails = (res, code, what = '') => assert.match(res.error?.message ?? 'no error', new RegExp(code), what)
const created = { walks: [], incidentes: [], dogs: [] }

before(() => seed())
after(async () => {
  await admin().from('incidentes').delete().in('id', created.incidentes)
  await admin().from('prestaciones').delete().in('id', created.walks)
  for (const dog of created.dogs) await dropDog(dog)
})

// A dog of tenant A with CLIENT as principal and COOWNER as co-owner (what perro_dueno_principal leaves).
async function dog(spec = {}) {
  const { data, error } = await admin().from('perros').insert({ negocio_id: A, nombre: 'Datos', ...spec }).select('id').single()
  assert.equal(error, null)
  created.dogs.push(data.id)
  ok(await admin().from('perro_duenos').insert([
    { perro_id: data.id, dueno_id: u.CLIENT, rol: 'principal', estado: 'activo' },
    { perro_id: data.id, dueno_id: u.COOWNER, rol: 'co', estado: 'activo' },
  ]), 'links')
  return data.id
}
// A client of tenant A whose link to `perro` is inactive (a removed or former owner).
async function exOwner(perro, fn) {
  const m = await tempUser()
  try {
    ok(await admin().from('profiles').insert({ id: m.id, negocio_id: A, rol: 'cliente', nombre: 'Ex dueño' }), 'profile')
    ok(await admin().from('perro_duenos').insert({ perro_id: perro, dueno_id: m.id, rol: 'co', estado: 'inactivo' }), 'link')
    return await fn(m.client)
  } finally {
    await admin().from('perro_duenos').delete().eq('dueno_id', m.id)
    await m.drop()
  }
}

// ---- incidents: idempotent replay -------------------------------------------------------------------------------
async function walk(spec = {}) {
  const { data } = await writePrestaciones({
    negocio_id: A, perro_id: ids.perros.d1, tipo: 'paseo', servicio_id: ids.servicios.paseoA, cuidador_id: u.WALKER_CO,
    fecha: day(0), estado: 'en_curso', precio_aplicado: 0, detalle: { hora: `datos-${created.walks.length}` }, ...spec,
  })
  created.walks.push(data[0].id)
  return data[0].id
}
const reportar = async (actor, args) =>
  (await as(actor)).rpc('incidente_reportar', { p_perro: ids.perros.d1, p_prestacion: null, p_tipo: 'lesion', p_descripcion: DESC, ...args })
const count = async (id) => (await admin().from('incidentes').select('id').eq('id', id)).data.length

test('ID-1: a replay of the same client id by its reporter returns it and stores one incident', async () => {
  const p = await walk()
  const id = crypto.randomUUID()
  created.incidentes.push(id)
  const first = await reportar('WALKER_CO', { p_prestacion: p, p_id: id })
  ok(first, 'first')
  assert.equal(first.data, id)
  const again = await reportar('WALKER_CO', { p_prestacion: p, p_id: id, p_descripcion: DESC + ' (reintento)' })
  ok(again, 'replay')
  assert.equal(again.data, id)
  assert.equal(await count(id), 1)
  const row = (await admin().from('incidentes').select('descripcion,reportado_por').eq('id', id).single()).data
  assert.deepEqual(row, { descripcion: DESC, reportado_por: u.WALKER_CO }, 'the replay changes nothing')
})

test('ID-2: a replay that arrives after the walk window still returns the stored incident', async () => {
  const p = await walk()
  const id = crypto.randomUUID()
  created.incidentes.push(id)
  ok(await reportar('WALKER_CO', { p_prestacion: p, p_id: id }), 'first')
  ok(await admin().from('prestaciones').update({ fecha: day(-3) }).eq('id', p), 'age the walk')
  const again = await reportar('WALKER_CO', { p_prestacion: p, p_id: id })
  ok(again, 'late replay')
  assert.equal(await count(id), 1)
})

test('ID-3: the id of somebody else\'s incident is refused and changes nothing', async () => {
  const p = await walk()
  const id = crypto.randomUUID()
  created.incidentes.push(id)
  ok(await reportar('WALKER_CO', { p_prestacion: p, p_id: id }), 'first')
  for (const actor of ['OWNER', 'OFFICE', 'WALKER_CO2', 'CLIENT', 'OTHER', 'NOPROFILE', 'ANON']) denied(await reportar(actor, { p_id: id }), actor)
  assert.equal(await count(id), 1)
  // A fresh id is not a way around the usual checks.
  denied(await reportar('WALKER_CO2', { p_prestacion: p, p_id: crypto.randomUUID() }), 'another walker, new id')
})

test('ID-4: without p_id an incident is stored as before (new server id each call)', async () => {
  const p = await walk()
  const a = await reportar('WALKER_CO', { p_prestacion: p })
  const b = await reportar('WALKER_CO', { p_prestacion: p })
  ok(a, 'a')
  ok(b, 'b')
  created.incidentes.push(a.data, b.data)
  assert.notEqual(a.data, b.data)
})

// ---- dog profile photo ----------------------------------------------------------------------------------------
const autorizar = async (actor, perro) => (await as(actor)).rpc('perro_foto_autorizar', { p_perro: perro })
const confirmar = async (actor, perro, bytes = 1234) => (await as(actor)).rpc('perro_foto_confirmar', { p_perro: perro, p_bytes: bytes })
const fotoAt = async (perro) => (await admin().from('perros').select('foto_at').eq('id', perro).single()).data.foto_at

test('PF-1: the owner, the office and the active owners of the dog get its key and confirm the photo', async () => {
  const perro = await dog()
  for (const actor of ['OWNER', 'OFFICE', 'OFFICE_FIN', 'CLIENT', 'COOWNER']) {
    const res = await autorizar(actor, perro)
    ok(res, actor)
    assert.equal(res.data, `p/${A}/${perro}.jpg`, actor)
  }
  assert.equal(await fotoAt(perro), null)
  ok(await confirmar('COOWNER', perro), 'confirm')
  assert.ok(await fotoAt(perro), 'foto_at set')
  // The owners read the new timestamp through RLS.
  assert.ok((await (await as('CLIENT')).from('perros').select('foto_at').eq('id', perro).single()).data.foto_at)
})

test('PF-2: walkers, other clients, other tenants, an inactive link, no profile and anon are refused', async () => {
  const perro = await dog()
  for (const actor of ['WALKER_CO', 'WALKER_CO2', 'CLIENT2', 'CLIENT3', 'OTHER', 'WALKER_IND', 'CLIENT_I', 'NOPROFILE', 'ANON']) {
    denied(await autorizar(actor, perro), `${actor} autorizar`)
    denied(await confirmar(actor, perro), `${actor} confirmar`)
  }
  await exOwner(perro, async (db) => {
    denied(await db.rpc('perro_foto_autorizar', { p_perro: perro }), 'inactive link')
    denied(await db.rpc('perro_foto_confirmar', { p_perro: perro, p_bytes: 10 }), 'inactive link confirm')
  })
  denied(await autorizar('OWNER', ids.perros.dB), 'a dog of another tenant')
  denied(await autorizar('OWNER', crypto.randomUUID()), 'unknown dog')
  assert.equal(await fotoAt(perro), null, 'nothing confirmed')
})

test('PF-3: a removed dog takes no photo; a bad size is refused; the helper is not callable', async () => {
  const perro = await dog({ activo: false })
  denied(await autorizar('OWNER', perro), 'inactive dog')
  denied(await autorizar('CLIENT', perro), 'inactive dog, owner')
  const live = await dog()
  for (const bytes of [0, 2097153, null]) fails(await confirmar('OWNER', live, bytes), 'foto_invalida', String(bytes))
  assert.equal(await fotoAt(live), null)
  denied(await (await as('OWNER')).rpc('perro_foto_negocio', { p_perro: live }), 'helper')
})

// ---- the client edits its own dog ------------------------------------------------------------------------------
const editar = async (actor, perro, args = {}) =>
  (await as(actor)).rpc('mi_perro_actualizar', { p_perro: perro, p_nombre: 'Copito', p_raza: 'Pug', p_tamano: 'pequeno', p_conducta: 'sociable', p_tips: 'Le gusta el agua', p_sociabilidad: 'excelente', ...args })
const fields = async (perro) =>
  (await admin().from('perros').select('nombre,raza,tamano,conducta,tips,sociabilidad,en_celo,enfermedad_contagiosa,certificado_salud,negocio_id').eq('id', perro).single()).data

test('ME-1: the principal and a co-owner edit name, breed, size, behaviour, sociability and tips', async () => {
  const perro = await dog({ en_celo: true, certificado_salud: day(-10) })
  ok(await editar('CLIENT', perro), 'principal')
  assert.deepEqual(await fields(perro), {
    nombre: 'Copito', raza: 'Pug', tamano: 'pequeno', conducta: 'sociable', tips: 'Le gusta el agua', sociabilidad: 'excelente',
    en_celo: true, enfermedad_contagiosa: false, certificado_salud: day(-10), negocio_id: A,
  })
  ok(await editar('COOWNER', perro, { p_nombre: '  Copo  ', p_raza: '', p_tamano: null, p_tips: '' }), 'co-owner')
  const f = await fields(perro)
  assert.deepEqual([f.nombre, f.raza, f.tamano, f.tips], ['Copo', null, null, null])
})

test('ME-2: another client, an inactive link, staff, another tenant, no profile and anon are refused', async () => {
  const perro = await dog()
  const before = await fields(perro)
  for (const actor of ['CLIENT2', 'CLIENT3', 'CLIENT_I', 'OWNER', 'OFFICE', 'WALKER_CO', 'OTHER', 'WALKER_IND', 'NOPROFILE', 'ANON']) denied(await editar(actor, perro), actor)
  await exOwner(perro, async (db) => denied(await db.rpc('mi_perro_actualizar', { p_perro: perro, p_nombre: 'Ex' }), 'inactive link'))
  denied(await editar('CLIENT_I', ids.perros.d1), 'a client of another tenant on a tenant A dog')
  denied(await editar('CLIENT', crypto.randomUUID()), 'unknown dog')
  assert.deepEqual(await fields(perro), before, 'nothing changed')
  const gone = await dog({ activo: false })
  denied(await editar('CLIENT', gone), 'a removed dog')
})

test('ME-3: validation is the one of crear_mi_perro (perro_invalido)', async () => {
  const perro = await dog()
  for (const [label, args] of [
    ['empty name', { p_nombre: '   ' }], ['null name', { p_nombre: null }], ['long name', { p_nombre: 'x'.repeat(81) }],
    ['long breed', { p_raza: 'x'.repeat(81) }], ['long tips', { p_tips: 'x'.repeat(1001) }], ['size', { p_tamano: 'gigante' }],
    ['behaviour', { p_conducta: 'mordedor' }], ['sociability', { p_sociabilidad: 'nula' }],
  ]) fails(await editar('CLIENT', perro, args), 'perro_invalido', label)
  assert.equal((await fields(perro)).nombre, 'Datos')
  // No way to reach the business fields through the table either.
  const direct = await (await as('CLIENT')).from('perros').update({ en_celo: true }).eq('id', perro).select('id')
  assert.deepEqual(direct.data ?? [], [], 'direct update reached a row')
  assert.equal((await fields(perro)).en_celo, false)
})

// ---- catalog ----------------------------------------------------------------------------------------------------
test('catalog: the new functions are definer, pinned, closed to anon; the helper is closed to everyone', () => {
  const names = ['incidente_reportar', 'mi_perro_actualizar', 'perro_foto_autorizar', 'perro_foto_confirmar', 'perro_foto_negocio']
  const fns = sql(`select proname, pg_get_function_identity_arguments(oid) as args, prosecdef, coalesce(proconfig @> array['search_path=""'], false) as pinned,
      has_function_privilege('anon', oid, 'execute') as anon, has_function_privilege('authenticated', oid, 'execute') as auth
    from pg_proc where pronamespace = 'public'::regnamespace and proname = any(array[${names.map((n) => `'${n}'`)}]) order by 1`)
  assert.deepEqual(fns.map((f) => [f.proname, f.prosecdef, f.pinned, f.anon, f.auth]), names.map((n) => [n, true, true, false, n !== 'perro_foto_negocio']))
  assert.match(fns[0].args, /p_id uuid/, 'one incidente_reportar, with p_id')
})

// ---- the deployed staging Worker: /p/{perro} ---------------------------------------------------------------------
const FOTOS = (() => { try { return loadConfig().fotosUrl } catch { return undefined } })()
const live = FOTOS ? {} : { skip: 'FOTOS_URL is not set (the staging photo Worker)' }
const token = async (actor) => (await (await as(actor)).auth.getSession()).data.session.access_token
const worker = async (method, perro, actor, body) =>
  fetch(`${FOTOS}/p/${perro}`, { method, body, headers: { authorization: `Bearer ${await token(actor)}`, ...(body && { 'content-type': 'image/jpeg' }) } })

test('PF-W: the Worker stores a dog photo for its owner and serves it to whoever reads the dog', live, async () => {
  const perro = await dog()
  const CLEAN = jpeg({ parts: [APP0, COMMENT], size: 2000 })
  assert.equal((await worker('GET', perro, 'CLIENT')).status, 404, 'no photo yet')
  assert.equal((await worker('PUT', perro, 'WALKER_CO', CLEAN)).status, 403, 'a walker cannot upload')
  const up = await worker('PUT', perro, 'CLIENT', CLEAN)
  assert.equal(up.status, 201, await up.text())
  assert.ok(await fotoAt(perro))
  for (const actor of ['CLIENT', 'COOWNER', 'OWNER', 'OFFICE']) {
    const res = await worker('GET', perro, actor)
    assert.equal(res.status, 200, actor)
    assert.equal(new Uint8Array(await res.arrayBuffer()).length, CLEAN.length, actor)
  }
  for (const actor of ['CLIENT2', 'OTHER', 'CLIENT_I', 'WALKER_CO']) assert.equal((await worker('GET', perro, actor)).status, 404, actor)
})
