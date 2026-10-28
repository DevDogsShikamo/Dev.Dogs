// S2b1 ownership links (N1, P2). Links are written only by crear_mi_perro and the
// owner-only coduenio_agregar / coduenio_quitar; a link can be read as own rows (or by
// the business owner) and never edited, inserted or deleted through the table.
// AH-4a, AH-4b, AH-4c (baseline exploits) live in baseline-data.test.mjs.
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, ids, seed } from './_actors.mjs'
import { dropDog, makeDog } from './_attacks.mjs'

before(() => seed())

const u = ids.users
const { d1, d3, dI } = ids.perros
const denied = (res) => assert.equal(res.error?.code, '42501', `expected permission denied, got ${res.error?.code ?? 'no error'}`)
const links = async (perro) => (await admin().from('perro_duenos').select('dueno_id,rol,estado').eq('perro_id', perro)).data
const add = async (actor, perro, dueno) => (await as(actor)).rpc('coduenio_agregar', { p_perro: perro, p_dueno: dueno })

// A throwaway dog owned by CLIENT so the shared fixtures are never touched.
async function withDog(fn) {
  const dog = await makeDog(u.CLIENT, { history: false })
  try {
    return await fn(dog)
  } finally {
    await dropDog(dog)
  }
}

// ---- the table is read-only for signed-in users -------------------------------------
test('AH-4a: CLIENT2 cannot even move its link to another owner', async () => {
  const res = await (await as('CLIENT2')).from('perro_duenos').update({ dueno_id: u.CLIENT3 }).match({ perro_id: d3, dueno_id: u.CLIENT2 })
  denied(res)
  assert.deepEqual((await links(d3)).map((l) => l.dueno_id), [u.CLIENT2])
})

test('AH-4b: CLIENT2 cannot activate itself as co-owner of d1', async () => {
  denied(await (await as('CLIENT2')).from('perro_duenos').insert({ perro_id: d1, dueno_id: u.CLIENT2, rol: 'co', estado: 'activo' }))
  assert.equal((await links(d1)).some((l) => l.dueno_id === u.CLIENT2), false, 'CLIENT2 is now linked to d1')
  assert.equal(((await (await as('CLIENT2')).from('perros').select('id').eq('id', d1)).data).length, 0, 'CLIENT2 can read d1')
})

test('AH-4c: a co-owner cannot delete its own link either', async () => {
  denied(await (await as('COOWNER')).from('perro_duenos').delete().match({ perro_id: d1, dueno_id: u.COOWNER }))
  assert.equal((await links(d1)).some((l) => l.dueno_id === u.COOWNER && l.rol === 'co'), true, 'the co-owner link was removed')
})

test('AH-4c: even the business owner writes links only through the RPCs', async () => {
  const owner = await as('OWNER')
  try {
    denied(await owner.from('perro_duenos').insert({ perro_id: d3, dueno_id: u.CLIENT3, rol: 'co', estado: 'activo' }))
    denied(await owner.from('perro_duenos').update({ rol: 'principal' }).match({ perro_id: d1, dueno_id: u.COOWNER }))
    denied(await owner.from('perro_duenos').delete().match({ perro_id: d1, dueno_id: u.COOWNER }))
    assert.deepEqual((await links(d1)).map((l) => `${l.dueno_id}:${l.rol}`).sort(), [`${u.CLIENT}:principal`, `${u.COOWNER}:co`].sort())
  } finally {
    await admin().from('perro_duenos').delete().match({ perro_id: d3, dueno_id: u.CLIENT3 })
    await admin().from('perro_duenos').upsert({ perro_id: d1, dueno_id: u.COOWNER, rol: 'co', estado: 'activo' }, { onConflict: 'perro_id,dueno_id' })
  }
})

// ---- AH-4d: the owner-only co-owner functions ----------------------------------------
test('AH-4d: OWNER adds a client of tenant A as active co-owner and removes it', () =>
  withDog(async (dog) => {
    const owner = await as('OWNER')
    assert.equal((await add('OWNER', dog, u.CLIENT3)).error, null)
    assert.deepEqual((await links(dog)).find((l) => l.dueno_id === u.CLIENT3), { dueno_id: u.CLIENT3, rol: 'co', estado: 'activo' })
    assert.equal(((await (await as('CLIENT3')).from('perros').select('id').eq('id', dog)).data).length, 1, 'the co-owner cannot read the dog')

    assert.equal((await owner.rpc('coduenio_quitar', { p_perro: dog, p_dueno: u.CLIENT3 })).error, null)
    assert.equal((await links(dog)).some((l) => l.dueno_id === u.CLIENT3), false)
    assert.equal(((await (await as('CLIENT3')).from('perros').select('id').eq('id', dog)).data).length, 0, 'access survived the removal')
  }))

