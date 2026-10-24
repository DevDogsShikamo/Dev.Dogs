// Acceptance gate in a real browser against STAGING (muten dev): a client without the current role notice and
// an owner without the current Términos para negocios see /aceptar-condiciones after login and cannot reach a
// portal (not even by URL) until the document is read to the end and "Entiendo y acepto" records it; then they
// land in their portal. The policy gate (/aceptar-politica) comes first when both are pending.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, credentials, ids, seed, tempUser } from '../security/_actors.mjs'
import { acceptConditions, acceptPolicy, conditionsButton, policyDoc, startApp, understandButton } from './_app.mjs'
import { AVISO_ROL_VERSION, POLITICA_VERSION, TERMINOS_NEGOCIO_VERSION } from '../../src/lib/politica.js'

let app

before(async () => {
  await seed()
  app = await startApp()
}, { timeout: 120_000 })
after(async () => {
  await restoreClient3()
  await app?.stop()
})

const u = ids.users
const restoreClient3 = () =>
  admin().from('aceptaciones').upsert({ user_id: u.CLIENT3, tipo: 'aviso_rol', negocio_id: ids.negocios.A, version: AVISO_ROL_VERSION }, { onConflict: 'user_id,tipo,negocio_id,version', ignoreDuplicates: true })
const rowsOf = async (userId) =>
  (await admin().from('aceptaciones').select('tipo, version').eq('user_id', userId)).data.map((r) => `${r.tipo}:${r.version}`).sort()

async function login({ email, password }) {
  const page = await app.newPage()
  page.errors = []
  page.on('pageerror', (e) => page.errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && /Maximum call stack|RangeError/.test(m.text())) page.errors.push(`console: ${m.text()}`) })
  await page.goto(`${app.url}/login`)
  await page.getByPlaceholder('tu@correo.com').fill(email)
  await page.getByPlaceholder('••••••••').fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  return page
}
const settle = async (page) => { await page.waitForLoadState('networkidle'); await page.waitForTimeout(1500) }
const path = (page) => new URL(page.url()).pathname
const noErrors = (page) => assert.deepEqual(page.errors, [], 'no page error / RangeError')

// Full reloads on every portal (and /login): the pending state survives and the chain ends at the gate.
async function lockedOut(page) {
  for (const target of ['/cliente', '/app', '/empresa', '/login']) {
    await page.goto(`${app.url}${target}`)
    await page.waitForURL('**/aceptar-condiciones', { timeout: 30_000 })
  }
  await settle(page)
  assert.equal(path(page), '/aceptar-condiciones')
}

// A provisioned owner (current policy accepted) of a new business without the business terms.
async function newOwner() {
  const o = await tempUser()
  const res = await o.client.rpc('provision_negocio', { p_rol: 'empresa', p_nombre: 'Ana Condiciones', p_negocio: 'Condiciones E2E', p_politica: POLITICA_VERSION })
  assert.equal(res.error, null, res.error?.message)
  return o
}

test('client without the role notice: gated, no portal by URL, accepts after reading it and lands on /cliente with "Servicio de …"', async () => {
  assert.equal((await admin().from('aceptaciones').delete().eq('user_id', u.CLIENT3).eq('tipo', 'aviso_rol')).error, null)
  try {
    const page = await login(credentials('CLIENT3'))
    await page.waitForURL('**/aceptar-condiciones', { timeout: 60_000 })
    await page.getByText('Quién presta el servicio a tu perro').first().waitFor()
    await lockedOut(page)
    assert.deepEqual(await rowsOf(u.CLIENT3), [], 'nothing accepted yet')

    await conditionsButton(page).click()
    const text = await policyDoc(page).innerText()
    assert.match(text, /DevDogs es la herramienta que usa Tenant A para organizar su servicio\./)
    assert.match(text, /DevDogs no recoge, transporta, pasea, cuida ni responde por tu perro\./)
    assert.match(text, /Quien presta el servicio, recibe a tu perro y responde por él es Tenant A\./)
    assert.match(text, new RegExp(`Versión del aviso: ${AVISO_ROL_VERSION}`))
    await page.getByRole('button', { name: 'Cerrar los documentos' }).click()
    await policyDoc(page).waitFor({ state: 'detached' })
    assert.equal(path(page), '/aceptar-condiciones')

    await acceptConditions(page)
    await page.waitForURL('**/cliente', { timeout: 60_000 })
    await page.getByText('Servicio de Tenant A').waitFor({ timeout: 30_000 })
    assert.deepEqual(await rowsOf(u.CLIENT3), [`aviso_rol:${AVISO_ROL_VERSION}`])
    noErrors(page)
    await page.close()
  } finally {
    await restoreClient3()
  }
})

