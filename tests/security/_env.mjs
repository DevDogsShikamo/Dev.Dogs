// Test configuration loader with a production guard (SR-1b).
// Import-safe: no side effects, so `node --test tests/security/` can load it.
import { readFileSync, existsSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'

export const PRODUCTION_REF = 'agutaluxzruuthbbagkh'
export const ENV_FILE = fileURLToPath(new URL('../../.env.test', import.meta.url))

// ponytail: PowerShell `>>` appends UTF-16LE to a UTF-8 file. Dropping NUL and
// BOM bytes decodes both halves; ceiling = ASCII-only values (keys and
// passwords are). Replace with a real decoder if non-ASCII values appear.
export function parseEnvFile(buf) {
  const text = Buffer.from(buf.filter((b) => b !== 0 && b !== 0xff && b !== 0xfe)).toString('utf8')
  return parseEnv(text.replace(/\r/g, ''))
}

const first = (env, names) => names.map((n) => env[n]).find(Boolean)

// Ref claim of a Supabase JWT key, or undefined for opaque (sb_*) keys.
function jwtRef(key) {
  try {
    return JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).ref
  } catch {
    return undefined
  }
}

// Throws on missing variables or any sign of production. Messages carry
// variable NAMES only, never values.
export function resolveConfig(env) {
  const cfg = {
    ref: env.STAGING_PROJECT_REF,
    url: env.STAGING_SUPABASE_URL,
    dbHost: env.STAGING_DB_HOST,
    dbPassword: env.STAGING_DB_PASSWORD,
    publishableKey: first(env, ['STAGING_PUBLISHABLE_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY']),
    serviceKey: first(env, ['STAGING_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY']),
  }
  const names = {
    ref: 'STAGING_PROJECT_REF',
    url: 'STAGING_SUPABASE_URL',
    dbHost: 'STAGING_DB_HOST',
    dbPassword: 'STAGING_DB_PASSWORD',
    publishableKey: 'SUPABASE_PUBLISHABLE_KEY',
    serviceKey: 'SUPABASE_SERVICE_ROLE_KEY',
  }
  const missing = Object.keys(names).filter((k) => !cfg[k]).map((k) => names[k])
  if (missing.length) throw new Error(`missing test config: ${missing.join(', ')}`)

  const prod = [PRODUCTION_REF, env.PRODUCTION_PROJECT_REF].filter(Boolean)
  const suspects = [cfg.ref, cfg.url, cfg.dbHost, jwtRef(cfg.publishableKey), jwtRef(cfg.serviceKey)]
  if (suspects.some((s) => s && prod.some((p) => s.includes(p)))) {
    throw new Error('refusing to run: configuration points at the PRODUCTION project')
  }
  if (new URL(cfg.url).hostname !== `${cfg.ref}.supabase.co`) {
    throw new Error('refusing to run: STAGING_SUPABASE_URL does not match STAGING_PROJECT_REF')
  }
  return cfg
}

// Postgres connection string for the Supabase CLI (`--db-url`). The session
// pooler needs the `postgres.<ref>` user; the direct host takes `postgres`.
export function stagingDbUrl(cfg) {
  const user = cfg.dbHost.includes('pooler.supabase.com') ? `postgres.${cfg.ref}` : 'postgres'
  return `postgresql://${user}:${encodeURIComponent(cfg.dbPassword)}@${cfg.dbHost}:5432/postgres`
}

// `.env.test` (if present) is the base; real environment variables win (CI).
export function loadConfig(file = ENV_FILE) {
  const fromFile = existsSync(file) ? parseEnvFile(readFileSync(file)) : {}
  return resolveConfig({ ...fromFile, ...process.env })
}
