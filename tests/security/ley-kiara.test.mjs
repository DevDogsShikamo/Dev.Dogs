// Ley 2480 de 2025 (Ley Kiara), enforced by the database whatever the path that writes the walk:
//   art. 9.6 - no more than eight (8) dogs per walker on one outing (same walker, date and time);
//   art. 9.7 - no walk or daycare for a female in heat (perros.en_celo);
//   art. 7   - no daycare, hotel or training for a female in heat nor for a dog with an infectious-contagious
//              disease (perros.enfermedad_contagiosa); walks are held back the same way;
//   art. 9.3 - the health certificate date is recorded (perros.certificado_salud), valid six months.
// Throwaway dogs in tenant A on a far-away date keep the seeded fixtures untouched.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, day, ids, seed } from './_actors.mjs'

const A = ids.negocios.A
const u = ids.users
const FECHA = day(300)
const HORA = '06:30'
const dogs = []
const walks = []

before(async () => {
  await seed()
  const { data, error } = await admin().from('perros')
    .insert(Array.from({ length: 10 }, (_, i) => ({ negocio_id: A, nombre: `Kiara ${i + 1}` }))).select('id')
  assert.equal(error, null)
  dogs.push(...data.map((d) => d.id))
}, { timeout: 120_000 })

after(async () => {
  await admin().from('prestaciones').delete().in('perro_id', dogs)
  await admin().from('perros').delete().in('id', dogs)
})

const walk = (perro, over = {}) => ({
  negocio_id: A, perro_id: perro, tipo: 'paseo', servicio_id: ids.servicios.paseoA, cuidador_id: u.WALKER_CO,
  fecha: FECHA, estado: 'programado', detalle: { hora: HORA }, ...over,
})
async function insertWalk(perro, over) {
  const res = await admin().from('prestaciones').insert(walk(perro, over)).select('id').single()
  if (res.data) walks.push(res.data.id)
  return res
}

// ---- art. 9.6: eight dogs per walker and outing ------------------------------------------------------
test('K-1a: a walker takes up to eight dogs on one outing; the ninth is rejected', async () => {
  for (const d of dogs.slice(0, 8)) assert.equal((await insertWalk(d)).error, null)
  const ninth = await insertWalk(dogs[8])
  assert.match(ninth.error?.message ?? '', /paseador_lleno/)
})

test('K-1b: the same walker at another time, or another walker at the same time, is a different outing', async () => {
  assert.equal((await insertWalk(dogs[8], { detalle: { hora: '16:00' } })).error, null)
  assert.equal((await insertWalk(dogs[9], { cuidador_id: u.WALKER_CO2 })).error, null)
})

test('K-1c: moving a walk into a full outing (changing walker or time) is rejected too', async () => {
  const other = (await admin().from('prestaciones').select('id').eq('perro_id', dogs[9]).eq('fecha', FECHA).single()).data
  const res = await admin().from('prestaciones').update({ cuidador_id: u.WALKER_CO }).eq('id', other.id).select('id')
  assert.match(res.error?.message ?? '', /paseador_lleno/)
})

test('K-1d: a dog that did not go out or a cancelled walk frees its place', async () => {
  const first = (await admin().from('prestaciones').select('id').eq('perro_id', dogs[0]).eq('fecha', FECHA).eq('detalle->>hora', HORA).single()).data
  assert.equal((await admin().from('prestaciones').update({ estado: 'no_asistio' }).eq('id', first.id)).error, null)
  const other = (await admin().from('prestaciones').select('id').eq('perro_id', dogs[9]).eq('fecha', FECHA).single()).data
  assert.equal((await admin().from('prestaciones').update({ cuidador_id: u.WALKER_CO }).eq('id', other.id)).error, null)
})

test('K-1e: other services (a bath) are not walks and are not counted', async () => {
  const res = await insertWalk(dogs[8], { tipo: 'bano', servicio_id: ids.servicios.banoA })
  assert.equal(res.error, null)
})

