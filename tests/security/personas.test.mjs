// F2 people: the principal owner of a dog and removing people from a business.
//   perro_dueno_principal  the owner or office makes a client of the business the one active principal owner of a
//                          dog (insert or promote); the previous principal becomes a co-owner. Transfer = pick another.
//   miembro_dar_de_baja    the owner removes a walker, office employee or client of his business (never himself)
//   miembro_salir          a walker, office employee or client leaves the business (an owner cannot)
// Removing someone keeps the history: the profile stays (negocio_id null, baja_at set), its walks, charges, dogs and
// photos stay. It loses every read of the tenant, its finance permission, nomina and contact row, its pending
// invitations, its future programado unpaid walks and its groups (unassigned, waiting for "Asignar"), and a client's
// links to the dogs go inactive. A removed user can join a business again with a new invitation.
// Removals use throwaway users (tempUser) so the shared fixtures are never touched.
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, day, ids, seed, tempUser, writePrestaciones } from './_actors.mjs'
import { dropDog } from './_attacks.mjs'
import { sql } from './_sql.mjs'
import { POLITICA_VERSION } from '../../src/lib/politica.js'

before(() => seed())

const u = ids.users
const A = ids.negocios.A
const ok = (res, what) => assert.equal(res.error, null, `${what}: ${res.error?.message}`)
const denied = (res) => assert.equal(res.error?.code, '42501', `expected permission denied, got ${res.error?.code ?? 'no error'} ${res.error?.message ?? ''}`)
const links = async (perro) => (await admin().from('perro_duenos').select('dueno_id,rol,estado').eq('perro_id', perro).order('rol')).data
const principal = async (actor, perro, cliente) => (await as(actor)).rpc('perro_dueno_principal', { p_perro: perro, p_cliente: cliente })
const profile = async (id) => (await admin().from('profiles').select('negocio_id,rol,baja_at').eq('id', id).single()).data

// A dog the business registered: no owner link at all (what perroCrear leaves).
async function withDog(fn) {
  const { data, error } = await admin().from('perros').insert({ negocio_id: A, nombre: 'Sin dueño' }).select('id').single()
  assert.equal(error, null)
  try {
    return await fn(data.id)
  } finally {
    await dropDog(data.id)
  }
}

// A throwaway member of tenant A (profile written by the service role, like an accepted invitation).
async function withMember(rol, fn) {
  const m = await tempUser()
  try {
    ok(await admin().from('profiles').insert({ id: m.id, negocio_id: A, rol, nombre: `Temp ${rol}` }), 'profile')
    return await fn(m)
  } finally {
    await m.drop()
  }
}

// ---- principal owner ---------------------------------------------------------------------------------------
test('PO-1: OWNER makes a client the principal of a dog without owners; the client reads it', () =>
  withDog(async (dog) => {
    ok(await principal('OWNER', dog, u.CLIENT3), 'principal')
    assert.deepEqual(await links(dog), [{ dueno_id: u.CLIENT3, rol: 'principal', estado: 'activo' }])
    assert.equal((await (await as('CLIENT3')).from('perros').select('id').eq('id', dog)).data.length, 1)
  }))

test('PO-2: picking another client transfers it; the previous principal stays as co-owner (one principal)', () =>
  withDog(async (dog) => {
    ok(await principal('OWNER', dog, u.CLIENT3), 'first')
    ok(await principal('OWNER', dog, u.CLIENT2), 'transfer')
    assert.deepEqual(await links(dog), [
      { dueno_id: u.CLIENT3, rol: 'co', estado: 'activo' },
      { dueno_id: u.CLIENT2, rol: 'principal', estado: 'activo' },
    ])
    // Back to the co-owner: promoted, not duplicated.
    ok(await principal('OFFICE', dog, u.CLIENT3), 'office transfers back')
    const rows = await links(dog)
    assert.equal(rows.length, 2)
    assert.deepEqual(rows.filter((l) => l.rol === 'principal').map((l) => l.dueno_id), [u.CLIENT3])
  }))

test('PO-3: the database holds at most one active principal per dog', () =>
  withDog(async (dog) => {
    ok(await principal('OWNER', dog, u.CLIENT3), 'principal')
    const res = await admin().from('perro_duenos').insert({ perro_id: dog, dueno_id: u.CLIENT2, rol: 'principal', estado: 'activo' })
    assert.equal(res.error?.code, '23505', 'a second active principal was stored')
  }))

for (const [target, why] of [['CLIENT_I', 'a client of another tenant'], ['WALKER_CO', 'a walker'], ['OFFICE', 'office staff']]) {
  test(`PO-4: ${why} cannot be made principal`, () =>
    withDog(async (dog) => {
      assert.match((await principal('OWNER', dog, u[target])).error?.message ?? '', /dueno_invalido/)
      assert.deepEqual(await links(dog), [])
    }))
}

