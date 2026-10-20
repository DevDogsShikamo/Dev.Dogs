// Ley 2480 de 2025 art. 9.3: health certificate status shown on the dog lists and the walk agenda.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { certificadoVigente, estadoCertificado, venceCertificado } from '../../src/lib/kiara.js'

test('no certificate', () => {
  for (const f of ['', null, undefined, 'x']) {
    assert.equal(estadoCertificado(f, '2026-10-20'), 'Sin certificado de salud')
    assert.equal(certificadoVigente(f, '2026-10-20'), false)
  }
})

test('valid until issue date + 6 calendar months, inclusive', () => {
  assert.equal(venceCertificado('2026-05-10'), '2026-11-10')
  assert.equal(estadoCertificado('2026-05-10', '2026-10-20'), 'Certificado de salud vigente hasta 10/11/2026')
  assert.equal(certificadoVigente('2026-05-10', '2026-11-10'), true)
  assert.equal(certificadoVigente('2026-05-10', '2026-11-11'), false)
})

test('expired', () => {
  assert.equal(estadoCertificado('2026-04-19', '2026-10-20'), 'Certificado de salud vencido')
  assert.equal(certificadoVigente('2026-04-19', '2026-10-20'), false)
})

test('year rollover and month-end clamp', () => {
  assert.equal(venceCertificado('2026-08-31'), '2027-02-28')
  assert.equal(venceCertificado('2027-08-31'), '2028-02-29')
  assert.equal(venceCertificado('2026-12-15'), '2027-06-15')
})
