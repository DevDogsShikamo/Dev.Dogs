// Real reviews (Ley 1480: no invented testimonials). Only an owner (principal or co-owner) of a dog with a
// finished service of the tenant may write one review per tenant through resena_guardar; only the tenant's
// owner moderates it through resena_moderar; the public landing reads resenas_publicas() anonymously, which
// aggregates approved + name-consented reviews only and returns nothing below 3. No direct API write exists.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, day, ids, seed, tempUser, writePrestaciones } from './_actors.mjs'
import { denied, withUser } from './_invites.mjs'
import { sql } from './_sql.mjs'

const u = ids.users
const { A, B } = ids.negocios
const TEXT = 'Muy puntuales y cariñosos con mi perro.'
const ok = ({ error }, what) => assert.equal(error, null, `${what}: ${error?.message}`)
const clean = () => admin().from('resenas').delete().in('negocio_id', Object.values(ids.negocios))
const save = async (actor, args = {}) =>
  (typeof actor === 'string' ? await as(actor) : actor).rpc('resena_guardar', { p_negocio: A, p_rating: 5, p_texto: TEXT, p_publicar_nombre: true, ...args })
const moderate = async (actor, p_id, p_estado = 'aprobada') => (typeof actor === 'string' ? await as(actor) : actor).rpc('resena_moderar', { p_id, p_estado })
const stored = async () => (await admin().from('resenas').select('*').in('negocio_id', [A, B]).order('created_at')).data
const mine = async (autor) => (await admin().from('resenas').select('*').eq('autor_id', autor).eq('negocio_id', A).single()).data
const publicas = async (actor = 'ANON') => {
  const res = await (await as(actor)).rpc('resenas_publicas')
  ok(res, `resenas_publicas as ${actor}`)
  return res.data
}

before(async () => {
  await seed()
  ok(await clean(), 'clean resenas')
})
after(clean)

test('precondition: d1 (CLIENT principal, COOWNER co) has a finished service; d3/d4/d5 have none', async () => {
  const fin = async (perro) => (await admin().from('prestaciones').select('id').eq('perro_id', perro).eq('estado', 'finalizado')).data.length
  assert.ok((await fin(ids.perros.d1)) > 0)
  for (const d of ['d3', 'd4', 'd5']) assert.equal(await fin(ids.perros[d]), 0, d)
})

test('eligibility: CLIENT (principal) and COOWNER (co-owner) of a dog with a finished service can save; the row starts pending', async () => {
  try {
    for (const actor of ['CLIENT', 'COOWNER']) {
      ok(await save(actor, { p_rating: 4, p_publicar_nombre: false }), actor)
      const r = await mine(u[actor])
      assert.deepEqual(
        { rating: r.rating, texto: r.texto, publicar: r.publicar_nombre, estado: r.estado, by: r.moderated_by, at: r.moderated_at },
        { rating: 4, texto: TEXT, publicar: false, estado: 'pendiente', by: null, at: null }, actor)
    }
  } finally { await clean() }
})

test('eligibility: no finished service, wrong role, other tenant or no session are denied with 42501 and store nothing', async () => {
  // A co-owner of a dog without a finished service (CLIENT3 also owns d5, which has none).
  ok(await admin().from('perro_duenos').insert({ perro_id: ids.perros.d3, dueno_id: u.CLIENT3, rol: 'co', estado: 'activo' }), 'link CLIENT3 as co-owner of d3')
  try {
    for (const actor of ['CLIENT2', 'CLIENT3', 'WALKER_CO', 'OFFICE', 'OWNER', 'OTHER', 'CLIENT_I', 'ANON']) denied(await save(actor))
    denied(await save('CLIENT', { p_negocio: B })) // CLIENT owns no dog in tenant B
    denied(await save('CLIENT', { p_negocio: null }))
    await withUser(async (nobody) => denied(await save(nobody.client)))
    assert.deepEqual(await stored(), [])
  } finally {
    await admin().from('perro_duenos').delete().eq('perro_id', ids.perros.d3).eq('dueno_id', u.CLIENT3)
  }
})

