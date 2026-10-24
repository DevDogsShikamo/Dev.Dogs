// Business policies (20261022110001_politicas_negocio.sql): each business publishes its own service policies
// (negocio_politica_publicar, owner only, validated sections), every member reads only its business's current
// version, and its clients accept each new version (aceptaciones tipo politica_negocio) before reservar /
// comprar_producto work again. A business without a policy blocks nobody. The tests run in order: v1, then v2.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, day, ids, seed } from './_actors.mjs'
import { denied } from './_invites.mjs'
import { sql } from './_sql.mjs'
import { AVISO_ROL_VERSION } from '../../src/lib/politica.js'

const u = ids.users
const { A, B, I } = ids.negocios
const { d5 } = ids.perros
// CLIENT3 is the principal owner of d5 (tenant A).
const COMIDA = '0d0d0d05-0000-4000-8000-000000000071'

const db = () => admin()
const sec = (clave, texto = `Texto de ${clave}.`, titulo = `Título ${clave}`) => ({ clave, titulo, texto })
const VALID = [sec('servicios'), sec('requisitos'), sec('responsabilidad')]
const publish = async (actor, p_secciones = VALID) => (await as(actor)).rpc('negocio_politica_publicar', { p_secciones })
const policiesOf = async (neg) =>
  (await db().from('negocio_politicas').select('version, vigente, secciones, publicada_por').eq('negocio_id', neg).order('version')).data
const pending = async (actor) => {
  const res = await (await as(actor)).rpc('aceptacion_pendiente')
  assert.equal(res.error, null, res.error?.message)
  return res.data
}
const register = async (actor, p_version) => (await as(actor)).rpc('aceptacion_registrar', { p_tipo: 'politica_negocio', p_version })
const refused = (res, message) => {
  assert.equal(res.error?.code, 'P0001', `expected a raised error, got ${res.error?.code ?? 'no error'} ${res.error?.message ?? ''}`)
  assert.match(res.error.message, message)
}
const invalid = (res) => {
  assert.equal(res.error?.code, '22023', `expected politica_invalida, got ${res.error?.code ?? 'no error'} ${res.error?.message ?? ''}`)
  assert.match(res.error.message, /politica_invalida/)
}
const book = () => ({ p_perro: d5, p_servicio: ids.servicios.banoA, p_grupo: null, p_fecha: day(5) })
const buy = { p_perro: d5, p_servicio: COMIDA, p_cantidad: 1 }
async function canBookAndBuy() {
  const c3 = await as('CLIENT3')
  const b = await c3.rpc('reservar', book())
  assert.equal(b.error, null, b.error?.message)
  const p = await c3.rpc('comprar_producto', buy)
  assert.equal(p.error, null, p.error?.message)
  await db().from('prestaciones').delete().eq('perro_id', d5)
}
async function cannotBookNorBuy(message) {
  const c3 = await as('CLIENT3')
  refused(await c3.rpc('reservar', book()), message)
  refused(await c3.rpc('comprar_producto', buy), message)
  assert.equal((await db().from('prestaciones').select('id', { count: 'exact', head: true }).eq('perro_id', d5)).count, 0, 'nothing booked')
}

// No policy and no policy acceptance in the fixture tenants: the other suites expect none.
const cleanup = async () => {
  await db().from('negocio_politicas').delete().in('negocio_id', [A, B, I])
  await db().from('aceptaciones').delete().eq('tipo', 'politica_negocio').in('negocio_id', [A, B, I])
  await db().from('prestaciones').delete().eq('perro_id', d5)
  await db().from('servicios').delete().eq('id', COMIDA)
}

before(async () => {
  await seed()
  await cleanup()
  assert.equal((await db().from('servicios').insert({ id: COMIDA, negocio_id: A, tipo: 'comida', nombre: 'politicas comida', modelo_cobro: 'por_uso', activo: true })).error, null)
  assert.equal((await db().from('tarifas').insert({ servicio_id: COMIDA, negocio_id: A, precio: 5000, precio_mensual: 0 })).error, null)
})
after(cleanup)

