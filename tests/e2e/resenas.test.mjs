// Real reviews in a real browser against STAGING (muten dev): a client with a finished service leaves a
// review from Perfil, the business owner approves it in Reseñas, and the public landing shows the section
// with the server's average and count only once 3 approved + name-consented reviews exist. Below 3 the
// landing renders no reviews section at all; a client without a finished service (a product purchase is
// not one) gets no review action.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, credentials, day, ids, seed, writePrestaciones } from '../security/_actors.mjs'
import { startApp } from './_app.mjs'

const u = ids.users
const A = ids.negocios.A
const TEXT = 'Pasean a Rex con mucho cuidado y siempre a tiempo.'
const THANKS = '¡Gracias! Tu reseña quedará visible cuando el negocio la apruebe.'
let app

const clean = () => admin().from('resenas').delete().in('negocio_id', Object.values(ids.negocios))
// Two approved, name-consented reviews of tenant A (5 and 4 stars), written by the service role.
const seedTwo = () => admin().from('resenas').upsert(
  [[u.CLIENT2, 5, 'Excelente trato con Toby y Nina.'], [u.CLIENT3, 4, 'Max vuelve tranquilo de cada salida.']].map(([autor_id, rating, texto]) =>
    ({ negocio_id: A, autor_id, rating, texto, publicar_nombre: true, estado: 'aprobada', moderated_by: u.OWNER, moderated_at: new Date().toISOString() })),
  { onConflict: 'negocio_id,autor_id' })

before(async () => {
  await seed()
  assert.equal((await clean()).error, null)
  const { count } = await admin().from('resenas').select('id', { count: 'exact', head: true }).eq('estado', 'aprobada').eq('publicar_nombre', true)
  assert.equal(count, 0, 'precondition: staging holds no other public review')
  app = await startApp()
}, { timeout: 120_000 })
after(async () => {
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
// Opens the landing and returns the page plus the body resenas_publicas answered with.
async function landing() {
  const page = await app.newPage()
  const rpc = page.waitForResponse((r) => r.url().includes('/rest/v1/rpc/resenas_publicas'), { timeout: 60_000 })
  await page.goto(`${app.url}/`)
  const body = await (await rpc).json()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1000)
  return { page, body }
}

test('with 2 approved + consented reviews the landing renders no reviews section', async () => {
  assert.equal((await seedTwo()).error, null)
  const { page, body } = await landing()
  assert.deepEqual(body, { total: 0, promedio: null, items: [] })
  assert.equal(await page.locator('section.rv').count(), 0)
  assert.doesNotMatch(await page.locator('body').innerText(), /Lo que dicen los clientes|reseñas/i)
  await page.close()
})

test('a client leaves a review, the owner approves it and the landing shows the real average, count and the review', async () => {
  assert.equal((await seedTwo()).error, null)
  const client = await login('CLIENT', 'cliente')
  await navTo(client, 'Perfil')
  await client.getByRole('button', { name: 'Dejar una reseña' }).click()
  const send = client.getByRole('button', { name: 'Enviar reseña' })
  assert.equal(await send.isDisabled(), true, 'no rating and no text yet')
  await client.getByRole('button', { name: '4 estrellas' }).click()
  await client.getByRole('textbox').fill(TEXT)
  const consent = client.getByRole('checkbox', { name: 'Acepto que mi reseña se publique con mi nombre' })
  assert.equal(await consent.isChecked(), false, 'the name consent starts unticked')
  await consent.check()
  await send.click()
  await client.getByText(THANKS).waitFor({ timeout: 30_000 })
  await client.getByText('Pendiente de aprobación').waitFor({ timeout: 30_000 })
  const { data: [row] } = await admin().from('resenas').select('rating,texto,publicar_nombre,estado').eq('autor_id', u.CLIENT).eq('negocio_id', A)
  assert.deepEqual(row, { rating: 4, texto: TEXT, publicar_nombre: true, estado: 'pendiente' })
  assert.equal(await client.getByRole('button', { name: 'Dejar una reseña' }).count(), 0, 'one review per client: only Editar remains')
  await client.close()

  const owner = await login('OWNER', 'empresa')
  await navTo(owner, 'Reseñas')
  await owner.getByText(TEXT).waitFor({ timeout: 30_000 })
  await owner.getByRole('button', { name: 'Aprobar' }).click()
  for (let i = 0; i < 30 && (await admin().from('resenas').select('estado').eq('autor_id', u.CLIENT).single()).data.estado !== 'aprobada'; i++) await owner.waitForTimeout(500)
  const { data: approved } = await admin().from('resenas').select('estado,moderated_by').eq('autor_id', u.CLIENT).single()
  assert.deepEqual(approved, { estado: 'aprobada', moderated_by: u.OWNER })
  await owner.close()

  const { page, body } = await landing()
  assert.deepEqual([body.total, body.promedio, body.items.length], [3, 4.3, 3]) // (5 + 4 + 4) / 3
  const section = page.locator('section.rv')
  await section.waitFor({ timeout: 30_000 })
  const text = await section.innerText()
  assert.match(text, /4,3 de 5\s*· 3 reseñas/)
  assert.match(text, new RegExp(TEXT))
  assert.match(text, /Client\s+Tenant A/)
  assert.equal(await section.locator('article.rv-card').count(), 3)
  await page.close()
})

// CLIENT2 has no finished service; a finished product purchase (tipo comida) must not count as one.
test('a client whose only finished row is a product purchase has no "Dejar una reseña" action', async () => {
  const buy = await writePrestaciones({ negocio_id: A, perro_id: ids.perros.d3, tipo: 'comida', fecha: day(-1), estado: 'finalizado', precio_aplicado: 5000, detalle: { cantidad: 1 } })
  try {
    const page = await login('CLIENT2', 'cliente')
    await navTo(page, 'Perfil')
    await page.waitForTimeout(1500)
    await page.getByText('Cerrar sesión').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Dejar una reseña' }).count(), 0)
    assert.equal(await page.getByText('Tu reseña del negocio').count(), 0)
    await page.close()
  } finally {
    await admin().from('prestaciones').delete().eq('id', buy.data[0].id)
  }
})
