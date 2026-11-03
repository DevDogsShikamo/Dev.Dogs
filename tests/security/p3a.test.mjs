// P3a (20261103110001_p3a.sql): what the office sees of clients, the walker badge "Verificado por el negocio",
// renaming the business and three client actions.
//   Office Clientes tab: the office reads client names (profiles read office) but never their contact row.
//   paseador_verificar(p_paseador, p_verificado)  owner only, a walker of its business; stores who and when;
//                                                 nobody sets it on itself; a removal clears it.
//   negocio_renombrar(p_nombre)                   owner only, 1..100 characters after trim; a direct UPDATE of the
//                                                 name (or the type) of negocios is no longer granted.
//   resena_borrar(p_negocio)                      the author deletes its own review (and its pending notification).
//   mi_perro_eliminar(p_perro)                    the principal owner removes a dog with no service ever; the photo
//                                                 guard and the pickup point cleanup still apply.
//   reserva_reprogramar(p_prestacion, p_fecha)    an owner of the dog moves its own future programado booking with
//                                                 the cutoff of reserva_cancelar and the rules of reservar; one
//                                                 'reprogramacion' notification for the office.
// Everyone else gets 42501. Throwaway rows only; fixtures are restored even when an assertion fails.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, day, ids, seed, writePrestaciones } from './_actors.mjs'
import { dropDog } from './_attacks.mjs'
import { withUser } from './_invites.mjs'

const u = ids.users
const { A, B, I } = ids.negocios
const { d1, d2, d3 } = ids.perros
const { g1 } = ids.grupos
const ok = (res, what) => assert.equal(res.error, null, `${what}: ${res.error?.message}`)
const denied = (res, what = '') => assert.equal(res.error?.code, '42501', `${what} expected 42501, got ${res.error?.code ?? 'no error'} ${res.error?.message ?? ''}`)
const fails = (res, msg, what = '') => assert.match(res.error?.message ?? 'no error', new RegExp(msg), what)
const rpc = async (actor, name, args = {}) => (typeof actor === 'string' ? await as(actor) : actor).rpc(name, args)
const ddmmyyyy = (iso) => iso.split('-').reverse().join('/')
const made = { prestaciones: [], dogs: [], grupos: [] }
const notifs = async () => (await admin().from('notificaciones').select('tipo,ref_id,resumen,para').eq('negocio_id', A).order('created_at')).data
const cleanNotifs = () => admin().from('notificaciones').delete().in('negocio_id', [A, B, I])

before(async () => {
  await seed()
  ok(await cleanNotifs(), 'clean notifications')
}, { timeout: 120_000 })
after(async () => {
  await admin().from('prestaciones').delete().in('id', made.prestaciones)
  await admin().from('prestaciones').delete().in('grupo_id', made.grupos)
  await admin().from('grupos').delete().in('id', made.grupos)
  for (const d of made.dogs) await dropDog(d)
  await admin().from('resenas').delete().match({ negocio_id: A, autor_id: u.CLIENT })
  await admin().from('negocios').update({ nombre: 'Tenant A' }).eq('id', A)
  await cleanNotifs()
})

// ---- 1. Office Clientes tab ------------------------------------------------------------------------------
test('P3-1: the office lists the clients of its business by name, never their phone; another tenant lists none', async () => {
  const before_ = (await admin().from('contactos').select('telefono').eq('user_id', u.CLIENT).single()).data.telefono
  ok(await admin().from('contactos').update({ telefono: '+57 300 000 0001' }).eq('user_id', u.CLIENT), 'client phone')
  try {
    const list = async (actor) => {
      const res = await (await as(actor)).from('profiles').select('id,nombre,contactos(telefono)').eq('negocio_id', A).eq('rol', 'cliente').order('nombre')
      ok(res, actor)
      return res.data
    }
    const clients = (await admin().from('profiles').select('id').eq('negocio_id', A).eq('rol', 'cliente')).data.map((r) => r.id).sort()
    assert.ok([u.CLIENT, u.CLIENT2, u.COOWNER].every((c) => clients.includes(c)), 'precondition: fixture clients')
    for (const actor of ['OFFICE', 'OFFICE_FIN']) {
      const rows = await list(actor)
      assert.deepEqual(rows.map((r) => r.id).sort(), clients, `${actor} sees the client names`)
      assert.ok(rows.every((r) => r.nombre), `${actor} gets every name`)
      assert.ok(rows.every((r) => r.contactos === null), `${actor} sees a client phone`)
      const direct = await (await as(actor)).from('contactos').select('user_id').eq('negocio_id', A).eq('rol', 'cliente')
      ok(direct, `${actor} contactos`)
      assert.deepEqual(direct.data, [], `${actor} reads client contact rows`)
    }
    assert.equal((await list('OWNER')).find((r) => r.id === u.CLIENT).contactos.telefono, '+57 300 000 0001', 'the owner still sees it')
    assert.deepEqual(await list('OTHER'), [])
  } finally {
    await admin().from('contactos').update({ telefono: before_ }).eq('user_id', u.CLIENT)
  }
})

