// M1 pickup point of a dog (20261102100001_recogida.sql): one point per dog (lat/lng rounded to 5 decimals, an
// optional note of up to 120 characters) in perro_recogida, a table with RLS and no grants: only the RPCs reach it.
//   recogida_guardar / recogida_borrar / recogida_de  an active owner of the active dog, or the owner or office of
//                              its business; anyone else 42501
//   recogida_mis_paseos(desde, hasta)  a walker reads the points of the dogs with a walk assigned to him in his current
//                              business, inside yesterday .. today + 7 (Bogotá); a removed walker reads nothing
// A dog removed (perro_eliminar, a hard delete) loses its point. Throwaway dogs and users only.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, day, ids, seed, tempUser, writePrestaciones } from './_actors.mjs'
import { dropDog } from './_attacks.mjs'
import { sql } from './_sql.mjs'

const u = ids.users
const A = ids.negocios.A
const ok = (res, what) => assert.equal(res.error, null, `${what}: ${res.error?.message}`)
const denied = (res, what = '') => assert.equal(res.error?.code, '42501', `${what} expected 42501, got ${res.error?.code ?? 'no error'} ${res.error?.message ?? ''}`)
const fails = (res, code, what = '') => assert.match(res.error?.message ?? 'no error', new RegExp(code), what)
const created = { dogs: [] }

before(() => seed())
after(async () => {
  for (const dog of created.dogs) await dropDog(dog)
})

// A dog of tenant A with CLIENT as principal and COOWNER as co-owner.
async function dog() {
  const { data, error } = await admin().from('perros').insert({ negocio_id: A, nombre: 'Recogida' }).select('id').single()
  assert.equal(error, null)
  created.dogs.push(data.id)
  ok(await admin().from('perro_duenos').insert([
    { perro_id: data.id, dueno_id: u.CLIENT, rol: 'principal', estado: 'activo' },
    { perro_id: data.id, dueno_id: u.COOWNER, rol: 'co', estado: 'activo' },
  ]), 'links')
  return data.id
}
const POINT = { p_lat: 6.2442031, p_lng: -75.5812119, p_nota: '  Portería torre 2  ' }
const guardar = async (actor, perro, args = POINT) => (await as(actor)).rpc('recogida_guardar', { p_perro: perro, ...args })
const borrar = async (actor, perro) => (await as(actor)).rpc('recogida_borrar', { p_perro: perro })
const de = async (actor, perro) => (await as(actor)).rpc('recogida_de', { p_perro: perro })
const stored = async (perro) => (await admin().from('perro_recogida').select('negocio_id,lat,lng,nota,updated_by').eq('perro_id', perro)).data
const walkRow = (perro, cuidador, spec = {}) => ({
  negocio_id: A, perro_id: perro, tipo: 'paseo', servicio_id: ids.servicios.paseoA, cuidador_id: cuidador,
  fecha: day(0), estado: 'programado', precio_aplicado: 0, detalle: { hora: '09:00' }, ...spec,
})
const misPaseos = (client, desde = day(-1), hasta = day(7)) => client.rpc('recogida_mis_paseos', { p_desde: desde, p_hasta: hasta })

test('RC-1: the principal owner saves and reads the point of its dog (rounded, note trimmed); the co-owner reads it', async () => {
  const d = await dog()
  ok(await guardar('CLIENT', d), 'save')
  assert.deepEqual(await stored(d), [{ negocio_id: A, lat: 6.2442, lng: -75.58121, nota: 'Portería torre 2', updated_by: u.CLIENT }])
  for (const actor of ['CLIENT', 'COOWNER']) {
    const res = await de(actor, d)
    ok(res, actor)
    assert.equal(res.data.length, 1)
    assert.deepEqual([res.data[0].lat, res.data[0].lng, res.data[0].nota], [6.2442, -75.58121, 'Portería torre 2'], actor)
  }
  ok(await guardar('COOWNER', d, { p_lat: 6.25, p_lng: -75.6, p_nota: null }), 'the co-owner replaces it')
  assert.deepEqual((await stored(d)).map((r) => [r.lat, r.lng, r.nota]), [[6.25, -75.6, null]])
  ok(await borrar('CLIENT', d), 'remove')
  assert.deepEqual(await stored(d), [])
  ok(await borrar('CLIENT', d), 'removing nothing is a success')
  assert.deepEqual((await de('CLIENT', d)).data, [])
})

