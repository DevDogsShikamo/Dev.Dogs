// Ley 1480 de 2011, art. 50 lit. a (who sells through electronic means states name or company name, ID,
// notification address, phone and email) and art. 53 (a contact portal keeps that record and lets the
// buyer consult it). Each business records its legal identity; only its owner writes it, through one RPC
// that validates it. The table is read by the owner and the office staff of that business; every member
// (walkers and clients too) reads it through negocio_identidad_publica(), with a personal ID (CC/CE/PAS)
// masked to its last 4 digits (Ley 1581 art. 4, necessity). Nobody else reads it. A business without it
// cannot receive bookings or sales (art. 53, "deberá exigir"): reservar / comprar_producto refuse.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { IDENTIDADES, admin, as, day, ids, identidades, seed } from './_actors.mjs'
import { sql } from './_sql.mjs'

const A = ids.negocios.A
const OK = {
  p_razon_social: 'Paseos Kiara SAS', p_doc_tipo: 'NIT', p_doc_numero: '901234567-8',
  p_direccion: 'Calle 10 # 43-21, Medellín', p_telefono: '+57 604 444 5566', p_correo: 'legal@paseoskiara.co',
}
const row = async () => (await admin().from('negocio_identidad').select('*').eq('negocio_id', A).maybeSingle()).data
const publica = async (who) => {
  const res = await (await as(who)).rpc('negocio_identidad_publica')
  assert.equal(res.error, null, `${who}: ${res.error?.message}`)
  return res.data
}

before(async () => { await seed(); await admin().from('negocio_identidad').delete().eq('negocio_id', A) }, { timeout: 120_000 })
// Back to the fixture identities, so the rest of the suite can book and buy.
after(identidades)

test('NI-1a: the business owner records the legal identity of the business', async () => {
  const res = await (await as('OWNER')).rpc('negocio_identidad_guardar', OK)
  assert.equal(res.error, null)
  const r = await row()
  assert.deepEqual(
    { razon_social: r.razon_social, doc_tipo: r.doc_tipo, doc_numero: r.doc_numero, direccion: r.direccion, telefono: r.telefono, correo: r.correo },
    { razon_social: OK.p_razon_social, doc_tipo: 'NIT', doc_numero: OK.p_doc_numero, direccion: OK.p_direccion, telefono: OK.p_telefono, correo: OK.p_correo },
  )
})

test('NI-1b: office staff, walkers, clients and other businesses cannot write it, by RPC or directly', async () => {
  for (const who of ['OFFICE', 'OFFICE_FIN', 'WALKER_CO', 'CLIENT']) {
    const c = await as(who)
    const res = await c.rpc('negocio_identidad_guardar', { ...OK, p_razon_social: `Hack ${who}` })
    assert.equal(res.error?.code, '42501', who)
  }
  // Owners of other businesses only ever write their own row (the RPC takes no business id).
  const B = ids.negocios.B
  try {
    assert.equal((await (await as('OTHER')).rpc('negocio_identidad_guardar', { ...OK, p_razon_social: 'Other B' })).error, null)
    assert.equal((await admin().from('negocio_identidad').select('razon_social').eq('negocio_id', B).single()).data.razon_social, 'Other B')
  } finally {
    await admin().from('negocio_identidad').upsert({ negocio_id: B, ...IDENTIDADES.B })
  }
  for (const who of ['OWNER', 'OFFICE', 'WALKER_CO', 'CLIENT', 'OTHER', 'WALKER_IND']) {
    const c = await as(who)
    await c.from('negocio_identidad').update({ razon_social: `Hack ${who}` }).eq('negocio_id', A)
    await c.from('negocio_identidad').insert({ negocio_id: A, razon_social: `Hack ${who}` })
  }
  assert.equal((await row()).razon_social, OK.p_razon_social, 'no direct table write lands, not even the owner\'s')
  const anon = await (await as('ANON')).rpc('negocio_identidad_guardar', OK)
  assert.ok(anon.error, 'anon cannot call it')
})

test('NI-1c: the owner and the office staff read the table; walkers, clients, other tenants and guests do not', async () => {
  for (const who of ['OWNER', 'OFFICE', 'OFFICE_FIN']) {
    const r = (await (await as(who)).from('negocio_identidad').select('razon_social').eq('negocio_id', A).maybeSingle()).data
    assert.equal(r?.razon_social, OK.p_razon_social, who)
  }
  for (const who of ['WALKER_CO', 'CLIENT', 'COOWNER', 'OTHER', 'CLIENT_I', 'WALKER_IND', 'ANON']) {
    const r = (await (await as(who)).from('negocio_identidad').select('razon_social').eq('negocio_id', A)).data
    assert.deepEqual(r ?? [], [], who)
  }
})