test('a product purchase is not a service: a client whose only finished row is a comprar_producto purchase is denied; a finished bath makes them eligible', async () => {
  const db = admin()
  const prod = (await db.from('servicios').insert({ negocio_id: A, tipo: 'comida', nombre: 'Snack' }).select('id').single()).data.id
  ok(await db.from('tarifas').insert({ servicio_id: prod, negocio_id: A, precio: 5000, precio_mensual: 0 }), 'tarifa')
  const rows = []
  try {
    const buy = await (await as('CLIENT2')).rpc('comprar_producto', { p_perro: ids.perros.d3, p_servicio: prod, p_cantidad: 1 })
    ok(buy, 'CLIENT2 buys a product for d3')
    rows.push(buy.data)
    const { data: fin } = await db.from('prestaciones').select('tipo').in('perro_id', [ids.perros.d3, ids.perros.d4]).eq('estado', 'finalizado')
    assert.deepEqual(fin, [{ tipo: 'comida' }], 'precondition: the purchase is CLIENT2s only finished row')
    const res = await save('CLIENT2')
    denied(res)
    assert.match(res.error.message, /sin_servicio_finalizado/)
    assert.deepEqual(await stored(), [])
    const bath = await writePrestaciones({ negocio_id: A, perro_id: ids.perros.d3, servicio_id: ids.servicios.banoA, tipo: 'bano', fecha: day(-1), estado: 'finalizado', precio_aplicado: 30000 })
    rows.push(bath.data[0].id)
    ok(await save('CLIENT2'), 'CLIENT2 with a finished bath')
    assert.equal((await mine(u.CLIENT2)).estado, 'pendiente')
  } finally {
    await clean()
    await db.from('prestaciones').delete().in('id', rows)
    await db.from('servicios').delete().eq('id', prod)
  }
})

test('one review per client per tenant: a second save updates the same row and sends an approved review back to pending', async () => {
  try {
    ok(await save('CLIENT'), 'first save')
    const first = await mine(u.CLIENT)
    ok(await moderate('OWNER', first.id), 'approve')
    assert.equal((await mine(u.CLIENT)).estado, 'aprobada')
    ok(await save('CLIENT', { p_rating: 2, p_texto: 'Llegaron tarde dos veces seguidas.', p_publicar_nombre: false }), 'second save')
    const rows = await stored()
    assert.equal(rows.length, 1)
    assert.deepEqual(
      { id: rows[0].id, rating: rows[0].rating, texto: rows[0].texto, publicar: rows[0].publicar_nombre, estado: rows[0].estado, by: rows[0].moderated_by, at: rows[0].moderated_at },
      { id: first.id, rating: 2, texto: 'Llegaron tarde dos veces seguidas.', publicar: false, estado: 'pendiente', by: null, at: null })
    assert.ok(new Date(rows[0].updated_at) > new Date(first.updated_at), 'updated_at moved')
  } finally { await clean() }
})

test('bounds: rating 1..5 and text 10..600 characters after trimming; anything else stores nothing', async () => {
  try {
    for (const p_rating of [0, 6, -1, null]) assert.match((await save('CLIENT', { p_rating })).error?.message ?? 'no error', /rating_invalido/, `rating ${p_rating}`)
    for (const p_texto of ['123456789', `   ${'x'.repeat(9)}   `, 'x'.repeat(601), '', null])
      assert.match((await save('CLIENT', { p_texto })).error?.message ?? 'no error', /texto_invalido/, `texto length ${p_texto?.length}`)
    assert.deepEqual(await stored(), [])
    ok(await save('CLIENT', { p_rating: 1, p_texto: '  1234567890  ' }), 'lower bounds')
    assert.deepEqual([(await mine(u.CLIENT)).rating, (await mine(u.CLIENT)).texto], [1, '1234567890'])
    ok(await save('CLIENT', { p_rating: 5, p_texto: 'x'.repeat(600) }), 'upper bounds')
    assert.equal((await mine(u.CLIENT)).texto.length, 600)
  } finally { await clean() }
})

