// "Mis datos" (Ley 1581): a user files data-rights requests through solicitud_datos_crear (server
// timestamp, due date of 10 / 15 business days), reads only their own, and nobody writes the table
// directly; mis_datos_exportar() returns only the caller's own personal data; the name is corrected
// through the own-row profile update (now length-bounded) and the phone through contacto_set. A request
// outlives the deletion of its author, without the author's id or free text (Ley 1581 art. 17).
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, credentials, ids, seed, tempUser } from './_actors.mjs'
import { denied, withUser } from './_invites.mjs'
import { sql } from './_sql.mjs'

const u = ids.users
const TIPOS = ['consulta', 'rectificacion', 'supresion', 'revocacion']
const STAFF = ['OWNER', 'OFFICE', 'OFFICE_FIN', 'WALKER_CO', 'OTHER', 'WALKER_IND']
const ok = ({ error }, what) => assert.equal(error, null, `${what}: ${error?.message}`)
const code = (res, want, what) => assert.equal(res.error?.code, want, `${what}: expected ${want}, got ${res.error?.code ?? 'no error'}`)
const clean = () => admin().from('solicitudes_datos').delete().in('user_id', Object.values(u))
const crear = async (actor, p_tipo, p_detalle = '') => (typeof actor === 'string' ? await as(actor) : actor).rpc('solicitud_datos_crear', { p_tipo, p_detalle })
const exportar = async (actor) => {
  const res = await (await as(actor)).rpc('mis_datos_exportar')
  ok(res, `export ${actor}`)
  return res.data
}

// Colombian public holidays (Ley 51 de 1983), written out from the official calendar so the server's
// es_festivo_co() is checked against an independent list.
const FESTIVOS = {
  2026: ['2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03', '2026-05-01', '2026-05-18', '2026-06-08', '2026-06-15',
    '2026-06-29', '2026-07-20', '2026-08-07', '2026-08-17', '2026-10-12', '2026-11-02', '2026-11-16', '2026-12-08', '2026-12-25'],
  2027: ['2027-01-01', '2027-01-11', '2027-03-22', '2027-03-25', '2027-03-26', '2027-05-01', '2027-05-10', '2027-05-31', '2027-06-07',
    '2027-07-05', '2027-07-20', '2027-08-07', '2027-08-16', '2027-10-18', '2027-11-01', '2027-11-15', '2027-12-08', '2027-12-25'],
}
const festivo = new Set(Object.values(FESTIVOS).flat())

// Expected due date computed independently: Bogota date of the server timestamp (UTC-5, no DST), then
// N business days (Monday to Friday and not a holiday) counted from the next day.
const bogota = (iso) => new Date(new Date(iso).getTime() - 5 * 3600e3).toISOString().slice(0, 10)
function plusBusinessDays(ymd, n) {
  let d = new Date(`${ymd}T00:00:00Z`)
  while (n > 0) {
    d = new Date(d.getTime() + 864e5)
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !festivo.has(d.toISOString().slice(0, 10))) n--
  }
  const out = d.toISOString().slice(0, 10)
  assert.ok(out.slice(0, 4) in FESTIVOS, `no holiday list for ${out}: add that year to FESTIVOS`)
  return out
}

before(async () => {
  await seed()
  await clean()
})
after(async () => {
  await clean()
  await admin().from('contactos').update({ telefono: null }).in('user_id', [u.CLIENT, u.CLIENT2])
  await admin().from('profiles').update({ nombre: 'Client' }).eq('id', u.CLIENT)
})

test('the expectation helper counts business days from the next day, skipping holidays (fixed dates)', () => {
  assert.equal(plusBusinessDays('2026-10-16', 10), '2026-10-30') // Friday + 10
  assert.equal(plusBusinessDays('2026-10-16', 15), '2026-11-09') // Monday 2 November is a holiday
  assert.equal(plusBusinessDays('2026-10-17', 10), '2026-10-30') // Saturday: the count starts on Monday
  assert.equal(bogota('2026-10-20T03:00:00Z'), '2026-10-19') // 22:00 in Bogota is still the 19th
})

