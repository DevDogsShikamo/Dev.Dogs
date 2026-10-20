// Runs the Supabase CLI against STAGING only, building --db-url from .env.test
// so the password never appears on a command line, and redacting it from the
// CLI output. The CLI link (supabase/.temp) points at PRODUCTION: this script
// never uses --linked, and the config loader refuses production values.
//
//   node supabase/staging.mjs push      apply supabase/migrations
//   node supabase/staging.mjs dry-run   list pending migrations
//   node supabase/staging.mjs reset     wipe staging and re-apply migrations
import { spawnSync } from 'node:child_process'
import { loadConfig, stagingDbUrl } from '../tests/security/_env.mjs'

const COMMANDS = {
  push: ['db', 'push'],
  'dry-run': ['db', 'push', '--dry-run'],
  reset: ['db', 'reset', '--no-seed', '--yes'],
}
const args = COMMANDS[process.argv[2]]
if (!args) {
  console.error(`usage: node supabase/staging.mjs <${Object.keys(COMMANDS).join('|')}>`)
  process.exit(2)
}

const cfg = loadConfig()
const url = stagingDbUrl(cfg)
const run = spawnSync('supabase', [...args, '--db-url', url], {
  encoding: 'utf8',
  shell: process.platform === 'win32', // supabase is a .cmd shim on Windows
  input: 'y\n', // answers the reset/push confirmation prompt
})
const secrets = [cfg.dbPassword, encodeURIComponent(cfg.dbPassword), url]
const redact = (s) => secrets.reduce((out, v) => out.split(v).join('***'), s ?? '')
process.stdout.write(redact(run.stdout))
process.stderr.write(redact(run.stderr))
process.exit(run.status ?? 1)
