// S4a2 side-table RPCs and dual-write sync (additive). Who may call which RPC (RV-4c, RV-4d,
// RV-3a name projection, RV-8a) and the write paths that feed the side tables now that the legacy
// columns and their sync triggers are gone (S4b).
import { after, before, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { admin, as, day, ids, seed, tempUser, writePrestaciones } from './_actors.mjs'
import { sql } from './_sql.mjs'
import { create } from './_invites.mjs'
import { POLITICA_VERSION } from '../../src/lib/politica.js'

const u = ids.users
const { A } = ids.negocios
const { d1, d2, d4 } = ids.perros
const { g1 } = ids.grupos
const { paseoA, banoA } = ids.servicios
const db = () => admin()
const call = async (actor, fn, args) => (await as(actor)).rpc(fn, args)
const ok = (res, what = 'call') => assert.equal(res.error, null, `${what}: ${res.error?.message}`)
const denied = (res, what = 'call') => assert.equal(res.error?.code, '42501', `${what}: expected 42501, got ${res.error?.code ?? 'no error'}`)
const raised = (res, re, what = 'call') => {
  assert.equal(res.error?.code, 'P0001', `${what}: expected a raised error, got ${res.error?.code ?? 'no error'}`)
  assert.match(res.error.message, re)
}
const one = async (table, key, id, cols = '*') => (await db().from(table).select(cols).eq(key, id).maybeSingle()).data

before(async () => {
  await seed()
})
after(async () => {
  await db().from('permisos').delete().in('user_id', [u.OFFICE, u.OFFICE_FIN])
  await db().from('servicios').delete().like('nombre', 's4a2 %')
  await db().from('contactos').update({ telefono: null }).in('user_id', [u.CLIENT, u.WALKER_CO, u.WALKER_IND, u.OFFICE, u.OWNER, u.CLIENT_I])
  await db().from('prestaciones').delete().eq('negocio_id', A).like('detalle->>nota', 's4a2%')
})

// ---- permiso_finanzas_set (RV-4c, RV-4d) ----
const flag = async (id) => one('permisos', 'user_id', id, 'finanzas,otorgado_por,negocio_id')
const grant = (actor, user, on = true) => call(actor, 'permiso_finanzas_set', { p_user: user, p_on: on })

test('RV-4c: only the owner grants the finance flag, and only to an office member of its tenant', async () => {
  ok(await grant('OWNER', u.OFFICE, true), 'owner grants (precondition)')
  assert.deepEqual(await flag(u.OFFICE), { finanzas: true, otorgado_por: u.OWNER, negocio_id: A })
  ok(await grant('OWNER', u.OFFICE, false), 'owner revokes')
  assert.equal((await flag(u.OFFICE)).finanzas, false)
  ok(await grant('OWNER', u.OFFICE_FIN, true))
  for (const [actor, target] of [['OFFICE', u.OFFICE], ['OFFICE', u.OFFICE_FIN], ['OFFICE_FIN', u.OFFICE], ['WALKER_CO', u.OFFICE], ['CLIENT', u.OFFICE], ['NOPROFILE', u.OFFICE], ['ANON', u.OFFICE]]) {
    denied(await grant(actor, target), `${actor} -> ${target === u.OFFICE ? 'OFFICE' : 'OFFICE_FIN'}`)
  }
  raised(await grant('OTHER', u.OFFICE), /destino_invalido/, 'a foreign owner cannot reach another tenant')
  assert.equal((await flag(u.OFFICE)).finanzas, false, 'denied calls changed nothing')
  for (const target of [u.WALKER_CO, u.CLIENT, u.OTHER, u.OWNER, randomUUID(), null]) raised(await grant('OWNER', target), /destino_invalido/, `target ${target}`)
  assert.equal(await flag(u.WALKER_CO), null)
  raised(await grant('OWNER', u.OFFICE, null), /valor_invalido/)
})

test('RV-4d + cobro_marcar: the flag opens charges and prices on the same session, writes the charge, and revocation closes them', async () => {
  const book = (precio_aplicado) => writePrestaciones({ negocio_id: A, perro_id: d2, servicio_id: paseoA, tipo: 'paseo', estado: 'finalizado', precio_aplicado, fecha: day(-1), detalle: { nota: 's4a2 cobro' } }).then((r) => r.data[0])
  const p = await book(20000)
  const mark = () => call('OFFICE_FIN', 'cobro_marcar', { p_prestacion: p.id })
  const seen = async () => (await (await as('OFFICE_FIN')).from('cobros').select('prestacion_id')).data.length
  ok(await grant('OWNER', u.OFFICE_FIN, true))
  assert.ok((await seen()) > 0, 'finance office reads charges')
  try {
    denied(await call('OFFICE', 'cobro_marcar', { p_prestacion: p.id }), 'office without the flag')
    ok(await mark(), 'office with the flag')
    const paid = await one('cobros', 'prestacion_id', p.id, 'cobrado,confirmado_por,confirmado_at,precio_aplicado')
    assert.deepEqual([paid.cobrado, paid.confirmado_por, paid.precio_aplicado], [true, u.OFFICE_FIN, 20000])
    assert.ok(Math.abs(new Date(paid.confirmado_at).getTime() - Date.now()) < 120000, 'confirmation time is the server clock')
    ok(await grant('OWNER', u.OFFICE_FIN, false))
    assert.equal(await seen(), 0, 'revoked flag closes charges on the same session')
    const q = await book(1)
    denied(await call('OFFICE_FIN', 'cobro_marcar', { p_prestacion: q.id }), 'revoked flag')
    assert.equal((await one('cobros', 'prestacion_id', q.id)).cobrado, false)
  } finally {
    await db().from('permisos').delete().eq('user_id', u.OFFICE_FIN)
  }
})

// ---- contacto_set (RV-8a) ----
test('contacto_set: every signed-in profile sets only its own phone', async () => {
  const other = async () => (await db().from('contactos').select('*').eq('user_id', u.CLIENT2)).data
  const untouched = await other()
  for (const actor of ['OWNER', 'OFFICE', 'WALKER_CO', 'CLIENT', 'WALKER_IND', 'CLIENT_I']) {
    const want = `+57 300-${actor.length}22`
    ok(await call(actor, 'contacto_set', { p_telefono: ` ${want} ` }), actor)
    const prof = await one('profiles', 'id', u[actor], 'rol,negocio_id')
    assert.deepEqual(await one('contactos', 'user_id', u[actor], 'telefono,rol,negocio_id'), { telefono: want, ...prof }, `${actor} contactos`)
  }
  assert.deepEqual(await other(), untouched, 'others untouched')
  ok(await call('CLIENT', 'contacto_set', { p_telefono: null }), 'clear')
  assert.equal((await one('contactos', 'user_id', u.CLIENT)).telefono, null)
  for (const bad of ['abc', 'x'.repeat(40), '1']) raised(await call('CLIENT', 'contacto_set', { p_telefono: bad }), /telefono_invalido/, bad)
  denied(await call('NOPROFILE', 'contacto_set', { p_telefono: '3001112233' }), 'no profile')
  denied(await call('ANON', 'contacto_set', { p_telefono: '3001112233' }), 'anon')
  assert.equal(await one('contactos', 'user_id', u.NOPROFILE), null)
})

// ---- perro_duenos_nombres (RV-3a) ----
test('perro_duenos_nombres: gestors get the principal name of their own tenant dogs, nothing else', async () => {
  const names = async (neg) => {
    const dogs = (await db().from('perros').select('id').eq('negocio_id', neg)).data.map((d) => d.id)
    const links = (await db().from('perro_duenos').select('perro_id,dueno_id').in('perro_id', dogs).eq('rol', 'principal').eq('estado', 'activo')).data
    const prof = (await db().from('profiles').select('id,nombre').in('id', links.map((l) => l.dueno_id))).data
    return links.map((l) => ({ perro_id: l.perro_id, nombre: prof.find((p) => p.id === l.dueno_id).nombre })).sort((a, b) => (a.perro_id < b.perro_id ? -1 : 1))
  }
  const A_ = await names(A)
  assert.ok(A_.length >= 2 && A_.some((r) => r.perro_id === d1 && r.nombre === 'Client'), 'fixture precondition')
  const rows = {}
  for (const actor of ['OWNER', 'OFFICE', 'OFFICE_FIN', 'OTHER', 'WALKER_IND']) {
    const res = await call(actor, 'perro_duenos_nombres')
    ok(res, actor)
    rows[actor] = res.data
    assert.ok(res.data.every((r) => Object.keys(r).sort().join() === 'nombre,perro_id'), `${actor} columns`)
  }
  for (const a of ['OWNER', 'OFFICE', 'OFFICE_FIN']) assert.deepEqual([...rows[a]].sort((x, y) => (x.perro_id < y.perro_id ? -1 : 1)), A_, a)
  assert.deepEqual(rows.OTHER, await names(ids.negocios.B))
  assert.deepEqual(rows.WALKER_IND, await names(ids.negocios.I))
  for (const actor of ['WALKER_CO', 'CLIENT', 'COOWNER', 'NOPROFILE', 'ANON']) denied(await call(actor, 'perro_duenos_nombres'), actor)
})

// ---- walks_dog ----
test('walks_dog: the assignee of a recent walk or of a group the dog belongs to', async () => {
  const w = async (actor, dog) => { const r = await call(actor, 'walks_dog', { pid: dog }); ok(r, actor); return r.data }
  assert.equal(await w('WALKER_CO', d1), true, 'today walk + group g1')
  assert.equal(await w('WALKER_CO2', d4), true, 'group g2 member, no walk needed')
  for (const [actor, dog] of [['WALKER_CO2', d1], ['WALKER_CO', d4], ['CLIENT', d1], ['OFFICE', d1], ['NOPROFILE', d1], ['OTHER', d1]]) assert.equal(await w(actor, dog), false, `${actor} / ${dog}`)
  const hoy = (n) => new Date(Date.now() - 5 * 36e5 + n * 864e5).toISOString().slice(0, 10)
  for (const [n, want] of [[-1, true], [-3, false]]) {
    const { data: p } = await db().from('prestaciones').insert({ negocio_id: A, perro_id: d2, tipo: 'paseo', cuidador_id: u.WALKER_CO2, fecha: hoy(n), estado: 'finalizado', detalle: { nota: 's4a2 walk' } }).select('id').single()
    assert.equal(await w('WALKER_CO2', d2), want, `walk ${n} days ago`)
    await db().from('prestaciones').delete().eq('id', p.id)
  }
  denied(await call('ANON', 'walks_dog', { pid: d1 }), 'anon')
})

// ---- servicio_guardar ----
test('servicio_guardar: the owner saves a service; its price lands in tarifas', async () => {
  const save = (actor, a) => call(actor, 'servicio_guardar', { p_id: null, p_nombre: 's4a2 svc', p_tipo: 'paseo', p_duracion: 30, p_precio: 15000, p_modelo: 'por_uso', ...a })
  const both = async (id) => ({ s: await one('servicios', 'id', id, 'negocio_id,tipo,nombre,duracion_min,modelo_cobro'), t: await one('tarifas', 'servicio_id', id, 'negocio_id,precio,precio_mensual') })
  const c = await save('OWNER')
  ok(c, 'create')
  let r = await both(c.data)
  assert.deepEqual(r.s, { negocio_id: A, tipo: 'paseo', nombre: 's4a2 svc', duracion_min: 30, modelo_cobro: 'por_uso' })
  assert.deepEqual(r.t, { negocio_id: A, precio: 15000, precio_mensual: 0 })
  ok(await save('OWNER', { p_id: c.data, p_precio: 90000, p_modelo: 'mensual', p_nombre: 's4a2 svc2' }), 'update')
  r = await both(c.data)
  assert.deepEqual([r.s.modelo_cobro, r.s.nombre], ['mensual', 's4a2 svc2'])
  assert.deepEqual([r.t.precio, r.t.precio_mensual], [0, 90000])
  const snapshot = await both(c.data)
  denied(await save('OTHER', { p_id: c.data, p_precio: 1 }), 'another tenant owner, update')
  for (const actor of ['OFFICE', 'OFFICE_FIN', 'WALKER_CO', 'CLIENT', 'NOPROFILE', 'ANON']) {
    denied(await save(actor, { p_id: c.data, p_precio: 1 }), `${actor} update`)
    denied(await save(actor), `${actor} create`)
  }
  assert.deepEqual(await both(c.data), snapshot)
  assert.equal((await db().from('servicios').select('id').like('nombre', 's4a2 svc%')).data.length, 1, 'denied creates added nothing')
  for (const bad of [{ p_modelo: 'x' }, { p_precio: -1 }, { p_nombre: ' ' }, { p_duracion: -5 }, { p_precio: null }, { p_id: randomUUID() }]) {
    assert.ok((await save('OWNER', bad)).error, JSON.stringify(bad))
  }
  assert.equal((await save('OWNER', { p_tipo: 'zzz' })).error?.code, '23514', 'unknown type hits the table CHECK')
  assert.deepEqual(await both(c.data), snapshot)
})

// ---- catalog ----
test('RPCs are SECURITY DEFINER with an empty search_path; the trigger functions are closed to every API role', () => {
  const rpcs = ['walks_dog', 'permiso_finanzas_set', 'servicio_guardar', 'contacto_set', 'perro_duenos_nombres', 'cobro_marcar']
  const trig = ['profile_contacto', 'prestacion_cobro']
  const fns = sql(`select proname, prosecdef, coalesce(proconfig @> array['search_path=""'], false) as pinned,
      has_function_privilege('anon', oid, 'execute') as anon, has_function_privilege('authenticated', oid, 'execute') as auth
    from pg_proc where pronamespace = 'public'::regnamespace and proname = any(array[${[...rpcs, ...trig].map((n) => `'${n}'`)}]) order by 1`)
  assert.equal(fns.length, rpcs.length + trig.length)
  for (const f of fns) assert.deepEqual([f.prosecdef, f.pinned, f.anon, f.auth], [true, true, false, rpcs.includes(f.proname)], f.proname)
  const t = sql(`select count(*)::int as n from pg_trigger where not tgisinternal and tgname in ('trg_profile_contacto','trg_prestacion_cobro')`)
  assert.equal(t[0].n, 2)
})

// ---- write paths that feed the side tables ----
test('provision_negocio stores the phone in contactos; redeem_invite creates the contactos row and no payroll for a client', async () => {
  const t = await tempUser()
  try {
    ok(await t.client.rpc('provision_negocio', { p_rol: 'empresa', p_nombre: 'S4b Ana', p_negocio: 'S4b SAS', p_telefono: '3009998877', p_politica: POLITICA_VERSION }), 'provision')
    const prof = await one('profiles', 'id', t.id, 'rol,negocio_id')
    assert.deepEqual(await one('contactos', 'user_id', t.id, 'telefono,rol,negocio_id'), { telefono: '3009998877', ...prof })
  } finally { await t.drop() }
  assert.equal(await one('contactos', 'user_id', t.id), null, 'contactos goes with its profile')
  const c = await tempUser()
  try {
    const inv = await create('OWNER', 'cliente', c.email)
    ok(inv, 'invite')
    ok(await c.client.rpc('redeem_invite', { p_codigo: inv.data, p_politica: POLITICA_VERSION }), 'redeem')
    assert.deepEqual(await one('contactos', 'user_id', c.id, 'telefono,rol,negocio_id'), { telefono: null, rol: 'cliente', negocio_id: A })
    assert.equal(await one('nomina', 'user_id', c.id), null, 'clients have no payroll row')
  } finally { await c.drop() }
})
