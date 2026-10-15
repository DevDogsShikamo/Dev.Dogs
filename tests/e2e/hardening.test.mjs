// S6 client hardening in a real browser against STAGING: what stays on the device per role (CC-1),
// the purge at the end of a session (CC-2), the walker outbox (CC-3) and the CSP (CC-5b).
// CC-6b (signup email check) is covered by tests/client/hardening.test.mjs: the check is not wired
// into the signup page, so there is no request to observe in the browser.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, credentials, ids, seed } from '../security/_actors.mjs'
import { loadConfig } from '../security/_env.mjs'
import { readFileSync } from 'node:fs'
import { CSP } from '../../csp.config.mjs'
import { startApp } from './_app.mjs'

const PHONE = { WALKER_CO: '+57 300 111 0001', CLIENT: '+57 300 222 0002' }
const PORTAL_URL = { OWNER: 'empresa', OFFICE: 'empresa', CLIENT: 'cliente', WALKER_CO: 'app', WALKER_CO2: 'app' }
// Local-storage keys a role may legitimately hold (UI preferences and routing guards are allowed everywhere).
const PREFS = /^muten:(auth|i18n|calendario):/
const WALKER_DAY = /^muten:grupos:(grupos|fecha|perrosHoy|perrosPaseo)$/
const OURS = /^(muten:|dd:)/
const sbKey = `sb-${new URL(loadConfig().url).host.split('.')[0]}-auth-token`
const GHOST = '00000000-0000-4000-8000-000000000000' // a walk id that does not exist
let app
let walkDate

const today = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10) // Bogota day, as the app computes it

before(async () => {
  await seed()
  const db = admin()
  for (const [actor, telefono] of Object.entries(PHONE)) {
    const { error } = await db.from('contactos').upsert({ user_id: ids.users[actor], negocio_id: ids.negocios.A, rol: actor === 'CLIENT' ? 'cliente' : 'paseador', telefono })
    assert.equal(error, null, `contactos ${actor}`)
  }
  walkDate = (await db.from('prestaciones').select('fecha').eq('id', ids.prestaciones.p1).single()).data.fecha
  await resetWalk()
  app = await startApp()
}, { timeout: 120_000 })
after(async () => {
  await admin().from('contactos').update({ telefono: null }).in('user_id', [ids.users.WALKER_CO, ids.users.CLIENT])
  await admin().from('prestaciones').update({ fecha: walkDate, estado: 'programado' }).eq('id', ids.prestaciones.p1)
  await app?.stop()
})

// The fixture walk of WALKER_CO, dated today and not started.
const resetWalk = () => admin().from('prestaciones').update({ fecha: today(), estado: 'programado' }).eq('id', ids.prestaciones.p1)

async function loginAs(actor, { csp = false } = {}) {
  const page = await app.newPage({ csp })
  page.requests = []
  page.on('request', (r) => page.requests.push(r.url()))
  // Chromium reports navigator.onLine === true on a document loaded while the context is offline;
  // a real offline browser reports false, so the flag set by goOffline() makes the page see that.
  await page.addInitScript(() => {
    const real = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine')
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get() { return sessionStorage.getItem('pw_offline') ? false : real.get.call(this) } })
  })
  await page.addInitScript(() => { window.addEventListener('toast', (e) => { (window.__toasts ||= []).push(e.detail) }) })
  await page.goto(`${app.url}/login`)
  const { email, password } = credentials(actor)
  await page.getByPlaceholder('tu@correo.com').fill(email)
  await page.getByPlaceholder('••••••••').fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.waitForURL(`**/${PORTAL_URL[actor]}`, { timeout: 30_000 })
  await page.getByRole('button', { name: 'Perfil', exact: true }).waitFor({ timeout: 60_000 }) // cold dev server
  await page.waitForLoadState('networkidle')
  return page
}
const keys = (page) => page.evaluate(() => Object.keys(localStorage).sort())
const ours = async (page) => (await keys(page)).filter((k) => OURS.test(k))
// Data left on the device: muten:*/dd:* entries holding something. Muten rewrites the logged-out auth
// state (empty strings, false) when the app boots again, and UI preferences are allowed, so neither counts.
const EMPTY = new Set(['""', 'false', '[]', 'null', '0'])
const leftover = (page) => page.evaluate(([ours, prefs, empty]) => Object.entries(localStorage)
  .filter(([k, v]) => new RegExp(ours).test(k) && !new RegExp(prefs).test(k) && !empty.includes(v)).map(([k]) => k), [OURS.source, /^muten:(i18n|calendario):/.source, [...EMPTY]])
