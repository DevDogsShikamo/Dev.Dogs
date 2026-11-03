// Walker map of today's pickup points (M2), the only Custom of the map sheet: the map engine lives in mapa.ts
// (globalThis.__ddMapa, lazy-loads MapLibre + pmtiles); this file mounts it, follows the device position and wires
// the sheet buttons ("dd:mapa-centrar", "dd:mapa-preparar", fired by mapaCentrar / mapaPreparar in mapa.ts).
// Inputs: inputs(puntos: @mapaPuntos) [{ id, nombre, lat, lng, nota }]. Events: on.estado(text) for the offline status.
// Privacy: the position is watched only while this element is on screen (cleared when the sheet closes) and goes only
// to the map handle (the "you are here" dot). It is never sent, stored or handed to the page.
// Gotcha: the return value of mount is an UPDATER (new inputs), never a cleanup.
function mount(el, inputs, on) {
  el.classList.add("dd-mapa");
  var puntos = (inputs && inputs.puntos) || [];
  var mapa = null;
  var yo = null; // [lng, lat], in memory only
  var vivo = true;
  var watch = null;

  function estado(t) { if (vivo && on.estado) on.estado(t); }

  function centrar() {
    if (!mapa) return;
    if (yo) mapa.centrar(yo[0], yo[1]);
    else globalThis.__ddUtils.toast("Todavía no tenemos tu ubicación. Revisa el permiso de ubicación del navegador.");
  }
  function preparar() { if (mapa) mapa.preparar(); }

  function cerrar() {
    if (!vivo) return;
    vivo = false;
    if (watch !== null) navigator.geolocation.clearWatch(watch);
    obs.disconnect();
    window.removeEventListener("dd:mapa-centrar", centrar);
    window.removeEventListener("dd:mapa-preparar", preparar);
    if (mapa) mapa.quitar();
  }
  // The sheet unmounts this element: the watch and the map go with it.
  var obs = new MutationObserver(function () { if (!el.isConnected) cerrar(); });
  obs.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("dd:mapa-centrar", centrar);
  window.addEventListener("dd:mapa-preparar", preparar);

  if (navigator.geolocation) {
    watch = navigator.geolocation.watchPosition(function (pos) {
      yo = [pos.coords.longitude, pos.coords.latitude];
      if (mapa) mapa.yo(yo[0], yo[1]);
    }, function () { /* denied or unavailable: the map works without the dot */ }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
  }

  globalThis.__ddMapa.montar(el, puntos, estado).then(function (m) {
    if (!vivo) { m.quitar(); return; }
    mapa = m;
    m.puntos(puntos); // inputs that changed while the map was loading
    if (yo) m.yo(yo[0], yo[1]);
  }, function () { estado("No se pudo abrir el mapa"); });

  return function (next) {
    puntos = (next && next.puntos) || [];
    if (mapa) mapa.puntos(puntos);
  };
}
