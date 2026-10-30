// Idempotent staging fixtures (service role) and one signed-in client per actor.
// Import-safe: nothing runs until seed()/as()/admin() is called, so the test
// runner can load this file without .env.test present.
import { createHash, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { loadConfig } from './_env.mjs'
import { AVISO_ROL_VERSION, POLITICA_VERSION, TERMINOS_NEGOCIO_VERSION } from '../../src/lib/politica.js'

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
// The Bogotá calendar day (UTC-5, no DST): the clock every RPC uses for "today". A UTC date is already
// tomorrow from 19:00 Bogotá on, which put "today's" fixtures outside the walk window in the evening.
export const day = (n = 0) => new Date(Date.now() - 5 * 36e5 + n * 864e5).toISOString().slice(0, 10)

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

// Login credentials of a seeded actor (the browser E2E types them into the login form).
export const credentials = (name) => ({ email: email(name), password: password(name) })

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

// A throwaway confirmed auth user with a session and no profile. `drop()` deletes
// it; profiles and negocios it owns cascade away with the auth row.
export async function tempUser() {
  const name = `tmp-${randomUUID().slice(0, 8)}`
  const created = await admin().auth.admin.createUser({ email: email(name), password: password(name), email_confirm: true })
  ok(created, `create ${name}`)
  const client = createClient(cfg().url, cfg().publishableKey, quiet)
  ok(await client.auth.signInWithPassword({ email: email(name), password: password(name) }), `sign in ${name}`)
  return {
    id: created.data.user.id, email: email(name), password: password(name), client,
    drop: () => admin().auth.admin.deleteUser(created.data.user.id),
  }
}

const noneOf = (col, list) =>({ col, list: `(${list.join(',')})` })

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
          id: u[name], negocio_id: ids.negocios[a.neg], rol: a.rol, nombre: a.nombre, verificado: false,
        })),
    ),
    'profiles',
  )
  // Every actor with a profile accepted the current policy, as a real user would have: without it the
  // app sends them to the /aceptar-politica gate instead of their portal.
  ok(
    await db.from('consentimientos').upsert(
      Object.keys(ACTORS).filter((name) => ACTORS[name].rol).map((name) => ({ user_id: u[name], policy_version: POLITICA_VERSION })),
      { onConflict: 'user_id,policy_version', ignoreDuplicates: true },
    ),
    'consentimientos',
  )
  // Likewise every business owner accepted the Términos para negocios and every client the role notice
  // for its business: without them the app sends them to the /aceptar-condiciones gate.
  const owners = { OWNER: 'A', OTHER: 'B', WALKER_IND: 'I' }
  ok(
    await db.from('aceptaciones').upsert(
      Object.entries(ACTORS).flatMap(([name, a]) =>
        owners[name] ? [{ user_id: u[name], tipo: 'terminos_negocio', negocio_id: ids.negocios[a.neg], version: TERMINOS_NEGOCIO_VERSION }]
          : a.rol === 'cliente' ? [{ user_id: u[name], tipo: 'aviso_rol', negocio_id: ids.negocios[a.neg], version: AVISO_ROL_VERSION }] : []),
      { onConflict: 'user_id,tipo,negocio_id,version', ignoreDuplicates: true },
    ),
    'aceptaciones',
  )
  ok(
    await db.from('servicios').upsert([
      { id: ids.servicios.paseoA, negocio_id: A, tipo: 'paseo', nombre: 'Paseo' },
      { id: ids.servicios.banoA, negocio_id: A, tipo: 'bano', nombre: 'Bano' },
    ]),
    'servicios',
  )
  ok(
    await db.from('tarifas').upsert([
      { servicio_id: ids.servicios.paseoA, negocio_id: A, precio: 20000, precio_mensual: 0 },
      { servicio_id: ids.servicios.banoA, negocio_id: A, precio: 30000, precio_mensual: 0 },
    ]),
    'tarifas',
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
  ok(await db.from('suscripciones').delete().in('negocio_id', [A, B, I]), 'clean suscripciones')
  // No business policy in the fixture tenants (a published one would gate their clients' bookings).
  ok(await db.from('negocio_politicas').delete().in('negocio_id', [A, B, I]), 'clean negocio_politicas')
  ok(await db.from('aceptaciones').delete().eq('tipo', 'politica_negocio').in('negocio_id', [A, B, I]), 'clean politica_negocio')
  ok(await identidades(), 'negocio_identidad')

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
  await writePrestaciones(
    [
      { ...walk, id: p.p1, fecha: day(0), estado: 'programado', detalle: { hora: '08:00' } },
      { ...walk, id: p.hist, fecha: day(-7), estado: 'finalizado', cobrado: true, detalle: { hora: '08:00' } },
      { ...walk, id: p.unpaid, fecha: day(-3), estado: 'finalizado', detalle: { hora: '08:00' } },
      { ...walk, id: p.future, fecha: day(7), estado: 'programado', detalle: { hora: '08:00' } },
      { ...base, id: p.nonWalk, tipo: 'bano', servicio_id: ids.servicios.banoA, grupo_id: null, cuidador_id: null,
        fecha: day(8), estado: 'programado', precio_aplicado: 30000, detalle: {} },
    ],
    { upsert: true },
  )
}

// Every fixture tenant has its legal identity (Ley 1480 art. 53): without it reservar and comprar_producto
// refuse its clients (negocio_sin_identidad). Idempotent; a test that removes one calls it again to restore it.
export const IDENTIDADES = {
  A: { razon_social: 'Tenant A SAS', doc_tipo: 'NIT', doc_numero: '900123456-1', direccion: 'Calle 10 # 43-21, Medellín', telefono: '+57 604 444 5566', correo: 'legal@tenant-a.example.com' },
  B: { razon_social: 'Tenant B SAS', doc_tipo: 'NIT', doc_numero: '900654321-7', direccion: 'Carrera 7 # 72-10, Bogotá', telefono: '+57 601 555 6677', correo: 'legal@tenant-b.example.com' },
  I: { razon_social: 'Walker Ind', doc_tipo: 'CC', doc_numero: '1020304050', direccion: 'Calle 50 # 20-30, Cali', telefono: '+57 310 555 0101', correo: 'walker-ind@example.com' },
}
export const identidades = () =>
  admin().from('negocio_identidad').upsert(Object.entries(IDENTIDADES).map(([t, row]) => ({ negocio_id: ids.negocios[t], ...row })))

// Money lives in `cobros`, not in `prestaciones` (S4b). Fixtures and tests keep writing one row shape;
// this splits the money keys off, writes the booking and then its charge (service role). Rows keep their order.
const MONEY = ['precio_aplicado', 'cobrable', 'cobrado', 'confirmado_por', 'confirmado_at']
export async function writePrestaciones(rows, { upsert = false } = {}) {
  const list = [].concat(rows)
  const bookings = list.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !MONEY.includes(k))))
  const q = admin().from('prestaciones')
  const res = await (upsert ? q.upsert(bookings) : q.insert(bookings)).select('*')
  ok(res, 'prestaciones')
  ok(
    await admin().from('cobros').upsert(res.data.map((b, i) => ({
      prestacion_id: b.id, negocio_id: b.negocio_id, precio_aplicado: list[i].precio_aplicado ?? 0, cobrable: list[i].cobrable ?? true,
      cobrado: list[i].cobrado ?? false, confirmado_por: list[i].confirmado_por ?? null, confirmado_at: list[i].confirmado_at ?? null,
    }))),
    'cobros',
  )
  return res
}

let seeded
export const seed = () => (seeded ??= users().then(data))
