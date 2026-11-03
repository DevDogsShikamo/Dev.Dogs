// M2 offline walker map in a real browser against STAGING and the staging photo Worker (GET /m/, byte ranges):
// the company walker opens "Ver mapa" with today's walks, sees the stops (a dog with a pickup point and one without),
// one marker per point and the "you are here" dot (geolocation mocked through the context); the map prepares itself
// for offline use. Then the device goes offline and the app is reopened: the map still draws its tiles, from
// IndexedDB, with no request to the archive. Signing out deletes dd-mapa. A throwaway dog of tenant A, removed in
// after(). Needs FOTOS_URL (the staging Worker) in .env.test or the environment.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { admin, credentials, ids, seed, writePrestaciones } from '../security/_actors.mjs'
import { dropDog } from '../security/_attacks.mjs'
import { loadConfig } from '../security/_env.mjs'
import { startApp } from './_app.mjs'

const FOTOS = (() => { try { return loadConfig().fotosUrl } catch { return undefined } })()
const opts = FOTOS ? { timeout: 300_000 } : { skip: 'FOTOS_URL is not set (the staging photo Worker)' }
const A = ids.negocios.A
const DOG = 'Lupita Mapa E2E'
const POINT = { lat: 4.65331, lng: -74.08361 } // Bogotá, Teusaquillo
const today = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10) // Bogota day, as the app computes it
const until = async (fn, ms = 30_000) => { const t = Date.now(); for (;;) { const v = await fn().catch(() => false); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 400)) } }
let app
let perro
let walk

async function cleanup() {
  for (const d of (await admin().from('perros').select('id').eq('negocio_id', A).eq('nombre', DOG)).data) {
    await admin().from('prestaciones').delete().eq('perro_id', d.id)
    await dropDog(d.id)
  }
}
before(async () => {
  if (!FOTOS) return
  await seed() // p1: Rex (d1) walked today by WALKER_CO, without a pickup point
  await cleanup()
  await admin().from('perro_recogida').delete().eq('perro_id', ids.perros.d1)
  perro = (await admin().from('perros').insert({ negocio_id: A, nombre: DOG }).select('id').single()).data.id
  assert.equal((await admin().from('perro_recogida').insert({ perro_id: perro, negocio_id: A, ...POINT, nota: 'Portería verde' })).error, null)
  const { data } = await writePrestaciones([{ negocio_id: A, perro_id: perro, tipo: 'paseo', servicio_id: ids.servicios.paseoA, grupo_id: ids.grupos.g1, cuidador_id: ids.users.WALKER_CO, fecha: today(), estado: 'programado', precio_aplicado: 0, detalle: { hora: '07:30' } }])
  walk = data[0].id
  app = await startApp()
}, { timeout: 120_000 })
after(async () => {
  if (!FOTOS) return
  await cleanup()
  await app?.stop()
})

const mapRequests = (page) => page.requests.filter((r) => r.url.startsWith(`${FOTOS}/m/`))
const sheet = (page) => page.locator('.dd-mapa-sheet')
async function openMap(page) {
  await page.getByRole('button', { name: 'Ver mapa de recogidas de hoy' }).click({ timeout: 30_000 })
  await sheet(page).locator('.maplibregl-canvas').waitFor({ timeout: 60_000 })
}
// The rendered map is not a blank box: the screenshot of its canvas has real contrast (roads, blocks, labels).
async function drawn(page) {
  const png = await sheet(page).locator('.dd-mapa').screenshot()
  const { channels } = await sharp(png).stats()
  return channels.slice(0, 3).every((c) => c.stdev > 6)
}

