// F6 in-app notifications of the business (20261103100001_notificaciones.sql). AFTER triggers write one row in
// notificaciones per client event; nobody reaches the tables directly (RLS on, no grants), only the definer RPCs:
//   notificaciones_mias(p_limit, p_antes) · notificaciones_sin_leer() · notificacion_leer(p_id) · notificaciones_leer_todas()
// Audience ("Jefe controla más"): para 'office' = the owner and the office staff of the business; para 'owner' = the
// owner only. Events: a client booking (reserva) or product purchase (compra) and a client cancellation
// (cancelacion) -> office; a review waiting for approval (resena) and a dog a client registered (perro_nuevo) ->
// owner; a reported walk photo (foto_reporte) -> office. Walkers, clients, other tenants, a removed member, a user
// without a profile and anon get 42501. Read state is per user. Throwaway rows only.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, day, ids, seed, tempUser, writePrestaciones } from './_actors.mjs'
import { dropDog } from './_attacks.mjs'
import { sql } from './_sql.mjs'

const u = ids.users
const { A, B, I } = ids.negocios
const ok = (res, what) => assert.equal(res.error, null, `${what}: ${res.error?.message}`)
const denied = (res, what = '') => assert.equal(res.error?.code, '42501', `${what} expected 42501, got ${res.error?.code ?? 'no error'} ${res.error?.message ?? ''}`)
// The product of tenant A for compra (fixed id, removed in after()).
const COMIDA = '0d0d0d05-0000-4000-8000-000000000091'
const created = { prestaciones: [], dogs: [], fotos: [] }

const clean = () => admin().from('notificaciones').delete().in('negocio_id', [A, B, I])
const stored = async (extra = {}) => (await admin().from('notificaciones').select('tipo,ref_id,resumen,para').match({ negocio_id: A, ...extra }).order('created_at')).data
const rpc = async (actor, name, args = {}) => (await as(actor)).rpc(name, args)
const mias = async (actor, args = {}) => rpc(actor, 'notificaciones_mias', args)
const sinLeer = async (actor) => rpc(actor, 'notificaciones_sin_leer')
const ddmmyyyy = (iso) => iso.split('-').reverse().join('/')

before(async () => {
  await seed()
  ok(await clean(), 'clean')
  ok(await admin().from('servicios').upsert({ id: COMIDA, negocio_id: A, tipo: 'comida', nombre: 'Croquetas', activo: true }), 'product')
  ok(await admin().from('tarifas').upsert({ servicio_id: COMIDA, negocio_id: A, precio: 5000, precio_mensual: 0 }), 'tarifa')
}, { timeout: 120_000 })
after(async () => {
  await admin().from('fotos_reportes').delete().in('foto_id', created.fotos)
  await admin().from('paseo_fotos').delete().in('id', created.fotos)
  await admin().from('prestaciones').delete().in('id', created.prestaciones)
  await admin().from('prestaciones').delete().eq('servicio_id', COMIDA)
  for (const d of created.dogs) await dropDog(d)
  await admin().from('resenas').delete().match({ negocio_id: A, autor_id: u.CLIENT })
  await admin().from('tarifas').delete().eq('servicio_id', COMIDA)
  await admin().from('servicios').delete().eq('id', COMIDA)
  await clean()
})

const reservar = async (fecha = day(3)) => {
  const res = await rpc('CLIENT', 'reservar', { p_perro: ids.perros.d1, p_servicio: ids.servicios.banoA, p_grupo: null, p_fecha: fecha })
  ok(res, 'reservar')
  created.prestaciones.push(res.data)
  return res.data
}

test('NT-1: a client booking notifies the owner and the office once; the summary is dog, service and date', async () => {
  ok(await clean(), 'clean')
  const id = await reservar()
  assert.deepEqual(await stored(), [{ tipo: 'reserva', ref_id: id, resumen: `Rex · Bano · ${ddmmyyyy(day(3))}`, para: 'office' }])
  for (const actor of ['OWNER', 'OFFICE', 'OFFICE_FIN']) {
    const res = await mias(actor)
    ok(res, actor)
    assert.deepEqual(res.data.map((n) => [n.tipo, n.ref_id, n.leida]), [['reserva', id, false]], actor)
    assert.equal((await sinLeer(actor)).data, 1, actor)
  }
})

test('NT-2: a client cancellation and a product purchase notify the office once each', async () => {
  ok(await clean(), 'clean')
  const id = await reservar(day(4))
  ok(await clean(), 'only the cancellation below')
  ok(await rpc('CLIENT', 'reserva_cancelar', { p_id: id }), 'cancel')
  assert.deepEqual(await stored(), [{ tipo: 'cancelacion', ref_id: id, resumen: `Rex · Bano · ${ddmmyyyy(day(4))}`, para: 'office' }])
  ok(await clean(), 'clean')
  const buy = await rpc('CLIENT', 'comprar_producto', { p_perro: ids.perros.d1, p_servicio: COMIDA, p_cantidad: 2 })
  ok(buy, 'comprar')
  assert.deepEqual(await stored(), [{ tipo: 'compra', ref_id: buy.data, resumen: `Rex · Croquetas · ${ddmmyyyy(day(0))}`, para: 'office' }])
})

