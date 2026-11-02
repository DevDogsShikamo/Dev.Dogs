// Offline walker map (M2): the tile math and storage rules, no imports and no globals, so node:test loads this file
// as is and mapa.ts uses the same logic. A tile key is "z/x/y" (slippy map / Web Mercator, y grows southwards).

// Download cap of "Preparar mapa sin conexión": the tiles stored for the day never pass it.
export const TOPE_BYTES = 40 * 1024 * 1024;

const KM_POR_GRADO = 111.32;

// [west, south, east, north] around the points plus `margenKm` on every side, or null without points.
export function bboxDe(puntos, margenKm = 1.5) {
  if (!puntos || !puntos.length) return null;
  let w = 180, s = 90, e = -180, n = -90;
  for (const p of puntos) {
    w = Math.min(w, p.lng); e = Math.max(e, p.lng);
    s = Math.min(s, p.lat); n = Math.max(n, p.lat);
  }
  const dLat = margenKm / KM_POR_GRADO;
  // A degree of longitude shrinks with the latitude: use the one farthest from the equator, so the margin never falls short.
  const dLng = margenKm / (KM_POR_GRADO * Math.cos((Math.max(Math.abs(s), Math.abs(n)) * Math.PI) / 180));
  return [w - dLng, s - dLat, e + dLng, n + dLat];
}

function tileX(lng, z) {
  return Math.floor(((lng + 180) / 360) * 2 ** z);
}
function tileY(lat, z) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * 2 ** z);
}
const clamp = (v, z) => Math.min(2 ** z - 1, Math.max(0, v));

// Inclusive tile index range of a bbox at zoom z.
export function tileRange([w, s, e, n], z) {
  return { minX: clamp(tileX(w, z), z), maxX: clamp(tileX(e, z), z), minY: clamp(tileY(n, z), z), maxY: clamp(tileY(s, z), z) };
}

// Every [z, x, y] covering the bbox for zMin..zMax.
export function tilesFor(bbox, zMin, zMax) {
  const out = [];
  for (let z = zMin; z <= zMax; z++) {
    const r = tileRange(bbox, z);
    for (let x = r.minX; x <= r.maxX; x++) for (let y = r.minY; y <= r.maxY; y++) out.push([z, x, y]);
  }
  return out;
}

// Read-through used by the map protocol: the stored tile first, the network (`red`) only on a miss. A network read is
// NOT stored: only prepararTiles fills the store, so browsing never grows it past the cap.
export async function leerTile(key, store, red) {
  const local = await store.get(key);
  return local !== undefined ? local : red();
}

// Stores every tile of `tiles` (store: { get, put }; obtener(z, x, y) -> ArrayBuffer | undefined when the archive has
// no tile there, stored empty so offline it is a hit). Tiles already stored are counted, not downloaded again.
// Stops before `tope` bytes. Result: { bytes, n, completo } plus tope: true (cap reached) or red: true (no network).
export async function prepararTiles({ tiles, store, obtener, tope }) {
  let bytes = 0, n = 0;
  for (const [z, x, y] of tiles) {
    const key = `${z}/${x}/${y}`;
    let data = await store.get(key);
    const nuevo = data === undefined;
    if (nuevo) {
      try {
        data = (await obtener(z, x, y)) || new ArrayBuffer(0);
      } catch {
        return { bytes, n, completo: false, red: true };
      }
    }
    if (bytes + data.byteLength > tope) return { bytes, n, completo: false, tope: true };
    if (nuevo) await store.put(key, data);
    bytes += data.byteLength;
    n++;
  }
  return { bytes, n, completo: true };
}
