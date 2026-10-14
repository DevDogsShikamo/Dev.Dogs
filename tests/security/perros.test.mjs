// S2b1 dogs (C6, P1) and client data scope (AH-8). A client can only REGISTER a dog;
// the business edits it and soft-deletes it through perro_eliminar; nobody hard-deletes.
// AH-5a, AH-5b (client DELETE) live in baseline-data.test.mjs.
import { afterEach, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, day, ids, seed, tempUser, writePrestaciones } from './_actors.mjs'
import { dropDog, makeDog } from './_attacks.mjs'

before(() => seed())

const u = ids.users
const { d1, d2, d3 } = ids.perros
const { g1 } = ids.grupos
const denied = (res) => assert.equal(res.error?.code, '42501', `expected permission denied, got ${res.error?.code ?? 'no error'}`)
const dog = async (id) => (await admin().from('perros').select('*').eq('id', id).maybeSingle()).data

// ---- AH-5c, AH-5d: no edit for clients or co-owners -----------------------------------
const edits = [
  { nombre: 'Hackeado' }, { compatible: false }, { incompatibles: [{ id: d3, nivel: 'no_tolera' }] },
  { activo: false }, { raza: 'x' }, { sociabilidad: 'selectivo' },
]
for (const [actor, target] of [['CLIENT', d2], ['COOWNER', d1], ['CLIENT2', d2]]) {
  test(`AH-5c: ${actor} cannot update any column of a dog (${target === d1 ? 'd1' : 'd2'})`, async () => {
    const before = await dog(target)
    const visible = (await (await as(actor)).from('perros').select('id').eq('id', target)).data.length
    assert.equal(visible, actor === 'CLIENT2' ? 0 : 1, 'only the owners of the dog see it, so a zero-row update is a policy denial')
    try {
      for (const patch of edits) {
        const res = await (await as(actor)).from('perros').update(patch).eq('id', target).select('id')
        assert.deepEqual(res.data, [], `${Object.keys(patch)[0]}: the update matched the dog`)
      }
      assert.deepEqual(await dog(target), before)
    } finally {
      await admin().from('perros').update(before).eq('id', target)
    }
  })
}

test('AH-5d: COOWNER cannot delete a dog or call perro_eliminar on it', async () => {
  const victim = await makeDog(u.CLIENT, { history: false }) // throwaway: a vulnerable run must not delete d1
  try {
    await admin().from('perro_duenos').insert({ perro_id: victim, dueno_id: u.COOWNER, rol: 'co', estado: 'activo' })
    const co = await as('COOWNER')
    assert.equal((await co.from('perros').select('id').eq('id', victim)).data.length, 1, 'COOWNER does not own the dog')
    denied(await co.from('perros').delete().eq('id', victim))
    denied(await co.rpc('perro_eliminar', { p_id: victim }))
    assert.equal((await dog(victim)).activo, true)
  } finally {
    await dropDog(victim)
  }
})

test('P1: CLIENT cannot insert a dog directly; only crear_mi_perro registers one', async () => {
  denied(await (await as('CLIENT')).from('perros').insert({ negocio_id: ids.negocios.A, nombre: 'Directo' }))
  assert.equal((await admin().from('perros').select('id').eq('nombre', 'Directo')).data.length, 0)
})

// ---- AH-5e: registration ----------------------------------------------------------------
// Registers a dog and always removes it afterwards, so a vulnerable run leaves nothing behind.
const created = []
afterEach(async () => {
  while (created.length) await dropDog(created.pop())
})
async function register(actor, args) {
  const res = await (await as(actor)).rpc('crear_mi_perro', { p_nombre: 'Nuevo', ...args })
  if (res.data) created.push(res.data)
  return res
}

test('AH-5e: CLIENT registers a dog; it gets its principal link and business defaults', async () => {
  const res = await register('CLIENT', { p_raza: 'Mestizo', p_tamano: 'mediano', p_conducta: 'tranquilo', p_tips: 'Le gusta la pelota', p_sociabilidad: 'bueno' })
  assert.equal(res.error, null, res.error?.message)
  const row = await dog(res.data)
  assert.deepEqual(
    { neg: row.negocio_id, nombre: row.nombre, activo: row.activo, compatible: row.compatible, incompatibles: row.incompatibles },
    { neg: ids.negocios.A, nombre: 'Nuevo', activo: true, compatible: true, incompatibles: [] },
  )
  assert.deepEqual((await admin().from('perro_duenos').select('dueno_id,rol,estado').eq('perro_id', res.data)).data, [{ dueno_id: u.CLIENT, rol: 'principal', estado: 'activo' }])
})

