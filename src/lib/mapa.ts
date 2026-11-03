// Offline walker map engine (M2). Exposed to the MapaPaseo Custom (which cannot import) as globalThis.__ddMapa; the
// sheet buttons reach it through mapaCentrar / mapaPreparar (window events the Custom listens to).
//  - Basemap: Protomaps (Colombia, archive m/<ARCHIVO>.pmtiles on the photo Worker, bearer token of the session,
//    byte ranges), style and layers from @protomaps/basemaps (light), glyphs and sprites from /map/ (same origin, so the
//    service worker keeps them once loaded).
//  - Offline: "Preparar mapa sin conexión" (also run every time the map opens) stores in IndexedDB (dd-mapa) the tiles
//    covering today's points plus 1.5 km, zooms ZMIN..MAXZOOM, capped at TOPE_BYTES. The ddmapa:// protocol reads a
//    tile from IndexedDB first and the network second. Tiles are keyed by z/x/y, so no archive header or directory has
//    to be kept: offline the map needs only the stored tiles. dd-mapa is deleted at sign-out (purgeDbs, authActions).
//  - Privacy: the device position (yo / centrar) only moves a marker and the camera; nothing here sends or stores it.
// MapLibre, pmtiles and the basemap style load lazily (separate chunks) the first time a map opens.
import { supa } from "./authActions";
import { bboxDe, leerTile, prepararTiles, tilesFor, TOPE_BYTES } from "./mapaTiles.js";

const ARCHIVO = "colombia-20261102"; // R2 key m/colombia-20261102.pmtiles (Protomaps daily build 2026-11-02)
const MAXZOOM = 13; // max zoom of the archive; MapLibre overzooms the vector tiles past it
const ZMIN = 11;
const MARGEN_KM = 1.5;
const DB = "dd-mapa";
const FUENTES = ["Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic"];
const ASSETS = [
  ...FUENTES.flatMap((f) => ["0-255", "256-511"].map((r) => "/map/fonts/" + encodeURIComponent(f) + "/" + r + ".pbf")),
  ...["light.json", "light.png", "light@2x.json", "light@2x.png"].map((s) => "/map/sprites/" + s),
];
const ATRIBUCION = '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a> · <a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a>';

type Punto = { id: string; nombre: string; lat: number; lng: number; nota: string };
type Estado = (texto: string) => void;
type Archivo = { getZxy: (z: number, x: number, y: number, signal?: AbortSignal) => Promise<{ data: ArrayBuffer } | undefined> };

// ---- IndexedDB: object store "tiles", key "<ARCHIVO>/z/x/y" -> ArrayBuffer ----
let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((ok, ko) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore("tiles");
      r.onsuccess = () => {
        const d = r.result;
        // Sign-out deletes the database: let it go instead of blocking the delete.
        d.onversionchange = () => { d.close(); dbp = null; };
        ok(d);
      };
      r.onerror = () => { dbp = null; ko(r.error); };
    });
  }
  return dbp;
}
function req<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then((d) => new Promise<T>((ok, ko) => {
    const r = fn(d.transaction("tiles", mode).objectStore("tiles"));
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  }));
}
const pre = ARCHIVO + "/";
const store = {
  // No IndexedDB (private mode, quota): a miss, so the map still works online.
  get: (k: string) => req<ArrayBuffer | undefined>("readonly", (s) => s.get(pre + k)).catch(() => undefined),
  put: (k: string, v: ArrayBuffer) => req("readwrite", (s) => s.put(v, pre + k)).then(() => undefined),
};
// Leaves only `keep` (the tiles of the last complete preparation): the day before's area and an older archive go.
async function podar(keep: Set<string>): Promise<void> {
  const keys = (await req<IDBValidKey[]>("readonly", (s) => s.getAllKeys())) as string[];
  const doomed = keys.filter((k) => !keep.has(k));
  await Promise.all(doomed.map((k) => req("readwrite", (s) => s.delete(k))));
}

// ---- the archive on the photo Worker, read with the session's bearer token ----
let archivo: Archivo | null = null;
function fuente(PMTiles: new (s: unknown) => Archivo): Archivo {
  const url = (globalThis as Record<string, unknown>).__ddFotos + "/m/" + ARCHIVO + ".pmtiles";
  return new PMTiles({
    getKey: () => url,
    getBytes: async (offset: number, length: number, signal?: AbortSignal) => {
      const { data } = await supa.auth.getSession();
      const res = await fetch(url, {
        headers: { authorization: "Bearer " + ((data.session && data.session.access_token) || ""), range: "bytes=" + offset + "-" + (offset + length - 1) },
        signal,
      });
      if (!res.ok) throw new Error("mapa " + res.status);
      return { data: await res.arrayBuffer(), etag: res.headers.get("etag") || undefined };
    },
  });
}

const mb = (bytes: number) => (bytes / 1048576).toFixed(1).replace(".", ",");

