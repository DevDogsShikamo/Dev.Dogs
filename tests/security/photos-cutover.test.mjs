// S5b cutover on STAGING: the legacy Supabase Storage photo path is closed (WP-1a), the old URL-attach
// RPC is gone so an arbitrary URL can never be stored (WP-3e), and every definer function in `public`
// still pins an empty search_path (AH-1a, final scan).
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { admin, as, ids, seed } from './_actors.mjs'
import { loadConfig } from './_env.mjs'
import { sql } from './_sql.mjs'

const BUCKET = 'paseos'
const probe = `s5b-probe/${crypto.randomUUID()}.jpg`
const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])

before(async () => {
  await seed()
  const up = await admin().storage.from(BUCKET).upload(probe, BYTES, { contentType: 'image/jpeg' })
  assert.equal(up.error, null, `precondition: a legacy object exists (${up.error?.message})`)
})
after(() => admin().storage.from(BUCKET).remove([probe]))

const publicUrl = () => `${loadConfig().url}/storage/v1/object/public/${BUCKET}/${probe}`

test('WP-1a: the legacy bucket is private and no policy on storage.objects mentions it', () => {
  assert.deepEqual(sql(`select public from storage.buckets where id = '${BUCKET}'`), [{ public: false }])
  assert.deepEqual(
    sql(`select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' and (coalesce(qual, '') ilike '%${BUCKET}%' or coalesce(with_check, '') ilike '%${BUCKET}%')`),
    [],
  )
})

test('WP-1a: the object that exists is not served through its former public URL', async () => {
  const res = await fetch(publicUrl())
  assert.notEqual(res.status, 200, 'the public URL still serves the object')
  assert.equal((await admin().storage.from(BUCKET).download(probe)).error, null, 'precondition: the object is still there for the service role')
})

for (const actor of ['ANON', 'CLIENT', 'OTHER', 'WALKER_CO']) {
  test(`WP-1a: ${actor} can neither list nor read nor write in the legacy bucket`, async () => {
    const storage = (await as(actor)).storage.from(BUCKET)
    const listed = await storage.list('s5b-probe')
    assert.deepEqual(listed.data ?? [], [], 'the listing shows the object')
    assert.ok((await storage.download(probe)).error, 'the object was downloaded')
    assert.ok((await storage.upload(`s5b-probe/${actor}.jpg`, BYTES, { contentType: 'image/jpeg' })).error, 'the upload was accepted')
  })
}

test('WP-3e: paseo_agregar_foto no longer exists, so no URL string can be attached to a walk', async () => {
  assert.deepEqual(sql(`select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname = 'paseo_agregar_foto'`), [])
  for (const actor of ['WALKER_CO', 'CLIENT', 'ANON']) {
    const res = await (await as(actor)).rpc('paseo_agregar_foto', { p_ids: [ids.prestaciones.p1], p_url: 'https://evil.example/x.jpg' })
    assert.equal(res.error?.code, 'PGRST202', actor)
  }
  const row = (await admin().from('prestaciones').select('detalle').eq('id', ids.prestaciones.p1).single()).data
  assert.equal(row.detalle?.fotos, undefined, 'a URL was stored')
})

test('WP-3e: the only registration function takes walk ids; a URL in its place is refused and stores nothing', async () => {
  const before = (await admin().from('paseo_fotos').select('id', { count: 'exact', head: true })).count
  const walker = await as('WALKER_CO')
  for (const bad of [['https://evil.example/x.jpg'], 'https://evil.example/x.jpg']) {
    const res = await walker.rpc('foto_registrar', { p_prestaciones: bad })
    assert.ok(res.error, JSON.stringify(bad))
  }
  assert.equal((await admin().from('paseo_fotos').select('id', { count: 'exact', head: true })).count, before)
})

test('AH-1a: every SECURITY DEFINER function in public pins search_path to empty, and anon executes only the public reviews aggregate', () => {
  const definers = sql(`select proname, coalesce(proconfig @> array['search_path=""'], false) as pinned from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and prosecdef`)
  assert.ok(definers.length > 30, `scan sanity: ${definers.length} definers`)
  assert.deepEqual(definers.filter((d) => !d.pinned).map((d) => d.proname), [])
  assert.deepEqual(sql(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`), [{ proname: 'resenas_publicas' }])
})