const purged = (page) => until(async () => page.url().endsWith('/login') && (await leftover(page)).length === 0)
// The app is controlled by the service worker only after it activates: reload once online so the
// shell is cached, as it is for a real returning user, then go offline and reload.
async function goOffline(page) {
  await page.context().setOffline(true)
  await page.evaluate(() => { sessionStorage.setItem('pw_offline', '1'); window.dispatchEvent(new Event('offline')) })
}
async function goOnline(page) {
  await page.evaluate(() => sessionStorage.removeItem('pw_offline'))
  await page.context().setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
}
async function warm(page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
  await page.reload()
  await page.waitForLoadState('networkidle')
}
async function offlineReload(page) {
  await warm(page)
  await goOffline(page)
  await page.reload()
}
const dump = (page) => page.evaluate(() => JSON.stringify(Object.entries(localStorage)))
const toasts = (page) => page.evaluate(() => window.__toasts || [])
const until = async (fn, ms = 20_000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await new Promise((r) => setTimeout(r, 300)) } }
const dayLoaded = (page) => until(async () => (await dump(page)).includes('Rex'))
const outbox = (page) => page.evaluate(() => localStorage.getItem('dd:outbox') || '[]')
const uidOf = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null')?.user?.id || '', sbKey)
const seedOp = (page, uid, params) => page.evaluate(([uid, params]) => localStorage.setItem('dd:outbox', JSON.stringify([{ kind: 'rpc', name: 'paseo_marcar', params, uid, at: Date.now() }])), [uid, params])
async function logout(page) {
  await page.getByRole('button', { name: 'Perfil', exact: true }).click()
  await page.getByRole('button', { name: /Cerrar sesión/ }).click()
}

test('CC-1a: the walker keeps only the day agenda (schedule, dog name, status) and the session on the device', async () => {
  const page = await loginAs('WALKER_CO')
  assert.ok(await dayLoaded(page), 'precondition: the day agenda was persisted')
  const k = await ours(page)
  assert.ok(k.includes('muten:grupos:perrosHoy'), 'precondition: the agenda key exists')
  for (const key of k) assert.ok(PREFS.test(key) || WALKER_DAY.test(key) || key === 'dd:outbox', `unexpected key ${key}`)
  const all = await dump(page)
  for (const v of Object.values(PHONE)) assert.ok(!all.includes(v), `${v} is on the device`)
  assert.ok(!/precio|salario|cobrado|codigo|invitaci/i.test(all), 'a price, salary or code is on the device')
  assert.deepEqual(await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).filter((n) => !/^(sb-|supabase)/i.test(n || ''))), [], 'no IndexedDB data')
  await page.close()
})

test('CC-1c: the walker opens the app offline and the agenda with the dog name renders', async () => {
  const page = await loginAs('WALKER_CO')
  assert.ok(await dayLoaded(page))
  await offlineReload(page)
  await page.getByRole('button', { name: 'Abrir modo paseo' }).first().click({ timeout: 20_000 })
  assert.ok(await page.getByText('Rex').first().waitFor({ timeout: 10_000 }).then(() => true, () => false), 'the dog name renders offline')
  assert.ok(await page.getByText('Programado', { exact: true }).first().isVisible(), 'and its status')
  await page.close()
})

test('CC-1d and CC-1e: owner, office and client keep no application data and show a connection notice offline', async () => {
  for (const actor of ['OWNER', 'OFFICE', 'CLIENT']) {
    const page = await loginAs(actor)
    await page.waitForTimeout(1500) // let the lazy persistence run
    for (const key of await ours(page)) assert.ok(PREFS.test(key), `${actor}: application data key ${key}`)
    assert.ok((await keys(page)).includes(sbKey), `${actor}: precondition, the session is stored`)
    const all = await dump(page)
    for (const v of Object.values(PHONE)) assert.ok(!all.includes(v), `${actor}: ${v} is on the device`)
    await offlineReload(page)
    assert.ok(await page.getByText('Se necesita conexión').first().waitFor({ timeout: 20_000 }).then(() => true, () => false), `${actor}: connection notice`)
    for (const text of ['Rex', 'Walker Co', PHONE.CLIENT]) assert.equal(await page.getByText(text).count(), 0, `${actor}: cached "${text}" is shown offline`)
    await page.close()
  }
})

