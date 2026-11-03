// P3a in a real browser against STAGING (muten dev): a client moves a booking to another day from Agenda, and the
// business owner renames the business from Perfil and sees the new name without logging in again. The bookings,
// notifications and the name are restored even when a step fails.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, credentials, day, ids, seed } from '../security/_actors.mjs'
import { startApp } from './_app.mjs'

const A = ids.negocios.A
const FROM = day(20), TO = day(22)
let app

const clean = () => admin().from('prestaciones').delete().match({ perro_id: ids.perros.d1, servicio_id: ids.servicios.banoA }).in('fecha', [FROM, TO])
const restore = async () => {
  await clean()
  await admin().from('notificaciones').delete().eq('negocio_id', A)
  await admin().from('negocios').update({ nombre: 'Tenant A' }).eq('id', A)
}

before(async () => {
  await seed()
  await restore()
  app = await startApp()
}, { timeout: 120_000 })
after(async () => {
  await restore()
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
async function until(fn, what) {
  for (let i = 0; i < 40; i++) {
    const v = await fn()
    if (v) return v
    await new Promise((r) => setTimeout(r, 500))
  }
  assert.fail(`timed out waiting for ${what}`)
}

test('a client moves a booking to another day from Agenda', async () => {
  const res = await (await as('CLIENT')).rpc('reservar', { p_perro: ids.perros.d1, p_servicio: ids.servicios.banoA, p_grupo: null, p_fecha: FROM })
  assert.equal(res.error, null, res.error?.message)

  const page = await login('CLIENT', 'cliente')
  await navTo(page, 'Agenda')
  const row = page.locator('.dd-cli-paseo').filter({ hasText: `Rex · ${FROM}` })
  await row.getByRole('button', { name: 'Reprogramar', exact: true }).click()
  await row.locator('input[type="date"]').fill(TO)
  await row.getByRole('button', { name: 'Guardar nueva fecha', exact: true }).click()

  const moved = await until(async () => (await admin().from('prestaciones').select('id,estado').match({ perro_id: ids.perros.d1, servicio_id: ids.servicios.banoA, fecha: TO })).data[0], 'the new booking')
  assert.equal(moved.estado, 'programado')
  assert.equal((await admin().from('prestaciones').select('estado').eq('id', res.data).single()).data.estado, 'cancelado')
  await page.locator('.dd-cli-paseo').filter({ hasText: `Rex · ${TO}` }).waitFor({ timeout: 30_000 })
  await page.close()
})

test('the owner renames the business from Perfil and sees the new name without a new login', async () => {
  const page = await login('OWNER', 'empresa')
  await navTo(page, 'Perfil')
  await page.getByRole('button', { name: 'Cambiar nombre', exact: true }).click()
  await page.getByPlaceholder('Nombre del negocio').fill('  Paseos E2E  ')
  await page.getByRole('button', { name: 'Guardar nombre', exact: true }).click()
  await until(async () => (await admin().from('negocios').select('nombre').eq('id', A).single()).data.nombre === 'Paseos E2E', 'the stored name')
  await page.locator('.dd-pf-team').getByText('Paseos E2E', { exact: true }).waitFor({ timeout: 30_000 })
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('muten:auth:negocioNombre') ?? 'null')), 'Paseos E2E')
  await page.close()
})
