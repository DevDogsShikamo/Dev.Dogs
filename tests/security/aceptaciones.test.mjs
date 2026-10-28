// Role notice and business terms (20261022100001_aceptaciones.sql): aceptacion_pendiente() tells the gate
// what the caller still has to accept (an owner the Términos para negocios, a client the notice that the
// business, not DevDogs, provides the service), aceptacion_registrar() records only the current version
// for the right role, rows are readable by their owner only and never writable through the API, and
// reservar / comprar_producto refuse a client without the current notice.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, day, ids, seed } from './_actors.mjs'
import { denied, withUser } from './_invites.mjs'
import { sql } from './_sql.mjs'
import { AVISO_ROL_VERSION, POLITICA_VERSION, TERMINOS_NEGOCIO_VERSION } from '../../src/lib/politica.js'

const u = ids.users
const { A, I } = ids.negocios
const { d5 } = ids.perros
// CLIENT3 is the principal owner of d5 (tenant A); its notice is removed and restored around each test.
const COMIDA = '0d0d0d05-0000-4000-8000-000000000070'

const db = () => admin()
const rowsOf = async (userId) =>
  (await db().from('aceptaciones').select('tipo, negocio_id, version, aceptado_at').eq('user_id', userId).order('aceptado_at')).data
const pending = async (client) => {
  const res = await client.rpc('aceptacion_pendiente')
  assert.equal(res.error, null, res.error?.message)
  return res.data
}
const register = (client, p_tipo, p_version) => client.rpc('aceptacion_registrar', { p_tipo, p_version })
const refused = (res, message) => {
  assert.equal(res.error?.code, 'P0001', `expected a raised error, got ${res.error?.code ?? 'no error'}`)
  assert.match(res.error.message, message)
}
const restoreClient3 = () =>
  db().from('aceptaciones').upsert({ user_id: u.CLIENT3, tipo: 'aviso_rol', negocio_id: A, version: AVISO_ROL_VERSION }, { onConflict: 'user_id,tipo,negocio_id,version', ignoreDuplicates: true })
async function withoutNotice(fn) {
  assert.equal((await db().from('aceptaciones').delete().eq('user_id', u.CLIENT3).eq('tipo', 'aviso_rol')).error, null)
  try {
    return await fn(await as('CLIENT3'))
  } finally {
    assert.equal((await restoreClient3()).error, null)
  }
}
const cleanup = async () => {
  await db().from('prestaciones').delete().eq('perro_id', d5)
  await db().from('servicios').delete().eq('id', COMIDA)
}

before(async () => {
  await seed()
  await cleanup()
  assert.equal((await db().from('servicios').insert({ id: COMIDA, negocio_id: A, tipo: 'comida', nombre: 'aceptaciones comida', modelo_cobro: 'por_uso', activo: true })).error, null)
  assert.equal((await db().from('tarifas').insert({ servicio_id: COMIDA, negocio_id: A, precio: 5000, precio_mensual: 0 })).error, null)
})
after(async () => { await restoreClient3(); await cleanup() })

// A provisioned owner (company or independent walker) of a brand-new business.
async function provisioned(u, p_rol, p_negocio) {
  const res = await u.client.rpc('provision_negocio', { p_rol, p_nombre: 'Ana Aceptaciones', p_negocio, p_politica: POLITICA_VERSION })
  assert.equal(res.error, null, res.error?.message)
  return res.data
}

// ---- versions -------------------------------------------------------------------------------------
test('the JS constants match version_vigente(); politica_negocio has no version yet', async () => {
  const client = await as('CLIENT')
  for (const [tipo, version] of [['aviso_rol', AVISO_ROL_VERSION], ['terminos_negocio', TERMINOS_NEGOCIO_VERSION], ['politica_negocio', null]]) {
    const res = await client.rpc('version_vigente', { p_tipo: tipo })
    assert.deepEqual({ error: res.error, data: res.data }, { error: null, data: version }, tipo)
  }
})

// ---- pending, per role ----------------------------------------------------------------------------
for (const [p_rol, label] of [['empresa', 'company'], ['paseador', 'independent walker']]) {
  test(`pending: a new ${label} owner gets terminos_negocio for its business, until it accepts`, () =>
    withUser(async (o) => {
      const neg = await provisioned(o, p_rol, `Aceptaciones ${label}`)
      assert.deepEqual(await pending(o.client), { tipo: 'terminos_negocio', version: TERMINOS_NEGOCIO_VERSION, negocio_id: neg, negocio_nombre: `Aceptaciones ${label}` })
      assert.equal((await register(o.client, 'terminos_negocio', TERMINOS_NEGOCIO_VERSION)).error, null)
      assert.equal(await pending(o.client), null)
      const rows = await rowsOf(o.id)
      assert.deepEqual(rows.map(({ tipo, negocio_id, version }) => ({ tipo, negocio_id, version })), [{ tipo: 'terminos_negocio', negocio_id: neg, version: TERMINOS_NEGOCIO_VERSION }])
      assert.ok(Math.abs(new Date(rows[0].aceptado_at) - Date.now()) < 5 * 60_000, `aceptado_at ${rows[0].aceptado_at} is not now()`)
    }))
}

