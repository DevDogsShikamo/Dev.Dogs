// F4 monthly plans: a plan (public.suscripciones) charges a FIXED monthly amount per dog, generated on the 1st of
// each month and owed even if the dog misses walks (modo_cobro 'fijo', the only mode implemented).
//   plan_mensual_activar / plan_mensual_cancelar  owner or finance office of the dog's business; no direct writes
//   mensualidades_generar                         internal (pg_cron dd_mensualidades and the SQL helper): one
//                                                 finalizado prestacion + chargeable cobro per plan and month
// Each test uses throwaway monthly services (fixed ids) and, where it generates, throwaway dogs of tenant A.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, ids, seed, writePrestaciones } from './_actors.mjs'
import { sql } from './_sql.mjs'

const { A, B, I } = ids.negocios
const u = ids.users
const { d1, d3, dB, dI } = ids.perros
const db = () => admin()
const ok = ({ error }, what) => assert.equal(error, null, `${what}: ${error?.message}`)
const denied = (res, what = '') => assert.equal(res.error?.code, '42501', `${what} expected permission denied, got ${res.error?.code ?? 'no error'} ${res.error?.message ?? ''}`)
const rpc = async (actor, name, args) => (await as(actor)).rpc(name, args)

// Bogota calendar (UTC-5, no DST), the clock every RPC uses.
const hoy = () => new Date(Date.now() - 5 * 36e5).toISOString().slice(0, 10)
const mes = (n = 0) => { const [y, m] = hoy().split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10) }
const finDe = (n = 0) => new Date(Date.parse(`${mes(n + 1)}T00:00:00Z`) - 864e5).toISOString().slice(0, 10)
const addDias = (f, n) => new Date(Date.parse(`${f}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10)

const SID = Object.fromEntries(['men', 'men2', 'uso', 'off', 'cero', 'menB', 'menI'].map((k, i) => [k, `0d0d0d05-0000-4000-8000-0000000000${70 + i}`]))
const PRECIO = 400000
const made = { perros: [], grupos: [] }

async function cleanup() {
  const svc = Object.values(SID)
  await db().from('prestaciones').delete().in('servicio_id', svc)
  await db().from('suscripciones').delete().in('servicio_id', svc)
  await db().from('grupo_membresias').delete().in('grupo_id', made.grupos)
  await db().from('grupos').delete().in('id', made.grupos)
  await db().from('tarifas').delete().in('servicio_id', svc)
  await db().from('servicios').delete().in('id', svc)
  if (made.perros.length) {
    await db().from('prestaciones').delete().in('perro_id', made.perros)
    await db().from('perros').delete().in('id', made.perros)
  }
}

before(async () => {
  await seed()
  await cleanup()
  const s = (k, negocio_id, extra = {}) => ({ id: SID[k], negocio_id, tipo: 'paseo', nombre: `Plan ${k}`, modelo_cobro: 'mensual', activo: true, ...extra })
  ok(await db().from('servicios').insert([
    s('men', A), s('men2', A, { tipo: 'guarderia' }), s('uso', A, { modelo_cobro: 'por_uso' }), s('off', A, { activo: false }),
    s('cero', A), s('menB', B), s('menI', I),
  ]), 'servicios')
  const t = (k, negocio_id, precio_mensual, precio = 0) => ({ servicio_id: SID[k], negocio_id, precio, precio_mensual })
  ok(await db().from('tarifas').insert([
    t('men', A, PRECIO), t('men2', A, 250000), t('uso', A, 0, 20000), t('off', A, PRECIO), t('cero', A, 0), t('menB', B, PRECIO), t('menI', I, 300000),
  ]), 'tarifas')
  ok(await db().from('permisos').upsert({ user_id: u.OFFICE_FIN, negocio_id: A, finanzas: true }), 'grant OFFICE_FIN')
}, { timeout: 120_000 })
after(async () => {
  await cleanup()
  await db().from('permisos').delete().eq('user_id', u.OFFICE_FIN)
})

async function perros(n, extra = {}) {
  const { data, error } = await db().from('perros')
    .insert(Array.from({ length: n }, (_, i) => ({ negocio_id: A, nombre: `Plan ${i + 1}`, activo: true, ...extra }))).select('id')
  assert.equal(error, null, error?.message)
  made.perros.push(...data.map((d) => d.id))
  return data.map((d) => d.id)
}
const plan = async (id) => (await db().from('suscripciones').select('*').eq('id', id).maybeSingle()).data
const plansOf = async (perro_id) => (await db().from('suscripciones').select('*').eq('perro_id', perro_id)).data
// The monthly charges of a plan: prestacion + its cobro, oldest first.
const charges = async (planId) =>
  (await db().from('prestaciones').select('*, cobros(*)').eq('detalle->>plan_id', planId).order('fecha')).data
const generar = (m) => sql(`select public.mensualidades_generar('${m}'::date) as n`)
async function activar(actor, p_perro, p_servicio = SID.men, extra = {}) {
  const res = await rpc(actor, 'plan_mensual_activar', { p_perro, p_servicio, ...extra })
  assert.equal(res.error, null, `${actor} activar: ${res.error?.message}`)
  return res.data
}

// ---- 1. the plan row and its billing mode -------------------------------------------------------------
test('modo_cobro defaults to fijo and only fijo is accepted for now', async () => {
  const [d] = await perros(1)
  const base = { negocio_id: A, perro_id: d, servicio_id: SID.men }
  const bad = await db().from('suscripciones').insert({ ...base, modo_cobro: 'proporcional' })
  assert.equal(bad.error?.code, '23514', `expected check_violation, got ${bad.error?.code ?? 'no error'}`)
  const good = await db().from('suscripciones').insert(base).select('modo_cobro').single()
  ok(good, 'insert')
  assert.equal(good.data.modo_cobro, 'fijo')
  const noSvc = await db().from('suscripciones').insert({ negocio_id: A, perro_id: d })
  assert.equal(noSvc.error?.code, '23514', 'a plan without a service is refused')
})

// ---- 2. activation ------------------------------------------------------------------------------------
for (const actor of ['OWNER', 'OFFICE_FIN']) {
  test(`${actor} activates a plan: the month is charged at once, in full, as one finalizado service`, async () => {
    const [d] = await perros(1)
    const id = await activar(actor, d)
    const p = await plan(id)
    assert.deepEqual(
      { neg: p.negocio_id, perro: p.perro_id, svc: p.servicio_id, estado: p.estado, inicio: p.inicio, fin: p.fin, modo: p.modo_cobro, override: p.precio_mensual },
      { neg: A, perro: d, svc: SID.men, estado: 'activa', inicio: hoy(), fin: null, modo: 'fijo', override: null },
    )
    const c = await charges(id)
    assert.equal(c.length, 1)
    assert.deepEqual(
      { tipo: c[0].tipo, estado: c[0].estado, fecha: c[0].fecha, svc: c[0].servicio_id, cuidador: c[0].cuidador_id, grupo: c[0].grupo_id, detalle: c[0].detalle,
        precio: c[0].cobros.precio_aplicado, cobrable: c[0].cobros.cobrable, cobrado: c[0].cobros.cobrado },
      { tipo: 'paseo', estado: 'finalizado', fecha: hoy(), svc: SID.men, cuidador: null, grupo: null, detalle: { mensualidad: mes().slice(0, 7), plan_id: id },
        precio: PRECIO, cobrable: true, cobrado: false },
    )
  })
}

test('the independent walker activates a plan for a dog of his own business', async () => {
  const id = await activar('WALKER_IND', dI, SID.menI)
  assert.equal((await plan(id)).negocio_id, I)
  assert.equal((await charges(id))[0].cobros.precio_aplicado, 300000)
})

for (const actor of ['OFFICE', 'CLIENT', 'WALKER_CO', 'OTHER', 'WALKER_IND', 'NOPROFILE', 'ANON']) {
  test(`${actor} cannot activate or cancel a plan of tenant A`, async () => {
    const [d] = await perros(1)
    denied(await rpc(actor, 'plan_mensual_activar', { p_perro: d, p_servicio: SID.men }), 'activar')
    assert.deepEqual(await plansOf(d), [])
    const id = await activar('OWNER', d)
    denied(await rpc(actor, 'plan_mensual_cancelar', { p_plan: id }), 'cancelar')
    assert.equal((await plan(id)).estado, 'activa')
  })
}

test('a dog or plan id nobody knows is refused with the permission error', async () => {
  denied(await rpc('OWNER', 'plan_mensual_activar', { p_perro: '00000000-0000-4000-8000-000000000000', p_servicio: SID.men }))
  denied(await rpc('OWNER', 'plan_mensual_cancelar', { p_plan: '00000000-0000-4000-8000-000000000000' }))
  denied(await rpc('OWNER', 'plan_mensual_activar', { p_perro: dB, p_servicio: SID.men }), 'dog of tenant B')
})

for (const [svc, why] of [['uso', 'a pay-per-use service'], ['off', 'an inactive service'], ['cero', 'a monthly service without a monthly price'], ['menB', 'a service of tenant B']]) {
  test(`plan_mensual_activar refuses ${why}`, async () => {
    const [d] = await perros(1)
    const res = await rpc('OWNER', 'plan_mensual_activar', { p_perro: d, p_servicio: SID[svc] })
    assert.match(res.error?.message ?? '', /servicio_invalido/)
    assert.deepEqual(await plansOf(d), [])
  })
}

test('plan_mensual_activar refuses an inactive dog and a start before the current month', async () => {
  const [off] = await perros(1, { activo: false })
  assert.match((await rpc('OWNER', 'plan_mensual_activar', { p_perro: off, p_servicio: SID.men })).error?.message ?? '', /perro_invalido/)
  const [d] = await perros(1)
  for (const p_inicio of [mes(-1), addDias(mes(), -1)]) {
    assert.match((await rpc('OWNER', 'plan_mensual_activar', { p_perro: d, p_servicio: SID.men, p_inicio })).error?.message ?? '', /fecha_invalida/, p_inicio)
  }
  assert.deepEqual(await plansOf(d), [])
})

test('one active plan per dog and service; another monthly service of the same dog is its own plan', async () => {
  const [d] = await perros(1)
  await activar('OWNER', d)
  assert.match((await rpc('OFFICE_FIN', 'plan_mensual_activar', { p_perro: d, p_servicio: SID.men })).error?.message ?? '', /plan_existente/)
  const otro = await activar('OWNER', d, SID.men2)
  assert.equal((await plansOf(d)).length, 2)
  assert.deepEqual((await charges(otro)).map((c) => [c.tipo, c.cobros.precio_aplicado]), [['guarderia', 250000]])
})

test('a plan starting next month charges nothing now and is charged on its start date by that month', async () => {
  const [d] = await perros(1)
  const inicio = addDias(mes(1), 9)
  const id = await activar('OWNER', d, SID.men, { p_inicio: inicio })
  assert.deepEqual(await charges(id), [])
  generar(mes(1))
  assert.deepEqual((await charges(id)).map((c) => [c.fecha, c.detalle.mensualidad, c.cobros.precio_aplicado]), [[inicio, mes(1).slice(0, 7), PRECIO]])
})

// ---- 3. monthly generation ----------------------------------------------------------------------------
test('mensualidades_generar creates exactly one charge per plan and month and is idempotent', async () => {
  const [d1_, d2_] = await perros(2)
  const p1 = await activar('OWNER', d1_)
  const p2 = await activar('OWNER', d2_)
  generar(mes(1))
  generar(mes(1))
  generar(mes())
  for (const id of [p1, p2]) {
    const c = await charges(id)
    assert.deepEqual(c.map((x) => [x.fecha, x.detalle.mensualidad, x.estado, x.cobros.cobrable]),
      [[hoy(), mes().slice(0, 7), 'finalizado', true], [mes(1), mes(1).slice(0, 7), 'finalizado', true]])
  }
  // The unique key refuses a second charge of the same plan and month even when written directly.
  const dup = await db().from('prestaciones').insert({ negocio_id: A, perro_id: d1_, servicio_id: SID.men, tipo: 'paseo', estado: 'finalizado', fecha: mes(1), detalle: { mensualidad: mes(1).slice(0, 7), plan_id: p1 } })
  assert.equal(dup.error?.code, '23505', `expected unique_violation, got ${dup.error?.code ?? 'no error'}`)
})

test('the price comes from the tarifa at each generation unless the plan overrides it', async () => {
  const [a, b] = await perros(2)
  const pa = await activar('OWNER', a)
  const pb = await activar('OWNER', b)
  ok(await db().from('suscripciones').update({ precio_mensual: 123000 }).eq('id', pb), 'override')
  ok(await db().from('tarifas').update({ precio_mensual: 450000 }).eq('servicio_id', SID.men), 'new price')
  try {
    generar(mes(1))
    assert.deepEqual((await charges(pa)).map((c) => c.cobros.precio_aplicado), [PRECIO, 450000])
    assert.deepEqual((await charges(pb)).map((c) => c.cobros.precio_aplicado), [PRECIO, 123000])
  } finally {
    await db().from('tarifas').update({ precio_mensual: PRECIO }).eq('servicio_id', SID.men)
  }
})

test('an inactive dog or service is not charged', async () => {
  const [a, b] = await perros(2)
  const pa = await activar('OWNER', a)
  const pb = await activar('OWNER', b, SID.men2)
  ok(await db().from('perros').update({ activo: false }).eq('id', a), 'dog off')
  ok(await db().from('servicios').update({ activo: false }).eq('id', SID.men2), 'service off')
  try {
    generar(mes(1))
    assert.equal((await charges(pa)).length, 1)
    assert.equal((await charges(pb)).length, 1)
  } finally {
    await db().from('servicios').update({ activo: true }).eq('id', SID.men2)
  }
})

// ---- 4. cancellation ----------------------------------------------------------------------------------
test('a cancelled plan ends with the month: this month stays charged, the next one is not', async () => {
  const [d] = await perros(1)
  const id = await activar('OWNER', d)
  ok(await rpc('OFFICE_FIN', 'plan_mensual_cancelar', { p_plan: id }), 'cancelar')
  const p = await plan(id)
  assert.deepEqual({ estado: p.estado, fin: p.fin }, { estado: 'cancelada', fin: finDe() })
  generar(mes(1))
  assert.deepEqual((await charges(id)).map((c) => c.detalle.mensualidad), [mes().slice(0, 7)])
  assert.match((await rpc('OWNER', 'plan_mensual_cancelar', { p_plan: id })).error?.message ?? '', /plan_invalido/)
})

test('cancelling refuses an end date in the past; activating again this month restores the plan without a second charge', async () => {
  const [d] = await perros(1)
  const id = await activar('OWNER', d)
  assert.match((await rpc('OWNER', 'plan_mensual_cancelar', { p_plan: id, p_fin: addDias(hoy(), -1) })).error?.message ?? '', /fecha_invalida/)
  ok(await rpc('OWNER', 'plan_mensual_cancelar', { p_plan: id }), 'cancelar')
  assert.equal(await activar('OWNER', d), id, 'the same plan comes back')
  const p = await plan(id)
  assert.deepEqual({ estado: p.estado, fin: p.fin }, { estado: 'activa', fin: null })
  assert.equal((await charges(id)).length, 1)
})

// ---- 5. Ley 2480 (Ley Kiara) trigger and the 8-dog cap ignore the monthly charge -----------------------
test('a dog in heat or with a contagious disease is still charged its month (the charge is no started service)', async () => {
  const [d] = await perros(1, { en_celo: true, enfermedad_contagiosa: true })
  const id = await activar('OWNER', d)
  assert.equal((await charges(id)).length, 1)
  generar(mes(1))
  assert.equal((await charges(id)).length, 2)
})

test('the monthly charge never counts toward the 8 dogs of a walker on that date', async () => {
  const fill = await perros(7)
  const [extra, extra2, conPlan] = await perros(3)
  const fecha = mes(1)
  const walk = (perro_id) => ({ negocio_id: A, perro_id, tipo: 'paseo', cuidador_id: u.WALKER_CO2, fecha, estado: 'programado', detalle: { hora: '05:30' } })
  await writePrestaciones(fill.map(walk))
  await activar('OWNER', conPlan)
  generar(fecha)
  const sameDay = (await db().from('prestaciones').select('id').eq('fecha', fecha).eq('tipo', 'paseo').in('perro_id', [...fill, conPlan])).data
  assert.equal(sameDay.length, 8, 'precondition: 7 walks + the monthly charge on that date')
  const eighth = await db().from('prestaciones').insert(walk(extra))
  assert.equal(eighth.error, null, `the 8th walk was refused: ${eighth.error?.message}`)
  const ninth = await db().from('prestaciones').insert(walk(extra2))
  assert.match(ninth.error?.message ?? '', /paseador_lleno/)
})

// ---- 6. who sees what -----------------------------------------------------------------------------------
test('reads: the dog owners see their own plans, owner and finance office the tenant, nobody else any', async () => {
  const pMine = await activar('OWNER', d1)
  const pOther = await activar('OWNER', d3)
  const want = {
    OWNER: [pMine, pOther], OFFICE_FIN: [pMine, pOther], CLIENT: [pMine], COOWNER: [pMine], CLIENT2: [pOther],
    OFFICE: [], WALKER_CO: [], OTHER: [], CLIENT_I: [],
  }
  for (const [actor, plans] of Object.entries(want)) {
    const res = await (await as(actor)).from('suscripciones').select('id').in('perro_id', [d1, d3])
    ok(res, actor)
    assert.deepEqual(res.data.map((r) => r.id).sort(), [...plans].sort(), `suscripciones as ${actor}`)
  }
  // The client reads its monthly charge (and its amount) like any other service of its dog; the walker does not.
  const [c] = await charges(pMine)
  const seen = await (await as('CLIENT')).from('prestaciones').select('id,cobros(precio_aplicado,cobrable)').eq('id', c.id)
  assert.deepEqual(seen.data, [{ id: c.id, cobros: { precio_aplicado: PRECIO, cobrable: true } }])
  assert.deepEqual((await (await as('WALKER_CO')).from('prestaciones').select('id').eq('id', c.id)).data, [])
})

test('no direct writes: not even the owner inserts, updates or deletes a plan', async () => {
  const [d] = await perros(1)
  const id = await activar('OWNER', d)
  const owner = await as('OWNER')
  denied(await owner.from('suscripciones').insert({ negocio_id: A, perro_id: d, servicio_id: SID.men2 }), 'insert')
  denied(await owner.from('suscripciones').update({ precio_mensual: 1 }).eq('id', id), 'update')
  denied(await owner.from('suscripciones').delete().eq('id', id), 'delete')
  const p = await plan(id)
  assert.deepEqual({ estado: p.estado, precio: p.precio_mensual }, { estado: 'activa', precio: null })
})

test('cobro_marcar marks the monthly charge paid (owner), not the office without finance', async () => {
  const [d] = await perros(1)
  const id = await activar('OWNER', d)
  const [c] = await charges(id)
  denied(await rpc('OFFICE', 'cobro_marcar', { p_prestacion: c.id }))
  ok(await rpc('OWNER', 'cobro_marcar', { p_prestacion: c.id }), 'cobro_marcar')
  const after_ = (await charges(id))[0].cobros
  assert.deepEqual({ cobrado: after_.cobrado, por: after_.confirmado_por }, { cobrado: true, por: u.OWNER })
})

// ---- 7. the walks of a monthly service stay free (no double charge) -------------------------------------
test('walks of a monthly service are created non-chargeable at price 0 (group and cron paths)', async () => {
  const { data: g, error } = await db().from('grupos').insert({
    negocio_id: A, nombre: 'Plan grupo', zona: 'Norte', servicio_id: SID.men, cuidador_id: u.WALKER_CO2, hora: '05:59', duracion_min: 60,
  }).select('id').single()
  assert.equal(error, null, error?.message)
  made.grupos.push(g.id)
  const [d, e] = await perros(2)
  ok(await rpc('OWNER', 'grupo_agregar_perro', { p_grupo: g.id, p_perro: d }), 'agregar')
  ok(await db().from('grupo_membresias').insert({ grupo_id: g.id, perro_id: e }), 'membership')
  ok(await db().rpc('agenda_extender'), 'agenda_extender')
  for (const perro of [d, e]) {
    const w = (await db().from('prestaciones').select('cobros(precio_aplicado,cobrable)').eq('grupo_id', g.id).eq('perro_id', perro)).data
    assert.ok(w.length > 0, 'precondition: walks were created')
    assert.deepEqual([...new Set(w.map((x) => `${x.cobros.precio_aplicado}/${x.cobros.cobrable}`))], ['0/false'])
  }
})

// ---- 8. internals and the schedule ------------------------------------------------------------------------
test('mensualidades_generar is internal; the plan RPCs pin an empty search_path and are for authenticated only', async () => {
  const rows = sql(`select proname, coalesce(proconfig @> array['search_path=""'], false) as pinned,
                           has_function_privilege('anon', oid, 'execute') as anon,
                           has_function_privilege('authenticated', oid, 'execute') as auth
                    from pg_proc where pronamespace = 'public'::regnamespace
                      and proname in ('mensualidades_generar', 'plan_mensual_activar', 'plan_mensual_cancelar') order by 1`)
  assert.deepEqual(rows.map((r) => [r.proname, r.pinned, r.anon, r.auth]), [
    ['mensualidades_generar', true, false, false], ['plan_mensual_activar', true, false, true], ['plan_mensual_cancelar', true, false, true],
  ])
  for (const actor of ['OWNER', 'ANON']) denied(await rpc(actor, 'mensualidades_generar', {}), actor)
})

test('mensualidades_generar is scheduled monthly with pg_cron as dd_mensualidades (01:15 Bogota on the 1st)', () => {
  const rows = sql(`select schedule, command, active from cron.job where jobname = 'dd_mensualidades'`)
  assert.deepEqual(rows, [{ schedule: '15 6 1 * *', command: 'select public.mensualidades_generar()', active: true }])
})

test('without a month mensualidades_generar charges the current Bogota month', async () => {
  const [d] = await perros(1)
  ok(await db().from('suscripciones').insert({ negocio_id: A, perro_id: d, servicio_id: SID.men, inicio: mes() }), 'plan')
  const id = (await plansOf(d))[0].id
  sql('select public.mensualidades_generar()')
  assert.deepEqual((await charges(id)).map((c) => [c.fecha, c.detalle.mensualidad]), [[mes(), mes().slice(0, 7)]])
})