test('a user files each request type; server timestamp, pendiente, due date 10 (consulta) or 15 business days', async () => {
  try {
    for (const tipo of TIPOS) {
      const t0 = Date.now()
      const res = await crear('CLIENT', tipo, `  Detalle de ${tipo}  `)
      ok(res, tipo)
      const [row] = (await admin().from('solicitudes_datos').select('*').eq('id', res.data.id)).data
      assert.deepEqual(
        { user_id: row.user_id, tipo: row.tipo, detalle: row.detalle, estado: row.estado, respondida_at: row.respondida_at, respuesta: row.respuesta },
        { user_id: u.CLIENT, tipo, detalle: `Detalle de ${tipo}`, estado: 'pendiente', respondida_at: null, respuesta: null })
      assert.ok(Math.abs(new Date(row.created_at) - t0) < 5 * 60_000, `created_at ${row.created_at} is not now()`)
      assert.equal(row.vence_at, plusBusinessDays(bogota(row.created_at), tipo === 'consulta' ? 10 : 15), tipo)
      assert.equal(res.data.vence_at, row.vence_at)
    }
  } finally { await clean() }
})

test('es_festivo_co() marks exactly the Colombian public holidays of 2026 and 2027 (Ley 51 de 1983)', () => {
  for (const [year, want] of Object.entries(FESTIVOS)) {
    const got = sql(`select d::date::text as d from generate_series('${year}-01-01'::date, '${year}-12-31'::date, interval '1 day') d
      where public.es_festivo_co(d::date) order by 1`).map((r) => r.d)
    assert.deepEqual(got, want, year)
  }
})

test('the due date skips weekends and holidays: a request on the business day before a holiday is not counted on it', () => {
  const vence = (desde, n) => sql(`select public.dias_habiles_sumar('${desde}'::date, ${n})::text as v`)[0].v
  assert.equal(vence('2026-11-13', 10), '2026-11-30') // Friday; Monday 16 November is a holiday
  assert.equal(vence('2026-10-30', 10), '2026-11-17') // Friday; skips 2 and 16 November
  assert.equal(vence('2026-04-01', 15), '2026-04-24') // Wednesday before Holy Thursday and Good Friday
  assert.equal(vence('2026-10-16', 15), plusBusinessDays('2026-10-16', 15))
  assert.equal(vence('2026-12-23', 10), '2027-01-08') // across 25 December and 1 January
})

test('a request survives the deletion of its author, without personal data: user_id and detalle become null', async () => {
  const t = await tempUser()
  let id
  try {
    const res = await crear(t.client, 'supresion', 'Borren mi cuenta, soy Ana Pérez')
    ok(res, 'request')
    id = res.data.id
    ok(await t.drop(), 'delete the auth user')
    const rows = (await admin().from('solicitudes_datos').select('*').eq('id', id)).data
    assert.equal(rows.length, 1, 'the request row is kept as evidence that it was attended')
    const [row] = rows
    assert.deepEqual({ user_id: row.user_id, detalle: row.detalle, tipo: row.tipo, estado: row.estado, vence_at: row.vence_at },
      { user_id: null, detalle: null, tipo: 'supresion', estado: 'pendiente', vence_at: res.data.vence_at })
    assert.ok(row.created_at)
  } finally {
    await t.drop()
    if (id) await admin().from('solicitudes_datos').delete().eq('id', id)
  }
})

test('read: the author sees only their own requests; another client, owner, office and walkers see none; anon is denied', async () => {
  try {
    ok(await crear('CLIENT', 'supresion'), 'CLIENT')
    ok(await crear('CLIENT2', 'consulta'), 'CLIENT2')
    const want = { CLIENT: [u.CLIENT], CLIENT2: [u.CLIENT2], COOWNER: [], CLIENT3: [], ...Object.fromEntries(STAFF.map((a) => [a, []])) }
    for (const [actor, owners] of Object.entries(want)) {
      const res = await (await as(actor)).from('solicitudes_datos').select('user_id, tipo')
      ok(res, actor)
      assert.deepEqual(res.data.map((r) => r.user_id), owners, actor)
    }
    denied(await (await as('ANON')).from('solicitudes_datos').select('id'))
  } finally { await clean() }
})

test('invalid tipo, a detalle over 1000 characters and anon are rejected and store nothing', async () => {
  try {
    for (const tipo of [null, '', 'otro', 'Consulta', 'consulta ']) code(await crear('CLIENT', tipo), '22023', `tipo ${JSON.stringify(tipo)}`)
    code(await crear('CLIENT', 'consulta', 'x'.repeat(1001)), '22023', '1001 characters')
    denied(await crear('ANON', 'consulta'))
    assert.deepEqual((await admin().from('solicitudes_datos').select('id').in('user_id', Object.values(u))).data, [])
    ok(await crear('CLIENT', 'consulta', 'x'.repeat(1000)), '1000 characters is the limit')
    ok(await crear('CLIENT', 'consulta', null), 'no detalle')
  } finally { await clean() }
})

