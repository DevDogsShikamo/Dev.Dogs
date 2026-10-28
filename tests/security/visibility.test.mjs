// S4b: what each role can read once the sensitive columns are gone (RV-1c, RV-2a, RV-2c, RV-3a, RV-4a, RV-4b,
// RV-4e, RV-5c, RV-6a, RV-6b). Row sets are exact and every "none" follows a precondition where a
// privileged actor sees the row. Contact / finance / salary row-level rules are in side-tables.test.mjs.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, day, ids, seed } from './_actors.mjs'
import { sql } from './_sql.mjs'

const u = ids.users
const { d1, d2, d3, d4, d5, dB, dI } = ids.perros
const P = ids.prestaciones
const A = ids.negocios.A
const ok = ({ error }, what) => assert.equal(error, null, `${what}: ${error?.message}`)
const rows = async (actor, table, cols = '*') => {
  const res = await (await as(actor)).from(table).select(cols)
  ok(res, `${table} as ${actor}`)
  return res.data
}
const keys = (data) => [...new Set(data.flatMap((r) => Object.keys(r)))].sort()
const sorted = (list) => [...list].sort()
const MONEY = ['precio_aplicado', 'cobrable', 'cobrado', 'confirmado_por', 'confirmado_at']

before(async () => {
  await seed()
  ok(await admin().from('permisos').upsert({ user_id: u.OFFICE_FIN, negocio_id: A, finanzas: true }), 'grant OFFICE_FIN')
})
after(() => admin().from('permisos').delete().eq('user_id', u.OFFICE_FIN))

test('RV-6b: every sensitive value lives only in its side table and no address-like column exists', () => {
  const cols = sql(`select table_name t, column_name c from information_schema.columns where table_schema = 'public'`)
  const where = (c) => sorted(cols.filter((x) => x.c === c).map((x) => x.t))
  const homes = {
    telefono: ['contactos'], salario_fijo: ['nomina'], microchip: ['perro_identidad'], zona: ['grupos'],
    precio: ['tarifas'], precio_mensual: ['suscripciones', 'tarifas'],
    precio_aplicado: ['cobros'], cobrable: ['cobros'], cobrado: ['cobros'], confirmado_por: ['cobros'], confirmado_at: ['cobros'],
  }
  for (const [c, tables] of Object.entries(homes)) assert.deepEqual(where(c), tables, `column ${c}`)
  // invitaciones.email is the invitee binding of a code (owner-only table), not a stored contact of a person.
  assert.deepEqual(cols.filter((x) => x.t !== 'invitaciones' && /direcc|address|calle|barrio|ciudad|email|correo/i.test(x.c)), [])
  assert.deepEqual(sorted(cols.filter((x) => x.t === 'profiles').map((x) => x.c)),
    ['created_at', 'horario', 'id', 'negocio_id', 'nombre', 'rol', 'vacaciones', 'verificado', 'verificado_at'])
})

test('the sync triggers, their functions and the backfill helper are gone', () => {
  assert.deepEqual(sql(`select proname from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'sync\\_%' or proname = 'backfill_side_tables')`), [])
  assert.deepEqual(sql(`select tgname from pg_trigger where tgname like 'trg\\_sync\\_%'`), [])
})

test('RV-1c / RV-3a / RV-5c: profiles carry no phone, salary, zone or email; office reads names of the whole tenant, others only themselves', async () => {
  const tenant = sorted((await admin().from('profiles').select('id').eq('negocio_id', A)).data.map((r) => r.id))
  assert.ok(tenant.includes(u.CLIENT) && tenant.includes(u.WALKER_CO), 'precondition: clients and walkers exist')
  const want = { OWNER: tenant, OFFICE: tenant, OFFICE_FIN: tenant, WALKER_CO: [u.WALKER_CO], CLIENT: [u.CLIENT], COOWNER: [u.COOWNER] }
  for (const [actor, ids_] of Object.entries(want)) {
    const data = await rows(actor, 'profiles')
    assert.deepEqual(sorted(data.map((r) => r.id)), sorted(ids_), `profiles as ${actor}`)
    assert.deepEqual(keys(data).filter((k) => /tel|salario|zona|mail|direc/.test(k)), [], `${actor} sees a sensitive profile key`)
  }
})