test('RC-2: the owner and the office of the business save, read and remove it', async () => {
  const d = await dog()
  ok(await guardar('OWNER', d), 'owner saves')
  assert.equal((await de('OFFICE', d)).data.length, 1)
  ok(await guardar('OFFICE', d, { p_lat: 4.6, p_lng: -74.08, p_nota: 'Casa' }), 'office saves')
  assert.equal((await stored(d))[0].updated_by, u.OFFICE)
  assert.equal((await de('OWNER', d)).data[0].nota, 'Casa')
  ok(await borrar('OFFICE', d), 'office removes')
  assert.deepEqual(await stored(d), [])
})

for (const actor of ['CLIENT2', 'WALKER_CO', 'OTHER', 'CLIENT_I', 'WALKER_IND', 'NOPROFILE', 'ANON']) {
  test(`RC-3: ${actor} cannot save, read or remove the point of a dog that is not its own`, async () => {
    const d = await dog()
    ok(await guardar('CLIENT', d), 'precondition')
    denied(await guardar(actor, d, { p_lat: 1, p_lng: 1, p_nota: 'x' }), 'save')
    denied(await de(actor, d), 'read')
    denied(await borrar(actor, d), 'remove')
    assert.deepEqual((await stored(d)).map((r) => r.lat), [6.2442], 'the point changed')
  })
}

test('RC-4: an unknown dog, a removed dog and an inactive owner link are refused', async () => {
  denied(await guardar('OWNER', crypto.randomUUID()), 'unknown dog')
  const d = await dog()
  ok(await admin().from('perro_duenos').update({ estado: 'inactivo' }).match({ perro_id: d, dueno_id: u.COOWNER }), 'unlink')
  denied(await guardar('COOWNER', d), 'inactive link')
  denied(await de('COOWNER', d), 'inactive link reads')
  ok(await admin().from('perros').update({ activo: false }).eq('id', d), 'deactivate')
  denied(await guardar('CLIENT', d), 'removed dog')
  denied(await guardar('OWNER', d), 'removed dog (owner)')
})

test('RC-5: out-of-range or missing coordinates and a note over 120 characters are refused; nothing is stored', async () => {
  const d = await dog()
  for (const bad of [
    { p_lat: 90.00001, p_lng: 0 }, { p_lat: -91, p_lng: 0 }, { p_lat: 0, p_lng: 180.5 }, { p_lat: 0, p_lng: -181 },
    { p_lat: null, p_lng: 0 }, { p_lat: 0, p_lng: null }, { p_lat: 'NaN', p_lng: 0 }, { p_lat: 'Infinity', p_lng: 0 },
    { p_lat: 1, p_lng: 1, p_nota: 'x'.repeat(121) },
  ]) {
    fails(await guardar('CLIENT', d, { p_nota: null, ...bad }), 'recogida_invalida', JSON.stringify(bad))
  }
  assert.deepEqual(await stored(d), [])
  ok(await guardar('CLIENT', d, { p_lat: 90, p_lng: -180, p_nota: 'x'.repeat(120) }), 'the limits are valid')
})

test('RC-6: the walker of an assigned walk reads the point; outside the window, cancelled or another walker: nothing', async () => {
  const d = await dog()
  ok(await guardar('CLIENT', d), 'point')
  const { data: [w] } = await writePrestaciones(walkRow(d, u.WALKER_CO))
  const walker = await as('WALKER_CO')
  const res = await misPaseos(walker)
  ok(res, 'mis paseos')
  assert.deepEqual(res.data.filter((r) => r.perro_id === d), [{ perro_id: d, nombre: 'Recogida', lat: 6.2442, lng: -75.58121, nota: 'Portería torre 2' }])
  // The window is capped at yesterday .. today + 7 whatever the caller asks.
  assert.equal((await misPaseos(walker, day(1), day(30))).data.some((r) => r.perro_id === d), false, 'a range that excludes the walk')
  ok(await admin().from('prestaciones').update({ fecha: day(9) }).eq('id', w.id), 'move it out of the window')
  assert.equal((await misPaseos(walker, day(-30), day(30))).data.some((r) => r.perro_id === d), false, 'past today + 7')
  ok(await admin().from('prestaciones').update({ fecha: day(-2) }).eq('id', w.id), 'move it before yesterday')
  assert.equal((await misPaseos(walker, day(-30), day(30))).data.some((r) => r.perro_id === d), false, 'before yesterday')
  ok(await admin().from('prestaciones').update({ fecha: day(1), estado: 'cancelado' }).eq('id', w.id), 'cancel it')
  assert.equal((await misPaseos(walker)).data.some((r) => r.perro_id === d), false, 'a cancelled walk')
  for (const actor of ['WALKER_CO2', 'WALKER_IND', 'OWNER', 'CLIENT']) {
    const r = await misPaseos(await as(actor))
    ok(r, actor)
    assert.equal(r.data.some((x) => x.perro_id === d), false, `${actor} reads the point without a walk`)
  }
  denied(await misPaseos(await as('ANON')), 'anon')
})