test('PO-5: OWNER cannot pick the principal of a dog of another tenant', async () => {
  denied(await principal('OWNER', ids.perros.dI, u.CLIENT3))
  assert.equal((await links(ids.perros.dI)).some((l) => l.dueno_id === u.CLIENT3), false)
})

for (const actor of ['CLIENT', 'COOWNER', 'WALKER_CO', 'OTHER', 'NOPROFILE', 'ANON']) {
  test(`PO-6: ${actor} cannot pick a principal owner`, () =>
    withDog(async (dog) => {
      denied(await principal(actor, dog, u.CLIENT3))
      assert.deepEqual(await links(dog), [])
    }))
}

test('PO-7: comprar_producto works for the new principal, and no longer for the one it replaced', () =>
  withDog(async (dog) => {
    const db = admin()
    const { data: svc } = await db.from('servicios').insert({ negocio_id: A, tipo: 'comida', nombre: 'Snack F2', activo: true }).select('id').single()
    try {
      ok(await db.from('tarifas').insert({ servicio_id: svc.id, negocio_id: A, precio: 5000 }), 'tarifa')
      const buy = async (actor) => (await as(actor)).rpc('comprar_producto', { p_perro: dog, p_servicio: svc.id, p_cantidad: 1 })
      denied(await buy('CLIENT3'))
      ok(await principal('OWNER', dog, u.CLIENT3), 'principal')
      ok(await buy('CLIENT3'), 'the principal buys')
      ok(await principal('OWNER', dog, u.CLIENT2), 'transfer')
      denied(await buy('CLIENT3'))
      ok(await buy('CLIENT2'), 'the new principal buys')
    } finally {
      await db.from('prestaciones').delete().eq('servicio_id', svc.id)
      await db.from('tarifas').delete().eq('servicio_id', svc.id)
      await db.from('servicios').delete().eq('id', svc.id)
    }
  }))

// ---- removing people -----------------------------------------------------------------------------------------
const baja = async (actor, target) => (await as(actor)).rpc('miembro_dar_de_baja', { p_usuario: target })

// A walker's working set in tenant A: a group, a future programado walk of it, a past finished walk, his salary and
// a pending invitation to his email.
async function walkerWork(walker, dog) {
  const db = admin()
  const { data: g } = await db.from('grupos').insert({ negocio_id: A, nombre: 'G F2', cuidador_id: walker.id, hora: '09:00', servicio_id: ids.servicios.paseoA }).select('id').single()
  const walk = { negocio_id: A, perro_id: dog, tipo: 'paseo', servicio_id: ids.servicios.paseoA, grupo_id: g.id, cuidador_id: walker.id, precio_aplicado: 20000, detalle: { hora: '09:00' } }
  const { data: [futura, pasada] } = await writePrestaciones([
    { ...walk, fecha: day(5), estado: 'programado' },
    { ...walk, fecha: day(-5), estado: 'finalizado' },
  ])
  ok(await db.from('nomina').insert({ user_id: walker.id, negocio_id: A, salario_fijo: 900000 }), 'nomina')
  ok(await (await as('OWNER')).rpc('invitacion_crear', { p_rol: 'paseador', p_email: walker.email }), 'invitation')
  return { grupo: g.id, futura: futura.id, pasada: pasada.id }
}
const cleanWork = (w) => admin().from('grupos').delete().eq('id', w.grupo)

async function assertWalkerGone(walker, w) {
  const db = admin()
  const p = await profile(walker.id)
  assert.equal(p.negocio_id, null)
  assert.ok(p.baja_at, 'baja_at is set')
  assert.equal(p.rol, 'paseador', 'the role stays (history)')
  assert.equal((await db.from('prestaciones').select('cuidador_id').eq('id', w.futura).single()).data.cuidador_id, null, 'future walk still assigned')
  assert.equal((await db.from('prestaciones').select('cuidador_id').eq('id', w.pasada).single()).data.cuidador_id, walker.id, 'history lost its walker')
  assert.equal((await db.from('grupos').select('cuidador_id').eq('id', w.grupo).single()).data.cuidador_id, null, 'group still assigned')
  assert.equal((await db.from('nomina').select('user_id').eq('user_id', walker.id)).data.length, 0, 'nomina kept')
  const inv = (await db.from('invitaciones').select('estado').eq('negocio_id', A).eq('email', walker.email)).data
  assert.deepEqual(inv.map((i) => i.estado), ['revocada'])
  for (const t of ['perros', 'prestaciones', 'grupos']) {
    assert.equal((await walker.client.from(t).select('id').eq('negocio_id', A)).data.length, 0, `still reads ${t} of tenant A`)
  }
  assert.deepEqual((await walker.client.from('profiles').select('id').neq('id', walker.id)).data, [], 'still reads other profiles')
}

