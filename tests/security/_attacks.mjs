// Shared exploit helpers for the baseline (RED) tests. Each attack records the
// damage it caused and can undo it, so a successful exploit never poisons the
// next test. Import-safe (no side effects on load).
import { admin, day, ids, writePrestaciones } from './_actors.mjs'

export const FAR_DAY = '2099-01-01'
const hora = async () => (await admin().from('grupos').select('hora').eq('id', ids.grupos.g1).single()).data.hora
const resetHora = () => admin().from('grupos').update({ hora: '08:00' }).eq('id', ids.grupos.g1)

// A monthly service of tenant A and an active plan of d4 for the plan RPCs (fixed ids; dropPlanFixtures removes them).
const PLAN = { servicio: '0d0d0d05-0000-4000-8000-000000000090', id: '0d0d0d07-0000-4000-8000-000000000001' }
export async function planFixtures() {
  const db = admin()
  await dropPlanFixtures()
  for (const [what, q] of [
    ['servicio', db.from('servicios').insert({ id: PLAN.servicio, negocio_id: ids.negocios.A, tipo: 'paseo', nombre: 'Plan guard', modelo_cobro: 'mensual', activo: true })],
    ['tarifa', db.from('tarifas').insert({ servicio_id: PLAN.servicio, negocio_id: ids.negocios.A, precio: 0, precio_mensual: 400000 })],
    ['plan', db.from('suscripciones').insert({ id: PLAN.id, negocio_id: ids.negocios.A, perro_id: ids.perros.d4, servicio_id: PLAN.servicio })],
  ]) {
    const { error } = await q
    if (error) throw new Error(`planFixtures ${what}: ${error.message}`)
  }
}
export async function dropPlanFixtures() {
  const db = admin()
  await db.from('prestaciones').delete().eq('servicio_id', PLAN.servicio)
  await db.from('suscripciones').delete().eq('servicio_id', PLAN.servicio)
  await db.from('tarifas').delete().eq('servicio_id', PLAN.servicio)
  await db.from('servicios').delete().eq('id', PLAN.servicio)
}

