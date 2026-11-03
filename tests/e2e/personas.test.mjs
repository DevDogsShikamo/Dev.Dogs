// F2 people in a real browser against STAGING: the owner picks the principal owner of a dog the business
// registered and that client buys for it in the Tienda; the owner removes a walker, who then lands on
// /completar-registro instead of the tenant's data; the company walker sees no edit controls the server refuses.
// Throwaway rows: a dog and a product of tenant A, and a walker (tempUser) with its profile.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, credentials, ids, seed, tempUser } from '../security/_actors.mjs'
import { dropDog } from '../security/_attacks.mjs'
import { POLITICA_VERSION } from '../../src/lib/politica.js'
import { startApp } from './_app.mjs'

const A = ids.negocios.A
const PERRO = 'Bimba F2'
const SNACK = 'Snack F2 E2E'
const PORTAL = { OWNER: 'empresa', CLIENT3: 'cliente', WALKER_CO: 'app', WALKER_IND: 'app' }
let app, dog, svc

async function cleanup() {
  const db = admin()
  for (const p of (await db.from('perros').select('id').eq('negocio_id', A).eq('nombre', PERRO)).data) await dropDog(p.id)
  for (const s of (await db.from('servicios').select('id').eq('negocio_id', A).eq('nombre', SNACK)).data) {
    await db.from('prestaciones').delete().eq('servicio_id', s.id)
    await db.from('tarifas').delete().eq('servicio_id', s.id)
    await db.from('servicios').delete().eq('id', s.id)
  }
}
before(async () => {
  await seed()
  await cleanup()
  const db = admin()
  dog = (await db.from('perros').insert({ negocio_id: A, nombre: PERRO }).select('id').single()).data.id
  svc = (await db.from('servicios').insert({ negocio_id: A, tipo: 'comida', nombre: SNACK, activo: true }).select('id').single()).data.id
  assert.equal((await db.from('tarifas').insert({ servicio_id: svc, negocio_id: A, precio: 7000 })).error, null)
  app = await startApp()
}, { timeout: 120_000 })
after(async () => {
  await cleanup()
  await app?.stop()
})

async function login({ email, password }, portal) {
  const page = await app.newPage()
  await page.goto(`${app.url}/login`)
  await page.getByPlaceholder('tu@correo.com').fill(email)
  await page.getByPlaceholder('••••••••').fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.waitForURL(`**/${portal}`, { timeout: 60_000 })
  if (portal !== 'completar-registro') await page.getByRole('button', { name: 'Perfil', exact: true }).first().waitFor({ timeout: 60_000 })
  await page.waitForLoadState('networkidle')
  return page
}
const loginAs = (actor) => login(credentials(actor), PORTAL[actor])
const go = async (page, name) => {
  await page.getByRole('button', { name, exact: true }).filter({ visible: true }).first().click()
  await page.waitForLoadState('networkidle')
}
async function until(fn, ms = 20_000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 500))) if (await fn()) return true
  return false
}
const shown = (loc) => loc.first().waitFor({ timeout: 15_000 }).then(() => true, () => false)
const visible = (page, name) => page.getByRole('button', { name }).filter({ visible: true })

test('the owner picks the principal owner of a business dog; that client buys for it in the Tienda', async () => {
  const owner = await loginAs('OWNER')
  await go(owner, 'Perros')
  await owner.locator('.dd-cat-item', { hasText: PERRO }).getByRole('button', { name: 'Editar perro' }).click()
  const dialog = owner.getByRole('dialog')
  assert.ok(await shown(dialog.getByText('Este perro aún no tiene dueño principal', { exact: false })), 'no principal yet')
  await dialog.getByRole('group', { name: 'Dueño principal' }).getByRole('button', { name: 'Client3', exact: true }).click()
  const principal = async () => (await admin().from('perro_duenos').select('dueno_id').eq('perro_id', dog).eq('rol', 'principal').eq('estado', 'activo')).data
  assert.ok(await until(async () => (await principal()).some((l) => l.dueno_id === ids.users.CLIENT3)), 'CLIENT3 is not the principal')
  assert.ok(await shown(dialog.locator('.dd-cat-item', { hasText: 'Client3' }).getByText('Principal', { exact: true })), 'the dialog shows the principal')
  await owner.close()

  const client = await loginAs('CLIENT3')
  await go(client, 'Tienda')
  await client.locator('.dd-cat-item', { hasText: SNACK }).getByRole('button', { name: 'Comprar' }).click()
  const buy = client.getByRole('dialog')
  await buy.getByRole('button', { name: PERRO, exact: true }).click()
  await buy.getByRole('button', { name: 'Confirmar compra' }).click()
  const bought = async () => (await admin().from('prestaciones').select('id').eq('perro_id', dog).eq('servicio_id', svc)).data.length
  assert.ok(await until(async () => (await bought()) === 1), 'the purchase was not recorded')
  await client.close()
})

