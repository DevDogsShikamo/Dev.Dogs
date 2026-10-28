// S3 invitations, redeeming side (R4-4 to R4-9): single use, one uniform error, attempt
// limit, no tenant or role switching, email binding, revocation, no slug join.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, ids, seed } from './_actors.mjs'
import { create, denied, INVALID, mail, only, ownerCan, profileOf, withUser } from './_invites.mjs'
import { sql } from './_sql.mjs'
import { POLITICA_VERSION } from '../../src/lib/politica.js'

const { A, B } = ids.negocios
const clean = () => admin().from('invitaciones').delete().in('negocio_id', Object.values(ids.negocios))
before(async () => { await seed(); await clean() })
after(clean)

const redeem = (u, code) => u.client.rpc('redeem_invite', { p_codigo: code, p_politica: POLITICA_VERSION })
// A pending invitation for `email`; returns the code.
const invite = async (email, rol = 'cliente', actor = 'OWNER') => {
  const res = await create(actor, rol, email)
  assert.equal(res.error, null, res.error?.message)
  return res.data
}
const estado = async (email) => (await only(email)).estado
const revoke = async (email, actor = 'OWNER') => (await as(actor)).rpc('invitacion_revocar', { p_id: (await only(email)).id })

// ---- IV-4a / IV-8b allowed ---------------------------------------------------------------------
for (const rol of ['cliente', 'paseador', 'empresa']) {
  test(`IV-4a: a new user with the matching email joins tenant A as ${rol} through the code`, () =>
    withUser(async (u) => {
      const code = await invite(u.email.toUpperCase(), rol) // IV-8b: the case differs
      const res = await redeem(u, code)
      assert.equal(res.error, null, res.error?.message)
      assert.deepEqual(res.data, { ok: true, negocio_id: A, rol })
      const p = await profileOf(u.id)
      assert.deepEqual({ negocio_id: p.negocio_id, rol: p.rol }, { negocio_id: A, rol })
      const r = await only(u.email)
      assert.deepEqual({ estado: r.estado, usado_por: r.usado_por }, { estado: 'aceptada', usado_por: u.id })
      assert.ok(r.usado_at)
    }))
}

test('IV-4a: an independent walker client invitation joins tenant I; the code is accepted lower-case and without the dash', () =>
  withUser(async (u) => {
    const code = await invite(u.email, 'cliente', 'WALKER_IND')
    const res = await redeem(u, ` ${code.toLowerCase().replace('-', ' ')} `)
    assert.deepEqual(res.data, { ok: true, negocio_id: ids.negocios.I, rol: 'cliente' })
  }))

// ---- IV-4b / IV-5a / IV-8a / IV-9a: one uniform error (N4) ---------------------------------------
const failures = {
  unknown: async () => '0123-4567-89AB-CD',
  'expired (IV-5a)': async (u) => {
    const code = await invite(u.email)
    assert.equal((await admin().from('invitaciones').update({ expires_at: new Date(Date.now() - 36e5).toISOString() }).eq('email', u.email)).error, null)
    return code
  },
  'already used (IV-4b)': () =>
    withUser(async (first) => {
      const code = await invite(first.email)
      assert.equal((await redeem(first, code)).data.ok, true)
      return code
    }),
  'revoked (IV-9a)': async (u) => {
    const code = await invite(u.email)
    assert.equal((await revoke(u.email)).error, null)
    return code
  },
  'for another email (IV-8a)': async () => invite(mail()),
}
for (const [name, setup] of Object.entries(failures)) {
  test(`N4: a ${name} code gets the uniform error and creates no profile`, () =>
    withUser(async (u) => {
      const code = await setup(u)
      await ownerCan() // precondition: issuing works
      const res = await redeem(u, code)
      assert.equal(res.error, null, res.error?.message)
      assert.deepEqual(res.data, INVALID)
      assert.equal(await profileOf(u.id), null)
    }))
}

test('IV-8a: a wrong-email attempt leaves the code unused and redeemable by the invited email', () =>
  withUser((wrong) =>
    withUser(async (right) => {
      const code = await invite(right.email)
      assert.deepEqual((await redeem(wrong, code)).data, INVALID)
      assert.equal(await estado(right.email), 'pendiente')
      assert.equal(await profileOf(wrong.id), null)
      assert.equal((await redeem(right, code)).data.ok, true)
    })))

test('IV-8c: an unconfirmed email cannot redeem a matching code', () =>
  withUser(async (u) => {
    const code = await invite(u.email)
    sql(`update auth.users set email_confirmed_at = null where id = '${u.id}'`)
    assert.deepEqual((await redeem(u, code)).data, INVALID)
    assert.equal(await profileOf(u.id), null)
    assert.equal(await estado(u.email), 'pendiente')
    sql(`update auth.users set email_confirmed_at = now() where id = '${u.id}'`)
    assert.equal((await redeem(u, code)).data.ok, true)
  }))

// ---- IV-5b attempt limit, IV-5c anon --------------------------------------------------------------
test('IV-5b: the 6th attempt in 15 minutes is blocked, even with a valid code, until the window ends', () =>
  withUser(async (u) => {
    const code = await invite(u.email)
    for (let i = 1; i <= 5; i++) assert.deepEqual((await redeem(u, `0000-0000-0000-0${i}`)).data, INVALID, `attempt ${i}`)
    assert.equal((await admin().from('invitacion_intentos').select('id', { count: 'exact', head: true }).eq('user_id', u.id)).count, 5)
    for (const attempt of ['0000-0000-0000-06', code]) {
      assert.deepEqual((await redeem(u, attempt)).data, { ok: false, error: 'demasiados_intentos' })
    }
    assert.equal(await profileOf(u.id), null)
    assert.equal(await estado(u.email), 'pendiente')
    // The window ends: the attempts age out and the valid code works.
    await admin().from('invitacion_intentos').update({ created_at: new Date(Date.now() - 16 * 6e4).toISOString() }).eq('user_id', u.id)
    assert.equal((await redeem(u, code)).data.ok, true)
  }))

