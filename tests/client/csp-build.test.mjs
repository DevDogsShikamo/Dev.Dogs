// Build-only CSP: the policy lives in csp.config.mjs and scripts/csp-inject.mjs puts it in dist/index.html.
// The source index.html (served by `muten dev`) must carry none, or the dev HMR/overlay scripts are blocked.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CSP } from '../../csp.config.mjs'
import { injectCsp } from '../../scripts/csp-inject.mjs'

const read = (p) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8')
const META = /<meta\s+http-equiv="Content-Security-Policy"/gi
const sample = '<!doctype html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <title>x</title>\n</head>\n<body></body>\n</html>\n'

test('S9: the source index.html has no CSP meta (dev must work as before S6)', () => {
  assert.equal(read('index.html').match(META), null)
})

test('S9: the inject step adds exactly the configured CSP once, and is idempotent', () => {
  const once = injectCsp(sample)
  assert.equal(once.match(META).length, 1)
  assert.ok(once.includes(`content="${CSP}"`), 'the configured string, verbatim')
  assert.equal(injectCsp(once), once, 'second run changes nothing')
  assert.ok(once.indexOf('charset') < once.indexOf('Content-Security-Policy'), 'charset stays first')
})

test('S9: the inject step fails loudly when the head anchor is missing', () => {
  assert.throws(() => injectCsp('<html><body></body></html>'), /anchor/i)
})

test('S9: the real source index.html accepts the inject step; npm run build wires it', () => {
  assert.equal(injectCsp(read('index.html')).match(META).length, 1)
  assert.match(JSON.parse(read('package.json')).scripts.build, /^muten bundle && node scripts\/csp-inject\.mjs$/)
})
