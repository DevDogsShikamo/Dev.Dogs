// S3 invitations, issuing side (R4-1, R4-2, R4-3): who may create one, what is
// stored, what can be read back. Every refusal runs after a valid owner call.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, ids, seed } from './_actors.mjs'
import { CODE, CROCKFORD, create, denied, hashOf, mail, only, ownerCan, total } from './_invites.mjs'

const { A, B, I } = ids.negocios
const all = [A, B, I]
const clean = () => admin().from('invitaciones').delete().in('negocio_id', all)
before(async () => { await seed(); await clean() })
after(clean)

// ---- IV-1c / IV-1d allowed -----------------------------------------------------------------
for (const [actor, negocio, rol] of [
  ['OWNER', A, 'cliente'], ['OWNER', A, 'paseador'], ['OWNER', A, 'empresa'], ['WALKER_IND', I, 'cliente'], ['OTHER', B, 'cliente'],
]) {
  test(`IV-1c/1d: ${actor} creates a ${rol} invitation in its own tenant and gets the code once`, async () => {
    const email = mail().toUpperCase()
    const res = await create(actor, rol, `  ${email}  `)
    assert.equal(res.error, null, res.error?.message)
    assert.match(res.data, CODE)
    const r = await only(email)
    assert.deepEqual(
      { negocio_id: r.negocio_id, rol: r.rol, email: r.email, estado: r.estado, invitado_por: r.invitado_por, usado_por: r.usado_por },
      { negocio_id: negocio, rol, email: email.toLowerCase(), estado: 'pendiente', invitado_por: ids.users[actor], usado_por: null },
    )
  })
}

// ---- IV-1a / IV-1e / P4: who may not ---------------------------------------------------------
for (const actor of ['CLIENT', 'COOWNER', 'WALKER_CO', 'OFFICE', 'NOPROFILE', 'ANON']) {
  test(`IV-1a/1e: ${actor} cannot create an invitation`, async () => {
    await ownerCan()
    const email = mail()
    const before = await total(all)
    denied(await create(actor, 'cliente', email))
    assert.equal(await total(all), before)
  })
}

for (const rol of ['paseador', 'empresa']) {
  test(`P4: the independent walker may invite clients only, not a ${rol}`, async () => {
    assert.equal((await create('WALKER_IND', 'cliente', mail())).error, null)
    const before = await total([I])
    denied(await create('WALKER_IND', rol, mail()))
    assert.equal(await total([I]), before)
  })
}

// ---- IV-1b / IV-1f: input -----------------------------------------------------------------
test('IV-1b: a client-supplied code is rejected (no parameter for it) and nothing is created', async () => {
  await ownerCan()
  const email = mail()
  const res = await (await as('OWNER')).rpc('invitacion_crear', { p_rol: 'cliente', p_email: email, p_codigo: 'MYOWNCODE' })
  assert.equal(res.error?.code, 'PGRST202')
  assert.deepEqual(await admin().from('invitaciones').select('id').eq('email', email).then((r) => r.data), [])
})

test('IV-1b: the owner cannot write a row (and so a code hash) directly', async () => {
  await ownerCan()
  const before = await total([A])
  const res = await (await as('OWNER')).from('invitaciones').insert({
    negocio_id: A, rol: 'cliente', email: mail(), codigo_hash: hashOf('0123456789ABCD'),
  })
  denied(res)
  assert.equal(await total([A]), before)
})

const badEmails = [null, '', '   ', 'no-at-sign', 'a@b', 'two@@x.co', 'sp ace@x.co', `${'x'.repeat(250)}@b.co`]
for (const bad of badEmails) {
  test(`IV-1f: an invitation with email ${JSON.stringify(bad)?.slice(0, 20)} is rejected`, async () => {
    await ownerCan()
    const before = await total([A])
    const res = await create('OWNER', 'cliente', bad)
    assert.equal(res.error?.code, 'P0001', `got ${res.error?.code ?? 'no error'}`)
    assert.match(res.error.message, /email_invalido/)
    assert.equal(await total([A]), before)
  })
}

test('IV-1f: a call without the email argument is rejected', async () => {
  await ownerCan()
  const before = await total([A])
  const res = await (await as('OWNER')).rpc('invitacion_crear', { p_rol: 'cliente' })
  assert.equal(res.error?.code, 'PGRST202')
  assert.equal(await total([A]), before)
})

for (const rol of ['admin', 'dueno', '', null]) {
  test(`an unknown role ${JSON.stringify(rol)} is rejected`, async () => {
    await ownerCan()
    const res = await create('OWNER', rol, mail())
    assert.equal(res.error?.code, 'P0001', `got ${res.error?.code ?? 'no error'}`)
    assert.match(res.error.message, /rol_invalido/)
  })
}

