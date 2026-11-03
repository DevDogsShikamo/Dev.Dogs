// S2b2 server-side pricing (design-derived; booking and purchase also close AH-7b, AH-7e,
// AH-8b). A client books only through `reservar` and buys only through `comprar_producto`;
// the browser never sends a price. The owner marks a charge paid through `cobro_marcar`.
import { after, before, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { admin, as, day, ids, seed, writePrestaciones } from './_actors.mjs'
import { dropDog, makeDog } from './_attacks.mjs'

const u = ids.users
const { A, B } = ids.negocios
const { d1, d2, d3, dB } = ids.perros
const { g1 } = ids.grupos
const { paseoA, banoA } = ids.servicios
const db = () => admin()
// Bogota calendar day (UTC-5, no DST), the clock the RPCs use. `day()` in _actors is UTC.
const hoy = (n = 0) => new Date(Date.now() - 5 * 36e5 + n * 864e5).toISOString().slice(0, 10)
const denied = (res) => assert.equal(res.error?.code, '42501', `expected permission denied, got ${res.error?.code ?? 'no error'}`)
const refused = (res, message) => {
  assert.equal(res.error?.code, 'P0001', `expected a raised error, got ${res.error?.code ?? 'no error'}`)
  assert.match(res.error.message, message)
}
// A booking with its charge flattened in: money lives in `cobros` since S4b.
const row = async (id) => {
  const r = (await db().from('prestaciones').select('*, cobros(*)').eq('id', id).single()).data
  return { ...r.cobros, ...r, cobros: undefined }
}
const count = async (perro) => (await db().from('prestaciones').select('id', { count: 'exact', head: true }).eq('perro_id', perro)).count

// Throwaway catalogue rows (fixed ids so a crashed run is cleaned by the next one).
const S = { comida: 'comida', accesorio: 'accesorio', bano: 'bano', mensual: 'mensual', inactivo: 'inactivo', foraneo: 'foraneo', comidaB: 'comidaB' }
const sid = Object.fromEntries(Object.keys(S).map((k, i) => [k, `0d0d0d05-0000-4000-8000-0000000000${String(50 + i)}`]))
const gB = '0d0d0d04-0000-4000-8000-000000000050'
const svc = (key, negocio_id, tipo, precio, extra = {}) => ({ id: sid[key], negocio_id, tipo, nombre: `pricing ${key}`, precio, modelo_cobro: 'por_uso', precio_mensual: 0, activo: true, ...extra })

async function cleanup() {
  const keep = Object.values(ids.prestaciones)
  await db().from('prestaciones').delete().in('perro_id', [d1, d2, d3, dB]).not('id', 'in', `(${keep.join(',')})`)
  await db().from('grupos').delete().eq('id', gB)
  await db().from('servicios').delete().in('id', Object.values(sid))
}
before(async () => {
  await seed()
  await cleanup()
  const rows = [
    svc('comida', A, 'comida', 7000), svc('accesorio', A, 'accesorio', 15000), svc('bano', A, 'bano', 4000),
    svc('mensual', A, 'bano', 0, { modelo_cobro: 'mensual', precio_mensual: 90000 }),
    svc('inactivo', A, 'bano', 4000, { activo: false }), svc('foraneo', B, 'bano', 100), svc('comidaB', B, 'comida', 100),
  ]
  const r = await db().from('servicios').insert(rows.map(({ precio, precio_mensual, ...service }) => service))
  assert.equal(r.error, null, r.error?.message)
  const t = await db().from('tarifas').insert(rows.map((x) => ({ servicio_id: x.id, negocio_id: x.negocio_id, precio: x.precio, precio_mensual: x.precio_mensual })))
  assert.equal(t.error, null, t.error?.message)
  const g = await db().from('grupos').insert({ id: gB, negocio_id: B, nombre: 'GB', servicio_id: paseoA, hora: '09:00' })
  assert.equal(g.error, null, g.error?.message)
})
after(cleanup)

// ---- reservar: allowed (AH-7b, AH-8b) and priced by the server --------------------------------
const bookings = [
  { actor: 'CLIENT', perro: d1, servicio: paseoA, grupo: g1, tipo: 'paseo', cuidador: u.WALKER_CO, precio: 20000, hora: '08:00' },
  { actor: 'COOWNER', perro: d1, servicio: banoA, grupo: null, tipo: 'bano', cuidador: null, precio: 30000, hora: undefined },
  { actor: 'CLIENT', perro: d2, servicio: sid.bano, grupo: null, tipo: 'bano', cuidador: null, precio: 4000, hora: undefined },
]
for (const b of bookings) {
  test(`AH-7b/8b: ${b.actor} books ${b.tipo} for ${b.perro === d1 ? 'd1' : 'd2'}; type, assignee, hour and price come from the catalogue`, async () => {
    const fecha = day(3)
    const res = await (await as(b.actor)).rpc('reservar', { p_perro: b.perro, p_servicio: b.servicio, p_grupo: b.grupo, p_fecha: fecha })
    assert.equal(res.error, null, res.error?.message)
    const r = await row(res.data)
    assert.deepEqual(
      { negocio_id: r.negocio_id, perro_id: r.perro_id, servicio_id: r.servicio_id, grupo_id: r.grupo_id, tipo: r.tipo, cuidador_id: r.cuidador_id },
      { negocio_id: A, perro_id: b.perro, servicio_id: b.servicio, grupo_id: b.grupo, tipo: b.tipo, cuidador_id: b.cuidador },
    )
    assert.deepEqual(
      { fecha: r.fecha, estado: r.estado, precio: r.precio_aplicado, cobrable: r.cobrable, cobrado: r.cobrado, por: r.confirmado_por, hora: r.detalle.hora },
      { fecha, estado: 'programado', precio: b.precio, cobrable: true, cobrado: false, por: null, hora: b.hora },
    )
  })
}

test('reservar prices from the live catalogue, and a monthly service is not charged per use', async () => {
  await db().from('tarifas').update({ precio: 4500 }).eq('servicio_id', sid.bano)
  const client = await as('CLIENT')
  const per = await client.rpc('reservar', { p_perro: d2, p_servicio: sid.bano, p_grupo: null, p_fecha: day(4) })
  const men = await client.rpc('reservar', { p_perro: d2, p_servicio: sid.mensual, p_grupo: null, p_fecha: day(4) })
  assert.equal(per.error ?? men.error, null)
  assert.equal((await row(per.data)).precio_aplicado, 4500)
  const m = await row(men.data)
  assert.deepEqual([m.precio_aplicado, m.cobrable], [0, false])
  await db().from('tarifas').update({ precio: 4000 }).eq('servicio_id', sid.bano)
})

test('the browser cannot send a price: reservar and comprar_producto take no price argument', async () => {
  const client = await as('CLIENT')
  const book = await client.rpc('reservar', { p_perro: d1, p_servicio: paseoA, p_grupo: null, p_fecha: day(3), p_precio: 1 })
  const buy = await client.rpc('comprar_producto', { p_perro: d1, p_servicio: sid.comida, p_cantidad: 1, p_precio: 1 })
  assert.deepEqual([book.error?.code, buy.error?.code], ['PGRST202', 'PGRST202'])
  // The same calls without the extra argument are valid, so the refusal above is about the price.
  const ok1 = await client.rpc('reservar', { p_perro: d1, p_servicio: paseoA, p_grupo: null, p_fecha: day(3) })
  const ok2 = await client.rpc('comprar_producto', { p_perro: d1, p_servicio: sid.comida, p_cantidad: 1 })
  assert.equal(ok1.error ?? ok2.error, null)
})

// ---- reservar: denied / invalid ----------------------------------------------------------------
for (const actor of ['CLIENT2', 'OTHER', 'OWNER', 'WALKER_CO', 'NOPROFILE', 'ANON']) {
  test(`reservar: ${actor} cannot book a dog it does not own`, async () => {
    const before = await count(d1)
    denied(await (await as(actor)).rpc('reservar', { p_perro: d1, p_servicio: paseoA, p_grupo: g1, p_fecha: day(3) }))
    assert.equal(await count(d1), before)
  })
}

const base = { p_perro: d1, p_servicio: banoA, p_grupo: null, p_fecha: day(3) }
for (const [name, patch, message] of [
  ['a service of another tenant', { p_servicio: sid.foraneo }, /servicio_invalido/],
  ['an inactive service', { p_servicio: sid.inactivo }, /servicio_invalido/],
  ['a product (those go through comprar_producto)', { p_servicio: sid.comida }, /servicio_invalido/],
  ['no service', { p_servicio: null }, /servicio_invalido/],
  ['a group of another tenant', { p_servicio: paseoA, p_grupo: gB }, /grupo_invalido/],
  ['a group that offers a different service', { p_grupo: g1 }, /grupo_invalido/],
  ['a past date', { p_fecha: day(-3) }, /fecha_invalida/],
  ['no date', { p_fecha: null }, /fecha_invalida/],
  ['a date over a year away', { p_fecha: day(400) }, /fecha_invalida/],
]) {
  test(`reservar refuses ${name}`, async () => {
    const before = await count(d1)
    refused(await (await as('CLIENT')).rpc('reservar', { ...base, ...patch }), message)
    assert.equal(await count(d1), before)
  })
}

test('reservar and comprar_producto refuse a dog the business has deactivated', async () => {
  const dog = await makeDog(u.CLIENT, { history: false })
  try {
    await db().from('perros').update({ activo: false }).eq('id', dog)
    const client = await as('CLIENT')
    refused(await client.rpc('reservar', { ...base, p_perro: dog }), /perro_invalido/)
    refused(await client.rpc('comprar_producto', { p_perro: dog, p_servicio: sid.comida, p_cantidad: 1 }), /perro_invalido/)
    assert.equal(await count(dog), 0)
  } finally {
    await dropDog(dog)
  }
})

// ---- comprar_producto (AH-7e) ------------------------------------------------------------------
test('AH-7e: the principal buys products; the price is catalogue price x quantity, charged today', async () => {
  const client = await as('CLIENT')
  for (const [servicio, tipo, qty, total] of [[sid.comida, 'comida', 3, 21000], [sid.accesorio, 'accesorio', 1, 15000], [sid.comida, 'comida', 20, 140000]]) {
    const res = await client.rpc('comprar_producto', { p_perro: d1, p_servicio: servicio, p_cantidad: qty })
    assert.equal(res.error, null, res.error?.message)
    const r = await row(res.data)
    assert.deepEqual(
      { negocio_id: r.negocio_id, perro_id: r.perro_id, servicio_id: r.servicio_id, tipo: r.tipo, estado: r.estado, fecha: r.fecha, cuidador: r.cuidador_id },
      { negocio_id: A, perro_id: d1, servicio_id: servicio, tipo, estado: 'finalizado', fecha: hoy(), cuidador: null },
    )
    assert.deepEqual(
      { precio: r.precio_aplicado, cobrable: r.cobrable, cobrado: r.cobrado, cantidad: r.detalle.cantidad },
      { precio: total, cobrable: true, cobrado: false, cantidad: qty },
    )
  }
})

test('AH-7e: COOWNER cannot purchase for d1, and neither can a stranger', async () => {
  for (const actor of ['COOWNER', 'CLIENT2', 'OTHER', 'OWNER', 'WALKER_CO', 'NOPROFILE', 'ANON']) {
    const before = await count(d1)
    denied(await (await as(actor)).rpc('comprar_producto', { p_perro: d1, p_servicio: sid.comida, p_cantidad: 1 }))
    assert.equal(await count(d1), before, `${actor} created a purchase`)
  }
})

for (const [name, patch, message] of [
  ['quantity 0', { p_cantidad: 0 }, /cantidad_invalida/],
  ['quantity 21', { p_cantidad: 21 }, /cantidad_invalida/],
  ['a negative quantity', { p_cantidad: -2 }, /cantidad_invalida/],
  ['no quantity', { p_cantidad: null }, /cantidad_invalida/],
  ['a walk (only comida|accesorio are products)', { p_servicio: paseoA }, /servicio_invalido/],
  ['a product of another tenant', { p_servicio: sid.comidaB }, /servicio_invalido/],
  ['an unknown service', { p_servicio: '0d0d0d05-0000-4000-8000-0000000000ff' }, /servicio_invalido/],
]) {
  test(`comprar_producto refuses ${name}`, async () => {
    const before = await count(d1)
    refused(await (await as('CLIENT')).rpc('comprar_producto', { p_perro: d1, p_servicio: sid.comida, p_cantidad: 1, ...patch }), message)
    assert.equal(await count(d1), before)
  })
}

// ---- direct inserts stay closed to clients; the owner is re-priced by the trigger --------------
for (const actor of ['CLIENT', 'COOWNER', 'WALKER_CO']) {
  test(`${actor} cannot insert into prestaciones, whatever price or state it sends`, async () => {
    const before = await count(d1)
    const forged = { negocio_id: A, perro_id: d1, servicio_id: paseoA, tipo: 'paseo', estado: 'finalizado', fecha: day(3) }
    denied(await (await as(actor)).from('prestaciones').insert(forged))
    assert.equal(await count(d1), before)
  })
}

test('prestacion_cobro: an owner-created entry gets its charge from the catalogue, unpaid, and the API has no price column to send', async () => {
  const owner = await as('OWNER')
  const forged = await owner.from('prestaciones').insert({ negocio_id: A, perro_id: d2, servicio_id: paseoA, tipo: 'paseo', precio_aplicado: 1, fecha: day(3) })
  assert.ok(forged.error, 'precio_aplicado is not a prestaciones column any more')
  const res = await owner.from('prestaciones').insert({ negocio_id: A, perro_id: d2, servicio_id: paseoA, tipo: 'paseo', fecha: day(3) }).select('id').single()
  assert.equal(res.error, null, res.error?.message)
  const r = await row(res.data.id)
  assert.deepEqual([r.precio_aplicado, r.cobrable, r.cobrado, r.confirmado_por, r.confirmado_at], [20000, true, false, null, null])
  const bulk = await owner.from('prestaciones')
    .insert({ negocio_id: A, perro_id: d2, servicio_id: sid.comida, tipo: 'comida', detalle: { cantidad: 4 }, fecha: day(3) })
    .select('id').single()
  assert.equal((await row(bulk.data.id)).precio_aplicado, 28000)
})

// ---- cobro_marcar --------------------------------------------------------------------------------
async function charge(fn, patch = {}) {
  const r = await writePrestaciones({ negocio_id: A, perro_id: d2, servicio_id: paseoA, tipo: 'paseo', estado: 'finalizado', precio_aplicado: 20000, fecha: day(-1), ...patch })
  return fn(r.data[0].id, await row(r.data[0].id))
}

test('cobro_marcar: the owner marks a finished charge paid; who and when come from the server', () =>
  charge(async (id) => {
    const t0 = Date.now()
    const res = await (await as('OWNER')).rpc('cobro_marcar', { p_prestacion: id })
    assert.equal(res.error, null, res.error?.message)
    const r = await row(id)
    assert.deepEqual([r.cobrado, r.confirmado_por, r.precio_aplicado], [true, u.OWNER, 20000])
    assert.ok(Math.abs(new Date(r.confirmado_at).getTime() - t0) < 120000, `confirmado_at ${r.confirmado_at} is not the server clock`)
    // A replay keeps the first confirmation.
    assert.equal((await (await as('OWNER')).rpc('cobro_marcar', { p_prestacion: id })).error, null)
    assert.equal((await row(id)).confirmado_at, r.confirmado_at)
  }))

test('cobro_marcar takes no caller-chosen timestamp or confirming user', () =>
  charge(async (id, before) => {
    const res = await (await as('OWNER')).rpc('cobro_marcar', { p_prestacion: id, p_confirmado_por: u.CLIENT, p_confirmado_at: '2000-01-01' })
    assert.equal(res.error?.code, 'PGRST202')
    assert.deepEqual(await row(id), before)
    assert.equal((await (await as('OWNER')).rpc('cobro_marcar', { p_prestacion: id })).error, null, 'the plain call is valid')
  }))

for (const actor of ['CLIENT', 'COOWNER', 'WALKER_CO', 'OFFICE', 'OTHER', 'NOPROFILE', 'ANON']) {
  test(`cobro_marcar: ${actor} cannot mark a charge of tenant A paid`, () =>
    charge(async (id, before) => {
      denied(await (await as(actor)).rpc('cobro_marcar', { p_prestacion: id }))
      assert.deepEqual(await row(id), before)
    }))
}

test('cobro_marcar refuses what is not a payable charge, and an unknown id looks like a foreign one', async () => {
  const owner = await as('OWNER')
  await charge(async (id) => refused(await owner.rpc('cobro_marcar', { p_prestacion: id }), /no_cobrable/), { estado: 'programado' })
  await charge(async (id) => refused(await owner.rpc('cobro_marcar', { p_prestacion: id }), /no_cobrable/), { cobrable: false })
  denied(await owner.rpc('cobro_marcar', { p_prestacion: '0d0d0d06-0000-4000-8000-0000000000ff' }))
})

// ---- money sanity ----------------------------------------------------------------------------------
for (const [table, key, id, patch] of [
  ['cobros', 'prestacion_id', ids.prestaciones.p1, { precio_aplicado: -1 }],
  ['tarifas', 'servicio_id', paseoA, { precio: -1 }],
  ['tarifas', 'servicio_id', paseoA, { precio_mensual: -1 }],
]) {
  test(`money: a negative amount in ${table}.${Object.keys(patch)[0]} violates a CHECK and changes nothing`, async () => {
    const before = (await db().from(table).select('*').eq(key, id).single()).data
    const res = await db().from(table).update(patch).eq(key, id)
    assert.equal(res.error?.code, '23514', `expected check_violation, got ${res.error?.code ?? 'no error'}`)
    assert.deepEqual((await db().from(table).select('*').eq(key, id).single()).data, before)
  })
}

test('money: a negative monthly price in suscripciones violates a CHECK', async () => {
  const id = randomUUID()
  try {
    const res = await db().from('suscripciones').insert({ id, negocio_id: A, perro_id: d1, servicio_id: paseoA, precio_mensual: -1 })
    assert.equal(res.error?.code, '23514', `expected check_violation, got ${res.error?.code ?? 'no error'}`)
  } finally {
    await db().from('suscripciones').delete().eq('id', id)
  }
})