test('AH-5e: the business-controlled fields are not parameters of crear_mi_perro', async () => {
  const res = await register('CLIENT', { p_activo: false, p_compatible: false, p_negocio_id: ids.negocios.B })
  assert.equal(res.error?.code, 'PGRST202')
})

for (const [label, args] of [
  ['an unknown size', { p_tamano: 'gigante' }],
  ['an unknown behaviour', { p_conducta: 'agresivo' }],
  ['an unknown sociability', { p_sociabilidad: 'raro' }],
  ['a name over 80 characters', { p_nombre: 'x'.repeat(81) }],
  ['a blank name', { p_nombre: '   ' }],
  ['tips over 1000 characters', { p_tips: 'x'.repeat(1001) }],
]) {
  test(`AH-5e: crear_mi_perro rejects ${label}`, async () => {
    const res = await register('CLIENT', args)
    assert.match(res.error?.message ?? '', /perro_invalido/, `got ${res.error?.message ?? 'no error'}`)
    assert.equal(res.data, null, 'a dog was created')
  })
}

for (const actor of ['WALKER_CO', 'OWNER', 'NOPROFILE']) {
  test(`AH-5e: ${actor} (not a client) cannot register a dog through crear_mi_perro`, async () => {
    const res = await register(actor, {})
    denied(res)
    assert.equal(res.data, null, 'a dog was created')
  })
}

// ---- AH-5f: owner edit and soft delete ---------------------------------------------------
test('AH-5f: OWNER edits d1 directly and restores it', async () => {
  const owner = await as('OWNER')
  try {
    const res = await owner.from('perros').update({ nombre: 'Rex editado' }).eq('id', d1).select('nombre')
    assert.deepEqual(res.data, [{ nombre: 'Rex editado' }])
  } finally {
    await admin().from('perros').update({ nombre: 'Rex' }).eq('id', d1)
  }
})

test('AH-5f: OWNER registers a dog directly (perroCrear) in its own tenant only', async () => {
  const owner = await as('OWNER')
  const ok = await owner.from('perros').insert({ negocio_id: ids.negocios.A, nombre: 'Del dueno' }).select('id').single()
  assert.equal(ok.error, null, ok.error?.message)
  await dropDog(ok.data.id)
  denied(await owner.from('perros').insert({ negocio_id: ids.negocios.B, nombre: 'Ajeno' }))
})

test('AH-5f: perro_eliminar soft-deletes a dog with history and charges, and keeps every row', async () => {
  const victim = await makeDog(u.CLIENT, { history: true })
  try {
    assert.equal((await (await as('OWNER')).rpc('perro_eliminar', { p_id: victim })).error, null)
    assert.equal((await dog(victim)).activo, false)
    assert.equal((await admin().from('prestaciones').select('id').eq('perro_id', victim)).data.length, 2, 'history was lost')
  } finally {
    await dropDog(victim)
  }
})

test('AH-5f: perro_eliminar drops future programado rows, memberships and the dog from other dogs\' incompatibles', async () => {
  const victim = await makeDog(u.CLIENT, { history: false })
  const db = admin()
  const row = { negocio_id: ids.negocios.A, perro_id: victim, tipo: 'paseo', cobrado: false, precio_aplicado: 20000 }
  try {
    await writePrestaciones([
      { ...row, fecha: day(5), estado: 'programado' },
      { ...row, fecha: day(6), estado: 'programado', cobrado: true },
      { ...row, fecha: day(-2), estado: 'finalizado' },
      { ...row, fecha: day(7), estado: 'en_curso' },
    ])
    await db.from('grupo_membresias').insert({ grupo_id: g1, perro_id: victim, recurrencia: { tipo: 'diario' } })
    await db.from('perros').update({ incompatibles: [{ id: victim, nivel: 'cuidado' }, { id: d3, nivel: 'tolera' }] }).eq('id', d2)

    assert.equal((await (await as('OWNER')).rpc('perro_eliminar', { p_id: victim })).error, null)

    const left = (await db.from('prestaciones').select('fecha,estado,cobros(cobrado)').eq('perro_id', victim).order('fecha')).data
    assert.deepEqual(left.map((r) => `${r.estado}${r.cobros.cobrado ? '$' : ''}`), ['finalizado', 'programado$', 'en_curso'], 'only the unpaid future programado row goes')
    assert.equal((await db.from('grupo_membresias').select('perro_id').eq('perro_id', victim)).data.length, 0)
    assert.deepEqual((await dog(d2)).incompatibles, [{ id: d3, nivel: 'tolera' }])
  } finally {
    await db.from('perros').update({ incompatibles: [] }).eq('id', d2)
    await dropDog(victim)
  }
})

