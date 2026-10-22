// S7 browser half: the policy is unaccepted and required on every account-creation form (PC-2c), it
// is accepted in a modal whose "Acepto" unlocks only at the end of the document, accepting stores a
// consent record with the version the modal showed (PC-2d), and the policy carries the visible draft
// marker (PC-3a).
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { admin, as, ids, seed } from '../security/_actors.mjs'
import { acceptConditions, acceptButton, acceptPolicy, autoconfirmSignup, consentLine, isAccepted, policyDoc, startApp } from './_app.mjs'
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
const sessionUserId = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k)))).user.id)

// Opens /signup for `rol` and fills the data step, leaving the policy unaccepted.
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
  test(`PC-2c: the ${rol} signup keeps "Crear mi cuenta" disabled until the policy is accepted`, async () => {
    const page = await signupForm(rol)
    const submit = page.getByRole('button', { name: 'Crear mi cuenta' })
    await consentLine(page).waitFor()
    assert.equal(await isAccepted(page), false)
    assert.equal(await submit.isDisabled(), true)
    await acceptPolicy(page)
    assert.equal(await isAccepted(page), true)
    assert.equal(await submit.isDisabled(), false)
    await page.close()
  })
}

test('PC-2c: a forced click on the disabled signup button sends no provisioning request', async () => {
  const page = await signupForm('Empresa', { intercept: true })
  const calls = []
  page.on('request', (r) => { if (/provision_negocio|auth\/v1\/signup/.test(r.url())) calls.push(r.url()) })
  await consentLine(page).waitFor()
  await page.getByRole('button', { name: 'Crear mi cuenta' }).click({ force: true, timeout: 5_000 }).catch(() => {})
  await page.waitForTimeout(1500)
  assert.deepEqual(calls, [])
  await acceptPolicy(page) // valid-call precondition: the same form does submit once accepted
  await page.getByRole('button', { name: 'Crear mi cuenta' }).click()
  await acceptConditions(page) // new owners and clients accept the role notice or the business terms
  await page.waitForURL('**/empresa', { timeout: 30_000 })
  assert.ok(calls.length >= 1)
  await admin().auth.admin.deleteUser(await sessionUserId(page))
  await page.close()
})

test('PC-2c: the invitation join keeps "Unirme" disabled until the policy is accepted', async () => {
  const email = mail()
  const code = (await (await as('OWNER')).rpc('invitacion_crear', { p_rol: 'cliente', p_email: email })).data
  assert.ok(code, 'precondition: a valid invitation exists')
  const page = await joinForm(code, email)
  const submit = page.getByRole('button', { name: 'Unirme' })
  await consentLine(page).waitFor()
  assert.equal(await isAccepted(page), false)
  assert.equal(await submit.isDisabled(), true)
  await acceptPolicy(page)
  assert.equal(await submit.isDisabled(), false)
  await page.close()
})

// ---- PC-2d: accepting creates the account and a record with the shown version --------------------------
for (const [rol, portal] of [['Empresa', 'empresa'], ['Paseador', 'app']]) {
  test(`PC-2d: accepting the policy creates the ${rol} account and stores a consent record with the version shown in the modal`, async () => {
    const page = await signupForm(rol, { intercept: true })
    const version = await acceptPolicy(page)
    assert.equal(version, POLITICA_VERSION)
    await page.getByRole('button', { name: 'Crear mi cuenta' }).click()
    await acceptConditions(page) // new owners and clients accept the role notice or the business terms
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

test('PC-2d: accepting the policy on /unirse joins the tenant and stores a consent record with the shown version', async () => {
  const email = mail()
  const code = (await (await as('OWNER')).rpc('invitacion_crear', { p_rol: 'cliente', p_email: email })).data
  const page = await joinForm(code, email, { intercept: true })
  const version = await acceptPolicy(page)
  assert.equal(version, POLITICA_VERSION)
  await page.getByRole('button', { name: 'Unirme' }).click()
  await acceptConditions(page) // new owners and clients accept the role notice or the business terms
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

// The modal: the full policy with its draft marker and version; "Acepto" stays disabled until the end of
// the document; closing it neither accepts nor loses what was typed.
for (const [label, open] of [
  ['signup', () => signupForm('Empresa')],
  ['/unirse', () => joinForm('0123-4567-89AB-CD', mail())],
]) {
  test(`PC-3a: the ${label} policy modal shows the full draft and unlocks "Acepto" only at the end of the document`, async () => {
    const page = await open()
    const typed = await page.getByPlaceholder('Ana Rondón').inputValue()
    assert.ok(typed.length > 0, 'precondition: the form holds typed data')
    await consentLine(page).click()
    const doc = await policyDoc(page).innerText()
    assert.ok(doc.includes(MARKER), 'the draft marker is in the modal')
    assert.ok(doc.includes(`Versión de la política: ${POLITICA_VERSION}`))
    assert.ok(doc.includes('1.3 Aceptación') && doc.includes('1.10 Responsabilidad'), 'the terms of use are part of what is accepted')
    assert.ok(doc.includes('11. Cambios en esta política') && doc.includes('9. Marco legal de referencia'), 'the whole set, up to the last section')
    assert.equal(await acceptButton(page).isDisabled(), true, 'locked before scrolling')
    await policyDoc(page).evaluate((el) => { el.scrollTop = el.scrollHeight / 2 })
    await page.waitForTimeout(300)
    assert.equal(await acceptButton(page).isDisabled(), true, 'still locked halfway')
    await page.getByRole('button', { name: 'Cerrar los documentos' }).click()
    await policyDoc(page).waitFor({ state: 'detached' })
    assert.equal(await isAccepted(page), false, 'closing does not accept')
    assert.equal(await page.getByPlaceholder('Ana Rondón').inputValue(), typed, 'the form keeps what was typed')
    await consentLine(page).click()
    await policyDoc(page).evaluate((el) => { el.scrollTop = el.scrollHeight })
    await acceptButton(page).click()
    await policyDoc(page).waitFor({ state: 'detached' })
    assert.equal(await isAccepted(page), true)
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
  // "certificado de salud" is the term the Ley 2480 uses for the dog record; any other "certificad..." is a claim.
  const text = (await page.locator('body').innerText()).toLowerCase().replace(/certificados? de salud/g, '')
  assert.ok(text.length > 2000, 'the policy text did not render')
  for (const claim of [/\bcumple\b/, /\bcumplimos\b/, /en cumplimiento/, /certificad/, /plenamente conforme/, /garantiza(mos)? (el|la) (cumplimiento|seguridad total)/, /cumple con la ley/]) {
    assert.ok(!claim.test(text), `the policy claims compliance: ${claim}`)
  }
  await page.close()
})