test('pending: a client without the current notice gets aviso_rol with the name of its business', () =>
  withoutNotice(async (c3) => {
    assert.deepEqual(await pending(c3), { tipo: 'aviso_rol', version: AVISO_ROL_VERSION, negocio_id: A, negocio_nombre: 'Tenant A' })
  }))

test('pending: an acceptance for another business or an older version does not count', () =>
  withoutNotice(async (c3) => {
    const other = await db().from('aceptaciones').insert([
      { user_id: u.CLIENT3, tipo: 'aviso_rol', negocio_id: I, version: AVISO_ROL_VERSION },
      { user_id: u.CLIENT3, tipo: 'aviso_rol', negocio_id: A, version: '2026-01-01-borrador' },
    ])
    assert.equal(other.error, null, other.error?.message)
    try {
      assert.equal((await pending(c3))?.tipo, 'aviso_rol')
    } finally {
      await db().from('aceptaciones').delete().eq('user_id', u.CLIENT3).eq('tipo', 'aviso_rol')
    }
  }))

for (const name of ['OFFICE', 'OFFICE_FIN', 'WALKER_CO', 'WALKER_CO2', 'OWNER', 'OTHER', 'WALKER_IND', 'CLIENT', 'COOWNER', 'CLIENT_I']) {
  test(`pending: seeded ${name} has nothing pending`, async () => {
    assert.equal(await pending(await as(name)), null)
  })
}

test('pending: a user without a profile has nothing pending (the profile gate comes first)', () =>
  withUser(async (x) => assert.equal(await pending(x.client), null)))

// ---- registrar --------------------------------------------------------------------------------------
test('a client records the current notice for its business; accepting twice keeps the first record', () =>
  withoutNotice(async (c3) => {
    assert.equal((await register(c3, 'aviso_rol', AVISO_ROL_VERSION)).error, null)
    const rows = await rowsOf(u.CLIENT3)
    assert.deepEqual(rows.filter((r) => r.tipo === 'aviso_rol').map((r) => [r.negocio_id, r.version]), [[A, AVISO_ROL_VERSION]])
    assert.equal((await register(c3, 'aviso_rol', AVISO_ROL_VERSION)).error, null)
    assert.deepEqual(await rowsOf(u.CLIENT3), rows)
    assert.equal(await pending(c3), null)
  }))

for (const [label, version] of Object.entries({ old: '2026-01-01-borrador', empty: '', null: null, 'other case': AVISO_ROL_VERSION.toUpperCase(), 'trailing space': `${AVISO_ROL_VERSION} ` })) {
  test(`registrar: the ${label} version raises version_invalida and stores nothing`, () =>
    withoutNotice(async (c3) => {
      const before = await rowsOf(u.CLIENT3)
      refused(await register(c3, 'aviso_rol', version), /version_invalida/)
      assert.deepEqual(await rowsOf(u.CLIENT3), before)
      assert.equal((await pending(c3))?.tipo, 'aviso_rol')
    }))
}

for (const [actor, tipo] of [
  ['OFFICE', 'terminos_negocio'], ['WALKER_CO', 'terminos_negocio'], ['CLIENT', 'terminos_negocio'],
  ['OWNER', 'aviso_rol'], ['OFFICE', 'aviso_rol'], ['WALKER_CO', 'aviso_rol'], ['WALKER_IND', 'aviso_rol'],
  ['OWNER', 'politica_negocio'], ['CLIENT', 'politica_negocio'], ['CLIENT', 'otro'], ['CLIENT', null], ['NOPROFILE', 'aviso_rol'],
]) {
  test(`registrar: ${actor} cannot accept ${tipo} (42501) and nothing is stored`, async () => {
    const before = await rowsOf(u[actor])
    const version = tipo === 'terminos_negocio' ? TERMINOS_NEGOCIO_VERSION : AVISO_ROL_VERSION
    denied(await register(await as(actor), tipo, version))
    assert.deepEqual(await rowsOf(u[actor]), before)
  })
}

test('ANON cannot execute the functions (permission denied)', async () => {
  const anon = await as('ANON')
  denied(await anon.rpc('aceptacion_pendiente'))
  denied(await anon.rpc('aceptacion_registrar', { p_tipo: 'aviso_rol', p_version: AVISO_ROL_VERSION }))
  denied(await anon.rpc('version_vigente', { p_tipo: 'aviso_rol' }))
})

