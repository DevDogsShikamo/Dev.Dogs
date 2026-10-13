// Idempotent staging fixtures (service role) and one signed-in client per actor.
// Import-safe: nothing runs until seed()/as()/admin() is called, so the test
// runner can load this file without .env.test present.
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { loadConfig } from './_env.mjs'

// Fixed ids make every re-seed an upsert. The 12-digit tail is the entity number.
const uuid = (kind, n) => `0d0d0d${kind}-0000-4000-8000-${String(n).padStart(12, '0')}`
const idMap = (kind, names) => Object.fromEntries(names.map((n, i) => [n, uuid(kind, i + 1)]))

// Tenants: A = company, B = unrelated company, I = independent walker.
export const ACTORS = {
  NOPROFILE: {},
  OWNER: { rol: 'empresa', neg: 'A', nombre: 'Owner A' },
  OFFICE: { rol: 'empresa', neg: 'A', nombre: 'Office A' },
  OFFICE_FIN: { rol: 'empresa', neg: 'A', nombre: 'Office Fin A' },
  WALKER_CO: { rol: 'paseador', neg: 'A', nombre: 'Walker Co' },
  WALKER_CO2: { rol: 'paseador', neg: 'A', nombre: 'Walker Co2' },
  CLIENT: { rol: 'cliente', neg: 'A', nombre: 'Client' },
  CLIENT2: { rol: 'cliente', neg: 'A', nombre: 'Client2' },
  CLIENT3: { rol: 'cliente', neg: 'A', nombre: 'Client3' },
  COOWNER: { rol: 'cliente', neg: 'A', nombre: 'Coowner' },
  OTHER: { rol: 'empresa', neg: 'B', nombre: 'Other B' },
  WALKER_IND: { rol: 'paseador', neg: 'I', nombre: 'Walker Ind' },
  CLIENT_I: { rol: 'cliente', neg: 'I', nombre: 'Client I' },
}

export const ids = {
  users: idMap('01', Object.keys(ACTORS)),
  negocios: idMap('02', ['A', 'B', 'I']),
  perros: idMap('03', ['d1', 'd2', 'd3', 'd4', 'd5', 'dB', 'dI']),
  grupos: idMap('04', ['g1', 'g2']),
  servicios: idMap('05', ['paseoA', 'banoA']),
  prestaciones: idMap('06', ['p1', 'hist', 'unpaid', 'future', 'nonWalk']),
}

// Local date (YYYY-MM-DD) shifted by n days.
export const day = (n = 0) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)