test('NI-1c2: negocio_identidad_publica gives every member its own business identity (a NIT in full); anon cannot call it', async () => {
  const want = [{ razon_social: OK.p_razon_social, doc_tipo: 'NIT', doc_numero: OK.p_doc_numero, direccion: OK.p_direccion, telefono: OK.p_telefono, correo: OK.p_correo }]
  for (const who of ['OWNER', 'OFFICE', 'WALKER_CO', 'CLIENT', 'COOWNER']) assert.deepEqual(await publica(who), want, who)
  // Other tenants only ever get their own business (the RPC takes no business id).
  assert.deepEqual((await publica('OTHER')).map((r) => r.razon_social), ['Tenant B SAS'])
  assert.ok((await (await as('ANON')).rpc('negocio_identidad_publica')).error, 'anon cannot call it')
  const [f] = sql(`select p.prosecdef as definer, p.proconfig @> array['search_path=""'] as pinned,
      has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'negocio_identidad_publica'`)
  assert.deepEqual(f, { definer: true, pinned: true, anon: false, auth: true })
})

test('NI-1d: invalid data is rejected and the stored identity stays', async () => {
  const owner = await as('OWNER')
  const bad = {
    'unknown document type': { p_doc_tipo: 'RUT' },
    'document with letters': { p_doc_numero: 'ABC123' },
    'document too short': { p_doc_numero: '12' },
    'name too short': { p_razon_social: 'A' },
    'address too short': { p_direccion: 'x' },
    'email without @': { p_correo: 'legal.paseoskiara.co' },
    'phone with letters': { p_telefono: 'llamar' },
  }
  for (const [label, over] of Object.entries(bad)) {
    const res = await owner.rpc('negocio_identidad_guardar', { ...OK, ...over })
    assert.match(res.error?.message ?? '', /datos_invalidos/, label)
  }
  assert.equal((await row()).doc_numero, OK.p_doc_numero)
})

test('NI-1e: an independent walker registers a personal ID (cédula); its clients see only the last 4 digits', async () => {
  const I = ids.negocios.I
  const walker = await as('WALKER_IND')
  try {
    const res = await walker.rpc('negocio_identidad_guardar', { ...OK, p_razon_social: 'Walker Ind', p_doc_tipo: 'CC', p_doc_numero: '1020304050' })
    assert.equal(res.error, null)
    const own = (await walker.from('negocio_identidad').select('doc_tipo, doc_numero').eq('negocio_id', I).maybeSingle()).data
    assert.deepEqual(own, { doc_tipo: 'CC', doc_numero: '1020304050' }, 'the owner reads it in full')
    assert.deepEqual((await (await as('CLIENT_I')).from('negocio_identidad').select('doc_numero').eq('negocio_id', I)).data, [], 'no table read for the client')
    const pub = await publica('CLIENT_I')
    assert.deepEqual(pub.map((r) => [r.razon_social, r.doc_tipo, r.doc_numero]), [['Walker Ind', 'CC', '••••••4050']])
    assert.doesNotMatch(JSON.stringify(pub), /102030/)
    for (const [tipo, numero, shown] of [['CE', '98.765-4321', '••••••4321'], ['PAS', '12345', '••••••2345'], ['NIT', '901234567-8', '901234567-8']]) {
      assert.equal((await walker.rpc('negocio_identidad_guardar', { ...OK, p_doc_tipo: tipo, p_doc_numero: numero })).error, null, tipo)
      assert.equal((await publica('CLIENT_I'))[0].doc_numero, shown, tipo)
    }
  } finally {
    await identidades()
  }
})

// ---- Ley 1480 art. 53: no identity, no bookings or sales ------------------------------------------------
test('NI-2: without the identity of its business a client cannot book or buy; with it, it can', async () => {
  const client = await as('CLIENT')
  const book = { p_perro: ids.perros.d1, p_servicio: ids.servicios.banoA, p_grupo: null, p_fecha: day(5) }
  // Any product id: the identity is checked before the catalogue.
  const buy = { p_perro: ids.perros.d1, p_servicio: ids.servicios.banoA, p_cantidad: 1 }
  const created = []
  try {
    assert.equal((await admin().from('negocio_identidad').delete().eq('negocio_id', A)).error, null)
    for (const [rpc, args] of [['reservar', book], ['comprar_producto', buy]]) {
      const res = await client.rpc(rpc, args)
      assert.match(res.error?.message ?? 'no error', /negocio_sin_identidad/, rpc)
    }
    assert.deepEqual((await admin().from('prestaciones').select('id').eq('perro_id', ids.perros.d1).eq('fecha', day(5))).data, [], 'nothing stored')
    assert.equal((await identidades()).error, null)
    const ok = await client.rpc('reservar', book)
    assert.equal(ok.error, null, ok.error?.message)
    created.push(ok.data)
    assert.match((await client.rpc('comprar_producto', buy)).error?.message ?? 'no error', /servicio_invalido/, 'past the identity check')
  } finally {
    await identidades()
    if (created.length) await admin().from('prestaciones').delete().in('id', created)
  }
})