test('CC-2a: signing out leaves no muten:* or dd:* key, for every portal', async () => {
  for (const actor of ['WALKER_CO', 'OWNER', 'CLIENT']) {
    const page = await loginAs(actor)
    assert.ok((await ours(page)).length > 0, `${actor}: precondition, keys exist`)
    await logout(page)
    assert.ok(await purged(page), `${actor}: the device is purged`)
    assert.deepEqual(await leftover(page), [], `${actor}: data left after sign-out`)
    assert.ok(!(await keys(page)).includes('dd:outbox'))
    await page.close()
  }
})

test('CC-2b: an offline start with an expired token keeps the agenda; a rejected refresh online purges everything', async () => {
  const page = await loginAs('WALKER_CO')
  assert.ok(await dayLoaded(page))
  await warm(page)
  await page.evaluate((key) => {
    const s = JSON.parse(localStorage.getItem(key))
    localStorage.setItem(key, JSON.stringify({ ...s, expires_at: 1, refresh_token: 'revoked-refresh-token' }))
  }, sbKey)
  await goOffline(page)
  await page.reload()
  await page.waitForTimeout(3000)
  assert.ok((await ours(page)).includes('muten:grupos:perrosHoy'), 'the agenda survives an offline start with an expired token')
  assert.ok(!page.url().endsWith('/login'))
  await goOnline(page)
  await page.reload()
  assert.ok(await purged(page), 'a rejected refresh must purge')
  assert.deepEqual(await leftover(page), [])
  await page.close()
})

test('CC-2c: signing out with unsent changes asks first and keeps them until confirmed', async () => {
  const page = await loginAs('WALKER_CO')
  const uid = await uidOf(page)
  assert.ok(uid, 'precondition: user id')
  await warm(page) // the purge reloads /login: offline that comes from the service worker cache
  await goOffline(page) // so the queue is not flushed
  await seedOp(page, uid, { p_ids: [GHOST], p_estado: 'en_curso' })
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('dd:outbox')))
  await logout(page)
  assert.ok(await page.getByText(/1 sin enviar/).first().waitFor({ timeout: 10_000 }).then(() => true, () => false), 'confirmation names the unsent count')
  assert.ok((await ours(page)).includes('dd:outbox'), 'nothing is purged before the confirmation')
  assert.ok(!page.url().endsWith('/login'))
  await page.getByRole('button', { name: /Descartar y salir/ }).click()
  assert.ok(await purged(page), 'confirmed sign-out purges the queue too, even offline')
  assert.ok(!(await keys(page)).includes('dd:outbox'))
  await page.close()
})

test('CC-2d: the next user on the same device sees none of the previous data and replays none of the previous queue', async () => {
  const a = await loginAs('WALKER_CO')
  assert.ok(await dayLoaded(a))
  const uidA = await uidOf(a)
  // A's token vanishes without a sign-out (expiry, storage cleared): the next start must purge.
  await a.evaluate((key) => localStorage.removeItem(key), sbKey)
  await a.goto(`${app.url}/login`)
  assert.ok(await purged(a), 'A data purged when the session is gone')
  // An op of A that somehow survived (parked) must not be replayed by B.
  await seedOp(a, uidA, { p_ids: [GHOST], p_estado: 'en_curso' })
  const { email, password } = credentials('WALKER_CO2')
  await a.getByPlaceholder('tu@correo.com').fill(email)
  await a.getByPlaceholder('••••••••').fill(password)
  await a.getByRole('button', { name: 'Entrar', exact: true }).click()
  await a.waitForURL('**/app', { timeout: 30_000 })
  await a.evaluate(() => window.dispatchEvent(new Event('online')))
  await a.waitForTimeout(3000)
  assert.ok(!a.requests.some((u) => u.includes('/rpc/paseo_marcar')), "B replayed A's operation")
  assert.equal(await a.getByText('Rex').count(), 0, "A's dog is visible to B")
  assert.ok(!(await dump(a)).includes('Rex'), "A's data is on the device")
  assert.equal(await a.getByText(/sin enviar/).count(), 0, "A's parked op is invisible to B")
  await a.close()
})