test('the owner removes a walker: next time the walker lands on /completar-registro, not on the tenant', async () => {
  const walker = await tempUser()
  try {
    const db = admin()
    assert.equal((await db.from('profiles').insert({ id: walker.id, negocio_id: A, rol: 'paseador', nombre: 'Temp F2 walker' })).error, null)
    assert.equal((await db.from('consentimientos').insert({ user_id: walker.id, policy_version: POLITICA_VERSION })).error, null)
    const before = await login(walker, 'app')
    await before.close()

    const owner = await loginAs('OWNER')
    await go(owner, 'Paseadores')
    await owner.locator('.dd-cat-item', { hasText: 'Temp F2 walker' }).getByRole('button', { name: 'Dar de baja' }).click()
    await owner.getByRole('group', { name: 'Confirmar la baja' }).getByRole('button', { name: 'Sí, dar de baja' }).click()
    const gone = async () => (await db.from('profiles').select('negocio_id').eq('id', walker.id).single()).data.negocio_id === null
    assert.ok(await until(gone), 'the walker was not removed')
    assert.ok(await until(async () => (await owner.getByText('Temp F2 walker', { exact: true }).count()) === 0), 'still listed')
    await owner.close()

    const after = await login(walker, 'completar-registro')
    assert.ok(await shown(after.getByText('Ya no perteneces a ningún negocio', { exact: false })), 'the notice is shown')
    await after.goto(`${app.url}/app`)
    await after.waitForURL('**/completar-registro', { timeout: 30_000 })
    await after.close()
  } finally {
    await walker.drop()
  }
})

test('the company walker sees no edit controls in Perros, Servicios and Grupos; the independent walker does', async () => {
  const co = await loginAs('WALKER_CO')
  await go(co, 'Perros')
  assert.ok(await shown(co.locator('.dd-cat-item', { hasText: 'Rex' })), 'precondition: reads its dogs')
  assert.equal(await visible(co, 'Agregar').count(), 0, 'Perros: Agregar')
  assert.equal(await visible(co, /^(Editar|Eliminar) /).count(), 0, 'Perros: edit or delete')
  await co.locator('.dd-cat-item', { hasText: 'Rex' }).locator('.dd-cat-open').click()
  assert.ok(await shown(co.getByRole('dialog').getByText('Ficha del perro')), 'the dog card opens')
  assert.equal(await visible(co, /Agregar relación|Editar relación|Quitar relación/).count(), 0, 'relations')
  await co.getByRole('dialog').getByRole('button', { name: 'Cerrar / Close' }).click()
  await go(co, 'Grupos')
  assert.equal(await visible(co, 'Organizar').count(), 0, 'Grupos: Organizar')
  await go(co, 'Perfil')
  assert.ok(await shown(visible(co, 'Salir del negocio')), 'Perfil: Salir del negocio')
  await go(co, 'Servicios y precios')
  assert.equal(await visible(co, /^(Agregar|Editar \/ Edit|Eliminar \/ Delete|Quitar \/ Remove)$/).count(), 0, 'Servicios')
  await co.getByRole('button', { name: 'Volver / Back' }).filter({ visible: true }).first().click()
  await go(co, 'Mis grupos')
  assert.equal(await visible(co, /^(Agregar|Editar \/ Edit|Eliminar \/ Delete)$/).count(), 0, 'Mis grupos')
  await co.close()

  const ind = await loginAs('WALKER_IND')
  await go(ind, 'Perros')
  assert.ok(await shown(visible(ind, 'Agregar')), 'the owner adds dogs')
  await go(ind, 'Grupos')
  assert.ok(await shown(visible(ind, 'Organizar')), 'the owner organizes')
  await go(ind, 'Perfil')
  assert.equal(await visible(ind, 'Salir del negocio').count(), 0, 'an owner cannot leave')
  await ind.close()
})
