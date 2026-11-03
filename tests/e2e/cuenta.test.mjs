// Account security in a real browser against STAGING (muten dev): forgot password (one neutral answer, no
// account enumeration), the recovery link -> /nueva-clave -> the normal guard chain, an expired link, the
// password and email changes in /mis-datos, and the live policy re-check of an open session.
// Staging cannot send real mail (tiny SMTP quota), so links come from the service-role generateLink and
// the two Auth calls that would send mail are stood in for, the way autoconfirmSignup does for signup.
// Every test uses a throwaway user: the seeded fixtures never change password or email.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { admin, seed, tempUser } from '../security/_actors.mjs'
import { loadConfig } from '../security/_env.mjs'
import { startApp } from './_app.mjs'
import { POLITICA_VERSION, TERMINOS_NEGOCIO_VERSION } from '../../src/lib/politica.js'

const NEUTRAL = 'Si existe una cuenta con ese correo, te enviamos un enlace para crear una nueva contraseña.'
const NEW_PW = `Nueva${randomUUID().slice(0, 6)}9`
let app

before(async () => {
  await seed()
  app = await startApp()
}, { timeout: 120_000 })
after(async () => { await app?.stop() })

// An independent walker with every document accepted: logging in lands on /app.
async function walker() {
  const u = await tempUser()
  const res = await u.client.rpc('provision_negocio', { p_rol: 'paseador', p_nombre: 'Ana Cuenta', p_negocio: 'Cuenta E2E', p_politica: POLITICA_VERSION })
  assert.equal(res.error, null, res.error?.message)
  assert.equal((await admin().from('aceptaciones').insert({ user_id: u.id, tipo: 'terminos_negocio', negocio_id: res.data, version: TERMINOS_NEGOCIO_VERSION })).error, null)
  return u
}

async function login({ email, password }) {
  const page = await app.newPage()
  await page.goto(`${app.url}/login`)
  await page.getByPlaceholder('tu@correo.com').fill(email)
  await page.getByPlaceholder('••••••••').fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.waitForURL('**/app', { timeout: 60_000 })
  return page
}
const path = (page) => new URL(page.url()).pathname
const canSignIn = async (email, password) => {
  const cfg = loadConfig()
  const res = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: cfg.publishableKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  return res.ok
}

// Follows a generated action link the way the mail client would and returns the hash Supabase redirects
// with (#access_token=…&type=recovery, or #error=…&error_code=otp_expired once the link is used).
async function follow(link) {
  const res = await fetch(link, { redirect: 'manual' })
  return new URL(res.headers.get('location')).hash
}

// Stands in for POST /auth/v1/recover (it would mail the link); records what the app sent.
async function standInRecover(page, status = 200) {
  const sent = []
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' }
  await page.route('**/auth/v1/recover*', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    sent.push({ url: route.request().url(), body: route.request().postDataJSON() })
    return status === 200 ? route.fulfill({ status, headers: cors, json: {} })
      : route.fulfill({ status, headers: cors, json: { code: status, error_code: 'over_email_send_rate_limit', msg: 'email rate limit exceeded' } })
  })
  return sent
}

async function askReset(page, email) {
  await page.getByRole('button', { name: '¿Olvidaste tu contraseña?' }).click()
  await page.getByPlaceholder('tu@correo.com').fill(email)
  await page.getByRole('button', { name: 'Enviar enlace' }).click()
}

test('forgot password: an existing and an unknown email get the same neutral answer; a rate limit is explained kindly', async () => {
  const u = await walker()
  try {
    const page = await app.newPage()
    await page.goto(`${app.url}/login`)
    const sent = await standInRecover(page)
    await askReset(page, u.email)
    await page.getByText(NEUTRAL).waitFor({ timeout: 30_000 })
    assert.equal(sent.length, 1)
    assert.equal(sent[0].body.email, u.email)
    assert.equal(new URL(sent[0].url).searchParams.get('redirect_to'), `${app.url}/nueva-clave`)
    await page.close()

    // The unknown address goes to the real endpoint: Supabase answers 200 without sending anything.
    const other = await app.newPage()
    await other.goto(`${app.url}/login`)
    await askReset(other, `dd-nadie-${randomUUID().slice(0, 8)}@example.com`)
    await other.getByText(NEUTRAL).waitFor({ timeout: 30_000 })
    await other.close()

    const limited = await app.newPage()
    await limited.goto(`${app.url}/login`)
    await standInRecover(limited, 429)
    await askReset(limited, u.email)
    await limited.getByText('Hiciste demasiadas solicitudes. Espera unos minutos e intenta de nuevo.').waitFor({ timeout: 30_000 })
    assert.equal(await limited.getByText(NEUTRAL).count(), 0)
    await limited.close()
  } finally {
    await u.drop()
  }
})

