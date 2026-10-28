// Reporting a walk photo (Ley 1581 art. 7: a person or a minor in it): foto_reportar is for the active owners
// of a tagged dog. A photo that is not incident evidence is deleted for everyone; a retained one is hidden
// (paseo_fotos.oculta) from clients and the uploader and kept for the business owner and office. The report
// itself (fotos_reportes) is read by its author and the business owner and office.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, ids, seed, writePrestaciones } from './_actors.mjs'
import { sql } from './_sql.mjs'

const u = ids.users
const d = ids.perros
const hoy = () => new Date(Date.now() - 5 * 36e5).toISOString().slice(0, 10) // Bogota date
const denied = (res, what = '') => assert.equal(res.error?.code, '42501', `${what} expected 42501, got ${res.error?.code ?? 'no error'} ${res.error?.message ?? ''}`)
const created = { walks: [], fotos: [], incidentes: [] }

before(() => seed())
after(async () => {
  await admin().from('fotos_reportes').delete().in('foto_id', created.fotos)
  await admin().from('incidentes').delete().in('id', created.incidentes)
  await admin().from('paseo_fotos').delete().in('id', created.fotos)
  await admin().from('prestaciones').delete().in('id', created.walks)
})

let outing = 0
async function walk(dog) {
  const { data } = await writePrestaciones({
    negocio_id: ids.negocios.A, perro_id: dog, tipo: 'paseo', servicio_id: ids.servicios.paseoA, cuidador_id: u.WALKER_CO,
    fecha: hoy(), estado: 'en_curso', precio_aplicado: 0, detalle: { hora: `reporte-${++outing}` },
  })
  created.walks.push(data[0].id)
  return data[0].id
}
// A ready photo of WALKER_CO tagged d1 and d3; with `incidente` the walker reports d1 first (retained photo).
async function foto({ incidente = false } = {}) {
  const p = await walk(d.d1)
  const db = await as('WALKER_CO')
  const id = (await db.rpc('foto_registrar', { p_prestaciones: [p, await walk(d.d3)] })).data
  assert.ok(id)
  created.fotos.push(id)
  assert.equal((await db.rpc('foto_subida_autorizar', { p_id: id })).error, null)
  assert.equal((await db.rpc('foto_confirmar', { p_id: id, p_bytes: 100 })).error, null)
  if (incidente) {
    const inc = await db.rpc('incidente_reportar', { p_perro: d.d1, p_prestacion: p, p_tipo: 'lesion', p_descripcion: 'Se lastimó una pata al bajar la escalera.' })
    assert.equal(inc.error, null, inc.error?.message)
    created.incidentes.push(inc.data)
  }
  return id
}
const reportar = async (actor, id, motivo = 'aparece_persona') => (await as(actor)).rpc('foto_reportar', { p_foto: id, p_motivo: motivo })
const sees = async (actor, id) => {
  const res = await (await as(actor)).from('paseo_fotos').select('id').eq('id', id)
  return res.error ? res.error.code : res.data.map((r) => r.id)
}

test('only an active owner of a tagged dog reports a photo, with one of the three reasons', async () => {
  const id = await foto()
  for (const actor of ['WALKER_CO', 'OWNER', 'OFFICE', 'WALKER_CO2', 'CLIENT3', 'OTHER', 'CLIENT_I', 'NOPROFILE', 'ANON']) denied(await reportar(actor, id), actor)
  denied(await reportar('CLIENT', crypto.randomUUID()), 'unknown photo')
  for (const motivo of ['otra_cosa', '', null]) assert.match((await reportar('CLIENT', id, motivo)).error?.message ?? 'no error', /reporte_invalido/, String(motivo))
  assert.deepEqual(await sees('CLIENT', id), [id], 'nothing changed yet')
})

test('a photo that is not evidence is deleted for everyone, its tags with it, and the report is kept', async () => {
  const id = await foto()
  assert.equal((await reportar('CLIENT2', id, 'aparece_menor')).error, null) // CLIENT2 owns d3, the other tagged dog
  assert.deepEqual((await admin().from('paseo_fotos').select('id').eq('id', id)).data, [])
  assert.deepEqual((await admin().from('paseo_foto_perros').select('foto_id').eq('foto_id', id)).data, [])
  for (const actor of ['CLIENT', 'COOWNER', 'WALKER_CO']) assert.deepEqual(await sees(actor, id), [], actor)
  const [r] = (await admin().from('fotos_reportes').select('*').eq('foto_id', id)).data
  assert.deepEqual([r.reportado_por, r.motivo, r.negocio_id], [u.CLIENT2, 'aparece_menor', ids.negocios.A])
})

test('a retained photo is hidden from clients and the uploader and kept for the business owner and office', async () => {
  const id = await foto({ incidente: true })
  assert.deepEqual(await sees('OWNER', id), [], 'before the report the business does not see photos')
  assert.equal((await reportar('CLIENT', id, 'aparece_persona')).error, null)
  assert.deepEqual((await admin().from('paseo_fotos').select('oculta, retener').eq('id', id).single()).data, { oculta: true, retener: true })
  for (const actor of ['CLIENT', 'COOWNER', 'CLIENT2', 'WALKER_CO']) assert.deepEqual(await sees(actor, id), [], actor)
  for (const actor of ['OWNER', 'OFFICE']) assert.deepEqual(await sees(actor, id), [id], actor)
  for (const actor of ['OTHER', 'WALKER_CO2', 'WALKER_IND']) assert.deepEqual(await sees(actor, id), [], actor)
  denied(await reportar('COOWNER', id), 'a hidden photo cannot be reported again')
})

test('a report is read by its author and the business owner and office; nobody writes it directly', async () => {
  const id = await foto()
  assert.equal((await reportar('COOWNER', id, 'otro')).error, null)
  const rows = async (actor) => {
    const res = await (await as(actor)).from('fotos_reportes').select('foto_id, motivo').eq('foto_id', id)
    return res.error ? res.error.code : res.data
  }
  for (const actor of ['COOWNER', 'OWNER', 'OFFICE']) assert.deepEqual(await rows(actor), [{ foto_id: id, motivo: 'otro' }], actor)
  for (const actor of ['CLIENT', 'CLIENT2', 'WALKER_CO', 'OTHER', 'WALKER_IND']) assert.deepEqual(await rows(actor), [], actor)
  denied(await (await as('ANON')).from('fotos_reportes').select('id'), 'ANON')
  for (const actor of ['CLIENT', 'OWNER']) {
    const db = await as(actor)
    denied(await db.from('fotos_reportes').insert({ foto_id: id, negocio_id: ids.negocios.A, reportado_por: u[actor], motivo: 'otro' }), `${actor} insert`)
    denied(await db.from('fotos_reportes').delete().eq('foto_id', id), `${actor} delete`)
  }
})

test('catalog: fotos_reportes has RLS, foto_reportar is definer, pinned, closed to anon and open to authenticated', () => {
  const [f] = sql(`select prosecdef, coalesce(proconfig @> array['search_path=""'], false) as pinned,
      has_function_privilege('anon', oid, 'execute') as anon, has_function_privilege('authenticated', oid, 'execute') as auth
    from pg_proc where pronamespace = 'public'::regnamespace and proname = 'foto_reportar'`)
  assert.deepEqual(f, { prosecdef: true, pinned: true, anon: false, auth: true })
  assert.deepEqual(sql(`select relrowsecurity from pg_class where oid = 'public.fotos_reportes'::regclass`), [{ relrowsecurity: true }])
})
