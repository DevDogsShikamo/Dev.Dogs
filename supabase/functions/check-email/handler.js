// check-email: "does this email domain receive mail?". It takes the DOMAIN only (never the
// address), answers only the app's own origins and has no side effects. Pure so node:test can
// run it (tests/security/check-email.test.mjs); index.ts wires Deno's DNS and ALLOWED_ORIGINS.

// Dev origins (the Muten dev server takes any free port) are always accepted.
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/
const DOMAIN = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

const json = (body, status, headers) => Response.json(body, { status, headers })

export async function handle(req, { resolveMx, origins }) {
  const origin = req.headers.get('origin') || ''
  if (!origins.includes(origin) && !LOCAL.test(origin)) return json({ valid: false, reason: 'origin' }, 403, { Vary: 'Origin' })
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (req.method !== 'POST') return json({ valid: false, reason: 'method' }, 405, headers)

  let body
  try {
    body = await req.json()
  } catch {
    body = null
  }
  const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : []
  const domain = typeof body?.domain === 'string' ? body.domain.toLowerCase() : ''
  // Only { domain }: a full address (or anything else) is refused before any lookup.
  if (keys.length !== 1 || keys[0] !== 'domain' || !DOMAIN.test(domain)) return json({ valid: false, reason: 'bad_request' }, 400, headers)

  const records = await resolveMx(domain).catch(() => [])
  const valid = records.length > 0
  return json({ valid, reason: valid ? 'ok' : 'no_mx' }, 200, headers)
}