// Store the tiles of today's area; the text says what the walker can count on.
let preparando = false;
async function preparar(puntos: Punto[], estado: Estado): Promise<void> {
  const bbox = bboxDe(puntos, MARGEN_KM);
  if (!bbox) { estado("Sin puntos de recogida para preparar el mapa"); return; }
  if (preparando || !archivo) return;
  preparando = true;
  estado("Descargando…");
  const a = archivo;
  try {
    // Glyphs and sprites into the service worker cache while there is signal (errors offline are expected).
    if (navigator.onLine) ASSETS.forEach((u) => { fetch(u).catch(() => undefined); });
    const tiles = tilesFor(bbox, ZMIN, MAXZOOM);
    const r = await prepararTiles({ tiles, store, obtener: async (z: number, x: number, y: number) => (await a.getZxy(z, x, y))?.data, tope: TOPE_BYTES });
    if (r.completo) await podar(new Set(tiles.map((t: number[]) => pre + t.join("/"))));
    estado(r.completo ? "Mapa listo sin conexión (" + mb(r.bytes) + " MB)"
      : r.tope ? "Mapa sin conexión incompleto: se alcanzó el tope de " + mb(TOPE_BYTES) + " MB"
      : "Sin mapa offline para esta zona");
  } catch {
    estado("Sin mapa offline para esta zona");
  } finally {
    preparando = false;
  }
}

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text; // textContent: a dog name or note never becomes markup
  return e;
}

async function montar(host: HTMLElement, puntos: Punto[], estado: Estado) {
  const [ml, pm, bm] = await Promise.all([import("maplibre-gl"), import("pmtiles"), import("@protomaps/basemaps")]);
  if (!document.getElementById("dd-maplibre-css")) {
    const link = document.createElement("link");
    link.id = "dd-maplibre-css";
    link.rel = "stylesheet";
    link.href = "/map/maplibre-gl.css";
    document.head.appendChild(link);
  }
  if (!archivo) {
    // The bundled MapLibre cannot find its worker next to itself: it is served from /map/ (same version, see the test).
    ml.setWorkerUrl(location.origin + "/map/maplibre-gl-worker.js");
    archivo = fuente(pm.PMTiles as unknown as new (s: unknown) => Archivo);
    const a = archivo;
    ml.addProtocol("ddmapa", async (params, abort) => {
      const [z, x, y] = params.url.slice("ddmapa://".length).split("/").map(Number);
      const data = await leerTile(z + "/" + x + "/" + y, store, async () => (await a.getZxy(z, x, y, abort.signal))?.data || new ArrayBuffer(0));
      return { data };
    });
  }
  const map = new ml.Map({
    container: host,
    style: {
      version: 8,
      glyphs: location.origin + "/map/fonts/{fontstack}/{range}.pbf",
      sprite: location.origin + "/map/sprites/light",
      sources: { protomaps: { type: "vector", tiles: ["ddmapa://{z}/{x}/{y}"], maxzoom: MAXZOOM, attribution: ATRIBUCION } },
      layers: bm.layers("protomaps", bm.namedFlavor("light"), { lang: "es" }),
    },
    center: [-74.08, 4.65],
    zoom: ZMIN,
    minZoom: 5,
    maxZoom: 18,
    attributionControl: { compact: false },
  });
  map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");

  let marcas: { remove: () => void }[] = [];
  let actuales: Punto[] = [];
  let yoMarca: { setLngLat: (p: [number, number]) => unknown } | null = null;
  function pintar(ps: Punto[]) {
    if (JSON.stringify(ps) === JSON.stringify(actuales)) return;
    actuales = ps;
    marcas.forEach((m) => m.remove());
    marcas = ps.map((p) => {
      const card = el("div", "dd-mapa-pop");
      card.appendChild(el("strong", "", p.nombre));
      if (p.nota) card.appendChild(el("span", "", p.nota));
      return new ml.Marker({ element: el("div", "dd-mapa-pin", p.nombre), anchor: "bottom" })
        .setLngLat([p.lng, p.lat]).setPopup(new ml.Popup({ offset: 28 }).setDOMContent(card)).addTo(map);
    });
    const b = bboxDe(ps, 0.3);
    if (b) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 48, maxZoom: 16, duration: 0 });
  }
  pintar(puntos);
  preparar(puntos, estado);

  return {
    puntos: pintar,
    preparar: () => preparar(actuales, estado),
    yo(lng: number, lat: number) {
      if (yoMarca) yoMarca.setLngLat([lng, lat]);
      else yoMarca = new ml.Marker({ element: el("div", "dd-mapa-yo") }).setLngLat([lng, lat]).addTo(map);
    },
    centrar(lng: number, lat: number) {
      map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 15) });
    },
    quitar: () => map.remove(),
  };
}

(globalThis as Record<string, unknown>).__ddMapa = { montar };

// ---- `use` functions for the sheet (dashboard.muten) ----
export function mapaCentrar(): void {
  window.dispatchEvent(new CustomEvent("dd:mapa-centrar"));
}
export function mapaPreparar(): void {
  window.dispatchEvent(new CustomEvent("dd:mapa-preparar"));
}
// Turn-by-turn on openstreetmap.org, for when there is signal. The pickup point is the dog's, not the walker's.
export function comoLlegar(lat: number, lng: number): void {
  if (!isFinite(lat) || !isFinite(lng)) return;
  window.open("https://www.openstreetmap.org/directions?to=" + lat + "," + lng, "_blank", "noopener");
}
