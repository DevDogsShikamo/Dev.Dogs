// Honest copy: no "factura" (a regulated DIAN tax document) and no fabricated social proof in what users read.
// Scans user-facing string literals in src/ (.muten/.store/.ts/.js); comments and identifiers are fine.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SRC = join(ROOT, 'src')
const LEGEND = 'Este documento no es una factura electrónica.'

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : /\.(muten|store|ts|js)$/.test(e.name) ? [join(dir, e.name)] : [])

// String literals of a file, without comments and without {expr} / ${expr} interpolations (those are identifiers).
function literals(file) {
  let src = readFileSync(file, 'utf8')
  if (/\.(muten|store)$/.test(file)) {
    src = src.replace(/^\s*#.*$/gm, '')
    return [...src.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1].replace(/\{[^}]*\}/g, ' '))
  }
  return jsStrings(src).map((s) => s.replace(/\$\{[^}]*\}/g, ' '))
}

// Minimal JS/TS scanner: skips comments and regex literals, collects string/template bodies.
function jsStrings(src) {
  const out = []
  let i = 0
  let prev = '' // last significant char, to tell a regex "/" from a division
  while (i < src.length) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 2; if (i < 2) break; continue }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1
      out.push(src.slice(i + 1, j)); i = j + 1; prev = c; continue
    }
    const kw = /(^|[^\w$])(return|typeof|case|else|in|of|void|yield|await)$/.test(src.slice(Math.max(0, i - 12), i).trimEnd())
    if (c === '/' && (prev === '' || kw || '(,=:[!&|?{};+-*%<>~^'.includes(prev))) {
      let j = i + 1, cls = false
      while (j < src.length && (cls || src[j] !== '/') && src[j] !== '\n') {
        if (src[j] === '\\') j++
        else if (src[j] === '[') cls = true
        else if (src[j] === ']') cls = false
        j++
      }
      i = j + 1; prev = '/'; continue
    }
    if (!/\s/.test(c)) prev = c
    i++
  }
  return out
}

const files = walk(SRC)
const all = files.flatMap((f) => literals(f).map((s) => ({ file: relative(ROOT, f), s })))

const BANNED = [
  ['"factura"', (s) => /factura/i.test(s.replace(/no es una factura electr[oó]nica/gi, ''))],
]

test('scan sanity: finds the pages and the export module', () => {
  const names = files.map((f) => relative(SRC, f).replace(/\\/g, '/'))
  for (const f of ['pages/landing/landing.muten', 'pages/signup/signup.muten', 'pages/cliente/cliente.muten', 'lib/export.ts'])
    assert.ok(names.includes(f), f)
  assert.ok(all.length > 100, 'literals extracted')
})

for (const [label, hit] of BANNED) {
  test(`no user-facing string contains ${label}`, () => {
    const found = all.filter(({ s }) => hit(s)).map(({ file, s }) => `${file}: "${s.trim().slice(0, 80)}"`)
    assert.deepEqual(found, [])
  })
}

test('the per-dog statement says it is not an electronic invoice (sheet + exported files)', () => {
  for (const f of ['src/pages/cliente/cliente.muten', 'src/lib/export.ts'])
    assert.ok(readFileSync(join(ROOT, f), 'utf8').includes(LEGEND), f)
})