test('AH-5f: nobody hard-deletes a dog, not even its business owner', async () => {
  const victim = await makeDog(u.CLIENT, { history: false })
  try {
    denied(await (await as('OWNER')).from('perros').delete().eq('id', victim))
    assert.notEqual(await dog(victim), null)
  } finally {
    await dropDog(victim)
  }
})

for (const actor of ['CLIENT', 'OFFICE', 'WALKER_CO', 'OTHER', 'NOPROFILE', 'ANON']) {
  test(`AH-5f: ${actor} cannot call perro_eliminar`, async () => {
    const victim = await makeDog(u.CLIENT, { history: false })
    try {
      denied(await (await as(actor)).rpc('perro_eliminar', { p_id: victim }))
      assert.equal((await dog(victim)).activo, true)
    } finally {
      await dropDog(victim)
    }
  })
}

test('FK: a dog with prestaciones cannot be hard-deleted even by the service role', async () => {
  const victim = await makeDog(u.CLIENT, { history: true })
  try {
    const res = await admin().from('perros').delete().eq('id', victim)
    assert.equal(res.error?.code, '23503', `expected foreign_key_violation, got ${res.error?.code ?? 'no error'}`)
    assert.notEqual(await dog(victim), null)
  } finally {
    await dropDog(victim)
  }
})

test('FK: deleting a whole tenant still cascades through its dogs and their history', async () => {
  const owner = await tempUser()
  try {
    const neg = (await owner.client.rpc('provision_negocio', { p_rol: 'empresa', p_nombre: 'Ana Prueba', p_negocio: 'Cascada SAS' })).data
    assert.ok(neg, 'provisioning failed')
    const { data: perro } = await admin().from('perros').insert({ negocio_id: neg, nombre: 'Con historial' }).select('id').single()
    await admin().from('prestaciones').insert({ negocio_id: neg, perro_id: perro.id, tipo: 'paseo', estado: 'finalizado', fecha: day(-1) })
    assert.equal((await admin().auth.admin.deleteUser(owner.id)).error, null)
    assert.equal((await admin().from('negocios').select('id').eq('id', neg)).data.length, 0)
    assert.equal((await admin().from('perros').select('id').eq('id', perro.id)).data.length, 0)
    assert.equal((await admin().from('prestaciones').select('id').eq('perro_id', perro.id)).data.length, 0)
  } finally {
    await owner.drop()
  }
})

// ---- AH-8: what a client can read ----------------------------------------------------------
test('AH-8a: CLIENT reads no memberships, no foreign dog and no foreign prestaciones', async () => {
  const db = admin()
  assert.equal((await db.from('grupo_membresias').select('perro_id').eq('grupo_id', g1)).data.length, 3)
  const client = await as('CLIENT')
  assert.equal((await client.from('grupo_membresias').select('perro_id')).data.length, 0, 'CLIENT reads memberships')

  const { data: p } = await db.from('prestaciones').insert({ negocio_id: ids.negocios.A, perro_id: d3, tipo: 'paseo', fecha: day(2), estado: 'programado' }).select('id').single()
  try {
    assert.equal((await client.from('perros').select('id').eq('id', d3)).data.length, 0)
    assert.equal((await client.from('prestaciones').select('id').eq('perro_id', d3)).data.length, 0)
  } finally {
    await db.from('prestaciones').delete().eq('id', p.id)
  }
})

test('AH-8a: a walker reads the memberships of its own groups only', async () => {
  const mem = async (actor) => [...new Set((await (await as(actor)).from('grupo_membresias').select('grupo_id')).data.map((r) => r.grupo_id))]
  assert.deepEqual(await mem('WALKER_CO'), [g1])
  assert.deepEqual(await mem('WALKER_CO2'), [ids.grupos.g2])
  assert.deepEqual((await mem('OWNER')).sort(), [g1, ids.grupos.g2].sort())
  assert.deepEqual((await mem('OFFICE')).sort(), [g1, ids.grupos.g2].sort())
})

test('AH-8b: CLIENT still lists own dogs, own agenda with prices, groups and services', async () => {
  const client = await as('CLIENT')
  assert.deepEqual((await client.from('perros').select('id')).data.map((r) => r.id).sort(), [d1, d2].sort())
  const { data: agenda } = await client.from('prestaciones').select('id,cobros(precio_aplicado)').eq('perro_id', d1)
  assert.equal(agenda.find((r) => r.id === ids.prestaciones.p1)?.cobros.precio_aplicado, 20000)
  assert.equal((await client.from('grupos').select('id')).data.length >= 2, true)
  assert.equal((await client.from('servicios').select('id,tarifas(precio)')).data.filter((s) => s.tarifas.precio > 0).length >= 2, true)
})
