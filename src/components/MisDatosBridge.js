// /mis-datos: reads the signed-in user's own data from mis_datos_exportar() (the same JSON the download
// returns) and re-reads on "supa:refresh" (after a correction or a new request). Dates are shown in
// Bogota time; vence_at is a plain date, so it is pinned to noon there before formatting.
function mount(el, inputs, on) {
  el.style.display = "none";
  function dia(v) {
    return v ? new Date(v).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Bogota" }) : "";
  }
  function load() {
    var supa = globalThis.__supa;
    if (!supa) return;
    supa.rpc("mis_datos_exportar").then(function (r) {
      if (!r || r.error || !r.data) return;
      var d = r.data, p = d.perfil || {}, n = d.negocio || {};
      on.perfil({ nombre: p.nombre || "", email: (d.cuenta && d.cuenta.email) || "", telefono: d.telefono || "", rol: p.rol || "", negocio: n.nombre || "" });
      on.solicitudes((d.solicitudes || []).slice().reverse().map(function (s) {
        return { tipo: s.tipo, estado: s.estado, fecha: dia(s.creada_at), vence: dia(s.vence_at + "T12:00:00-05:00"), respuesta: s.respuesta || "" };
      }));
    });
  }
  load();
  window.addEventListener("supa:refresh", load);
}
