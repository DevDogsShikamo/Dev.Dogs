// S3 browser half: the independent walker's invite-client panel shows the code once (IV-1g),
// an employed walker has no panel, /unirse is the only join path and a business link without
// a code joins nothing (IV-7b), and a client joins with the code and the matching email.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { admin, as, credentials, ids, seed } from '../security/_actors.mjs'
import { autoconfirmSignup, startApp } from './_app.mjs'

let app
before(async () => { await seed(); app = await startApp() }, { timeout: 120_000 })
after(async () => {
  await admin().from('invitaciones').delete().in('negocio_id', Object.values(ids.negocios))
  await app?.stop()
})

const CODE = /^[0-9A-HJKMNP-TV-Z]{7}-[0-9A-HJKMNP-TV-Z]{7}$/
const mail = () => `dd-e2e-${randomUUID().slice(0, 8)}@example.com`

async function loginAs(actor, portal = 'app', nav = 'Perfil') {
  const page = await app.newPage()
  await page.goto(`${app.url}/login`)
  const { email, password } = credentials(actor)
  await page.getByPlaceholder('tu@correo.com').fill(email)
  await page.getByPlaceholder('••••••••').fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.waitForURL(`**/${portal}`, { timeout: 30_000 })
  // Pre-existing: while the profile loads, the role guard chain (/app -> /empresa -> /cliente -> /login -> /app)
  // recurses once and `muten dev` leaves its error overlay over the page. The app recovers underneath.
  await page.getByRole('button', { name: nav, exact: true }).waitFor()
  await page.evaluate(() => document.getElementById('__mu_err')?.remove())
  await page.getByRole('button', { name: nav, exact: true }).click()
  return page
}

const sessionUserId = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k)))).user.id)

test('IV-1g: the independent walker invites a client; the code is shown once, with the email, and never stored', async () => {
  const page = await loginAs('WALKER_IND')
  await page.getByRole('button', { name: 'Invitar clientes' }).click()
  const email = mail()
  await page.getByPlaceholder('correo@ejemplo.com').fill(email)
  await page.getByRole('button', { name: 'Crear invitación' }).click()
  const code = await page.getByText(CODE).textContent()
  assert.match(code, CODE)
  assert.ok(await page.getByText(email).first().isVisible(), 'the invitee email is shown with the code')
  const row = (await admin().from('invitaciones').select('negocio_id, rol, estado').eq('email', email).single()).data
  assert.deepEqual(row, { negocio_id: ids.negocios.I, rol: 'cliente', estado: 'pendiente' })

  await page.getByRole('button', { name: 'Listo' }).click() // dismiss: the code is gone for good
  assert.equal(await page.getByText(CODE).count(), 0)
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))
  assert.ok(!stored.includes(code) && !stored.includes(code.replace('-', '')), 'the code was persisted client-side')
  await page.getByText(email).first().waitFor({ timeout: 15_000 }) // the pending list shows the email, still no code

  await page.getByRole('button', { name: 'Revocar invitación' }).first().click()
  let estado
  for (let i = 0; i < 20 && estado !== 'revocada'; i++) {
    await new Promise((r) => setTimeout(r, 500))
    estado = (await admin().from('invitaciones').select('estado').eq('email', email).single()).data.estado
  }
  assert.equal(estado, 'revocada')
  await page.close()
})

test('IV-1g: an employed walker has no invite-client panel', async () => {
  const page = await loginAs('WALKER_CO')
  await page.getByRole('button', { name: 'Servicios' }).first().waitFor() // the profile section is on screen
  assert.equal(await page.getByRole('button', { name: 'Invitar clientes' }).count(), 0)
  await page.close()
})

test('IV-7b: /unirse without a code (or from a business link) joins nobody and explains an invitation is needed', async () => {
  for (const path of ['/unirse', '/unirse?negocio=dd-test-a']) {
    const page = await app.newPage()
    await page.goto(app.url + path)
    assert.ok(await page.getByText('Necesitás una invitación').first().isVisible())
    await page.getByPlaceholder('Ana Rondón').fill('Sin Codigo')
    await page.getByPlaceholder('tu@correo.com').fill(mail())
    await page.getByPlaceholder('••••••••').fill('Abcdefg1')
    assert.ok(await page.getByRole('button', { name: 'Unirme' }).isDisabled())
    await page.close()
  }
})

async function join(code, email) {
  const page = await app.newPage()
  await autoconfirmSignup(page)
  await page.goto(`${app.url}/unirse?codigo=${encodeURIComponent(code)}`)
  await page.getByPlaceholder('Ana Rondón').fill('Cliente E2E')
  await page.getByPlaceholder('tu@correo.com').fill(email)
  await page.getByPlaceholder('••••••••').fill('Abcdefg1')
  await page.getByRole('checkbox', { name: /He leído y acepto la Política de tratamiento de datos/ }).check()
  await page.getByRole('button', { name: 'Unirme' }).click()
  return page
}

test('a client joins tenant A through /unirse with the code and the invited email', async () => {
  const email = mail()
  const code = (await (await as('OWNER')).rpc('invitacion_crear', { p_rol: 'cliente', p_email: email })).data
  assert.match(code, CODE)
  const page = await join(code, email)
  await page.waitForURL('**/cliente', { timeout: 30_000 })
  const id = await sessionUserId(page)
  const profile = (await admin().from('profiles').select('rol, negocio_id').eq('id', id).single()).data
  await admin().auth.admin.deleteUser(id)
  assert.deepEqual(profile, { rol: 'cliente', negocio_id: ids.negocios.A })
  await page.close()
})

test('a code used with a different email is refused with a message and joins nobody', async () => {
  const code = (await (await as('OWNER')).rpc('invitacion_crear', { p_rol: 'cliente', p_email: mail() })).data
  assert.match(code, CODE) // valid-call precondition
  const page = await join(code, mail())
  await page.getByText('Invitación inválida').first().waitFor({ timeout: 30_000 })
  assert.equal(new URL(page.url()).pathname, '/unirse')
  const id = await sessionUserId(page)
  assert.equal((await admin().from('profiles').select('id').eq('id', id)).data.length, 0)
  await admin().auth.admin.deleteUser(id)
  await page.close()
})

test('the business owner invites an employed walker with the email; the walker joins tenant A as paseador', async () => {
  const page = await loginAs('OWNER', 'empresa', 'Paseadores')
  await page.getByRole('button', { name: 'Invitar', exact: true }).click()
  const email = mail()
  await page.getByPlaceholder('correo@ejemplo.com').fill(email)
  await page.getByRole('button', { name: 'Crear invitación' }).click()
  const code = await page.getByText(CODE).textContent()
  await page.getByRole('button', { name: 'Listo' }).click()
  assert.equal(await page.getByText(CODE).count(), 0)
  await page.close()
  const joined = await join(code, email)
  await joined.waitForURL('**/app', { timeout: 30_000 })
  const id = await sessionUserId(joined)
  const profile = (await admin().from('profiles').select('rol, negocio_id').eq('id', id).single()).data
  await admin().auth.admin.deleteUser(id)
  assert.deepEqual(profile, { rol: 'paseador', negocio_id: ids.negocios.A })
  await joined.close()
})