// ---- 2. Verified walker ----------------------------------------------------------------------------------
const prof = async (id) => (await admin().from('profiles').select('negocio_id,verificado,verificado_at,verificado_por').eq('id', id).single()).data

test('P3-2a: the owner verifies a walker of its business and removes it; who and when are stored', async () => {
  const t0 = Date.now()
  try {
    ok(await rpc('OWNER', 'paseador_verificar', { p_paseador: u.WALKER_CO, p_verificado: true }), 'verify')
    const on = await prof(u.WALKER_CO)
    assert.equal(on.verificado, true)
    assert.equal(on.verificado_por, u.OWNER)
    assert.ok(Math.abs(new Date(on.verificado_at) - t0) < 5 * 60_000, `verificado_at ${on.verificado_at} is not now()`)
    const seen = await (await as('OFFICE')).from('profiles').select('verificado').eq('id', u.WALKER_CO).single()
    assert.equal(seen.data.verificado, true, 'the office sees the badge')
    ok(await rpc('OWNER', 'paseador_verificar', { p_paseador: u.WALKER_CO, p_verificado: false }), 'unverify')
    assert.deepEqual(await prof(u.WALKER_CO), { negocio_id: A, verificado: false, verificado_at: null, verificado_por: null })
    fails(await rpc('OWNER', 'paseador_verificar', { p_paseador: u.WALKER_CO, p_verificado: null }), 'verificado_invalido')
  } finally {
    await admin().from('profiles').update({ verificado: false, verificado_at: null, verificado_por: null }).eq('id', u.WALKER_CO)
  }
})

test('P3-2b: only the owner, only a walker of its own business; nobody sets it on itself', async () => {
  for (const actor of ['OFFICE', 'OFFICE_FIN', 'WALKER_CO', 'WALKER_CO2', 'CLIENT', 'OTHER', 'WALKER_IND']) {
    denied(await rpc(actor, 'paseador_verificar', { p_paseador: u.WALKER_CO, p_verificado: true }), actor)
  }
  denied(await rpc('OWNER', 'paseador_verificar', { p_paseador: u.CLIENT, p_verificado: true }), 'a client is no walker')
  denied(await rpc('OWNER', 'paseador_verificar', { p_paseador: u.OFFICE, p_verificado: true }), 'an office member is no walker')
  denied(await rpc('OWNER', 'paseador_verificar', { p_paseador: u.WALKER_IND, p_verificado: true }), 'a walker of another business')
  assert.ok((await rpc('ANON', 'paseador_verificar', { p_paseador: u.WALKER_CO, p_verificado: true })).error, 'anon')
  for (const actor of ['WALKER_CO', 'WALKER_IND']) {
    const res = await (await as(actor)).from('profiles').update({ verificado: true, verificado_at: new Date().toISOString(), verificado_por: u.OWNER }).eq('id', u[actor]).select('id')
    assert.ok(res.error || res.data.length === 0, `${actor} updated its own badge`)
    const one = await (await as(actor)).from('profiles').update({ verificado_por: u.OWNER }).eq('id', u[actor]).select('id')
    assert.ok(one.error || one.data.length === 0, `${actor} set verificado_por on itself`)
  }
  assert.deepEqual(await prof(u.WALKER_CO), { negocio_id: A, verificado: false, verificado_at: null, verificado_por: null })
})

test('P3-2c: removing a verified walker (miembro_dar_de_baja) clears the badge', () =>
  withUser(async (w) => {
    ok(await admin().from('profiles').insert({ id: w.id, negocio_id: A, rol: 'paseador', nombre: 'Walker Temp' }), 'temp walker')
    ok(await rpc('OWNER', 'paseador_verificar', { p_paseador: w.id, p_verificado: true }), 'verify')
    assert.equal((await prof(w.id)).verificado, true)
    ok(await rpc('OWNER', 'miembro_dar_de_baja', { p_usuario: w.id }), 'baja')
    assert.deepEqual(await prof(w.id), { negocio_id: null, verificado: false, verificado_at: null, verificado_por: null })
  }))

