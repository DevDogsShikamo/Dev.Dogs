// S4b: the app reads and writes sensitive data ONLY through the side tables (contactos, nomina,
// tarifas, cobros, perro_identidad) and RPCs, never through the legacy columns that the visibility
// switch drops. Static scan of every query in src/: select strings (embeds included), filter and
// order columns, and the keys of insert/update/upsert literals, resolved per table.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const LEGACY = {
  profiles: ['telefono', 'salario_fijo', 'zona'],
  servicios: ['precio', 'precio_mensual'],
  prestaciones: ['precio_aplicado', 'cobrable', 'cobrado', 'confirmado_por', 'confirmado_at'],
  perros: ['microchip'],
}

// PostgREST select string -> [{ table, col }] for every column, descending into embeds.
function columns(sel, table, out = []) {
  const items = []
  let depth = 0, cur = ''
  for (const ch of sel) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { items.push(cur); cur = '' } else cur += ch
  }
  items.push(cur)
  for (const raw of items) {
    const item = raw.trim()
    if (!item) continue
    const embed = item.match(/^(?:\w+:)?(\w+)(?:![\w.]+)*\s*\(([\s\S]*)\)$/)
    if (embed) columns(embed[2], embed[1], out)
    else out.push({ table, col: item.replace(/^\w+:/, '').split('::')[0].trim() })
  }
  return out
}

// Top-level keys of an object literal starting at text[start] === '{', and whether it spreads.
function literal(text, start) {
  let depth = 0, i = start
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++
    if (text[i] === '}' && --depth === 0) break
  }
  const body = text.slice(start + 1, i)
  let d = 0, top = ''
  for (const ch of body) {
    if ('{[('.includes(ch)) d++
    if ('}])'.includes(ch)) d--
    if (d === 0) top += ch
  }
  return { keys: [...top.matchAll(/(?:^|,)\s*(\w+)\s*(?::|(?=,|$))/g)].map((m) => m[1]), spread: [...top.matchAll(/\.\.\.(\w+)/g)].map((m) => m[1]) }
}

// Every legacy-column use in one source text.
export function violations(text) {
  const found = []
  const froms = [...text.matchAll(/\.from\(\s*["'](\w+)["']\s*\)/g)]
  froms.forEach((f, n) => {
    const table = f[1], legacy = LEGACY[table] || []
    const seg = text.slice(f.index, froms[n + 1]?.index ?? text.length)
    for (const s of seg.matchAll(/\.select\(\s*(["'`])([^"'`]*)\1/g)) {
      for (const c of columns(s[2], table)) if ((LEGACY[c.table] || []).includes(c.col)) found.push(`select ${c.table}.${c.col}`)
    }
    for (const c of seg.matchAll(/\.(?:eq|neq|gt|gte|lt|lte|is|in|like|ilike|order)\(\s*["'](\w+)["']/g)) {
      if (legacy.includes(c[1])) found.push(`filter ${table}.${c[1]}`)
    }
    for (const w of seg.matchAll(/\.(?:update|insert|upsert)\(\s*\[?\s*\{/g)) {
      const { keys, spread } = literal(seg, w.index + w[0].length - 1)
      for (const k of keys) if (legacy.includes(k)) found.push(`write ${table}.${k}`)
      // A spread of a helper (...fields(x)): the helper's body must not build a legacy key either.
      for (const sp of spread) {
        const body = text.match(new RegExp(`function ${sp}\\(([\\s\\S]*?)\\n\\}`))?.[1] ?? ''
        for (const col of legacy) if (new RegExp(`\\b${col}\\s*:`).test(body)) found.push(`write ${table}.${col} (through ${sp})`)
      }
    }
  })
  return found
}

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    return e.isDirectory() ? walk(p) : /\.(js|ts)$/.test(e.name) && e.name !== 'i18n.ts' ? [p] : []
  })
const SRC = fileURLToPath(new URL('../../src/', import.meta.url))
const files = walk(SRC).map((p) => ({ file: p.slice(SRC.length).replaceAll('\\', '/'), text: readFileSync(p, 'utf8') }))

const SAMPLES = [
  ['legacy select', `supa.from("profiles").select("id,nombre,telefono")`, ['select profiles.telefono']],
  ['legacy embed of a legacy table', `supa.from("perro_duenos").select("perros(id,microchip)")`, ['select perros.microchip']],
  ['side-table embed is fine', `supa.from("profiles").select("id,nombre,contactos(telefono),nomina(salario_fijo)")`, []],
  ['cobros embed is fine', `supa.from("prestaciones").select("fecha,cobros(precio_aplicado,cobrable,cobrado)")`, []],
  ['inner embed keeps its table', `supa.from("cobros").select("precio_aplicado,prestaciones!inner(fecha,cobrado)")`, ['select prestaciones.cobrado']],
  ['legacy filter', `supa.from("prestaciones").select("id").eq("cobrable", true)`, ['filter prestaciones.cobrable']],
  ['legacy write key', `supa.from("profiles").update({ salario_fijo: 1 }).eq("id", x)`, ['write profiles.salario_fijo']],
  ['spread of a helper that builds a legacy key', `function f(s) {\n  return { precio: s.p }\n}\nsupa.from("servicios").insert({ activo: true, ...f(s) })`, ['write servicios.precio (through f)']],
  ['spread of a clean helper', `function f(s) {\n  return { nombre: s.n }\n}\nsupa.from("servicios").insert({ activo: true, ...f(s) })`, []],
  ['safe writes', `supa.from("servicios").update({ activo: false }).eq("id", id)`, []],
  ['same column on another table', `supa.from("grupos").select("id,zona,hora")`, []],
]
for (const [name, text, expected] of SAMPLES) {
  test(`scanner: ${name}`, () => assert.deepEqual(violations(text), expected))
}

test('the scan sees the queries it is meant to guard', () => {
  const names = files.map((f) => f.file)
  for (const f of ['components/EmpresaBridge.js', 'components/ReportesBridge.js', 'components/ClienteBridge.js', 'lib/export.ts', 'lib/data.ts']) assert.ok(names.includes(f), f)
  assert.ok(files.reduce((n, f) => n + (f.text.match(/\.select\(/g) || []).length, 0) > 15)
})

test('no file in src/ queries a legacy sensitive column', () => {
  const bad = files.flatMap(({ file, text }) => violations(text).map((v) => `${file}: ${v}`))
  assert.deepEqual(bad, [])
})
