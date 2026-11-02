// M2 offline walker map: the tile math behind "Preparar mapa sin conexión", the IndexedDB read-through, the download
// cap, the purge of dd-mapa at the end of a session, and the privacy rule (the device position never leaves the device).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { bboxDe, leerTile, prepararTiles, tileRange, tilesFor, TOPE_BYTES } from '../../src/lib/mapaTiles.js'
import { OFFLINE_DBS, purgeDbs } from '../../src/lib/localData.js'

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

test('bboxDe: the points plus a margin in km on every side; no points is null', () => {
  assert.equal(bboxDe([]), null)
  const [w, s, e, n] = bboxDe([{ lat: 4.65, lng: -74.05 }, { lat: 4.7, lng: -74.1 }], 1.5)
  // 1.5 km is ~0.01347 degrees of latitude everywhere, and a bit more of longitude away from the equator.
  assert.ok(Math.abs(s - (4.65 - 0.01347)) < 1e-4, `south ${s}`)
  assert.ok(Math.abs(n - (4.7 + 0.01347)) < 1e-4, `north ${n}`)
  assert.ok(w < -74.1 - 0.01347 && w > -74.1 - 0.0137, `west ${w}`)
  assert.ok(e > -74.05 + 0.01347 && e < -74.05 + 0.0137, `east ${e}`)
})

test('tileRange: Web Mercator tile indices (slippy map) of a bbox, inclusive', () => {
  // Bogotá centre at z13 and z0 (known values from the OSM tile formula).
  assert.deepEqual(tileRange([-74.0721, 4.711, -74.0721, 4.711], 13), { minX: 2410, maxX: 2410, minY: 3988, maxY: 3988 })
  assert.deepEqual(tileRange([-74.1, 4.6, -74.0, 4.7], 0), { minX: 0, maxX: 0, minY: 0, maxY: 0 })
  // North is the smaller y; the range is clamped to the world.
  const r = tileRange([-180, -85.06, 180, 85.06], 2)
  assert.deepEqual(r, { minX: 0, maxX: 3, minY: 0, maxY: 3 })
})

test('tilesFor: every tile of the bbox for each zoom, without duplicates', () => {
  const bbox = bboxDe([{ lat: 4.711, lng: -74.0721 }], 1.5)
  const t = tilesFor(bbox, 11, 13)
  const keys = t.map((x) => x.join('/'))
  assert.equal(new Set(keys).size, keys.length)
  assert.deepEqual([...new Set(t.map((x) => x[0]))], [11, 12, 13])
  for (const [z, x, y] of t) {
    const r = tileRange(bbox, z)
    assert.ok(x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY)
  }
  assert.equal(t.filter((x) => x[0] === 13).length, (() => { const r = tileRange(bbox, 13); return (r.maxX - r.minX + 1) * (r.maxY - r.minY + 1) })())
})

function memStore(initial = {}) {
  const m = new Map(Object.entries(initial))
  return { m, get: async (k) => m.get(k), put: async (k, v) => void m.set(k, v) }
}

test('leerTile: IndexedDB first, the network only on a miss, and a network read is not stored', async () => {
  const store = memStore({ '13/1/2': new Uint8Array([1]).buffer })
  let net = 0
  const red = async () => { net++; return new Uint8Array([9, 9]).buffer }
  assert.deepEqual(new Uint8Array(await leerTile('13/1/2', store, red)), new Uint8Array([1]))
  assert.equal(net, 0, 'a stored tile never touches the network')
  assert.deepEqual(new Uint8Array(await leerTile('13/1/3', store, red)), new Uint8Array([9, 9]))
  assert.equal(net, 1)
  assert.equal(store.m.has('13/1/3'), false, 'browsing never grows the offline store; only Preparar does')
  // An empty stored tile (no data there) is still a hit.
  store.m.set('13/1/4', new ArrayBuffer(0))
  assert.equal((await leerTile('13/1/4', store, red)).byteLength, 0)
  assert.equal(net, 1)
})

test('prepararTiles: downloads the missing tiles, keeps the stored ones and counts every byte', async () => {
  const store = memStore({ '11/0/0': new ArrayBuffer(5) })
  const asked = []
  const obtener = async (z, x, y) => { asked.push(`${z}/${x}/${y}`); return new ArrayBuffer(10) }
  const r = await prepararTiles({ tiles: [[11, 0, 0], [12, 0, 0], [12, 1, 0]], store, obtener, tope: 1000 })
  assert.deepEqual(r, { bytes: 25, n: 3, completo: true })
  assert.deepEqual(asked, ['12/0/0', '12/1/0'], 'a stored tile is not downloaded again')
  assert.equal(store.m.size, 3)
})

