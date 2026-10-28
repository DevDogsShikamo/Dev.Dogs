// Re-consent gate in a real browser against STAGING (muten dev): a user whose last accepted policy is
// older than the current one sees /aceptar-politica after login and cannot reach a portal (not even by
// URL) until the box is ticked and "Aceptar y continuar" records the current version; then the user
// lands in the portal of the role and later logins go straight in. A current user never sees the gate.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, credentials, seed, tempUser } from '../security/_actors.mjs'
import { startApp } from './_app.mjs'
import { POLITICA_VERSION } from '../../src/lib/politica.js'

// The version S7 seeded and S5b retired (still in `politicas`, vigente = false).
const OLD = '2026-10-14-borrador'
const GATE = 'Actualizamos nuestra Política de tratamiento de datos'
let app

before(async () => {
  await seed()
  app = await startApp()
}, { timeout: 120_000 })
after(async () => { await app?.stop() })

// A provisioned owner whose only consent record is the retired version.
async function outdatedUser(p_rol) {
  const u = await tempUser()
  const res = await u.client.rpc('provision_negocio', { p_rol, p_nombre: 'Ana Reconsent', p_negocio: 'Reconsent E2E', p_politica: POLITICA_VERSION })
  assert.equal(res.error, null, res.error?.message)
  assert.equal((await admin().from('consentimientos').delete().eq('user_id', u.id)).error, null)
  assert.equal((await admin().from('consentimientos').insert({ user_id: u.id, policy_version: OLD })).error, null)
  return u
}
const versionsOf = async (userId) =>
  (await admin().from('consentimientos').select('policy_version').eq('user_id', userId)).data.map((r) => r.policy_version).sort()

async function login({ email, password }) {
  const page = await app.newPage()
  page.errors = []
  page.visited = []
  page.on('pageerror', (e) => page.errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && /Maximum call stack|RangeError/.test(m.text())) page.errors.push(`console: ${m.text()}`) })
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) page.visited.push(new URL(f.url()).pathname) })
  await page.goto(`${app.url}/login`)
  await page.getByPlaceholder('tu@correo.com').fill(email)
  await page.getByPlaceholder('••••••••').fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  return page
}
const settle = async (page) => { await page.waitForLoadState('networkidle'); await page.waitForTimeout(1500) }
const path = (page) => new URL(page.url()).pathname
const noErrors = (page) => assert.deepEqual(page.errors, [], 'no page error / RangeError')
const consentBox = (page) => page.getByRole('checkbox', { name: /He leído y acepto la Política de tratamiento de datos/ })
const acceptButton = (page) => page.getByRole('button', { name: 'Aceptar y continuar' })

test('outdated consent: the gate comes first, no portal opens by URL, accepting lands on /app and the next login goes straight in', async () => {
  const u = await outdatedUser('paseador')
  try {
    const page = await login(u)
    await page.waitForURL('**/aceptar-politica', { timeout: 60_000 })
    await page.getByText(GATE).waitFor()
    assert.match(await page.locator('body').innerText(), new RegExp(`Versión de la política: ${POLITICA_VERSION}`))
    assert.equal(await consentBox(page).isChecked(), false)
    assert.equal(await acceptButton(page).isDisabled(), true)

    // Full reloads on every portal (and /login): the pending state survives and the chain ends at the gate.
    for (const target of ['/app', '/empresa', '/cliente', '/login']) {
      await page.goto(`${app.url}${target}`)
      await page.waitForURL('**/aceptar-politica', { timeout: 30_000 })
    }
    await settle(page)
    assert.equal(path(page), '/aceptar-politica')
    assert.deepEqual(await versionsOf(u.id), [OLD], 'nothing accepted yet')

    await consentBox(page).check()
    assert.equal(await acceptButton(page).isDisabled(), false)
    await acceptButton(page).click()
    await page.waitForURL('**/app', { timeout: 60_000 })
    await settle(page)
    assert.equal(path(page), '/app')
    assert.deepEqual(await versionsOf(u.id), [OLD, POLITICA_VERSION].sort())
    noErrors(page)
    await page.close()

    const again = await login(u)
    await again.waitForURL('**/app', { timeout: 60_000 })
    await settle(again)
    assert.equal(path(again), '/app')
    assert.ok(!again.visited.includes('/aceptar-politica'), `the gate was shown again: ${again.visited.join(' -> ')}`)
    noErrors(again)
    await again.close()
  } finally {
    await u.drop()
  }
})

test('outdated consent: the policy opens in a new tab, "Cerrar sesión" leaves the gate for /login and accepts nothing', async () => {
  const u = await outdatedUser('empresa')
  try {
    const page = await login(u)
    await page.waitForURL('**/aceptar-politica', { timeout: 60_000 })
    const [tab] = await Promise.all([
      page.context().waitForEvent('page', { timeout: 10_000 }),
      page.getByRole('button', { name: /Política de tratamiento de datos/ }).click(),
    ])
    await tab.waitForLoadState()
    assert.equal(new URL(tab.url()).pathname, '/privacidad')
    await tab.close()
    assert.equal(path(page), '/aceptar-politica')

    await page.getByRole('button', { name: 'Cerrar sesión' }).click()
    await page.waitForURL('**/login', { timeout: 60_000 })
    await settle(page)
    assert.equal(path(page), '/login')
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('muten:auth:loggedIn') ?? 'false')), false)
    assert.deepEqual(await versionsOf(u.id), [OLD])

    await page.goto(`${app.url}/aceptar-politica`)
    await settle(page)
    assert.equal(path(page), '/login', 'the gate is closed without a session')
    noErrors(page)
    await page.close()
  } finally {
    await u.drop()
  }
})

test('current consent: login goes straight to the portal and the gate redirects back to it', async () => {
  const page = await login(credentials('CLIENT'))
  await page.waitForURL('**/cliente', { timeout: 60_000 })
  await settle(page)
  assert.equal(path(page), '/cliente')
  assert.ok(!page.visited.includes('/aceptar-politica'), `the gate was shown: ${page.visited.join(' -> ')}`)
  await page.goto(`${app.url}/aceptar-politica`)
  await page.waitForURL('**/cliente', { timeout: 30_000 })
  await settle(page)
  assert.equal(path(page), '/cliente')
  assert.equal(await page.getByText(GATE).count(), 0)
  noErrors(page)
  await page.close()
})