// ---- catalog ---------------------------------------------------------------------------------------------
test('catalog: RLS on, no direct writes, publish is definer with an empty search_path, the version helper is internal', () => {
  const [t] = sql(`select relrowsecurity as rls,
      has_table_privilege('authenticated', oid, 'select') as auth_select,
      has_table_privilege('authenticated', oid, 'insert') or has_table_privilege('authenticated', oid, 'update')
        or has_table_privilege('authenticated', oid, 'delete') as auth_write,
      has_table_privilege('anon', oid, 'select') as anon_select
    from pg_class where relnamespace = 'public'::regnamespace and relname = 'negocio_politicas'`)
  assert.deepEqual(t, { rls: true, auth_select: true, auth_write: false, anon_select: false })
  const fns = sql(`select p.proname, p.prosecdef, p.proconfig @> array['search_path=""'] as pinned,
      has_function_privilege('anon', p.oid, 'execute') as anon_exec,
      has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
    from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('negocio_politica_publicar', 'politica_negocio_vigente') order by 1`)
  assert.deepEqual(fns.map((f) => [f.proname, f.prosecdef, f.pinned, f.anon_exec, f.auth_exec]), [
    ['negocio_politica_publicar', true, true, false, true],
    ['politica_negocio_vigente', false, true, false, false],
  ])
})

// ---- no policy yet -----------------------------------------------------------------------------------------
test('a client of a business without a policy has nothing pending and books and buys with only the role notice', async () => {
  assert.equal(await pending('CLIENT3'), null)
  await canBookAndBuy()
})

test('a client of a business without a policy cannot accept one: version_invalida, nothing stored', async () => {
  for (const v of ['1', '', null]) refused(await register('CLIENT3', v), /version_invalida/)
  assert.equal((await db().from('aceptaciones').select('id', { count: 'exact', head: true }).eq('tipo', 'politica_negocio').eq('user_id', u.CLIENT3)).count, 0)
})

// ---- validation --------------------------------------------------------------------------------------------
const long = (n) => 'x'.repeat(n)
const ALL = ['servicios', 'recogida', 'cancelaciones', 'pagos', 'requisitos', 'responsabilidad', 'fotos', 'retracto', 'otras']
for (const [label, payload] of Object.entries({
  'null': null,
  'an object': { clave: 'requisitos', titulo: 'x', texto: 'x' },
  'an empty array': [],
  'an unknown clave': [...VALID, sec('garantia')],
  'a duplicated clave': [...VALID, sec('servicios')],
  'no requisitos': [sec('servicios'), sec('responsabilidad')],
  'no responsabilidad': [sec('servicios'), sec('requisitos')],
  'an empty requisitos': [sec('requisitos', '   '), sec('responsabilidad')],
  'an empty responsabilidad': [sec('requisitos'), sec('responsabilidad', '')],
  'an empty titulo': [sec('requisitos', 'x', ' '), sec('responsabilidad')],
  'an 81-char titulo': [sec('requisitos', 'x', long(81)), sec('responsabilidad')],
  'a 4001-char texto': [sec('requisitos', long(4001)), sec('responsabilidad')],
  'more than 30000 chars in total': ALL.map((c) => sec(c, long(3400))),
  'a non-object section': [...VALID, 'otras'],
  'a numeric texto': [sec('requisitos'), { clave: 'responsabilidad', titulo: 'x', texto: 5 }],
  'a section without titulo': [sec('requisitos'), { clave: 'responsabilidad', texto: 'x' }],
})) {
  test(`publish: ${label} raises politica_invalida and stores nothing`, async () => {
    invalid(await publish('OWNER', payload))
    assert.deepEqual(await policiesOf(A), [])
  })
}

