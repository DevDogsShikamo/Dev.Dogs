// F5b data polish in a real browser against STAGING and the staging photo Worker: a walker without signal reports an
// incident, it waits in the outbox and is stored once when the connection returns (a second replay adds nothing); the
// business sees its incidents 50 at a time with "Ver más"; the business uploads a dog's profile photo and the dog's
// owner sees it; the owner edits its own dog. A queued incident the server refuses stays visible with its text and
// what failed. "Quitar foto" and removing a dog delete the object. Throwaway dogs and incidents in tenant A, removed
// in after(). Needs FOTOS_URL (the staging Worker) in .env.test or the environment.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { admin, as, credentials, day, ids, seed } from '../security/_actors.mjs'
import { dropDog } from '../security/_attacks.mjs'
import { loadConfig } from '../security/_env.mjs'
import { startApp } from './_app.mjs'

const FOTOS = (() => { try { return loadConfig().fotosUrl } catch { return undefined } })()
const live = FOTOS ? { timeout: 180_000 } : { skip: 'FOTOS_URL is not set (the staging photo Worker)' }
const A = ids.negocios.A
const u = ids.users
const p1 = ids.prestaciones.p1 // Rex (CLIENT + COOWNER), walked by WALKER_CO
const PORTAL = { OWNER: 'empresa', WALKER_CO: 'app', CLIENT: 'cliente' }
const DOG = 'Copito Datos E2E'
const MARK = 'Datos E2E lote'
const until = async (fn, ms = 30_000) => { const t = Date.now(); for (;;) { const v = await fn().catch(() => false); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 400)) } }
let app
let saved
let perro

// The caller's token against the staging Worker: uploads and removes the throwaway dogs' objects.
const worker = async (method, dog, body) => {
  const { data } = await (await as('OWNER')).auth.getSession()
  return fetch(`${FOTOS}/p/${dog}`, { method, body, headers: { authorization: `Bearer ${data.session.access_token}`, ...(body && { 'content-type': 'image/jpeg' }) } })
}
const testJpeg = () => sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 40, g: 120, b: 200 } } }).jpeg().toBuffer()

async function cleanup() {
  const db = admin()
  await db.from('incidentes').delete().eq('prestacion_id', p1)
  await db.from('incidentes').delete().like('descripcion', `${MARK}%`)
  for (const d of (await db.from('perros').select('id').eq('negocio_id', A).like('nombre', 'Copito%E2E')).data) {
    await db.from('perros').update({ activo: true }).eq('id', d.id)
    if (FOTOS) await worker('DELETE', d.id)
    await db.from('perro_duenos').delete().eq('perro_id', d.id)
    await dropDog(d.id)
  }
}
before(async () => {
  await seed()
  await cleanup()
  const db = admin()
  saved = (await db.from('prestaciones').select('fecha,estado').eq('id', p1).single()).data
  await db.from('prestaciones').update({ fecha: day(0), estado: 'en_curso' }).eq('id', p1)
  perro = (await db.from('perros').insert({ negocio_id: A, nombre: DOG, raza: 'Mestizo' }).select('id').single()).data.id
  assert.equal((await db.from('perro_duenos').insert({ perro_id: perro, dueno_id: u.CLIENT, rol: 'principal', estado: 'activo' })).error, null)
  app = await startApp()
}, { timeout: 120_000 })
after(async () => {
  await cleanup()
  await admin().from('prestaciones').update(saved).eq('id', p1)
  await app?.stop()
})

async function loginAs(actor) {
  const page = await app.newPage()
  // Chromium reports navigator.onLine === true on a page while the context is offline; the flag makes the page see
  // what a real offline browser reports (same hook as tests/e2e/hardening.test.mjs).
  await page.addInitScript(() => {
    const real = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine')
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get() { return sessionStorage.getItem('pw_offline') ? false : real.get.call(this) } })
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
async function goOffline(page) {
  await page.context().setOffline(true)
  await page.evaluate(() => { sessionStorage.setItem('pw_offline', '1'); window.dispatchEvent(new Event('offline')) })
}
async function goOnline(page) {
  await page.evaluate(() => sessionStorage.removeItem('pw_offline'))
  await page.context().setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
}
const outbox = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('dd:outbox') || '[]'))
const stored = async () => (await admin().from('incidentes').select('id,tipo,reportado_por').eq('prestacion_id', p1)).data