test('recovery link: /nueva-clave sets the new password and enters the portal; the old password fails; the used link is refused', async () => {
  const u = await walker()
  try {
    const { data, error } = await admin().auth.admin.generateLink({ type: 'recovery', email: u.email, options: { redirectTo: `${app.url}/nueva-clave` } })
    assert.equal(error, null, error?.message)
    const hash = await follow(data.properties.action_link)
    assert.match(hash, /type=recovery/)

    const page = await app.newPage()
    await page.goto(`${app.url}/nueva-clave${hash}`)
    await page.getByPlaceholder('Nueva contraseña', { exact: true }).fill('corta')
    await page.getByPlaceholder('Repite la nueva contraseña').fill('corta')
    assert.equal(await page.getByRole('button', { name: 'Guardar contraseña' }).isDisabled(), true, 'a weak password is not sent')
    await page.getByPlaceholder('Nueva contraseña', { exact: true }).fill(NEW_PW)
    await page.getByPlaceholder('Repite la nueva contraseña').fill(`${NEW_PW}x`)
    assert.equal(await page.getByRole('button', { name: 'Guardar contraseña' }).isDisabled(), true, 'the confirmation must match')
    await page.getByPlaceholder('Repite la nueva contraseña').fill(NEW_PW)
    await page.getByRole('button', { name: 'Guardar contraseña' }).click()
    await page.waitForURL('**/app', { timeout: 60_000 })
    await page.close()

    assert.equal(await canSignIn(u.email, NEW_PW), true, 'the new password works')
    assert.equal(await canSignIn(u.email, u.password), false, 'the old password fails')

    // The same link again: Supabase redirects with otp_expired and the page offers a new one.
    const again = await app.newPage()
    await again.goto(`${app.url}/nueva-clave${await follow(data.properties.action_link)}`)
    await again.getByText('El enlace no es válido o ya venció.').waitFor({ timeout: 30_000 })
    assert.equal(await again.getByPlaceholder('Nueva contraseña', { exact: true }).count(), 0)
    const sent = await standInRecover(again)
    await again.getByPlaceholder('tu@correo.com').fill(u.email)
    await again.getByRole('button', { name: 'Enviar un nuevo enlace' }).click()
    await again.getByText(NEUTRAL).waitFor({ timeout: 30_000 })
    assert.equal(sent.length, 1)
    assert.equal(path(again), '/nueva-clave')
    await again.close()

    // Opening the page without a link says the same.
    const bare = await app.newPage()
    await bare.goto(`${app.url}/nueva-clave`)
    await bare.getByText('El enlace no es válido o ya venció.').waitFor({ timeout: 30_000 })
    await bare.close()
  } finally {
    await u.drop()
  }
})

test('recovery link: the recovery session does not skip the guard chain (a stale policy still lands on /aceptar-politica)', async () => {
  const u = await walker()
  try {
    assert.equal((await admin().from('consentimientos').delete().eq('user_id', u.id)).error, null)
    const { data, error } = await admin().auth.admin.generateLink({ type: 'recovery', email: u.email, options: { redirectTo: `${app.url}/nueva-clave` } })
    assert.equal(error, null, error?.message)
    const page = await app.newPage()
    await page.goto(`${app.url}/nueva-clave${await follow(data.properties.action_link)}`)
    await page.getByPlaceholder('Nueva contraseña', { exact: true }).fill(NEW_PW)
    await page.getByPlaceholder('Repite la nueva contraseña').fill(NEW_PW)
    await page.getByRole('button', { name: 'Guardar contraseña' }).click()
    await page.waitForURL('**/aceptar-politica', { timeout: 60_000 })
    for (const target of ['/app', '/mis-datos']) {
      await page.goto(`${app.url}${target}`)
      await page.waitForURL('**/aceptar-politica', { timeout: 30_000 })
    }
    await page.close()
  } finally {
    await u.drop()
  }
})

