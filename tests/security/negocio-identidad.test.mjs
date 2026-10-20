// Ley 1480 de 2011, art. 50 lit. a (who sells through electronic means states name or company name, ID,
// notification address, phone and email) and art. 53 (a contact portal keeps that record and lets the
// buyer consult it). Each business records its legal identity; only its owner writes it, through one RPC
// that validates it; every member of that business (staff and clients) can read it; nobody else can.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, ids, seed } from './_actors.mjs'

const A = ids.negocios.A
const OK = {
  p_razon_social: 'Paseos Kiara SAS', p_doc_tipo: 'NIT', p_doc_numero: '901234567-8',
  p_direccion: 'Calle 10 # 43-21, Medellín', p_telefono: '+57 604 444 5566', p_correo: 'legal@paseoskiara.co',
}
const row = async () => (await admin().from('negocio_identidad').select('*').eq('negocio_id', A).maybeSingle()).data

before(async () => { await seed(); await admin().from('negocio_identidad').delete().eq('negocio_id', A) }, { timeout: 120_000 })
after(async () => { await admin().from('negocio_identidad').delete().eq('negocio_id', A) })

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
    await admin().from('negocio_identidad').delete().eq('negocio_id', B)
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

test('NI-1c: every member of the business can read it; other tenants and guests cannot', async () => {
  for (const who of ['OWNER', 'OFFICE', 'WALKER_CO', 'CLIENT', 'COOWNER']) {
    const r = (await (await as(who)).from('negocio_identidad').select('razon_social').eq('negocio_id', A).maybeSingle()).data
    assert.equal(r?.razon_social, OK.p_razon_social, who)
  }
  for (const who of ['OTHER', 'CLIENT_I', 'WALKER_IND', 'ANON']) {
    const r = (await (await as(who)).from('negocio_identidad').select('razon_social').eq('negocio_id', A)).data
    assert.deepEqual(r ?? [], [], who)
  }
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

test('NI-1e: an independent walker can register a personal ID (cédula) instead of a NIT', async () => {
  const I = ids.negocios.I
  try {
    const res = await (await as('WALKER_IND')).rpc('negocio_identidad_guardar', { ...OK, p_razon_social: 'Walker Ind', p_doc_tipo: 'CC', p_doc_numero: '1020304050' })
    assert.equal(res.error, null)
    const r = (await (await as('CLIENT_I')).from('negocio_identidad').select('doc_tipo, doc_numero').eq('negocio_id', I).maybeSingle()).data
    assert.deepEqual(r, { doc_tipo: 'CC', doc_numero: '1020304050' })
  } finally {
    await admin().from('negocio_identidad').delete().eq('negocio_id', I)
  }
})