test('the walker sees today\'s stops on the map, and it still renders offline from IndexedDB', opts, async () => {
  const page = await app.newPage()
  page.requests = []
  page.on('request', (r) => page.requests.push({ url: r.url(), range: r.headers().range }))
  const responses = []
  page.on('response', (r) => { if (r.url().startsWith(`${FOTOS}/m/`)) responses.push(r.status()) })
  await page.context().grantPermissions(['geolocation'], { origin: app.url })
  await page.context().setGeolocation({ latitude: POINT.lat + 0.002, longitude: POINT.lng + 0.001, accuracy: 15 })
  await page.goto(`${app.url}/login`)
  const { email, password } = credentials('WALKER_CO')
  await page.getByPlaceholder('tu@correo.com').fill(email)
  await page.getByPlaceholder('••••••••').fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.waitForURL('**/app', { timeout: 60_000 })
  await page.getByRole('button', { name: 'Perfil', exact: true }).first().waitFor({ timeout: 60_000 })
  await page.waitForLoadState('networkidle')
  assert.ok(await until(() => page.evaluate((d) => (localStorage.getItem('muten:grupos:paradas') || '').includes(d), DOG)), 'the stops are kept for offline use')

  await openMap(page)
  const stops = sheet(page).locator('.dd-mapa-parada')
  await stops.filter({ hasText: DOG }).getByText('Portería verde').waitFor({ timeout: 30_000 })
  await stops.filter({ hasText: 'Rex' }).getByText('Sin punto de recogida').waitFor()
  assert.equal(await stops.filter({ hasText: 'Rex' }).getByRole('button', { name: 'Cómo llegar' }).count(), 0, 'no directions without a point')
  const pins = sheet(page).locator('.dd-mapa-pin')
  assert.equal(await pins.count(), await sheet(page).getByRole('button', { name: 'Cómo llegar' }).count(), 'one marker per stop with a point')
  assert.equal(await pins.filter({ hasText: DOG }).count(), 1)
  await sheet(page).locator('.dd-mapa-yo').waitFor({ timeout: 30_000 })
  await sheet(page).getByText('© OpenStreetMap').waitFor()
  await sheet(page).getByText('Protomaps').first().waitFor()

  const estado = sheet(page).locator('.dd-mapa-estado')
  await estado.getByText(/^Mapa listo sin conexión \(\d+,\d MB\)$/).waitFor({ timeout: 120_000 })
  const size = (await estado.innerText()).match(/\((\d+,\d) MB\)/)[1]
  console.log(`# offline map for a 1.5 km box around the stops: ${size} MB (cap 40 MB)`)
  assert.ok(mapRequests(page).length > 0 && mapRequests(page).every((r) => /^bytes=\d+-\d+$/.test(r.range)), 'the archive is read in byte ranges')
  assert.ok(responses.length > 0 && responses.every((s) => s === 206), `ranged answers: ${responses}`)
  assert.ok(await until(() => drawn(page)), 'the map draws its tiles online')
  const stored = await page.evaluate(() => new Promise((ok) => {
    const r = indexedDB.open('dd-mapa')
    r.onsuccess = () => { const q = r.result.transaction('tiles').objectStore('tiles').count(); q.onsuccess = () => { r.result.close(); ok(q.result) } }
  }))
  assert.ok(stored > 0, 'tiles are in IndexedDB')

  // Directions (with signal) open openstreetmap.org for the dog's point.
  await page.context().route('https://www.openstreetmap.org/**', (r) => r.fulfill({ contentType: 'text/html', body: 'osm' }))
  const popup = page.waitForEvent('popup')
  await stops.filter({ hasText: DOG }).getByRole('button', { name: 'Cómo llegar' }).click()
  const osm = await popup
  assert.equal(osm.url(), `https://www.openstreetmap.org/directions?to=${POINT.lat},${POINT.lng}`)
  await osm.close()
  // The position never left the device: no request carries it.
  const mine = [String(POINT.lat + 0.002).slice(0, 6), String(POINT.lng + 0.001).slice(0, 7)]
  assert.deepEqual(page.requests.filter((r) => mine.some((m) => r.url.includes(m))), [], 'a request carried the device position')

  // Offline: reopen the app (service worker shell) and the map.
  await page.getByRole('button', { name: 'Cerrar mapa' }).click()
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
  await page.reload()
  await page.waitForLoadState('networkidle')
  await page.context().setOffline(true)
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  await page.reload()
  const before = mapRequests(page).length
  await openMap(page)
  await sheet(page).locator('.dd-mapa-estado').getByText(/^Mapa listo sin conexión/).waitFor({ timeout: 60_000 })
  assert.ok(await until(() => drawn(page)), 'the map draws its tiles offline, from IndexedDB')
  assert.equal(await sheet(page).locator('.dd-mapa-pin').filter({ hasText: DOG }).count(), 1, 'the stop is there offline')
  assert.equal(mapRequests(page).length, before, 'no tile request went to the network offline')

  // Signing out deletes the offline map.
  await page.context().setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.getByRole('button', { name: 'Cerrar mapa' }).click()
  await page.getByRole('button', { name: 'Perfil', exact: true }).first().click()
  await page.getByRole('button', { name: /Cerrar sesión/ }).click()
  await page.waitForURL('**/login', { timeout: 30_000 })
  assert.ok(await until(async () => !(await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))).includes('dd-mapa')), 'dd-mapa survives the sign-out')
  await page.close()
  assert.ok(walk)
})
