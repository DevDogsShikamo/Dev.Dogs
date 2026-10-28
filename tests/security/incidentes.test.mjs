// Incidents (Ley 2480 de 2025 arts. 15 and 16): incidente_reportar (assigned walker on a walk of today or
// yesterday, or the owner/office of the dog's business), who reads `incidentes`, and the evidence it keeps:
// the photos of that walk where the dog is tagged are retained (paseo_fotos.retener) past the 30-day purge,
// still visible to the dog's owners and the uploader, never to the business owner (same audience as before).
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, ids, seed, writePrestaciones } from './_actors.mjs'
import { sql } from './_sql.mjs'

const u = ids.users
const d = ids.perros
const hoy = (n = 0) => new Date(Date.now() - 5 * 36e5 + n * 864e5).toISOString().slice(0, 10) // Bogota date
const ago = (days) => new Date(Date.now() - days * 864e5).toISOString()
const denied = (res, what = '') => assert.equal(res.error?.code, '42501', `${what} expected 42501, got ${res.error?.code ?? 'no error'} ${res.error?.message ?? ''}`)
const fails = (res, code, what = '') => assert.match(res.error?.message ?? 'no error', new RegExp(code), what)
const created = { walks: [], fotos: [], incidentes: [] }
const DESC = 'Se soltó de la correa en el parque y volvió a los cinco minutos.'

before(() => seed())
after(async () => {
  await admin().from('incidentes').delete().in('id', created.incidentes)
  await admin().from('paseo_fotos').delete().in('id', created.fotos)
  await admin().from('prestaciones').delete().in('id', created.walks)
})

let outing = 0
async function walk(dog = d.d1, spec = {}) {
  const ind = dog === d.dI
  const { data } = await writePrestaciones({
    negocio_id: ind ? ids.negocios.I : ids.negocios.A, perro_id: dog, tipo: 'paseo', servicio_id: ind ? null : ids.servicios.paseoA,
    cuidador_id: ind ? u.WALKER_IND : u.WALKER_CO, fecha: hoy(), estado: 'en_curso', precio_aplicado: 0,
    detalle: { hora: `incidente-${++outing}` }, ...spec,
  })
  created.walks.push(data[0].id)
  return data[0].id
}
const reportar = async (actor, perro, prestacion = null, tipo = 'perdida', descripcion = DESC) =>
  (await as(actor)).rpc('incidente_reportar', { p_perro: perro, p_prestacion: prestacion, p_tipo: tipo, p_descripcion: descripcion })
async function reporta(actor, ...args) {
  const res = await reportar(actor, ...args)
  assert.equal(res.error, null, `${actor}: ${res.error?.message}`)
  created.incidentes.push(res.data)
  return res.data
}
// A photo as the Worker leaves it (registered, authorized, confirmed by the walker).
async function listo(ps) {
  const db = await as('WALKER_CO')
  const id = (await db.rpc('foto_registrar', { p_prestaciones: ps })).data
  assert.ok(id)
  created.fotos.push(id)
  assert.equal((await db.rpc('foto_subida_autorizar', { p_id: id })).error, null)
  assert.equal((await db.rpc('foto_confirmar', { p_id: id, p_bytes: 100 })).error, null)
  return id
}
// A ready photo `days` old (service role), tagged with a fresh walk of `perro`.
async function viejo(days, { retener = false, perro = d.d1 } = {}) {
  const id = crypto.randomUUID()
  created.fotos.push(id)
  const row = { id, negocio_id: ids.negocios.A, subido_por: u.WALKER_CO, estado: 'lista', bytes: 10, created_at: ago(days), expires_at: ago(days - 30), retener }
  assert.equal((await admin().from('paseo_fotos').insert(row)).error, null)
  const p = await walk(perro)
  assert.equal((await admin().from('paseo_foto_perros').insert({ foto_id: id, prestacion_id: p, perro_id: perro, subido_por: u.WALKER_CO })).error, null)
  return id
}
const retenida = async (id) => (await admin().from('paseo_fotos').select('retener').eq('id', id).single()).data?.retener
const sees = async (actor, table, id) => {
  const res = await (await as(actor)).from(table).select('id').eq('id', id)
  return res.error ? res.error.code : res.data.map((r) => r.id)
}

