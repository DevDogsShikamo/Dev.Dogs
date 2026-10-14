// S4a1 side tables (contactos, nomina, permisos, tarifas, cobros, perro_identidad): who reads which
// rows (RV-1a/b, RV-5a/b/d, RV-8a/b, D5/D5b, microchip) and the backfill from the legacy columns.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { ACTORS, admin, as, ids, seed } from './_actors.mjs'
import { sql } from './_sql.mjs'

const u = ids.users
const P = ids.prestaciones
const names = Object.keys(ACTORS)
const withProfile = names.filter((n) => ACTORS[n].rol)
const neg = (n) => ids.negocios[ACTORS[n].neg]
const ok = ({ error }, what) => assert.equal(error, null, `${what}: ${error?.message}`)
const denied = (res, what) => assert.equal(res.error?.code, '42501', `${what}: expected 42501, got ${res.error?.code ?? 'no error'}`)

// Distinctive legacy values, copied by backfill_side_tables().
const phone = (n) => `tel-${n}`
const salary = (n) => 1000 + names.indexOf(n)
const chip = { [ids.perros.d1]: 'DDTEST-CHIP-1', [ids.perros.d3]: 'DDTEST-CHIP-3', [ids.perros.dB]: 'DDTEST-CHIP-B', [ids.perros.dI]: 'DDTEST-CHIP-I' }
const flagged = ['OFFICE_FIN', 'WALKER_CO'] // WALKER_CO's flag is stale on purpose: has_finanzas() needs an office role

let ready
const setup = () => (ready ??= (async () => {
  await seed()
  const db = admin()
  for (const n of withProfile) ok(await db.from('profiles').update({ telefono: phone(n), salario_fijo: salary(n) }).eq('id', u[n]), 'profile')
  for (const [id, microchip] of Object.entries(chip)) ok(await db.from('perros').update({ microchip }).eq('id', id), 'chip')
  ok(await db.from('permisos').upsert(flagged.map((n) => ({ user_id: u[n], negocio_id: neg(n), finanzas: true }))), 'permisos')
  ok(await db.rpc('backfill_side_tables'), 'backfill')
})())

after(async () => {
  if (!ready) return
  const db = admin()
  await db.from('permisos').delete().in('user_id', flagged.map((n) => u[n]))
  await db.from('perro_identidad').delete().in('perro_id', Object.keys(chip))
  await db.from('perros').update({ microchip: null }).in('id', Object.keys(chip))
  await db.from('profiles').update({ telefono: null, salario_fijo: 0 }).in('id', withProfile.map((n) => u[n]))
  await db.rpc('backfill_side_tables')
})

// ---- visibility matrix: actor -> the fixture rows it may read (anything absent = zero rows) ----
const staffA = ['OWNER', 'OFFICE', 'OFFICE_FIN', 'WALKER_CO', 'WALKER_CO2']
const self = Object.fromEntries(withProfile.map((n) => [n, [n]]))
const money = ['OWNER', 'OFFICE_FIN']
const forAll = (actors, keys) => Object.fromEntries(actors.map((n) => [n, keys]))
const tables = {
  // D3/D4 + P7: owner reads the tenant, office reads staff only, everyone else only self.
  contactos: { key: 'user_id', ids: u, col: 'telefono', val: phone, expect: { ...self, OWNER: [...staffA, 'CLIENT', 'CLIENT2', 'CLIENT3', 'COOWNER'], OFFICE: staffA, OFFICE_FIN: staffA, WALKER_IND: ['WALKER_IND', 'CLIENT_I'] } },
  // D5b: owner reads staff salaries; each employee reads only its own row; finance never opens it.
  nomina: { key: 'user_id', ids: u, col: 'salario_fijo', val: salary, expect: { ...self, ...forAll(['CLIENT', 'CLIENT2', 'CLIENT3', 'COOWNER', 'CLIENT_I'], []), OWNER: staffA } },
  permisos: { key: 'user_id', ids: u, expect: { OWNER: flagged, OFFICE_FIN: ['OFFICE_FIN'], WALKER_CO: ['WALKER_CO'] } },
  // D5: prices for the owner, finance office and the tenant's clients; never walkers or plain office.
  tarifas: { key: 'servicio_id', ids: ids.servicios, expect: forAll([...money, 'CLIENT', 'CLIENT2', 'CLIENT3', 'COOWNER'], ['paseoA', 'banoA']) },
  // Charges of d1: owner, finance office and d1's owners (principal and co-owner).
  cobros: { key: 'prestacion_id', ids: P, expect: forAll([...money, 'CLIENT', 'COOWNER'], Object.keys(P)) },
  // Microchip: owner of the tenant and the principal owner only (not the co-owner, not office, not walkers).
  perro_identidad: { key: 'perro_id', ids: ids.perros, expect: { OWNER: ['d1', 'd3'], CLIENT: ['d1'], CLIENT2: ['d3'], OTHER: ['dB'], WALKER_IND: ['dI'], CLIENT_I: ['dI'] } },
}

