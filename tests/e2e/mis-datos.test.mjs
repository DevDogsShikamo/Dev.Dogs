// "Mis datos" in a real browser against STAGING (muten dev): every portal links to /mis-datos; a client
// corrects their phone, downloads their own data as JSON (their email, not another actor's), files a
// "supresión" request and sees it pending with its due date; the landing footer "Contacto" leads to the
// rights section of the policy.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { admin, credentials, ids, seed } from '../security/_actors.mjs'
import { startApp } from './_app.mjs'

const u = ids.users
const DETALLE = 'Quiero que eliminen mi cuenta y mis datos.'
let app

const clean = () => admin().from('solicitudes_datos').delete().eq('user_id', u.CLIENT)
before(async () => {
  await seed()
  assert.equal((await clean()).error, null)
  app = await startApp()
}, { timeout: 120_000 })
after(async () => {
  await clean()
  await admin().from('contactos').update({ telefono: null }).eq('user_id', u.CLIENT)
  await app?.stop()
})

async function login(actor, portal) {
  const page = await app.newPage()
  const { email, password } = credentials(actor)
  await page.goto(`${app.url}/login`)
  await page.getByPlaceholder('tu@correo.com').fill(email)
  await page.getByPlaceholder('••••••••').fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.waitForURL(`**/${portal}`, { timeout: 60_000 })
  await page.waitForLoadState('networkidle')
  return page
}
// Portal -> Perfil -> "Mis datos"; waits until the page shows the user's own email.
async function openMisDatos(actor, portal) {
  const page = await login(actor, portal)
  await page.getByRole('button', { name: 'Perfil', exact: true }).filter({ visible: true }).first().click()
  await page.getByRole('link', { name: 'Mis datos' }).click()
  await page.waitForURL('**/mis-datos')
  await page.getByText(`Correo: ${credentials(actor).email}`).waitFor({ timeout: 30_000 })
  return page
}

for (const [actor, portal] of [['WALKER_CO', 'app'], ['OWNER', 'empresa'], ['CLIENT', 'cliente']]) {
  test(`${actor}: the "Mis datos" entry of the ${portal} portal opens the page with their own data, and "Volver" returns`, async () => {
    const page = await openMisDatos(actor, portal)
    assert.equal(await page.getByRole('heading', { name: 'Mis datos', level: 1 }).isVisible(), true)
    await page.getByRole('link', { name: '← Volver' }).click()
    await page.waitForURL(`**/${portal}`)
    await page.close()
  })
}

test('a client corrects the phone, downloads only their own data and files a supresión request that is listed as pending with its due date', async () => {
  const page = await openMisDatos('CLIENT', 'cliente')
  await page.getByPlaceholder('+57 300 000 0000').fill('3001112233')
  await page.getByRole('button', { name: 'Guardar teléfono' }).click()
  await page.getByText('Teléfono: 3001112233').waitFor({ timeout: 30_000 })

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Descargar mis datos' }).click()
  const file = await download
  assert.equal(file.suggestedFilename(), 'mis-datos-devdogs.json')
  const raw = await readFile(await file.path(), 'utf8')
  const data = JSON.parse(raw)
  assert.deepEqual([data.cuenta.email, data.telefono, data.perfil.rol], [credentials('CLIENT').email, '3001112233', 'cliente'])
  for (const other of ['CLIENT2', 'COOWNER', 'WALKER_CO', 'OWNER']) assert.ok(!raw.includes(credentials(other).email), other)
  assert.ok(!raw.includes('Toby'), 'another client dog')

  await page.getByRole('button', { name: 'Supresión de la cuenta' }).click()
  await page.getByPlaceholder(/Detalle de tu solicitud/).fill(DETALLE)
  await page.getByRole('button', { name: 'Enviar solicitud' }).click()
  await page.getByText('Tu solicitud quedó registrada. Te responderemos dentro del plazo legal.').waitFor({ timeout: 30_000 })
  const row = page.locator('article.md-sol')
  await row.first().waitFor({ timeout: 30_000 })
  const [stored] = (await admin().from('solicitudes_datos').select('tipo, detalle, estado, vence_at').eq('user_id', u.CLIENT)).data
  assert.deepEqual([stored.tipo, stored.detalle, stored.estado], ['supresion', DETALLE, 'pendiente'])
  const vence = new Date(`${stored.vence_at}T12:00:00-05:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' })
  const text = await row.innerText()
  assert.match(text, /Supresión de la cuenta/)
  assert.match(text, /Pendiente/)
  assert.ok(text.includes(`Vence el ${vence}`), `${text} lacks the due date ${vence}`)
  assert.equal(await row.count(), 1)
  await page.close()
})

test('the landing footer "Contacto" leads to the rights section of the policy, which points to "Mis datos"', async () => {
  const page = await app.newPage()
  await page.goto(`${app.url}/`)
  await page.locator('footer').getByRole('link', { name: 'Contacto' }).click()
  await page.waitForURL('**/privacidad#derechos')
  const section = page.locator('section#derechos')
  await section.waitFor({ timeout: 30_000 })
  assert.match(await section.innerText(), /Mis datos/)
  await page.waitForFunction(() => { const r = document.getElementById('derechos').getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight }, null, { timeout: 10_000 })
  await page.close()
})
