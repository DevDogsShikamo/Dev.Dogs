// Walk-photo Worker. Holds no secret: the R2 bucket is a native binding and every decision is delegated to
// Supabase by forwarding the caller's own bearer token (Supabase verifies the JWT, RLS and the foto_* RPCs decide).
//   PUT /f/{foto_id}   foto_subida_autorizar -> validate -> BUCKET.put -> foto_confirmar
//   GET /f/{foto_id}   paseo_fotos row visible to the caller? -> BUCKET.get (key derived from the row; the r/ copy
//                      once the lifecycle rule expired f/)
//   POST /retener/{incidente_id}   foto_retencion_autorizar -> copy each f/ key to r/ (the rule only expires f/)
// Vars: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY (public), ALLOWED_ORIGINS (comma list), ALLOW_LOCALHOST ("1" in staging).
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const MAX_BYTES = 2 * 1024 * 1024
const LOCALHOST = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/

// 'ok' | 'exif' | 'invalid'. Walks the segments up to SOS (start of scan) and refuses any APP1 (Exif/XMP, where
// GPS lives). ponytail: only the first scan is inspected; metadata between scans of a progressive JPEG is missed.
export function inspectJpeg(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return 'invalid'
  let i = 2
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return 'invalid'
    const m = b[i + 1]
    if (m === 0xff) { i++; continue } // fill byte
    if (m === 0xda) return 'ok'
    if (m === 0xe1) return 'exif'
    if (m === 0x00 || m === 0xd9) return 'invalid'
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { i += 2; continue } // markers without a length
    const len = (b[i + 2] << 8) | b[i + 3]
    if (len < 2) return 'invalid'
    i += 2 + len
  }
  return 'invalid'
}

// The request body, or null as soon as it exceeds `max` (the declared length may be absent or a lie).
async function readCapped(stream, max) {
  if (!stream) return new Uint8Array()
  const reader = stream.getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > max) { await reader.cancel(); return null }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.length }
  return out
}

export async function handle(request, env, fetchImpl = fetch) {
  const origin = request.headers.get('origin')
  const allowed = !origin || env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim()).includes(origin) || (env.ALLOW_LOCALHOST === '1' && LOCALHOST.test(origin))
  const base = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', vary: 'Origin' }
  if (origin && allowed) {
    Object.assign(base, {
      'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, PUT, POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '600',
    })
  }
  const reply = (status, body = null, extra = {}) => new Response(body, { status, headers: { ...base, ...extra } })
  const fail = (status, error) => reply(status, JSON.stringify({ error }), { 'content-type': 'application/json' })

  if (!env.BUCKET || !env.SUPABASE_URL) return fail(500, 'mal_configurado')
  if (!allowed) return fail(403, 'origen_no_permitido')
  if (request.method === 'OPTIONS') return reply(204)
  const [, ruta, raw] = new RegExp(`^/(f|retener)/(${UUID})$`, 'i').exec(new URL(request.url).pathname) ?? []
  const id = raw?.toLowerCase()
  if (!id) return fail(404, 'no_encontrado')
  if (!(ruta === 'f' ? ['GET', 'PUT'] : ['POST']).includes(request.method)) return fail(405, 'metodo_no_permitido')
  const token = /^Bearer (\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1]
  if (!token) return fail(401, 'no_autenticado')

  const supabase = (path, init = {}) =>
    fetchImpl(`${env.SUPABASE_URL}/rest/v1/${path}`, {
      ...init, headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    })
  const rpc = (name, args) => supabase(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args) })
  // Supabase's verdict, relayed: 401 bad token, 403 not allowed; anything else is an upstream fault.
  const refused = (up) => (up.status === 401 || up.status === 403 ? fail(up.status, up.status === 401 ? 'no_autenticado' : 'no_autorizado') : fail(502, 'proveedor_no_disponible'))

  if (ruta === 'retener') {
    const auth = await rpc('foto_retencion_autorizar', { p_incidente: id })
    if (!auth.ok) return refused(auth)
    const keys = await auth.json()
    const shape = new RegExp(`^f/${UUID}/${UUID}\\.jpg$`)
    if (!Array.isArray(keys) || !keys.every((k) => typeof k === 'string' && shape.test(k))) return fail(502, 'proveedor_no_disponible')
    let copiadas = 0
    for (const key of keys) {
      const object = await env.BUCKET.get(key)
      if (!object) continue // already expired: nothing left to keep
      await env.BUCKET.put(`r/${key.slice(2)}`, await object.arrayBuffer(), { httpMetadata: { contentType: 'image/jpeg' } })
      copiadas++
    }
    return reply(200, JSON.stringify({ copiadas }), { 'content-type': 'application/json' })
  }

  if (request.method === 'GET') {
    const up = await supabase(`paseo_fotos?id=eq.${id}&select=id,negocio_id`)
    if (!up.ok) return refused(up)
    const [row] = await up.json()
    // A hidden row and a missing row are the same 404: no existence leak.
    if (!row || row.id !== id || !new RegExp(`^${UUID}$`, 'i').test(row.negocio_id)) return fail(404, 'no_encontrado')
    const object = (await env.BUCKET.get(`f/${row.negocio_id}/${id}.jpg`)) ?? (await env.BUCKET.get(`r/${row.negocio_id}/${id}.jpg`))
    if (!object) return fail(404, 'no_encontrado')
    return reply(200, object.body, { 'content-type': 'image/jpeg', 'content-length': String(object.size) })
  }

  const auth = await rpc('foto_subida_autorizar', { p_id: id })
  if (!auth.ok) return refused(auth)
  const key = await auth.json()
  if (typeof key !== 'string' || !new RegExp(`^f/${UUID}/${id}\\.jpg$`).test(key)) return fail(502, 'proveedor_no_disponible')
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'image/jpeg') return fail(415, 'tipo_no_permitido')
  if (Number(request.headers.get('content-length')) > MAX_BYTES) return fail(413, 'demasiado_grande')
  const bytes = await readCapped(request.body, MAX_BYTES)
  if (!bytes) return fail(413, 'demasiado_grande')
  const verdict = inspectJpeg(bytes)
  if (verdict !== 'ok') return fail(422, verdict === 'exif' ? 'exif_no_permitido' : 'jpeg_invalido')

  await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } })
  const done = await rpc('foto_confirmar', { p_id: id, p_bytes: bytes.length })
  if (!done.ok) {
    await env.BUCKET.delete(key) // never leave an object the database does not know about
    return refused(done)
  }
  return reply(201, JSON.stringify({ id, bytes: bytes.length }), { 'content-type': 'application/json' })
}

export default { fetch: (request, env) => handle(request, env) }