test('NT-3: what the business itself or the service role does notifies nobody', async () => {
  ok(await clean(), 'clean')
  const { data: [w] } = await writePrestaciones({ negocio_id: A, perro_id: ids.perros.d1, servicio_id: ids.servicios.banoA, tipo: 'bano', fecha: day(5), estado: 'programado', precio_aplicado: 0, detalle: {} })
  created.prestaciones.push(w.id)
  ok(await admin().from('prestaciones').update({ estado: 'cancelado' }).eq('id', w.id), 'service role cancels')
  const dog = await (await as('OWNER')).from('perros').insert({ negocio_id: A, nombre: 'Del negocio' }).select('id').single()
  ok(dog, 'owner registers a dog')
  created.dogs.push(dog.data.id)
  assert.deepEqual(await stored(), [])
})

test('NT-4: a review waiting for approval notifies the owner only, again when an edit sends it back to pending', async () => {
  ok(await admin().from('resenas').delete().match({ negocio_id: A, autor_id: u.CLIENT }), 'no earlier review')
  ok(await clean(), 'clean')
  const guardar = (rating) => rpc('CLIENT', 'resena_guardar', { p_negocio: A, p_rating: rating, p_texto: 'Muy buen servicio con Rex.', p_publicar_nombre: false })
  ok(await guardar(4), 'review')
  const { data: { id } } = await admin().from('resenas').select('id').match({ negocio_id: A, autor_id: u.CLIENT }).single()
  assert.deepEqual(await stored(), [{ tipo: 'resena', ref_id: id, resumen: 'Calificación 4 de 5', para: 'owner' }])
  ok(await guardar(5), 'an edit while pending')
  assert.equal((await stored()).length, 1, 'still pending: no second notification')
  ok(await rpc('OWNER', 'resena_moderar', { p_id: id, p_estado: 'aprobada' }), 'approve')
  assert.equal((await stored()).length, 1, 'moderation notifies nobody')
  ok(await guardar(3), 'an edit of the approved review')
  assert.deepEqual((await stored()).map((n) => n.resumen), ['Calificación 4 de 5', 'Calificación 3 de 5'])
  assert.deepEqual((await mias('OWNER')).data.map((n) => n.tipo), ['resena', 'resena'])
  assert.equal((await sinLeer('OWNER')).data, 2)
  for (const actor of ['OFFICE', 'OFFICE_FIN']) {
    assert.deepEqual((await mias(actor)).data, [], actor)
    assert.equal((await sinLeer(actor)).data, 0, actor)
    denied(await rpc(actor, 'notificacion_leer', { p_id: (await admin().from('notificaciones').select('id').eq('negocio_id', A).limit(1).single()).data.id }), `${actor} reads an owner notification`)
  }
})

test('NT-5: a dog registered by a client notifies the owner only', async () => {
  ok(await clean(), 'clean')
  const res = await rpc('CLIENT', 'crear_mi_perro', { p_nombre: 'Nube', p_raza: 'Beagle' })
  ok(res, 'crear_mi_perro')
  created.dogs.push(res.data)
  assert.deepEqual(await stored(), [{ tipo: 'perro_nuevo', ref_id: res.data, resumen: 'Nube · Beagle', para: 'owner' }])
  assert.equal((await sinLeer('OWNER')).data, 1)
  assert.equal((await sinLeer('OFFICE')).data, 0)
})

test('NT-6: a reported walk photo notifies the office once, with the tagged dogs and the reason', async () => {
  ok(await clean(), 'clean')
  const { data: [p] } = await writePrestaciones({ negocio_id: A, perro_id: ids.perros.d1, tipo: 'paseo', servicio_id: ids.servicios.paseoA, cuidador_id: u.WALKER_CO, fecha: day(0), estado: 'en_curso', precio_aplicado: 0, detalle: { hora: 'notif-1' } })
  created.prestaciones.push(p.id)
  const walker = await as('WALKER_CO')
  const foto = (await walker.rpc('foto_registrar', { p_prestaciones: [p.id] })).data
  assert.ok(foto)
  created.fotos.push(foto)
  ok(await walker.rpc('foto_subida_autorizar', { p_id: foto }), 'authorize')
  ok(await walker.rpc('foto_confirmar', { p_id: foto, p_bytes: 100 }), 'confirm')
  ok(await clean(), 'only the report below')
  ok(await rpc('CLIENT', 'foto_reportar', { p_foto: foto, p_motivo: 'aparece_menor' }), 'report')
  const { data: { id } } = await admin().from('fotos_reportes').select('id').eq('foto_id', foto).single()
  assert.deepEqual(await stored(), [{ tipo: 'foto_reporte', ref_id: id, resumen: 'Rex · Aparece un menor de edad', para: 'office' }])
  assert.equal((await sinLeer('OFFICE')).data, 1)
})