test('AH-4d: adding the principal as co-owner never downgrades it', () =>
  withDog(async (dog) => {
    assert.equal((await add('OWNER', dog, u.CLIENT)).error, null)
    assert.deepEqual(await links(dog), [{ dueno_id: u.CLIENT, rol: 'principal', estado: 'activo' }])
  }))

test('AH-4d: the principal link cannot be removed through coduenio_quitar', () =>
  withDog(async (dog) => {
    const res = await (await as('OWNER')).rpc('coduenio_quitar', { p_perro: dog, p_dueno: u.CLIENT })
    assert.match(res.error?.message ?? '', /coduenio_inexistente/)
    assert.equal((await links(dog)).length, 1)
  }))

for (const [target, why] of [
  ['CLIENT_I', 'a client of another tenant'],
  ['WALKER_CO', 'a walker'],
  ['OFFICE', 'office staff'],
]) {
  test(`AH-4d: OWNER cannot make ${why} a co-owner`, () =>
    withDog(async (dog) => {
      const res = await add('OWNER', dog, u[target])
      assert.match(res.error?.message ?? '', /dueno_invalido/)
      assert.equal((await links(dog)).length, 1, 'a link was created')
    }))
}

test('AH-4d: OWNER cannot touch a dog of another tenant (same refusal as a missing dog)', async () => {
  denied(await add('OWNER', dI, u.CLIENT3))
  denied(await add('OWNER', '00000000-0000-4000-8000-000000000000', u.CLIENT3))
  assert.equal((await links(dI)).some((l) => l.dueno_id === u.CLIENT3), false)
})

// ---- AH-4e: nobody else can call them ------------------------------------------------
for (const actor of ['CLIENT', 'COOWNER', 'WALKER_CO', 'OFFICE', 'OTHER', 'NOPROFILE', 'ANON']) {
  test(`AH-4e: ${actor} cannot add or remove a co-owner`, async () => {
    denied(await add(actor, d1, u.CLIENT3))
    denied(await (await as(actor)).rpc('coduenio_quitar', { p_perro: d1, p_dueno: u.COOWNER }))
    assert.deepEqual((await links(d1)).map((l) => l.dueno_id).sort(), [u.CLIENT, u.COOWNER].sort())
  })
}

// ---- AH-4f: who reads which links ------------------------------------------------------
const mine = async (actor, filter = (q) => q) => (await filter((await as(actor)).from('perro_duenos').select('perro_id,dueno_id'))).data
const tenantA = [d1, ids.perros.d2, d3, ids.perros.d4, ids.perros.d5]

test('AH-4f: CLIENT reads only its own links', async () => {
  const rows = await mine('CLIENT')
  assert.equal(rows.length, 2)
  assert.deepEqual([...new Set(rows.map((r) => r.dueno_id))], [u.CLIENT])
})

test('AH-4f: OWNER reads every link of its tenant and none of another', async () => {
  const expected = (await admin().from('perro_duenos').select('perro_id,dueno_id').in('perro_id', tenantA)).data
  assert.equal(expected.length, 6)
  const key = (r) => `${r.perro_id}:${r.dueno_id}`
  assert.deepEqual((await mine('OWNER', (q) => q.in('perro_id', tenantA))).map(key).sort(), expected.map(key).sort())
  assert.equal((await admin().from('perro_duenos').select('id').eq('perro_id', dI)).data.length, 1)
  assert.equal((await mine('OWNER', (q) => q.eq('perro_id', dI))).length, 0, 'OWNER sees a link of tenant I')
})

for (const actor of ['WALKER_CO', 'OFFICE', 'OTHER']) {
  test(`AH-4f: ${actor} reads no links of tenant A`, async () => {
    assert.equal((await admin().from('perro_duenos').select('id').in('perro_id', tenantA)).data.length, 6)
    assert.equal((await mine(actor, (q) => q.in('perro_id', tenantA))).length, 0)
  })
}
