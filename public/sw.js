// Service Worker de DevDogs — hace la app usable sin conexión (PWA).
// Estrategia:
//   • Supabase (API/realtime) y Worker de fotos → SIEMPRE red. Los DATOS ya se cachean por los stores
//     con `persist` (SWR en localStorage); no duplicamos acá.
//   • Fuentes (Google Fonts, immutables) → cache-first.
//   • Shell + assets same-origin (HTML/JS/CSS/imágenes) → network-first: online trae
//     lo fresco (seguro para el HMR de `muten dev`), y si NO hay red cae al cache →
//     la app arranca y navega offline (lo que se haya visitado online queda cacheado).
//   • Escrituras (no-GET) → nunca se tocan (van directo a la red / a la cola offline).
const CACHE = "devdogs-v2";

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

function putInCache(req, res) {
  try {
    var clone = res.clone();
    caches.open(CACHE).then(function (c) { c.put(req, clone); });
  } catch (e) { /* noop */ }
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return; // escrituras: no las tocamos
  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  // API / realtime de Supabase → siempre red (datos vía persist).
  if (url.hostname.indexOf("supabase.co") !== -1) return;

  // Worker de fotos (requests con bearer, privadas): nunca se interceptan ni se cachean.
  // Si el Worker pasa a un dominio propio, agregar ese host aquí.
  if (url.hostname.indexOf("devdogs-fotos") === 0) return;

  // Fuentes (immutables) → cache-first.
  if (url.hostname.indexOf("gstatic.com") !== -1 || url.hostname.indexOf("googleapis.com") !== -1) {
    e.respondWith(
      caches.match(req).then(function (m) {
        return m || fetch(req).then(function (res) { putInCache(req, res); return res; }).catch(function () { return m; });
      })
    );
    return;
  }

  // Shell + assets → network-first, con fallback al cache offline.
  e.respondWith(
    fetch(req)
      .then(function (res) {
        if (res && res.status === 200 && url.origin === self.location.origin) {
          putInCache(req, res);
          // Every SPA route serves the same shell: keep a copy under /index.html so ANY route
          // (e.g. /login after an offline sign-out) opens offline, not only the visited ones.
          if (req.mode === "navigate") putInCache(new Request("/index.html"), res);
        }
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (m) {
          if (m) return m;
          // Navegación offline sin match exacto → devolvé el shell cacheado (SPA).
          if (req.mode === "navigate") return caches.match("/index.html").then(function (h) { return h || caches.match("/"); });
          return undefined;
        });
      })
  );
});