test('NT-7: read state is per user; leer_todas marks only what the caller sees', async () => {
  ok(await clean(), 'clean')
  const booking = await reservar(day(6))
  const dog = await rpc('CLIENT', 'crear_mi_perro', { p_nombre: 'Copo' })
  ok(dog, 'dog')
  created.dogs.push(dog.data)
  const [{ id: nReserva }] = (await admin().from('notificaciones').select('id').match({ negocio_id: A, ref_id: booking })).data
  assert.equal((await sinLeer('OWNER')).data, 2)
  ok(await rpc('OWNER', 'notificacion_leer', { p_id: nReserva }), 'owner reads one')
  ok(await rpc('OWNER', 'notificacion_leer', { p_id: nReserva }), 'reading it again is a success')
  assert.equal((await sinLeer('OWNER')).data, 1)
  assert.deepEqual((await mias('OWNER')).data.map((n) => [n.tipo, n.leida]), [['perro_nuevo', false], ['reserva', true]])
  assert.equal((await sinLeer('OFFICE')).data, 1, 'the office still has the booking unread')
  ok(await rpc('OFFICE', 'notificaciones_leer_todas'), 'office reads all')
  assert.equal((await sinLeer('OFFICE')).data, 0)
  assert.equal((await sinLeer('OWNER')).data, 1, 'the office marked nothing for the owner')
  const { data: rows } = await admin().from('notificacion_leidas').select('notificacion_id').eq('user_id', u.OFFICE)
  assert.deepEqual(rows.map((r) => r.notificacion_id), [nReserva], 'the office cannot mark the owner-only one')
  ok(await rpc('OWNER', 'notificaciones_leer_todas'), 'owner reads all')
  assert.equal((await sinLeer('OWNER')).data, 0)
  denied(await rpc('OWNER', 'notificacion_leer', { p_id: crypto.randomUUID() }), 'unknown notification')
})

test('NT-8: pagination: newest first, p_limit (1..100) and p_antes; older than 90 days is not shown', async () => {
  ok(await clean(), 'clean')
  const at = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString()
  ok(await admin().from('notificaciones').insert([
    { negocio_id: A, tipo: 'reserva', ref_id: crypto.randomUUID(), resumen: 'uno', para: 'office', created_at: at(30) },
    { negocio_id: A, tipo: 'reserva', ref_id: crypto.randomUUID(), resumen: 'dos', para: 'office', created_at: at(20) },
    { negocio_id: A, tipo: 'reserva', ref_id: crypto.randomUUID(), resumen: 'tres', para: 'office', created_at: at(10) },
    { negocio_id: A, tipo: 'reserva', ref_id: crypto.randomUUID(), resumen: 'vieja', para: 'office', created_at: at(91 * 24 * 60) },
  ]), 'rows')
  const first = await mias('OFFICE', { p_limit: 2 })
  ok(first, 'page 1')
  assert.deepEqual(first.data.map((n) => n.resumen), ['tres', 'dos'])
  const second = await mias('OFFICE', { p_limit: 2, p_antes: first.data[1].created_at })
  assert.deepEqual(second.data.map((n) => n.resumen), ['uno'])
  assert.deepEqual((await mias('OFFICE')).data.map((n) => n.resumen), ['tres', 'dos', 'uno'], 'the default page')
  assert.equal((await mias('OFFICE', { p_limit: 0 })).data.length, 1, 'p_limit is at least 1')
  assert.equal((await sinLeer('OFFICE')).data, 3)
  ok(await rpc('OFFICE', 'notificaciones_leer_todas'), 'leer todas')
  assert.equal((await admin().from('notificacion_leidas').select('notificacion_id').eq('user_id', u.OFFICE)).data.length, 3, 'the old one is not marked')
})

test('NT-9: walkers, clients, another tenant, no profile and anon get 42501 from every RPC; tenant B sees nothing of A', async () => {
  ok(await clean(), 'clean')
  await reservar(day(7))
  const [{ id }] = (await admin().from('notificaciones').select('id').eq('negocio_id', A)).data
  for (const actor of ['WALKER_CO', 'WALKER_IND', 'CLIENT', 'COOWNER', 'CLIENT_I', 'NOPROFILE', 'ANON']) {
    denied(await mias(actor), `${actor} mias`)
    denied(await sinLeer(actor), `${actor} sin_leer`)
    denied(await rpc(actor, 'notificacion_leer', { p_id: id }), `${actor} leer`)
    denied(await rpc(actor, 'notificaciones_leer_todas'), `${actor} leer_todas`)
  }
  assert.deepEqual((await mias('OTHER')).data, [])
  assert.equal((await sinLeer('OTHER')).data, 0)
  denied(await rpc('OTHER', 'notificacion_leer', { p_id: id }), 'OTHER reads a notification of A')
  ok(await rpc('OTHER', 'notificaciones_leer_todas'), 'OTHER leer_todas')
  assert.deepEqual((await admin().from('notificacion_leidas').select('user_id').eq('notificacion_id', id)).data, [])
})

