// F1 agenda: recurring groups own their future walks.
//   grupo_agregar_perro / grupo_quitar_perro  a dog joins (with its weekdays) or leaves a group; its walks follow
//   agenda_extender                          the daily pg_cron job keeps every membership 57 days ahead
//   grupo_asignar / grupo_actualizar / grupo_eliminar  walker, hour, service and deletion reach the future walks
//   prestacion_asignar                       a booking without a group gets an assignee who can run it
// "Future" = after today, or today at a later hour, still programado and not paid. Each test builds a throwaway
// group and dogs in tenant A (hours no fixture uses), so the seeded fixtures stay untouched.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, day, ids, seed, writePrestaciones } from './_actors.mjs'
import { sql } from './_sql.mjs'

const { A, I } = ids.negocios
const u = ids.users
const { paseoA, banoA } = ids.servicios
const db = () => admin()
const made = { grupos: [], perros: [] }

before(() => seed(), { timeout: 120_000 })
after(async () => {
  await db().from('prestaciones').delete().in('perro_id', made.perros)
  await db().from('prestaciones').delete().in('grupo_id', made.grupos)
  await db().from('grupo_membresias').delete().in('grupo_id', made.grupos)
  await db().from('grupos').delete().in('id', made.grupos)
  await db().from('perros').delete().in('id', made.perros)
})

let horaN = 0
// A group at an hour of its own (05:00-05:59, unused by the fixtures), so the 8-dog cap is per test.
async function grupo(over = {}) {
  const hora = over.hora ?? `05:${String(horaN++).padStart(2, '0')}`
  const { data, error } = await db().from('grupos').insert({
    negocio_id: A, nombre: 'Agenda test', zona: 'Norte', servicio_id: paseoA, cuidador_id: u.WALKER_CO, hora, duracion_min: 60, ...over,
  }).select('*').single()
  assert.equal(error, null, error?.message)
  made.grupos.push(data.id)
  return data
}
async function perros(n, negocio_id = A) {
  const { data, error } = await db().from('perros')
    .insert(Array.from({ length: n }, (_, i) => ({ negocio_id, nombre: `Agenda ${i + 1}`, activo: true }))).select('id')
  assert.equal(error, null, error?.message)
  made.perros.push(...data.map((d) => d.id))
  return data.map((d) => d.id)
}
const rpc = async (actor, name, args) => (await as(actor)).rpc(name, args)
const walks = async (match) => (await db().from('prestaciones').select('*, cobros(precio_aplicado, cobrado)').match(match).order('fecha')).data
const membership = async (grupo_id, perro_id) =>
  (await db().from('grupo_membresias').select('*').match({ grupo_id, perro_id }).maybeSingle()).data

// isodow (1 = Monday .. 7 = Sunday) of a YYYY-MM-DD date.
const isodow = (f) => new Date(`${f}T12:00:00Z`).getUTCDay() || 7
// The dates in today..today+56 whose weekday is in `dias` (all of them when null). Group hours here are
// later than now only for '23:59', so the tests that count use that hour (and skip today when it passed).
const horizon = (dias = null, hora = '23:59') => {
  const now = new Date(Date.now() - 5 * 36e5).toISOString().slice(11, 16)
  return Array.from({ length: 57 }, (_, i) => day(i)).filter((f, i) => (i > 0 || hora > now) && (!dias || dias.includes(isodow(f))))
}

// One group walk of every kind the propagation must (not) touch, for `perro` in `g`.
async function history(g, perro) {
  const base = {
    negocio_id: A, perro_id: perro, tipo: 'paseo', servicio_id: paseoA, grupo_id: g.id, cuidador_id: g.cuidador_id,
    precio_aplicado: 20000, cobrable: true, cobrado: false, detalle: { hora: g.hora },
  }
  const spec = {
    past: { ...base, fecha: day(-2), estado: 'finalizado' },
    earlierToday: { ...base, fecha: day(0), estado: 'programado', detalle: { hora: '00:00' } },
    inProgress: { ...base, fecha: day(3), estado: 'en_curso' },
    paid: { ...base, fecha: day(4), estado: 'programado', cobrado: true },
    cancelled: { ...base, fecha: day(5), estado: 'cancelado' },
    future: { ...base, fecha: day(6), estado: 'programado' },
  }
  const { data } = await writePrestaciones(Object.values(spec))
  return Object.fromEntries(Object.keys(spec).map((k, i) => [k, data[i]]))
}
const row = async (id) => (await db().from('prestaciones').select('*').eq('id', id).maybeSingle()).data
async function unchanged(rows, names) {
  for (const n of names) assert.deepEqual(await row(rows[n].id), rows[n], `${n} was altered or deleted`)
}

