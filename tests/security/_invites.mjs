// Shared helpers for the invitation suites (S3). Import-safe.
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { admin, as, tempUser } from './_actors.mjs'

// Crockford base32 (no I, L, O, U); the code is shown as XXXXXXX-XXXXXXX.
export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const CODE = /^[0-9A-HJKMNP-TV-Z]{7}-[0-9A-HJKMNP-TV-Z]{7}$/
export const INVALID = { ok: false, error: 'invalid' }

export const mail = () => `iv-${randomUUID().slice(0, 8)}@example.com`
export const hashOf = (code) => `\\x${createHash('sha256').update(code.replace('-', '')).digest('hex')}`
export const denied = (res) => assert.equal(res.error?.code, '42501', `expected permission denied, got ${res.error?.code ?? 'no error'}`)

// Creates an invitation as `actor`; returns the raw RPC response.
export const create = async (actor, rol, email) => (await as(actor)).rpc('invitacion_crear', { p_rol: rol, p_email: email })

// The valid-call precondition of every refusal test: the owner can create, so a
// refusal cannot pass just because the function is missing.
export async function ownerCan(rol = 'cliente') {
  const email = mail()
  const res = await create('OWNER', rol, email)
  assert.equal(res.error, null, `owner could not create an invitation: ${res.error?.message}`)
  return { code: res.data, email }
}

export const byEmail = async (email) => (await admin().from('invitaciones').select('*').eq('email', email.toLowerCase())).data
export const only = async (email) => {
  const rows = await byEmail(email)
  assert.equal(rows.length, 1, `expected one invitation for ${email}, found ${rows.length}`)
  return rows[0]
}
export const total = async (negocios) =>
  (await admin().from('invitaciones').select('id', { count: 'exact', head: true }).in('negocio_id', negocios)).count

// A throwaway confirmed user without a profile; always dropped.
export async function withUser(fn) {
  const u = await tempUser()
  try {
    return await fn(u)
  } finally {
    await u.drop()
  }
}
export const profileOf = async (id) => (await admin().from('profiles').select('*').eq('id', id).maybeSingle()).data
