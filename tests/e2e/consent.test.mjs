// S7 browser half: the consent checkbox is unticked and required on every account-creation form
// (PC-2c), a ticked submit stores a consent record with the version the page showed (PC-2d), and
// the policy page and the consent step carry the visible draft marker (PC-3a).
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { admin, as, ids, seed } from '../security/_actors.mjs'
import { autoconfirmSignup, startApp } from './_app.mjs'
import { POLITICA_VERSION } from '../../src/lib/politica.js'

let app
before(async () => { await seed(); app = await startApp() }, { timeout: 120_000 })
after(async () => {
  await admin().from('invitaciones').delete().in('negocio_id', Object.values(ids.negocios))
  await app?.stop()
})

const PASSWORD = 'Abcdefg1'
const MARKER = 'BORRADOR — pendiente de revisión legal'
const mail = () => `dd-e2e-${randomUUID().slice(0, 8)}@example.com`
const consentBox = (page) => page.getByRole('checkbox', { name: /He leído y acepto la Política de tratamiento de datos/ })
const policyLink = (page) => page.getByRole('button', { name: /Política de tratamiento de datos/ })
const sessionUserId = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k)))).user.id)
const shownVersion = async (page) => (await page.locator('body').innerText()).match(/Versión de la política: (\S+)/)?.[1]

// Opens /signup for `rol` and fills the data step, leaving the consent box untouched.
async function signupForm(rol, { intercept = false } = {}) {
  const page = await app.newPage()
  if (intercept) await autoconfirmSignup(page)
  await page.goto(`${app.url}/signup`)
  await page.getByText(rol, { exact: true }).click()
  await page.getByRole('button', { name: 'Unirme hoy' }).click()
  await page.getByPlaceholder('Ana Rondón').fill('Ana Consent')
  await page.getByPlaceholder('+57 300 000 0000').fill('+57 300 123 4567')
  await page.getByPlaceholder('tu@correo.com').fill(mail())
  await page.getByPlaceholder('••••••••').fill(PASSWORD)
  await page.getByPlaceholder('DevDogs Poblado').fill('Consent E2E')
  return page
}

async function joinForm(code, email, { intercept = false } = {}) {
  const page = await app.newPage()
  if (intercept) await autoconfirmSignup(page)
  await page.goto(`${app.url}/unirse?codigo=${encodeURIComponent(code)}`)
  await page.getByPlaceholder('Ana Rondón').fill('Cliente Consent')
  await page.getByPlaceholder('tu@correo.com').fill(email)
  await page.getByPlaceholder('••••••••').fill(PASSWORD)
  return page
}

async function consentOf(userId) {
  return (await admin().from('consentimientos').select('policy_version, finalidad, aceptado_at').eq('user_id', userId)).data
}

// ---- PC-2c: the box is unticked and blocks submission ----------------------------------------------
for (const rol of ['Empresa', 'Paseador']) {
  test(`PC-2c: the ${rol} signup keeps "Crear mi cuenta" disabled until the consent box is ticked, and again when it is cleared`, async () => {
    const page = await signupForm(rol)
    const submit = page.getByRole('button', { name: 'Crear mi cuenta' })
    await consentBox(page).waitFor()
    assert.equal(await consentBox(page).isChecked(), false)
    assert.equal(await submit.isDisabled(), true)
    await consentBox(page).check()
    assert.equal(await submit.isDisabled(), false)
    await consentBox(page).uncheck()
    assert.equal(await submit.isDisabled(), true)
    await page.close()
  })
}

test('PC-2c: a forced click on the disabled signup button sends no provisioning request', async () => {
  const page = await signupForm('Empresa', { intercept: true })
  const calls = []
  page.on('request', (r) => { if (/provision_negocio|auth\/v1\/signup/.test(r.url())) calls.push(r.url()) })
  await consentBox(page).waitFor()
  await page.getByRole('button', { name: 'Crear mi cuenta' }).click({ force: true, timeout: 5_000 }).catch(() => {})
  await page.waitForTimeout(1500)
  assert.deepEqual(calls, [])
  await consentBox(page).check() // valid-call precondition: the same form does submit once ticked
  await page.getByRole('button', { name: 'Crear mi cuenta' }).click()
  await page.waitForURL('**/empresa', { timeout: 30_000 })
  assert.ok(calls.length >= 1)
  await admin().auth.admin.deleteUser(await sessionUserId(page))
  await page.close()
})

test('PC-2c: the invitation join keeps "Unirme" disabled until the consent box is ticked', async () => {
  const email = mail()
  const code = (await (await as('OWNER')).rpc('invitacion_crear', { p_rol: 'cliente', p_email: email })).data
  assert.ok(code, 'precondition: a valid invitation exists')
  const page = await joinForm(code, email)
  const submit = page.getByRole('button', { name: 'Unirme' })
  await consentBox(page).waitFor()
  assert.equal(await consentBox(page).isChecked(), false)
  assert.equal(await submit.isDisabled(), true)
  await consentBox(page).check()
  assert.equal(await submit.isDisabled(), false)
  await consentBox(page).uncheck()
  assert.equal(await submit.isDisabled(), true)
  await page.close()
})

