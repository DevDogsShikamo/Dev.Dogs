// M1 pickup point in a real browser against STAGING (geolocation mocked through the browser context): the dog's owner
// reads its location only on "Usar mi ubicación actual", sees the low-accuracy warning, adds a note and saves; the
// business owner sees it in its dog sheet and removes it after confirming. A throwaway dog of tenant A, removed in
// after().
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, credentials, ids, seed } from '../security/_actors.mjs'
import { dropDog } from '../security/_attacks.mjs'
import { startApp } from './_app.mjs'

const A = ids.negocios.A
const PORTAL = { OWNER: 'empresa', CLIENT: 'cliente' }
const DOG = 'Copito Recogida E2E'
const until = async (fn, ms = 30_000) => { const t = Date.now(); for (;;) { const v = await fn().catch(() => false); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 400)) } }
const stored = async () => (await admin().from('perro_recogida').select('lat,lng,nota').eq('perro_id', perro)).data
let app
let perro

async function cleanup() {
  for (const d of (await admin().from('perros').select('id').eq('negocio_id', A).eq('nombre', DOG)).data) await dropDog(d.id)
}
before(async () => {
  await seed()
  await cleanup()
  perro = (await admin().from('perros').insert({ negocio_id: A, nombre: DOG }).select('id').single()).data.id
  assert.equal((await admin().from('perro_duenos').insert({ perro_id: perro, dueno_id: ids.users.CLIENT, rol: 'principal', estado: 'activo' })).error, null)
  app = await startApp()
}, { timeout: 120_000 })
after(async () => {
  await cleanup()
  await app?.stop()
})

async function loginAs(actor) {
  const page = await app.newPage()
  await page.context().grantPermissions(['geolocation'], { origin: app.url })
  await page.context().setGeolocation({ latitude: 6.2442031, longitude: -75.5812119, accuracy: 120 })
  // Counts every location read: none may happen before the button is tapped.
  await page.addInitScript(() => {
    window.__geoReads = 0
    const g = navigator.geolocation
    for (const k of ['getCurrentPosition', 'watchPosition']) {
      const real = g[k].bind(g)
      g[k] = (...a) => { window.__geoReads++; return real(...a) }
    }
  })
  await page.goto(`${app.url}/login`)
  const { email, password } = credentials(actor)
  await page.getByPlaceholder('tu@correo.com').fill(email)
  await page.getByPlaceholder('••••••••').fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.waitForURL(`**/${PORTAL[actor]}`, { timeout: 60_000 })
  await page.getByRole('button', { name: 'Perfil', exact: true }).first().waitFor({ timeout: 60_000 })
  await page.waitForLoadState('networkidle')
  return page
}
const go = async (page, name) => {
  await page.getByRole('button', { name, exact: true }).filter({ visible: true }).first().click()
  await page.waitForLoadState('networkidle')
}

test('the owner saves the pickup point from its location; the business sees it and removes it', { timeout: 240_000 }, async () => {
  const client = await loginAs('CLIENT')
  await go(client, 'Mis perros')
  await client.locator('.dd-cat-item', { hasText: DOG }).getByRole('button', { name: 'Editar', exact: true }).click()
  const sheet = client.locator('.dd-cal-sheet .dd-recogida')
  await sheet.getByText('Sin punto de recogida', { exact: false }).waitFor({ timeout: 30_000 })
  assert.equal(await client.evaluate(() => window.__geoReads), 0, 'the location was read before the tap')
  await sheet.getByRole('button', { name: 'Usar mi ubicación actual' }).click()
  await sheet.getByText('Nueva ubicación: 6.24420, -75.58121 (± 120 m)', { exact: false }).waitFor({ timeout: 30_000 })
  await sheet.getByText('La precisión es baja (± 120 m)', { exact: false }).waitFor()
  assert.equal(await client.evaluate(() => window.__geoReads), 1)
  await sheet.getByPlaceholder(/Nota para el paseador/).fill('Portería torre 2')
  await client.context().route('https://www.openstreetmap.org/**', (r) => r.fulfill({ contentType: 'text/html', body: 'map' }))
  const popup = client.waitForEvent('popup')
  await sheet.getByRole('button', { name: 'Ver en el mapa', exact: true }).click()
  const map = await popup
  await map.waitForLoadState()
  assert.equal(map.url().split('#')[0].replace(/\/$/, ''), 'https://www.openstreetmap.org/?mlat=6.2442&mlon=-75.58121')
  await map.close()
  await sheet.getByRole('button', { name: 'Guardar', exact: true }).click()
  assert.ok(await until(async () => (await stored()).length === 1), 'saved')
  assert.deepEqual(await stored(), [{ lat: 6.2442, lng: -75.58121, nota: 'Portería torre 2' }])
  await sheet.getByText('Guardado: 6.2442, -75.58121', { exact: false }).waitFor({ timeout: 30_000 })
  await sheet.getByText('Nota: Portería torre 2').waitFor()
  await client.close()

  const owner = await loginAs('OWNER')
  await go(owner, 'Perros')
  await owner.locator('.dd-cat-item', { hasText: DOG }).getByRole('button', { name: 'Editar perro' }).click()
  const osheet = owner.locator('.dd-cal-sheet .dd-recogida')
  await osheet.getByText('Nota: Portería torre 2').waitFor({ timeout: 30_000 })
  await osheet.getByRole('button', { name: 'Quitar', exact: true }).click()
  assert.equal((await stored()).length, 1, 'nothing yet: it asks first')
  await osheet.getByRole('button', { name: 'Sí, quitar', exact: true }).click()
  assert.ok(await until(async () => (await stored()).length === 0), 'removed')
  await osheet.getByText('Sin punto de recogida', { exact: false }).waitFor({ timeout: 30_000 })
  assert.equal(await owner.evaluate(() => window.__geoReads), 0, 'the business never read its location')
  await owner.close()
})