// ---- who may report ---------------------------------------------------------------------------------
test('the assigned walker reports on his walk of today or yesterday; the owner and office of the business on any dog of it', async () => {
  const today = await walk(d.d1)
  const yesterday = await walk(d.d1, { estado: 'finalizado', fecha: hoy(-1) })
  await reporta('WALKER_CO', d.d1, today)
  await reporta('WALKER_CO', d.d1, yesterday, 'lesion')
  for (const actor of ['OWNER', 'OFFICE', 'OFFICE_FIN']) await reporta(actor, d.d3, null, 'salud')
  await reporta('OFFICE', d.d1, await walk(d.d1, { estado: 'finalizado', fecha: hoy(-9) }), 'pelea') // any date for the business
  await reporta('WALKER_IND', d.dI, null, 'otro') // the independent walker owns tenant I
  const row = (await admin().from('incidentes').select('*').eq('id', created.incidentes[0]).single()).data
  assert.deepEqual([row.negocio_id, row.perro_id, row.prestacion_id, row.tipo, row.descripcion, row.reportado_por],
    [ids.negocios.A, d.d1, today, 'perdida', DESC, u.WALKER_CO])
})

test('nobody else reports: another walker, an old walk, a client, another tenant, no profile, anon', async () => {
  const mine = await walk(d.d1)
  denied(await reportar('WALKER_CO2', d.d1, mine), 'another walker of the business')
  denied(await reportar('WALKER_CO', d.d1, null), 'a walker without his walk')
  denied(await reportar('WALKER_CO', d.d3, mine), 'a walker naming another dog')
  denied(await reportar('WALKER_CO', d.d1, await walk(d.d1, { estado: 'finalizado', fecha: hoy(-2) })), 'two days ago')
  denied(await reportar('WALKER_CO', d.d1, await walk(d.d1, { estado: 'programado', fecha: hoy(1) })), 'tomorrow')
  denied(await reportar('WALKER_CO', d.d1, await walk(d.d1, { cuidador_id: u.WALKER_CO2 })), 'a walk of another walker')
  for (const actor of ['CLIENT', 'COOWNER', 'CLIENT2', 'OTHER', 'WALKER_IND', 'CLIENT_I', 'NOPROFILE', 'ANON']) denied(await reportar(actor, d.d1, null), actor)
  denied(await reportar('OTHER', d.d1, mine), 'another tenant with the walk id')
  denied(await reportar('OWNER', d.dI, null), 'a dog of another tenant')
  denied(await reportar('OWNER', crypto.randomUUID(), null), 'unknown dog')
})

test('validation: type, 10..2000 characters, and a walk of that same dog', async () => {
  const p = await walk(d.d1)
  for (const [label, args] of [
    ['unknown type', [d.d1, p, 'robo']], ['null type', [d.d1, p, null]], ['short', [d.d1, p, 'perdida', 'corto']],
    ['blank padded', [d.d1, p, 'perdida', '         x         ']], ['too long', [d.d1, p, 'perdida', 'x'.repeat(2001)]], ['null text', [d.d1, p, 'perdida', null]],
  ]) fails(await reportar('WALKER_CO', ...args), 'incidente_invalido', label)
  fails(await reportar('OWNER', d.d3, p), 'incidente_invalido', 'the walk is of another dog')
  fails(await reportar('OWNER', d.d1, crypto.randomUUID()), 'incidente_invalido', 'unknown walk')
  await reporta('WALKER_CO', d.d1, p, 'fallecimiento', 'x'.repeat(2000))
})

// ---- who reads ---------------------------------------------------------------------------------------
test('an incident is read by the business owner and office, the active owners of the dog and its reporter only', async () => {
  const id = await reporta('WALKER_CO', d.d1, await walk(d.d1))
  for (const actor of ['OWNER', 'OFFICE', 'OFFICE_FIN', 'CLIENT', 'COOWNER', 'WALKER_CO']) assert.deepEqual(await sees(actor, 'incidentes', id), [id], actor)
  for (const actor of ['WALKER_CO2', 'CLIENT2', 'CLIENT3', 'OTHER', 'WALKER_IND', 'CLIENT_I', 'NOPROFILE']) assert.deepEqual(await sees(actor, 'incidentes', id), [], actor)
  denied(await (await as('ANON')).from('incidentes').select('id'), 'ANON')
  for (const actor of ['WALKER_CO', 'OWNER', 'CLIENT']) {
    const db = await as(actor)
    denied(await db.from('incidentes').insert({ negocio_id: ids.negocios.A, perro_id: d.d1, tipo: 'otro', descripcion: DESC, reportado_por: u[actor] }), `${actor} insert`)
    denied(await db.from('incidentes').update({ descripcion: DESC + ' editado' }).eq('id', id), `${actor} update`)
    denied(await db.from('incidentes').delete().eq('id', id), `${actor} delete`)
  }
})