for (const [table, t] of Object.entries(tables)) {
  test(`${table}: every actor reads exactly its visible rows; ANON is denied`, async () => {
    await setup()
    const all = Object.values(t.ids)
    const stored = (await admin().from(table).select(t.key).in(t.key, all)).data ?? []
    const expectedKeys = new Set(Object.values(t.expect).flat().map((k) => t.ids[k]))
    assert.ok(expectedKeys.size > 0 && [...expectedKeys].every((k) => stored.some((r) => r[t.key] === k)), 'the rows an actor should see exist (precondition)')
    for (const n of names) {
      const res = await (await as(n)).from(table).select(t.col ? `${t.key},${t.col}` : t.key).in(t.key, all)
      ok(res, `${table} as ${n}`)
      const want = (t.expect[n] ?? []).map((k) => t.ids[k]).sort()
      assert.deepEqual(res.data.map((r) => r[t.key]).sort(), want, `${table} as ${n}`)
      for (const r of res.data) if (t.col) assert.equal(r[t.col], t.val(Object.keys(t.ids).find((k) => t.ids[k] === r[t.key])), `${table}.${t.col} as ${n}`)
    }
    denied(await (await as('ANON')).from(table).select(t.key), `${table} as ANON`)
  })
}

// ---- writes: the API never writes contact, flag, price or charge rows (RPCs do, S4a2) ----
test('contactos, permisos, tarifas and cobros reject every API write, even from the owner', async () => {
  await setup()
  const owner = await as('OWNER')
  const probes = { contactos: [u.CLIENT, 'user_id'], permisos: [u.OFFICE, 'user_id'], tarifas: [ids.servicios.paseoA, 'servicio_id'], cobros: [P.p1, 'prestacion_id'] }
  for (const [table, [id, key]] of Object.entries(probes)) {
    denied(await owner.from(table).insert({ [key]: id, negocio_id: ids.negocios.A }), `${table} insert`)
    denied(await owner.from(table).update({ negocio_id: ids.negocios.A }).eq(key, id), `${table} update`)
    denied(await owner.from(table).delete().eq(key, id), `${table} delete`)
  }
})

test('RV-5b/RV-5d: the owner updates salaries; employees read their own and cannot change it', async () => {
  await setup()
  const db = admin()
  const stored = async (n) => (await db.from('nomina').select('salario_fijo').eq('user_id', u[n]).single()).data.salario_fijo
  const bump = salary('WALKER_CO') + 500
  try {
    const up = await (await as('OWNER')).from('nomina').update({ salario_fijo: bump }).eq('user_id', u.WALKER_CO).select('salario_fijo')
    assert.deepEqual(up.data, [{ salario_fijo: bump }], 'owner update')
    await db.from('nomina').update({ salario_fijo: salary('WALKER_CO') }).eq('user_id', u.WALKER_CO)
    for (const [actor, target] of [['WALKER_CO', 'WALKER_CO'], ['OFFICE', 'OFFICE'], ['OFFICE', 'WALKER_CO'], ['OFFICE_FIN', 'WALKER_CO']]) {
      const c = await as(actor)
      const res = await c.from('nomina').update({ salario_fijo: 1 }).eq('user_id', u[target]).select('salario_fijo')
      assert.deepEqual(res.data, [], `${actor} updating ${target}'s salary matched a row`)
      const del = await c.from('nomina').delete().eq('user_id', u[target]).select('user_id')
      assert.deepEqual(del.data, [], `${actor} deleting ${target}'s salary matched a row`)
      assert.equal(await stored(target), salary(target), `${target} salary changed`)
    }
    denied(await (await as('WALKER_CO')).from('nomina').insert({ user_id: u.CLIENT, negocio_id: ids.negocios.A, salario_fijo: 1 }), 'walker insert')
  } finally {
    await db.from('nomina').update({ salario_fijo: salary('WALKER_CO') }).eq('user_id', u.WALKER_CO)
  }
})

test('perro_identidad: the owner writes it, the principal owner can only read it', async () => {
  await setup()
  const { d1, d2 } = ids.perros
  const owner = await as('OWNER')
  const client = await as('CLIENT')
  const stored = async () => (await admin().from('perro_identidad').select('microchip').eq('perro_id', d1).single()).data.microchip
  try {
    const up = await owner.from('perro_identidad').update({ microchip: 'DDTEST-CHIP-1B' }).eq('perro_id', d1).select('microchip')
    assert.deepEqual(up.data, [{ microchip: 'DDTEST-CHIP-1B' }])
    await admin().from('perro_identidad').update({ microchip: chip[d1] }).eq('perro_id', d1)
    const own = await client.from('perro_identidad').update({ microchip: 'x' }).eq('perro_id', d1).select('microchip')
    assert.deepEqual(own.data, [], 'the principal owner can read but not update')
    assert.equal(await stored(), chip[d1])
    denied(await client.from('perro_identidad').insert({ perro_id: d2, microchip: 'DDTEST-CHIP-X' }), 'client insert')
  } finally {
    await admin().from('perro_identidad').update({ microchip: chip[d1] }).eq('perro_id', d1)
    await admin().from('perro_identidad').delete().eq('microchip', 'DDTEST-CHIP-X')
  }
})