// ---- 1. grupo_agregar_perro / grupo_quitar_perro --------------------------------------------------------
for (const actor of ['OWNER', 'OFFICE']) {
  test(`${actor} adds a dog to a group: membership + every walk of the horizon, priced from the catalogue`, async () => {
    const g = await grupo({ hora: '23:59', cuidador_id: u.WALKER_CO2 })
    const [d] = await perros(1)
    const res = await rpc(actor, 'grupo_agregar_perro', { p_grupo: g.id, p_perro: d })
    assert.equal(res.error, null, res.error?.message)
    assert.equal(res.data, 0, 'no date was full')
    const m = await membership(g.id, d)
    assert.deepEqual({ activo: m.activo, rec: m.recurrencia }, { activo: true, rec: { tipo: 'diario' } })
    const w = await walks({ perro_id: d, grupo_id: g.id })
    assert.deepEqual(w.map((x) => x.fecha), horizon())
    for (const x of w) {
      assert.deepEqual(
        { estado: x.estado, cuidador: x.cuidador_id, tipo: x.tipo, servicio: x.servicio_id, hora: x.detalle.hora, precio: x.cobros.precio_aplicado },
        { estado: 'programado', cuidador: u.WALKER_CO2, tipo: 'paseo', servicio: paseoA, hora: '23:59', precio: 20000 },
      )
    }
  })
}

test('weekdays: Mon-Fri and custom days are stored on the membership and honoured by the walks', async () => {
  const g = await grupo({ hora: '23:59' })
  const [d1, d2] = await perros(2)
  assert.equal((await rpc('OWNER', 'grupo_agregar_perro', { p_grupo: g.id, p_perro: d1, p_dias: [1, 2, 3, 4, 5] })).error, null)
  assert.equal((await rpc('OWNER', 'grupo_agregar_perro', { p_grupo: g.id, p_perro: d2, p_dias: [5, 1, 3, 3] })).error, null)
  assert.deepEqual((await membership(g.id, d1)).recurrencia, { tipo: 'semanal', dias: ['lun', 'mar', 'mie', 'jue', 'vie'] })
  assert.deepEqual((await membership(g.id, d2)).recurrencia, { tipo: 'semanal', dias: ['lun', 'mie', 'vie'] })
  assert.deepEqual((await walks({ perro_id: d1, grupo_id: g.id })).map((x) => x.fecha), horizon([1, 2, 3, 4, 5]))
  assert.deepEqual((await walks({ perro_id: d2, grupo_id: g.id })).map((x) => x.fecha), horizon([1, 3, 5]))

  // Editing the days: dates no longer covered lose their future walk, new ones are added.
  assert.equal((await rpc('OWNER', 'grupo_agregar_perro', { p_grupo: g.id, p_perro: d2, p_dias: [2] })).error, null)
  assert.deepEqual((await walks({ perro_id: d2, grupo_id: g.id })).map((x) => x.fecha), horizon([2]))
})

for (const [p_dias, why] of [[[], 'no day'], [[0], 'day 0'], [[8], 'day 8'], [[1, null], 'a null day']]) {
  test(`grupo_agregar_perro rejects ${why}`, async () => {
    const g = await grupo()
    const [d] = await perros(1)
    const res = await rpc('OWNER', 'grupo_agregar_perro', { p_grupo: g.id, p_perro: d, p_dias })
    assert.match(res.error?.message ?? '', /dias_invalidos/)
    assert.equal(await membership(g.id, d), null)
  })
}