test('BA-1: OWNER removes a walker: access, future walks, group, salary and invitation go; history stays', () =>
  withDog((dog) => withMember('paseador', async (walker) => {
    const w = await walkerWork(walker, dog)
    try {
      assert.equal((await walker.client.from('prestaciones').select('id').eq('id', w.futura)).data.length, 1, 'precondition: reads its walk')
      ok(await baja('OWNER', walker.id), 'baja')
      await assertWalkerGone(walker, w)
    } finally {
      await cleanWork(w)
    }
  })))

test('BA-1b: a removed walker can no longer mark or skip the walks still in his name (yesterday, in progress)', () =>
  withDog((dog) => withMember('paseador', async (walker) => {
    const walk = { negocio_id: A, perro_id: dog, tipo: 'paseo', servicio_id: ids.servicios.paseoA, cuidador_id: walker.id, precio_aplicado: 20000, detalle: { hora: '09:00' } }
    const { data: [ayer, curso] } = await writePrestaciones([
      { ...walk, fecha: day(-1), estado: 'programado' },
      { ...walk, fecha: day(0), estado: 'en_curso' },
    ])
    ok(await walker.client.rpc('paseo_marcar', { p_ids: [curso.id], p_estado: 'en_curso' }), 'precondition: replay works while a member')
    ok(await baja('OWNER', walker.id), 'baja')
    denied(await walker.client.rpc('paseo_marcar', { p_ids: [ayer.id], p_estado: 'en_curso' }))
    denied(await walker.client.rpc('paseo_marcar', { p_ids: [curso.id], p_estado: 'finalizado' }))
    denied(await walker.client.rpc('paseo_no_salio', { p_id: ayer.id, p_motivo: 'x' }))
    const after_ = (await admin().from('prestaciones').select('estado').in('id', [ayer.id, curso.id]).order('fecha')).data
    assert.deepEqual(after_.map((r) => r.estado), ['programado', 'en_curso'])
  })))

test('BA-2: OWNER removes an office employee: the finance permission goes and nothing of the tenant is readable', () =>
  withMember('empresa', async (office) => {
    ok(await admin().from('permisos').insert({ user_id: office.id, negocio_id: A, finanzas: true }), 'permiso')
    assert.equal((await office.client.rpc('has_finanzas')).data, true, 'precondition')
    ok(await baja('OWNER', office.id), 'baja')
    assert.equal((await profile(office.id)).negocio_id, null)
    assert.equal((await admin().from('permisos').select('user_id').eq('user_id', office.id)).data.length, 0)
    assert.equal((await office.client.rpc('has_finanzas')).data, false)
    assert.equal((await office.client.rpc('is_office')).data, false)
    assert.equal((await office.client.from('perros').select('id').eq('negocio_id', A)).data.length, 0)
    assert.deepEqual((await office.client.from('profiles').select('id').neq('id', office.id)).data, [])
    denied(await office.client.rpc('grupo_set_hora', { p_grupo: ids.grupos.g1, p_hora: '08:00', p_fecha: day(1) }))
  }))

test('BA-3: OWNER removes a client: detached from its dogs, the dogs and their history stay', () =>
  withDog((dog) => withMember('cliente', async (client) => {
    const db = admin()
    ok(await principal('OWNER', dog, client.id), 'principal')
    await writePrestaciones([{ negocio_id: A, perro_id: dog, tipo: 'paseo', fecha: day(-2), estado: 'finalizado', precio_aplicado: 20000 }])
    assert.equal((await client.client.from('perros').select('id').eq('id', dog)).data.length, 1, 'precondition')
    ok(await baja('OWNER', client.id), 'baja')
    assert.equal((await profile(client.id)).negocio_id, null)
    assert.deepEqual(await links(dog), [{ dueno_id: client.id, rol: 'principal', estado: 'inactivo' }])
    assert.equal((await db.from('perros').select('activo').eq('id', dog).single()).data.activo, true)
    assert.equal((await db.from('prestaciones').select('id').eq('perro_id', dog)).data.length, 1)
    assert.equal((await client.client.from('perros').select('id')).data.length, 0)
    assert.equal((await client.client.from('prestaciones').select('id')).data.length, 0)
    // The dog can get a new principal at once.
    ok(await principal('OWNER', dog, u.CLIENT3), 'new principal')
  })))

