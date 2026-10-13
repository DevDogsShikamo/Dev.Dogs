// S1 identity and tenant isolation: provisioned profiles, frozen identity fields,
// own-tenant business read, retired columns and a closed anonymous surface.
// The C1 / C2 / N2-anon exploits themselves live in baseline-identity.test.mjs.
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { admin, as, ids, seed, tempUser } from './_actors.mjs'
import { sql } from './_sql.mjs'

before(() => seed())

const { A, B } = ids.negocios
const profileOf = async (id) => (await admin().from('profiles').select('*').eq('id', id).maybeSingle()).data
const PROVISION = { p_rol: 'empresa', p_nombre: 'Ana Prueba', p_negocio: 'Peludos SAS', p_telefono: '3001234567' }

// Runs `fn` with a fresh auth user without a profile, then deletes it.
async function withUser(fn) {
  const u = await tempUser()
  try {
    return await fn(u)
  } finally {
    await u.drop()
  }
}

// A legacy (plaintext-code) invitation; returns its code.
async function invite(negocio_id, rol) {
  const codigo = `T${randomUUID().slice(0, 10)}`
  const { error } = await admin()
    .from('invitaciones')
    .insert({ negocio_id, rol, codigo, estado: 'pendiente', expires_at: new Date(Date.now() + 864e5).toISOString() })
  assert.equal(error, null)
  return codigo
}
const dropInvite = (codigo) => admin().from('invitaciones').delete().eq('codigo', codigo)

// ---- R2-1 provisioned profiles only -----------------------------------------
test('TI-1a: NOPROFILE cannot insert a profile into tenant A', () =>
  withUser(async (u) => {
    const res = await u.client.from('profiles').insert({ id: u.id, rol: 'empresa', negocio_id: A, nombre: 'x' })
    assert.ok(res.error, 'profile insert was accepted')
    assert.equal(await profileOf(u.id), null)
  }))

test('TI-1a: NOPROFILE cannot insert a negocio of its own', () =>
  withUser(async (u) => {
    const res = await u.client.from('negocios').insert({ nombre: 'Falso', slug: `falso-${randomUUID().slice(0, 6)}` })
    assert.ok(res.error, 'negocio insert was accepted')
    assert.equal((await admin().from('negocios').select('id').eq('owner_id', u.id)).data.length, 0)
  }))

for (const [p_rol, tipo] of [['empresa', 'empresa'], ['paseador', 'independiente']]) {
  test(`TI-1b: provisioning a ${tipo} makes the caller owner of a new, isolated tenant`, () =>
    withUser(async (u) => {
      const res = await u.client.rpc('provision_negocio', { ...PROVISION, p_rol })
      assert.equal(res.error, null)
      const profile = await profileOf(u.id)
      assert.equal(profile.rol, p_rol)
      assert.equal(profile.negocio_id, res.data)
      assert.equal(profile.nombre, 'Ana Prueba')
      const negocio = (await admin().from('negocios').select('owner_id, tipo, nombre').eq('id', res.data).single()).data
      assert.deepEqual(negocio, { owner_id: u.id, tipo, nombre: 'Peludos SAS' })
      assert.deepEqual((await u.client.from('negocios').select('id')).data.map((n) => n.id), [res.data])
      assert.equal((await u.client.from('perros').select('id').eq('negocio_id', A)).data.length, 0)
    }))
}

test('TI-1c: ANON cannot provision', async () => {
  const res = await (await as('ANON')).rpc('provision_negocio', PROVISION)
  assert.equal(res.error?.code, '42501')
})

test('TI-1d: a user who already has a profile cannot provision again', async () => {
  const before = await profileOf(ids.users.CLIENT)
  const res = await (await as('CLIENT')).rpc('provision_negocio', PROVISION)
  assert.match(res.error?.message ?? '', /perfil_existente/)
  assert.deepEqual(await profileOf(ids.users.CLIENT), before)
  assert.equal((await admin().from('negocios').select('id').eq('owner_id', ids.users.CLIENT)).data.length, 0)
})

