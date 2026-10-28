// S2b1 walk state machine (C5). A walker changes its walks only through paseo_marcar /
// paseo_no_salio (paseo_agregar_foto was dropped in S5b): valid transitions, dates in [today-1, today]
// (Bogota), never price, paid flag, tenant, dog or assignment. Direct UPDATE is gone.
// AH-6a (baseline exploit) lives in baseline-data.test.mjs.
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, ids, seed, writePrestaciones } from './_actors.mjs'

before(() => seed())

const u = ids.users
// Date in Bogota (UTC-5, no DST), the clock the RPCs use. `day()` in _actors is UTC.
const hoy = (n = 0) => new Date(Date.now() - 5 * 36e5 + n * 864e5).toISOString().slice(0, 10)
const denied = (res) => assert.equal(res.error?.code, '42501', `expected permission denied, got ${res.error?.code ?? 'no error'}`)
const row = async (id) => (await admin().from('prestaciones').select('*').eq('id', id).single()).data
const PROTECTED = ['negocio_id', 'perro_id', 'servicio_id', 'tipo', 'cuidador_id', 'fecha']
const guarded = (r) => Object.fromEntries(PROTECTED.map((k) => [k, r[k]]))

// Throwaway walks of WALKER_CO on dog d2, so the shared fixtures are never touched.
async function walks(specs, fn) {
  const base = {
    negocio_id: ids.negocios.A, perro_id: ids.perros.d2, tipo: 'paseo', servicio_id: ids.servicios.paseoA,
    cuidador_id: u.WALKER_CO, precio_aplicado: 20000, cobrable: true, cobrado: false, detalle: { hora: '08:00' },
  }
  const { data } = await writePrestaciones(specs.map((s) => ({ fecha: hoy(), estado: 'programado', ...base, ...s })))
  try {
    return await fn(data.map((r) => r.id), data)
  } finally {
    await admin().from('prestaciones').delete().in('id', data.map((r) => r.id))
  }
}
const one = (specs, fn) => walks([specs], (ids_, data) => fn(ids_[0], data[0]))
const marcar = async (actor, p_ids, p_estado, p_nota) => (await as(actor)).rpc('paseo_marcar', { p_ids: [].concat(p_ids), p_estado, p_nota })
const noSalio = async (actor, p_id, p_motivo) => (await as(actor)).rpc('paseo_no_salio', { p_id, p_motivo })

// ---- AH-6a, AH-6c: the table is closed to walkers -------------------------------------------
test('AH-6a/6c: WALKER_CO cannot update any column of its walk, nor delete it', () =>
  one({}, async (id, before) => {
    const walker = await as('WALKER_CO')
    assert.equal((await walker.from('prestaciones').select('id').eq('id', id)).data.length, 1, 'the walker must see its own walk')
    for (const patch of [
      { cuidador_id: u.WALKER_CO2 }, { fecha: hoy(30) }, { perro_id: ids.perros.d3 }, { estado: 'finalizado' }, { detalle: { fotos: ['x'] } },
    ]) {
      const res = await walker.from('prestaciones').update(patch).eq('id', id).select('id')
      assert.deepEqual(res.data, [], `${Object.keys(patch)[0]}: the update matched the walk`)
    }
    assert.deepEqual((await walker.from('prestaciones').delete().eq('id', id).select('id')).data, [])
    // Price and paid flag live in cobros: the walker neither reads nor changes them.
    assert.equal((await walker.from('cobros').update({ precio_aplicado: 1, cobrado: true }).eq('prestacion_id', id).select('prestacion_id')).error?.code, '42501')
    assert.deepEqual(await row(id), before)
  }))

// ---- AH-6b, CC-3b: only the assigned walker --------------------------------------------------
for (const actor of ['WALKER_CO2', 'CLIENT', 'OFFICE', 'OWNER', 'OTHER', 'NOPROFILE']) {
  test(`AH-6b: ${actor} cannot start, finish or flag a walk it is not assigned to`, () =>
    one({}, async (id, before) => {
      denied(await marcar(actor, id, 'en_curso'))
      denied(await marcar(actor, id, 'finalizado'))
      denied(await noSalio(actor, id, 'x'))
      assert.deepEqual(await row(id), before)
    }))
}

test('AH-6b: one foreign id denies the whole batch', () =>
  walks([{}, { cuidador_id: u.WALKER_CO2 }], async ([mine, theirs]) => {
    denied(await marcar('WALKER_CO', [mine, theirs], 'en_curso'))
    assert.equal((await row(mine)).estado, 'programado', 'the own row moved although the batch was denied')
    denied(await marcar('WALKER_CO', [mine, '00000000-0000-4000-8000-000000000000'], 'en_curso'))
  }))

test('CC-3b: a replayed finish by a user who is not the assigned walker is denied and changes nothing', () =>
  one({ estado: 'finalizado', detalle: { hora_entrega: '09:00' } }, async (id, before) => {
    denied(await marcar('WALKER_CO2', id, 'finalizado', 'replay'))
    assert.deepEqual(await row(id), before)
  }))

// ---- AH-6d: the legitimate day ----------------------------------------------------------------
test('AH-6d: WALKER_CO starts and finishes a group of walks, with hour markers and a note', () =>
  walks([{}, {}], async (pair) => {
    const start = await marcar('WALKER_CO', pair, 'en_curso')
    assert.equal(start.error, null, start.error?.message)
    for (const id of pair) {
      const r = await row(id)
      assert.equal(r.estado, 'en_curso')
      assert.match(r.detalle.hora_recibido, /^\d\d:\d\d$/)
    }
    const end = await marcar('WALKER_CO', pair, 'finalizado', 'Todo bien')
    assert.equal(end.error, null, end.error?.message)
    for (const id of pair) {
      const r = await row(id)
      assert.equal(r.estado, 'finalizado')
      assert.equal(r.detalle.nota, 'Todo bien')
      assert.match(r.detalle.hora_entrega, /^\d\d:\d\d$/)
      assert.equal(r.detalle.hora, '08:00', 'existing detalle keys must survive')
    }
  }))

