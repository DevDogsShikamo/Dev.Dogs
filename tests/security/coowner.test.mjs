// S2b1 co-owner powers (D13, P2): a co-owner reads the dog and its bookings and nothing
// else. Booking and purchase (AH-7b, AH-7e) arrive with the pricing RPCs in S2b2.
// Adding/removing co-owners (AH-7c, second half) is covered by AH-4e in perro-duenos.test.mjs.
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, ids, seed } from './_actors.mjs'

before(() => seed())

const { d1 } = ids.perros
const p = ids.prestaciones
const ownedRows = async (id) => (await admin().from('prestaciones').select('*').eq('id', id).single()).data

test('AH-7a: COOWNER reads d1 and every prestacion of d1', async () => {
  const co = await as('COOWNER')
  assert.deepEqual((await co.from('perros').select('id,nombre')).data, [{ id: d1, nombre: 'Rex' }])
  const seen = (await co.from('prestaciones').select('id').eq('perro_id', d1)).data.map((r) => r.id).sort()
  assert.deepEqual(seen, [p.p1, p.hist, p.unpaid, p.future, p.nonWalk].sort())
})

test('AH-7c: COOWNER cannot edit d1', async () => {
  const before = (await admin().from('perros').select('*').eq('id', d1).single()).data
  try {
    const res = await (await as('COOWNER')).from('perros').update({ nombre: 'Robado', activo: false }).eq('id', d1).select('id')
    assert.deepEqual(res.data, [])
  } finally {
    await admin().from('perros').update(before).eq('id', d1)
  }
  assert.equal((await admin().from('perros').select('nombre,activo').eq('id', d1).single()).data.nombre, 'Rex')
})

// AH-7d, and the same for the principal: bookings are changed by the business, not by owners.
for (const actor of ['COOWNER', 'CLIENT']) {
  test(`AH-7d: ${actor} cannot cancel, edit or delete an existing booking of d1`, async () => {
    const before = await ownedRows(p.nonWalk)
    const client = await as(actor)
    assert.equal((await client.from('prestaciones').select('id').eq('id', p.nonWalk)).data.length, 1, 'the booking must be visible to the owner')
    try {
      for (const patch of [{ estado: 'cancelado' }, { fecha: '2099-01-01' }, { servicio_id: ids.servicios.paseoA }, { detalle: { x: 1 } }]) {
        const res = await client.from('prestaciones').update(patch).eq('id', p.nonWalk).select('id')
        assert.deepEqual(res.data, [], `${Object.keys(patch)[0]}: the update matched the booking`)
      }
      assert.deepEqual((await client.from('prestaciones').delete().eq('id', p.nonWalk).select('id')).data, [])
    } finally {
      await admin().from('prestaciones').upsert(before)
    }
    assert.deepEqual(await ownedRows(p.nonWalk), before)
  })
}
