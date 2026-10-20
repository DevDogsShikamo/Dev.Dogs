// /politicas (public legal center, draft): every document is reachable from the index, the statements
// that describe the product keep matching how it works, and the draft keeps its marker, its placeholders
// and no compliance claim or voseo (same rules as the privacy text, tests/client/policy-photos.test.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const page = read('../../src/pages/politicas/politicas.muten')
const strings = [...page.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join('\n')
const section = (id) => page.match(new RegExp(String.raw`Section id\("${id}"\)([\s\S]*?)(?=\n    Section id|\n  }\n}\s*$)`))?.[1] ?? ''

const DOCS = ['resumen', 'terminos', 'servicios', 'bienestar', 'fotos', 'resenas', 'dispositivo', 'atencion', 'datos', 'marco']

test('the page is public, routed, linked from the landing footer and keeps the draft marker', () => {
  assert.match(read('../../src/app.muten'), /^\s*"\/politicas" -> politicas\s*(#.*)?$/m, 'a public route with no guard')
  assert.match(read('../../src/pages/landing/landing.muten'), /Link "Términos y políticas" -> "\/politicas"/)
  assert.match(page, /BORRADOR — pendiente de revisión legal/)
})

test('every document has a section and an index entry that points to it', () => {
  for (const id of DOCS) {
    assert.match(page, new RegExp(String.raw`Section id\("${id}"\)`), `section #${id}`)
    assert.match(page, new RegExp(String.raw`-> "#${id}"`), `index link to #${id}`)
  }
})

test('the product facts match the app', () => {
  assert.match(section('terminos'), /DevDogs no presta servicios de paseo/)
  assert.match(section('terminos'), /solo por invitación/)
  assert.match(section('servicios'), /DevDogs no recibe, retiene ni transfiere dinero/)
  assert.match(section('servicios'), /Este documento no es una factura electrónica/)
  assert.match(section('servicios'), /no tiene un botón para cancelar/, 'no in-app cancellation exists today')
  assert.match(section('bienestar'), /ocho \(8\) perros por paseador/)
  assert.match(section('bienestar'), /hembras en celo/)
  assert.match(section('bienestar'), /16 de julio de 2027/)
  assert.match(section('bienestar'), /No rastrea la ubicación/)
  assert.match(section('fotos'), /treinta \(30\) días/)
  assert.match(section('fotos'), /diez \(10\) por paseo/)
  assert.match(section('resenas'), /al menos tres/)
  assert.match(section('dispositivo'), /no usa cookies/)
  assert.match(section('dispositivo'), /Google Fonts/)
  assert.match(section('atencion'), /diez \(10\) días hábiles/)
  assert.match(section('atencion'), /quince \(15\) días hábiles/)
  assert.match(section('datos'), /PoliticaTexto\(version: version\)/, 'the data policy is the shared accepted text')
})

test('unknown company facts are placeholders, not invented', () => {
  assert.ok((strings.match(/\[COMPLETAR/g) ?? []).length >= 15)
  for (const fact of ['razón social', 'NIT', 'dirección', 'teléfono de atención', 'correo de contacto']) {
    assert.match(section('terminos'), new RegExp(String.raw`\[COMPLETAR: ${fact}\]`), fact)
  }
})

test('no compliance claim and no voseo', () => {
  // "certificado de salud" is the term the Ley 2480 uses; any other "certificad..." is a claim.
  const text = strings.replace(/certificados? de salud/gi, '')
  assert.doesNotMatch(text, /\bcumple\b|cumplimos|en cumplimiento|certificad|plenamente|totalmente conforme|garantiza/i)
  assert.doesNotMatch(text, /\b(tenés|querés|podés|sos|vos|hacé|mirá|elegí|creá|llevá)\b/i)
})