test('AH-6d: a no-show with a reason, from programado and from en_curso', () =>
  walks([{}, { estado: 'en_curso' }], async ([a, b]) => {
    assert.equal((await noSalio('WALKER_CO', a, 'Dueno no estaba')).error, null)
    assert.equal((await noSalio('WALKER_CO', b, 'Enfermo')).error, null)
    assert.deepEqual([await row(a), await row(b)].map((r) => [r.estado, r.detalle.motivo_no_salio]), [['no_asistio', 'Dueno no estaba'], ['no_asistio', 'Enfermo']])
  }))

test('AH-6d: the whole day never touches price, paid flag, dog, tenant or assignment', () =>
  one({}, async (id, before) => {
    await marcar('WALKER_CO', id, 'en_curso')
    await marcar('WALKER_CO', id, 'finalizado', 'ok')
    assert.deepEqual(guarded(await row(id)), guarded(before))
  }))

test('AH-6d: a no-show dog never blocks the rest of its group', () =>
  walks([{ estado: 'no_asistio', detalle: { motivo_no_salio: 'Enfermo' } }, { estado: 'en_curso' }], async ([gone, there]) => {
    const res = await marcar('WALKER_CO', [gone, there], 'finalizado')
    assert.equal(res.error, null, res.error?.message)
    assert.deepEqual([(await row(gone)).estado, (await row(there)).estado], ['no_asistio', 'finalizado'])
  }))

test('AH-6d: an offline finish synced the next morning is accepted (yesterday is inside the window)', () =>
  one({ fecha: hoy(-1), estado: 'en_curso' }, async (id) => {
    assert.equal((await marcar('WALKER_CO', id, 'finalizado')).error, null)
    assert.equal((await row(id)).estado, 'finalizado')
  }))

// ---- AH-6e: replay is safe ----------------------------------------------------------------------
test('AH-6e: repeating start, finish and no-show is a no-op success', () =>
  walks([{}, {}], async ([a, b]) => {
    await marcar('WALKER_CO', a, 'en_curso')
    const started = await row(a)
    assert.equal((await marcar('WALKER_CO', a, 'en_curso')).error, null)
    assert.deepEqual(await row(a), started)

    await marcar('WALKER_CO', a, 'finalizado', 'una vez')
    const done = await row(a)
    assert.equal((await marcar('WALKER_CO', a, 'finalizado', 'otra vez')).error, null)
    assert.deepEqual(await row(a), done)
    assert.equal(done.detalle.nota, 'una vez')

    await noSalio('WALKER_CO', b, 'primero')
    const gone = await row(b)
    assert.equal((await noSalio('WALKER_CO', b, 'segundo')).error, null)
    assert.deepEqual(await row(b), gone)
  }))

// ---- transitions and input ------------------------------------------------------------------------
test('invalid transitions raise transicion_invalida and change nothing', () =>
  walks([{}, { estado: 'finalizado' }, { estado: 'finalizado' }, { estado: 'no_asistio' }], async ([prog, fin, fin2, gone]) => {
    for (const [res, id] of [
      [await marcar('WALKER_CO', prog, 'finalizado'), prog],
      [await marcar('WALKER_CO', fin, 'en_curso'), fin],
      [await noSalio('WALKER_CO', fin2, 'tarde'), fin2],
      [await marcar('WALKER_CO', [gone, prog], 'finalizado'), gone],
    ]) assert.match(res.error?.message ?? '', /transicion_invalida/, `${id}: got ${res.error?.message ?? 'no error'}`)
    assert.deepEqual([(await row(prog)).estado, (await row(fin)).estado, (await row(gone)).estado], ['programado', 'finalizado', 'no_asistio'])
  }))

for (const estado of ['programado', 'cancelado', 'recibido', 'basura', null]) {
  test(`paseo_marcar does not accept p_estado=${estado}`, () =>
    one({}, async (id, before) => {
      assert.match((await marcar('WALKER_CO', id, estado)).error?.message ?? '', /estado_invalido/)
      assert.deepEqual(await row(id), before)
    }))
}

for (const [label, fecha, estado] of [['two days ago', hoy(-2), 'en_curso'], ['tomorrow', hoy(1), 'programado'], ['a week ahead', hoy(7), 'programado']]) {
  test(`walks dated ${label} are outside the window`, () =>
    one({ fecha, estado }, async (id, before) => {
      const res = await marcar('WALKER_CO', id, estado === 'programado' ? 'en_curso' : 'finalizado')
      assert.match(res.error?.message ?? '', /fuera_de_ventana/)
      assert.match((await noSalio('WALKER_CO', id, 'x')).error?.message ?? '', /fuera_de_ventana/)
      assert.deepEqual(await row(id), before)
    }))
}

test('notes, reasons and batches are bounded', () =>
  one({}, async (id, before) => {
    assert.match((await marcar('WALKER_CO', id, 'en_curso', 'x'.repeat(501))).error?.message ?? '', /nota_demasiado_larga/)
    assert.match((await noSalio('WALKER_CO', id, 'x'.repeat(501))).error?.message ?? '', /motivo_demasiado_largo/)
    assert.match((await marcar('WALKER_CO', [], 'en_curso')).error?.message ?? '', /ids_invalidos/)
    assert.deepEqual(await row(id), before)
    assert.equal((await marcar('WALKER_CO', id, 'en_curso', 'x'.repeat(500))).error, null, 'a 500 character note is allowed')
  }))

