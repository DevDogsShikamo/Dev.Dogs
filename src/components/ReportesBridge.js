// Bridge de reportes/cobros del portal EMPRESA. Agrega las prestaciones de los
// últimos 30 días del negocio: facturado / cobrado / pendiente, ingresos por día
// (últimos 7), top servicios, e ingresos por paseador. Monta 1 vez en el root del
// panel empresa; recarga en "supa:refresh". Lee __supa en cada llamada.
function mount(el, inputs, on) {
  el.style.display = "none";

  // negocioId desde el resolver central (authActions.ts). Ver globalThis.__ddSesion.
  function negocio() {
    return (globalThis.__ddSesion || function () { return Promise.resolve({ negocioId: null }); })()
      .then(function (s) { return s.negocioId; });
  }

  function p(n) { return String(n).padStart(2, "0"); }
  function iso(d) { return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); }
  function shiftDays(n) { var d = new Date(); d.setDate(d.getDate() + n); return d; }

  function load() {
    var supa = globalThis.__supa;
    if (!supa) return;
    negocio().then(function (neg) {
      if (!neg) return;
      var desde = iso(shiftDays(-29)), hasta = iso(new Date());

      // Mapa id→nombre de paseadores (para agrupar por paseador con nombre).
      var nombres = {};
      supa.from("profiles").select("id,nombre").eq("negocio_id", neg).eq("rol", "paseador").then(function (pr) {
        if (!(pr && pr.error)) (pr.data || []).forEach(function (r) { nombres[r.id] = r.nombre || "Paseador"; });

        supa.from("prestaciones")
          .select("precio_aplicado,cobrable,cobrado,servicio_id,cuidador_id,fecha,servicios(nombre)")
          .eq("negocio_id", neg).gte("fecha", desde).lte("fecha", hasta)
          .then(function (res) {
            if (res && res.error) return;
            var rows = res.data || [];
            var facturado = 0, cobrado = 0;
            var porSvc = {}, porCuid = {}, porDia = {};
            rows.forEach(function (r) {
              var monto = (r.cobrable === false) ? 0 : (r.precio_aplicado || 0);
              facturado += monto;
              if (r.cobrado) cobrado += monto;
              var svc = (r.servicios && r.servicios.nombre) || "Otro";
              porSvc[svc] = (porSvc[svc] || 0) + monto;
              if (r.cuidador_id) {
                if (!porCuid[r.cuidador_id]) porCuid[r.cuidador_id] = { monto: 0, paseos: 0 };
                porCuid[r.cuidador_id].monto += monto;
                porCuid[r.cuidador_id].paseos += 1;
              }
              porDia[r.fecha] = (porDia[r.fecha] || 0) + monto;
            });

            if (on.finanzas) on.finanzas(facturado, cobrado, facturado - cobrado);

            // Ingresos por día (últimos 7), etiqueta DD/MM.
            if (on.ingresosDia) {
              var dias = [];
              for (var i = 6; i >= 0; i--) {
                var d = shiftDays(-i), key = iso(d);
                dias.push({ dia: p(d.getDate()) + "/" + p(d.getMonth() + 1), monto: porDia[key] || 0 });
              }
              on.ingresosDia(dias);
            }

            // Top servicios por facturación (desc, top 6).
            if (on.topServicios) {
              var svcs = Object.keys(porSvc).map(function (k) { return { servicio: k, monto: porSvc[k] }; })
                .sort(function (a, b) { return b.monto - a.monto; }).slice(0, 6);
              on.topServicios(svcs);
            }

            // Ingresos por paseador (desc).
            if (on.porPaseador) {
              var ps = Object.keys(porCuid).map(function (k) { return { id: k, nombre: nombres[k] || "Paseador", monto: porCuid[k].monto, paseos: porCuid[k].paseos }; })
                .sort(function (a, b) { return b.monto - a.monto; });
              on.porPaseador(ps);
            }
          });
      });
    });
  }

  load();
  window.addEventListener("supa:refresh", load);
}