test('TI-1d: provisioning refuses the client role and creates nothing', () =>
  withUser(async (u) => {
    const res = await u.client.rpc('provision_negocio', { ...PROVISION, p_rol: 'cliente' })
    assert.match(res.error?.message ?? '', /rol_invalido/)
    assert.equal(await profileOf(u.id), null)
    assert.equal((await admin().from('negocios').select('id').eq('owner_id', u.id)).data.length, 0)
  }))

// ---- legacy invitation join (no upsert, result object) ------------------------
test('redeem_invite: a new user joins the inviting tenant with the invited role', () =>
  withUser(async (u) => {
    const codigo = await invite(A, 'cliente')
    try {
      const res = await u.client.rpc('redeem_invite', { p_codigo: codigo })
      assert.equal(res.error, null)
      assert.equal(res.data.ok, true)
      assert.deepEqual(
        { rol: (await profileOf(u.id)).rol, negocio_id: (await profileOf(u.id)).negocio_id },
        { rol: 'cliente', negocio_id: A },
      )
      assert.equal((await admin().from('invitaciones').select('estado').eq('codigo', codigo).single()).data.estado, 'aceptada')
    } finally {
      await dropInvite(codigo)
    }
  }))

test('redeem_invite: a used code is rejected for a second user', () =>
  withUser((first) =>
    withUser(async (second) => {
      const codigo = await invite(A, 'cliente')
      try {
        assert.equal((await first.client.rpc('redeem_invite', { p_codigo: codigo })).data.ok, true)
        const res = await second.client.rpc('redeem_invite', { p_codigo: codigo })
        assert.equal(res.data.ok, false)
        assert.equal(await profileOf(second.id), null)
      } finally {
        await dropInvite(codigo)
      }
    })),
)

test('redeem_invite: a user with a profile cannot switch tenant or role', async () => {
  const codigo = await invite(B, 'empresa')
  const before = await profileOf(ids.users.CLIENT)
  try {
    const res = await (await as('CLIENT')).rpc('redeem_invite', { p_codigo: codigo })
    assert.equal(res.data?.ok, false)
    assert.deepEqual(await profileOf(ids.users.CLIENT), before)
    assert.equal((await admin().from('invitaciones').select('estado').eq('codigo', codigo).single()).data.estado, 'pendiente')
  } finally {
    await admin().from('profiles').update({ rol: before.rol, negocio_id: before.negocio_id }).eq('id', ids.users.CLIENT)
    await dropInvite(codigo)
  }
})

// ---- R2-2 frozen identity fields ---------------------------------------------
// Updates `name`'s profile as `actor`, returns the stored row, and always restores it.
async function tryUpdate(actor, target, patch) {
  const before = await profileOf(ids.users[target])
  try {
    await (await as(actor)).from('profiles').update(patch).eq('id', ids.users[target])
    return { before, after: await profileOf(ids.users[target]) }
  } finally {
    const { id, created_at, ...rest } = before
    await admin().from('profiles').update(rest).eq('id', id)
  }
}

test('TI-2c: OWNER cannot move a profile of its tenant into tenant B', async () => {
  const { before, after } = await tryUpdate('OWNER', 'WALKER_CO', { negocio_id: B })
  assert.equal(before.negocio_id, A)
  assert.equal(after.negocio_id, A)
})

test('TI-2c: OWNER cannot change the role of a profile of its tenant', async () => {
  const { before, after } = await tryUpdate('OWNER', 'WALKER_CO', { rol: 'cliente' })
  assert.equal(before.rol, 'paseador')
  assert.equal(after.rol, 'paseador')
})

test('TI-2d: WALKER-CO can still edit own name and availability', async () => {
  const { after } = await tryUpdate('WALKER_CO', 'WALKER_CO', { nombre: 'Walker Renombrado', horario: { lun: ['08:00'] } })
  assert.equal(after.nombre, 'Walker Renombrado')
  assert.deepEqual(after.horario, { lun: ['08:00'] })
})

test('TI-2e: WALKER-CO cannot change own salary', async () => {
  const { before, after } = await tryUpdate('WALKER_CO', 'WALKER_CO', { salario_fijo: 999999 })
  assert.equal(before.salario_fijo, 0)
  assert.equal(after.salario_fijo, 0)
})

test('TI-2e: OWNER can still set the salary of an employee', async () => {
  const { after } = await tryUpdate('OWNER', 'WALKER_CO', { salario_fijo: 150000 })
  assert.equal(after.salario_fijo, 150000)
})

