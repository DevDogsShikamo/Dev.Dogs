// S7 consent evidence (R8-2, D15): no profile without a server-side consent record, the record is
// written inside provision_negocio / redeem_invite with the server clock, and nobody but its owner
// can read it or change it.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { admin, as, ids, seed, tempUser } from './_actors.mjs'
import { create, denied, only, profileOf, withUser } from './_invites.mjs'
import { sql } from './_sql.mjs'
import { POLITICA_VERSION } from '../../src/lib/politica.js'

const clean = () => admin().from('invitaciones').delete().in('negocio_id', Object.values(ids.negocios))
before(async () => { await seed(); await clean() })
after(clean)

const PROVISION = { p_rol: 'empresa', p_nombre: 'Ana Consent', p_negocio: 'Consent SAS', p_politica: POLITICA_VERSION }
const consents = async (userId) => (await admin().from('consentimientos').select('*').eq('user_id', userId)).data
const tenants = async (userId) => (await admin().from('negocios').select('id').eq('owner_id', userId)).data
const rpc = (u, fn, args) => u.client.rpc(fn, args)
const invite = async (email, rol = 'cliente') => {
  const res = await create('OWNER', rol, email)
  assert.equal(res.error, null, res.error?.message)
  return res.data
}

// ---- PC-2a: provisioning -------------------------------------------------------------------------
for (const [p_rol, tipo] of [['empresa', 'empresa'], ['paseador', 'independiente']]) {
  test(`PC-2d (API): provisioning a ${tipo} with the current version stores one consent record stamped by the server`, () =>
    withUser(async (u) => {
      const t0 = Date.now()
      const res = await rpc(u, 'provision_negocio', { ...PROVISION, p_rol })
      assert.equal(res.error, null, res.error?.message)
      assert.equal((await profileOf(u.id)).negocio_id, res.data)
      const rows = await consents(u.id)
      assert.equal(rows.length, 1)
      assert.deepEqual(
        { user_id: rows[0].user_id, policy_version: rows[0].policy_version, finalidad: rows[0].finalidad },
        { user_id: u.id, policy_version: POLITICA_VERSION, finalidad: 'prestacion_servicio' },
      )
      assert.ok(Math.abs(new Date(rows[0].aceptado_at) - t0) < 5 * 60_000, `aceptado_at ${rows[0].aceptado_at} is not now()`)
      assert.deepEqual(Object.keys(rows[0]).sort(), ['aceptado_at', 'finalidad', 'id', 'policy_version', 'user_id'])
    }))
}

// A refused call must leave no profile, no tenant and no consent; the same user then provisions
// with the valid version, which proves the refusals were about the version and not the user.
const BAD_VERSIONS = {
  'missing argument': undefined,
  null: null,
  empty: '',
  unknown: 'no-existe',
  'trailing space': `${POLITICA_VERSION} `,
  'other case': POLITICA_VERSION.toUpperCase(),
}
for (const [label, version] of Object.entries(BAD_VERSIONS)) {
  test(`PC-2a: provisioning with ${label} version is rejected and leaves no profile, tenant or consent`, () =>
    withUser(async (u) => {
      const args = { ...PROVISION }
      if (version === undefined) delete args.p_politica
      else args.p_politica = version
      const res = await rpc(u, 'provision_negocio', args)
      assert.ok(res.error, 'provisioning without a valid consent was accepted')
      if (version !== undefined) assert.match(res.error.message, /politica_invalida/)
      assert.equal(await profileOf(u.id), null)
      assert.deepEqual(await tenants(u.id), [])
      assert.deepEqual(await consents(u.id), [])
      const ok = await rpc(u, 'provision_negocio', PROVISION)
      assert.equal(ok.error, null, ok.error?.message)
      assert.equal((await consents(u.id)).length, 1)
    }))
}

test('PC-2a: a version that exists but is no longer current is rejected', () =>
  withUser(async (u) => {
    const old = `test-vencida-${randomUUID().slice(0, 6)}`
    assert.equal((await admin().from('politicas').insert({ version: old, vigente: false })).error, null)
    try {
      const res = await rpc(u, 'provision_negocio', { ...PROVISION, p_politica: old })
      assert.match(res.error?.message ?? '', /politica_invalida/)
      assert.equal(await profileOf(u.id), null)
      assert.deepEqual(await consents(u.id), [])
    } finally {
      await admin().from('politicas').delete().eq('version', old)
    }
  }))

