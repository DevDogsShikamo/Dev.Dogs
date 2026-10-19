// S5b policy text: the privacy draft must describe the photo flow as it now works (PC-3a, PC-3b) and the
// version must change with the text (the consent drift test in tests/security/consent.test.mjs checks the
// database side against POLITICA_VERSION).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { POLITICA_VERSION } from '../../src/lib/politica.js'

const page = readFileSync(fileURLToPath(new URL('../../src/pages/privacidad/privacidad.muten', import.meta.url)), 'utf8')
const section = (n) => page.match(new RegExp(String.raw`Title "${n}\. [^"]*" h2([\s\S]*?)(?=\n    Section class|\n  }\n}\s*$)`))?.[1] ?? ''

test('the version was bumped with the photo text and keeps the draft marker', () => {
  assert.match(POLITICA_VERSION, /^2026-10-\d\d-borrador$/)
  assert.notEqual(POLITICA_VERSION, '2026-10-14-borrador')
  assert.match(page, /BORRADOR — pendiente de revisión legal/)
})

test('sections 4, 6, 8 and 9 describe tags per dog, R2 storage, the 30-day lifecycle and in-memory images', () => {
  assert.match(section(4), /fotos[^"]*etiquet[^"]*perro/i, 'photos are tagged with the dogs that appear')
  assert.match(section(4), /EXIF|ubicación/i, 'location metadata is removed before upload')
  assert.match(section(6), /30 días/)
  assert.match(section(6), /elimina|vence|caduca/i, 'the deletion is described')
  assert.match(section(8), /Cloudflare R2/)
  assert.doesNotMatch(section(8), /almacenamiento de Supabase|previsto trasladar/i, 'the old storage location is gone')
  assert.match(section(9), /memoria/i, 'photos are shown from memory, not stored')
  assert.match(section(5), /fotos?/i, 'who can see photos is stated')
})

test('PC-3b: the text keeps its placeholders, makes no compliance claim and uses no voseo', () => {
  assert.ok((page.match(/\[COMPLETAR/g) ?? []).length >= 12, 'placeholders kept')
  assert.doesNotMatch(page, /cumple con|cumplimos|certificad|garantiza|plenamente|totalmente conforme/i)
  assert.doesNotMatch(page, /\b(tenés|querés|podés|sos|vos|hacé|mirá)\b/i)
})

test('Mis datos: section 7 (anchor "derechos") offers the in-app channel, keeps the email placeholder and the version moved on', () => {
  assert.notEqual(POLITICA_VERSION, '2026-10-15-borrador')
  assert.match(page, /Section class\("pv-sec"\) id\("derechos"\) \{\s*Title "7\./)
  assert.match(section(7), /“Mis datos”/)
  assert.match(section(7), /\[COMPLETAR: correo de contacto\]/)
  const landing = readFileSync(fileURLToPath(new URL('../../src/pages/landing/landing.muten', import.meta.url)), 'utf8')
  assert.match(landing, /Link "Contacto" -> "\/privacidad#derechos"/)
})