// ---- art. 9.7: no walk for a female in heat ---------------------------------------------------------------
test('K-2a: only the business owner marks a dog in heat; the walker and the client cannot', async () => {
  const dog = ids.perros.d1
  for (const who of ['WALKER_CO', 'CLIENT']) {
    await (await as(who)).from('perros').update({ en_celo: true }).eq('id', dog)
    assert.equal((await admin().from('perros').select('en_celo').eq('id', dog).single()).data.en_celo, false, who)
  }
  assert.equal((await (await as('OWNER')).from('perros').update({ en_celo: true }).eq('id', dogs[1])).error, null)
  assert.equal((await admin().from('perros').select('en_celo').eq('id', dogs[1]).single()).data.en_celo, true)
})

test('K-2b: starting the outing leaves the dog in heat at home and starts the others', async () => {
  const hoy = day(0)
  const inHeat = await insertWalk(dogs[1], { fecha: hoy, detalle: { hora: '05:00' } })
  const fine = await insertWalk(dogs[2], { fecha: hoy, detalle: { hora: '05:00' } })
  const res = await (await as('WALKER_CO')).rpc('paseo_marcar', { p_ids: [inHeat.data.id, fine.data.id], p_estado: 'en_curso' })
  assert.equal(res.error, null, 'the batch does not fail because of one dog')
  const rows = (await admin().from('prestaciones').select('id, estado').in('id', [inHeat.data.id, fine.data.id])).data
  assert.equal(rows.find((r) => r.id === inHeat.data.id).estado, 'programado')
  assert.equal(rows.find((r) => r.id === fine.data.id).estado, 'en_curso')
})

test('K-2c: a walk or daycare cannot be written as already started for a dog in heat', async () => {
  const res = await insertWalk(dogs[1], { fecha: day(1), estado: 'en_curso', detalle: { hora: '05:00' } })
  assert.match(res.error?.message ?? '', /perro_en_celo/)
  const daycare = await insertWalk(dogs[1], { fecha: day(1), estado: 'recibido', tipo: 'guarderia', cuidador_id: null, detalle: {} })
  assert.match(daycare.error?.message ?? '', /perro_en_celo/)
})

test('K-2e: training is not started for a dog in heat either (art. 7)', async () => {
  const started = await insertWalk(dogs[1], { fecha: day(1), estado: 'en_curso', tipo: 'adiestramiento', cuidador_id: null, detalle: {} })
  assert.match(started.error?.message ?? '', /perro_en_celo/)
  const booked = await insertWalk(dogs[1], { fecha: day(1), tipo: 'adiestramiento', cuidador_id: null, detalle: {} })
  assert.equal(booked.error, null)
  await admin().from('prestaciones').update({ estado: 'en_curso' }).eq('id', booked.data.id)
  assert.equal((await admin().from('prestaciones').select('estado').eq('id', booked.data.id).single()).data.estado, 'programado')
})

test('K-2d: once the heat is over the dog goes out again', async () => {
  await (await as('OWNER')).from('perros').update({ en_celo: false }).eq('id', dogs[1])
  const w = await insertWalk(dogs[1], { fecha: day(0), detalle: { hora: '04:00' } })
  assert.equal((await (await as('WALKER_CO')).rpc('paseo_marcar', { p_ids: [w.data.id], p_estado: 'en_curso' })).error, null)
  assert.equal((await admin().from('prestaciones').select('estado').eq('id', w.data.id).single()).data.estado, 'en_curso')
})

// ---- art. 7: no walk, daycare or training for a dog with an infectious-contagious disease -----------------
test('K-4a: only the business owner marks a dog with a contagious disease; the walker and the client cannot', async () => {
  const dog = ids.perros.d1
  for (const who of ['WALKER_CO', 'CLIENT']) {
    await (await as(who)).from('perros').update({ enfermedad_contagiosa: true }).eq('id', dog)
    assert.equal((await admin().from('perros').select('enfermedad_contagiosa').eq('id', dog).single()).data.enfermedad_contagiosa, false, who)
  }
  assert.equal((await (await as('OWNER')).from('perros').update({ enfermedad_contagiosa: true }).eq('id', dogs[4])).error, null)
  assert.equal((await admin().from('perros').select('enfermedad_contagiosa').eq('id', dogs[4]).single()).data.enfermedad_contagiosa, true)
})

