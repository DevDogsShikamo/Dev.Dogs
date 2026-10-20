// SR-2a baseline: identity and tenancy exploits that SUCCEED on the legacy schema.
// Each test asserts the DESIRED behaviour (denial) and is marked `todo`, so it is
// listed as failing while the suite exits 0. The fixing slice removes the flag.
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, ids, seed } from './_actors.mjs'
import { GUARDED_RPCS, attack } from './_attacks.mjs'

before(() => seed())

const profile = async (name) =>
  (await admin().from('profiles').select('rol, negocio_id').eq('id', ids.users[name]).single()).data
const restore = (name) =>
  admin().from('profiles').update({ rol: 'cliente', negocio_id: ids.negocios.A }).eq('id', ids.users[name])

// C1 / TI-2a: a registered user rewrites rol + negocio_id and joins another tenant.
test('C1 TI-2a: OTHER cannot move itself into tenant A', { todo: 'fixed in S1' }, async () => {
  const other = await as('OTHER')
  try {
    await other.from('profiles').update({ rol: 'empresa', negocio_id: ids.negocios.A }).eq('id', ids.users.OTHER)
    assert.deepEqual(await profile('OTHER'), { rol: 'empresa', negocio_id: ids.negocios.B }, 'profile moved to tenant A')
    const { data } = await other.from('perros').select('id').eq('negocio_id', ids.negocios.A)
    assert.equal(data.length, 0, 'tenant A dogs readable after the move')
  } finally {
    await admin().from('profiles').update({ rol: 'empresa', negocio_id: ids.negocios.B }).eq('id', ids.users.OTHER)
  }
})

// C1 / TI-2b: a client promotes itself to staff.
test('C1 TI-2b: CLIENT cannot change its own rol', { todo: 'fixed in S1' }, async () => {
  const client = await as('CLIENT')
  try {
    for (const rol of ['paseador', 'empresa']) {
      await client.from('profiles').update({ rol }).eq('id', ids.users.CLIENT)
      assert.equal((await profile('CLIENT')).rol, 'cliente', `rol became ${rol}`)
    }
  } finally {
    await restore('CLIENT')
  }
})

// C2 / TI-3a: any authenticated user lists every tenant.
test('C2 TI-3a: OTHER reads only its own negocio', { todo: 'fixed in S1' }, async () => {
  const { data, error } = await (await as('OTHER')).from('negocios').select('id, nombre, slug, owner_id')
  assert.equal(error, null)
  assert.deepEqual(
    data.map((n) => n.id),
    [ids.negocios.B],
    'other tenants (A, I) are listed with name, slug and owner',
  )
})

// N2 anon half / TI-6a: functions are executable by the anonymous role.
const ANON_ONLY = [
  { name: 'redeem_invite', args: { p_codigo: 'NO-SUCH-CODE' } },
  { name: 'paseo_marcar', args: { p_ids: [ids.prestaciones.p1], p_estado: 'en_curso' } },
  { name: 'paseo_no_salio', args: { p_id: ids.prestaciones.p1, p_motivo: 'x' } },
].map((a) => ({ ...a, damage: async () => null, undo: async () => {} }))

for (const rpc of [...GUARDED_RPCS, ...ANON_ONLY]) {
  test(`N2 TI-6a: ANON cannot execute ${rpc.name}`, { todo: 'fixed in S1' }, async () => {
    const res = await attack(await as('ANON'), rpc)
    assert.equal(res.damage, null, `anonymous call changed data: ${res.damage}`)
    assert.equal(res.error?.code, '42501', `expected permission denied, got ${res.error?.code ?? 'no error'}`)
  })
}