test('CC-3a and CC-3c: start and finish queued offline, applied in order on reconnect, queue empty afterwards', async () => {
  await resetWalk()
  const page = await loginAs('WALKER_CO')
  assert.ok(await dayLoaded(page))
  await goOffline(page)
  await page.getByRole('button', { name: 'Abrir modo paseo' }).first().click()
  await page.getByRole('button', { name: 'Iniciar paseo' }).click()
  await page.getByRole('button', { name: 'Finalizar paseo' }).click()
  const queued = JSON.parse(await outbox(page))
  assert.deepEqual(queued.map((o) => o.params.p_estado), ['en_curso', 'finalizado'], 'queued in order')
  assert.ok(queued.every((o) => o.uid === ids.users.WALKER_CO), 'every op is tagged with the user')
  assert.equal((await admin().from('prestaciones').select('estado').eq('id', ids.prestaciones.p1).single()).data.estado, 'programado', 'nothing reached the server yet')
  await goOnline(page)
  assert.ok(await until(async () => (await admin().from('prestaciones').select('estado').eq('id', ids.prestaciones.p1).single()).data.estado === 'finalizado'), 'the finish was applied on reconnect')
  assert.ok(await until(async () => (await outbox(page)) === '[]'), 'CC-3c: the queue is empty after syncing')
  assert.ok((await toasts(page)).includes('Sincronizado ✓'))
  await page.close()
})

test('a change the server rejects is counted and reported, never shown as synced', async () => {
  const page = await loginAs('WALKER_CO')
  const uid = await uidOf(page)
  await goOffline(page)
  await seedOp(page, uid, { p_ids: [GHOST], p_estado: 'basura' })
  await goOnline(page)
  assert.ok(await until(async () => (await toasts(page)).some((t) => /no se pudo/i.test(t))), 'the rejection is reported')
  assert.ok(!(await toasts(page)).includes('Sincronizado ✓'), 'a rejected change is never reported as synced')
  assert.equal(await outbox(page), '[]', 'a rejected op leaves the queue')
  await page.close()
})

test('CC-5b: the production bundle under the real CSP boots, registers its worker, logs in and nothing is blocked', async () => {
  const bundle = await startApp({ bundle: true }) // the dev server injects inline scripts of its own
  try {
    const violations = []
    const page = await bundle.newPage({ csp: true })
    await page.addInitScript(() => {
      window.__csp = []
      document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`))
    })
    page.on('console', (m) => { if (/content security policy/i.test(m.text())) violations.push(m.text()) })
    await page.goto(`${bundle.url}/login`)
    const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
    assert.match(policy, /script-src 'self';/, 'the CSP meta is in the page')
    assert.ok(readFileSync(new URL('../../dist/index.html', import.meta.url), 'utf8').includes(`content="${CSP}"`), 'dist/index.html (npm run build) carries exactly the configured CSP')
    assert.ok(await page.evaluate(() => navigator.serviceWorker.ready.then(() => true)), 'the service worker registers under worker-src self')
    await page.getByRole('link', { name: 'Regístrate' }).click() // signup renders (SPA navigation: the CSP rewrite only covers documents)
    await page.waitForURL('**/signup')
    await page.goBack()
    const { email, password } = credentials('WALKER_CO')
    await page.getByPlaceholder('tu@correo.com').fill(email)
    await page.getByPlaceholder('••••••••').fill(password)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await page.waitForURL('**/app', { timeout: 30_000 })
    await page.getByRole('button', { name: 'Perfil', exact: true }).waitFor()
    await page.waitForLoadState('networkidle')
    assert.ok(await dayLoaded(page), 'data loaded through the policy (REST + auth)')
    await page.getByRole('button', { name: 'Abrir modo paseo' }).first().click()
    await page.getByRole('button', { name: 'Cerrar', exact: true }).first().click()
    await page.waitForTimeout(1000)
    violations.push(...(await page.evaluate(() => window.__csp)))
    assert.deepEqual(violations, [], 'CSP violations')
    await page.close()
  } finally {
    await bundle.stop()
  }
})