test('prepararTiles: stops before the cap and says it is incomplete', async () => {
  const store = memStore()
  const r = await prepararTiles({ tiles: [[11, 0, 0], [12, 0, 0], [12, 1, 0]], store, obtener: async () => new ArrayBuffer(400), tope: 1000 })
  assert.deepEqual(r, { bytes: 800, n: 2, completo: false, tope: true })
  assert.equal(store.m.size, 2, 'the tile that would pass the cap is not stored')
  assert.equal(TOPE_BYTES, 40 * 1024 * 1024)
})

test('prepararTiles: without network it is complete only if every tile was already stored', async () => {
  const fail = async () => { throw new TypeError('Failed to fetch') }
  const all = memStore({ '11/0/0': new ArrayBuffer(3), '12/0/0': new ArrayBuffer(4) })
  assert.deepEqual(await prepararTiles({ tiles: [[11, 0, 0], [12, 0, 0]], store: all, obtener: fail, tope: 100 }), { bytes: 7, n: 2, completo: true })
  const some = memStore({ '11/0/0': new ArrayBuffer(3) })
  const r = await prepararTiles({ tiles: [[11, 0, 0], [12, 0, 0]], store: some, obtener: fail, tope: 100 })
  assert.equal(r.completo, false)
  assert.equal(r.red, true, 'a network failure, not the cap')
})

test('prepararTiles: a tile the archive does not have is stored empty (offline it is a hit, not a miss)', async () => {
  const store = memStore()
  const r = await prepararTiles({ tiles: [[13, 5, 5]], store, obtener: async () => undefined, tope: 100 })
  assert.deepEqual(r, { bytes: 0, n: 1, completo: true })
  assert.equal(store.m.get('13/5/5').byteLength, 0)
})

test('purgeDbs: signing out deletes the offline map database', async () => {
  const deleted = []
  await purgeDbs({ deleteDatabase: (name) => { deleted.push(name); const req = {}; queueMicrotask(() => req.onsuccess?.()); return req } })
  assert.deepEqual(OFFLINE_DBS, ['dd-mapa'])
  assert.deepEqual(deleted, ['dd-mapa'])
  await purgeDbs(undefined) // no IndexedDB (old browser, node): nothing to do, no throw
})

test('purge on sign-out wires purgeDbs (authActions.ts)', () => {
  const src = read('src/lib/authActions.ts')
  assert.match(src, /import \{[^}]*purgeDbs[^}]*\} from "\.\/localData\.js"/)
  assert.match(src, /function purge\(\)[\s\S]*?purgeDbs\(/)
})

// ---- the device position never leaves the device ----------------------------------------------------
// MapaPaseo.js runs in a sandbox with spies on every way out (fetch, XHR, beacon, storage, IndexedDB, Supabase,
// the page's on.* handlers). A position is delivered; it may only reach the map handle on the device.
function sandbox() {
  const leaks = []
  const spy = (name) => new Proxy(function () {}, {
    get: (_, k) => { leaks.push(`${name}.${String(k)}`); return spy(`${name}.${String(k)}`) },
    apply: (_, __, args) => { leaks.push(`${name}(${JSON.stringify(args)})`) },
  })
  let watcher = null
  const cleared = []
  const calls = []
  const handle = { yo: (lng, lat) => calls.push(['yo', lng, lat]), centrar: (lng, lat) => calls.push(['centrar', lng, lat]), puntos: () => {}, preparar: () => {}, quitar: () => calls.push(['quitar']) }
  let observer = null
  const listeners = {}
  const el = { isConnected: true, classList: { add() {} }, style: {} }
  const ctx = {
    el,
    navigator: { geolocation: { watchPosition: (ok) => { watcher = ok; return 7 }, clearWatch: (id) => cleared.push(id), getCurrentPosition: () => leaks.push('getCurrentPosition') }, sendBeacon: spy('sendBeacon'), onLine: true },
    window: { addEventListener: (n, f) => { listeners[n] = f }, removeEventListener: (n) => { delete listeners[n] } },
    document: { body: {} },
    MutationObserver: function (cb) { observer = cb; this.observe = () => {}; this.disconnect = () => { observer = null } },
    fetch: spy('fetch'), XMLHttpRequest: spy('XMLHttpRequest'), WebSocket: spy('WebSocket'),
    localStorage: spy('localStorage'), sessionStorage: spy('sessionStorage'), indexedDB: spy('indexedDB'), caches: spy('caches'),
    globalThis: null,
  }
  ctx.globalThis = ctx
  ctx.__supa = spy('__supa')
  ctx.__ddUtils = { toast: () => {} }
  ctx.__ddMapa = { montar: async () => handle }
  vm.createContext(ctx)
  vm.runInContext(`${read('src/components/MapaPaseo.js')}\n;globalThis.__mount = mount`, ctx)
  const on = new Proxy({}, { get: (_, k) => (...args) => leaks.push(`on.${String(k)}(${JSON.stringify(args)})`) })
  return { ctx, on, leaks, calls, cleared, listeners, fire: (pos) => watcher(pos), remove: () => { el.isConnected = false; observer?.() } }
}