test('NT-10: a removed office member gets nothing', async () => {
  ok(await clean(), 'clean')
  await reservar(day(8))
  const m = await tempUser()
  try {
    ok(await admin().from('profiles').insert({ id: m.id, negocio_id: A, rol: 'empresa', nombre: 'Temp office' }), 'profile')
    assert.equal((await m.client.rpc('notificaciones_sin_leer')).data, 1, 'precondition: a member sees it')
    ok(await (await as('OWNER')).rpc('miembro_dar_de_baja', { p_usuario: m.id }), 'baja')
    denied(await m.client.rpc('notificaciones_mias'), 'mias')
    denied(await m.client.rpc('notificaciones_sin_leer'), 'sin_leer')
    denied(await m.client.rpc('notificaciones_leer_todas'), 'leer_todas')
  } finally {
    await m.drop()
  }
})

test('NT-11: an independent walker business stores no notification', async () => {
  ok(await clean(), 'clean')
  const res = await rpc('CLIENT_I', 'crear_mi_perro', { p_nombre: 'Indep' })
  ok(res, 'crear_mi_perro in tenant I')
  created.dogs.push(res.data)
  assert.deepEqual((await admin().from('notificaciones').select('id').eq('negocio_id', I)).data, [])
})

test('NT-12: nobody signed in or anonymous reads or writes the tables directly', async () => {
  ok(await clean(), 'clean')
  await reservar(day(9))
  const [{ id }] = (await admin().from('notificaciones').select('id').eq('negocio_id', A)).data
  for (const actor of ['OWNER', 'OFFICE', 'CLIENT', 'WALKER_CO', 'ANON']) {
    const db = await as(actor)
    denied(await db.from('notificaciones').select('*'), `${actor} select`)
    denied(await db.from('notificaciones').insert({ negocio_id: A, tipo: 'reserva', ref_id: id, resumen: 'x', para: 'office' }), `${actor} insert`)
    denied(await db.from('notificaciones').delete().eq('id', id), `${actor} delete`)
    denied(await db.from('notificacion_leidas').select('*'), `${actor} select leidas`)
    denied(await db.from('notificacion_leidas').insert({ notificacion_id: id, user_id: u[actor] ?? u.OWNER }), `${actor} insert leidas`)
  }
  assert.equal((await stored()).length, 1)
})

test('NT-13: catalog: RLS on, no table grants, definer functions pinned, triggers closed, purge job scheduled', () => {
  const tables = sql(`select relname, relrowsecurity as rls, has_table_privilege('anon', oid, 'select,insert,update,delete') as anon,
      has_table_privilege('authenticated', oid, 'select,insert,update,delete') as auth
    from pg_class where relnamespace = 'public'::regnamespace and relname in ('notificaciones', 'notificacion_leidas') order by 1`)
  assert.deepEqual(tables, [
    { relname: 'notificacion_leidas', rls: true, anon: false, auth: false },
    { relname: 'notificaciones', rls: true, anon: false, auth: false },
  ])
  const fns = sql(`select proname, prosecdef, coalesce(proconfig @> array['search_path=""'], false) as pinned,
      has_function_privilege('anon', oid, 'execute') as anon, has_function_privilege('authenticated', oid, 'execute') as auth
    from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'notificacion%' or proname like 'notif\\_%') order by 1`)
  const rpcs = ['notificacion_leer', 'notificaciones_leer_todas', 'notificaciones_mias', 'notificaciones_sin_leer']
  assert.deepEqual(fns.map((f) => f.proname), ['notif_foto_reporte', 'notif_perro_nuevo', 'notif_prestacion', 'notif_resena',
    'notificacion_crear', 'notificacion_leer', 'notificaciones_leer_todas', 'notificaciones_mias', 'notificaciones_purgar', 'notificaciones_sin_leer'])
  for (const f of fns) assert.deepEqual([f.prosecdef, f.pinned, f.anon, f.auth], [true, true, false, rpcs.includes(f.proname)], f.proname)
  assert.deepEqual(sql(`select schedule, command from cron.job where jobname = 'dd_notificaciones_purga'`),
    [{ schedule: '45 3 * * *', command: 'select public.notificaciones_purgar()' }])
})
