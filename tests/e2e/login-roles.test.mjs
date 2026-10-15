// Login role routing in a real browser against STAGING (muten dev): every role lands on its portal and the
// guard chain (/login -> /app -> /empresa -> /cliente -> /login) never recurses while the profile loads.
// No overlay is removed here: a RangeError, a page error or a #__mu_err overlay at any moment fails the test.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { credentials, seed } from '../security/_actors.mjs'
import { startApp } from './_app.mjs'

const PORTAL = { OWNER: 'empresa', OFFICE: 'empresa', WALKER_CO: 'app', WALKER_IND: 'app', CLIENT: 'cliente' }
let app

before(async () => {
  await seed()
  app = await startApp()
}, { timeout: 120_000 })
after(async () => { await app?.stop() })

async function login(actor) {
  const page = await app.newPage()
  page.errors = []
  page.on('pageerror', (e) => page.errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && /Maximum call stack|RangeError/.test(m.text())) page.errors.push(`console: ${m.text()}`) })
  // The overlay may be removed by the app itself; remember that it was ever added.
  await page.addInitScript(() => {
    window.__overlay = false
    new MutationObserver(() => { if (document.getElementById('__mu_err')) window.__overlay = true }).observe(document, { childList: true, subtree: true })
  })
  await page.goto(`${app.url}/login`)
  const { email, password } = credentials(actor)
  await page.getByPlaceholder('tu@correo.com').fill(email)
  await page.getByPlaceholder('••••••••').fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  return page
}
const settle = async (page) => { await page.waitForLoadState('networkidle'); await page.waitForTimeout(1500) }
const clean = async (page) => {
  assert.deepEqual(page.errors, [], 'no page error / RangeError')
  assert.equal(await page.evaluate(() => window.__overlay), false, 'the #__mu_err overlay never appeared')
}

for (const [actor, portal] of Object.entries(PORTAL)) {
  test(`login ${actor}: lands on /${portal} with no RangeError and no error overlay`, async () => {
    const page = await login(actor)
    await page.waitForURL(`**/${portal}`, { timeout: 60_000 })
    await settle(page)
    assert.ok(page.url().endsWith(`/${portal}`), `stays on /${portal}, got ${page.url()}`)
    await clean(page)
    await page.close()
  })
}

test('login NOPROFILE: a session without a profile returns to /login with a message, no loop', async () => {
  const page = await login('NOPROFILE')
  await page.getByText(/no tiene un perfil/i).waitFor({ timeout: 60_000 })
  await settle(page)
  assert.ok(page.url().endsWith('/login'), `stays on /login, got ${page.url()}`)
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('muten:auth:loggedIn') ?? 'false')), false, 'the app does not keep a logged-in state')
  await clean(page)
  await page.close()
})
