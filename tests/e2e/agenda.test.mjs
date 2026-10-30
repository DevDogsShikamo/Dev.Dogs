// F1 agenda in a real browser against STAGING: the owner puts a dog into an outing from Salidas and the walker
// sees it in today's walk; the owner assigns a client's bath booking from the Agenda and the assignee sees it in
// his day. Throwaway outing, dogs and booking in tenant A; the outing is at 23:59 so today's walk is still ahead.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, credentials, day, ids, seed, writePrestaciones } from '../security/_actors.mjs'
import { startApp } from './_app.mjs'

const PORTAL = { OWNER: 'empresa', WALKER_CO: 'app', WALKER_CO2: 'app' }
const u = ids.users
const made = { grupos: [], perros: [] }
let app

before(async () => {
  await seed()
  app = await startApp()
}, { timeout: 120_000 })
after(async () => {
  const db = admin()
  await db.from('prestaciones').delete().in('perro_id', made.perros)
  await db.from('grupo_membresias').delete().in('grupo_id', made.grupos)
  await db.from('grupos').delete().in('id', made.grupos)
  await db.from('perros').delete().in('id', made.perros)
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
async function dog(nombre) {
  const { data } = await admin().from('perros').insert({ negocio_id: ids.negocios.A, nombre, activo: true }).select('id').single()
  made.perros.push(data.id)
  return data.id
}
// The walker's day: open the walk of 23:59 (Grupos timeline) and read its dogs.
async function walkerSees(actor, hora, nombre) {
  const page = await loginAs(actor)
  await go(page, 'Grupos')
  await page.locator('.dd-gr-block', { hasText: hora }).first().click()
  const ok = await page.getByText(nombre, { exact: true }).first().waitFor({ timeout: 15_000 }).then(() => true, () => false)
  await page.close()
  return ok
}

test('the owner adds a dog to an outing from Salidas and its walker sees it in today\'s walk', async () => {
  const { data: g } = await admin().from('grupos').insert({
    negocio_id: ids.negocios.A, nombre: 'Salida Agenda E2E', zona: 'Norte', servicio_id: ids.servicios.paseoA,
    cuidador_id: u.WALKER_CO2, hora: '23:59', duracion_min: 60,
  }).select('id').single()
  made.grupos.push(g.id)
  const perro = await dog('Perro Agenda E2E')

  const page = await loginAs('OWNER')
  await go(page, 'Salidas')
  await page.locator('.dd-cat-item', { hasText: 'Salida Agenda E2E' }).getByRole('button', { name: 'Agregar perro', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Perro Agenda E2E', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Sáb' }).uncheck()
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar', exact: true }).click()
  const walks = async () => (await admin().from('prestaciones').select('fecha').eq('perro_id', perro).eq('grupo_id', g.id)).data
  assert.ok(await until(async () => (await walks()).length > 0), 'no walk was created')
  const isodow = (f) => new Date(`${f}T12:00:00Z`).getUTCDay() || 7
  assert.ok((await walks()).every((w) => isodow(w.fecha) !== 6), 'a Saturday walk was created')
  // The outing lists the dog with its days.
  assert.ok(await page.getByText('Lun, Mar, Mié, Jue, Vie, Dom').first().waitFor({ timeout: 15_000 }).then(() => true, () => false))
  await page.close()

  const hoy = (await walks()).some((w) => w.fecha === day(0))
  if (hoy) assert.ok(await walkerSees('WALKER_CO2', '23:59', 'Perro Agenda E2E'), 'the walker does not see the dog in today\'s walk')
  else assert.ok((await walks()).some((w) => w.fecha === day(1)), 'no walk for the next day') // Saturday today, or past 23:59
})

test('the owner assigns a client\'s bath booking from the Agenda and the assignee sees it in his day', async () => {
  const perro = await dog('Perro Bano E2E')
  const { data } = await writePrestaciones({
    negocio_id: ids.negocios.A, perro_id: perro, tipo: 'bano', servicio_id: ids.servicios.banoA, grupo_id: null,
    cuidador_id: null, fecha: day(0), estado: 'programado', precio_aplicado: 30000, detalle: { hora: '23:58' },
  })
  const booking = data[0].id

  const page = await loginAs('OWNER')
  await go(page, 'Agenda')
  await page.locator('.dd-agrp-item', { hasText: 'Perro Bano E2E' }).getByRole('button', { name: 'Asignar', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Walker Co', exact: true }).click()
  assert.ok(await until(async () => (await admin().from('prestaciones').select('cuidador_id').eq('id', booking).single()).data.cuidador_id === u.WALKER_CO),
    'the booking was not assigned')
  await page.close()

  assert.ok(await walkerSees('WALKER_CO', '23:58', 'Perro Bano E2E'), 'the assignee does not see the bath in his day')
})
