// S5a photo metadata (paseo_fotos) and per-dog tags (paseo_foto_perros): registration limits (P5),
// audience = uploader + active owners of a tagged dog (WP-3a, WP-4a-e), 30-day cut-off (WP-6a/b),
// writes only through RPCs, definer hygiene. Fixtures: throwaway walks of WALKER_CO on d1 and d3.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, ids, seed, writePrestaciones } from './_actors.mjs'
import { sql } from './_sql.mjs'

const u = ids.users
const d = ids.perros
const hoy = (n = 0) => new Date(Date.now() - 5 * 36e5 + n * 864e5).toISOString().slice(0, 10) // Bogota date
const ago = (days) => new Date(Date.now() - days * 864e5).toISOString()
const denied = (res, what = '') => assert.equal(res.error?.code, '42501', `${what} expected 42501, got ${res.error?.code ?? 'no error'}`)
const fails = (res, code) => assert.match(res.error?.message ?? 'no error', new RegExp(code))
const created = { walks: [], fotos: [] }

before(() => seed())
after(async () => {
  await admin().from('paseo_fotos').delete().in('id', created.fotos)
  await admin().from('prestaciones').delete().in('id', created.walks)
  await admin().from('perro_duenos').upsert({ perro_id: d.d1, dueno_id: u.COOWNER, rol: 'co', estado: 'activo' })
})

// Each fixture walk is its own outing (its own hora): the Ley 2480 cap of 8 dogs per walker and outing
// (trg_prestacion_ley_kiara) is not what these photo tests are about.
let outing = 0
async function walk(dog = d.d1, spec = {}) {
  const ind = dog === d.dI
  const { data } = await writePrestaciones({
    negocio_id: ind ? ids.negocios.I : ids.negocios.A, perro_id: dog, tipo: 'paseo', servicio_id: ind ? null : ids.servicios.paseoA,
    cuidador_id: ind ? u.WALKER_IND : u.WALKER_CO, fecha: hoy(), estado: 'en_curso', precio_aplicado: 0,
    detalle: { hora: `fixture-${++outing}` }, ...spec,
  })
  created.walks.push(data[0].id)
  return data[0].id
}
const registrar = async (actor, ps) => (await as(actor)).rpc('foto_registrar', { p_prestaciones: ps })
async function foto(actor, ps) {
  const res = await registrar(actor, ps)
  assert.equal(res.error, null, res.error?.message)
  created.fotos.push(res.data)
  return res.data
}
// A photo as the Worker would leave it: registered, authorized and confirmed by the uploader.
async function listo(actor, ps, bytes = 1234) {
  const id = await foto(actor, ps)
  const client = await as(actor)
  assert.equal((await client.rpc('foto_subida_autorizar', { p_id: id })).error, null)
  assert.equal((await client.rpc('foto_confirmar', { p_id: id, p_bytes: bytes })).error, null)
  return id
}
// A row written by the service role at an arbitrary age (capture time `days` ago, 30-day expiry).
async function viejo(days, perro = d.d1) {
  const id = crypto.randomUUID()
  created.fotos.push(id)
  const row = { id, negocio_id: ids.negocios.A, subido_por: u.WALKER_CO, estado: 'lista', bytes: 10, created_at: ago(days), expires_at: ago(days - 30) }
  assert.equal((await admin().from('paseo_fotos').insert(row)).error, null)
  const p = await walk(perro)
  assert.equal((await admin().from('paseo_foto_perros').insert({ foto_id: id, prestacion_id: p, perro_id: perro, subido_por: u.WALKER_CO })).error, null)
  return id
}
const seen = async (actor, table, id, col = 'id') => {
  const res = await (await as(actor)).from(table).select('*').eq(col, id)
  return res.error ? res.error.code : res.data
}

