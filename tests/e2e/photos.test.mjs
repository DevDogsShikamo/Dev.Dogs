// S5b walk photos in a real browser against STAGING and the staging photo Worker: the walker tags dogs and
// uploads a re-encoded photo (WP-3d, P5, retry), owners see only their dogs' photos as blob: images fetched
// with their bearer token (WP-4f, WP-5c), a lost photo leaves no trace (WP-7a), nothing about photos stays
// on the device or in a cache (R7-1), and upload, gallery and export run under the real CSP (CC-5b).
// Needs FOTOS_URL (the staging Worker) in .env.test or the environment.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { admin, as, credentials, ids, seed, writePrestaciones } from '../security/_actors.mjs'
import { loadConfig } from '../security/_env.mjs'
import { startApp } from './_app.mjs'

const FOTOS = (() => { try { return loadConfig().fotosUrl } catch { return undefined } })()
const opts = FOTOS ? { timeout: 180_000 } : { skip: 'FOTOS_URL is not set (the staging photo Worker)' }
const u = ids.users
const PORTAL = { CLIENT: 'cliente', COOWNER: 'cliente', CLIENT2: 'cliente', CLIENT3: 'cliente', WALKER_CO: 'app' }
const today = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10) // Bogota day, as the app computes it
const until = async (fn, ms = 20_000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 300)) } }
let app
let saved
let walks // prestacion ids: p1 (Rex, CLIENT + COOWNER), toby (CLIENT2), max (CLIENT3)
const fotos = [] // photo ids registered by the browser, in upload order

before(async () => {
  if (!FOTOS) return
  await seed()
  const db = admin()
  saved = (await db.from('prestaciones').select('fecha,estado').eq('id', ids.prestaciones.p1).single()).data
  await db.from('prestaciones').update({ fecha: today(), estado: 'en_curso' }).eq('id', ids.prestaciones.p1)
  const mk = (perro_id) => ({ negocio_id: ids.negocios.A, perro_id, tipo: 'paseo', servicio_id: ids.servicios.paseoA, grupo_id: ids.grupos.g1, cuidador_id: u.WALKER_CO, fecha: today(), estado: 'en_curso', precio_aplicado: 0, detalle: { hora: '08:00' } })
  const { data } = await writePrestaciones([mk(ids.perros.d3), mk(ids.perros.d5)])
  walks = { p1: ids.prestaciones.p1, toby: data[0].id, max: data[1].id }
  app = await startApp()
}, { timeout: 120_000 })
after(async () => {
  if (!FOTOS) return
  const db = admin()
  await db.from('paseo_fotos').delete().in('negocio_id', [ids.negocios.A])
  await db.from('prestaciones').delete().in('id', [walks.toby, walks.max])
  await db.from('prestaciones').update(saved).eq('id', ids.prestaciones.p1)
  await app?.stop()
})

async function loginAs(actor, from = app) {
  const page = await from.newPage()
  page.requests = []
  page.on('request', (r) => page.requests.push({ url: r.url(), method: r.method(), auth: r.headers().authorization }))
  await page.addInitScript(() => { window.addEventListener('toast', (e) => { (window.__toasts ||= []).push(e.detail) }) })
  await page.goto(`${from.url}/login`)
  const { email, password } = credentials(actor)
  await page.getByPlaceholder('tu@correo.com').fill(email)
  await page.getByPlaceholder('••••••••').fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.waitForURL(`**/${PORTAL[actor]}`, { timeout: 30_000 })
  await page.getByRole('button', { name: 'Perfil', exact: true }).waitFor({ timeout: 60_000 })
  await page.waitForLoadState('networkidle')
  return page
}
const toasts = (page) => page.evaluate(() => window.__toasts || [])
const bearerGets = (page) => page.requests.filter((r) => r.method === 'GET' && r.url.startsWith(`${FOTOS}/f/`))
const leaked = (page) => page.evaluate(() => JSON.stringify(Object.entries(localStorage)) + JSON.stringify(Object.entries(sessionStorage)))
const token = async (actor) => (await (await as(actor)).auth.getSession()).data.session.access_token

