// S4b browser half: what each role SEES. The company portal hides finance for office staff until the
// owner grants the permission (RV-7a, D5), the owner toggles it, the walker's day carries no price and no
// client contact (RV-7b), office sees walker phones (RV-8c) and the owner still sees everything.
// Network evidence: the REST bodies the page received are scanned, so "hidden" means "never fetched".
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, credentials, ids, seed } from '../security/_actors.mjs'
import { startApp } from './_app.mjs'

const PHONE = { WALKER_CO: '+57 300 111 0001', CLIENT: '+57 300 222 0002' }
const MONEY = /"(?:precio_aplicado|precio_mensual|salario_fijo)":\s*\d|"precio":\s*\d/
let app

async function setFinanzas(actor, on) {
  const { error } = await (await as('OWNER')).rpc('permiso_finanzas_set', { p_user: ids.users[actor], p_on: on })
  assert.equal(error, null, `permiso_finanzas_set ${actor}`)
}

before(async () => {
  await seed()
  const db = admin()
  for (const [actor, telefono] of Object.entries(PHONE)) {
    const { error } = await db.from('contactos').upsert({ user_id: ids.users[actor], negocio_id: ids.negocios.A, rol: actor === 'CLIENT' ? 'cliente' : 'paseador', telefono })
    assert.equal(error, null, `contactos ${actor}`)
  }
  await setFinanzas('OFFICE', false)
  await setFinanzas('OFFICE_FIN', true)
  app = await startApp()
}, { timeout: 120_000 })
after(async () => {
  await setFinanzas('OFFICE', false)
  await setFinanzas('OFFICE_FIN', false)
  await admin().from('contactos').update({ telefono: null }).in('user_id', [ids.users.WALKER_CO, ids.users.CLIENT])
  await app?.stop()
})

// Logs in and records every REST response body the page receives.
async function loginAs(actor, portal, nav) {
  const page = await app.newPage()
  page.bodies = []
  page.on('response', async (r) => { if (r.url().includes('/rest/v1/')) page.bodies.push(await r.text().catch(() => '')) })
  // The finance check (has_finanzas) decides what the company portal shows: tests wait for it, then assert.
  page.finanzasChecked = page.waitForResponse((r) => r.url().includes('/rpc/has_finanzas'), { timeout: 30_000 }).catch(() => null)
  await page.goto(`${app.url}/login`)
  const { email, password } = credentials(actor)
  await page.getByPlaceholder('tu@correo.com').fill(email)
  await page.getByPlaceholder('••••••••').fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.waitForURL(`**/${portal}`, { timeout: 30_000 })
  await page.getByRole('button', { name: nav, exact: true }).waitFor()
  await page.waitForLoadState('networkidle')
  return page
}
const go = async (page, name) => { await page.getByRole('button', { name, exact: true }).click(); await page.waitForLoadState('networkidle') }
const seen = (page, text) => page.bodies.some((b) => b.includes(text))
// Rendering and fetching are asynchronous: wait for a fact instead of sampling it once.
const shown = (loc) => loc.first().waitFor({ timeout: 15_000 }).then(() => true, () => false)
async function waitSeen(page, text) {
  for (let i = 0; i < 30 && !seen(page, text); i++) await new Promise((r) => setTimeout(r, 500))
  return seen(page, text)
}

test('RV-7a: office without the permission has no finance UI and never fetches money; office with it sees reports but no salaries', async () => {
  for (const [actor, finance] of [['OFFICE', false], ['OFFICE_FIN', true]]) {
    const page = await loginAs(actor, 'empresa', 'Paseadores')
    await go(page, 'Paseadores')
    assert.ok(await shown(page.getByText('Walker Co')), `${actor}: the walkers list loads`) // precondition
    await page.finanzasChecked
    const reportes = page.getByRole('button', { name: 'Reportes', exact: true })
    if (finance) assert.ok(await shown(reportes), `${actor}: Reportes entry`)
    else assert.equal(await reportes.count(), 0, `${actor}: Reportes entry`)
    assert.equal(await page.getByText('/mes').count(), 0, `${actor}: no salary`)
    assert.ok(!page.bodies.some((b) => /"salario_fijo":\s*\d/.test(b)), `${actor}: salaries never fetched`)
    if (finance) assert.ok(await waitSeen(page, '"precio_aplicado"'), `${actor}: charges fetched with the permission`)
    else assert.ok(!seen(page, '"precio_aplicado"'), `${actor}: charges never fetched`)
    if (finance) {
      await go(page, 'Reportes')
      assert.ok(await shown(page.getByText('Facturado (30d)')))
    }
    await page.close()
  }
})

