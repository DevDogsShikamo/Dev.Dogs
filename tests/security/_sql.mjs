// Read-only catalog queries against STAGING through the Supabase CLI (`db query
// --db-url`). supabase-js cannot read pg_catalog, so introspection tests (TI-5a,
// TI-6b) use this. Import-safe; the config loader refuses production values and
// the password is redacted from anything we surface.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, stagingDbUrl } from './_env.mjs'

export function sql(query) {
  const cfg = loadConfig()
  const url = stagingDbUrl(cfg)
  // The query goes through a file: `supabase` is a .cmd shim on Windows, which
  // needs a shell, and a shell would mangle quotes in an inline query.
  const dir = mkdtempSync(join(tmpdir(), 'dd-sql-'))
  const file = join(dir, 'q.sql')
  writeFileSync(file, query)
  try {
    const run = spawnSync('supabase', ['db', 'query', '--db-url', url, '--output-format', 'json', '--file', file], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    })
    const redact = (s) => [cfg.dbPassword, encodeURIComponent(cfg.dbPassword), url].reduce((o, v) => o.split(v).join('***'), s ?? '')
    if (run.status !== 0) throw new Error(`db query failed: ${redact(`${run.stderr}${run.stdout}` || String(run.error))}`)
    // Statements without a result set (DO, DDL) print only a command tag.
    if (!/^\s*[[{]/.test(run.stdout)) return []
    const parsed = JSON.parse(run.stdout)
    return parsed.rows ?? parsed
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