test('offline: the walker reports an incident without signal; it is stored once when the connection returns', { timeout: 180_000 }, async () => {
  const page = await loginAs('WALKER_CO')
  await page.getByRole('button', { name: 'Abrir modo paseo' }).first().click()
  await goOffline(page)
  await page.getByRole('button', { name: 'Incidente', exact: true }).click()
  const form = page.getByRole('group', { name: 'Reportar incidente' })
  await form.getByRole('button', { name: 'Pelea', exact: true }).click()
  await form.getByLabel('Descripción del incidente').fill('Se enfrentó con otro perro en el parque, sin heridas.')
  await form.getByRole('button', { name: 'Reportar', exact: true }).click()
  const queued = await until(async () => (await outbox(page)).length === 1 && outbox(page))
  assert.ok(queued, 'the report waits in the outbox')
  assert.equal(queued[0].name, 'incidente_reportar')
  assert.match(queued[0].params.p_id, /^[0-9a-f-]{36}$/, 'with its client-generated id')
  assert.deepEqual(await stored(), [], 'nothing reached the server while offline')

  await goOnline(page)
  assert.ok(await until(async () => (await stored()).length === 1 && (await outbox(page)).length === 0), 'synced and the outbox emptied')
  const [row] = await stored()
  assert.deepEqual(row, { id: queued[0].params.p_id, tipo: 'pelea', reportado_por: u.WALKER_CO })

  // A replay of the same op (a reply lost to the network leaves it queued after it was applied) adds nothing.
  await page.evaluate((op) => { localStorage.setItem('dd:outbox', JSON.stringify([op])); window.dispatchEvent(new Event('online')) }, queued[0])
  assert.ok(await until(async () => (await outbox(page)).length === 0), 'the replay left the queue')
  assert.equal((await stored()).length, 1, 'still one incident')
  await page.close()
})

test('a queued incident the server refuses is not lost: its text stays visible with what failed until discarded', { timeout: 180_000 }, async () => {
  const TEXT = 'Se perdió en el parque cerca de la fuente, sigo buscándolo.'
  const had = (await stored()).length // the report of the test above
  const page = await loginAs('WALKER_CO')
  await page.getByRole('button', { name: 'Abrir modo paseo' }).first().click()
  await goOffline(page)
  await page.getByRole('button', { name: 'Incidente', exact: true }).click()
  const form = page.getByRole('group', { name: 'Reportar incidente' })
  await form.getByRole('button', { name: 'Pérdida', exact: true }).click()
  await form.getByLabel('Descripción del incidente').fill(TEXT)
  await form.getByRole('button', { name: 'Reportar', exact: true }).click()
  assert.ok(await until(async () => (await outbox(page)).length === 1), 'queued')

  await admin().from('prestaciones').update({ fecha: day(-8) }).eq('id', p1) // the walk left the window while offline
  try {
    await goOnline(page)
    const banner = page.locator('.dd-netbar-fallo', { hasText: TEXT })
    await banner.waitFor({ timeout: 30_000 })
    await banner.getByText(/7 días/).waitFor()
    assert.deepEqual(await outbox(page), [], 'the refused op left the queue')
    assert.equal((await stored()).length, had, 'nothing stored')
    await page.reload()
    await banner.waitFor({ timeout: 30_000 }) // still there after a reload
    await banner.getByRole('button', { name: 'Descartar', exact: true }).click()
    await banner.waitFor({ state: 'detached', timeout: 10_000 })
    await page.reload()
    await page.getByRole('button', { name: 'Perfil', exact: true }).first().waitFor({ timeout: 60_000 })
    assert.equal(await banner.count(), 0, 'discarded for good')
  } finally {
    await admin().from('prestaciones').update({ fecha: day(0) }).eq('id', p1)
  }
  await page.close()
})

test('the business sees 50 incidents and "Ver más" brings the next page', { timeout: 180_000 }, async () => {
  const db = admin()
  const t0 = Date.now()
  const rows = Array.from({ length: 55 }, (_, i) => ({
    negocio_id: A, perro_id: ids.perros.d2, tipo: 'otro', descripcion: `${MARK} ${String(i).padStart(2, '0')}: revisión de rutina.`,
    reportado_por: u.OWNER, created_at: new Date(t0 - i * 60_000).toISOString(),
  }))
  assert.equal((await db.from('incidentes').insert(rows)).error, null)
  const { count } = await db.from('incidentes').select('id', { count: 'exact', head: true }).eq('negocio_id', A)
  const page = await loginAs('OWNER')
  await go(page, 'Incidentes')
  const items = page.locator('.dd-sec .dd-cat-list .dd-cat-item')
  await page.getByText(`${MARK} 00`).waitFor({ timeout: 30_000 })
  assert.equal(await items.count(), 50, 'first page')
  assert.equal(await page.getByText(`${MARK} 54`).count(), 0, 'the oldest is not on the first page')
  await page.getByRole('button', { name: 'Ver más', exact: true }).click()
  await page.getByText(`${MARK} 54`).waitFor({ timeout: 30_000 })
  assert.equal(await items.count(), Math.min(count, 100))
  if (count <= 100) assert.equal(await page.getByRole('button', { name: 'Ver más', exact: true }).count(), 0, 'no more pages')
  await page.close()
})