test('RC-7: a removed walker reads no point, also of the walks still in his name', async () => {
  const d = await dog()
  ok(await guardar('CLIENT', d), 'point')
  const m = await tempUser()
  try {
    ok(await admin().from('profiles').insert({ id: m.id, negocio_id: A, rol: 'paseador', nombre: 'Temp walker' }), 'profile')
    await writePrestaciones([walkRow(d, m.id, { estado: 'en_curso' }), walkRow(d, m.id, { fecha: day(-1) })])
    assert.equal((await misPaseos(m.client)).data.some((r) => r.perro_id === d), true, 'precondition: a member reads it')
    ok(await (await as('OWNER')).rpc('miembro_dar_de_baja', { p_usuario: m.id }), 'baja')
    const res = await misPaseos(m.client)
    ok(res, 'after the removal')
    assert.deepEqual(res.data, [])
  } finally {
    await admin().from('prestaciones').delete().eq('perro_id', d)
    await m.drop()
  }
})

test('RC-8: no signed-in or anonymous user reads or writes perro_recogida directly', async () => {
  const d = await dog()
  ok(await guardar('CLIENT', d), 'point')
  for (const actor of ['CLIENT', 'OWNER', 'OFFICE', 'WALKER_CO', 'ANON']) {
    const db = await as(actor)
    denied(await db.from('perro_recogida').select('*'), `${actor} select`)
    denied(await db.from('perro_recogida').insert({ perro_id: d, negocio_id: A, lat: 1, lng: 1 }), `${actor} insert`)
    denied(await db.from('perro_recogida').update({ lat: 1 }).eq('perro_id', d), `${actor} update`)
    denied(await db.from('perro_recogida').delete().eq('perro_id', d), `${actor} delete`)
  }
  assert.deepEqual((await stored(d)).map((r) => r.lat), [6.2442])
})

test('RC-9: a dog removed with perro_eliminar or deleted loses its point', async () => {
  const d = await dog()
  ok(await guardar('CLIENT', d), 'point')
  ok(await (await as('OWNER')).rpc('perro_eliminar', { p_id: d }), 'perro_eliminar')
  assert.deepEqual(await stored(d), [])
  const d2 = await dog()
  ok(await guardar('OWNER', d2), 'point 2')
  ok(await admin().from('perros').delete().eq('id', d2), 'hard delete')
  assert.deepEqual(await stored(d2), [])
})

test('RC-10: catalog: RLS on, no table grant to anon or authenticated, definer RPCs pinned and closed to anon', () => {
  const [t] = sql(`select relrowsecurity as rls, has_table_privilege('anon', oid, 'select,insert,update,delete') as anon,
      has_table_privilege('authenticated', oid, 'select,insert,update,delete') as auth
    from pg_class where relnamespace = 'public'::regnamespace and relname = 'perro_recogida'`)
  assert.deepEqual(t, { rls: true, anon: false, auth: false })
  const fns = sql(`select proname, prosecdef, coalesce(proconfig @> array['search_path=""'], false) as pinned,
      has_function_privilege('anon', oid, 'execute') as anon, has_function_privilege('authenticated', oid, 'execute') as auth
    from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'recogida\\_%' or proname = 'perro_recogida_baja') order by 1`)
  assert.deepEqual(fns.map((f) => f.proname), ['perro_recogida_baja', 'recogida_borrar', 'recogida_de', 'recogida_guardar', 'recogida_mis_paseos'])
  for (const f of fns) {
    assert.deepEqual([f.prosecdef, f.pinned, f.anon, f.auth], [true, true, false, f.proname !== 'perro_recogida_baja'], f.proname)
  }
})