// ---- PC-2d: ticking creates the account and a record with the shown version --------------------------
for (const [rol, portal] of [['Empresa', 'empresa'], ['Paseador', 'app']]) {
  test(`PC-2d: ticking the box creates the ${rol} account and stores a consent record with the version shown on the form`, async () => {
    const page = await signupForm(rol, { intercept: true })
    await consentBox(page).check()
    const version = await shownVersion(page)
    assert.equal(version, POLITICA_VERSION)
    await page.getByRole('button', { name: 'Crear mi cuenta' }).click()
    await page.waitForURL(`**/${portal}`, { timeout: 30_000 })
    const id = await sessionUserId(page)
    const rows = await consentOf(id)
    await admin().auth.admin.deleteUser(id)
    assert.equal(rows.length, 1)
    assert.deepEqual({ policy_version: rows[0].policy_version, finalidad: rows[0].finalidad }, { policy_version: version, finalidad: 'prestacion_servicio' })
    assert.ok(Math.abs(new Date(rows[0].aceptado_at) - Date.now()) < 5 * 60_000)
    await page.close()
  })
}

test('PC-2d: ticking the box on /unirse joins the tenant and stores a consent record with the shown version', async () => {
  const email = mail()
  const code = (await (await as('OWNER')).rpc('invitacion_crear', { p_rol: 'cliente', p_email: email })).data
  const page = await joinForm(code, email, { intercept: true })
  await consentBox(page).check()
  const version = await shownVersion(page)
  assert.equal(version, POLITICA_VERSION)
  await page.getByRole('button', { name: 'Unirme' }).click()
  await page.waitForURL('**/cliente', { timeout: 30_000 })
  const id = await sessionUserId(page)
  const rows = await consentOf(id)
  const profile = (await admin().from('profiles').select('rol, negocio_id').eq('id', id).single()).data
  await admin().auth.admin.deleteUser(id)
  assert.deepEqual(profile, { rol: 'cliente', negocio_id: ids.negocios.A })
  assert.deepEqual(rows.map((r) => r.policy_version), [version])
  await page.close()
})

// ---- PC-3a: the draft marker is visible, and the policy is reachable from every entry point -----------
test('PC-3a: the policy page is public, shows the draft marker, the version and the placeholders to complete', async () => {
  const page = await app.newPage()
  await page.goto(`${app.url}/privacidad`)
  await page.getByText(MARKER).first().waitFor()
  assert.equal(await page.getByText(MARKER).first().isVisible(), true)
  const text = await page.locator('body').innerText()
  assert.ok(text.includes(`Versión de la política: ${POLITICA_VERSION}`), 'the version is not shown')
  assert.ok((text.match(/\[COMPLETAR:/g) ?? []).length >= 5, 'unknown facts must be placeholders, not invented')
  assert.equal(new URL(page.url()).pathname, '/privacidad') // no redirect to /login for a guest
  await page.close()
})

test('PC-3a: the signup consent step and /unirse show the draft marker next to the checkbox', async () => {
  const signup = await signupForm('Empresa')
  await consentBox(signup).waitFor()
  assert.ok(/borrador.*revisión legal/i.test(await signup.locator('body').innerText()))
  await signup.close()
  const join = await joinForm('0123-4567-89AB-CD', mail())
  await consentBox(join).waitFor()
  assert.ok(/borrador.*revisión legal/i.test(await join.locator('body').innerText()))
  await join.close()
})

// Reading the policy must not cost the typed data: the control opens it in a new tab and the form keeps its state.
for (const [label, open] of [
  ['signup', () => signupForm('Empresa')],
  ['/unirse', () => joinForm('0123-4567-89AB-CD', mail())],
]) {
  test(`PC-3a: the ${label} policy control opens /privacidad in a new tab and the form keeps what was typed`, async () => {
    const page = await open()
    const typed = await page.getByPlaceholder('Ana Rondón').inputValue()
    assert.ok(typed.length > 0, 'precondition: the form holds typed data')
    const [popup] = await Promise.all([page.context().waitForEvent('page', { timeout: 10_000 }), policyLink(page).click()])
    await popup.waitForLoadState()
    assert.equal(new URL(popup.url()).pathname, '/privacidad')
    await popup.getByText(MARKER).first().waitFor()
    assert.equal(await page.getByPlaceholder('Ana Rondón').inputValue(), typed)
    assert.notEqual(new URL(page.url()).pathname, '/privacidad')
    await popup.close()
    await page.close()
  })
}

test('the landing footer links to the policy', async () => {
  const page = await app.newPage()
  await page.goto(app.url)
  const link = page.getByRole('link', { name: 'Política de privacidad' })
  assert.equal(await link.getAttribute('href'), '/privacidad')
  await link.click()
  await page.waitForURL('**/privacidad')
  await page.getByText(MARKER).first().waitFor()
  await page.close()
})

test('PC-3b guard: the policy text never claims compliance, certification or legal adequacy', async () => {
  const page = await app.newPage()
  await page.goto(`${app.url}/privacidad`)
  await page.getByText(MARKER).first().waitFor()
  const text = (await page.locator('body').innerText()).toLowerCase()
  assert.ok(text.length > 2000, 'the policy text did not render')
  for (const claim of [/\bcumple\b/, /\bcumplimos\b/, /en cumplimiento/, /certificad/, /plenamente conforme/, /garantiza(mos)? (el|la) (cumplimiento|seguridad total)/, /cumple con la ley/]) {
    assert.ok(!claim.test(text), `the policy claims compliance: ${claim}`)
  }
  await page.close()
})