// ---- 3. Rename the business ------------------------------------------------------------------------------
const nombreA = async () => (await admin().from('negocios').select('nombre').eq('id', A).single()).data.nombre

test('P3-3a: the owner renames its business (trimmed); empty or over 100 characters is refused', async () => {
  try {
    const res = await rpc('OWNER', 'negocio_renombrar', { p_nombre: '  Paseos del Norte  ' })
    ok(res, 'rename')
    assert.equal(res.data, 'Paseos del Norte')
    assert.equal(await nombreA(), 'Paseos del Norte')
    for (const bad of ['', '   ', 'x'.repeat(101), null]) fails(await rpc('OWNER', 'negocio_renombrar', { p_nombre: bad }), 'nombre_invalido', JSON.stringify(bad))
    ok(await rpc('OWNER', 'negocio_renombrar', { p_nombre: 'y'.repeat(100) }), '100 characters')
  } finally {
    await admin().from('negocios').update({ nombre: 'Tenant A' }).eq('id', A)
  }
})

test('P3-3b: nobody but the owner renames; a direct update of the name or type is denied, zonas still works', async () => {
  for (const actor of ['OFFICE', 'OFFICE_FIN', 'WALKER_CO', 'CLIENT', 'COOWNER']) denied(await rpc(actor, 'negocio_renombrar', { p_nombre: 'Hackeado' }), actor)
  await withUser(async (nobody) => denied(await rpc(nobody.client, 'negocio_renombrar', { p_nombre: 'Hackeado' }), 'no profile'))
  assert.equal(await nombreA(), 'Tenant A')
  const owner = await as('OWNER')
  for (const patch of [{ nombre: 'Directo' }, { tipo: 'independiente' }, { slug: 'otro' }]) {
    const res = await owner.from('negocios').update(patch).eq('id', A).select('id')
    assert.ok(res.error, `direct update of ${Object.keys(patch)[0]} was accepted`)
  }
  const n = (await admin().from('negocios').select('nombre,tipo,slug,zonas').eq('id', A).single()).data
  assert.deepEqual([n.nombre, n.tipo, n.slug], ['Tenant A', 'empresa', 'dd-test-a'])
  ok(await owner.from('negocios').update({ zonas: n.zonas }).eq('id', A), 'zonas')
})

// ---- 4a. Delete my review --------------------------------------------------------------------------------
test('P3-4a: the author deletes its own review and its notification; nobody else can', async () => {
  ok(await admin().from('resenas').delete().match({ negocio_id: A, autor_id: u.CLIENT }), 'no earlier review')
  ok(await cleanNotifs(), 'clean')
  ok(await rpc('CLIENT', 'resena_guardar', { p_negocio: A, p_rating: 4, p_texto: 'Muy buen servicio con Rex.', p_publicar_nombre: false }), 'review')
  const { data: { id } } = await admin().from('resenas').select('id').match({ negocio_id: A, autor_id: u.CLIENT }).single()
  assert.equal((await notifs()).length, 1, 'precondition: the owner was notified')
  for (const actor of ['CLIENT2', 'COOWNER', 'OWNER', 'OFFICE', 'WALKER_CO', 'OTHER']) denied(await rpc(actor, 'resena_borrar', { p_negocio: A }), actor)
  denied(await (await as('CLIENT')).rpc('resena_borrar', { p_negocio: B }), 'no review in B')
  assert.equal((await admin().from('resenas').select('id').eq('id', id)).data.length, 1, 'the review survived')
  ok(await rpc('CLIENT', 'resena_borrar', { p_negocio: A }), 'delete')
  assert.equal((await admin().from('resenas').select('id').eq('id', id)).data.length, 0)
  assert.deepEqual(await notifs(), [], 'its notification went with it')
  denied(await rpc('CLIENT', 'resena_borrar', { p_negocio: A }), 'nothing left to delete')
})

// ---- 4b. Delete my dog -----------------------------------------------------------------------------------
const dogRow = async (id) => (await admin().from('perros').select('activo,foto_at').eq('id', id).single()).data
async function myDog() {
  const res = await rpc('CLIENT', 'crear_mi_perro', { p_nombre: 'Por error', p_raza: 'Mestizo' })
  ok(res, 'crear_mi_perro')
  made.dogs.push(res.data)
  return res.data
}