test('the business uploads a dog photo; the dog owner sees it in Mis perros', live, async () => {
  const page = await loginAs('OWNER')
  await go(page, 'Perros')
  await page.locator('.dd-cat-item', { hasText: DOG }).getByRole('button', { name: 'Editar perro' }).click()
  const jpg = await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 40, g: 120, b: 200 } } }).jpeg().toBuffer()
  const put = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url() === `${FOTOS}/p/${perro}`, { timeout: 30_000 })
  await page.locator('.dd-cal-sheet .dd-fotoup input[type=file]').setInputFiles({ name: 'perro.jpg', mimeType: 'image/jpeg', buffer: jpg })
  assert.equal((await put).status(), 201)
  assert.ok((await admin().from('perros').select('foto_at').eq('id', perro).single()).data.foto_at, 'foto_at set')
  await page.getByRole('button', { name: 'Cerrar' }).first().click()
  const img = page.locator('.dd-cat-item', { hasText: DOG }).locator(`img[alt="${DOG}"]`)
  await img.waitFor({ timeout: 30_000 })
  assert.match(await img.getAttribute('src'), /^blob:/, 'an in-memory blob, never a URL with a permission')
  await page.close()

  const client = await loginAs('CLIENT')
  await go(client, 'Mis perros')
  const mine = client.locator('.dd-cat-item', { hasText: DOG }).locator(`img[alt="${DOG}"]`)
  await mine.waitFor({ timeout: 30_000 })
  assert.match(await mine.getAttribute('src'), /^blob:/)
  await client.close()
})

test('"Quitar foto" asks first and removes the object', live, async () => {
  assert.equal((await worker('PUT', perro, await testJpeg())).status, 201)
  const page = await loginAs('OWNER')
  await go(page, 'Perros')
  await page.locator('.dd-cat-item', { hasText: DOG }).getByRole('button', { name: 'Editar perro' }).click()
  const sheet = page.locator('.dd-cal-sheet')
  await sheet.getByRole('button', { name: 'Quitar foto', exact: true }).click({ timeout: 30_000 })
  assert.ok((await admin().from('perros').select('foto_at').eq('id', perro).single()).data.foto_at, 'nothing yet: it asks first')
  const del = page.waitForResponse((r) => r.request().method() === 'DELETE' && r.url() === `${FOTOS}/p/${perro}`, { timeout: 30_000 })
  await sheet.getByRole('button', { name: 'Sí, quitar', exact: true }).click()
  assert.equal((await del).status(), 204)
  assert.equal((await admin().from('perros').select('foto_at').eq('id', perro).single()).data.foto_at, null)
  await sheet.getByRole('button', { name: 'Quitar foto', exact: true }).waitFor({ state: 'detached', timeout: 30_000 })
  await page.close()
})

test('removing a dog with a photo deletes the object first', live, async () => {
  const db = admin()
  const name = 'Copito Baja E2E'
  const id = (await db.from('perros').insert({ negocio_id: A, nombre: name }).select('id').single()).data.id
  assert.equal((await worker('PUT', id, await testJpeg())).status, 201)
  const page = await loginAs('OWNER')
  await go(page, 'Perros')
  const item = page.locator('.dd-cat-item', { hasText: name })
  await item.getByRole('button', { name: 'Eliminar perro' }).click()
  await page.getByRole('button', { name: 'Sí, eliminar', exact: true }).click()
  assert.ok(await until(async () => (await db.from('perros').select('activo').eq('id', id).single()).data.activo === false), 'removed')
  assert.equal((await db.from('perros').select('foto_at').eq('id', id).single()).data.foto_at, null)
  await page.close()
  // The object itself is gone: back on and marked, GET still finds nothing.
  await db.from('perros').update({ activo: true, foto_at: new Date().toISOString() }).eq('id', id)
  assert.equal((await worker('GET', id)).status, 404)
})

test('the owner edits its own dog from Mis perros', { timeout: 180_000 }, async () => {
  const page = await loginAs('CLIENT')
  await go(page, 'Mis perros')
  await page.locator('.dd-cat-item', { hasText: DOG }).getByRole('button', { name: 'Editar', exact: true }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByRole('heading', { name: 'Editar perro' }).waitFor()
  await sheet.getByLabel(/^raza$/i).fill('Pug')
  await sheet.getByLabel(/^tips$/i).fill('Toma agua cada media hora.')
  await sheet.getByRole('button', { name: 'Guardar perro' }).click()
  assert.ok(await until(async () => (await admin().from('perros').select('raza').eq('id', perro).single()).data.raza === 'Pug'), 'saved')
  const row = (await admin().from('perros').select('nombre,raza,tips,negocio_id').eq('id', perro).single()).data
  assert.deepEqual(row, { nombre: DOG, raza: 'Pug', tips: 'Toma agua cada media hora.', negocio_id: A })
  await page.locator('.dd-cat-item', { hasText: DOG }).getByText(/Pug/).waitFor({ timeout: 30_000 })
  await page.close()
})