test('grupo_agregar_perro rejects a dog of another tenant or an inactive dog, and an inactive group', async () => {
  const g = await grupo()
  for (const p_perro of [ids.perros.dB, ids.perros.dI]) {
    assert.match((await rpc('OWNER', 'grupo_agregar_perro', { p_grupo: g.id, p_perro })).error?.message ?? '', /perro_invalido/)
  }
  const [d] = await perros(1)
  await db().from('perros').update({ activo: false }).eq('id', d)
  assert.match((await rpc('OWNER', 'grupo_agregar_perro', { p_grupo: g.id, p_perro: d })).error?.message ?? '', /perro_invalido/)
  const off = await grupo({ activo: false })
  const [d2] = await perros(1)
  assert.match((await rpc('OWNER', 'grupo_agregar_perro', { p_grupo: off.id, p_perro: d2 })).error?.message ?? '', /grupo_invalido/)
  assert.equal((await walks({ perro_id: d2 })).length, 0)
})

for (const actor of ['CLIENT', 'WALKER_CO', 'OTHER', 'WALKER_IND', 'NOPROFILE', 'ANON']) {
  test(`${actor} cannot add or remove a dog of a tenant A group`, async () => {
    const g = await grupo()
    const [d, e] = await perros(2)
    await db().from('grupo_membresias').insert({ grupo_id: g.id, perro_id: e })
    const add = await rpc(actor, 'grupo_agregar_perro', { p_grupo: g.id, p_perro: d })
    assert.equal(add.error?.code, '42501', `add: got ${add.error?.code ?? 'no error'}`)
    assert.equal(await membership(g.id, d), null)
    assert.equal((await walks({ perro_id: d })).length, 0)
    const quitar = await rpc(actor, 'grupo_quitar_perro', { p_grupo: g.id, p_perro: e })
    assert.equal(quitar.error?.code, '42501', `remove: got ${quitar.error?.code ?? 'no error'}`)
    assert.equal((await membership(g.id, e)).activo, true)
  })
}

test('grupo_quitar_perro deactivates the membership and deletes only its future programado unpaid walks', async () => {
  const g = await grupo()
  const [d, other] = await perros(2)
  await db().from('grupo_membresias').insert([{ grupo_id: g.id, perro_id: d }, { grupo_id: g.id, perro_id: other }])
  const rows = await history(g, d)
  const kept = await history(g, other)
  const res = await rpc('OFFICE', 'grupo_quitar_perro', { p_grupo: g.id, p_perro: d })
  assert.equal(res.error, null, res.error?.message)
  assert.equal((await membership(g.id, d)).activo, false)
  assert.equal(await row(rows.future.id), null, 'the future walk survived')
  await unchanged(rows, ['past', 'earlierToday', 'inProgress', 'paid', 'cancelled'])
  await unchanged(kept, Object.keys(kept))
})

test('a dog added again after being removed gets its membership and walks back', async () => {
  const g = await grupo({ hora: '23:59' })
  const [d] = await perros(1)
  assert.equal((await rpc('OWNER', 'grupo_agregar_perro', { p_grupo: g.id, p_perro: d })).error, null)
  assert.equal((await rpc('OWNER', 'grupo_quitar_perro', { p_grupo: g.id, p_perro: d })).error, null)
  assert.equal((await walks({ perro_id: d, grupo_id: g.id })).length, 0)
  assert.equal((await rpc('OWNER', 'grupo_agregar_perro', { p_grupo: g.id, p_perro: d, p_dias: [6, 7] })).error, null)
  assert.equal((await membership(g.id, d)).activo, true)
  assert.deepEqual((await walks({ perro_id: d, grupo_id: g.id })).map((x) => x.fecha), horizon([6, 7]))
})

// ---- 3. agenda_extender (pg_cron) -----------------------------------------------------------------------
test('agenda_extender is internal: empty search_path, not executable by anon or authenticated', async () => {
  const rows = sql(`select proname, coalesce(proconfig @> array['search_path=""'], false) as pinned,
                           has_function_privilege('anon', oid, 'execute') as anon,
                           has_function_privilege('authenticated', oid, 'execute') as auth
                    from pg_proc where pronamespace = 'public'::regnamespace
                      and proname in ('agenda_extender', 'agenda_materializar', 'agenda_editable') order by 1`)
  assert.deepEqual(rows.map((r) => r.proname), ['agenda_editable', 'agenda_extender', 'agenda_materializar'])
  for (const r of rows) assert.deepEqual({ f: r.proname, pinned: r.pinned, anon: r.anon, auth: r.auth }, { f: r.proname, pinned: true, anon: false, auth: false })
  for (const actor of ['OWNER', 'ANON']) assert.equal((await rpc(actor, 'agenda_extender', {})).error?.code, '42501', actor)
})