test('direct INSERT, UPDATE and DELETE on solicitudes_datos are denied for every role, the author included', async () => {
  try {
    const { data } = await crear('CLIENT', 'consulta')
    for (const actor of ['CLIENT', 'CLIENT2', 'COOWNER', ...STAFF, 'ANON']) {
      const db = (await as(actor)).from('solicitudes_datos')
      denied(await db.insert({ user_id: u[actor] ?? u.CLIENT, tipo: 'consulta', vence_at: '2030-01-01' }))
      denied(await db.update({ estado: 'respondida' }).eq('id', data.id))
      denied(await db.delete().eq('id', data.id))
    }
    const [row] = (await admin().from('solicitudes_datos').select('estado').eq('id', data.id)).data
    assert.equal(row.estado, 'pendiente')
  } finally { await clean() }
})

test('export (client): own email, phone, dogs and services; nothing of another client, the walker or the co-owner', async () => {
  ok(await (await as('CLIENT')).rpc('contacto_set', { p_telefono: '+57 300 111 2233' }), 'CLIENT phone')
  ok(await admin().from('contactos').update({ telefono: '+57 300 999 8877' }).eq('user_id', u.CLIENT2), 'CLIENT2 phone')
  try {
    ok(await crear('CLIENT', 'consulta', 'Quiero saber qué datos tienen'), 'request')
    const d = await exportar('CLIENT')
    assert.deepEqual(Object.keys(d).sort(),
      ['consentimientos', 'cuenta', 'generado_at', 'negocio', 'perfil', 'perros', 'resenas', 'salario_fijo', 'servicios', 'solicitudes', 'telefono'])
    assert.equal(d.cuenta.email, credentials('CLIENT').email)
    assert.deepEqual([d.perfil.nombre, d.perfil.rol, d.telefono], ['Client', 'cliente', '+57 300 111 2233'])
    assert.deepEqual(d.negocio, { nombre: 'Tenant A', tipo: 'empresa', soy_dueno: false })
    assert.equal(d.salario_fijo, null)
    assert.deepEqual(d.perros.map((p) => [p.nombre, p.mi_rol]), [['Luna', 'principal'], ['Rex', 'principal']])
    const fixture = (await admin().from('prestaciones').select('id').in('perro_id', [ids.perros.d1, ids.perros.d2])).data.length
    assert.ok(fixture > 0)
    assert.equal(d.servicios.length, fixture)
    assert.ok(d.servicios.every((s) => ['Rex', 'Luna'].includes(s.perro)))
    assert.deepEqual(d.solicitudes.map((s) => [s.tipo, s.detalle, s.estado]), [['consulta', 'Quiero saber qué datos tienen', 'pendiente']])
    assert.ok(d.consentimientos.length > 0)
    const text = JSON.stringify(d)
    for (const other of ['CLIENT2', 'COOWNER', 'WALKER_CO', 'OWNER']) assert.ok(!text.includes(credentials(other).email), `${other} email`)
    for (const leak of ['+57 300 999 8877', 'Toby', 'Nina', 'Coowner', 'Walker Co', 'Client2', u.WALKER_CO, u.COOWNER]) assert.ok(!text.includes(leak), leak)
  } finally { await clean() }
})

