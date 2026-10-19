// Google sign-in and "Completar registro" in a real browser against STAGING (muten dev).
// Google itself is never contacted: the authorize request is intercepted and aborted, and the return
// from Google is reproduced with the implicit-flow URL Supabase sends back (/login#access_token=...),
// carrying a real staging session of a throwaway user that has no profile yet.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { admin, as, ids, seed, tempUser } from '../security/_actors.mjs'
import { loadConfig } from '../security/_env.mjs'
import { startApp } from './_app.mjs'
import { POLITICA_VERSION } from '../../src/lib/politica.js'

let app
before(async () => { await seed(); app = await startApp() }, { timeout: 120_000 })
after(async () => { await app?.stop() })

const path = (page) => new URL(page.url()).pathname
const settle = async (page) => { await page.waitForLoadState('networkidle'); await page.waitForTimeout(1500) }
const profileOf = async (id) => (await admin().from('profiles').select('rol, negocio_id').eq('id', id).maybeSingle()).data
const versionsOf = async (id) => (await admin().from('consentimientos').select('policy_version').eq('user_id', id)).data.map((r) => r.policy_version)
const consentBox = (page) => page.getByRole('checkbox', { name: /He leído y acepto la Política de tratamiento de datos/ })
const finish = (page) => page.getByRole('button', { name: 'Completar registro' })

for (const route of ['/login', '/signup']) {
  test(`${route}: "Continuar con Google" goes to Supabase authorize with provider google and a redirect back to the app`, async () => {
    const page = await app.newPage()
    await page.route(/\/auth\/v1\/authorize/, (r) => r.abort()) // never reach Google
    await page.goto(`${app.url}${route}`)
    const [req] = await Promise.all([
      page.waitForRequest(/\/auth\/v1\/authorize/, { timeout: 30_000 }),
      page.getByRole('button', { name: 'Continuar con Google' }).click(),
    ])
    const url = new URL(req.url())
    assert.equal(url.origin, new URL(loadConfig().url).origin, 'the staging Supabase project')
    assert.equal(url.searchParams.get('provider'), 'google')
    assert.equal(url.searchParams.get('redirect_to'), `${app.url}/login`)
    assert.ok(req.isNavigationRequest(), 'a top-level navigation')
    await page.close()
  })
}

// The browser comes back from Google with a session for a user that has no profile.
async function googleReturn(u) {
  const { data: { session: s } } = await u.client.auth.getSession()
  const hash = new URLSearchParams({ access_token: s.access_token, expires_at: String(s.expires_at), expires_in: String(s.expires_in), refresh_token: s.refresh_token, token_type: 'bearer' })
  const page = await app.newPage()
  page.errors = []
  page.on('pageerror', (e) => page.errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && /Maximum call stack|RangeError/.test(m.text())) page.errors.push(`console: ${m.text()}`) })
  await page.goto(`${app.url}/login#${hash}`)
  await page.waitForURL('**/completar-registro', { timeout: 60_000 })
  await page.getByRole('heading', { name: 'Completar registro' }).waitFor()
  return page
}

async function complete(page, option, fields) {
  await page.getByRole('button', { name: option }).click()
  for (const [placeholder, value] of Object.entries(fields)) await page.getByPlaceholder(placeholder).fill(value)
  assert.equal(await consentBox(page).isChecked(), false, 'the consent box starts unticked')
  assert.equal(await finish(page).isDisabled(), true, 'cannot finish without the consent')
  await consentBox(page).check()
  assert.equal(await finish(page).isDisabled(), false)
  await finish(page).click()
}

test('no profile: routed to /completar-registro, no portal by URL; an independent walker finishes and lands on /app with a consent row', async () => {
  const u = await tempUser()
  try {
    const page = await googleReturn(u)
    // Full reloads (at most 4: muten dev keeps each page's /_reload socket open and Chromium has 6 per host).
    for (const target of ['/app', '/empresa', '/cliente', '/login']) {
      await page.goto(`${app.url}${target}`)
      await page.waitForURL('**/completar-registro', { timeout: 30_000 })
    }
    await settle(page)
    assert.equal(path(page), '/completar-registro')
    assert.equal(await profileOf(u.id), null)

    await complete(page, 'Soy paseador independiente', { 'Ana Rondón': 'Ana Google' })
    await page.waitForURL('**/app', { timeout: 60_000 })
    await settle(page)
    assert.equal(path(page), '/app')
    assert.equal((await profileOf(u.id)).rol, 'paseador')
    assert.deepEqual(await versionsOf(u.id), [POLITICA_VERSION])
    assert.deepEqual(page.errors, [])
    await page.close()
  } finally {
    await u.drop()
  }
})

test('no profile: a business finishes and lands on /empresa', async () => {
  const u = await tempUser()
  try {
    const page = await googleReturn(u)
    await complete(page, 'Tengo un negocio', { 'Ana Rondón': 'Ana Google', 'DevDogs Poblado': 'Google E2E' })
    await page.waitForURL('**/empresa', { timeout: 60_000 })
    const p = await profileOf(u.id)
    assert.equal(p.rol, 'empresa')
    assert.equal((await admin().from('negocios').select('nombre').eq('id', p.negocio_id).single()).data.nombre, 'Google E2E')
    assert.deepEqual(await versionsOf(u.id), [POLITICA_VERSION])
    await page.close()
  } finally {
    await u.drop()
  }
})

test('no profile: an invitation bound to the email joins the invited portal', async () => {
  const u = await tempUser()
  try {
    const code = (await (await as('OWNER')).rpc('invitacion_crear', { p_rol: 'cliente', p_email: u.email })).data
    assert.ok(code, 'valid-call precondition')
    const page = await googleReturn(u)
    await complete(page, 'Tengo un código de invitación', { 'Ana Rondón': 'Ana Google', 'XXXXXXX-XXXXXXX': code })
    await page.waitForURL('**/cliente', { timeout: 60_000 })
    assert.deepEqual(await profileOf(u.id), { rol: 'cliente', negocio_id: ids.negocios.A })
    assert.deepEqual(await versionsOf(u.id), [POLITICA_VERSION])
    await page.close()
  } finally {
    await admin().from('invitaciones').delete().eq('email', u.email)
    await u.drop()
  }
})

test('no profile: an invitation for another email is refused with a message and the user stays', async () => {
  const u = await tempUser()
  const other = `dd-e2e-${randomUUID().slice(0, 8)}@example.com`
  try {
    const code = (await (await as('OWNER')).rpc('invitacion_crear', { p_rol: 'cliente', p_email: other })).data
    assert.ok(code, 'valid-call precondition')
    const page = await googleReturn(u)
    await complete(page, 'Tengo un código de invitación', { 'Ana Rondón': 'Ana Google', 'XXXXXXX-XXXXXXX': code })
    await page.getByText('Invitación inválida, vencida o para otro correo.').waitFor({ timeout: 30_000 })
    await settle(page)
    assert.equal(path(page), '/completar-registro')
    assert.equal(await profileOf(u.id), null)
    assert.deepEqual(await versionsOf(u.id), [])
    await page.close()
  } finally {
    await admin().from('invitaciones').delete().eq('email', other)
    await u.drop()
  }
})
