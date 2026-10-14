// IV-2b: an invitation code is shown once and never persisted client-side. Static scan of the
// Muten stores (what `persist` writes to localStorage) and of the Custom bridges.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const SRC = fileURLToPath(new URL('../../src/', import.meta.url))
const read = (dir, ext) => readdirSync(join(SRC, dir)).filter((f) => f.endsWith(ext)).map((f) => ({ file: `${dir}${f}`, text: readFileSync(join(SRC, dir, f), 'utf8') }))
const stores = read('', '.store')
const bridges = read('components/', '.js')
const persisted = (text) => text.split(/\r?\n/).filter((l) => /\bpersist\b/.test(l))

test('the scan sees the stores and bridges it is meant to guard', () => {
  assert.ok(stores.some((s) => s.file === 'empresa.store'))
  assert.ok(bridges.some((b) => b.file === 'components/EmpresaBridge.js'))
})

test('no persisted state holds an entity that has a code / token field', () => {
  for (const { file, text } of stores) {
    const withCode = [...text.matchAll(/entity\s+(\w+)\s*\{([^}]*)\}/g)]
      .filter(([, , body]) => /^\s*(codigo|code|token)\b/m.test(body))
      .map(([, name]) => name)
    for (const line of persisted(text)) {
      for (const name of withCode) assert.ok(!new RegExp(`\\b${name}\\b`).test(line), `${file}: persisted state "${line.trim()}" holds ${name}`)
    }
  }
})

test('no persisted store state is an invitation or code list', () => {
  for (const { file, text } of stores) {
    for (const line of persisted(text)) assert.ok(!/(codigo|invit|\bcode\b)/i.test(line), `${file}: persisted state "${line.trim()}"`)
  }
})

test('bridges never read a code column from invitaciones', () => {
  for (const { file, text } of bridges) {
    for (const [call] of text.matchAll(/from\("invitaciones"\)[^;]*;/g)) {
      assert.ok(!/codigo/.test(call), `${file}: ${call.slice(0, 80)}`)
    }
  }
})