// A real 3000x2000 JPEG carrying an Exif (APP1) segment with GPS text, as a phone camera would.
async function phoneJpeg(color) {
  const base = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: color } }).jpeg().toBuffer()
  const payload = Buffer.concat([Buffer.from('Exif\0\0'), Buffer.from('GPSLatitude=4.6097;GPSLongitude=-74.0817')])
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload])
  return Buffer.concat([base.subarray(0, 2), app1, base.subarray(2)])
}
const markers = (b) => { // segment markers up to the start of scan
  const out = []
  for (let i = 2; i + 3 < b.length;) { const m = b[i + 1]; out.push(m); if (m === 0xda) break; i += 2 + ((b[i + 2] << 8) | b[i + 3]) }
  return out
}
async function openWalk(page) {
  await page.getByRole('button', { name: 'Abrir modo paseo' }).first().click()
  await page.locator('.dd-fotoup input[type=file]').waitFor({ state: 'attached' })
}
async function upload(page, buffer) {
  const done = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().startsWith(`${FOTOS}/f/`))
  await page.locator('.dd-fotoup input[type=file]').setInputFiles({ name: 'camera.jpg', mimeType: 'image/jpeg', buffer })
  const res = await done
  return { status: res.status(), id: res.url().split('/f/')[1] }
}
const tagged = async (id) => (await admin().from('paseo_foto_perros').select('prestacion_id').eq('foto_id', id)).data.map((t) => t.prestacion_id).sort()

test('WP-3d, P5: dogs of the walk are pre-ticked, the walker unticks one, and the stored photo is a resized JPEG with no APP1/Exif', opts, async () => {
  const page = await loginAs('WALKER_CO')
  assert.equal(await page.evaluate(() => globalThis.__ddFotos), FOTOS, 'the localhost hook sets the photo origin')
  await openWalk(page)
  for (const dog of ['Rex', 'Toby', 'Max']) assert.ok(await page.getByRole('checkbox', { name: dog }).isChecked(), `${dog} is pre-ticked`)
  await page.getByRole('checkbox', { name: 'Max' }).uncheck()
  const first = await upload(page, await phoneJpeg({ r: 200, g: 120, b: 60 }))
  assert.equal(first.status, 201)
  fotos.push(first.id)
  assert.deepEqual(await tagged(first.id), [walks.p1, walks.toby].sort(), 'tagged with the two ticked dogs only')
  // What the Worker stored carries no Exif/GPS and is within the limits.
  const stored = Buffer.from(await (await fetch(`${FOTOS}/f/${first.id}`, { headers: { authorization: `Bearer ${await token('WALKER_CO')}` } })).arrayBuffer())
  assert.deepEqual([stored[0], stored[1]], [0xff, 0xd8])
  assert.ok(!markers(stored).includes(0xe1), 'no APP1 segment')
  assert.ok(!stored.toString('latin1').includes('GPS'), 'no GPS text anywhere')
  assert.ok(stored.length <= 2 * 1024 * 1024)
  const meta = await sharp(stored).metadata()
  assert.deepEqual([meta.format, meta.width, meta.height, meta.exif], ['jpeg', 1600, 1067, undefined])
  // Second photo: Toby unticked too, so only Rex is tagged; Max stays unticked from before.
  await page.getByRole('checkbox', { name: 'Toby' }).uncheck()
  const second = await upload(page, await phoneJpeg({ r: 30, g: 90, b: 160 }))
  assert.equal(second.status, 201)
  fotos.push(second.id)
  assert.deepEqual(await tagged(second.id), [walks.p1])
  assert.ok(!/blob:|workers\.dev|"foto"|\/f\//.test(await leaked(page)), 'no photo URL or blob reference on the device')
  await page.close()
})

test('retry: an upload that fails stays pending and Reintentar sends the same photo under the same id', opts, async () => {
  const page = await loginAs('WALKER_CO')
  await openWalk(page)
  const before = (await admin().from('paseo_fotos').select('id')).data.length
  let failed
  await page.route(`${FOTOS}/f/*`, (route) => {
    if (route.request().method() !== 'PUT' || failed) return route.continue()
    failed = route.request().url()
    return route.abort('failed')
  })
  await page.locator('.dd-fotoup input[type=file]').setInputFiles({ name: 'camera.jpg', mimeType: 'image/jpeg', buffer: await phoneJpeg({ r: 10, g: 200, b: 10 }) })
  assert.ok(await until(async () => (await toasts(page)).some((t) => /Reintentar/.test(t))), 'the failure is reported')
  const pending = (await admin().from('paseo_fotos').select('id,estado').eq('id', failed.split('/f/')[1]).single()).data
  assert.equal(pending.estado, 'pendiente')
  const done = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().startsWith(`${FOTOS}/f/`))
  await page.getByRole('button', { name: /Reintentar/ }).click()
  const res = await done
  assert.equal(res.status(), 201)
  assert.equal(res.url(), failed, 'same photo id')
  assert.equal((await admin().from('paseo_fotos').select('id')).data.length, before + 1, 'one registration for both attempts')
  assert.equal((await admin().from('paseo_fotos').select('estado').eq('id', pending.id).single()).data.estado, 'lista')
  await admin().from('paseo_fotos').delete().eq('id', pending.id)
  await page.close()
})