// ---- has_finanzas() (D5/D5b) ----
test('RV-4d: revoking the finance flag takes effect in the same session', async () => {
  await setup()
  const fin = await as('OFFICE_FIN')
  const seen = async (t, k) => (await fin.from(t).select(k)).data.length
  assert.equal(await seen('cobros', 'prestacion_id'), Object.keys(P).length)
  assert.equal(await seen('tarifas', 'servicio_id'), 2)
  try {
    ok(await admin().from('permisos').update({ finanzas: false }).eq('user_id', u.OFFICE_FIN), 'revoke')
    assert.equal(await seen('cobros', 'prestacion_id'), 0)
    assert.equal(await seen('tarifas', 'servicio_id'), 0)
    assert.equal(await seen('nomina', 'user_id'), 1, 'salary access never depended on the flag: own row only')
  } finally {
    await admin().from('permisos').update({ finanzas: true }).eq('user_id', u.OFFICE_FIN)
  }
})

// ---- catalog: helpers are definer + pinned + not anon-executable; tables carry RLS ----
test('new helpers are SECURITY DEFINER with an empty search_path and anon cannot execute or read anything', () => {
  const fns = sql(`select proname, prosecdef, coalesce(proconfig @> array['search_path=""'], false) as pinned,
      has_function_privilege('anon', oid, 'execute') as anon, has_function_privilege('authenticated', oid, 'execute') as auth
    from pg_proc where pronamespace = 'public'::regnamespace and proname in ('has_finanzas', 'owns_cobro', 'backfill_side_tables') order by 1`)
  assert.deepEqual(fns.map((f) => f.proname), ['backfill_side_tables', 'has_finanzas', 'owns_cobro'])
  for (const f of fns) assert.deepEqual([f.prosecdef, f.pinned, f.anon], [true, true, false], f.proname)
  assert.deepEqual(fns.map((f) => f.auth), [false, true, true], 'only the backfill stays closed to signed-in users')
  const tbl = sql(`select relname, relrowsecurity as rls, has_table_privilege('anon', oid, 'select') as anon
    from pg_class where relnamespace = 'public'::regnamespace and relname in ('contactos','nomina','permisos','cobros','tarifas','perro_identidad') order by 1`)
  assert.equal(tbl.length, 6)
  for (const t of tbl) assert.deepEqual([t.rls, t.anon], [true, false], t.relname)
})

// ---- backfill: each side table equals its legacy columns, row for row ----
test('backfill copies the legacy columns row for row and a re-run changes nothing', async () => {
  await setup()
  const db = admin()
  const A3 = Object.values(ids.negocios)
  const cases = [
    ['contactos', 'user_id,negocio_id,rol,telefono', 'profiles', 'id,negocio_id,rol,telefono', (r) => ({ user_id: r.id, negocio_id: r.negocio_id, rol: r.rol, telefono: r.telefono })],
    ['nomina', 'user_id,negocio_id,salario_fijo', 'profiles', 'id,negocio_id,rol,salario_fijo', (r) => ({ user_id: r.id, negocio_id: r.negocio_id, salario_fijo: r.salario_fijo ?? 0 }), (q) => q.neq('rol', 'cliente')],
    ['tarifas', 'servicio_id,negocio_id,precio,precio_mensual', 'servicios', 'id,negocio_id,precio,precio_mensual', (r) => ({ servicio_id: r.id, negocio_id: r.negocio_id, precio: r.precio ?? 0, precio_mensual: r.precio_mensual ?? 0 })],
    ['cobros', 'prestacion_id,negocio_id,precio_aplicado,cobrable,cobrado,confirmado_por,confirmado_at', 'prestaciones', 'id,negocio_id,precio_aplicado,cobrable,cobrado,confirmado_por,confirmado_at',
      (r) => ({ prestacion_id: r.id, negocio_id: r.negocio_id, precio_aplicado: r.precio_aplicado ?? 0, cobrable: r.cobrable ?? false, cobrado: r.cobrado ?? false, confirmado_por: r.confirmado_por, confirmado_at: r.confirmado_at })],
    ['perro_identidad', 'perro_id,microchip', 'perros', 'id,negocio_id,microchip', (r) => ({ perro_id: r.id, microchip: r.microchip }), (q) => q.not('microchip', 'is', null)],
  ]
  const check = async () => {
    for (const [side, sideCols, legacy, legacyCols, map, filter = (q) => q] of cases) {
      const key = Object.keys(map({}))[0]
      const expected = (await filter(db.from(legacy).select(legacyCols).in('negocio_id', A3))).data.map(map)
      const scopeIds = expected.map((r) => r[key])
      const actual = (await db.from(side).select(sideCols).in(key, scopeIds)).data
      assert.ok(expected.length > 0, `${side}: legacy rows exist (precondition)`)
      const sort = (rows) => rows.sort((a, b) => (a[key] < b[key] ? -1 : 1))
      assert.deepEqual(sort(actual), sort(expected), `${side} differs from ${legacy}`)
    }
  }
  await check()
  ok(await db.rpc('backfill_side_tables'), 'second run')
  await check()
})
