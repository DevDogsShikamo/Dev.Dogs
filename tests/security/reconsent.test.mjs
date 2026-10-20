// Re-consent: when the current policy version is newer than the last one a user accepted (or the user
// has no consent record at all), consentimiento_pendiente() returns the current version until the user
// accepts it through consentimiento_aceptar(), which records only the current version, server-stamped.
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, ids, seed } from './_actors.mjs'
import { denied, withUser } from './_invites.mjs'
import { sql } from './_sql.mjs'
import { POLITICA_VERSION } from '../../src/lib/politica.js'

// The version S7 seeded and S5b retired (still in `politicas`, vigente = false).
const OLD = '2026-10-14-borrador'

before(seed)

const consents = async (userId) =>
  (await admin().from('consentimientos').select('policy_version, aceptado_at').eq('user_id', userId).order('aceptado_at')).data
const pending = async (u) => {
  const res = await u.client.rpc('consentimiento_pendiente')
  assert.equal(res.error, null, res.error?.message)
  return res.data
}
const accept = (u, p_politica) => u.client.rpc('consentimiento_aceptar', { p_politica })
const withOldConsent = async (u) =>
  assert.equal((await admin().from('consentimientos').insert({ user_id: u.id, policy_version: OLD })).error, null)

test('the retired version used as "older" exists and is not current', async () => {
  const { data } = await admin().from('politicas').select('version, vigente').eq('version', OLD)
  assert.deepEqual(data, [{ version: OLD, vigente: false }])
  assert.notEqual(OLD, POLITICA_VERSION)
})

test('pending: a user whose last consent is an older version gets the current version', () =>
  withUser(async (u) => {
    await withOldConsent(u)
    assert.equal(await pending(u), POLITICA_VERSION)
  }))

test('pending: a user with no consent record at all gets the current version', () =>
  withUser(async (u) => {
    assert.deepEqual(await consents(u.id), [])
    assert.equal(await pending(u), POLITICA_VERSION)
  }))

test('accepting the current version clears the pending state, keeps the old record and is idempotent', () =>
  withUser(async (u) => {
    await withOldConsent(u)
    const t0 = Date.now()
    const res = await accept(u, POLITICA_VERSION)
    assert.equal(res.error, null, res.error?.message)
    assert.equal(await pending(u), null)
    const rows = await consents(u.id)
    assert.deepEqual(rows.map((r) => r.policy_version), [OLD, POLITICA_VERSION])
    assert.ok(Math.abs(new Date(rows[1].aceptado_at) - t0) < 5 * 60_000, `aceptado_at ${rows[1].aceptado_at} is not now()`)
    assert.equal((await accept(u, POLITICA_VERSION)).error, null)
    assert.deepEqual(await consents(u.id), rows)
  }))

test('a seeded user with the current consent is not pending', async () => {
  const res = await (await as('CLIENT')).rpc('consentimiento_pendiente')
  assert.deepEqual({ error: res.error, data: res.data }, { error: null, data: null })
})

for (const [label, version] of Object.entries({ old: OLD, unknown: 'no-existe', empty: '', null: null, 'other case': POLITICA_VERSION.toUpperCase() })) {
  test(`accepting the ${label} version raises politica_invalida and stores nothing`, () =>
    withUser(async (u) => {
      await withOldConsent(u)
      const before = await consents(u.id)
      const res = await accept(u, version)
      assert.match(res.error?.message ?? '', /politica_invalida/)
      assert.deepEqual(await consents(u.id), before)
      assert.equal(await pending(u), POLITICA_VERSION)
    }))
}

test('ANON cannot execute either function (permission denied)', async () => {
  const anon = await as('ANON')
  denied(await anon.rpc('consentimiento_pendiente'))
  denied(await anon.rpc('consentimiento_aceptar', { p_politica: POLITICA_VERSION }))
})

test('a user cannot write consentimientos directly, even for the current version', () =>
  withUser(async (u) => {
    denied(await u.client.from('consentimientos').insert({ user_id: u.id, policy_version: POLITICA_VERSION }))
    assert.deepEqual(await consents(u.id), [])
    assert.equal(await pending(u), POLITICA_VERSION)
  }))

test('catalog: both functions are definer with an empty search_path; anon cannot execute, authenticated can', () => {
  const fns = sql(`select p.proname, p.prosecdef, p.proconfig @> array['search_path=""'] as pinned,
      has_function_privilege('anon', p.oid, 'execute') as anon_exec,
      has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
    from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('consentimiento_pendiente', 'consentimiento_aceptar') order by 1`)
  assert.deepEqual(fns.map((f) => f.proname), ['consentimiento_aceptar', 'consentimiento_pendiente'])
  for (const f of fns) {
    assert.deepEqual({ definer: f.prosecdef, pinned: f.pinned, anon: f.anon_exec, authenticated: f.auth_exec }, { definer: true, pinned: true, anon: false, authenticated: true }, f.proname)
  }
})

test('the seeded actors with a profile all hold the current consent (fixture precondition for the E2E gate)', async () => {
  const { data } = await admin().from('consentimientos').select('user_id').eq('policy_version', POLITICA_VERSION).in('user_id', Object.values(ids.users))
  assert.equal(data.length, Object.keys(ids.users).length - 1) // every actor except NOPROFILE
})