// ---- IV-2: strength, storage, nothing readable ------------------------------------------------------
test('IV-2c: codes are 14 Crockford symbols from a random source (20 codes, all distinct, whole alphabet-range used)', async () => {
  const codes = []
  for (let i = 0; i < 20; i++) codes.push((await create('OWNER', 'cliente', mail())).data)
  const symbols = codes.map((c) => c.replace('-', ''))
  for (const s of symbols) {
    assert.equal(s.length, 14)
    assert.ok([...s].every((ch) => CROCKFORD.includes(ch)), s)
  }
  assert.equal(new Set(codes).size, 20)
  assert.ok(new Set(symbols.join('')).size >= 16, 'the 280 symbols show almost no variety')
})

test('IV-2a: only a SHA-256 hash of the normalised code is stored; no column holds the code', async () => {
  const { code, email } = await ownerCan()
  const r = await only(email)
  assert.equal(r.codigo_hash, hashOf(code))
  assert.ok(!('codigo' in r), 'the plaintext codigo column still exists')
  assert.ok(!JSON.stringify(r).includes(code.replace('-', '')))
})

test('IV-2a: the owner lists invitations without any column that recovers a code', async () => {
  const { code, email } = await ownerCan()
  const listed = await (await as('OWNER')).from('invitaciones')
    .select('id,negocio_id,rol,email,estado,invitado_por,created_at,expires_at,usado_por,usado_at').eq('email', email)
  assert.equal(listed.error, null, listed.error?.message)
  assert.equal(listed.data.length, 1)
  assert.ok(!JSON.stringify(listed.data).includes(code.replace('-', '')))
  denied(await (await as('OWNER')).from('invitaciones').select('codigo_hash').eq('email', email))
  denied(await (await as('OWNER')).from('invitaciones').select('*').eq('email', email))
  assert.equal((await (await as('OWNER')).from('invitaciones').select('codigo').eq('email', email)).error?.code, '42703')
})

for (const actor of ['OTHER', 'CLIENT', 'WALKER_CO', 'OFFICE', 'WALKER_IND']) {
  test(`IV-2a: ${actor} reads zero invitations of tenant A`, async () => {
    const { email } = await ownerCan()
    assert.equal((await (await as('OWNER')).from('invitaciones').select('id').eq('email', email)).data.length, 1)
    const res = await (await as(actor)).from('invitaciones').select('id').eq('negocio_id', A)
    assert.equal(res.error, null, res.error?.message)
    assert.deepEqual(res.data, [])
  })
}

// ---- IV-3: expiry -----------------------------------------------------------------------------------
test('IV-3a: a new invitation expires in about 7 days', async () => {
  const { email } = await ownerCan()
  const r = await only(email)
  const days = (new Date(r.expires_at) - new Date(r.created_at)) / 864e5
  assert.ok(days > 6.99 && days < 7.01, `expires in ${days} days`)
})

test('IV-3b: the database rejects an expiry beyond 30 days and accepts exactly 30', async () => {
  const created = new Date('2026-01-01T00:00:00Z')
  const at = (days, extra = 0) => new Date(created.getTime() + days * 864e5 + extra).toISOString()
  const row = (expires_at) => ({
    negocio_id: A, rol: 'cliente', email: mail(), codigo_hash: hashOf(mail()), created_at: created.toISOString(), expires_at,
  })
  assert.equal((await admin().from('invitaciones').insert(row(at(30)))).error, null)
  const over = await admin().from('invitaciones').insert(row(at(30, 1000)))
  assert.equal(over.error?.code, '23514', over.error?.message)
  const { email } = await ownerCan()
  const stretch = await admin().from('invitaciones').update({ expires_at: new Date(Date.now() + 31 * 864e5).toISOString() }).eq('email', email)
  assert.equal(stretch.error?.code, '23514', stretch.error?.message)
})

test('IV-3b: the owner cannot write expiry (or anything) directly', async () => {
  const { email } = await ownerCan()
  const r = await only(email)
  denied(await (await as('OWNER')).from('invitaciones').update({ expires_at: new Date(Date.now() + 5 * 864e5).toISOString() }).eq('id', r.id))
  denied(await (await as('OWNER')).from('invitaciones').delete().eq('id', r.id))
  assert.deepEqual(await only(email), r)
})

test('the email column is required', async () => {
  const res = await admin().from('invitaciones').insert({ negocio_id: A, rol: 'cliente', codigo_hash: hashOf(mail()) })
  assert.equal(res.error?.code, '23502', res.error?.message)
})
