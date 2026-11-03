// In-app notifications of the business portal (owner and office): notificaciones_sin_leer + notificaciones_mias.
// Mounted once in the empresa page. Refreshes on mount, on focus / visibilitychange and every 2 minutes while the
// tab is visible (the SupaAuthForm policy-watch approach), and on "notificaciones:refresh" (data.ts, after a read).
// "Ver más" (data.ts notificacionesVerMas -> "notificaciones:mas") appends the page before the oldest one shown.
// Listeners and the timer are installed once per page load; a later mount only swaps the callbacks and the host
// (mount returns nothing: its return value would be an updater, not a cleanup).
function mount(el, inputs, on) {
  el.style.display = "none";
  var PAGE = 20;
  var w = globalThis.__ddNotif;
  if (w) { w.on = on; w.el = el; w.raw = []; w.load(); return; }
  w = globalThis.__ddNotif = { on: on, el: el, raw: [] };

  var TIPOS = { reserva: "Nueva reserva", compra: "Nueva compra", cancelacion: "Reserva cancelada", reprogramacion: "Reserva reprogramada", resena: "Reseña por aprobar", perro_nuevo: "Perro registrado por un cliente", foto_reporte: "Foto del paseo reportada" };
  // The portal section where each one is handled (empresa.muten section names).
  var DESTINO = { reserva: "agenda", cancelacion: "agenda", reprogramacion: "agenda", compra: "reportes", resena: "resenas", perro_nuevo: "perros", foto_reporte: "incidentes" };
  var rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
  function hace(iso) {
    var s = (Date.parse(iso) - Date.now()) / 1000;
    var u = [["day", 86400], ["hour", 3600], ["minute", 60]];
    for (var i = 0; i < u.length; i++) if (Math.abs(s) >= u[i][1]) return rtf.format(Math.round(s / u[i][1]), u[i][0]);
    return "ahora";
  }
  function fila(r) {
    return { id: r.id, tipo: r.tipo, label: TIPOS[r.tipo] || "Aviso", resumen: r.resumen || "", cuando: hace(r.created_at), leida: !!r.leida, destino: DESTINO[r.tipo] || "dashboard" };
  }
  function supa() { return globalThis.__supa; }
  // Only for the signed-in user, while the portal is on screen and the tab visible.
  function activo() {
    return !!(supa() && w.el.isConnected && document.visibilityState !== "hidden" && globalThis.__ddUid && globalThis.__ddUid());
  }
  // The first page, or as many as are shown (capped by the RPC at 100), so a refresh keeps what "Ver más" opened.
  function load() {
    if (!activo()) return;
    var n = Math.min(Math.max(PAGE, w.raw.length), 99);
    supa().rpc("notificaciones_sin_leer").then(function (r) { if (r && !r.error) w.on.sinLeer(r.data || 0); });
    supa().rpc("notificaciones_mias", { p_limit: n + 1 }).then(function (r) {
      if (!r || r.error) return; // keep what is shown if the network failed
      var rows = r.data || [];
      w.raw = rows.slice(0, n);
      w.on.items(w.raw.map(fila));
      w.on.mas(rows.length > n);
    });
  }
  function verMas() {
    if (!activo() || !w.raw.length) return;
    supa().rpc("notificaciones_mias", { p_limit: PAGE + 1, p_antes: w.raw[w.raw.length - 1].created_at }).then(function (r) {
      if (!r || r.error) return;
      var rows = r.data || [];
      w.raw = w.raw.concat(rows.slice(0, PAGE));
      w.on.items(w.raw.map(fila));
      w.on.mas(rows.length > PAGE);
    });
  }
  w.load = load;
  window.addEventListener("focus", load);
  document.addEventListener("visibilitychange", load);
  window.addEventListener("notificaciones:refresh", load);
  window.addEventListener("notificaciones:mas", verMas);
  setInterval(load, 2 * 60 * 1000);
  load();
}