test('privacy: the walker position reaches only the map on the device, never fetch, storage, Supabase or the page', async () => {
  const s = sandbox()
  s.ctx.__mount(s.ctx.el, { puntos: [{ id: 'p', nombre: 'Rex', lat: 4.6, lng: -74.08, nota: '' }] }, s.on)
  await new Promise((r) => setImmediate(r))
  s.fire({ coords: { latitude: 4.123456, longitude: -74.654321, accuracy: 10 } })
  s.listeners['dd:mapa-centrar']()
  assert.deepEqual(s.calls, [['yo', -74.654321, 4.123456], ['centrar', -74.654321, 4.123456]])
  const leaked = s.leaks.filter((l) => /4\.12|74\.65/.test(l))
  assert.deepEqual(leaked, [], 'the coordinates went out')
  assert.deepEqual(s.leaks.filter((l) => /^(fetch|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB|caches|__supa)/.test(l)), [], 'no way out was touched at all')
})

test('privacy: the position is watched only while the map is on screen', async () => {
  const s = sandbox()
  s.ctx.__mount(s.ctx.el, { puntos: [] }, s.on)
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(s.cleared, [])
  s.remove()
  assert.deepEqual(s.cleared, [7], 'closing the map clears the watch')
  assert.ok(s.calls.some((c) => c[0] === 'quitar'), 'and removes the map')
  assert.equal(s.listeners['dd:mapa-centrar'], undefined)
})

test('privacy: the map engine never sends what yo/centrar receive (static check of mapa.ts)', () => {
  const src = read('src/lib/mapa.ts')
  for (const fn of ['yo', 'centrar']) {
    const body = new RegExp(`${fn}\\(lng: number, lat: number\\)[^{]*\\{([\\s\\S]*?)\\n    \\}`).exec(src)?.[1]
    assert.ok(body, `${fn} not found`)
    assert.doesNotMatch(body, /fetch|supa|Storage|indexedDB|idb|caches|sendBeacon|postMessage|dispatchEvent/, fn)
  }
})

test('public/map: the MapLibre worker and CSS are the pinned package files, and the glyphs and sprites the style asks for exist', () => {
  const bytes = (p) => readFileSync(new URL(`../../${p}`, import.meta.url))
  assert.ok(bytes('public/map/maplibre-gl-worker.js').equals(bytes('node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs')), 'recopy the worker after a maplibre-gl bump')
  assert.ok(bytes('public/map/maplibre-gl.css').equals(bytes('node_modules/maplibre-gl/dist/maplibre-gl.css')), 'recopy the CSS after a maplibre-gl bump')
  const pkg = JSON.parse(read('package.json')).dependencies
  for (const d of ['maplibre-gl', 'pmtiles', '@protomaps/basemaps']) assert.match(pkg[d], /^\d+\.\d+\.\d+$/, `${d} is pinned`)
  for (const f of ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic']) for (const r of ['0-255', '256-511']) assert.ok(bytes(`public/map/fonts/${f}/${r}.pbf`).length > 1000, `${f} ${r}`)
  for (const s of ['light.json', 'light.png', 'light@2x.json', 'light@2x.png']) assert.ok(bytes(`public/map/sprites/${s}`).length > 1000, s)
})
