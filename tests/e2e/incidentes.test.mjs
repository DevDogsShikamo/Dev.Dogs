// Batch C2 in a real browser against STAGING and the staging photo Worker: the walker reports an incident from
// modo paseo, which retains the walk photo and copies it to r/ (POST /retener); the dog owner sees it in the bell
// and reports the photo, which then disappears for him and stays for the business owner.
// Needs FOTOS_URL (the staging Worker) in .env.test or the environment.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { admin, as, credentials, ids, seed } from '../security/_actors.mjs'
import { loadConfig } from '../security/_env.mjs'
import { startApp } from './_app.mjs'

const FOTOS = (() => { try { return loadConfig().fotosUrl } catch { return undefined } })()
const opts = FOTOS ? { timeout: 180_000 } : { skip: 'FOTOS_URL is not set (the staging photo Worker)' }
const PORTAL = { CLIENT: 'cliente', WALKER_CO: 'app' }
const today = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10) // Bogota day
const until = async (fn, ms = 20_000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 300)) } }
const token = async (actor) => (await (await as(actor)).auth.getSession()).data.session.access_token
const p1 = ids.prestaciones.p1 // Rex (CLIENT + COOWNER), walked by WALKER_CO
let app
let saved
let foto

before(async () => {
  if (!FOTOS) return
  await seed()
  const db = admin()
  saved = (await db.from('prestaciones').select('fecha,estado').eq('id', p1).single()).data
  await db.from('prestaciones').update({ fecha: today(), estado: 'en_curso' }).eq('id', p1)
  // A photo of the walk, uploaded through the Worker before the incident.
  foto = (await (await as('WALKER_CO')).rpc('foto_registrar', { p_prestaciones: [p1] })).data
  const jpg = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 60, b: 60 } } }).jpeg().toBuffer()
  const up = await fetch(`${FOTOS}/f/${foto}`, { method: 'PUT', headers: { authorization: `Bearer ${await token('WALKER_CO')}`, 'content-type': 'image/jpeg' }, body: jpg })
  assert.equal(up.status, 201, await up.text())
  app = await startApp()
}, { timeout: 120_000 })
after(async () => {
  if (!FOTOS) return
  const db = admin()
  await db.from('fotos_reportes').delete().eq('foto_id', foto)
  await db.from('incidentes').delete().eq('prestacion_id', p1)
  await db.from('paseo_fotos').delete().eq('id', foto)
  await db.from('prestaciones').update(saved).eq('id', p1)
  await app?.stop()
})

async function loginAs(actor) {
  const page = await app.newPage()
  await page.goto(`${app.url}/login`)
  const { email, password } = credentials(actor)
  await page.getByPlaceholder('tu@correo.com').fill(email)
  await page.getByPlaceholder('••••••••').fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.waitForURL(`**/${PORTAL[actor]}`, { timeout: 30_000 })
  await page.getByRole('button', { name: 'Perfil', exact: true }).waitFor({ timeout: 60_000 })
  await page.waitForLoadState('networkidle')
  return page
}

test('the walker reports an injury from modo paseo; the walk photo is retained and copied to r/', opts, async () => {
  const page = await loginAs('WALKER_CO')
  await page.getByRole('button', { name: 'Abrir modo paseo' }).first().click()
  await page.getByRole('button', { name: 'Incidente', exact: true }).click()
  const form = page.getByRole('group', { name: 'Reportar incidente' })
  assert.ok(await form.getByRole('button', { name: 'Reportar', exact: true }).isDisabled(), 'locked until type and text are given')
  await form.getByRole('button', { name: 'Lesión', exact: true }).click()
  await form.getByLabel('Descripción del incidente').fill('Se cortó una almohadilla con un vidrio en el parque.')
  const retener = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().startsWith(`${FOTOS}/retener/`), { timeout: 30_000 })
  await form.getByRole('button', { name: 'Reportar', exact: true }).click()
  const res = await retener
  assert.equal(res.status(), 200)
  // The body is not read here (Playwright stalls on it behind the service worker); the deployed twin
  // (tests/security/s5-photos.test.mjs) checks { copiadas: 1 }.
  const [inc] = (await admin().from('incidentes').select('tipo, perro_id, reportado_por').eq('prestacion_id', p1)).data
  assert.deepEqual(inc, { tipo: 'lesion', perro_id: ids.perros.d1, reportado_por: ids.users.WALKER_CO })
  assert.equal((await admin().from('paseo_fotos').select('retener').eq('id', foto).single()).data.retener, true)
  await page.close()
})

test('the owner sees the incident in the bell, reports the photo, and it is gone for him and kept for the business', opts, async () => {
  const page = await loginAs('CLIENT')
  await page.getByRole('button', { name: 'Novedades' }).click()
  await page.getByText('Lesión: Rex').waitFor()
  await page.getByRole('button', { name: 'Cerrar' }).first().click()
  await page.getByRole('button', { name: 'Agenda', exact: true }).filter({ visible: true }).first().click()
  await page.locator('img.dd-paseo-foto').first().waitFor({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Reportar foto' }).first().click()
  await page.getByRole('button', { name: 'Aparece una persona' }).first().click()
  assert.ok(await until(async () => (await page.locator('img.dd-paseo-foto').count()) === 0), 'the photo leaves the gallery')
  assert.deepEqual((await admin().from('paseo_fotos').select('oculta').eq('id', foto).single()).data, { oculta: true })
  const [rep] = (await admin().from('fotos_reportes').select('motivo, reportado_por').eq('foto_id', foto)).data
  assert.deepEqual(rep, { motivo: 'aparece_persona', reportado_por: ids.users.CLIENT })
  const read = async (actor) => (await fetch(`${FOTOS}/f/${foto}`, { headers: { authorization: `Bearer ${await token(actor)}` } })).status
  assert.deepEqual([await read('CLIENT'), await read('OWNER')], [404, 200])
  await page.close()
})