test('RV-8c: office sees the phones of walkers and no client phone', async () => {
  const page = await loginAs('OFFICE', 'empresa', 'Paseadores')
  await go(page, 'Paseadores')
  assert.ok(await shown(page.getByText(PHONE.WALKER_CO)))
  assert.ok(!seen(page, PHONE.CLIENT), 'a client phone reached the office browser')
  await page.close()
})

test('RV-7c: office opens the client list and sees names, never a phone', async () => {
  const page = await loginAs('OFFICE', 'empresa', 'Clientes')
  await go(page, 'Clientes')
  assert.ok(await shown(page.getByText('Client', { exact: true })), 'client names are listed')
  assert.equal(await page.getByText('Invitar').count(), 0, 'inviting is for the owner only')
  assert.equal(await page.getByText(PHONE.CLIENT).count(), 0)
  assert.ok(!seen(page, PHONE.CLIENT), 'a client phone reached the office browser')
  await page.close()
})

test('RV-7b: the day of a company walker carries no price and no client contact', async () => {
  // The app's "today" is the Bogota date; the fixture walk is dated by UTC, so pin it to the app's day.
  const today = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10)
  const walk = (await admin().from('prestaciones').select('fecha').eq('id', ids.prestaciones.p1).single()).data.fecha
  await admin().from('prestaciones').update({ fecha: today }).eq('id', ids.prestaciones.p1)
  const page = await loginAs('WALKER_CO', 'app', 'Perfil').finally(() => admin().from('prestaciones').update({ fecha: walk }).eq('id', ids.prestaciones.p1))
  assert.ok(await waitSeen(page, 'Rex'), 'the day agenda loaded') // precondition: today has a walk with Rex
  for (const text of Object.values(PHONE)) assert.ok(!seen(page, text), `${text} reached the walker`)
  assert.ok(!page.bodies.some((b) => MONEY.test(b) || b.includes('"cobrado"')), 'a price or charge reached the walker')
  assert.equal(await page.getByText(PHONE.CLIENT).count(), 0)
  await page.close()
})

test('the owner still sees everything: salaries, client phones, prices and reports', async () => {
  const page = await loginAs('OWNER', 'empresa', 'Paseadores')
  await go(page, 'Paseadores')
  assert.ok(await shown(page.getByText('/mes')), 'salaries')
  assert.ok(await shown(page.getByText(PHONE.WALKER_CO)), 'walker phone')
  await go(page, 'Clientes')
  assert.ok(await shown(page.getByText(PHONE.CLIENT)), 'client phone')
  await go(page, 'Servicios')
  assert.ok(await shown(page.getByText('20.000')), 'service price')
  await go(page, 'Reportes')
  assert.ok(await shown(page.getByText('Facturado (30d)')))
  await page.close()
})

test('D5: the owner toggles the finance permission in the management team and the office user follows it', async () => {
  const flag = async () => (await admin().from('permisos').select('finanzas').eq('user_id', ids.users.OFFICE).maybeSingle()).data?.finanzas ?? false
  const waitFlag = async (want) => { for (let i = 0; i < 20 && (await flag()) !== want; i++) await new Promise((r) => setTimeout(r, 500)); return flag() }
  assert.equal(await flag(), false) // precondition
  const owner = await loginAs('OWNER', 'empresa', 'Perfil')
  await go(owner, 'Perfil')
  const box = owner.locator('.dd-cat-item', { hasText: 'Office A' }).getByRole('checkbox')
  await box.waitFor()
  assert.equal(await box.isChecked(), false)
  await box.click()
  assert.equal(await waitFlag(true), true, 'the grant reached the database')
  const office = await loginAs('OFFICE', 'empresa', 'Paseadores')
  assert.ok(await shown(office.getByRole('button', { name: 'Reportes', exact: true })), 'office sees Reportes after the grant')
  await office.close()
  await box.click()
  assert.equal(await waitFlag(false), false, 'the revocation reached the database')
  await owner.close()
})