test('export (company walker and owner): own data only, no dogs, services or contact data of clients or colleagues', async () => {
  ok(await admin().from('contactos').update({ telefono: '+57 300 999 8877' }).eq('user_id', u.CLIENT2), 'CLIENT2 phone')
  ok(await admin().from('nomina').upsert({ user_id: u.WALKER_CO, negocio_id: ids.negocios.A, salario_fijo: 1500000 }), 'walker salary')
  try {
    const w = await exportar('WALKER_CO')
    assert.deepEqual([w.cuenta.email, w.perfil.rol, w.negocio.soy_dueno, w.salario_fijo, w.perros, w.servicios],
      [credentials('WALKER_CO').email, 'paseador', false, 1500000, [], []])
    const o = await exportar('OWNER')
    assert.deepEqual([o.cuenta.email, o.perfil.nombre, o.negocio, o.perros, o.servicios],
      [credentials('OWNER').email, 'Owner A', { nombre: 'Tenant A', tipo: 'empresa', soy_dueno: true }, [], []])
    for (const [actor, d] of [['WALKER_CO', w], ['OWNER', o]]) {
      const text = JSON.stringify(d)
      for (const other of ['CLIENT', 'CLIENT2', 'OFFICE', 'WALKER_CO2', 'OWNER', 'WALKER_CO'].filter((x) => x !== actor)) {
        assert.ok(!text.includes(credentials(other).email), `${actor}: ${other} email`)
        assert.ok(!text.includes(u[other]), `${actor}: ${other} id`)
      }
      for (const leak of ['+57 300 999 8877', 'Rex', 'Luna', 'Client', 'Office A', 'Walker Co2']) assert.ok(!text.includes(leak), `${actor}: ${leak}`)
    }
  } finally {
    await admin().from('nomina').update({ salario_fijo: 0 }).eq('user_id', u.WALKER_CO)
  }
})

test('a signed-in user without a profile can file a request and export their account; anon cannot export', () =>
  withUser(async (nobody) => {
    ok(await crear(nobody.client, 'consulta'), 'request without profile')
    const res = await nobody.client.rpc('mis_datos_exportar')
    ok(res, 'export without profile')
    assert.deepEqual([res.data.cuenta.email, res.data.perfil, res.data.negocio, res.data.solicitudes.length], [nobody.email, null, null, 1])
    denied(await (await as('ANON')).rpc('mis_datos_exportar'))
  }))

test('name correction: the own-row update works within 1..100 characters; out of bounds is 23514; another user is untouched', async () => {
  const client = await as('CLIENT')
  const set = (nombre, id = u.CLIENT) => client.from('profiles').update({ nombre }).eq('id', id).select('nombre')
  try {
    const res = await set('Cliente Corregido')
    ok(res, 'rename')
    assert.deepEqual(res.data, [{ nombre: 'Cliente Corregido' }])
    assert.equal((await exportar('CLIENT')).perfil.nombre, 'Cliente Corregido')
    code(await set('x'.repeat(101)), '23514', '101 characters')
    code(await set('   '), '23514', 'blank')
    assert.deepEqual((await set('Hacked', u.CLIENT2)).data, [])
    assert.equal((await admin().from('profiles').select('nombre').eq('id', u.CLIENT2).single()).data.nombre, 'Client2')
    denied(await client.from('profiles').update({ rol: 'empresa' }).eq('id', u.CLIENT))
  } finally {
    await admin().from('profiles').update({ nombre: 'Client' }).eq('id', u.CLIENT)
  }
})

test('catalog: both functions are definer with an empty search_path, authenticated-only; anon set unchanged; table locked down', () => {
  const fns = sql(`select p.proname, p.prosecdef as definer, p.proconfig @> array['search_path=""'] as pinned,
      has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('mis_datos_exportar', 'solicitud_datos_crear') order by 1`)
  assert.deepEqual(fns, [
    { proname: 'mis_datos_exportar', definer: true, pinned: true, anon: false, auth: true },
    { proname: 'solicitud_datos_crear', definer: true, pinned: true, anon: false, auth: true },
  ])
  assert.deepEqual(sql(`select proname from pg_proc where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute') order by 1`).map((r) => r.proname), ['resenas_publicas'])
  const [t] = sql(`select c.relrowsecurity as rls,
      has_table_privilege('anon', c.oid, 'select,insert,update,delete') as anon,
      has_table_privilege('authenticated', c.oid, 'select') as sel,
      has_table_privilege('authenticated', c.oid, 'insert,update,delete,truncate') as write
    from pg_class c where c.oid = 'public.solicitudes_datos'::regclass`)
  assert.deepEqual(t, { rls: true, anon: false, sel: true, write: false })
  const helpers = sql(`select p.proname, p.proconfig @> array['search_path=""'] as pinned,
      has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('es_festivo_co', 'dias_habiles_sumar') order by 1`)
  assert.deepEqual(helpers, [
    { proname: 'dias_habiles_sumar', pinned: true, anon: false, auth: false },
    { proname: 'es_festivo_co', pinned: true, anon: false, auth: false },
  ])
})
