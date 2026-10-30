// F5a UI polish in a real browser against STAGING: the walker portal shows the signed-in walker (no placeholder
// name); a delete asks first and "Cancelar" keeps the item; Reservar keeps outings without a service and products
// out; the pickup and drop-off times of a finished walk reach the client, the business agenda and the walker; the
// business agenda moves to the next and previous week. Throwaway rows in tenant A, removed in after().
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, credentials, day, ids, seed, writePrestaciones } from '../security/_actors.mjs'
import { startApp } from './_app.mjs'

const A = ids.negocios.A
const u = ids.users
const PORTAL = { OWNER: 'empresa', WALKER_CO: 'app', CLIENT: 'cliente' }
const SVC = 'Svc Pulido E2E'
const SNACK = 'Snack Pulido E2E'
const ZONA = 'Zona Pulido E2E'
const made = { prestaciones: [], grupos: [], servicios: [] }
let app

async function cleanup() {
  const db = admin()
  if (made.prestaciones.length) await db.from('prestaciones').delete().in('id', made.prestaciones)
  if (made.grupos.length) await db.from('grupos').delete().in('id', made.grupos)
  for (const s of (await db.from('servicios').select('id').eq('negocio_id', A).in('nombre', [SVC, SNACK])).data) {
    await db.from('prestaciones').delete().eq('servicio_id', s.id)
    await db.from('tarifas').delete().eq('servicio_id', s.id)
    await db.from('servicios').delete().eq('id', s.id)
  }
}
before(async () => {
  await seed()
  await cleanup()
  const db = admin()
  for (const [nombre, tipo] of [[SVC, 'bano'], [SNACK, 'comida']]) {
    const { data } = await db.from('servicios').insert({ negocio_id: A, tipo, nombre, activo: true }).select('id').single()
    made.servicios.push(data.id)
    assert.equal((await db.from('tarifas').insert({ servicio_id: data.id, negocio_id: A, precio: 9000 })).error, null)
  }
  // An outing without a service: nothing to book.
  const { data: g } = await db.from('grupos').insert({ negocio_id: A, nombre: 'Sin servicio E2E', zona: ZONA, hora: '23:55', duracion_min: 60 }).select('id').single()
  made.grupos.push(g.id)
  // Luna (CLIENT's dog): a walk finished today with its pickup and drop-off times, and a walk in 9 days.
  const walk = { negocio_id: A, perro_id: ids.perros.d2, tipo: 'paseo', servicio_id: ids.servicios.paseoA, grupo_id: null, cuidador_id: u.WALKER_CO, precio_aplicado: 20000 }
  const { data: rows } = await writePrestaciones([
    { ...walk, fecha: day(0), estado: 'finalizado', detalle: { hora: '23:57', hora_recibido: '10:05', hora_entrega: '11:10' } },
    { ...walk, fecha: day(9), estado: 'programado', detalle: { hora: '23:56' } },
  ])
  made.prestaciones.push(...rows.map((r) => r.id))
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
  await page.waitForURL(`**/${PORTAL[actor]}`, { timeout: 60_000 })
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
const gone = (loc) => until(async () => (await loc.count()) === 0, 15_000)

test('the walker portal greets the signed-in walker, with no placeholder name and no dead bell', async () => {
  const page = await loginAs('WALKER_CO')
  assert.ok(await shown(page.locator('.dd-gn', { hasText: 'Walker Co' })), 'the greeting shows the walker')
  assert.equal(await page.getByText('Carlos Ruiz').count(), 0, 'no placeholder name')
  assert.equal(await page.getByRole('button', { name: 'Notificaciones' }).count(), 0, 'no bell without notifications')
  await go(page, 'Perfil')
  assert.equal(await page.getByRole('button', { name: 'Notificaciones' }).count(), 0, 'no dead Notificaciones option')
  await page.getByRole('button', { name: 'Ayuda y soporte', exact: true }).click()
  assert.ok(await shown(page.getByRole('dialog').getByText('Tenant A SAS')), 'the help sheet shows the business contact')
  await page.close()
})

test('the walker sees the pickup and drop-off times of a finished walk', async () => {
  const page = await loginAs('WALKER_CO')
  await go(page, 'Grupos')
  const block = page.locator('.dd-gr-block', { hasText: '23:57' })
  assert.ok(await shown(block.getByText('Recibido 10:05')), 'pickup time')
  assert.ok(await shown(block.getByText('Entregado 11:10')), 'drop-off time')
  await page.close()
})

test('deleting a service asks first: "Cancelar" keeps it, "Sí, eliminar" removes it', async () => {
  const page = await loginAs('OWNER')
  await go(page, 'Servicios')
  const row = page.locator('.dd-cli-paseo', { hasText: SVC })
  await row.getByRole('button', { name: 'Eliminar servicio' }).click()
  const confirm = row.getByRole('group', { name: 'Confirmar' })
  assert.ok(await shown(confirm), 'a confirmation is asked')
  await confirm.getByRole('button', { name: 'Cancelar', exact: true }).click()
  assert.ok(await gone(confirm), 'the confirmation closes')
  await page.waitForTimeout(1500)
  const activo = async () => (await admin().from('servicios').select('activo').eq('id', made.servicios[0]).single()).data.activo
  assert.equal(await activo(), true, 'cancelling keeps the service')
  assert.ok(await shown(page.getByText(SVC, { exact: true })), 'still listed')

  await row.getByRole('button', { name: 'Eliminar servicio' }).click()
  await confirm.getByRole('button', { name: 'Sí, eliminar', exact: true }).click()
  assert.ok(await until(async () => (await activo()) === false), 'confirming removes the service')
  await page.close()
})

test('Reservar: outings without a service and products are not offered; services sit in their own tab', async () => {
  const page = await loginAs('CLIENT')
  await go(page, 'Reservar')
  assert.ok(await shown(page.locator('.dd-cat-item', { hasText: 'Norte' })), 'precondition: an outing with a service')
  assert.equal(await page.getByText(ZONA).count(), 0, 'an outing without a service is not offered')
  assert.equal(await page.getByText('Bano', { exact: true }).count(), 0, 'services are in their own tab')
  await page.getByRole('button', { name: 'Servicios', exact: true }).click()
  assert.ok(await shown(page.getByText('Bano', { exact: true })), 'the service is offered')
  assert.equal(await page.getByText(SNACK, { exact: true }).count(), 0, 'a product is not a service')
  assert.equal(await page.getByText(ZONA).count(), 0, 'no outings in the services tab')
  await page.close()
})

test('the client sees the pickup and drop-off times of a finished walk in the Agenda', async () => {
  const page = await loginAs('CLIENT')
  await go(page, 'Agenda')
  const item = page.locator('.dd-cat-item', { hasText: '23:57' })
  assert.ok(await shown(item.getByText('Recibido 10:05')), 'pickup time')
  assert.ok(await shown(item.getByText('Entregado 11:10')), 'drop-off time')
  await page.close()
})

test('the business agenda shows the times and moves to the next and previous week', async () => {
  const page = await loginAs('OWNER')
  await go(page, 'Agenda')
  const hoy = page.locator('.dd-agrp-item', { hasText: '23:57' })
  assert.ok(await shown(hoy.getByText('Recibido 10:05')), 'pickup time in the agenda')
  assert.ok(await shown(hoy.getByText('Entregado 11:10')), 'drop-off time in the agenda')
  const next = page.locator('.dd-agrp-item', { hasText: '23:56' })
  assert.equal(await next.count(), 0, 'a walk in 9 days is not in this week')

  await page.getByRole('button', { name: 'Semana siguiente' }).click()
  assert.ok(await shown(next), 'next week shows the walk in 9 days')
  assert.ok(await gone(hoy), 'next week no longer shows today')
  await page.getByRole('button', { name: 'Semana anterior' }).click()
  assert.ok(await gone(next), 'back to this week')
  assert.ok(await shown(hoy), 'today again')
  await page.getByRole('button', { name: 'Semana siguiente' }).click()
  assert.ok(await shown(next), 'next week again')
  await page.getByRole('button', { name: 'Hoy', exact: true }).click()
  assert.ok(await shown(hoy), '"Hoy" goes back to this week')
  await page.close()
})