// ---- WP-4a-d: the audience of a photo tagged d1 and d3 ----------------------------------------------
test('WP-4a/4b/4d: only the uploader and the owners of a tagged dog read the photo and their own tag', async () => {
  const id = await listo('WALKER_CO', [await walk(d.d1), await walk(d.d3)])
  const reads = { WALKER_CO: [d.d1, d.d3], CLIENT: [d.d1], COOWNER: [d.d1], CLIENT2: [d.d3] }
  for (const [actor, dogs] of Object.entries(reads)) {
    const rows = await seen(actor, 'paseo_fotos', id)
    assert.deepEqual(rows.map((r) => r.id), [id], `${actor} must see the photo`)
    assert.deepEqual(rows[0].estado, 'lista')
    const tags = await seen(actor, 'paseo_foto_perros', id, 'foto_id')
    assert.deepEqual(tags.map((t) => t.perro_id).sort(), dogs.sort(), `${actor} tags`)
    assert.ok(tags.every((t) => t.subido_por === u.WALKER_CO))
  }
  // Group-mate's owner, business owner, office, other walkers, other tenants, no profile: nothing.
  for (const actor of ['CLIENT3', 'OWNER', 'OFFICE', 'OFFICE_FIN', 'WALKER_CO2', 'WALKER_IND', 'CLIENT_I', 'OTHER', 'NOPROFILE']) {
    assert.deepEqual(await seen(actor, 'paseo_fotos', id), [], `${actor} must not see the photo`)
    assert.deepEqual(await seen(actor, 'paseo_foto_perros', id, 'foto_id'), [], `${actor} must not see tags`)
    assert.equal((await (await as(actor)).rpc('can_see_foto', { p_id: id })).data, false, `${actor} can_see_foto`)
  }
  assert.equal((await (await as('CLIENT')).rpc('can_see_foto', { p_id: id })).data, true)
  for (const table of ['paseo_fotos', 'paseo_foto_perros']) denied(await (await as('ANON')).from(table).select('*'), `ANON ${table}`)
  denied(await (await as('ANON')).rpc('can_see_foto', { p_id: id }))
})

test('WP-4c: an owner link that was removed grants nothing, a pending photo is hidden from owners', async () => {
  const id = await listo('WALKER_CO', [await walk(d.d1)])
  const pendiente = await foto('WALKER_CO', [await walk(d.d1)])
  assert.deepEqual((await seen('COOWNER', 'paseo_fotos', id)).map((r) => r.id), [id])
  assert.deepEqual(await seen('CLIENT', 'paseo_fotos', pendiente), [], 'owners never see a photo that is not uploaded')
  assert.deepEqual((await seen('WALKER_CO', 'paseo_fotos', pendiente)).map((r) => r.estado), ['pendiente'])
  assert.equal((await admin().from('perro_duenos').delete().eq('perro_id', d.d1).eq('dueno_id', u.COOWNER)).error, null)
  try {
    assert.deepEqual(await seen('COOWNER', 'paseo_fotos', id), [])
    assert.equal((await (await as('COOWNER')).rpc('can_see_foto', { p_id: id })).data, false)
  } finally {
    await admin().from('perro_duenos').upsert({ perro_id: d.d1, dueno_id: u.COOWNER, rol: 'co', estado: 'activo' })
  }
})

test('WP-4e: an independent walker is uploader and owner of the tenant; the tenant-A owner is nobody', async () => {
  const id = await listo('WALKER_IND', [await walk(d.dI)])
  assert.equal((await seen('WALKER_IND', 'paseo_fotos', id)).length, 1)
  assert.equal((await seen('CLIENT_I', 'paseo_fotos', id)).length, 1, 'the dog owner of tenant I reads it')
  for (const actor of ['OWNER', 'CLIENT', 'WALKER_CO']) assert.deepEqual(await seen(actor, 'paseo_fotos', id), [], actor)
})

// ---- WP-6a/6b: 30-day cut-off -----------------------------------------------------------------------
for (const [label, days, visible] of [['31 days old', 31, false], ['29 days old', 29, true]]) {
  test(`WP-6${visible ? 'b' : 'a'}: a photo ${label} is ${visible ? 'served to' : 'hidden from'} its owner`, async () => {
    const id = await viejo(days)
    assert.deepEqual((await seen('CLIENT', 'paseo_fotos', id)).map((r) => r.id), visible ? [id] : [])
    // The uploader loses it at the same moment (expiry is audience-wide).
    assert.equal((await seen('WALKER_CO', 'paseo_fotos', id)).length, visible ? 1 : 0)
  })
}

