// Post-build step of `npm run build`: puts the CSP meta (csp.config.mjs) into dist/index.html.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CSP } from '../csp.config.mjs'

const ANCHOR = '<meta charset="utf-8">'
const HAS_CSP = /<meta\s+http-equiv="Content-Security-Policy"/i

// Idempotent: a page that already has the meta is returned as is. Throws when the anchor is missing.
export function injectCsp(html) {
  if (HAS_CSP.test(html)) return html
  if (!html.includes(ANCHOR)) throw new Error(`csp-inject: anchor ${ANCHOR} not found in <head>; the CSP was NOT added`)
  return html.replace(ANCHOR, () => `${ANCHOR}\n  <meta http-equiv="Content-Security-Policy" content="${CSP}">`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv[2] || fileURLToPath(new URL('../dist/index.html', import.meta.url))
  writeFileSync(file, injectCsp(readFileSync(file, 'utf8')))
  console.log(`csp-inject: CSP meta present in ${file}`)
}
