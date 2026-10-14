// WP-2c: the photo Worker holds no storage credential and no service-role key, and never points at production.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../../worker/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const files = (dir) =>
  readdirSync(dir).flatMap((f) => {
    if (f === 'node_modules' || f === '.wrangler') return []
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : [p]
  })
const sources = () => files(ROOT).filter((f) => !f.endsWith('.test.mjs')).map((f) => [f, readFileSync(f, 'utf8')])

const FORBIDDEN = [
  ['service-role key name', /service_role|SERVICE_ROLE/i],
  ['Supabase secret key', /sb_secret_/],
  ['R2 / S3 access key', /R2_(ACCESS|SECRET)|AWS_(ACCESS|SECRET)|access_key_id|secret_access_key|r2\.cloudflarestorage\.com/i],
  ['presigned URL', /X-Amz-Signature|presign/i],
  ['production project ref', /agutaluxzruuthbbagkh/],
  ['.dev.vars secrets', /^\s*[A-Z_]*(SECRET|TOKEN|PASSWORD)[A-Z_]*\s*=/m],
]

test('WP-2c: the Worker sources and config contain no storage credential, service-role key or production ref', () => {
  const found = sources()
  assert.ok(found.some(([f]) => f.endsWith('index.js')) && found.some(([f]) => f.endsWith('wrangler.toml')), 'the Worker files were not found')
  for (const [file, text] of found) {
    for (const [what, re] of FORBIDDEN) assert.ok(!re.test(text), `${file}: ${what}`)
  }
})

test('WP-2c: any JWT embedded in the Worker config is a public (anon) key, and only bindings and public vars exist', () => {
  const toml = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8')
  for (const jwt of toml.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g) ?? []) {
    assert.notEqual(JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url')).role, 'service_role')
  }
  assert.match(toml, /\[\[env\.staging\.r2_buckets\]\]/, 'the staging bucket binding is missing')
  assert.match(toml, /bucket_name\s*=\s*"devdogs-staging"/)
  assert.ok(!/bucket_name\s*=\s*"devdogs"\s*$/m.test(toml), 'the production bucket must not be bound by this slice')
})