test('TI-2: CLIENT cannot verify itself', async () => {
  const { before, after } = await tryUpdate('CLIENT', 'CLIENT', { verificado: true, verificado_at: new Date().toISOString() })
  assert.equal(before.verificado, false)
  assert.deepEqual({ v: after.verificado, at: after.verificado_at }, { v: false, at: null })
})

// ---- R2-3 business read narrowed ---------------------------------------------
test('TI-3b: ANON and NOPROFILE read no negocio', () =>
  withUser(async (u) => {
    const stored = (await admin().from('negocios').select('id').in('id', Object.values(ids.negocios))).data.length
    assert.equal(stored, 3)
    for (const client of [await as('ANON'), u.client]) {
      assert.equal(((await client.from('negocios').select('id')).data ?? []).length, 0)
    }
  }))

for (const actor of ['CLIENT', 'WALKER_CO']) {
  test(`TI-3c: ${actor} reads its own negocio with the fields the app needs`, async () => {
    const { data, error } = await (await as(actor)).from('negocios').select('id, zonas')
    assert.equal(error, null)
    assert.equal(data.length, 1)
    assert.equal(data[0].id, A)
    assert.ok(Array.isArray(data[0].zonas))
  })
}

// ---- R2-5 retired schema, PC-1b ----------------------------------------------
const columns = () =>
  new Set(
    sql(`select table_name || '.' || column_name as c from information_schema.columns
         where table_schema = 'public' and table_name in ('negocios', 'profiles')`).map((r) => r.c),
  )

test('TI-5a: retired columns are gone from the schema', () => {
  const cols = columns()
  assert.ok(cols.has('negocios.nombre') && cols.has('profiles.rol'), 'introspection returned no columns')
  for (const gone of ['negocios.telefono', 'negocios.ciudad', 'negocios.eslogan', 'profiles.didit_session_id']) {
    assert.ok(!cols.has(gone), `${gone} still exists`)
  }
})

test('PC-1b: no column or provisioning parameter stores a national ID or NIT', () => {
  const args = sql(`select pg_get_function_arguments(oid) as a from pg_proc
                    where pronamespace = 'public'::regnamespace and proname = 'provision_negocio'`)
  assert.equal(args.length, 1, 'provision_negocio does not exist')
  const idLike = /nit|doc|cedula|identific/i
  assert.ok(!idLike.test(args[0].a), `provision_negocio takes ${args[0].a}`)
  assert.deepEqual([...columns()].filter((c) => idLike.test(c)), [])
})

// ---- R2-6 anonymous surface closed -------------------------------------------
test('TI-6b: the set of functions executable by anon is empty', () => {
  const total = sql(`select count(*)::int as n from pg_proc where pronamespace = 'public'::regnamespace`)[0].n
  assert.ok(total > 10, 'introspection returned too few functions')
  const open = sql(`select proname from pg_proc where pronamespace = 'public'::regnamespace
                    and has_function_privilege('anon', oid, 'execute') order by 1`)
  assert.deepEqual(open.map((r) => r.proname), [])
})

test('TI-6b: anon holds no privilege on any table of the exposed schema', () => {
  const tables = sql(`select count(*)::int as n from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`)[0].n
  assert.ok(tables >= 10, 'introspection returned too few tables')
  const open = sql(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
                    and (has_table_privilege('anon', oid, 'select') or has_table_privilege('anon', oid, 'insert')
                      or has_table_privilege('anon', oid, 'update') or has_table_privilege('anon', oid, 'delete')) order by 1`)
  assert.deepEqual(open.map((r) => r.relname), [])
})

test('TI-6b: a function created later is not executable by anon or authenticated', () => {
  // The DO block creates a probe, checks it and drops it; a failed check raises and rolls it back.
  sql(`do $probe$ begin
         create function public.zz_acl_probe() returns int language sql as 'select 1';
         if has_function_privilege('anon', 'public.zz_acl_probe()', 'execute') then raise exception 'anon can execute new functions'; end if;
         if has_function_privilege('authenticated', 'public.zz_acl_probe()', 'execute') then raise exception 'authenticated can execute new functions'; end if;
         drop function public.zz_acl_probe();
       end $probe$;`)
})