// The three group RPCs of C3/N2. `damage()` returns a description of the
// unauthorised change (or null); `undo()` reverts it.
export const GUARDED_RPCS = [
  {
    name: 'mover_perro',
    args: { p_perro: ids.perros.d3, p_grupo: ids.grupos.g1, p_modo: 'hoy', p_fecha: FAR_DAY },
    damage: async () => {
      const { data } = await admin().from('prestaciones').select('id').eq('perro_id', ids.perros.d3).eq('fecha', FAR_DAY)
      return data.length ? `${data.length} prestacion(es) created for d3` : null
    },
    undo: () => admin().from('prestaciones').delete().eq('perro_id', ids.perros.d3).eq('fecha', FAR_DAY),
  },
  {
    name: 'grupo_set_hora',
    args: { p_grupo: ids.grupos.g1, p_hora: '23:59', p_fecha: day(0) },
    damage: async () => ((await hora()) === '08:00' ? null : 'group g1 hour changed'),
    undo: resetHora,
  },
  {
    name: 'bloque_reprogramar',
    args: { p_grupo: ids.grupos.g1, p_fecha_old: day(30), p_fecha_new: day(30), p_hora: '23:58', p_modo: 'siempre' },
    damage: async () => ((await hora()) === '08:00' ? null : 'group g1 hour changed'),
    undo: resetHora,
  },
  // F1 agenda: d2 belongs to no group; d4 is g2's only dog; nonWalk is an unassigned bath.
  {
    name: 'grupo_agregar_perro',
    args: { p_grupo: ids.grupos.g1, p_perro: ids.perros.d2 },
    damage: async () => {
      const { data } = await admin().from('grupo_membresias').select('id').eq('grupo_id', ids.grupos.g1).eq('perro_id', ids.perros.d2)
      return data.length ? 'd2 joined group g1' : null
    },
    undo: async () => {
      await admin().from('prestaciones').delete().eq('perro_id', ids.perros.d2).eq('grupo_id', ids.grupos.g1)
      await admin().from('grupo_membresias').delete().eq('grupo_id', ids.grupos.g1).eq('perro_id', ids.perros.d2)
    },
  },
  {
    name: 'grupo_quitar_perro',
    args: { p_grupo: ids.grupos.g2, p_perro: ids.perros.d4 },
    damage: async () => {
      const { data } = await admin().from('grupo_membresias').select('activo').eq('grupo_id', ids.grupos.g2).eq('perro_id', ids.perros.d4).single()
      return data.activo ? null : 'd4 left group g2'
    },
    undo: () => admin().from('grupo_membresias').update({ activo: true }).eq('grupo_id', ids.grupos.g2),
  },
  {
    name: 'grupo_actualizar',
    args: { p_grupo: ids.grupos.g1, p_nombre: 'G1', p_hora: '23:57', p_servicio: ids.servicios.paseoA, p_duracion: 90, p_zona: 'Norte', p_color: 'purple' },
    damage: async () => ((await hora()) === '08:00' ? null : 'group g1 hour changed'),
    undo: resetHora,
  },
  {
    name: 'grupo_eliminar',
    args: { p_grupo: ids.grupos.g2 },
    damage: async () => ((await admin().from('grupos').select('activo').eq('id', ids.grupos.g2).single()).data.activo ? null : 'group g2 deleted'),
    undo: async () => {
      await admin().from('grupos').update({ activo: true }).eq('id', ids.grupos.g2)
      await admin().from('grupo_membresias').update({ activo: true }).eq('grupo_id', ids.grupos.g2)
    },
  },
  {
    name: 'prestacion_asignar',
    args: { p_id: ids.prestaciones.nonWalk, p_cuidador: ids.users.WALKER_CO },
    damage: async () => ((await admin().from('prestaciones').select('cuidador_id').eq('id', ids.prestaciones.nonWalk).single()).data.cuidador_id ? 'nonWalk assigned' : null),
    undo: () => admin().from('prestaciones').update({ cuidador_id: null }).eq('id', ids.prestaciones.nonWalk),
  },
  // F4 monthly plans: money, so the owner or the office WITH the finance permission (`allowed`). planFixtures()
  // must run first: a monthly service of tenant A and an active plan of d4.
  {
    name: 'plan_mensual_activar',
    allowed: ['OWNER', 'OFFICE_FIN'],
    args: { p_perro: ids.perros.d2, p_servicio: PLAN.servicio },
    damage: async () => {
      const { data } = await admin().from('suscripciones').select('id').eq('perro_id', ids.perros.d2).eq('servicio_id', PLAN.servicio)
      return data.length ? 'a plan of d2 was activated' : null
    },
    undo: async () => {
      await admin().from('prestaciones').delete().eq('perro_id', ids.perros.d2).eq('servicio_id', PLAN.servicio)
      await admin().from('suscripciones').delete().eq('perro_id', ids.perros.d2).eq('servicio_id', PLAN.servicio)
    },
  },
  {
    name: 'plan_mensual_cancelar',
    allowed: ['OWNER', 'OFFICE_FIN'],
    args: { p_plan: PLAN.id },
    damage: async () => ((await admin().from('suscripciones').select('estado').eq('id', PLAN.id).maybeSingle()).data?.estado === 'cancelada' ? 'the plan of d4 was cancelled' : null),
    undo: () => admin().from('suscripciones').update({ estado: 'activa', fin: null }).eq('id', PLAN.id),
  },
]

// Call `rpc` as `client`, report what changed, and always revert it.
export async function attack(client, { name, args, damage, undo }) {
  try {
    const { error } = await client.rpc(name, args)
    return { error, damage: await damage() }
  } finally {
    await undo()
  }
}

// A throwaway dog of tenant A linked to `ownerId`; with `history` it also gets a
// finished + charged and an unpaid prestacion. Returns the id; call `drop(id)`.
export async function makeDog(ownerId, { history }) {
  const db = admin()
  const { data: dog, error } = await db
    .from('perros')
    .insert({ negocio_id: ids.negocios.A, nombre: history ? 'Victima con historial' : 'Victima sin historial' })
    .select('id')
    .single()
  if (error) throw new Error(`makeDog: ${error.message}`)
  await db.from('perro_duenos').insert({ perro_id: dog.id, dueno_id: ownerId, rol: 'principal', estado: 'activo' })
  if (history) {
    const row = { negocio_id: ids.negocios.A, perro_id: dog.id, tipo: 'paseo', estado: 'finalizado', precio_aplicado: 20000 }
    await writePrestaciones([
      { ...row, fecha: day(-7), cobrado: true },
      { ...row, fecha: day(-3), cobrado: false },
    ])
  }
  return dog.id
}
// prestaciones.perro_id stops cascading in S2b1, so a dog with history is removed
// together with its rows, through the service role.
export async function dropDog(id) {
  await admin().from('prestaciones').delete().eq('perro_id', id)
  return admin().from('perros').delete().eq('id', id)
}