test('change password in /mis-datos: a wrong current password changes nothing; the right one sets the new password', async () => {
  const u = await walker()
  try {
    const page = await login(u)
    await page.goto(`${app.url}/mis-datos`)
    await page.getByText(`Correo: ${u.email}`).waitFor({ timeout: 30_000 })

    await page.getByPlaceholder('Contraseña actual').fill('NoEsLaMia1')
    await page.getByPlaceholder('Nueva contraseña', { exact: true }).fill(NEW_PW)
    await page.getByPlaceholder('Repite la nueva contraseña').fill(NEW_PW)
    await page.getByRole('button', { name: 'Cambiar contraseña' }).click()
    await page.getByText('La contraseña actual no es correcta.').waitFor({ timeout: 30_000 })
    assert.equal(await canSignIn(u.email, u.password), true, 'nothing changed')
    assert.equal(await canSignIn(u.email, NEW_PW), false)
    assert.equal(path(page), '/mis-datos', 'the session stays open')

    await page.getByPlaceholder('Contraseña actual').fill(u.password)
    await page.getByRole('button', { name: 'Cambiar contraseña' }).click()
    await page.getByText('Tu contraseña cambió.').waitFor({ timeout: 30_000 })
    assert.equal(await canSignIn(u.email, NEW_PW), true)
    assert.equal(await canSignIn(u.email, u.password), false)
    await page.close()
  } finally {
    await u.drop()
  }
})

test('change email in /mis-datos: the request carries the return link and the page shows the pending confirmation notice', async () => {
  const u = await walker()
  const nuevo = `dd-nuevo-${randomUUID().slice(0, 8)}@example.com`
  try {
    const page = await login(u)
    // PUT /auth/v1/user with an email would mail both addresses; generateLink records the same pending
    // change through the service role without sending anything.
    const sent = []
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'PUT, OPTIONS' }
    await page.route('**/auth/v1/user*', async (route) => {
      const req = route.request()
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      if (req.method() !== 'PUT' || !req.postDataJSON()?.email) return route.continue()
      sent.push({ url: req.url(), body: req.postDataJSON() })
      const link = await admin().auth.admin.generateLink({ type: 'email_change_new', email: u.email, newEmail: req.postDataJSON().email })
      if (link.error) return route.fulfill({ status: 422, headers: cors, json: { msg: link.error.message } })
      return route.fulfill({ status: 200, headers: cors, json: link.data.user })
    })
    await page.goto(`${app.url}/mis-datos`)
    await page.getByText(`Correo: ${u.email}`).waitFor({ timeout: 30_000 })
    await page.getByPlaceholder('nuevo@correo.com').fill(nuevo)
    await page.getByRole('button', { name: 'Cambiar correo' }).click()
    await page.getByText(`Te enviamos un enlace de confirmación a ${nuevo}.`).waitFor({ timeout: 30_000 })
    assert.equal(sent.length, 1)
    assert.equal(sent[0].body.email, nuevo)
    assert.equal(new URL(sent[0].url).searchParams.get('redirect_to'), `${app.url}/login`)
    const { data } = await admin().auth.admin.getUserById(u.id)
    assert.equal(data.user.new_email, nuevo, 'the change is pending')
    assert.equal(data.user.email, u.email, 'the address changes only once confirmed')
    await page.close()
  } finally {
    await u.drop()
  }
})

test('live policy re-check: an open session whose accepted version is stale goes to /aceptar-politica on focus, without logging out', async () => {
  const u = await walker()
  try {
    const page = await login(u)
    await page.waitForLoadState('networkidle')
    assert.equal((await admin().from('consentimientos').delete().eq('user_id', u.id)).error, null)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForURL('**/aceptar-politica', { timeout: 30_000 })
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('muten:auth:loggedIn') ?? 'false')), true, 'still signed in')
    await page.close()
  } finally {
    await u.drop()
  }
})