test('agenda_extender is scheduled daily with pg_cron as dd_agenda_extender', () => {
  const rows = sql(`select schedule, command, active from cron.job where jobname = 'dd_agenda_extender'`)
  assert.deepEqual(rows, [{ schedule: '0 6 * * *', command: 'select public.agenda_extender()', active: true }])
})

test('agenda_extender fills the horizon, priced from the catalogue, is idempotent and skips inactive groups', async () => {
  const g = await grupo({ hora: '23:59' })
  const off = await grupo({ hora: '23:59', activo: false })
  const [d, e] = await perros(2)
  await db().from('grupo_membresias').insert([
    { grupo_id: g.id, perro_id: d, recurrencia: { tipo: 'semanal', dias: ['mar', 'jue'] } },
    { grupo_id: off.id, perro_id: e, recurrencia: { tipo: 'diario' } },
  ])
  const first = await db().rpc('agenda_extender')
  assert.equal(first.error, null, first.error?.message)
  const w = await walks({ perro_id: d, grupo_id: g.id })
  assert.deepEqual(w.map((x) => x.fecha), horizon([2, 4]))
  for (const x of w) assert.equal(x.cobros.precio_aplicado, 20000, 'the cron walk is not priced from the catalogue')
  assert.equal((await walks({ perro_id: e })).length, 0, 'an inactive group was extended')

  // A deleted tail is refilled, the rest is not duplicated.
  await db().from('prestaciones').delete().eq('perro_id', d).gt('fecha', day(20))
  assert.equal((await db().rpc('agenda_extender')).error, null)
  assert.deepEqual((await walks({ perro_id: d, grupo_id: g.id })).map((x) => x.fecha), horizon([2, 4]))
  assert.equal((await db().rpc('agenda_extender')).error, null)
  assert.equal((await walks({ perro_id: d, grupo_id: g.id })).length, horizon([2, 4]).length)
})

test('agenda_extender never re-creates a date that already holds a walk of that dog and group (a cancelled one too)', async () => {
  const g = await grupo({ hora: '23:59' })
  const [d] = await perros(1)
  await db().from('grupo_membresias').insert({ grupo_id: g.id, perro_id: d })
  await writePrestaciones({ negocio_id: A, perro_id: d, tipo: 'paseo', servicio_id: paseoA, grupo_id: g.id, cuidador_id: u.WALKER_CO, fecha: day(9), estado: 'cancelado', detalle: { hora: '23:59' } })
  assert.equal((await db().rpc('agenda_extender')).error, null)
  const on9 = (await walks({ perro_id: d, grupo_id: g.id })).filter((x) => x.fecha === day(9))
  assert.deepEqual(on9.map((x) => x.estado), ['cancelado'])
})

test('agenda_extender skips a full outing (8 dogs) and goes on with the other dates and memberships', async () => {
  const g = await grupo({ cuidador_id: u.WALKER_CO2 })
  const fill = await perros(8)
  const [d, e] = await perros(2)
  await writePrestaciones(fill.map((perro_id) => ({
    negocio_id: A, perro_id, tipo: 'paseo', cuidador_id: u.WALKER_CO2, fecha: day(20), estado: 'programado', detalle: { hora: g.hora },
  })))
  await db().from('grupo_membresias').insert([{ grupo_id: g.id, perro_id: d }, { grupo_id: g.id, perro_id: e }])
  const res = await db().rpc('agenda_extender')
  assert.equal(res.error, null, res.error?.message)
  for (const perro of [d, e]) {
    const fechas = (await walks({ perro_id: perro, grupo_id: g.id })).map((x) => x.fecha)
    assert.ok(!fechas.includes(day(20)), 'a walk was added to a full outing')
    assert.deepEqual(fechas, horizon(null, g.hora).filter((f) => f !== day(20)))
  }
})

