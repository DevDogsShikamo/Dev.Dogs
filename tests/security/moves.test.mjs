// S2a non-destructive moves: moving a dog between groups replaces only its future,
// still-`programado`, group-generated walks. Each test builds a throwaway dog so a
// vulnerable run never poisons the shared fixtures.
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, day, ids, seed, writePrestaciones } from './_actors.mjs'
import { dropDog } from './_attacks.mjs'

before(() => seed())

const { A } = ids.negocios
const { g1, g2 } = ids.grupos
const u = ids.users

// A tenant A dog in group g1 with one prestacion of every kind the move must (not) touch.
async function withDog(fn) {
  const db = admin()
  const { data: dog } = await db.from('perros').insert({ negocio_id: A, nombre: 'Victima de mudanza' }).select('id').single()
  try {
    await db.from('grupo_membresias').insert({ grupo_id: g1, perro_id: dog.id, recurrencia: { tipo: 'diario' } })
    const walk = {
      negocio_id: A, perro_id: dog.id, tipo: 'paseo', servicio_id: ids.servicios.paseoA, grupo_id: g1,
      cuidador_id: u.WALKER_CO, precio_aplicado: 20000, cobrable: true, cobrado: false, detalle: { hora: '08:00' },
    }
    const spec = {
      hist: { ...walk, fecha: day(-7), estado: 'finalizado', cobrado: true },
      unpaid: { ...walk, fecha: day(-3), estado: 'finalizado' },
      doneToday: { ...walk, fecha: day(0), estado: 'finalizado', cobrado: true },
      future: { ...walk, fecha: day(7), estado: 'programado' },
      booking: { ...walk, fecha: day(8), estado: 'programado', tipo: 'bano', servicio_id: ids.servicios.banoA, grupo_id: null, cuidador_id: null, precio_aplicado: 30000, detalle: {} },
      inProgress: { ...walk, fecha: day(9), estado: 'en_curso' },
      paidAhead: { ...walk, fecha: day(10), estado: 'programado', cobrado: true },
      clientWalk: { ...walk, fecha: day(11), estado: 'programado', grupo_id: null },
    }
    const names = Object.keys(spec)
    const { data } = await writePrestaciones(Object.values(spec))
    const rows = Object.fromEntries(names.map((n) => [n, data.find((r) => r.fecha === spec[n].fecha && r.tipo === spec[n].tipo)]))
    assert.equal(Object.values(rows).filter(Boolean).length, names.length, 'fixture rows were not created')
    return await fn(dog.id, rows)
  } finally {
    await dropDog(dog.id)
  }
}

const row = async (id) => (await admin().from('prestaciones').select('*').eq('id', id).maybeSingle()).data
const walksOn = async (dog, fecha) => (await admin().from('prestaciones').select('*').eq('perro_id', dog).eq('fecha', fecha).eq('tipo', 'paseo')).data
const move = async (dog, args) =>
  (await as('OWNER')).rpc('mover_perro', { p_perro: dog, p_grupo: g2, p_modo: 'siempre', p_fecha: day(0), ...args })

async function assertUnchanged(rows, names) {
  for (const n of names) assert.deepEqual(await row(rows[n].id), rows[n], `${n} was altered or deleted`)
}

// ---- R3-3 history is never rewritten -------------------------------------------
test('AH-3a: finished and charged rows survive a "siempre" move, including one dated today', () =>
  withDog(async (dog, rows) => {
    const res = await move(dog)
    assert.equal(res.error, null)
    await assertUnchanged(rows, ['hist', 'unpaid', 'doneToday'])
  }))

test('AH-3a: a move dated in the past (the way to wipe history) is rejected and nothing is deleted', () =>
  withDog(async (dog, rows) => {
    const res = await move(dog, { p_fecha: day(-30) })
    assert.match(res.error?.message ?? '', /fecha_invalida/)
    await assertUnchanged(rows, Object.keys(rows))
  }))

test('AH-3b: future programado group walks are replaced by walks of the new group', () =>
  withDog(async (dog, rows) => {
    assert.equal((await move(dog)).error, null)
    assert.equal(await row(rows.future.id), null, 'the old g1 walk was not replaced')
    const replaced = await walksOn(dog, day(7))
    assert.equal(replaced.length, 1)
    assert.deepEqual(
      { grupo: replaced[0].grupo_id, estado: replaced[0].estado, cuidador: replaced[0].cuidador_id },
      { grupo: g2, estado: 'programado', cuidador: u.WALKER_CO2 },
    )
    const link = (await admin().from('grupo_membresias').select('grupo_id').eq('perro_id', dog)).data
    assert.deepEqual(link.map((l) => l.grupo_id), [g2], 'the recurring membership did not move')
    const tomorrow = await walksOn(dog, day(1))
    assert.equal(tomorrow.length, 1, 'no walk was generated for the days after the move')
    assert.equal(tomorrow[0].grupo_id, g2)
  }))

test('AH-3c: a future non-walk booking and a client-booked walk survive a move', () =>
  withDog(async (dog, rows) => {
    assert.equal((await move(dog)).error, null)
    await assertUnchanged(rows, ['booking', 'clientWalk'])
  }))

test('AH-3d: a future en_curso walk and a paid programado walk are untouched and not duplicated', () =>
  withDog(async (dog, rows) => {
    assert.equal((await move(dog)).error, null)
    await assertUnchanged(rows, ['inProgress', 'paidAhead'])
    assert.equal((await walksOn(dog, day(9))).length, 1, 'a second walk was generated over the en_curso one')
    assert.equal((await walksOn(dog, day(10))).length, 1, 'a second walk was generated over the paid one')
  }))

test('AH-3a ("hoy"): moving one day touches only the programado walk, not a finished walk or a booking', () =>
  withDog(async (dog, rows) => {
    const { data: bath } = await admin().from('prestaciones')
      .insert({ ...rows.booking, id: undefined, fecha: day(0), created_at: undefined }).select('*').single()
    const res = await move(dog, { p_modo: 'hoy', p_fecha: day(0) })
    assert.equal(res.error, null)
    assert.deepEqual(await row(bath.id), bath, 'the bath of that day was turned into a walk')
    await assertUnchanged(rows, ['doneToday'])
    assert.equal((await walksOn(dog, day(0))).length, 1, 'a second walk was created beside the finished one')
  }))

test('AH-3b ("hoy"): a programado walk of that day moves to the new group', () =>
  withDog(async (dog, rows) => {
    const res = await move(dog, { p_modo: 'hoy', p_fecha: day(7) })
    assert.equal(res.error, null)
    const moved = await row(rows.future.id)
    assert.deepEqual({ grupo: moved.grupo_id, estado: moved.estado }, { grupo: g2, estado: 'programado' })
    await assertUnchanged(rows, ['hist', 'unpaid', 'doneToday', 'booking', 'inProgress', 'paidAhead'])
  }))
