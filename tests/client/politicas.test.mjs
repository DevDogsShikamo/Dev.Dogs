// /politicas (public legal center, draft): every document is reachable from the index, the statements
// that describe the product keep matching how it works, and the draft keeps its marker, its placeholders
// and no compliance claim or voseo (same rules as the privacy text, tests/client/policy-photos.test.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
// The page holds the header and the index; the documents are the part DocumentosLegales (also shown by
// the consent modal), so the checks read both.
const shell = read('../../src/pages/politicas/politicas.muten')
const docs = read('../../src/parts/documentoslegales.muten')
const page = shell + '\n' + docs
// The business terms (section #negocios) and the role notice of the /aceptar-condiciones gate.
const terminos = read('../../src/parts/terminosnegocio.muten')
const aviso = read('../../src/parts/avisorol.muten')
const strings = [...[page, terminos, aviso].join('\n').matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join('\n')
const section = (id) => page.match(new RegExp(String.raw`Section id\("${id}"\)([\s\S]*?)(?=\n    Section id|\n  }\n}\s*$)`))?.[1] ?? ''

const DOCS = ['resumen', 'terminos', 'servicios', 'bienestar', 'fotos', 'resenas', 'dispositivo', 'atencion', 'datos', 'marco', 'negocios']

test('the page is public, routed, linked from the landing footer and keeps the draft marker', () => {
  assert.match(read('../../src/app.muten'), /^\s*"\/politicas" -> politicas\s*(#.*)?$/m, 'a public route with no guard')
  assert.match(read('../../src/pages/landing/landing.muten'), /Link "Términos y políticas" -> "\/politicas"/)
  assert.match(page, /BORRADOR — pendiente de revisión legal/)
  assert.match(shell, /DocumentosLegales\(version: version\)/)
  assert.match(read('../../src/parts/consentimiento.muten'), /DocumentosLegales\(version: \$version\)/, 'the modal shows the same documents')
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
  assert.match(section('terminos'), /artículo 48 de la Ley 1480/, 'acceptance is recorded')
  assert.match(section('terminos'), /artículos 50 y 53 de la Ley 1480/, 'negocio_identidad, shown in the client portal')
  assert.match(section('servicios'), /DevDogs no recibe, retiene ni transfiere dinero/)
  assert.match(section('servicios'), /Este documento no es una factura electrónica/)
  assert.match(section('servicios'), /no tiene un botón para cancelar/, 'no in-app cancellation exists today')
  assert.match(section('bienestar'), /ocho \(8\) perros por paseador/)
  assert.match(section('bienestar'), /hembras en celo/)
  assert.match(section('bienestar'), /16 de julio de 2027/)
  assert.match(section('bienestar'), /No rastrea la ubicación/)
  assert.match(section('bienestar'), /Limita a ocho perros por paseador en cada salida/, 'trg_prestacion_ley_kiara')
  assert.match(section('bienestar'), /marcar a un perro como en celo/, 'perros.en_celo')
  assert.match(section('bienestar'), /fecha de expedición del certificado de salud[^"]*seis \(6\) meses/, 'perros.certificado_salud')
  assert.match(section('fotos'), /treinta \(30\) días/)
  assert.match(section('fotos'), /diez \(10\) por paseo/)
  assert.match(section('resenas'), /al menos tres/)
  assert.match(section('dispositivo'), /no usa cookies/)
  assert.match(section('dispositivo'), /tipografías se cargan desde el mismo sitio de la aplicación/, 'fonts are self-hosted')
  assert.doesNotMatch(page + read('../../src/parts/politicatexto.muten'), /Google Fonts|Google puede ver/, 'no third-party font request')
  assert.match(section('atencion'), /diez \(10\) días hábiles/)
  assert.match(section('atencion'), /quince \(15\) días hábiles/)
  assert.match(section('datos'), /PoliticaTexto\(version: version\)/, 'the data policy is the shared accepted text')
})

test('the role notice says the business, not DevDogs, provides the service, and keeps what DevDogs answers for', () => {
  assert.match(aviso, /DevDogs es la herramienta que usa \{\$negocio\} para organizar su servicio\./)
  assert.match(aviso, /DevDogs no recoge, transporta, pasea, cuida ni responde por tu perro\./)
  assert.match(aviso, /Quien presta el servicio, recibe a tu perro y responde por él es \{\$negocio\}\./)
  // Without it the notice reads as a blanket exclusion of liability (Ley 1480 art. 43).
  assert.match(aviso, /DevDogs responde por su software y por la seguridad de los datos que almacena\./)
  assert.match(aviso, /BORRADOR — pendiente de revisión legal/)
  assert.match(section('terminos'), /DevDogs no recoge, transporta, pasea, cuida ni responde por tu perro/, 'the consumer terms say the same')
  assert.match(section('terminos'), /Términos para negocios/, 'and point businesses to their own terms')
  const gate = read('../../src/pages/condiciones/condiciones.muten')
  assert.match(gate, /AvisoRol\(negocio: negocio, version: version\)/)
  assert.match(gate, /TerminosNegocio\(version: version\)/)
})

test('the business terms are published in #negocios and cover what the business answers for', () => {
  assert.match(shell, /Section id\("negocios"\)[\s\S]*TerminosNegocio\(version: versionNegocios\)/)
  assert.match(terminos, /BORRADOR — pendiente de revisión legal/)
  assert.match(terminos, /Versión de estos términos: \{\$version\}/)
  for (const fact of [
    /licencia de uso de la plataforma/, /único prestador del servicio/, /Ley 2480 de 2025/, /no revisa ni avala/,
    /manifiestamente ilegal[^"]*maltrato animal/, /no sustituyen su criterio/, /\[COMPLETAR: si DevDogs exigirá la póliza/,
    /indemne a DevDogs[^"]*dolo o culpa grave de DevDogs/, /daños directos[^"]*\[COMPLETAR: monto máximo/, /lucro cesante/,
    /artículo 1522 del Código Civil/, /encargado del tratamiento/, /artículo 25 del Decreto 1377 de 2013/,
    /artículos 50 y 53 de la Ley 1480/, /facultades para obligarlo/, /Suspensión y terminación/, /no tiene costo para el negocio/,
    /Ley aplicable y solución de controversias[\s\S]*\[COMPLETAR: domicilio contractual/,
  ]) assert.match(terminos, fact)
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