// ---- the table -----------------------------------------------------------------------------------------
test('nobody writes aceptaciones directly, not even its own current row', () =>
  withoutNotice(async (c3) => {
    denied(await c3.from('aceptaciones').insert({ user_id: u.CLIENT3, tipo: 'aviso_rol', negocio_id: A, version: AVISO_ROL_VERSION }))
    assert.equal((await pending(c3))?.tipo, 'aviso_rol')
    const client = await as('CLIENT')
    denied(await client.from('aceptaciones').update({ version: 'x' }).eq('user_id', u.CLIENT))
    denied(await client.from('aceptaciones').delete().eq('user_id', u.CLIENT))
    assert.deepEqual((await rowsOf(u.CLIENT)).map((r) => [r.tipo, r.version]), [['aviso_rol', AVISO_ROL_VERSION]])
  }))

test('each user reads only its own rows', async () => {
  for (const name of ['CLIENT', 'OWNER', 'OFFICE']) {
    const res = await (await as(name)).from('aceptaciones').select('user_id')
    assert.equal(res.error, null, res.error?.message)
    assert.deepEqual([...new Set(res.data.map((r) => r.user_id))], name === 'OFFICE' ? [] : [u[name]], name)
  }
  assert.ok((await db().from('aceptaciones').select('id', { count: 'exact', head: true }).in('user_id', [u.CLIENT2, u.OTHER])).count >= 2, 'other rows exist')
})

// ---- reservar / comprar_producto ------------------------------------------------------------------------
test('reservar and comprar_producto refuse a client without the current notice and work once it is accepted', () =>
  withoutNotice(async (c3) => {
    const book = { p_perro: d5, p_servicio: ids.servicios.banoA, p_grupo: null, p_fecha: day(5) }
    const buy = { p_perro: d5, p_servicio: COMIDA, p_cantidad: 1 }
    refused(await c3.rpc('reservar', book), /aviso_rol_pendiente/)
    refused(await c3.rpc('comprar_producto', buy), /aviso_rol_pendiente/)
    assert.equal((await db().from('prestaciones').select('id', { count: 'exact', head: true }).eq('perro_id', d5)).count, 0, 'nothing booked')

    assert.equal((await register(c3, 'aviso_rol', AVISO_ROL_VERSION)).error, null)
    const b = await c3.rpc('reservar', book)
    assert.equal(b.error, null, b.error?.message)
    const p = await c3.rpc('comprar_producto', buy)
    assert.equal(p.error, null, p.error?.message)
  }))

test('the refusal still comes after the authorization check: another client gets 42501, not the notice error', () =>
  withoutNotice(async (c3) => {
    denied(await c3.rpc('reservar', { p_perro: ids.perros.d1, p_servicio: ids.servicios.banoA, p_grupo: null, p_fecha: day(5) }))
  }))

// ---- catalog and fixtures --------------------------------------------------------------------------------
test('catalog: pending/registrar are definer with an empty search_path; aceptado() is internal', () => {
  const fns = sql(`select p.proname, p.prosecdef, p.proconfig @> array['search_path=""'] as pinned,
      has_function_privilege('anon', p.oid, 'execute') as anon_exec,
      has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
    from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('aceptacion_pendiente', 'aceptacion_registrar', 'aceptado', 'version_vigente') order by 1`)
  assert.deepEqual(fns.map((f) => [f.proname, f.prosecdef, f.pinned, f.anon_exec, f.auth_exec]), [
    ['aceptacion_pendiente', true, true, false, true],
    ['aceptacion_registrar', true, true, false, true],
    ['aceptado', true, true, false, false],
    ['version_vigente', false, true, false, true],
  ])
})

test('the seeded owners and clients hold the current acceptances (fixture precondition for the E2E gate)', async () => {
  const { data } = await db().from('aceptaciones').select('user_id, tipo, negocio_id, version').in('user_id', Object.values(u))
  const has = (name, tipo, neg, version) => data.some((r) => r.user_id === u[name] && r.tipo === tipo && r.negocio_id === neg && r.version === version)
  for (const [name, neg] of [['OWNER', A], ['OTHER', ids.negocios.B], ['WALKER_IND', I]]) assert.ok(has(name, 'terminos_negocio', neg, TERMINOS_NEGOCIO_VERSION), name)
  for (const [name, neg] of [['CLIENT', A], ['CLIENT2', A], ['CLIENT3', A], ['COOWNER', A], ['CLIENT_I', I]]) assert.ok(has(name, 'aviso_rol', neg, AVISO_ROL_VERSION), name)
})