test('owner without the business terms: gated, "Entiendo y acepto" stays locked until the end, then /empresa', async () => {
  const o = await newOwner()
  try {
    const page = await login(o)
    await page.waitForURL('**/aceptar-condiciones', { timeout: 60_000 })
    await lockedOut(page)
    await conditionsButton(page).click()
    assert.match(await policyDoc(page).innerText(), new RegExp(`Versión de estos términos: ${TERMINOS_NEGOCIO_VERSION}`))
    assert.equal(await understandButton(page).isDisabled(), true, 'locked before reading to the end')
    await policyDoc(page).evaluate((el) => { el.scrollTop = el.scrollHeight })
    await understandButton(page).click()
    await page.waitForURL('**/empresa', { timeout: 60_000 })
    await settle(page)
    assert.equal(path(page), '/empresa')
    assert.deepEqual(await rowsOf(o.id), [`terminos_negocio:${TERMINOS_NEGOCIO_VERSION}`])
    noErrors(page)
    await page.close()
  } finally {
    await o.drop()
  }
})

test('owner: "Cerrar sesión" leaves the gate for /login and accepts nothing', async () => {
  const o = await newOwner()
  try {
    const page = await login(o)
    await page.waitForURL('**/aceptar-condiciones', { timeout: 60_000 })
    await page.getByRole('button', { name: 'Cerrar sesión' }).click()
    await page.waitForURL('**/login', { timeout: 60_000 })
    await settle(page)
    assert.equal(path(page), '/login')
    await page.goto(`${app.url}/aceptar-condiciones`)
    await settle(page)
    assert.equal(path(page), '/login', 'the gate is closed without a session')
    assert.deepEqual(await rowsOf(o.id), [])
    noErrors(page)
    await page.close()
  } finally {
    await o.drop()
  }
})

test('policy and business terms both pending: /aceptar-politica comes first, then /aceptar-condiciones, then the portal', async () => {
  const o = await newOwner()
  try {
    assert.equal((await admin().from('consentimientos').delete().eq('user_id', o.id)).error, null)
    const page = await login(o)
    await page.waitForURL('**/aceptar-politica', { timeout: 60_000 })
    await acceptPolicy(page)
    await page.getByRole('button', { name: 'Aceptar y continuar' }).click()
    await acceptConditions(page)
    await page.waitForURL('**/empresa', { timeout: 60_000 })
    await settle(page)
    assert.equal(path(page), '/empresa')
    noErrors(page)
    await page.close()
  } finally {
    await o.drop()
  }
})

// Business policies (20261022110001_politicas_negocio.sql): the owner of tenant A publishes them from Perfil,
// starting from the examples it must adapt; its client CLIENT3 is then gated until it reads and accepts them,
// and reads them again from its Perfil. The policy and its acceptance are removed afterwards (no policy in
// the fixture tenants by default).
const removePolicies = async () => {
  assert.equal((await admin().from('negocio_politicas').delete().eq('negocio_id', ids.negocios.A)).error, null)
  assert.equal((await admin().from('aceptaciones').delete().eq('tipo', 'politica_negocio').eq('negocio_id', ids.negocios.A)).error, null)
}
const toPerfil = (page) => page.getByRole('button', { name: 'Perfil', exact: true }).filter({ visible: true }).first().click()