test('direct INSERT, UPDATE and DELETE on resenas are denied (42501) for every role, and nothing changes', async () => {
  try {
    ok(await save('CLIENT'), 'fixture review')
    const before_ = await stored()
    const row = { negocio_id: A, autor_id: u.CLIENT2, rating: 5, texto: TEXT, publicar_nombre: true, estado: 'aprobada' }
    for (const actor of ['CLIENT', 'COOWNER', 'CLIENT2', 'OWNER', 'OFFICE', 'WALKER_CO', 'OTHER', 'ANON']) {
      const db = await as(actor)
      denied(await db.from('resenas').insert(actor === 'ANON' ? row : { ...row, autor_id: u[actor] }))
      denied(await db.from('resenas').update({ estado: 'aprobada', rating: 1 }).eq('id', before_[0].id))
      denied(await db.from('resenas').delete().eq('id', before_[0].id))
    }
    assert.deepEqual(await stored(), before_)
  } finally { await clean() }
})

test('read: the author sees their own review, the tenant owner sees the tenant, office/walker/other tenant/other client see none, anon is denied', async () => {
  try {
    ok(await save('CLIENT'), 'CLIENT')
    ok(await save('COOWNER'), 'COOWNER')
    const want = { CLIENT: [u.CLIENT], COOWNER: [u.COOWNER], OWNER: [u.CLIENT, u.COOWNER].sort(), OFFICE: [], OFFICE_FIN: [], WALKER_CO: [], OTHER: [], CLIENT2: [] }
    for (const [actor, autores] of Object.entries(want)) {
      const res = await (await as(actor)).from('resenas').select('autor_id')
      ok(res, actor)
      assert.deepEqual(res.data.map((r) => r.autor_id).sort(), autores, actor)
    }
    denied(await (await as('ANON')).from('resenas').select('id'))
  } finally { await clean() }
})

test('resena_moderar: only the tenant owner; the server stamps who and when; only aprobada|rechazada', async () => {
  try {
    ok(await save('CLIENT'), 'fixture review')
    const { id } = await mine(u.CLIENT)
    for (const actor of ['OFFICE', 'OFFICE_FIN', 'WALKER_CO', 'CLIENT', 'COOWNER', 'OTHER', 'ANON']) denied(await moderate(actor, id))
    await withUser(async (nobody) => denied(await moderate(nobody.client, id)))
    denied(await moderate('OWNER', '00000000-0000-4000-8000-000000000000'))
    for (const estado of ['pendiente', 'publicada', '', null]) assert.match((await moderate('OWNER', id, estado)).error?.message ?? 'no error', /estado_invalido/, `estado ${estado}`)
    assert.deepEqual([(await mine(u.CLIENT)).estado, (await mine(u.CLIENT)).moderated_by], ['pendiente', null])
    const t0 = Date.now()
    ok(await moderate('OWNER', id, 'rechazada'), 'reject')
    ok(await moderate('OWNER', id, 'aprobada'), 'approve after reject')
    const r = await mine(u.CLIENT)
    assert.deepEqual([r.estado, r.moderated_by], ['aprobada', u.OWNER])
    assert.ok(Math.abs(new Date(r.moderated_at) - t0) < 5 * 60_000, `moderated_at ${r.moderated_at} is not now()`)
  } finally { await clean() }
})

// ---- public read (anon) -------------------------------------------------------------------------------
// Authors are throwaway users with a profile in tenant A; rows are written by the service role so the
// public aggregation is tested on exact data. Dropping a user cascades its profile and its review.
async function author(nombre) {
  const t = await tempUser()
  ok(await admin().from('profiles').insert({ id: t.id, negocio_id: A, rol: 'cliente', nombre }), `profile ${nombre}`)
  return t
}
const review = (t, rating, texto, extra = {}) =>
  admin().from('resenas').insert({ negocio_id: A, autor_id: t.id, rating, texto, publicar_nombre: true, estado: 'aprobada', moderated_by: u.OWNER, ...extra })
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