test('publish: the limits themselves are accepted (80-char titulo, 4000-char texto, every clave once)', async () => {
  const res = await publish('WALKER_IND', ALL.map((c) => sec(c, long(3300), long(80))))
  assert.equal(res.error, null, res.error?.message)
  await db().from('negocio_politicas').delete().eq('negocio_id', I)
  assert.equal((await publish('WALKER_IND', [sec('requisitos', long(4000)), sec('responsabilidad')])).error, null)
  await db().from('negocio_politicas').delete().eq('negocio_id', I)
})

// ---- who publishes -------------------------------------------------------------------------------------------
for (const actor of ['OFFICE', 'OFFICE_FIN', 'WALKER_CO', 'WALKER_CO2', 'CLIENT', 'COOWNER', 'CLIENT_I', 'NOPROFILE', 'ANON']) {
  test(`publish: ${actor} cannot publish (42501) and nothing is stored`, async () => {
    denied(await publish(actor))
    for (const neg of [A, B, I]) assert.deepEqual(await policiesOf(neg), [], neg)
  })
}

test('nobody writes negocio_politicas directly, not even the owner', async () => {
  for (const actor of ['OWNER', 'CLIENT']) {
    const c = await as(actor)
    denied(await c.from('negocio_politicas').insert({ negocio_id: A, version: 1, secciones: VALID }))
    denied(await c.from('negocio_politicas').update({ vigente: false }).eq('negocio_id', A))
    denied(await c.from('negocio_politicas').delete().eq('negocio_id', A))
  }
  assert.deepEqual(await policiesOf(A), [])
})

// ---- v1 ----------------------------------------------------------------------------------------------------------
test('the owner publishes v1: one current row, by the owner, with the sections it sent', async () => {
  const res = await publish('OWNER', [sec('servicios', '  Paseos y guardería.  '), sec('requisitos'), sec('responsabilidad'), { ...sec('otras'), extra: 'x' }])
  assert.deepEqual({ error: res.error, data: res.data }, { error: null, data: 1 })
  const rows = await policiesOf(A)
  assert.deepEqual(rows.map((r) => [r.version, r.vigente, r.publicada_por]), [[1, true, u.OWNER]])
  assert.deepEqual(rows[0].secciones, [sec('servicios', 'Paseos y guardería.'), sec('requisitos'), sec('responsabilidad'), sec('otras')])
})

test('members read only their own business policy; other tenants and anon read nothing', async () => {
  for (const actor of ['CLIENT', 'CLIENT3', 'OFFICE', 'WALKER_CO', 'OWNER']) {
    const res = await (await as(actor)).from('negocio_politicas').select('negocio_id, version')
    assert.deepEqual({ error: res.error, data: res.data }, { error: null, data: [{ negocio_id: A, version: 1 }] }, actor)
  }
  for (const actor of ['OTHER', 'WALKER_IND', 'CLIENT_I', 'NOPROFILE']) {
    const res = await (await as(actor)).from('negocio_politicas').select('negocio_id')
    assert.deepEqual({ error: res.error, data: res.data }, { error: null, data: [] }, actor)
  }
  denied(await (await as('ANON')).from('negocio_politicas').select('negocio_id'))
})

test('after v1 every client of the business has politica_negocio pending with the business name; staff has nothing', async () => {
  for (const actor of ['CLIENT', 'CLIENT3', 'COOWNER']) {
    assert.deepEqual(await pending(actor), { tipo: 'politica_negocio', version: '1', negocio_id: A, negocio_nombre: 'Tenant A' }, actor)
  }
  for (const actor of ['OWNER', 'OFFICE', 'WALKER_CO', 'CLIENT_I', 'OTHER']) assert.equal(await pending(actor), null, actor)
})