test('BA-4: only the owner removes, never himself, and only people of his own business', () =>
  withMember('paseador', async (walker) => {
    for (const actor of ['OFFICE', 'OFFICE_FIN', 'WALKER_CO', 'CLIENT', 'OTHER', 'WALKER_IND', 'NOPROFILE', 'ANON']) {
      denied(await baja(actor, walker.id))
    }
    assert.match((await baja('OWNER', u.OWNER)).error?.message ?? '', /miembro_invalido/)
    denied(await baja('OWNER', u.CLIENT_I))
    denied(await baja('OWNER', u.OTHER))
    assert.equal((await profile(walker.id)).negocio_id, A)
    assert.equal((await profile(u.OWNER)).negocio_id, A)
    assert.equal((await profile(u.CLIENT_I)).negocio_id, ids.negocios.I)
  }))

// ---- leaving -------------------------------------------------------------------------------------------------
test('SA-1: a walker leaves the business with the same effects as a removal', () =>
  withDog((dog) => withMember('paseador', async (walker) => {
    const w = await walkerWork(walker, dog)
    try {
      ok(await walker.client.rpc('miembro_salir'), 'salir')
      await assertWalkerGone(walker, w)
    } finally {
      await cleanWork(w)
    }
  })))

test('SA-2: a client leaves: its links to the dogs go inactive', () =>
  withDog((dog) => withMember('cliente', async (client) => {
    ok(await principal('OWNER', dog, client.id), 'principal')
    ok(await client.client.rpc('miembro_salir'), 'salir')
    assert.equal((await profile(client.id)).negocio_id, null)
    assert.deepEqual(await links(dog), [{ dueno_id: client.id, rol: 'principal', estado: 'inactivo' }])
    assert.equal((await client.client.from('perros').select('id')).data.length, 0)
  })))

for (const actor of ['OWNER', 'WALKER_IND', 'OTHER']) {
  test(`SA-3: ${actor} owns its business and cannot leave it`, async () => {
    const before = await profile(u[actor])
    assert.match((await (await as(actor)).rpc('miembro_salir')).error?.message ?? '', /dueno_no_puede_salir/)
    assert.deepEqual(await profile(u[actor]), before)
  })
}

test('SA-4: without a business there is nothing to leave', async () => {
  denied(await (await as('NOPROFILE')).rpc('miembro_salir'))
  denied(await (await as('ANON')).rpc('miembro_salir'))
})

// ---- coming back -----------------------------------------------------------------------------------------------
test('RE-1: a removed person joins a business again with a new invitation', () =>
  withMember('paseador', async (walker) => {
    ok(await baja('OWNER', walker.id), 'baja')
    const { data: code } = await (await as('OWNER')).rpc('invitacion_crear', { p_rol: 'cliente', p_email: walker.email })
    const res = await walker.client.rpc('redeem_invite', { p_codigo: code, p_politica: POLITICA_VERSION })
    assert.equal(res.data?.ok, true, JSON.stringify(res.data ?? res.error))
    const p = await profile(walker.id)
    assert.deepEqual({ negocio_id: p.negocio_id, rol: p.rol, baja_at: p.baja_at }, { negocio_id: A, rol: 'cliente', baja_at: null })
    assert.equal((await admin().from('contactos').select('negocio_id,rol').eq('user_id', walker.id).single()).data.rol, 'cliente')
    // A member still in a business cannot redeem another invitation.
    const again = await walker.client.rpc('redeem_invite', { p_codigo: code, p_politica: POLITICA_VERSION })
    assert.equal(again.data?.error, 'perfil_existente')
  }))

test('RE-2: a removed person can open its own business', () =>
  withMember('cliente', async (client) => {
    ok(await client.client.rpc('miembro_salir'), 'salir')
    const res = await client.client.rpc('provision_negocio', { p_rol: 'paseador', p_nombre: 'Temp Ind', p_politica: POLITICA_VERSION })
    ok(res, 'provision')
    const p = await profile(client.id)
    assert.deepEqual({ negocio_id: p.negocio_id, rol: p.rol, baja_at: p.baja_at }, { negocio_id: res.data, rol: 'paseador', baja_at: null })
    assert.equal((await admin().from('contactos').select('negocio_id').eq('user_id', client.id).single()).data.negocio_id, res.data)
  }))

test('the removal helper is internal: not executable by authenticated or anon', () => {
  const [r] = sql(`select has_function_privilege('authenticated', 'public.miembro_baja_aplicar(uuid, uuid)', 'execute') as auth,
                          has_function_privilege('anon', 'public.miembro_baja_aplicar(uuid, uuid)', 'execute') as anon`)
  assert.deepEqual(r, { auth: false, anon: false })
})