test('PC-2a: a second provisioning is refused and keeps exactly the first consent record', () =>
  withUser(async (u) => {
    assert.equal((await rpc(u, 'provision_negocio', PROVISION)).error, null)
    const first = await consents(u.id)
    const again = await rpc(u, 'provision_negocio', PROVISION)
    assert.match(again.error?.message ?? '', /perfil_existente/)
    assert.deepEqual(await consents(u.id), first)
    assert.equal(first.length, 1)
  }))

// ---- PC-2a: invitation join ----------------------------------------------------------------------
for (const rol of ['cliente', 'paseador']) {
  test(`PC-2d (API): joining as ${rol} with the current version stores the consent record in the same transaction`, () =>
    withUser(async (u) => {
      const code = await invite(u.email, rol)
      const t0 = Date.now()
      const res = await rpc(u, 'redeem_invite', { p_codigo: code, p_politica: POLITICA_VERSION })
      assert.equal(res.error, null, res.error?.message)
      assert.equal(res.data.ok, true)
      assert.equal((await profileOf(u.id)).rol, rol)
      const rows = await consents(u.id)
      assert.equal(rows.length, 1)
      assert.deepEqual(
        { policy_version: rows[0].policy_version, finalidad: rows[0].finalidad },
        { policy_version: POLITICA_VERSION, finalidad: 'prestacion_servicio' },
      )
      assert.ok(Math.abs(new Date(rows[0].aceptado_at) - t0) < 5 * 60_000)
    }))
}

for (const [label, version] of Object.entries(BAD_VERSIONS)) {
  test(`PC-2a: joining with ${label} version is rejected; no profile, no consent, the invitation stays pending`, () =>
    withUser(async (u) => {
      const code = await invite(u.email)
      const args = { p_codigo: code, p_politica: version }
      if (version === undefined) delete args.p_politica
      const res = await rpc(u, 'redeem_invite', args)
      assert.ok(res.error, 'redeeming without a valid consent was accepted')
      if (version !== undefined) assert.match(res.error.message, /politica_invalida/)
      assert.equal(await profileOf(u.id), null)
      assert.deepEqual(await consents(u.id), [])
      assert.equal((await only(u.email)).estado, 'pendiente')
      const ok = await rpc(u, 'redeem_invite', { p_codigo: code, p_politica: POLITICA_VERSION })
      assert.deepEqual(ok.data, { ok: true, negocio_id: ids.negocios.A, rol: 'cliente' })
      assert.equal((await consents(u.id)).length, 1)
    }))
}

test('PC-2a: a wrong code with a valid version fails as before and stores no consent', () =>
  withUser(async (u) => {
    const res = await rpc(u, 'redeem_invite', { p_codigo: '0123-4567-89AB-CD', p_politica: POLITICA_VERSION })
    assert.deepEqual(res.data, { ok: false, error: 'invalid' })
    assert.equal(await profileOf(u.id), null)
    assert.deepEqual(await consents(u.id), [])
  }))

// ---- PC-2b: reading and changing consent records -------------------------------------------------
test('PC-2b: a user reads only its own consent records; OTHER and the tenant owner read none of them', async () => {
  const a = await tempUser()
  const b = await tempUser()
  try {
    assert.equal((await rpc(a, 'provision_negocio', PROVISION)).error, null)
    assert.equal((await rpc(b, 'provision_negocio', PROVISION)).error, null)
    const mine = await a.client.from('consentimientos').select('user_id, policy_version')
    assert.deepEqual(mine.data, [{ user_id: a.id, policy_version: POLITICA_VERSION }])
    assert.ok((await admin().from('consentimientos').select('id', { count: 'exact', head: true })).count >= 2, 'table not populated')
    const other = await (await as('OTHER')).from('consentimientos').select('user_id')
    // Only its own fixture records (one per policy version it accepted across re-seeds).
    assert.deepEqual([...new Set(other.data.map((r) => r.user_id))], [ids.users.OTHER])
    assert.equal(other.error, null)
    const peek = await a.client.from('consentimientos').select('*').eq('user_id', b.id)
    assert.deepEqual(peek.data, [])
  } finally {
    await a.drop()
    await b.drop()
  }
})

test('PC-2b: the business owner does not read a joined client\'s consent record', () =>
  withUser(async (u) => {
    const code = await invite(u.email)
    assert.equal((await rpc(u, 'redeem_invite', { p_codigo: code, p_politica: POLITICA_VERSION })).data.ok, true)
    assert.equal((await consents(u.id)).length, 1)
    const owner = await (await as('OWNER')).from('consentimientos').select('*').eq('user_id', u.id)
    assert.equal(owner.error, null)
    assert.deepEqual(owner.data, [])
    const client = await u.client.from('consentimientos').select('user_id')
    assert.deepEqual(client.data, [{ user_id: u.id }])
  }))