test('grupo_agregar_perro reports the dates it could not book because the outing was full', async () => {
  const g = await grupo({ cuidador_id: u.WALKER_CO2 })
  const fill = await perros(8)
  const [d] = await perros(1)
  await writePrestaciones(fill.flatMap((perro_id) => [day(10), day(11)].map((fecha) => ({
    negocio_id: A, perro_id, tipo: 'paseo', cuidador_id: u.WALKER_CO2, fecha, estado: 'programado', detalle: { hora: g.hora },
  }))))
  const res = await rpc('OWNER', 'grupo_agregar_perro', { p_grupo: g.id, p_perro: d })
  assert.equal(res.error, null, res.error?.message)
  assert.equal(res.data, 2)
  assert.equal((await membership(g.id, d)).activo, true)
  const fechas = (await walks({ perro_id: d, grupo_id: g.id })).map((x) => x.fecha)
  assert.ok(!fechas.includes(day(10)) && !fechas.includes(day(11)) && fechas.includes(day(12)))
})

// ---- 4. propagation --------------------------------------------------------------------------------------
test('grupo_asignar re-stamps the walker only on future programado unpaid walks of the group', async () => {
  const g = await grupo()
  const [d] = await perros(1)
  const rows = await history(g, d)
  assert.equal((await rpc('OFFICE', 'grupo_asignar', { p_grupo: g.id, p_cuidador: u.WALKER_CO2 })).error, null)
  assert.equal((await row(rows.future.id)).cuidador_id, u.WALKER_CO2)
  await unchanged(rows, ['past', 'earlierToday', 'inProgress', 'paid', 'cancelled'])
})

test('grupo_actualizar updates the group and re-stamps hour, service, type and price on future walks only', async () => {
  const g = await grupo()
  const [d] = await perros(1)
  const rows = await history(g, d)
  const res = await rpc('OWNER', 'grupo_actualizar', {
    p_grupo: g.id, p_nombre: 'Agenda renombrada', p_hora: '21:15', p_servicio: banoA, p_duracion: 45, p_zona: 'Sur', p_color: 'green',
  })
  assert.equal(res.error, null, res.error?.message)
  const after = (await db().from('grupos').select('nombre,hora,servicio_id,duracion_min,zona,color').eq('id', g.id).single()).data
  assert.deepEqual(after, { nombre: 'Agenda renombrada', hora: '21:15', servicio_id: banoA, duracion_min: 45, zona: 'Sur', color: 'green' })
  const f = (await walks({ id: rows.future.id }))[0]
  assert.deepEqual(
    { hora: f.detalle.hora, servicio: f.servicio_id, tipo: f.tipo, precio: f.cobros.precio_aplicado },
    { hora: '21:15', servicio: banoA, tipo: 'bano', precio: 30000 },
  )
  await unchanged(rows, ['past', 'earlierToday', 'inProgress', 'paid', 'cancelled'])
})

for (const [args, reason] of [
  [{ p_hora: '25:00' }, /hora_invalida/], [{ p_hora: null }, /hora_invalida/], [{ p_nombre: '  ' }, /nombre_invalido/],
  [{ p_servicio: '0d0d0d05-0000-4000-8000-0000000000ff' }, /servicio_invalido/], [{ p_duracion: 0 }, /duracion_invalida/],
]) {
  test(`grupo_actualizar rejects ${JSON.stringify(args)}`, async () => {
    const g = await grupo()
    const res = await rpc('OWNER', 'grupo_actualizar', {
      p_grupo: g.id, p_nombre: 'X', p_hora: '07:00', p_servicio: paseoA, p_duracion: 60, p_zona: '', p_color: 'blue', ...args,
    })
    assert.match(res.error?.message ?? '', reason)
    assert.equal((await db().from('grupos').select('hora').eq('id', g.id).single()).data.hora, g.hora)
  })
}