test('retention: expires_at defaults to 30 days and can never exceed them; registering purges expired rows', async () => {
  const id = await foto('WALKER_CO', [await walk(d.d1)])
  const row = (await admin().from('paseo_fotos').select('created_at, expires_at, estado, negocio_id, subido_por').eq('id', id).single()).data
  const span = (Date.parse(row.expires_at) - Date.parse(row.created_at)) / 864e5
  assert.ok(span > 29.99 && span <= 30, `expires_at span ${span} days`)
  assert.deepEqual([row.estado, row.negocio_id, row.subido_por], ['pendiente', ids.negocios.A, u.WALKER_CO])
  const tooLong = await admin().from('paseo_fotos').insert({ negocio_id: ids.negocios.A, subido_por: u.WALKER_CO, expires_at: ago(-40) })
  assert.equal(tooLong.error?.code, '23514')
  const stale = await viejo(31)
  await foto('WALKER_CO', [await walk(d.d1)])
  assert.deepEqual((await admin().from('paseo_fotos').select('id').eq('id', stale)).data, [], 'the expired row survived the purge')
  assert.deepEqual((await admin().from('paseo_foto_perros').select('foto_id').eq('foto_id', stale)).data, [], 'its tags survived')
})

// ---- foto_registrar (P5, WP-3a) ---------------------------------------------------------------------
test('WP-3a: only the assigned walker registers a photo, and one foreign id denies the batch', async () => {
  const mine = await walk(d.d1)
  const theirs = await walk(d.d3, { cuidador_id: u.WALKER_CO2 })
  for (const actor of ['CLIENT', 'WALKER_CO2', 'OWNER', 'OFFICE', 'OTHER', 'NOPROFILE', 'COOWNER']) denied(await registrar(actor, [mine]), actor)
  denied(await registrar('WALKER_CO', [mine, theirs]), 'mixed batch')
  denied(await registrar('ANON', [mine]), 'ANON')
  denied(await registrar('WALKER_CO', [crypto.randomUUID()]), 'unknown walk')
  const id = await foto('WALKER_CO', [mine, mine]) // a repeated id is one tag
  assert.equal((await admin().from('paseo_foto_perros').select('perro_id').eq('foto_id', id)).data.length, 1)
})

test('P5: 1..12 tags; only en_curso/finalizado walks of today or yesterday', async () => {
  const one = await walk(d.d1)
  for (const ps of [[], null, Array.from({ length: 13 }, () => crypto.randomUUID()), [one, null]]) fails(await registrar('WALKER_CO', ps), 'ids_invalidos')
  const cases = [
    ['programado', { estado: 'programado' }, 'estado_invalido'], ['no_asistio', { estado: 'no_asistio' }, 'estado_invalido'],
    ['two days ago', { fecha: hoy(-2) }, 'fuera_de_ventana'], ['tomorrow', { fecha: hoy(1) }, 'fuera_de_ventana'],
  ]
  for (const [label, spec, code] of cases) fails(await registrar('WALKER_CO', [await walk(d.d1, spec)]), code)
  await foto('WALKER_CO', [await walk(d.d1, { estado: 'finalizado', fecha: hoy(-1) })]) // allowed edge
  const twelve = await Promise.all(Array.from({ length: 12 }, () => walk(d.d3)))
  const id = await foto('WALKER_CO', twelve)
  assert.equal((await admin().from('paseo_foto_perros').select('perro_id').eq('foto_id', id)).data.length, 12)
})

test('P5: at most 10 photos per prestacion', async () => {
  const p = await walk(d.d1)
  for (let i = 0; i < 10; i++) await foto('WALKER_CO', [p])
  fails(await registrar('WALKER_CO', [p]), 'demasiadas_fotos')
  fails(await registrar('WALKER_CO', [await walk(d.d3), p]), 'demasiadas_fotos')
})

