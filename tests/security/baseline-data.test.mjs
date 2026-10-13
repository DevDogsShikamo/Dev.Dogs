// SR-2a baseline: data-access exploits that SUCCEED on the legacy schema (C5, C6,
// N1, N2 authenticated half). Each test asserts the DESIRED behaviour (denial)
// and is marked `todo`: visibly failing, suite exits 0. Victims are throwaway
// rows or are restored in `finally`, so a successful exploit never poisons others.
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, ids, seed } from './_actors.mjs'
import { GUARDED_RPCS, attack, dropDog, makeDog } from './_attacks.mjs'

before(() => seed())

const one = async (table, match) => (await admin().from(table).select('*').match(match)).data

// C5 / AH-6a: a walker rewrites price and paid flag of its own prestacion.
test('C5 AH-6a: WALKER_CO cannot edit price or cobrado of p1', { todo: 'fixed in S2b1' }, async () => {
  const p1 = ids.prestaciones.p1
  const before = (await one('prestaciones', { id: p1 }))[0]
  try {
    await (await as('WALKER_CO')).from('prestaciones').update({ precio_aplicado: 1, cobrado: true }).eq('id', p1)
    const after = (await one('prestaciones', { id: p1 }))[0]
    assert.deepEqual(
      { precio: after.precio_aplicado, cobrado: after.cobrado },
      { precio: before.precio_aplicado, cobrado: before.cobrado },
      'price/cobrado were rewritten by the walker',
    )
  } finally {
    await admin().from('prestaciones').update({ precio_aplicado: before.precio_aplicado, cobrado: before.cobrado }).eq('id', p1)
  }
})

// C6 / AH-5a, AH-5b: a client hard-deletes a dog, with or without history.
for (const [id, history, label] of [['AH-5a', true, 'with history and debt'], ['AH-5b', false, 'without history']]) {
  test(`C6 ${id}: CLIENT cannot delete a dog ${label}`, { todo: 'fixed in S2b1' }, async () => {
    const dog = await makeDog(ids.users.CLIENT, { history })
    try {
      await (await as('CLIENT')).from('perros').delete().eq('id', dog)
      assert.equal((await one('perros', { id: dog })).length, 1, 'dog was deleted')
      if (history) assert.equal((await one('prestaciones', { perro_id: dog })).length, 2, 'history cascaded away')
    } finally {
      await dropDog(dog)
    }
  })
}

// N1 / AH-4a: a client repoints its own ownership link at someone else's dog.
test('N1 AH-4a: CLIENT2 cannot repoint its link to d1', { todo: 'fixed in S2b1' }, async () => {
  const { d1, d3 } = ids.perros
  const where = { perro_id: d3, dueno_id: ids.users.CLIENT2 }
  try {
    await (await as('CLIENT2')).from('perro_duenos').update({ perro_id: d1 }).match(where)
    assert.equal((await one('perro_duenos', { perro_id: d1, dueno_id: ids.users.CLIENT2 })).length, 0, 'link now points at d1')
    const { data } = await (await as('CLIENT2')).from('perros').select('id').eq('id', d1)
    assert.equal(data.length, 0, 'CLIENT2 can read d1')
  } finally {
    await admin().from('perro_duenos').update({ perro_id: d3 }).match({ perro_id: d1, dueno_id: ids.users.CLIENT2 })
  }
})

// N1 / AH-4b: a principal owner links an arbitrary user as active owner of the dog.
test('N1 AH-4b: CLIENT cannot link another user to d1', { todo: 'fixed in S2b1' }, async () => {
  const link = { perro_id: ids.perros.d1, dueno_id: ids.users.CLIENT3 }
  try {
    await (await as('CLIENT')).from('perro_duenos').insert({ ...link, rol: 'principal', estado: 'activo' })
    assert.equal((await one('perro_duenos', link)).length, 0, 'CLIENT3 was linked to d1')
  } finally {
    await admin().from('perro_duenos').delete().match(link)
  }
})

// N1 / AH-4c: a co-owner promotes itself to principal owner.
test('N1 AH-4c: COOWNER cannot edit its own link', { todo: 'fixed in S2b1' }, async () => {
  const link = { perro_id: ids.perros.d1, dueno_id: ids.users.COOWNER }
  try {
    await (await as('COOWNER')).from('perro_duenos').update({ rol: 'principal' }).match(link)
    assert.equal((await one('perro_duenos', link))[0].rol, 'co', 'co-owner became principal')
  } finally {
    await admin().from('perro_duenos').update({ rol: 'co' }).match(link)
  }
})

// N2 authenticated half / AH-2b: a signed-in user with no profile runs the group
// RPCs. Their NULL tenant slips through `v_neg <> my_negocio()`.
for (const rpc of GUARDED_RPCS) {
  test(`N2 AH-2b: NOPROFILE cannot execute ${rpc.name}`, async () => {
    const res = await attack(await as('NOPROFILE'), rpc)
    assert.equal(res.damage, null, `no-profile call changed data: ${res.damage}`)
    assert.notEqual(res.error, null, 'call was accepted without error')
  })
}