test('grupo_eliminar deactivates the group and its memberships and deletes only its future walks', async () => {
  const g = await grupo()
  const [d] = await perros(1)
  await db().from('grupo_membresias').insert({ grupo_id: g.id, perro_id: d })
  const rows = await history(g, d)
  assert.equal((await rpc('OWNER', 'grupo_eliminar', { p_grupo: g.id })).error, null)
  assert.equal((await db().from('grupos').select('activo').eq('id', g.id).single()).data.activo, false)
  assert.equal((await membership(g.id, d)).activo, false)
  assert.equal(await row(rows.future.id), null)
  await unchanged(rows, ['past', 'earlierToday', 'inProgress', 'paid', 'cancelled'])
  assert.equal((await db().rpc('agenda_extender')).error, null)
  assert.equal((await walks({ perro_id: d, grupo_id: g.id, estado: 'programado' })).length, 2, 'the extender revived a deleted group')
})

for (const actor of ['CLIENT', 'WALKER_CO', 'OTHER', 'ANON']) {
  test(`${actor} cannot update or delete a tenant A group`, async () => {
    const g = await grupo()
    const upd = await rpc(actor, 'grupo_actualizar', {
      p_grupo: g.id, p_nombre: 'X', p_hora: '07:00', p_servicio: paseoA, p_duracion: 60, p_zona: '', p_color: 'blue',
    })
    assert.equal(upd.error?.code, '42501', `update: got ${upd.error?.code ?? 'no error'}`)
    assert.equal((await rpc(actor, 'grupo_eliminar', { p_grupo: g.id })).error?.code, '42501')
    const now = (await db().from('grupos').select('*').eq('id', g.id).single()).data
    assert.deepEqual(now, g)
  })
}

// 9.6 cap: reassigning or moving the hour into a full outing fails and changes nothing.
test('reassigning a group into a walker who would exceed 8 dogs fails with paseador_lleno and changes nothing', async () => {
  const g = await grupo({ cuidador_id: u.WALKER_CO2 })
  const fill = await perros(8)
  const [d] = await perros(1)
  await writePrestaciones(fill.map((perro_id) => ({
    negocio_id: A, perro_id, tipo: 'paseo', cuidador_id: u.WALKER_CO, fecha: day(5), estado: 'programado', detalle: { hora: g.hora },
  })))
  const rows = await history(g, d)
  const { id, created_at, ...copy } = rows.future
  const extra = (await writePrestaciones({ ...copy, fecha: day(5) })).data[0]
  const res = await rpc('OWNER', 'grupo_asignar', { p_grupo: g.id, p_cuidador: u.WALKER_CO })
  assert.match(res.error?.message ?? '', /paseador_lleno/)
  assert.equal((await db().from('grupos').select('cuidador_id').eq('id', g.id).single()).data.cuidador_id, u.WALKER_CO2)
  await unchanged(rows, Object.keys(rows))
  assert.deepEqual(await row(extra.id), extra)
})

test('moving a group to an hour where its walker already has 8 dogs fails with paseador_lleno and changes nothing', async () => {
  const g = await grupo({ cuidador_id: u.WALKER_CO2 })
  const fill = await perros(8)
  const [d] = await perros(1)
  await writePrestaciones(fill.map((perro_id) => ({
    negocio_id: A, perro_id, tipo: 'paseo', cuidador_id: u.WALKER_CO2, fecha: day(6), estado: 'programado', detalle: { hora: '04:44' },
  })))
  const rows = await history(g, d)
  const res = await rpc('OWNER', 'grupo_actualizar', {
    p_grupo: g.id, p_nombre: g.nombre, p_hora: '04:44', p_servicio: paseoA, p_duracion: 60, p_zona: 'Norte', p_color: 'purple',
  })
  assert.match(res.error?.message ?? '', /paseador_lleno/)
  assert.equal((await db().from('grupos').select('hora').eq('id', g.id).single()).data.hora, g.hora)
  await unchanged(rows, Object.keys(rows))
})

// ---- 5. prestacion_asignar --------------------------------------------------------------------------------
async function booking(over = {}) {
  const [d] = await perros(1, over.negocio_id ?? A)
  const { data } = await writePrestaciones({
    negocio_id: A, perro_id: d, tipo: 'bano', servicio_id: banoA, grupo_id: null, cuidador_id: null,
    fecha: day(0), estado: 'programado', precio_aplicado: 30000, detalle: {}, ...over,
  })
  return data[0]
}