// ---- foto_subida_autorizar / foto_confirmar ---------------------------------------------------------
test('upload authorization is for the uploader only, once, and returns the server-chosen key', async () => {
  const id = await foto('WALKER_CO', [await walk(d.d1)])
  for (const actor of ['CLIENT', 'WALKER_CO2', 'OWNER', 'OFFICE', 'OTHER', 'NOPROFILE', 'ANON']) denied(await (await as(actor)).rpc('foto_subida_autorizar', { p_id: id }), actor)
  denied(await (await as('WALKER_CO')).rpc('foto_subida_autorizar', { p_id: crypto.randomUUID() }), 'unknown id')
  denied(await (await as('WALKER_CO')).rpc('foto_subida_autorizar', { p_id: null }), 'null id')
  const mine = await as('WALKER_CO')
  assert.equal((await mine.rpc('foto_subida_autorizar', { p_id: id })).data, `f/${ids.negocios.A}/${id}.jpg`)
  for (const bytes of [0, -1, null, 2 * 1024 * 1024 + 1]) assert.ok((await mine.rpc('foto_confirmar', { p_id: id, p_bytes: bytes })).error, `bytes ${bytes}`)
  for (const actor of ['CLIENT', 'WALKER_CO2', 'OWNER']) denied(await (await as(actor)).rpc('foto_confirmar', { p_id: id, p_bytes: 10 }), actor)
  assert.equal((await mine.rpc('foto_confirmar', { p_id: id, p_bytes: 2 * 1024 * 1024 })).error, null)
  assert.deepEqual((await admin().from('paseo_fotos').select('estado, bytes').eq('id', id).single()).data, { estado: 'lista', bytes: 2 * 1024 * 1024 })
  denied(await mine.rpc('foto_subida_autorizar', { p_id: id }), 'a second upload would overwrite')
  denied(await mine.rpc('foto_confirmar', { p_id: id, p_bytes: 10 }), 'a second confirm')
  const expired = await viejo(31)
  await admin().from('paseo_fotos').update({ estado: 'pendiente' }).eq('id', expired)
  denied(await mine.rpc('foto_subida_autorizar', { p_id: expired }), 'expired')
})

// ---- writes only through RPCs; catalog --------------------------------------------------------------
test('direct writes to both tables are denied to every role; RLS is on', async () => {
  const id = await listo('WALKER_CO', [await walk(d.d1)])
  for (const actor of ['WALKER_CO', 'CLIENT', 'OWNER']) {
    const db = await as(actor)
    denied(await db.from('paseo_fotos').insert({ negocio_id: ids.negocios.A, subido_por: u[actor] }), `${actor} insert`)
    denied(await db.from('paseo_fotos').update({ estado: 'pendiente' }).eq('id', id), `${actor} update`)
    denied(await db.from('paseo_fotos').delete().eq('id', id), `${actor} delete`)
    denied(await db.from('paseo_foto_perros').insert({ foto_id: id, prestacion_id: crypto.randomUUID(), perro_id: d.d3, subido_por: u[actor] }), `${actor} tag insert`)
    denied(await db.from('paseo_foto_perros').delete().eq('foto_id', id), `${actor} tag delete`)
  }
  const rls = sql(`select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname in ('paseo_fotos', 'paseo_foto_perros') order by 1`)
  assert.deepEqual(rls.map((r) => [r.relname, r.relrowsecurity]), [['paseo_foto_perros', true], ['paseo_fotos', true]])
})

test('AH-1a: the four photo functions are definer, pinned, closed to anon and open to authenticated', () => {
  const names = ['foto_registrar', 'foto_subida_autorizar', 'foto_confirmar', 'can_see_foto']
  const fns = sql(`select proname, prosecdef, coalesce(proconfig @> array['search_path=""'], false) as pinned,
      has_function_privilege('anon', oid, 'execute') as anon, has_function_privilege('authenticated', oid, 'execute') as auth
    from pg_proc where pronamespace = 'public'::regnamespace and proname = any(array[${names.map((n) => `'${n}'`)}]) order by 1`)
  assert.deepEqual(fns.map((f) => f.proname), [...names].sort())
  for (const f of fns) assert.deepEqual([f.prosecdef, f.pinned, f.anon, f.auth], [true, true, false, true], f.proname)
})
