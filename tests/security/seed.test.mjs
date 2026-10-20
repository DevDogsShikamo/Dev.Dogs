// SR-1a: every actor obtains a session and sees the baseline data.
// Assertions are limited to facts that stay true after hardening (own rows,
// tenant rows, assigned rows), so this file stays green through the chain.
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { ACTORS, ids, as, seed } from './_actors.mjs'

before(() => seed())

const pick = (rows, key = 'id') => rows.map((r) => r[key]).sort()
const sorted = (...v) => v.sort()
const rows = async (client, table, cols = 'id') => {
  const { data, error } = await client.from(table).select(cols)
  assert.equal(error, null, `${table}: ${error?.message}`)
  return data
}

test('every non-anonymous actor signs in as the right user', async () => {
  for (const name of Object.keys(ACTORS)) {
    const { data, error } = await (await as(name)).auth.getUser()
    assert.equal(error, null, `${name}: ${error?.message}`)
    assert.equal(data.user.id, ids.users[name], name)
  }
})

test('ANON has no session and reads no tenant data', async () => {
  const anon = await as('ANON')
  assert.equal((await anon.auth.getSession()).data.session, null)
  assert.deepEqual(await rows(anon, 'negocios'), [])
})

// What NOPROFILE may read in negocios is the C2 exploit (baseline-identity), not baseline data.
test('NOPROFILE is authenticated but has no profile and no tenant data', async () => {
  const c = await as('NOPROFILE')
  assert.deepEqual(await rows(c, 'profiles'), [])
  assert.deepEqual(await rows(c, 'perros'), [])
})

test('profiles carry the seeded role and tenant', async () => {
  for (const [name, a] of Object.entries(ACTORS)) {
    if (!a.rol) continue
    const { data } = await (await as(name)).from('profiles').select('rol, negocio_id').eq('id', ids.users[name]).single()
    assert.deepEqual(data, { rol: a.rol, negocio_id: ids.negocios[a.neg] }, name)
  }
})

test('clients see exactly their own dogs; the co-owner sees d1 as co', async () => {
  const dogs = async (name) => pick(await rows(await as(name), 'perros'))
  assert.deepEqual(await dogs('CLIENT'), sorted(ids.perros.d1, ids.perros.d2))
  assert.deepEqual(await dogs('CLIENT2'), sorted(ids.perros.d3, ids.perros.d4))
  assert.deepEqual(await dogs('CLIENT3'), [ids.perros.d5])
  assert.deepEqual(await dogs('COOWNER'), [ids.perros.d1])
  assert.deepEqual(await dogs('CLIENT_I'), [ids.perros.dI])
  const link = await (await as('COOWNER')).from('perro_duenos').select('rol, estado').eq('perro_id', ids.perros.d1)
  assert.deepEqual(link.data, [{ rol: 'co', estado: 'activo' }])
})

test('CLIENT sees the d1 history: finished, charged, unpaid, future walk, future booking', async () => {
  const data = await rows(await as('CLIENT'), 'prestaciones', 'id, estado, cobrado, tipo, grupo_id')
  assert.deepEqual(
    pick(data),
    sorted(ids.prestaciones.p1, ids.prestaciones.hist, ids.prestaciones.unpaid, ids.prestaciones.future, ids.prestaciones.nonWalk),
  )
  const by = Object.fromEntries(data.map((r) => [r.id, r]))
  assert.equal(by[ids.prestaciones.hist].cobrado, true)
  assert.equal(by[ids.prestaciones.unpaid].cobrado, false)
  assert.equal(by[ids.prestaciones.nonWalk].grupo_id, null)
  assert.equal(by[ids.prestaciones.nonWalk].tipo, 'bano')
})

test('the assigned walker sees p1 and group g1; WALKER_CO2 sees g2 and not p1', async () => {
  const co = await as('WALKER_CO')
  assert.ok(pick(await rows(co, 'prestaciones')).includes(ids.prestaciones.p1))
  assert.ok(pick(await rows(co, 'grupos')).includes(ids.grupos.g1))
  const co2 = await as('WALKER_CO2')
  assert.ok(!pick(await rows(co2, 'prestaciones')).includes(ids.prestaciones.p1))
  assert.ok(pick(await rows(co2, 'grupos')).includes(ids.grupos.g2))
})

test('OWNER sees all tenant A dogs, groups and bookings; OTHER sees only tenant B', async () => {
  const owner = await as('OWNER')
  assert.deepEqual(
    pick(await rows(owner, 'perros')),
    sorted(ids.perros.d1, ids.perros.d2, ids.perros.d3, ids.perros.d4, ids.perros.d5),
  )
  assert.deepEqual(pick(await rows(owner, 'grupos')), sorted(ids.grupos.g1, ids.grupos.g2))
  assert.equal((await rows(owner, 'prestaciones')).length, 5)
  const other = await as('OTHER')
  assert.deepEqual(pick(await rows(other, 'perros')), [ids.perros.dB])
})

test('WALKER_IND owns tenant I and sees its client dog; OFFICE roles are non-owners of A', async () => {
  const ind = await as('WALKER_IND')
  assert.deepEqual(pick(await rows(ind, 'perros')), [ids.perros.dI])
  const { data } = await (await as('OWNER')).from('negocios').select('owner_id').eq('id', ids.negocios.A).single()
  assert.equal(data.owner_id, ids.users.OWNER)
  for (const name of ['OFFICE', 'OFFICE_FIN']) {
    assert.notEqual(data.owner_id, ids.users[name], name)
  }
})