const quiet = { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: class {} } }
let config
const cfg = () => (config ??= loadConfig())
const ok = ({ error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`)
}

let service
export const admin = () => (service ??= createClient(cfg().url, cfg().serviceKey, quiet))

// Actor passwords are derived from the service key, so they are not guessable
// and nothing secret is stored.
const password = (name) => createHash('sha256').update(`${cfg().serviceKey}:${name}`).digest('hex').slice(0, 24)
const email = (name) => `dd-${name.toLowerCase().replaceAll('_', '-')}@example.com`

const sessions = new Map()
export function as(name) {
  if (!sessions.has(name)) {
    sessions.set(
      name,
      (async () => {
        const client = createClient(cfg().url, cfg().publishableKey, quiet)
        if (name === 'ANON') return client
        const res = await client.auth.signInWithPassword({ email: email(name), password: password(name) })
        ok(res, `sign in ${name}`)
        return client
      })(),
    )
  }
  return sessions.get(name)
}

const noneOf = (col, list) => ({ col, list: `(${list.join(',')})` })

async function users() {
  for (const name of Object.keys(ACTORS)) {
    const { error } = await admin().auth.admin.createUser({
      id: ids.users[name],
      email: email(name),
      password: password(name),
      email_confirm: true,
    })
    if (error && !/already|exists|registered/i.test(error.message)) throw new Error(`create ${name}: ${error.message}`)
  }
}

async function data() {
  const db = admin()
  const { A, B, I } = ids.negocios
  const { d1, d2, d3, d4, d5, dB, dI } = ids.perros
  const { g1, g2 } = ids.grupos
  const u = ids.users

  ok(
    await db.from('negocios').upsert([
      { id: A, owner_id: u.OWNER, nombre: 'Tenant A', tipo: 'empresa', slug: 'dd-test-a' },
      { id: B, owner_id: u.OTHER, nombre: 'Tenant B', tipo: 'empresa', slug: 'dd-test-b' },
      { id: I, owner_id: u.WALKER_IND, nombre: 'Tenant I', tipo: 'independiente', slug: 'dd-test-i' },
    ]),
    'negocios',
  )
  ok(
    await db.from('profiles').upsert(
      Object.entries(ACTORS)
        .filter(([, a]) => a.rol)
        .map(([name, a]) => ({
          id: u[name], negocio_id: ids.negocios[a.neg], rol: a.rol, nombre: a.nombre, verificado: false, salario_fijo: 0,
        })),
    ),
    'profiles',
  )
  ok(
    await db.from('servicios').upsert([
      { id: ids.servicios.paseoA, negocio_id: A, tipo: 'paseo', nombre: 'Paseo', precio: 20000 },
      { id: ids.servicios.banoA, negocio_id: A, tipo: 'bano', nombre: 'Bano', precio: 30000 },
    ]),
    'servicios',
  )

  const dog = (id, negocio_id, nombre) => ({ id, negocio_id, nombre, activo: true, compatible: true, incompatibles: [] })
  const fixtureDogs = Object.values(ids.perros)
  ok(
    await db.from('perros').upsert([
      dog(d1, A, 'Rex'), dog(d2, A, 'Luna'), dog(d3, A, 'Toby'), dog(d4, A, 'Nina'), dog(d5, A, 'Max'),
      dog(dB, B, 'Bruno'), dog(dI, I, 'Kira'),
    ]),
    'perros',
  )
  // Anything a test created in a fixture tenant and forgot to remove.
  for (const t of ['prestaciones', 'perros', 'grupos']) {
    const keep = Object.values({ prestaciones: ids.prestaciones, perros: ids.perros, grupos: ids.grupos }[t])
    const n = noneOf('id', keep)
    ok(await db.from(t).delete().in('negocio_id', [A, B, I]).not(n.col, 'in', n.list), `clean ${t}`)
  }
  ok(await db.from('invitaciones').delete().in('negocio_id', [A, B, I]), 'clean invitaciones')

  ok(await db.from('perro_duenos').delete().in('perro_id', fixtureDogs), 'clean perro_duenos')
  const link = (perro_id, dueno_id, rol = 'principal') => ({ perro_id, dueno_id, rol, estado: 'activo' })
  ok(
    await db.from('perro_duenos').insert([
      link(d1, u.CLIENT), link(d1, u.COOWNER, 'co'), link(d2, u.CLIENT), link(d3, u.CLIENT2), link(d4, u.CLIENT2),
      link(d5, u.CLIENT3), link(dI, u.CLIENT_I),
    ]),
    'perro_duenos',
  )

  ok(
    await db.from('grupos').upsert([
      { id: g1, negocio_id: A, nombre: 'G1', zona: 'Norte', servicio_id: ids.servicios.paseoA, cuidador_id: u.WALKER_CO, hora: '08:00' },
      { id: g2, negocio_id: A, nombre: 'G2', zona: 'Sur', servicio_id: ids.servicios.paseoA, cuidador_id: u.WALKER_CO2, hora: '10:00' },
    ]),
    'grupos',
  )
  ok(await db.from('grupo_membresias').delete().in('grupo_id', [g1, g2]), 'clean membresias')
  ok(
    await db.from('grupo_membresias').insert([
      { grupo_id: g1, perro_id: d1 }, { grupo_id: g1, perro_id: d3 }, { grupo_id: g1, perro_id: d5 }, { grupo_id: g2, perro_id: d4 },
    ]),
    'membresias',
  )

  // d1 history: p1 = today's walk assigned to WALKER_CO; hist = finished + charged;
  // unpaid = finished, not charged; future = group walk; nonWalk = grooming booking.
  const base = { negocio_id: A, perro_id: d1, cobrado: false, cobrable: true, confirmado_por: null, confirmado_at: null }
  const walk = { ...base, tipo: 'paseo', servicio_id: ids.servicios.paseoA, grupo_id: g1, cuidador_id: u.WALKER_CO, precio_aplicado: 20000 }
  const p = ids.prestaciones
  ok(
    await db.from('prestaciones').upsert([
      { ...walk, id: p.p1, fecha: day(0), estado: 'programado', detalle: { hora: '08:00' } },
      { ...walk, id: p.hist, fecha: day(-7), estado: 'finalizado', cobrado: true, detalle: { hora: '08:00' } },
      { ...walk, id: p.unpaid, fecha: day(-3), estado: 'finalizado', detalle: { hora: '08:00' } },
      { ...walk, id: p.future, fecha: day(7), estado: 'programado', detalle: { hora: '08:00' } },
      { ...base, id: p.nonWalk, tipo: 'bano', servicio_id: ids.servicios.banoA, grupo_id: null, cuidador_id: null,
        fecha: day(8), estado: 'programado', precio_aplicado: 30000, detalle: {} },
    ]),
    'prestaciones',
  )
}

let seeded
export const seed = () => (seeded ??= users().then(data))