test('PC-2b: update, delete and insert on consent records are denied for the owner of the record', () =>
  withUser(async (u) => {
    assert.equal((await rpc(u, 'provision_negocio', PROVISION)).error, null)
    const [row] = await consents(u.id)
    assert.ok(row, 'precondition: a consent record exists')
    const upd = await u.client.from('consentimientos').update({ policy_version: 'otra' }).eq('id', row.id)
    denied(upd)
    denied(await u.client.from('consentimientos').update({ aceptado_at: '2000-01-01T00:00:00Z' }).eq('id', row.id))
    denied(await u.client.from('consentimientos').delete().eq('id', row.id))
    denied(await u.client.from('consentimientos').insert({ user_id: u.id, policy_version: POLITICA_VERSION, finalidad: 'otra' }))
    assert.deepEqual(await consents(u.id), [row])
  }))

test('PC-2b: a user cannot forge a consent record for someone else', () =>
  withUser(async (u) => {
    const before = await consents(ids.users.CLIENT) // the fixture's own record (seed) stays as it was
    denied(await u.client.from('consentimientos').insert({ user_id: ids.users.CLIENT, policy_version: POLITICA_VERSION }))
    assert.deepEqual(await consents(ids.users.CLIENT), before)
  }))

test('PC-2b: ANON reads nothing and the policy catalogue is closed to API callers', async () => {
  denied(await (await as('ANON')).from('consentimientos').select('*'))
  denied(await (await as('OWNER')).from('politicas').select('*'))
  denied(await (await as('ANON')).from('politicas').select('*'))
})

// ---- the version string has one source -----------------------------------------------------------
test('the current policy version of the app is the one current row in `politicas`', async () => {
  const rows = (await admin().from('politicas').select('version, vigente')).data
  assert.deepEqual(rows.filter((r) => r.vigente), [{ version: POLITICA_VERSION, vigente: true }])
})

// Ley 1480 art. 48: proof that the user accepted the general conditions. The accepted version covers the
// terms of use and the data policy, so each consent row is that proof; older versions covered only data.
test('the current version covers the terms and the data policy, and only those documents', async () => {
  const rows = (await admin().from('politicas').select('version, documentos').eq('vigente', true)).data
  assert.deepEqual(rows, [{ version: POLITICA_VERSION, documentos: ['terminos', 'datos'] }])
  const bad = await admin().from('politicas').insert({ version: 'dd-test-doc', vigente: false, documentos: ['publicidad'] })
  assert.equal(bad.error?.code, '23514', 'an unknown document is rejected')
  const empty = await admin().from('politicas').insert({ version: 'dd-test-doc', vigente: false, documentos: [] })
  assert.equal(empty.error?.code, '23514', 'a version must cover at least one document')
})

// ---- catalog: signatures, definer settings, no network identifiers ---------------------------------
test('catalog: one overload each, taking the version; definer with an empty search_path; anon cannot execute', () => {
  const fns = sql(`select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef,
      p.proconfig @> array['search_path=""'] as pinned,
      has_function_privilege('anon', p.oid, 'execute') as anon_exec,
      has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('provision_negocio', 'redeem_invite') order by 1`)
  assert.deepEqual(fns.map((f) => f.proname), ['provision_negocio', 'redeem_invite'])
  for (const f of fns) {
    assert.match(f.args, /p_politica text/)
    assert.deepEqual({ definer: f.prosecdef, pinned: f.pinned, anon: f.anon_exec, authenticated: f.auth_exec }, { definer: true, pinned: true, anon: false, authenticated: true })
  }
})

test('catalog: consentimientos stores no IP, user agent or free text, and only select is granted to authenticated', () => {
  const cols = sql(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'consentimientos' order by 1`).map((c) => c.column_name)
  assert.deepEqual(cols, ['aceptado_at', 'finalidad', 'id', 'policy_version', 'user_id'])
  const grants = sql(`select grantee, privilege_type from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'consentimientos' and grantee in ('anon', 'authenticated', 'PUBLIC') order by 1, 2`)
  assert.deepEqual(grants, [{ grantee: 'authenticated', privilege_type: 'SELECT' }])
  const rls = sql(`select relrowsecurity from pg_class where oid = 'public.consentimientos'::regclass`)
  assert.deepEqual(rls, [{ relrowsecurity: true }])
})