test('P3-4b: the principal owner removes a dog without any service; its group and pickup point go', async () => {
  const dog = await myDog()
  ok(await admin().from('grupo_membresias').insert({ grupo_id: g1, perro_id: dog, recurrencia: { tipo: 'semanal', dias: [] } }), 'membership')
  ok(await rpc('CLIENT', 'recogida_guardar', { p_perro: dog, p_lat: 6.25, p_lng: -75.56, p_nota: 'Porteria' }), 'pickup point')
  ok(await rpc('CLIENT', 'mi_perro_eliminar', { p_perro: dog }), 'delete')
  assert.equal((await dogRow(dog)).activo, false)
  assert.deepEqual((await admin().from('grupo_membresias').select('id').eq('perro_id', dog)).data, [])
  assert.deepEqual((await admin().from('perro_recogida').select('perro_id').eq('perro_id', dog)).data, [])
  denied(await rpc('CLIENT', 'mi_perro_eliminar', { p_perro: dog }), 'already removed')
})

test('P3-4b: a dog with any service, even a cancelled one, stays; a photo mark blocks it; others are denied', async () => {
  fails(await rpc('CLIENT', 'mi_perro_eliminar', { p_perro: d1 }), 'perro_con_historial', 'd1 has history')
  const dog = await myDog()
  const { data: [p] } = await writePrestaciones({ negocio_id: A, perro_id: dog, servicio_id: ids.servicios.banoA, tipo: 'bano', fecha: day(3), estado: 'cancelado', precio_aplicado: 0, detalle: {} })
  made.prestaciones.push(p.id)
  fails(await rpc('CLIENT', 'mi_perro_eliminar', { p_perro: dog }), 'perro_con_historial', 'a cancelled booking is history')
  ok(await admin().from('prestaciones').delete().eq('id', p.id), 'drop it')
  ok(await admin().from('perros').update({ foto_at: new Date().toISOString() }).eq('id', dog), 'photo mark')
  fails(await rpc('CLIENT', 'mi_perro_eliminar', { p_perro: dog }), 'perro_con_foto', 'the photo goes first')
  ok(await admin().from('perros').update({ foto_at: null }).eq('id', dog), 'no mark')
  ok(await admin().from('perro_duenos').insert({ perro_id: dog, dueno_id: u.COOWNER, rol: 'co', estado: 'activo' }), 'co-owner')
  for (const actor of ['COOWNER', 'CLIENT2', 'OWNER', 'OFFICE', 'WALKER_CO', 'OTHER', 'CLIENT_I']) denied(await rpc(actor, 'mi_perro_eliminar', { p_perro: dog }), actor)
  assert.equal((await dogRow(dog)).activo, true)
})

// ---- 4c. Reschedule my booking ---------------------------------------------------------------------------
const reservar = async (perro, servicio, grupo, fecha) => {
  const res = await rpc('CLIENT', 'reservar', { p_perro: perro, p_servicio: servicio, p_grupo: grupo, p_fecha: fecha })
  ok(res, 'reservar')
  made.prestaciones.push(res.data)
  return res.data
}
const mover = async (actor, id, fecha) => {
  const res = await rpc(actor, 'reserva_reprogramar', { p_prestacion: id, p_fecha: fecha })
  if (res.data) made.prestaciones.push(res.data)
  return res
}
const pres = async (id) => (await admin().from('prestaciones').select('fecha,estado,servicio_id,grupo_id,cuidador_id,detalle').eq('id', id).single()).data

test('P3-4c: the client moves a service to another day; the old one is cancelled and the office gets one notice', async () => {
  const id = await reservar(d1, ids.servicios.banoA, null, day(3))
  ok(await cleanNotifs(), 'only the reschedule below')
  const res = await mover('CLIENT', id, day(5))
  ok(res, 'reprogramar')
  const old = await pres(id), nuevo = await pres(res.data)
  assert.equal(old.estado, 'cancelado')
  assert.equal(old.detalle.cancelado_por, 'cliente')
  assert.equal(old.detalle.reprogramado_a, day(5))
  assert.deepEqual([nuevo.fecha, nuevo.estado, nuevo.servicio_id], [day(5), 'programado', ids.servicios.banoA])
  assert.deepEqual(await notifs(), [{ tipo: 'reprogramacion', ref_id: res.data, resumen: `Rex · Bano · ${ddmmyyyy(day(5))} · antes ${ddmmyyyy(day(3))}`, para: 'office' }])
  const seen = await rpc('OFFICE', 'notificaciones_mias')
  ok(seen, 'office reads it')
  assert.deepEqual(seen.data.map((n) => n.tipo), ['reprogramacion'])
  fails(await mover('CLIENT', id, day(6)), 'reserva_no_reprogramable', 'the cancelled one cannot move again')
})