test('the role notice still comes first: pending aviso_rol, and reservar refuses with aviso_rol_pendiente', async () => {
  assert.equal((await db().from('aceptaciones').delete().eq('user_id', u.CLIENT3).eq('tipo', 'aviso_rol')).error, null)
  try {
    assert.equal((await pending('CLIENT3'))?.tipo, 'aviso_rol')
    await cannotBookNorBuy(/aviso_rol_pendiente/)
  } finally {
    await db().from('aceptaciones').upsert({ user_id: u.CLIENT3, tipo: 'aviso_rol', negocio_id: A, version: AVISO_ROL_VERSION }, { onConflict: 'user_id,tipo,negocio_id,version', ignoreDuplicates: true })
  }
})

test('after v1, reservar and comprar_producto refuse the client with politica_negocio_pendiente', async () => {
  await cannotBookNorBuy(/politica_negocio_pendiente/)
  // Still after the authorization check: another client's dog is 42501, not the policy error.
  denied(await (await as('CLIENT3')).rpc('reservar', { ...book(), p_perro: ids.perros.d1 }))
})

for (const [actor] of [['OWNER'], ['OFFICE'], ['WALKER_CO']]) {
  test(`registrar: ${actor} cannot accept politica_negocio (42501)`, async () => {
    denied(await register(actor, '1'))
  })
}

for (const v of ['2', '0', '01', ' 1', '', null]) {
  test(`registrar: version ${JSON.stringify(v)} raises version_invalida while v1 is current`, async () => {
    refused(await register('CLIENT3', v), /version_invalida/)
    assert.equal((await pending('CLIENT3'))?.tipo, 'politica_negocio')
  })
}

test('the client accepts v1: nothing pending, it books and buys again', async () => {
  assert.equal((await register('CLIENT3', '1')).error, null)
  assert.equal(await pending('CLIENT3'), null)
  const rows = (await db().from('aceptaciones').select('negocio_id, version').eq('user_id', u.CLIENT3).eq('tipo', 'politica_negocio')).data
  assert.deepEqual(rows, [{ negocio_id: A, version: '1' }])
  await canBookAndBuy()
})

// ---- v2 ----------------------------------------------------------------------------------------------------------
test('the owner publishes v2: v1 is no longer current, only one row is', async () => {
  const res = await publish('OWNER', [sec('requisitos', 'Nuevos requisitos.'), sec('responsabilidad')])
  assert.deepEqual({ error: res.error, data: res.data }, { error: null, data: 2 })
  assert.deepEqual((await policiesOf(A)).map((r) => [r.version, r.vigente]), [[1, false], [2, true]])
  const res2 = await (await as('CLIENT')).from('negocio_politicas').select('version').eq('vigente', true)
  assert.deepEqual(res2.data, [{ version: 2 }])
})

test('after v2 the client must accept again: pending v2, refused bookings, the stale v1 is rejected', async () => {
  assert.deepEqual(await pending('CLIENT3'), { tipo: 'politica_negocio', version: '2', negocio_id: A, negocio_nombre: 'Tenant A' })
  await cannotBookNorBuy(/politica_negocio_pendiente/)
  refused(await register('CLIENT3', '1'), /version_invalida/)
  assert.equal((await register('CLIENT3', '2')).error, null)
  assert.equal(await pending('CLIENT3'), null)
  await canBookAndBuy()
})

// ---- another tenant ------------------------------------------------------------------------------------------------
test('an independent walker publishes its own v1: numbered per business, seen only by its members', async () => {
  const res = await publish('WALKER_IND')
  assert.deepEqual({ error: res.error, data: res.data }, { error: null, data: 1 })
  assert.deepEqual((await policiesOf(A)).map((r) => r.version), [1, 2], 'tenant A untouched')
  assert.deepEqual(await pending('CLIENT_I'), { tipo: 'politica_negocio', version: '1', negocio_id: I, negocio_nombre: 'Tenant I' })
  assert.equal(await pending('CLIENT3'), null, 'an acceptance of tenant A is not affected')
  const res2 = await (await as('CLIENT')).from('negocio_politicas').select('negocio_id').eq('negocio_id', I)
  assert.deepEqual(res2.data, [])
})