for (const actor of ['OWNER', 'OFFICE']) {
  test(`${actor} assigns a bath booking; the assignee sees it and starts and finishes it`, async () => {
    const b = await booking()
    const res = await rpc(actor, 'prestacion_asignar', { p_id: b.id, p_cuidador: u.WALKER_CO })
    assert.equal(res.error, null, res.error?.message)
    const walker = await as('WALKER_CO')
    const seen = await walker.from('prestaciones').select('id').eq('id', b.id)
    assert.deepEqual(seen.data, [{ id: b.id }])
    assert.equal((await walker.rpc('paseo_marcar', { p_ids: [b.id], p_estado: 'en_curso' })).error, null)
    assert.equal((await walker.rpc('paseo_marcar', { p_ids: [b.id], p_estado: 'finalizado' })).error, null)
    assert.equal((await row(b.id)).estado, 'finalizado')
  })
}

test('OWNER can assign office staff (rol empresa) of the same tenant', async () => {
  const b = await booking({ fecha: day(2) })
  assert.equal((await rpc('OWNER', 'prestacion_asignar', { p_id: b.id, p_cuidador: u.OFFICE })).error, null)
  assert.equal((await row(b.id)).cuidador_id, u.OFFICE)
})

test('the independent walker takes a booking of his own business for himself', async () => {
  const b = await booking({ negocio_id: I, servicio_id: null, fecha: day(1) })
  assert.equal((await rpc('WALKER_IND', 'prestacion_asignar', { p_id: b.id, p_cuidador: u.WALKER_IND })).error, null)
  assert.equal((await row(b.id)).cuidador_id, u.WALKER_IND)
})

for (const actor of ['CLIENT', 'WALKER_CO', 'OTHER', 'WALKER_IND', 'NOPROFILE', 'ANON']) {
  test(`${actor} cannot assign a tenant A booking`, async () => {
    const b = await booking()
    const res = await rpc(actor, 'prestacion_asignar', { p_id: b.id, p_cuidador: u.WALKER_CO })
    assert.equal(res.error?.code, '42501', `got ${res.error?.code ?? 'no error'}`)
    assert.equal((await row(b.id)).cuidador_id, null)
  })
}

test('an unknown booking is refused with the permission error', async () => {
  const res = await rpc('OWNER', 'prestacion_asignar', { p_id: '00000000-0000-4000-8000-000000000000', p_cuidador: u.WALKER_CO })
  assert.equal(res.error?.code, '42501')
})

for (const [target, why] of [['WALKER_IND', 'a walker of another tenant'], ['CLIENT', 'a client'], [null, 'nobody']]) {
  test(`prestacion_asignar rejects ${why} as assignee`, async () => {
    const b = await booking()
    const res = await rpc('OWNER', 'prestacion_asignar', { p_id: b.id, p_cuidador: target && u[target] })
    assert.match(res.error?.message ?? '', /cuidador_invalido/)
    assert.equal((await row(b.id)).cuidador_id, null)
  })
}

for (const [over, why] of [[{ estado: 'finalizado' }, 'a finished booking'], [{ estado: 'cancelado' }, 'a cancelled booking'], [{ fecha: day(-1) }, 'a past booking']]) {
  test(`prestacion_asignar rejects ${why}`, async () => {
    const b = await booking(over)
    const res = await rpc('OWNER', 'prestacion_asignar', { p_id: b.id, p_cuidador: u.WALKER_CO })
    assert.match(res.error?.message ?? '', /prestacion_no_asignable/)
    assert.equal((await row(b.id)).cuidador_id, null)
  })
}

test('prestacion_asignar on a walk respects the 8-dog cap', async () => {
  const fill = await perros(8)
  await writePrestaciones(fill.map((perro_id) => ({
    negocio_id: A, perro_id, tipo: 'paseo', cuidador_id: u.WALKER_CO2, fecha: day(15), estado: 'programado', detalle: { hora: '04:30' },
  })))
  const b = await booking({ tipo: 'paseo', servicio_id: paseoA, fecha: day(15), detalle: { hora: '04:30' } })
  assert.match((await rpc('OWNER', 'prestacion_asignar', { p_id: b.id, p_cuidador: u.WALKER_CO2 })).error?.message ?? '', /paseador_lleno/)
  assert.equal((await row(b.id)).cuidador_id, null)
})
