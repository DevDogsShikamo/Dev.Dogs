// S2a RPC guards: mover_perro, grupo_set_hora, bloque_reprogramar and the F1 agenda RPCs are callable
// only by the owner or office of the group's tenant, reject unresolvable callers
// (NULL is a denial) and validate their inputs. Every denial must be a 42501.
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, day, ids, seed } from './_actors.mjs'
import { GUARDED_RPCS, attack } from './_attacks.mjs'
import { sql } from './_sql.mjs'

before(() => seed())

const [MOVER, SET_HORA, BLOQUE] = GUARDED_RPCS
const withArgs = (rpc, args) => ({ ...rpc, args: { ...rpc.args, ...args } })

async function assertDenied(actor, rpc) {
  const res = await attack(await as(actor), rpc)
  assert.equal(res.error?.code, '42501', `${actor} ${rpc.name}: expected permission denied, got ${res.error?.code ?? 'no error'}`)
  assert.equal(res.damage, null, `${actor} ${rpc.name} changed data: ${res.damage}`)
}

async function assertRejected(actor, rpc, reason) {
  const res = await attack(await as(actor), rpc)
  assert.match(res.error?.message ?? '', reason, `${actor} ${rpc.name}: expected ${reason}, got ${res.error?.message ?? 'no error'}`)
  assert.equal(res.damage, null, `${actor} ${rpc.name} changed data: ${res.damage}`)
}

// ---- R3-2 role- and NULL-safe guards ------------------------------------------
for (const actor of ['CLIENT', 'WALKER_CO']) {
  for (const rpc of GUARDED_RPCS) {
    test(`AH-2a: ${actor} cannot execute ${rpc.name} on a tenant A group`, () => assertDenied(actor, rpc))
  }
}

for (const rpc of GUARDED_RPCS) {
  test(`AH-2c: OTHER (tenant B) cannot execute ${rpc.name} on a tenant A group`, () => assertDenied('OTHER', rpc))
  test(`TI-4c: NOPROFILE is denied ${rpc.name} with a permission error`, () => assertDenied('NOPROFILE', rpc))
}

for (const [label, dog] of [['tenant B', ids.perros.dB], ['tenant I', ids.perros.dI]]) {
  for (const p_modo of ['hoy', 'siempre']) {
    test(`AH-2d: OWNER cannot move a ${label} dog into a tenant A group (${p_modo})`, async () => {
      const rpc = {
        ...MOVER,
        args: { p_perro: dog, p_grupo: ids.grupos.g1, p_modo, p_fecha: day(1) },
        damage: async () => {
          const rows = (await admin().from('prestaciones').select('id').eq('perro_id', dog)).data
          const links = (await admin().from('grupo_membresias').select('id').eq('perro_id', dog)).data
          return rows.length || links.length ? `${rows.length} prestacion(es), ${links.length} membership(s) created` : null
        },
        undo: async () => {
          await admin().from('prestaciones').delete().eq('perro_id', dog)
          await admin().from('grupo_membresias').delete().eq('perro_id', dog)
        },
      }
      await assertRejected('OWNER', rpc, /perro_invalido/)
    })
  }
}

for (const actor of ['OWNER', 'OFFICE']) {
  for (const rpc of GUARDED_RPCS) {
    test(`AH-2e: ${actor} can execute ${rpc.name} (allowed path)`, async () => {
      const res = await attack(await as(actor), rpc)
      assert.equal(res.error, null, `${actor} ${rpc.name} failed: ${res.error?.message}`)
      assert.notEqual(res.damage, null, `${actor} ${rpc.name} ran but changed nothing`)
    })
  }
}

// ---- input validation (design: modo, hour, past dates) ------------------------
test('mover_perro rejects an unknown mode', () => assertRejected('OWNER', withArgs(MOVER, { p_modo: 'ayer' }), /modo_invalido/))

test('mover_perro rejects a date in the past', () =>
  assertRejected('OWNER', withArgs(MOVER, { p_fecha: day(-3) }), /fecha_invalida/))

for (const p_hora of ['25:00', '8:00', '12:60', 'abc', '08:00; drop']) {
  test(`grupo_set_hora rejects the hour "${p_hora}"`, () => assertRejected('OWNER', withArgs(SET_HORA, { p_hora }), /hora_invalida/))
}

test('grupo_set_hora rejects a date in the past', () =>
  assertRejected('OWNER', withArgs(SET_HORA, { p_fecha: day(-3) }), /fecha_invalida/))

test('bloque_reprogramar rejects an unknown mode', () =>
  assertRejected('OWNER', withArgs(BLOQUE, { p_modo: 'ayer' }), /modo_invalido/))

test('bloque_reprogramar rejects an invalid hour', () =>
  assertRejected('OWNER', withArgs(BLOQUE, { p_hora: '99:99' }), /hora_invalida/))

test('bloque_reprogramar rejects a source or target date in the past', async () => {
  await assertRejected('OWNER', withArgs(BLOQUE, { p_fecha_old: day(-3), p_fecha_new: day(-3) }), /fecha_invalida/)
  await assertRejected('OWNER', withArgs(BLOQUE, { p_fecha_new: day(-3) }), /fecha_invalida/)
})

// ---- AH-1a for the new functions ----------------------------------------------
const FUNCTIONS = ['assert_gestor', 'mover_perro', 'grupo_set_hora', 'bloque_reprogramar', 'grupo_asignar',
  'grupo_agregar_perro', 'grupo_quitar_perro', 'grupo_actualizar', 'grupo_eliminar', 'prestacion_asignar']

test('AH-1a: the S2a functions pin an empty search_path and are not executable by anon', () => {
  const rows = sql(`select proname, coalesce(proconfig @> array['search_path=""'], false) as pinned,
                           has_function_privilege('anon', oid, 'execute') as anon,
                           has_function_privilege('authenticated', oid, 'execute') as auth
                    from pg_proc where pronamespace = 'public'::regnamespace
                      and proname in (${FUNCTIONS.map((f) => `'${f}'`).join(',')}) order by 1`)
  assert.deepEqual(rows.map((r) => r.proname), [...FUNCTIONS].sort())
  for (const r of rows) {
    assert.equal(r.pinned, true, `${r.proname} does not pin an empty search_path`)
    assert.equal(r.anon, false, `${r.proname} is executable by anon`)
    assert.equal(r.auth, r.proname !== 'assert_gestor', `${r.proname}: wrong authenticated privilege`)
  }
})