test('resenas_publicas (anon): nothing below 3, then exact aggregate and items; pending, rejected and non-consented never count', async () => {
  const pub = (await admin().from('resenas').select('id', { count: 'exact', head: true }).eq('estado', 'aprobada').eq('publicar_nombre', true)).count
  assert.equal(pub, 0, 'precondition: staging holds no other public review (delete leftovers outside the fixture tenants)')
  const people = []
  try {
    for (const n of ['Ana Restrepo', 'Juan Carlos Pérez Gómez', 'Kira', 'Pedro Pendiente', 'Rita Rechazada', 'Nadia Anónima']) people.push(await author(n))
    const [ana, juan, kira, pend, rech, anon] = people
    ok(await review(ana, 5, 'Excelente servicio, muy recomendados.', { moderated_at: '2026-10-01T15:00:00Z' }), 'ana')
    ok(await review(juan, 3, 'Bien, aunque a veces llegan tarde.', { moderated_at: '2026-10-02T15:00:00Z' }), 'juan')
    ok(await review(pend, 1, 'Texto pendiente que no se publica.', { estado: 'pendiente', moderated_by: null }), 'pending')
    ok(await review(rech, 1, 'Texto rechazado que no se publica.', { estado: 'rechazada' }), 'rejected')
    ok(await review(anon, 1, 'Texto sin permiso para el nombre.', { publicar_nombre: false }), 'not consented')

    assert.deepEqual(await publicas(), { total: 0, promedio: null, items: [] }, 'two public reviews must not leak anything')

    ok(await review(kira, 4, 'Mi perra vuelve feliz y cansada.', { moderated_at: '2026-10-03T15:00:00Z' }), 'kira')
    const want = {
      total: 3, promedio: 4,
      items: [
        { autor: 'Kira', rating: 4, texto: 'Mi perra vuelve feliz y cansada.', negocio: 'Tenant A', fecha: '2026-10-03' },
        { autor: 'Juan P.', rating: 3, texto: 'Bien, aunque a veces llegan tarde.', negocio: 'Tenant A', fecha: '2026-10-02' },
        { autor: 'Ana R.', rating: 5, texto: 'Excelente servicio, muy recomendados.', negocio: 'Tenant A', fecha: '2026-10-01' },
      ],
    }
    for (const actor of ['ANON', 'CLIENT2']) assert.deepEqual(await publicas(actor), want, actor)
    const raw = JSON.stringify(await publicas())
    assert.doesNotMatch(raw, UUID, 'no id in the payload')
    assert.doesNotMatch(raw, /@|Restrepo|Pérez|Gómez|pendiente|rechazado|Anónima/, 'no email, surname or hidden review')
  } finally {
    for (const p of people) await p.drop()
  }
})

test('resenas_publicas: at most the 6 most recent items, while total and the one-decimal average cover all', async () => {
  const people = []
  try {
    for (let i = 0; i < 7; i++) people.push(await author(`Persona${i} Apellido${i}`))
    for (const [i, p] of people.entries()) ok(await review(p, i === 0 ? 1 : 5, `Reseña número ${i} del servicio.`, { moderated_at: `2026-10-0${i + 1}T15:00:00Z` }), `r${i}`)
    const res = await publicas()
    assert.deepEqual([res.total, res.promedio, res.items.length], [7, 4.4, 6]) // (1 + 6 * 5) / 7 = 4.43
    assert.deepEqual(res.items.map((r) => r.autor), [6, 5, 4, 3, 2, 1].map((i) => `Persona${i} A.`))
  } finally {
    for (const p of people) await p.drop()
  }
})

test('catalog: the three functions are definer with an empty search_path; anon executes only resenas_publicas; the table has RLS and only SELECT for authenticated', () => {
  const fns = sql(`select p.proname, p.prosecdef as definer, p.proconfig @> array['search_path=""'] as pinned,
      has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('resena_guardar', 'resena_moderar', 'resenas_publicas') order by 1`)
  assert.deepEqual(fns, [
    { proname: 'resena_guardar', definer: true, pinned: true, anon: false, auth: true },
    { proname: 'resena_moderar', definer: true, pinned: true, anon: false, auth: true },
    { proname: 'resenas_publicas', definer: true, pinned: true, anon: true, auth: true },
  ])
  assert.deepEqual(sql(`select proname from pg_proc where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute') order by 1`).map((r) => r.proname), ['resenas_publicas'])
  const [t] = sql(`select c.relrowsecurity as rls,
      has_table_privilege('anon', c.oid, 'select,insert,update,delete') as anon,
      has_table_privilege('authenticated', c.oid, 'select') as sel,
      has_table_privilege('authenticated', c.oid, 'insert,update,delete,truncate') as write
    from pg_class c where c.oid = 'public.resenas'::regclass`)
  assert.deepEqual(t, { rls: true, anon: false, sel: true, write: false })
})
