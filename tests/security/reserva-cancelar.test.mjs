// A client cancels a scheduled service of its own dog before it starts, through reserva_cancelar only: an
// active owner of the dog (principal or co-owner), estado 'programado', from today (Bogotá) on, never a
// product. The server stamps who ('cliente') and when. The charge row stays and is never payable, and only
// 'finalizado' services reach the balance, so a cancelled booking is never charged in the app; any fee is
// the business's own policy. The walker cannot start it afterwards.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, ids, seed, writePrestaciones } from './_actors.mjs'
import { withUser } from './_invites.mjs'
import { sql } from './_sql.mjs'

const u = ids.users
const { A } = ids.negocios
const { d1, d3 } = ids.perros
// Bogota calendar day (UTC-5, no DST), the clock the RPCs use.
const hoy = (n = 0) => new Date(Date.now() - 5 * 36e5 + n * 864e5).toISOString().slice(0, 10)
const made = []
async function booking(extra = {}) {
  const res = await writePrestaciones({
    negocio_id: A, perro_id: d1, servicio_id: ids.servicios.banoA, tipo: 'bano', fecha: hoy(3), estado: 'programado',
    precio_aplicado: 30000, detalle: { hora: '09:00' }, ...extra,
  })
  made.push(res.data[0].id)
  return res.data[0].id
}
const cancel = async (actor, id) => (typeof actor === 'string' ? await as(actor) : actor).rpc('reserva_cancelar', { p_id: id })
const row = async (id) => (await admin().from('prestaciones').select('estado, detalle, cobros(cobrable, cobrado, precio_aplicado)').eq('id', id).single()).data
const denied = (res, who) => assert.equal(res.error?.code, '42501', `${who}: expected 42501, got ${res.error?.code ?? 'no error'}`)
const refused = (res, what) => assert.match(res.error?.message ?? 'no error', /reserva_no_cancelable/, what)

before(seed, { timeout: 120_000 })
after(() => admin().from('prestaciones').delete().in('id', made))

test('RC-1: the principal owner cancels a future scheduled booking; the server records who and when', async () => {
  const id = await booking()
  const t0 = Date.now()
  assert.equal((await cancel('CLIENT', id)).error, null)
  const r = await row(id)
  assert.equal(r.estado, 'cancelado')
  assert.equal(r.detalle.hora, '09:00', 'the rest of detalle stays')
  assert.equal(r.detalle.cancelado_por, 'cliente')
  assert.ok(Math.abs(new Date(r.detalle.cancelado_at) - t0) < 5 * 60_000, `cancelado_at ${r.detalle.cancelado_at} is not now()`)
  refused(await cancel('CLIENT', id), 'a cancelled booking cannot be cancelled again')
})

test('RC-2: a co-owner can cancel too, and a booking for later today still can be cancelled', async () => {
  const id = await booking({ fecha: hoy(0), detalle: { hora: '23:59' } })
  assert.equal((await cancel('COOWNER', id)).error, null)
  assert.equal((await row(id)).estado, 'cancelado')
})

test('RC-3: anyone who does not own the dog is denied (42501) and nothing changes', async () => {
  const id = await booking()
  for (const who of ['CLIENT2', 'CLIENT3', 'OWNER', 'OFFICE', 'WALKER_CO', 'OTHER', 'CLIENT_I']) denied(await cancel(who, id), who)
  await withUser(async (nobody) => denied(await cancel(nobody.client, id), 'no profile'))
  assert.ok((await cancel('ANON', id)).error, 'anon cannot call it')
  denied(await cancel('CLIENT', '00000000-0000-4000-8000-000000000000'), 'unknown id looks like a foreign one')
  // CLIENT2 owns d3: its own booking is fine, CLIENT's is not.
  const own = await booking({ perro_id: d3 })
  assert.equal((await cancel('CLIENT2', own)).error, null)
  assert.equal((await row(id)).estado, 'programado')
})

test('RC-4: only a scheduled, not past service can be cancelled; never a started, finished, missed or past one, or a product', async () => {
  for (const [what, extra] of [
    ['en_curso', { fecha: hoy(0), estado: 'en_curso' }], ['finalizado', { fecha: hoy(0), estado: 'finalizado' }],
    ['no_asistio', { fecha: hoy(0), estado: 'no_asistio' }], ['yesterday', { fecha: hoy(-1) }],
    ['today, its time already passed', { fecha: hoy(0), detalle: { hora: '00:00' } }],
    ['a product', { tipo: 'comida', servicio_id: null }],
  ]) {
    const id = await booking(extra)
    const before_ = await row(id)
    refused(await cancel('CLIENT', id), what)
    assert.deepEqual(await row(id), before_, what)
  }
})

test('RC-5: a cancelled booking is never charged: its charge is not payable and it does not count as finished', async () => {
  const id = await booking({ fecha: hoy(0), cuidador_id: u.WALKER_CO, detalle: { hora: '23:59' } })
  assert.equal((await cancel('CLIENT', id)).error, null)
  assert.deepEqual((await row(id)).cobros, { cobrable: true, cobrado: false, precio_aplicado: 30000 }, 'the charge row is untouched')
  assert.match((await (await as('OWNER')).rpc('cobro_marcar', { p_prestacion: id })).error?.message ?? 'no error', /no_cobrable/)
  // The balance (saldo / estado de cuenta) and the pending charges only sum 'finalizado' services.
  const fin = (await (await as('CLIENT')).from('prestaciones').select('id').eq('id', id).eq('estado', 'finalizado')).data
  assert.deepEqual(fin, [])
  // The walker cannot start or finish it afterwards.
  for (const estado of ['en_curso', 'finalizado']) {
    assert.equal((await (await as('WALKER_CO')).rpc('paseo_marcar', { p_ids: [id], p_estado: estado })).error, null, estado)
  }
  assert.equal((await row(id)).estado, 'cancelado')
})

test('RC-6: reserva_cancelar is definer with an empty search_path, authenticated only; owners still cannot update bookings directly', async () => {
  const [f] = sql(`select p.prosecdef as definer, p.proconfig @> array['search_path=""'] as pinned,
      has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'reserva_cancelar'`)
  assert.deepEqual(f, { definer: true, pinned: true, anon: false, auth: true })
  const id = await booking()
  const res = await (await as('CLIENT')).from('prestaciones').update({ estado: 'cancelado' }).eq('id', id).select('id')
  assert.deepEqual(res.data ?? [], [])
  assert.equal((await row(id)).estado, 'programado')
})