async function gallery(actor, expected) {
  const page = await loginAs(actor)
  await page.getByRole('button', { name: 'Agenda', exact: true }).filter({ visible: true }).first().click()
  await page.getByRole('heading', { name: 'Agenda de paseos' }).waitFor()
  if (expected) await page.locator('img.dd-paseo-foto').nth(expected - 1).waitFor({ timeout: 30_000 })
  else await page.waitForTimeout(3000) // nothing to wait for: give the fetches time to (not) happen
  return page
}

test('WP-4f, WP-5c: each owner sees only the photos tagged with their dogs, as blob: images fetched with their bearer token', opts, async () => {
  for (const [actor, n] of [['CLIENT', 2], ['COOWNER', 2], ['CLIENT2', 1]]) {
    const page = await gallery(actor, n)
    const srcs = await page.locator('img.dd-paseo-foto').evaluateAll((els) => els.map((e) => e.getAttribute('src')))
    assert.equal(srcs.length, n, `${actor}: photos shown`)
    for (const s of srcs) assert.match(s, /^blob:/, `${actor}: image source`)
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('*')].some((e) => [...e.attributes].some((a) => /\/f\/[0-9a-f-]{36}/.test(a.value)))), false, `${actor}: a photo URL is in the page`)
    const gets = bearerGets(page)
    assert.ok(gets.length >= n && gets.every((g) => /^Bearer \S+/.test(g.auth)), `${actor}: every photo read carries a bearer token`)
    assert.ok(await page.locator('img.dd-paseo-foto').evaluateAll((els) => els.every((e) => e.complete && e.naturalWidth > 0)), `${actor}: no broken image`)
    assert.ok(!/blob:|workers\.dev|\/f\//.test(await leaked(page)), `${actor}: nothing persisted`)
    await page.close()
  }
  // Same group, untagged: Max's owner sees the walk and no photo, and never asked for one.
  const other = await gallery('CLIENT3', 0)
  assert.equal(await other.locator('img.dd-paseo-foto').count(), 0)
  assert.deepEqual(bearerGets(other), [])
  await other.close()
  // The business owner is not in the audience.
  for (const id of fotos) assert.equal((await fetch(`${FOTOS}/f/${id}`, { headers: { authorization: `Bearer ${await token('OWNER')}` } })).status, 404)
})

test('WP-7a: an expired photo and a photo whose file is gone leave no broken image and no toast', opts, async () => {
  const db = admin()
  await db.from('paseo_fotos').update({ expires_at: new Date(Date.now() - 864e5).toISOString() }).eq('id', fotos[0])
  const lost = (await db.from('paseo_fotos').insert({ negocio_id: ids.negocios.A, subido_por: u.WALKER_CO, estado: 'lista', bytes: 1000 }).select('id').single()).data.id
  await db.from('paseo_foto_perros').insert({ foto_id: lost, prestacion_id: walks.p1, perro_id: ids.perros.d1, subido_por: u.WALKER_CO })
  const page = await gallery('CLIENT', 1) // only the second photo survives
  assert.equal(await page.locator('img.dd-paseo-foto').count(), 1)
  assert.ok(await page.locator('img.dd-paseo-foto').evaluate((e) => e.complete && e.naturalWidth > 0), 'the remaining image is real')
  assert.ok(bearerGets(page).some((g) => g.url.endsWith(lost)), 'precondition: the lost photo was requested and answered 404')
  assert.deepEqual(await toasts(page), [])
  await page.close()
  await db.from('paseo_fotos').delete().eq('id', lost)
})