test('RV-2a / RV-3a: a company walker lists only the dogs it walks; office and owner the whole tenant; no microchip anywhere', async () => {
  const want = { OWNER: [d1, d2, d3, d4, d5], OFFICE: [d1, d2, d3, d4, d5], OFFICE_FIN: [d1, d2, d3, d4, d5], WALKER_CO: [d1, d3, d5], WALKER_CO2: [d4], WALKER_IND: [dI], OTHER: [dB] }
  for (const [actor, dogs] of Object.entries(want)) {
    const data = await rows(actor, 'perros')
    assert.deepEqual(sorted(data.map((r) => r.id)), sorted(dogs), `perros as ${actor}`)
    assert.ok(!keys(data).includes('microchip'), `${actor} sees a microchip key`)
  }
})

test('RV-2c: the company walker still reads its own day: dog name, zone label, hour, status', async () => {
  const day0 = (await (await as('WALKER_CO')).from('prestaciones').select('id,estado,tipo,detalle,perros(nombre)').eq('cuidador_id', u.WALKER_CO).eq('fecha', day(0))).data
  assert.deepEqual(day0.map((r) => [r.id, r.estado, r.perros.nombre, r.detalle.hora]), [[P.p1, 'programado', 'Rex', '08:00']])
  assert.deepEqual((await (await as('WALKER_CO')).from('grupos').select('zona,hora').eq('id', ids.grupos.g1)).data, [{ zona: 'Norte', hora: '08:00' }])
})

test('RV-4a / RV-4b / RV-4e: prestaciones carry no money; charges and prices follow the owner-granted permission', async () => {
  const mine = [P.p1, P.hist, P.unpaid, P.future]
  const want = { OWNER: Object.values(P), OFFICE: Object.values(P), WALKER_CO: mine, WALKER_CO2: [], CLIENT2: [] }
  for (const [actor, list] of Object.entries(want)) {
    const data = await rows(actor, 'prestaciones')
    assert.deepEqual(sorted(data.map((r) => r.id)), sorted(list), `prestaciones as ${actor}`)
    assert.deepEqual(keys(data).filter((k) => MONEY.includes(k)), [], `${actor} sees a money column`)
  }
  const charges = { OWNER: Object.values(P), OFFICE_FIN: Object.values(P), OFFICE: [], WALKER_CO: [], WALKER_CO2: [] }
  for (const [actor, list] of Object.entries(charges)) {
    assert.deepEqual(sorted((await rows(actor, 'cobros', 'prestacion_id')).map((r) => r.prestacion_id)), sorted(list), `cobros as ${actor}`)
  }
  assert.equal((await rows('OFFICE_FIN', 'tarifas')).length, 2)
  assert.equal((await rows('OFFICE', 'tarifas')).length, 0)
})

test('RV-6a: another tenant reads no person, dog, group or booking of tenant A', async () => {
  for (const table of ['profiles', 'perros', 'grupos', 'prestaciones', 'negocios']) {
    const col = table === 'negocios' ? 'id' : 'negocio_id'
    assert.ok((await admin().from(table).select('id').eq(col, A)).data.length > 0, `precondition: ${table} has tenant A rows`)
    const res = await (await as('OTHER')).from(table).select('id').eq(col, A)
    ok(res, `${table} as OTHER`)
    assert.deepEqual(res.data, [], `${table} leaked to OTHER`)
  }
})

test('the owner can no longer edit another profile (policy "profiles update owner" is gone)', async () => {
  const before_ = (await admin().from('profiles').select('nombre').eq('id', u.WALKER_CO).single()).data.nombre
  const res = await (await as('OWNER')).from('profiles').update({ nombre: 'Hacked' }).eq('id', u.WALKER_CO).select('id')
  assert.deepEqual(res.data, [])
  assert.equal((await admin().from('profiles').select('nombre').eq('id', u.WALKER_CO).single()).data.nombre, before_)
})
