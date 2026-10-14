// S4a2 side-table RPCs and dual-write sync (additive). Who may call which RPC (RV-4c, RV-4d,
// RV-3a name projection, RV-8a) and: every legacy write path keeps the side tables equal to the
// legacy columns, row for row, while the app still reads and writes the old columns.
import { after, before, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { admin, as, day, ids, seed, tempUser } from './_actors.mjs'
import { dropDog, makeDog } from './_attacks.mjs'
import { sql } from './_sql.mjs'
import { create } from './_invites.mjs'

const u = ids.users
const { A } = ids.negocios
const { d1, d2, d4 } = ids.perros
const { g1 } = ids.grupos
const { paseoA, banoA } = ids.servicios
const db = () => admin()
const call = async (actor, fn, args) => (await as(actor)).rpc(fn, args)
const ok = (res, what = 'call') => assert.equal(res.error, null, `${what}: ${res.error?.message}`)
const denied = (res, what = 'call') => assert.equal(res.error?.code, '42501', `${what}: expected 42501, got ${res.error?.code ?? 'no error'}`)
const raised = (res, re, what = 'call') => {
  assert.equal(res.error?.code, 'P0001', `${what}: expected a raised error, got ${res.error?.code ?? 'no error'}`)
  assert.match(res.error.message, re)
}
const one = async (table, key, id, cols = '*') => (await db().from(table).select(cols).eq(key, id).maybeSingle()).data

before(async () => {
  await seed()
  ok(await db().from('perros').update({ microchip: 'DDTEST-S4A2-0' }).eq('id', d1), 'chip')
  ok(await db().rpc('backfill_side_tables'), 'backfill')
})
after(async () => {
  await db().from('permisos').delete().in('user_id', [u.OFFICE, u.OFFICE_FIN])
  await db().from('servicios').delete().like('nombre', 's4a2 %')
  await db().from('profiles').update({ telefono: null, salario_fijo: 0 }).in('id', [u.CLIENT, u.WALKER_CO, u.WALKER_IND, u.OFFICE, u.OWNER, u.CLIENT_I])
  await db().from('perros').update({ microchip: null }).in('id', [d1, d2])
  await db().from('prestaciones').delete().eq('negocio_id', A).like('detalle->>nota', 's4a2%')
})

// ---- permiso_finanzas_set (RV-4c, RV-4d) ----
const flag = async (id) => one('permisos', 'user_id', id, 'finanzas,otorgado_por,negocio_id')
const grant = (actor, user, on = true) => call(actor, 'permiso_finanzas_set', { p_user: user, p_on: on })

test('RV-4c: only the owner grants the finance flag, and only to an office member of its tenant', async () => {
  ok(await grant('OWNER', u.OFFICE, true), 'owner grants (precondition)')
  assert.deepEqual(await flag(u.OFFICE), { finanzas: true, otorgado_por: u.OWNER, negocio_id: A })
  ok(await grant('OWNER', u.OFFICE, false), 'owner revokes')
  assert.equal((await flag(u.OFFICE)).finanzas, false)
  ok(await grant('OWNER', u.OFFICE_FIN, true))
  for (const [actor, target] of [['OFFICE', u.OFFICE], ['OFFICE', u.OFFICE_FIN], ['OFFICE_FIN', u.OFFICE], ['WALKER_CO', u.OFFICE], ['CLIENT', u.OFFICE], ['NOPROFILE', u.OFFICE], ['ANON', u.OFFICE]]) {
    denied(await grant(actor, target), `${actor} -> ${target === u.OFFICE ? 'OFFICE' : 'OFFICE_FIN'}`)
  }
  raised(await grant('OTHER', u.OFFICE), /destino_invalido/, 'a foreign owner cannot reach another tenant')
  assert.equal((await flag(u.OFFICE)).finanzas, false, 'denied calls changed nothing')
  for (const target of [u.WALKER_CO, u.CLIENT, u.OTHER, u.OWNER, randomUUID(), null]) raised(await grant('OWNER', target), /destino_invalido/, `target ${target}`)
  assert.equal(await flag(u.WALKER_CO), null)
  raised(await grant('OWNER', u.OFFICE, null), /valor_invalido/)
})

test('RV-4d + cobro_marcar: the flag opens charges and prices on the same session, writes both stores, and revocation closes them', async () => {
  const { data: p } = await db().from('prestaciones').insert({ negocio_id: A, perro_id: d2, servicio_id: paseoA, tipo: 'paseo', estado: 'finalizado', precio_aplicado: 20000, fecha: day(-1), detalle: { nota: 's4a2 cobro' } }).select('id').single()
  const mark = () => call('OFFICE_FIN', 'cobro_marcar', { p_prestacion: p.id })
  const seen = async () => (await (await as('OFFICE_FIN')).from('cobros').select('prestacion_id')).data.length
  ok(await grant('OWNER', u.OFFICE_FIN, true))
  assert.ok((await seen()) > 0, 'finance office reads charges')
  try {
    denied(await call('OFFICE', 'cobro_marcar', { p_prestacion: p.id }), 'office without the flag')
    ok(await mark(), 'office with the flag')
    const legacy = await one('prestaciones', 'id', p.id, 'cobrado,confirmado_por,confirmado_at')
    assert.deepEqual([legacy.cobrado, legacy.confirmado_por], [true, u.OFFICE_FIN])
    assert.deepEqual(await one('cobros', 'prestacion_id', p.id, 'cobrado,confirmado_por,confirmado_at,precio_aplicado'), { ...legacy, precio_aplicado: 20000 })
    ok(await grant('OWNER', u.OFFICE_FIN, false))
    assert.equal(await seen(), 0, 'revoked flag closes charges on the same session')
    const { data: q } = await db().from('prestaciones').insert({ negocio_id: A, perro_id: d2, servicio_id: paseoA, tipo: 'paseo', estado: 'finalizado', precio_aplicado: 1, fecha: day(-1), detalle: { nota: 's4a2 cobro' } }).select('id').single()
    denied(await call('OFFICE_FIN', 'cobro_marcar', { p_prestacion: q.id }), 'revoked flag')
    assert.equal((await one('cobros', 'prestacion_id', q.id)).cobrado, false)
  } finally {
    await db().from('permisos').delete().eq('user_id', u.OFFICE_FIN)
  }
})

// ---- contacto_set (RV-8a) ----
test('contacto_set: every signed-in profile sets only its own phone, in both stores', async () => {
  const other = async () => (await db().from('contactos').select('*').eq('user_id', u.CLIENT2)).data
  const untouched = await other()
  for (const actor of ['OWNER', 'OFFICE', 'WALKER_CO', 'CLIENT', 'WALKER_IND', 'CLIENT_I']) {
    const want = `+57 300-${actor.length}22`
    ok(await call(actor, 'contacto_set', { p_telefono: ` ${want} ` }), actor)
    const prof = await one('profiles', 'id', u[actor], 'telefono,rol,negocio_id')
    assert.equal(prof.telefono, want, `${actor} profile`)
    assert.deepEqual(await one('contactos', 'user_id', u[actor], 'telefono,rol,negocio_id'), prof, `${actor} contactos`)
  }
  assert.deepEqual(await other(), untouched, 'others untouched')
  ok(await call('CLIENT', 'contacto_set', { p_telefono: null }), 'clear')
  assert.deepEqual([(await one('profiles', 'id', u.CLIENT, 'telefono')).telefono, (await one('contactos', 'user_id', u.CLIENT)).telefono], [null, null])
  for (const bad of ['abc', 'x'.repeat(40), '1']) raised(await call('CLIENT', 'contacto_set', { p_telefono: bad }), /telefono_invalido/, bad)
  denied(await call('NOPROFILE', 'contacto_set', { p_telefono: '3001112233' }), 'no profile')
  denied(await call('ANON', 'contacto_set', { p_telefono: '3001112233' }), 'anon')
  assert.equal(await one('contactos', 'user_id', u.NOPROFILE), null)
})

// ---- perro_duenos_nombres (RV-3a) ----
test('perro_duenos_nombres: gestors get the principal name of their own tenant dogs, nothing else', async () => {
  const names = async (neg) => {
    const dogs = (await db().from('perros').select('id').eq('negocio_id', neg)).data.map((d) => d.id)
    const links = (await db().from('perro_duenos').select('perro_id,dueno_id').in('perro_id', dogs).eq('rol', 'principal').eq('estado', 'activo')).data
    const prof = (await db().from('profiles').select('id,nombre').in('id', links.map((l) => l.dueno_id))).data
    return links.map((l) => ({ perro_id: l.perro_id, nombre: prof.find((p) => p.id === l.dueno_id).nombre })).sort((a, b) => (a.perro_id < b.perro_id ? -1 : 1))
  }
  const A_ = await names(A)
  assert.ok(A_.length >= 2 && A_.some((r) => r.perro_id === d1 && r.nombre === 'Client'), 'fixture precondition')
  const rows = {}
  for (const actor of ['OWNER', 'OFFICE', 'OFFICE_FIN', 'OTHER', 'WALKER_IND']) {
    const res = await call(actor, 'perro_duenos_nombres')
    ok(res, actor)
    rows[actor] = res.data
    assert.ok(res.data.every((r) => Object.keys(r).sort().join() === 'nombre,perro_id'), `${actor} columns`)
  }
  for (const a of ['OWNER', 'OFFICE', 'OFFICE_FIN']) assert.deepEqual([...rows[a]].sort((x, y) => (x.perro_id < y.perro_id ? -1 : 1)), A_, a)
  assert.deepEqual(rows.OTHER, await names(ids.negocios.B))
  assert.deepEqual(rows.WALKER_IND, await names(ids.negocios.I))
  for (const actor of ['WALKER_CO', 'CLIENT', 'COOWNER', 'NOPROFILE', 'ANON']) denied(await call(actor, 'perro_duenos_nombres'), actor)
})

// ---- walks_dog ----
test('walks_dog: the assignee of a recent walk or of a group the dog belongs to', async () => {
  const w = async (actor, dog) => { const r = await call(actor, 'walks_dog', { pid: dog }); ok(r, actor); return r.data }
  assert.equal(await w('WALKER_CO', d1), true, 'today walk + group g1')
  assert.equal(await w('WALKER_CO2', d4), true, 'group g2 member, no walk needed')
  for (const [actor, dog] of [['WALKER_CO2', d1], ['WALKER_CO', d4], ['CLIENT', d1], ['OFFICE', d1], ['NOPROFILE', d1], ['OTHER', d1]]) assert.equal(await w(actor, dog), false, `${actor} / ${dog}`)
  const hoy = (n) => new Date(Date.now() - 5 * 36e5 + n * 864e5).toISOString().slice(0, 10)
  for (const [n, want] of [[-1, true], [-3, false]]) {
    const { data: p } = await db().from('prestaciones').insert({ negocio_id: A, perro_id: d2, tipo: 'paseo', cuidador_id: u.WALKER_CO2, fecha: hoy(n), estado: 'finalizado', detalle: { nota: 's4a2 walk' } }).select('id').single()
    assert.equal(await w('WALKER_CO2', d2), want, `walk ${n} days ago`)
    await db().from('prestaciones').delete().eq('id', p.id)
  }
  denied(await call('ANON', 'walks_dog', { pid: d1 }), 'anon')
})

// ---- servicio_guardar ----
test('servicio_guardar: the owner saves a service; prices land in servicios and tarifas', async () => {
  const save = (actor, a) => call(actor, 'servicio_guardar', { p_id: null, p_nombre: 's4a2 svc', p_tipo: 'paseo', p_duracion: 30, p_precio: 15000, p_modelo: 'por_uso', ...a })
  const both = async (id) => ({ s: await one('servicios', 'id', id, 'negocio_id,tipo,nombre,duracion_min,modelo_cobro,precio,precio_mensual'), t: await one('tarifas', 'servicio_id', id, 'negocio_id,precio,precio_mensual') })
  const c = await save('OWNER')
  ok(c, 'create')
  let r = await both(c.data)
  assert.deepEqual(r.s, { negocio_id: A, tipo: 'paseo', nombre: 's4a2 svc', duracion_min: 30, modelo_cobro: 'por_uso', precio: 15000, precio_mensual: 0 })
  assert.deepEqual(r.t, { negocio_id: A, precio: 15000, precio_mensual: 0 })
  ok(await save('OWNER', { p_id: c.data, p_precio: 90000, p_modelo: 'mensual', p_nombre: 's4a2 svc2' }), 'update')
  r = await both(c.data)
  assert.deepEqual([r.s.modelo_cobro, r.s.precio, r.s.precio_mensual, r.s.nombre], ['mensual', 0, 90000, 's4a2 svc2'])
  assert.deepEqual([r.t.precio, r.t.precio_mensual], [0, 90000])
  const snapshot = await both(c.data)
  denied(await save('OTHER', { p_id: c.data, p_precio: 1 }), 'another tenant owner, update')
  for (const actor of ['OFFICE', 'OFFICE_FIN', 'WALKER_CO', 'CLIENT', 'NOPROFILE', 'ANON']) {
    denied(await save(actor, { p_id: c.data, p_precio: 1 }), `${actor} update`)
    denied(await save(actor), `${actor} create`)
  }
  assert.deepEqual(await both(c.data), snapshot)
  assert.equal((await db().from('servicios').select('id').like('nombre', 's4a2 svc%')).data.length, 1, 'denied creates added nothing')
  for (const bad of [{ p_modelo: 'x' }, { p_precio: -1 }, { p_nombre: ' ' }, { p_duracion: -5 }, { p_precio: null }, { p_id: randomUUID() }]) {
    assert.ok((await save('OWNER', bad)).error, JSON.stringify(bad))
  }
  assert.equal((await save('OWNER', { p_tipo: 'zzz' })).error?.code, '23514', 'unknown type hits the table CHECK')
  assert.deepEqual(await both(c.data), snapshot)
})

// ---- catalog ----
test('new functions are SECURITY DEFINER with an empty search_path; trigger functions are closed to every API role', () => {
  const rpcs = ['walks_dog', 'permiso_finanzas_set', 'servicio_guardar', 'contacto_set', 'perro_duenos_nombres', 'cobro_marcar']
  const trig = ['sync_profile_side', 'sync_servicio_tarifa', 'sync_prestacion_cobro', 'sync_perro_identidad']
  const fns = sql(`select proname, prosecdef, coalesce(proconfig @> array['search_path=""'], false) as pinned,
      has_function_privilege('anon', oid, 'execute') as anon, has_function_privilege('authenticated', oid, 'execute') as auth
    from pg_proc where pronamespace = 'public'::regnamespace and proname = any(array[${[...rpcs, ...trig].map((n) => `'${n}'`)}]) order by 1`)
  assert.equal(fns.length, rpcs.length + trig.length)
  for (const f of fns) assert.deepEqual([f.prosecdef, f.pinned, f.anon, f.auth], [true, true, false, rpcs.includes(f.proname)], f.proname)
  const t = sql(`select count(*)::int as n from pg_trigger where not tgisinternal and tgname in ('trg_sync_profile_side','trg_sync_servicio_tarifa','trg_sync_prestacion_cobro','trg_sync_perro_identidad')`)
  assert.equal(t[0].n, 4)
})

// ---- dual-write sync: legacy write path -> side table equal, row for row ----
const PAIRS = [
  ['contactos', 'user_id,negocio_id,rol,telefono', 'profiles', 'id,negocio_id,rol,telefono', (r) => ({ user_id: r.id, negocio_id: r.negocio_id, rol: r.rol, telefono: r.telefono })],
  ['nomina', 'user_id,negocio_id,salario_fijo', 'profiles', 'id,negocio_id,rol,salario_fijo', (r) => ({ user_id: r.id, negocio_id: r.negocio_id, salario_fijo: r.salario_fijo ?? 0 }), (q) => q.neq('rol', 'cliente')],
  ['tarifas', 'servicio_id,negocio_id,precio,precio_mensual', 'servicios', 'id,negocio_id,precio,precio_mensual', (r) => ({ servicio_id: r.id, negocio_id: r.negocio_id, precio: r.precio ?? 0, precio_mensual: r.precio_mensual ?? 0 })],
  ['cobros', 'prestacion_id,negocio_id,precio_aplicado,cobrable,cobrado,confirmado_por,confirmado_at', 'prestaciones', 'id,negocio_id,precio_aplicado,cobrable,cobrado,confirmado_por,confirmado_at',
    (r) => ({ prestacion_id: r.id, negocio_id: r.negocio_id, precio_aplicado: r.precio_aplicado ?? 0, cobrable: r.cobrable ?? false, cobrado: r.cobrado ?? false, confirmado_por: r.confirmado_por, confirmado_at: r.confirmado_at })],
  ['perro_identidad', 'perro_id,microchip', 'perros', 'id,negocio_id,microchip', (r) => ({ perro_id: r.id, microchip: r.microchip }), (q) => q.not('microchip', 'is', null)],
]
async function inSync(step) {
  const tenants = Object.values(ids.negocios)
  for (const [side, sideCols, legacy, legacyCols, map, filter = (q) => q] of PAIRS) {
    const key = Object.keys(map({}))[0]
    const want = (await filter(db().from(legacy).select(legacyCols).in('negocio_id', tenants))).data.map(map)
    const got = (await db().from(side).select(sideCols).in(key, want.map((r) => r[key]))).data
    const scope = (await db().from(legacy).select('id').in('negocio_id', tenants)).data.map((r) => r.id)
    const all = (await db().from(side).select(key).in(key, scope)).data
    const order = (rows) => rows.sort((a, b) => (a[key] < b[key] ? -1 : 1))
    assert.ok(want.length > 0, `${side}: legacy rows exist`)
    assert.deepEqual(order(got), order(want), `${step}: ${side} differs from ${legacy}`)
    assert.equal(all.length, want.length, `${step}: ${side} holds rows with no legacy parent`)
  }
}
const side = async (table, key, id, col) => (await one(table, key, id, col))?.[col]

test('every legacy write path keeps the side tables equal to the legacy columns', async () => {
  const cleanup = []
  const step = async (name, fn) => { await fn(); await inSync(name) }
  try {
    await step('owner edits a salary', async () => {
      ok(await (await as('OWNER')).from('profiles').update({ salario_fijo: 4321 }).eq('id', u.WALKER_CO), 'owner')
      assert.equal(await side('nomina', 'user_id', u.WALKER_CO, 'salario_fijo'), 4321)
    })
    await step('a client edits its phone', async () => {
      ok(await (await as('CLIENT')).from('profiles').update({ telefono: '300-111' }).eq('id', u.CLIENT), 'self')
      assert.equal(await side('contactos', 'user_id', u.CLIENT, 'telefono'), '300-111')
    })
    await step('the service role clears a phone', async () => {
      ok(await db().from('profiles').update({ telefono: null }).eq('id', u.CLIENT))
      assert.equal(await side('contactos', 'user_id', u.CLIENT, 'telefono'), null)
    })
    await step('owner edits and inserts services', async () => {
      const owner = await as('OWNER')
      ok(await owner.from('servicios').update({ precio: 22000 }).eq('id', paseoA), 'price')
      assert.equal(await side('tarifas', 'servicio_id', paseoA, 'precio'), 22000)
      const ins = await owner.from('servicios').insert({ negocio_id: A, tipo: 'comida', nombre: 's4a2 comida', precio: 7000 }).select('id').single()
      ok(ins, 'insert')
      cleanup.push(() => db().from('servicios').delete().eq('id', ins.data.id))
      assert.equal(await side('tarifas', 'servicio_id', ins.data.id, 'precio'), 7000)
      ok(await db().from('servicios').delete().eq('id', ins.data.id))
      assert.equal(await one('tarifas', 'servicio_id', ins.data.id), null, 'deleting the service removes its tarifa')
    })
    await step('owner restores the price', async () => ok(await db().from('servicios').update({ precio: 20000 }).eq('id', paseoA)))
    await step('reservar and comprar_producto', async () => {
      const svc = await db().from('servicios').insert({ negocio_id: A, tipo: 'comida', nombre: 's4a2 comida2', precio: 7000 }).select('id').single()
      cleanup.push(() => db().from('servicios').delete().eq('id', svc.data.id))
      const book = await call('CLIENT', 'reservar', { p_perro: d1, p_servicio: banoA, p_grupo: null, p_fecha: day(4) })
      ok(book, 'reservar')
      assert.equal(await side('cobros', 'prestacion_id', book.data, 'precio_aplicado'), 30000)
      const buy = await call('CLIENT', 'comprar_producto', { p_perro: d1, p_servicio: svc.data.id, p_cantidad: 3 })
      ok(buy, 'comprar')
      assert.equal(await side('cobros', 'prestacion_id', buy.data, 'precio_aplicado'), 21000)
      cleanup.push(() => db().from('prestaciones').delete().in('id', [book.data, buy.data]))
    })
    await step('owner marks a charge paid and deletes a prestacion', async () => {
      const { data: p } = await db().from('prestaciones').insert({ negocio_id: A, perro_id: d2, servicio_id: paseoA, tipo: 'paseo', estado: 'finalizado', fecha: day(-1), detalle: { nota: 's4a2 sync' } }).select('id').single()
      ok(await call('OWNER', 'cobro_marcar', { p_prestacion: p.id }), 'cobro_marcar')
      assert.equal(await side('cobros', 'prestacion_id', p.id, 'cobrado'), true)
      ok(await db().from('prestaciones').delete().eq('id', p.id))
      assert.equal(await one('cobros', 'prestacion_id', p.id), null, 'deleting the prestacion removes its cobro')
    })
    await step('mover_perro generates walks', async () => {
      const dog = await makeDog(u.CLIENT, { history: true })
      cleanup.push(() => dropDog(dog))
      ok(await call('OWNER', 'mover_perro', { p_perro: dog, p_grupo: g1, p_modo: 'siempre', p_fecha: day(1) }), 'mover')
      assert.ok((await db().from('cobros').select('prestacion_id').eq('negocio_id', A).gt('precio_aplicado', -1)).data.length > 0)
    })
    await step('microchips: owner sets, changes and clears', async () => {
      const owner = await as('OWNER')
      for (const chip of ['DDTEST-S4A2-1', 'DDTEST-S4A2-2']) {
        ok(await owner.from('perros').update({ microchip: chip }).eq('id', d2), 'chip')
        assert.equal(await side('perro_identidad', 'perro_id', d2, 'microchip'), chip)
      }
      ok(await owner.from('perros').update({ microchip: null }).eq('id', d2))
      assert.equal(await one('perro_identidad', 'perro_id', d2), null)
    })
    await step('crear_mi_perro and a later chip', async () => {
      const dog = await call('CLIENT', 'crear_mi_perro', { p_nombre: 's4a2 perro' })
      ok(dog, 'crear')
      cleanup.push(() => dropDog(dog.data))
      ok(await db().from('perros').update({ microchip: 'DDTEST-S4A2-3' }).eq('id', dog.data))
      assert.equal(await side('perro_identidad', 'perro_id', dog.data, 'microchip'), 'DDTEST-S4A2-3')
      ok(await dropDog(dog.data))
      assert.equal(await one('perro_identidad', 'perro_id', dog.data), null, 'deleting the dog removes its identity row')
    })
    const gone = async (id) => { for (const t of ['contactos', 'nomina']) assert.equal(await one(t, 'user_id', id), null, `${t} survived its profile`) }
    await step('provision_negocio creates a tenant owner', async () => {
      const t = await tempUser()
      try {
        ok(await t.client.rpc('provision_negocio', { p_rol: 'empresa', p_nombre: 'S4a2 Ana', p_negocio: 'S4a2 SAS', p_telefono: '3009998877' }), 'provision')
        assert.equal(await side('contactos', 'user_id', t.id, 'telefono'), '3009998877')
        assert.notEqual(await one('nomina', 'user_id', t.id), null)
        await inSync('provisioned')
      } finally { await t.drop() }
      await gone(t.id)
    })
    await step('redeem_invite creates a client', async () => {
      const t = await tempUser()
      try {
        const inv = await create('OWNER', 'cliente', t.email)
        ok(inv, 'invite')
        ok(await t.client.rpc('redeem_invite', { p_codigo: inv.data }), 'redeem')
        assert.equal((await one('contactos', 'user_id', t.id)).rol, 'cliente')
        assert.equal(await one('nomina', 'user_id', t.id), null, 'clients have no payroll row')
      } finally { await t.drop() }
      await gone(t.id)
    })
    ok(await db().rpc('backfill_side_tables'), 'backfill still works')
    await inSync('after a second backfill')
  } finally {
    for (const fn of cleanup.reverse()) await fn()
    await db().from('profiles').update({ salario_fijo: 0 }).eq('id', u.WALKER_CO)
  }
})