test('R7-1: no service-worker cache holds a photo, and signing out deletes photo caches', opts, async () => {
  const page = await gallery('CLIENT', 1)
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
  await page.evaluate(() => caches.open('fotos-probe').then((c) => c.put('/probe', new Response('x'))))
  const held = () => page.evaluate(async () => { const out = []; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(r.url); return out })
  assert.ok(!(await held()).some((url) => url.includes('workers.dev')), 'a photo response was cached')
  await page.getByRole('button', { name: 'Perfil', exact: true }).click()
  await page.getByRole('button', { name: /Cerrar sesión/ }).click()
  await page.waitForURL('**/login')
  // The sign-out navigates to /login: an evaluate that lands mid-navigation throws ("Execution context was
  // destroyed"), which is a retry, not an answer.
  const left = () => page.evaluate(() => caches.keys().then((ks) => ks.filter((k) => k.startsWith('fotos')))).catch(() => null)
  const gone = await until(async () => { const ks = await left(); return ks && ks.length === 0 ? ['gone'] : null })
  assert.deepEqual(gone, ['gone'], `photo caches left: ${await left()}`)
  await page.close()
})

test('CC-5b: photo upload, gallery and export run under the real CSP with no violation', opts, async () => {
  const bundle = await startApp({ bundle: true })
  try {
    const violations = []
    const watch = async (actor) => {
      const page = await bundle.newPage({ csp: true })
      await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)) })
      page.on('console', (m) => { if (/content security policy/i.test(m.text())) violations.push(m.text()) })
      page.requests = []
      page.on('request', (r) => page.requests.push({ url: r.url(), method: r.method(), auth: r.headers().authorization }))
      await page.goto(`${bundle.url}/login`)
      const { email, password } = credentials(actor)
      await page.getByPlaceholder('tu@correo.com').fill(email)
      await page.getByPlaceholder('••••••••').fill(password)
      await page.getByRole('button', { name: 'Entrar', exact: true }).click()
      await page.waitForURL(`**/${PORTAL[actor]}`, { timeout: 30_000 })
      await page.getByRole('button', { name: 'Perfil', exact: true }).waitFor()
      await page.waitForLoadState('networkidle')
      return page
    }
    const walker = await watch('WALKER_CO')
    await openWalk(walker)
    assert.equal((await upload(walker, await phoneJpeg({ r: 90, g: 90, b: 200 }))).status, 201, 'upload through connect-src')
    violations.push(...(await walker.evaluate(() => window.__csp)))
    await walker.close()

    const client = await watch('CLIENT')
    await client.getByRole('button', { name: 'Agenda', exact: true }).filter({ visible: true }).first().click()
    await client.locator('img.dd-paseo-foto').nth(1).waitFor({ timeout: 30_000 }) // 2 photos: the one above + the surviving one
    assert.ok(await client.locator('img.dd-paseo-foto').evaluateAll((els) => els.every((e) => e.src.startsWith('blob:') && e.naturalWidth > 0)), 'blob: images load under img-src')
    await client.getByRole('button', { name: 'Mis perros', exact: true }).filter({ visible: true }).first().click()
    await client.getByRole('button', { name: /Estado de cuenta/ }).first().click()
    await client.getByText('Este documento no es una factura electrónica.').waitFor()
    for (const name of ['CSV', 'Excel']) {
      const download = client.waitForEvent('download')
      await client.getByRole('button', { name }).click()
      assert.match((await download).suggestedFilename(), /^estado-de-cuenta-.+\.(csv|xlsx)$/, `${name} export`)
    }
    violations.push(...(await client.evaluate(() => window.__csp)))
    await client.close()
    assert.deepEqual(violations, [], 'CSP violations')
  } finally {
    await bundle.stop()
  }
})