test('IV-5c: ANON cannot redeem', async () => {
  const { code, email } = await ownerCan()
  denied(await (await as('ANON')).rpc('redeem_invite', { p_codigo: code, p_politica: POLITICA_VERSION }))
  assert.equal(await estado(email), 'pendiente')
})

test('the attempt log is neither readable nor writable by users', () =>
  withUser(async (u) => {
    await redeem(u, '0000-0000-0000-00')
    assert.equal((await admin().from('invitacion_intentos').select('id', { count: 'exact', head: true }).eq('user_id', u.id)).count, 1)
    denied(await u.client.from('invitacion_intentos').select('id'))
    denied(await u.client.from('invitacion_intentos').delete().eq('user_id', u.id))
  }))

// ---- IV-6 no tenant or role switching -------------------------------------------------------------
test('IV-6a: a CLIENT of tenant A cannot redeem a tenant B code; the code stays redeemable by its invitee', () =>
  withUser(async (invitee) => {
    const clientMail = (await (await as('CLIENT')).auth.getUser()).data.user.email
    const code = await invite(clientMail, 'cliente', 'OTHER') // bound to the CLIENT's own email
    const before = await profileOf(ids.users.CLIENT)
    const res = await (await as('CLIENT')).rpc('redeem_invite', { p_codigo: code, p_politica: POLITICA_VERSION })
    assert.deepEqual(res.data, { ok: false, error: 'perfil_existente' })
    assert.deepEqual(await profileOf(ids.users.CLIENT), before)
    assert.equal(await estado(clientMail), 'pendiente')
    await admin().from('invitaciones').update({ email: invitee.email }).eq('email', clientMail) // re-bind to a real invitee
    assert.deepEqual((await redeem(invitee, code)).data, { ok: true, negocio_id: B, rol: 'cliente' })
  }))

test('IV-6b: an employed walker cannot redeem an empresa code of its own tenant; rol unchanged', async () => {
  const email = (await (await as('WALKER_CO')).auth.getUser()).data.user.email
  const code = await invite(email, 'empresa')
  const before = await profileOf(ids.users.WALKER_CO)
  const res = await (await as('WALKER_CO')).rpc('redeem_invite', { p_codigo: code, p_politica: POLITICA_VERSION })
  assert.deepEqual(res.data, { ok: false, error: 'perfil_existente' })
  assert.deepEqual(await profileOf(ids.users.WALKER_CO), before)
  assert.equal(await estado(email), 'pendiente')
})

// ---- IV-7a no slug / negocio_id join -------------------------------------------------------------
test('IV-7a: a user without a profile cannot create a client profile by negocio_id or slug', () =>
  withUser(async (u) => {
    await ownerCan()
    denied(await u.client.from('profiles').insert({ id: u.id, negocio_id: A, rol: 'cliente' }))
    const bySlug = await u.client.from('negocios').select('id').eq('slug', 'dd-test-a')
    assert.equal(bySlug.error, null)
    assert.deepEqual(bySlug.data, [])
    assert.equal(await profileOf(u.id), null)
  }))

// ---- IV-9 revocation ------------------------------------------------------------------------------
test('IV-9a/9b: revoking kills the code; a new invitation for the same email works', () =>
  withUser(async (u) => {
    const old = await invite(u.email)
    assert.equal((await revoke(u.email)).error, null)
    assert.equal(await estado(u.email), 'revocada')
    assert.deepEqual((await redeem(u, old)).data, INVALID)
    const fresh = await invite(u.email)
    assert.notEqual(fresh, old)
    assert.equal((await redeem(u, fresh)).data.ok, true)
  }))

test('IV-9: the independent walker revokes its own invitation; a replay is a no-op', async () => {
  const email = mail()
  await invite(email, 'cliente', 'WALKER_IND')
  assert.equal((await revoke(email, 'WALKER_IND')).error, null)
  assert.equal((await revoke(email, 'WALKER_IND')).error, null)
  assert.equal(await estado(email), 'revocada')
})

for (const actor of ['CLIENT', 'WALKER_CO', 'OFFICE', 'OTHER', 'NOPROFILE', 'ANON']) {
  test(`IV-9c: ${actor} cannot revoke an invitation of tenant A`, async () => {
    const { email } = await ownerCan()
    denied(await revoke(email, actor))
    assert.equal(await estado(email), 'pendiente')
  })
}

test('IV-9c: revoking an unknown id is denied like a foreign one', async () => {
  await ownerCan()
  denied(await (await as('OWNER')).rpc('invitacion_revocar', { p_id: '00000000-0000-4000-8000-000000000000' }))
})

test('a used invitation stays used when the owner revokes it', () =>
  withUser(async (u) => {
    assert.equal((await redeem(u, await invite(u.email))).data.ok, true)
    const used = await only(u.email)
    assert.equal((await revoke(u.email)).error, null)
    assert.deepEqual(await only(u.email), used)
  }))