// ---- evidence: retained photos -----------------------------------------------------------------------
test('reporting retains the photos of that walk where the dog is tagged, and nothing else', async () => {
  const p = await walk(d.d1)
  const q = await walk(d.d3)
  const both = await listo([p, q])
  const other = await listo([q])
  const otherWalk = await listo([await walk(d.d1)])
  await reporta('WALKER_CO', d.d1, p, 'lesion')
  assert.deepEqual([await retenida(both), await retenida(other), await retenida(otherWalk)], [true, false, false])
  // The business owner reporting on d3 of walk q retains `other` too.
  const inc = await reporta('OWNER', d.d3, q, 'pelea')
  assert.deepEqual([await retenida(both), await retenida(other)], [true, true])
  // The Worker asks for the keys to copy with the reporter's or the business's token, never a client's.
  const keys = (await (await as('OWNER')).rpc('foto_retencion_autorizar', { p_incidente: inc })).data
  assert.deepEqual([...keys].sort(), [both, other].map((f) => `f/${ids.negocios.A}/${f}.jpg`).sort())
  for (const actor of ['CLIENT2', 'WALKER_CO2', 'OTHER', 'ANON']) denied(await (await as(actor)).rpc('foto_retencion_autorizar', { p_incidente: inc }), actor)
  denied(await (await as('OWNER')).rpc('foto_retencion_autorizar', { p_incidente: crypto.randomUUID() }), 'unknown incident')
  const sinFoto = await reporta('WALKER_IND', d.dI, null, 'salud')
  assert.deepEqual((await (await as('WALKER_IND')).rpc('foto_retencion_autorizar', { p_incidente: sinFoto })).data, [])
})

test('the purge (daily job and on registration) keeps retained photos and still removes expired ones', async () => {
  const kept = await viejo(31, { retener: true })
  const gone = await viejo(31)
  sql('select public.fotos_purgar_vencidas()')
  assert.deepEqual((await admin().from('paseo_fotos').select('id').in('id', [kept, gone])).data.map((r) => r.id), [kept])
  const gone2 = await viejo(31)
  const db = await as('WALKER_CO')
  const fresh = (await db.rpc('foto_registrar', { p_prestaciones: [await walk(d.d1)] })).data
  created.fotos.push(fresh)
  assert.deepEqual((await admin().from('paseo_fotos').select('id').in('id', [kept, gone2])).data.map((r) => r.id), [kept])
})

test('after expiry a retained photo stays visible to the dog owners and the uploader, never to the business', async () => {
  const id = await viejo(31, { retener: true })
  for (const actor of ['CLIENT', 'COOWNER', 'WALKER_CO']) assert.deepEqual(await sees(actor, 'paseo_fotos', id), [id], actor)
  for (const actor of ['OWNER', 'OFFICE', 'CLIENT2', 'WALKER_CO2', 'OTHER']) assert.deepEqual(await sees(actor, 'paseo_fotos', id), [], actor)
  const expired = await viejo(31)
  assert.deepEqual(await sees('CLIENT', 'paseo_fotos', expired), [], 'an expired photo that is not retained stays hidden')
})

test('catalog: incidentes has RLS, the new functions are definer, pinned, closed to anon and open to authenticated', () => {
  const names = ['foto_retencion_autorizar', 'incidente_reportar']
  const fns = sql(`select proname, prosecdef, coalesce(proconfig @> array['search_path=""'], false) as pinned,
      has_function_privilege('anon', oid, 'execute') as anon, has_function_privilege('authenticated', oid, 'execute') as auth
    from pg_proc where pronamespace = 'public'::regnamespace and proname = any(array[${names.map((n) => `'${n}'`)}]) order by 1`)
  assert.deepEqual(fns.map((f) => [f.proname, f.prosecdef, f.pinned, f.anon, f.auth]), names.map((n) => [n, true, true, false, true]))
  assert.deepEqual(sql(`select relrowsecurity from pg_class where oid = 'public.incidentes'::regclass`), [{ relrowsecurity: true }])
})