test('owner publishes the business policies; its client is gated until it accepts them, then reads them in Perfil', async () => {
  await removePolicies()
  try {
    const owner = await login(credentials('OWNER'))
    await owner.waitForURL('**/empresa', { timeout: 60_000 })
    await toPerfil(owner)
    await owner.getByText('Aún no publicas las políticas de tu negocio.', { exact: false }).waitFor({ timeout: 30_000 })
    await owner.getByText('artículos 42 y 43 de la Ley 1480 de 2011', { exact: false }).waitFor()
    const areas = owner.locator('textarea.dd-pol-txt')
    await areas.nth(8).waitFor({ timeout: 30_000 })
    assert.match(await areas.nth(5).inputValue(), /^Ejemplo, edítalo según tu negocio: [^]*artículo 2353 del Código Civil/, 'the responsabilidad example')
    assert.equal(await areas.count(), 9, 'one text area per section')
    const publish = () => owner.getByRole('button', { name: 'Publicar nueva versión' })
    assert.equal(await publish().isDisabled(), true, 'the examples must be adapted first')
    for (let i = 0; i < 9; i++) {
      const area = areas.nth(i)
      await area.fill((await area.inputValue()).replace('Ejemplo, edítalo según tu negocio: ', ''))
    }
    const requisitos = owner.getByPlaceholder('Requisitos para tu perro')
    await requisitos.fill('')
    assert.equal(await publish().isDisabled(), true, 'requisitos is required')
    await requisitos.fill('Carné de vacunación al día (E2E).')
    await publish().click()
    await owner.getByText('Políticas publicadas', { exact: false }).waitFor({ timeout: 30_000 })
    await owner.getByText(/Versión 1, publicada el/).waitFor({ timeout: 30_000 })
    const rows = (await admin().from('negocio_politicas').select('version, vigente, secciones').eq('negocio_id', ids.negocios.A)).data
    assert.deepEqual(rows.map((r) => [r.version, r.vigente]), [[1, true]])
    assert.equal(rows[0].secciones.find((s) => s.clave === 'requisitos').texto, 'Carné de vacunación al día (E2E).')
    noErrors(owner)
    await owner.close()

    const page = await login(credentials('CLIENT3'))
    await page.waitForURL('**/aceptar-condiciones', { timeout: 60_000 })
    await page.getByText('Políticas de Tenant A').first().waitFor()
    await lockedOut(page)
    await conditionsButton(page).click()
    const text = await policyDoc(page).innerText()
    assert.match(text, /Políticas de Tenant A/)
    assert.match(text, /Versión 1, publicada el/)
    assert.match(text, /Estas políticas las fija Tenant A; DevDogs no las revisa ni las avala\./)
    assert.match(text, /Carné de vacunación al día \(E2E\)\./)
    assert.match(text, /artículo 2353 del Código Civil/)
    assert.equal(await understandButton(page).isDisabled(), true, 'locked before reading to the end')
    await policyDoc(page).evaluate((el) => { el.scrollTop = el.scrollHeight })
    await policyDoc(page).hover()
    await understandButton(page).click()
    await page.waitForURL('**/cliente', { timeout: 60_000 })
    assert.ok((await rowsOf(u.CLIENT3)).includes('politica_negocio:1'))

    await toPerfil(page)
    await page.getByRole('button', { name: 'Ver las políticas' }).click()
    const dialog = page.getByRole('dialog', { name: 'Políticas de Tenant A' })
    await dialog.waitFor()
    assert.match(await dialog.innerText(), /Carné de vacunación al día \(E2E\)\./)
    await page.getByRole('button', { name: 'Cerrar las políticas' }).click()
    await dialog.waitFor({ state: 'detached' })
    noErrors(page)
    await page.close()
  } finally {
    await removePolicies()
  }
})
