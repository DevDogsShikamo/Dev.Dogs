// Self-hosted fonts: no font request goes to a third party (Google could see the browser IP). Fraunces and
// Plus Jakarta Sans are served from public/fonts/ with their SIL Open Font License alongside.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CSP } from '../../csp.config.mjs'

const path = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url))
const read = (p) => readFileSync(path(p), 'utf8')
const GOOGLE = /fonts\.googleapis\.com|fonts\.gstatic\.com/

test('index.html, src/styles.css, csp.config.mjs and the service worker reference no Google Fonts host', () => {
  for (const file of ['index.html', 'src/styles.css', 'csp.config.mjs', 'public/sw.js']) assert.doesNotMatch(read(file), GOOGLE, file)
  assert.doesNotMatch(CSP, GOOGLE)
  assert.match(CSP, /font-src 'self'(;|$)/)
})

test('Fraunces and Plus Jakarta Sans are declared with @font-face on local files that exist, with their license', () => {
  const css = read('src/styles.css')
  for (const family of ['Fraunces', 'Plus Jakarta Sans']) {
    const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]).filter((f) => f.includes(`"${family}"`))
    assert.ok(faces.length >= 2, `${family}: latin and latin-ext faces`)
    for (const face of faces) {
      assert.match(face, /font-display:\s*swap/, family)
      const url = face.match(/url\("(\/fonts\/[^"]+\.woff2)"\)/)?.[1]
      assert.ok(url && existsSync(path(`public${url}`)), `${family}: ${url} exists`)
    }
  }
  assert.ok(/"Fraunces"[^}]*font-style:\s*italic/.test(css), 'Fraunces italic')
  for (const license of ['fraunces-OFL.txt', 'plus-jakarta-sans-OFL.txt']) {
    assert.match(read(`public/fonts/${license}`), /SIL Open Font License/, license)
  }
})
