// F6 notifications in a real browser against STAGING (muten dev): a client books two services, the business owner
// sees the bell with 2 unread on Inicio, opens the sheet, taps one booking and lands on Agenda; back on Inicio the
// badge shows 1. Bookings and notifications of the run are removed even when a step fails.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, credentials, day, ids, seed } from '../security/_actors.mjs'
import { startApp } from './_app.mjs'

const A = ids.negocios.A
const made = []
let app

const clean = () => admin().from('notificaciones').delete().eq('negocio_id', A)

before(async () => {
  await seed()
  assert.equal((await clean()).error, null)
  app = await startApp()
}, { timeout: 120_000 })
after(async () => {
  await admin().from('prestaciones').delete().in('id', made)
  await clean()
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
const navTo = (page, name) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first().click()
const badge = (page) => page.locator('.dd-bell-badge')

test('a client books, the owner sees the badge, opens the sheet, taps it, lands on Agenda and the badge decreases', async () => {
  const client = await as('CLIENT')
  for (const n of [10, 11]) {
    const res = await client.rpc('reservar', { p_perro: ids.perros.d1, p_servicio: ids.servicios.banoA, p_grupo: null, p_fecha: day(n) })
    assert.equal(res.error, null, res.error?.message)
    made.push(res.data)
  }
  const fecha = day(10).split('-').reverse().join('/')

  const owner = await login('OWNER', 'empresa')
  await badge(owner).filter({ hasText: '2' }).waitFor({ timeout: 30_000 })
  await owner.getByRole('button', { name: 'Notificaciones', exact: true }).click()
  const sheet = owner.getByRole('dialog')
  await sheet.getByText('Notificaciones', { exact: true }).waitFor()
  const item = sheet.getByRole('button').filter({ hasText: `Rex · Bano · ${fecha}` })
  assert.match(await item.innerText(), /Nueva reserva/)
  await item.click()
  await owner.getByRole('heading', { name: 'Agenda de la semana' }).waitFor({ timeout: 30_000 })

  for (let i = 0; i < 30 && (await admin().from('notificacion_leidas').select('user_id').eq('user_id', ids.users.OWNER)).data.length === 0; i++) await owner.waitForTimeout(500)
  const { data: leidas } = await admin().from('notificacion_leidas').select('notificaciones(ref_id)').eq('user_id', ids.users.OWNER)
  assert.deepEqual(leidas.map((l) => l.notificaciones.ref_id), [made[0]])

  await navTo(owner, 'Inicio')
  await badge(owner).filter({ hasText: '1' }).waitFor({ timeout: 30_000 })
  await owner.close()
})
