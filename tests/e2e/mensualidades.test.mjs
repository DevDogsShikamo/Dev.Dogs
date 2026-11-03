// F4 monthly plans in a real browser against STAGING: the owner activates a plan for Rex (d1, CLIENT's dog) from
// Reportes, the client sees the plan in Mis perros and the monthly charge in the statement and the balance, and the
// owner exports the month (CSV and Excel). A throwaway monthly service of tenant A; its plans and charges are removed.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { admin, credentials, ids, seed } from '../security/_actors.mjs'
import { startApp } from './_app.mjs'

const PORTAL = { OWNER: 'empresa', CLIENT: 'cliente' }
const SVC = '0d0d0d05-0000-4000-8000-000000000095'
const NOMBRE = 'Plan E2E'
const PRECIO = 350000
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const hoy = new Date(Date.now() - 5 * 36e5).toISOString().slice(0, 10) // Bogota day, the server's clock
const MES = `${MESES[Number(hoy.slice(5, 7)) - 1]} ${hoy.slice(0, 4)}`
const miles = (n) => n.toLocaleString('es-CO')
let app

async function cleanup() {
  const db = admin()
  await db.from('prestaciones').delete().eq('servicio_id', SVC)
  await db.from('suscripciones').delete().eq('servicio_id', SVC)
  await db.from('tarifas').delete().eq('servicio_id', SVC)
  await db.from('servicios').delete().eq('id', SVC)
}
before(async () => {
  await seed()
  await cleanup()
  const db = admin()
  assert.equal((await db.from('servicios').insert({ id: SVC, negocio_id: ids.negocios.A, tipo: 'paseo', nombre: NOMBRE, modelo_cobro: 'mensual', activo: true })).error, null)
  assert.equal((await db.from('tarifas').insert({ servicio_id: SVC, negocio_id: ids.negocios.A, precio: 0, precio_mensual: PRECIO })).error, null)
  app = await startApp()
}, { timeout: 120_000 })
after(async () => {
  await cleanup()
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
  await page.getByRole('button', { name: 'Perfil', exact: true }).first().waitFor({ timeout: 60_000 })
  await page.waitForLoadState('networkidle')
  return page
}
const go = async (page, name) => {
  await page.getByRole('button', { name, exact: true }).filter({ visible: true }).first().click()
  await page.waitForLoadState('networkidle')
}
async function until(fn, ms = 20_000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 500))) if (await fn()) return true
  return false
}
const shown = (loc) => loc.first().waitFor({ timeout: 15_000 }).then(() => true, () => false)

test('the owner activates a plan; the client sees it and its monthly charge in the statement and the balance', async () => {
  const owner = await loginAs('OWNER')
  await go(owner, 'Reportes')
  await owner.getByRole('button', { name: 'Activar plan mensual' }).click()
  const dialog = owner.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Rex', exact: true }).click()
  await dialog.getByRole('button', { name: new RegExp(`^${NOMBRE} · `) }).click()
  await dialog.getByRole('button', { name: 'Activar plan', exact: true }).click()
  const plan = async () => (await admin().from('suscripciones').select('id,estado').eq('servicio_id', SVC).eq('perro_id', ids.perros.d1)).data
  assert.ok(await until(async () => (await plan()).length === 1), 'the plan was not created')
  assert.ok(await shown(owner.locator('.dd-cat-item', { hasText: NOMBRE }).filter({ hasText: 'Rex' })), 'the plan is listed')
  assert.ok(await shown(owner.getByText(`Mensualidad ${NOMBRE}`, { exact: true })), 'the month summary lists the monthly charge')
  await owner.close()

  // What the client owes: every finished chargeable unpaid service of its dogs, the monthly charge included.
  const { data } = await admin().from('cobros').select('precio_aplicado,prestaciones!inner(estado,perro_id)')
    .eq('cobrable', true).eq('cobrado', false).eq('prestaciones.estado', 'finalizado').in('prestaciones.perro_id', [ids.perros.d1, ids.perros.d2])
  const saldo = data.reduce((n, c) => n + c.precio_aplicado, 0)
  assert.ok(saldo >= PRECIO, 'precondition: the monthly charge is owed')

  const client = await loginAs('CLIENT')
  assert.ok(await shown(client.locator('.dd-saldo-v', { hasText: miles(saldo) })), `balance ${miles(saldo)}`)
  await go(client, 'Mis perros')
  assert.ok(await shown(client.getByText(`Plan mensual: ${NOMBRE}`, { exact: true })), 'Mis perros shows the plan')
  await client.locator('.dd-cat-item', { hasText: 'Rex' }).getByRole('button', { name: 'Estado de cuenta' }).click()
  const row = client.getByRole('dialog').locator('.dd-fac-row', { hasText: `Mensualidad ${NOMBRE} · ${MES}` })
  assert.ok(await shown(row), 'the statement lists the monthly charge')
  assert.match(await row.innerText(), new RegExp(miles(PRECIO).replace('.', '\\.')))
  await client.close()
})

test('the owner exports the month: CSV and Excel with the monthly charge and the legend', async () => {
  const owner = await loginAs('OWNER')
  await go(owner, 'Reportes')
  // The reports load after the permission check: the current month is picked by default.
  assert.ok(await shown(owner.getByRole('group', { name: 'Mes del reporte' }).locator('.dd-gchip.on', { hasText: MES })), 'current month picked')
  const exportar = owner.getByRole('group', { name: 'Exportar mes' })
  const [csv] = await Promise.all([owner.waitForEvent('download'), exportar.getByRole('button', { name: 'CSV' }).click()])
  assert.match(csv.suggestedFilename(), /^cobros-\d{4}-\d{2}\.csv$/)
  const text = readFileSync(await csv.path(), 'utf8')
  assert.match(text, /Fecha;Perro;Cliente;Servicio;Monto;Estado/)
  assert.match(text, new RegExp(`Rex;Client;Mensualidad ${NOMBRE} · ${MES};${PRECIO};Pendiente`))
  assert.match(text, /Este documento no es una factura electrónica\./)
  const [xlsx] = await Promise.all([owner.waitForEvent('download'), exportar.getByRole('button', { name: 'Excel' }).click()])
  assert.match(xlsx.suggestedFilename(), /^cobros-\d{4}-\d{2}\.xlsx$/)
  assert.ok(readFileSync(await xlsx.path()).subarray(0, 2).toString() === 'PK', 'an xlsx (zip) file')
  await owner.close()
})
