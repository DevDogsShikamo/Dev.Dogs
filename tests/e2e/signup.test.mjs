// S1 browser half: signup collects no national ID / NIT (PC-1a), the "Dueño" card
// goes to /unirse, a business or independent-walker signup provisions through the
// RPC and lands in its portal (TI-1b), and an existing login is unaffected.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { admin, tempUser } from '../security/_actors.mjs'
import { acceptConditions, autoconfirmSignup, startApp, acceptPolicy } from './_app.mjs'
import { POLITICA_VERSION } from '../../src/lib/politica.js'

let app
before(async () => { app = await startApp() }, { timeout: 120_000 })
after(() => app?.stop())

const PASSWORD = 'Abcdefg1'
const newPage = async (path) => {
  const page = await app.newPage()
  await page.goto(app.url + path)
  return page
}
const pathOf = (page) => new URL(page.url()).pathname

// Fills the two-step signup and submits. Returns the page after the portal is reached.
async function signUp(rol, negocio) {
  const email = `dd-e2e-${randomUUID().slice(0, 8)}@example.com`
  const page = await newPage('/signup')
  await autoconfirmSignup(page)
  await page.getByText(rol, { exact: true }).click()
  await page.getByRole('button', { name: 'Unirme hoy' }).click()
  await page.getByPlaceholder('Ana Rondón').fill('Ana E2E')
  await page.getByPlaceholder('+57 300 000 0000').fill('+57 300 123 4567')
  await page.getByPlaceholder('tu@correo.com').fill(email)
  await page.getByPlaceholder('••••••••').fill(PASSWORD)
  await page.getByPlaceholder('DevDogs Poblado').fill(negocio)
  await acceptPolicy(page)
  await page.getByRole('button', { name: 'Crear mi cuenta' }).click()
  return { page, email }
}

// Finds the user the browser just created and removes it (profile and tenant cascade).
async function cleanup(page) {
  // The Supabase session in localStorage names the user; Muten's persisted stores are written lazily.
  const id = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k))
    return JSON.parse(localStorage.getItem(key)).user.id
  })
  const { data } = await admin().from('profiles').select('rol, negocio_id, nombre').eq('id', id).single()
  const negocio = data && (await admin().from('negocios').select('owner_id, tipo, nombre').eq('id', data.negocio_id).single()).data
  await admin().auth.admin.deleteUser(id)
  return { id, profile: data, negocio }
}

for (const rol of ['Paseador', 'Empresa']) {
  test(`PC-1a: the ${rol} signup asks for no national ID, document or NIT`, async () => {
    const page = await newPage('/signup')
    await page.getByText(rol, { exact: true }).click()
    await page.getByRole('button', { name: 'Unirme hoy' }).click()
    await page.getByPlaceholder('Ana Rondón').waitFor() // the data step is on screen
    const text = (await page.locator('body').innerText()).toLowerCase()
    for (const word of ['nit', 'documento', 'identificación', 'cédula', 'cedula']) {
      assert.ok(!new RegExp(`\b${word}\b`).test(text), `signup shows "${word}"`)
    }
    assert.equal(await page.getByRole('button', { name: 'Crear mi cuenta' }).count(), 1) // data step is the last step
    await page.close()
  })
}

test('the Dueño card goes to /unirse instead of the signup form', async () => {
  const page = await newPage('/signup')
  const card = page.getByRole('link', { name: 'Dueño' })
  assert.equal(await card.getAttribute('href'), '/unirse')
  await card.click()
  await page.waitForURL('**/unirse')
  assert.equal(pathOf(page), '/unirse')
  await page.close()
})

test('TI-1b: a business signup provisions an owned empresa and lands in the company portal', async () => {
  const { page } = await signUp('Empresa', 'Peludos E2E')
  await acceptConditions(page) // new owners and clients accept the role notice or the business terms
  await page.waitForURL('**/empresa', { timeout: 30_000 })
  const { profile, negocio } = await cleanup(page)
  assert.equal(profile.rol, 'empresa')
  assert.deepEqual({ tipo: negocio.tipo, nombre: negocio.nombre }, { tipo: 'empresa', nombre: 'Peludos E2E' })
  await page.close()
})

test('TI-1b: an independent-walker signup provisions an independiente and lands in the walker portal', async () => {
  const { page } = await signUp('Paseador', 'Paseos E2E')
  await acceptConditions(page) // new owners and clients accept the role notice or the business terms
  await page.waitForURL('**/app', { timeout: 30_000 })
  const { profile, negocio } = await cleanup(page)
  assert.equal(profile.rol, 'paseador')
  assert.deepEqual({ tipo: negocio.tipo, nombre: negocio.nombre }, { tipo: 'independiente', nombre: 'Paseos E2E' })
  await page.close()
})

test('an existing account can still log in and reaches its portal', async () => {
  const u = await tempUser()
  try {
    assert.equal((await u.client.rpc('provision_negocio', { p_rol: 'empresa', p_nombre: 'Login E2E', p_politica: POLITICA_VERSION })).error, null)
    const page = await newPage('/login')
    await page.getByPlaceholder('tu@correo.com').fill(u.email)
    await page.getByPlaceholder('••••••••').fill(u.password)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await acceptConditions(page) // new owners and clients accept the role notice or the business terms
    await page.waitForURL('**/empresa', { timeout: 30_000 })
    await page.close()
  } finally {
    await u.drop()
  }
})
