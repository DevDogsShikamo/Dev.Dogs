// SR-1b: the suite must refuse to run against production, and must fail
// loudly (naming the variable, never echoing a value) when config is missing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PRODUCTION_REF, parseEnvFile, resolveConfig, stagingDbUrl } from './_env.mjs'

const STAGING = 'ruutxrqocwphzufenzti'
const jwt = (claims) =>
  ['{"alg":"HS256"}', JSON.stringify(claims), 'sig']
    .map((p, i) => (i === 2 ? p : Buffer.from(p).toString('base64url')))
    .join('.')

const good = () => ({
  STAGING_PROJECT_REF: STAGING,
  STAGING_SUPABASE_URL: `https://${STAGING}.supabase.co`,
  STAGING_DB_HOST: `db.${STAGING}.supabase.co`,
  STAGING_DB_PASSWORD: 'pw-not-a-secret',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: STAGING, role: 'service_role' }),
})

test('accepts a complete staging configuration', () => {
  const cfg = resolveConfig(good())
  assert.equal(cfg.ref, STAGING)
  assert.equal(cfg.url, `https://${STAGING}.supabase.co`)
  assert.equal(cfg.publishableKey, 'sb_publishable_test')
})

test('refuses a URL containing the production ref', () => {
  const env = { ...good(), STAGING_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co` }
  assert.throws(() => resolveConfig(env), /production/i)
})

test('refuses when the staging ref IS the production ref', () => {
  const env = { ...good(), STAGING_PROJECT_REF: PRODUCTION_REF }
  assert.throws(() => resolveConfig(env), /production/i)
})

test('refuses a DB host pointing at production', () => {
  const env = { ...good(), STAGING_DB_HOST: `db.${PRODUCTION_REF}.supabase.co` }
  assert.throws(() => resolveConfig(env), /production/i)
})

test('refuses a service key minted for production', () => {
  const env = { ...good(), SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: PRODUCTION_REF, role: 'service_role' }) }
  assert.throws(() => resolveConfig(env), /production/i)
})

test('refuses an extra production ref supplied via PRODUCTION_PROJECT_REF', () => {
  const env = { ...good(), PRODUCTION_PROJECT_REF: STAGING }
  assert.throws(() => resolveConfig(env), /production/i)
})

test('missing variables are named, values are never echoed', () => {
  const env = good()
  delete env.SUPABASE_SERVICE_ROLE_KEY
  delete env.STAGING_DB_PASSWORD
  assert.throws(
    () => resolveConfig(env),
    (err) =>
      /STAGING_DB_PASSWORD/.test(err.message) &&
      /SUPABASE_SERVICE_ROLE_KEY/.test(err.message) &&
      !err.message.includes('sb_publishable_test'),
  )
})

test('stagingDbUrl percent-encodes the password and picks the pooler user', () => {
  const direct = stagingDbUrl(resolveConfig({ ...good(), STAGING_DB_PASSWORD: 'p@ss/w:rd' }))
  assert.equal(direct, `postgresql://postgres:p%40ss%2Fw%3Ard@db.${STAGING}.supabase.co:5432/postgres`)
  const pooled = stagingDbUrl(
    resolveConfig({ ...good(), STAGING_DB_HOST: 'aws-0-us-west-2.pooler.supabase.com' }),
  )
  assert.equal(
    pooled,
    `postgresql://postgres.${STAGING}:pw-not-a-secret@aws-0-us-west-2.pooler.supabase.com:5432/postgres`,
  )
})

test('parseEnvFile reads UTF-8 and a UTF-16LE tail appended by PowerShell', () => {
  const head = Buffer.from('A_ONE=1\r\nA_TWO=two\r\n', 'utf8')
  const tail = Buffer.from('﻿B_THREE=3\r\nB_FOUR=four\r\n', 'utf16le')
  assert.deepEqual(parseEnvFile(Buffer.concat([head, tail])), {
    A_ONE: '1',
    A_TWO: 'two',
    B_THREE: '3',
    B_FOUR: 'four',
  })
})