test('K-4b: a walk, daycare or training cannot be written as already started for a contagious dog', async () => {
  for (const over of [
    { estado: 'en_curso' },
    { estado: 'recibido', tipo: 'guarderia', cuidador_id: null, detalle: {} },
    { estado: 'en_curso', tipo: 'adiestramiento', cuidador_id: null, detalle: {} },
  ]) {
    const res = await insertWalk(dogs[4], { fecha: day(1), detalle: { hora: '05:00' }, ...over })
    assert.match(res.error?.message ?? '', /perro_enfermo/, over.tipo ?? 'paseo')
  }
})

test('K-4c: starting the outing leaves the contagious dog at home and starts the others', async () => {
  const hoy = day(0)
  const sick = await insertWalk(dogs[4], { fecha: hoy, detalle: { hora: '03:00' } })
  const fine = await insertWalk(dogs[5], { fecha: hoy, detalle: { hora: '03:00' } })
  const res = await (await as('WALKER_CO')).rpc('paseo_marcar', { p_ids: [sick.data.id, fine.data.id], p_estado: 'en_curso' })
  assert.equal(res.error, null, 'the batch does not fail because of one dog')
  const rows = (await admin().from('prestaciones').select('id, estado').in('id', [sick.data.id, fine.data.id])).data
  assert.equal(rows.find((r) => r.id === sick.data.id).estado, 'programado')
  assert.equal(rows.find((r) => r.id === fine.data.id).estado, 'en_curso')
})

test('K-4d: once healed the dog goes out again', async () => {
  await (await as('OWNER')).from('perros').update({ enfermedad_contagiosa: false }).eq('id', dogs[4])
  const w = await insertWalk(dogs[4], { fecha: day(0), detalle: { hora: '02:00' } })
  assert.equal((await (await as('WALKER_CO')).rpc('paseo_marcar', { p_ids: [w.data.id], p_estado: 'en_curso' })).error, null)
  assert.equal((await admin().from('prestaciones').select('estado').eq('id', w.data.id).single()).data.estado, 'en_curso')
})

// ---- art. 9.3: health certificate ----------------------------------------------------------------------
test('K-3a: the owner records the certificate date; the walker and the dog owner can read it; nobody else edits it', async () => {
  const dog = ids.perros.d1
  const fecha = day(-30)
  assert.equal((await (await as('OWNER')).from('perros').update({ certificado_salud: fecha }).eq('id', dog)).error, null)
  try {
    const walker = (await (await as('WALKER_CO')).from('perros').select('certificado_salud').eq('id', dog).maybeSingle()).data
    assert.equal(walker?.certificado_salud, fecha, 'the walker of the dog sees it')
    const client = (await (await as('CLIENT')).from('perros').select('certificado_salud').eq('id', dog).maybeSingle()).data
    assert.equal(client?.certificado_salud, fecha, 'the dog owner sees it')
    await (await as('CLIENT')).from('perros').update({ certificado_salud: day(0) }).eq('id', dog)
    assert.equal((await admin().from('perros').select('certificado_salud').eq('id', dog).single()).data.certificado_salud, fecha)
  } finally {
    await admin().from('perros').update({ certificado_salud: null }).eq('id', dog)
  }
})

test('K-3b: a certificate dated in the future or before 2000 is rejected', async () => {
  const owner = await as('OWNER')
  assert.equal((await owner.from('perros').update({ certificado_salud: day(2) }).eq('id', dogs[3])).error?.code, '23514')
  assert.equal((await owner.from('perros').update({ certificado_salud: '1999-12-31' }).eq('id', dogs[3])).error?.code, '23514')
})
