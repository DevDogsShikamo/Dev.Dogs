// Monthly plans of the business (suscripciones), for the owner (empresa and the independent walker) and the
// office staff holding the finance permission (RLS decides; without it nothing is asked). Lists the active plans
// and the cancelled ones still running this month. Reloads on "supa:refresh".
function mount(el, inputs, on) {
  el.style.display = "none";
  var U = globalThis.__ddUtils;

  function load() {
    var supa = globalThis.__supa;
    if (!supa || !on.planes) return;
    globalThis.__ddSesion().then(function (s) {
      if (!s.negocioId) return;
      Promise.all([supa.rpc("is_owner"), supa.rpc("has_finanzas")]).then(function (r) {
        if (!(r[0].data === true || r[1].data === true)) return;
        // Every plan, past the 1000-row cap (U.pageAll; the order ends in id).
        U.pageAll(function () {
          return supa.from("suscripciones")
            .select("id,perro_id,servicio_id,estado,inicio,fin,precio_mensual,perros(nombre),servicios(nombre,tarifas(precio_mensual))")
            .eq("negocio_id", s.negocioId).in("estado", ["activa", "cancelada"]).or("fin.is.null,fin.gte." + U.today())
            .order("inicio").order("id");
        }).then(function (res) {
            if (res && res.error) return;   // keep what is shown if the network failed
            on.planes((res.data || []).map(function (p) {
              var svc = p.servicios || {}, t = svc.tarifas || {};
              return {
                id: p.id, perroId: p.perro_id || "", perro: (p.perros && p.perros.nombre) || "Perro",
                servicioId: p.servicio_id || "", servicio: svc.nombre || "",
                precio: p.precio_mensual != null ? p.precio_mensual : (t.precio_mensual || 0),
                desde: p.inicio || "", fin: p.fin || "", activo: p.estado === "activa",
              };
            }));
          });
      });
    });
  }

  load();
  window.addEventListener("supa:refresh", load);
}
