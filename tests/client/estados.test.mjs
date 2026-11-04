// State codes stored in the DB are shown to users through one Spanish label map, never raw.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { estadoLabel } from '../../src/lib/estados.js'

test('every prestaciones state has a Spanish label', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20260101000001_schema_v3.sql', import.meta.url), 'utf8')
  const codes = sql.match(/check \(estado in \('programado'[^)]*\)/)[0].match(/'([a-z_]+)'/g).map((c) => c.slice(1, -1))
  assert.deepEqual(codes, ['programado', 'recibido', 'en_curso', 'finalizado', 'no_asistio', 'cancelado'])
  for (const c of codes) assert.notEqual(estadoLabel(c), c, c)
  assert.equal(estadoLabel('en_curso'), 'En curso')
  assert.equal(estadoLabel('no_asistio'), 'No asistió')
})

test('review states, unknown codes and empty values', () => {
  assert.equal(estadoLabel('pendiente'), 'Pendiente')
  assert.equal(estadoLabel('rechazada'), 'Rechazada')
  assert.equal(estadoLabel('otro'), 'otro')
  assert.equal(estadoLabel(''), '')
  assert.equal(estadoLabel(undefined), '')
})

test('no .muten interpolates a raw estado as text', () => {
  for (const f of ['cliente/cliente', 'empresa/empresa', 'dashboard/dashboard']) {
    const src = readFileSync(new URL(`../../src/pages/${f}.muten`, import.meta.url), 'utf8')
    assert.doesNotMatch(src, /Span "\{[a-z]+\.estado\}"/, f)
  }
})
