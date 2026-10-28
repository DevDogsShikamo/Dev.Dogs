// S2a grupo_asignar: the only way for office staff to reassign a group's walker
// (the table policy "grupos write office" is gone). Owner and office assign a walker
// of their own tenant or the owner; everyone else, and any foreign cuidador, is refused.
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, ids, seed } from './_actors.mjs'

before(() => seed())

const { g1 } = ids.grupos
const u = ids.users
const cuidador = async () => (await admin().from('grupos').select('cuidador_id').eq('id', g1).single()).data.cuidador_id
const restore = () => admin().from('grupos').update({ cuidador_id: u.WALKER_CO, nombre: 'G1' }).eq('id', g1)
const assign = async (actor, p_cuidador, p_grupo = g1) => (await as(actor)).rpc('grupo_asignar', { p_grupo, p_cuidador })

async function keeping(fn) {
  try {
    await fn()
  } finally {
    await restore()
  }
}

// ---- allowed path ---------------------------------------------------------------
for (const [actor, target, label] of [
  ['OWNER', 'WALKER_CO2', 'an employed walker'],
  ['OFFICE', 'WALKER_CO2', 'an employed walker'],
  ['OWNER', 'OWNER', 'itself'],
]) {
  test(`${actor} assigns ${label} to a group`, () =>
    keeping(async () => {
      const res = await assign(actor, u[target])
      assert.equal(res.error, null, res.error?.message)
      assert.equal(await cuidador(), u[target])
    }))
}

test('OFFICE can unassign the walker of a group (null)', () =>
  keeping(async () => {
    assert.equal((await assign('OFFICE', null)).error, null)
    assert.equal(await cuidador(), null)
  }))

// ---- denial ---------------------------------------------------------------------
for (const actor of ['CLIENT', 'WALKER_CO', 'NOPROFILE', 'OTHER', 'ANON']) {
  test(`${actor} cannot assign a walker`, () =>
    keeping(async () => {
      const res = await assign(actor, u.WALKER_CO2)
      assert.equal(res.error?.code, '42501', `expected permission denied, got ${res.error?.code ?? 'no error'}`)
      assert.equal(await cuidador(), u.WALKER_CO, 'the group was reassigned')
    }))
}

test('an unknown group is refused with the same permission error', async () => {
  const res = await assign('OWNER', u.WALKER_CO2, '00000000-0000-4000-8000-000000000000')
  assert.equal(res.error?.code, '42501')
})

for (const [target, why] of [
  ['WALKER_IND', 'a walker of another tenant'],
  ['OTHER', 'the owner of another tenant'],
  ['CLIENT', 'a client of the same tenant'],
  ['OFFICE', 'office staff, who is neither a walker nor the owner'],
]) {
  test(`OWNER cannot assign ${why} as cuidador`, () =>
    keeping(async () => {
      const res = await assign('OWNER', u[target])
      assert.match(res.error?.message ?? '', /cuidador_invalido/)
      assert.equal(await cuidador(), u.WALKER_CO, 'the group was reassigned')
    }))
}

// ---- the old direct-write path is closed -----------------------------------------
test('OFFICE can no longer update groups directly (policy "grupos write office" dropped)', () =>
  keeping(async () => {
    await (await as('OFFICE')).from('grupos').update({ cuidador_id: u.WALKER_CO2 }).eq('id', g1)
    assert.equal(await cuidador(), u.WALKER_CO, 'office rewrote the group through the table')
  }))

test('OWNER still edits groups directly (policy "grupos write owner" untouched)', () =>
  keeping(async () => {
    const res = await (await as('OWNER')).from('grupos').update({ nombre: 'G1 renombrado' }).eq('id', g1).select('nombre')
    assert.equal(res.error, null)
    assert.deepEqual(res.data, [{ nombre: 'G1 renombrado' }])
  }))