test('P3-4c: an outing booking keeps its outing, walker and hour; a busy day or a full outing is refused', async () => {
  const id = await reservar(d2, ids.servicios.paseoA, g1, day(12))
  const res = await mover('CLIENT', id, day(13))
  ok(res, 'reprogramar')
  const nuevo = await pres(res.data)
  assert.deepEqual([nuevo.fecha, nuevo.grupo_id, nuevo.cuidador_id, nuevo.detalle.hora], [day(13), g1, u.WALKER_CO, '08:00'])
  const other = await reservar(d2, ids.servicios.paseoA, g1, day(15))
  fails(await mover('CLIENT', other, day(13)), 'fecha_ocupada', 'd2 already walks with g1 that day')
  // Ley 2480 art. 9.6: WALKER_CO already has 8 dogs on g1 at 08:00 that day.
  const full = Array.from({ length: 8 }, () => ({ negocio_id: A, perro_id: d3, servicio_id: ids.servicios.paseoA, tipo: 'paseo', cuidador_id: u.WALKER_CO, fecha: day(16), estado: 'programado', precio_aplicado: 0, detalle: { hora: '08:00' } }))
  const { data } = await writePrestaciones(full)
  made.prestaciones.push(...data.map((r) => r.id))
  fails(await mover('CLIENT', other, day(16)), 'paseador_lleno', 'full outing')
  assert.equal((await pres(other)).estado, 'programado', 'a refused move changes nothing')
})

test('P3-4c: the cutoff of reserva_cancelar and the dates of reservar', async () => {
  const id = await reservar(d1, ids.servicios.banoA, null, day(4))
  for (const bad of [day(-1), day(4), day(400), null]) fails(await mover('CLIENT', id, bad), 'fecha_invalida', String(bad))
  const late = await writePrestaciones({ negocio_id: A, perro_id: d1, servicio_id: ids.servicios.banoA, tipo: 'bano', fecha: day(0), estado: 'programado', precio_aplicado: 0, detalle: { hora: '00:00' } })
  made.prestaciones.push(late.data[0].id)
  fails(await mover('CLIENT', late.data[0].id, day(2)), 'reserva_no_reprogramable', 'its hour already passed')
  const past = await writePrestaciones({ negocio_id: A, perro_id: d1, servicio_id: ids.servicios.banoA, tipo: 'bano', fecha: day(-2), estado: 'programado', precio_aplicado: 0, detalle: {} })
  made.prestaciones.push(past.data[0].id)
  fails(await mover('CLIENT', past.data[0].id, day(2)), 'reserva_no_reprogramable', 'a past booking')
  const done_ = await writePrestaciones({ negocio_id: A, perro_id: d1, servicio_id: ids.servicios.banoA, tipo: 'bano', fecha: day(2), estado: 'en_curso', precio_aplicado: 0, detalle: {} })
  made.prestaciones.push(done_.data[0].id)
  fails(await mover('CLIENT', done_.data[0].id, day(3)), 'reserva_no_reprogramable', 'already started')
  // An outing that already left today cannot take a booking for today.
  const { data: g } = await admin().from('grupos').insert({ negocio_id: A, nombre: 'Madrugada', zona: 'Norte', servicio_id: ids.servicios.paseoA, hora: '00:00' }).select('id').single()
  made.grupos.push(g.id)
  const early = await reservar(d2, ids.servicios.paseoA, g.id, day(3))
  fails(await mover('CLIENT', early, day(0)), 'fecha_invalida', 'the outing already left today')
})

test('P3-4c: a co-owner may move it; anyone who does not own the dog gets 42501', async () => {
  const id = await reservar(d1, ids.servicios.banoA, null, day(6))
  for (const actor of ['CLIENT2', 'CLIENT3', 'OWNER', 'OFFICE', 'WALKER_CO', 'OTHER', 'CLIENT_I']) denied(await mover(actor, id, day(7)), actor)
  await withUser(async (nobody) => denied(await mover(nobody.client, id, day(7)), 'no profile'))
  assert.ok((await mover('ANON', id, day(7))).error, 'anon')
  assert.equal((await pres(id)).estado, 'programado')
  ok(await mover('COOWNER', id, day(7)), 'co-owner')
})
