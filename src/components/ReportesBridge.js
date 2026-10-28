// Bridge de reportes/cobros del portal EMPRESA. Agrega las prestaciones de los
// últimos 30 días del negocio: facturado / cobrado / pendiente, ingresos por día
// (últimos 7), top servicios, e ingresos por paseador. Monta 1 vez en el root del
// panel empresa; recarga en "supa:refresh". Lee __supa en cada llamada.
function mount(el, inputs, on) {
  el.style.display = "none";

  // negocioId desde el resolver central (authActions.ts). Ver globalThis.__ddSesion.
  function negocio() {
    return globalThis.__ddSesion().then(function (s) { return s.negocioId; });
  }

  // Date helpers: single source of truth on globalThis.__ddUtils (authActions.ts).
  var U = globalThis.__ddUtils;
  var p = U.pad, iso = U.iso;
  function shiftDays(n) { return U.addDays(new Date(), n); }

  // Los importes viven en `cobros` (RLS: dueño u oficina con el permiso de finanzas). Sin permiso no se
  // pide nada: has_finanzas() decide, y `on.permiso` le avisa a la página para mostrar u ocultar la sección.
  function load() {
    var supa = globalThis.__supa;
    if (!supa) return;
    negocio().then(function (neg) {
      if (!neg) return;
      supa.rpc("has_finanzas").then(function (pm) {
        if (!pm || pm.error) return;
        var ok = pm.data === true;
        if (on.permiso) on.permiso(ok);
        if (ok) cargar(supa, neg);
      });
    });
  }

  function cargar(supa, neg) {
      var desde = iso(shiftDays(-29)), hasta = iso(new Date());

      // Dueño de cada perro (solo el nombre) para rotular los cobros pendientes.
      var duenos = {};
      var duenosP = supa.rpc("perro_duenos_nombres").then(function (dr) {
        if (!(dr && dr.error)) (dr.data || []).forEach(function (d) { duenos[d.perro_id] = d.nombre || ""; });
      });

      // Pendientes de cobro: paseos realizados (finalizados), cobrables y aún no cobrados.
      if (on.pendientes) {
        supa.from("cobros")
          .select("prestacion_id,precio_aplicado,prestaciones!inner(fecha,estado,perro_id,perros(nombre),servicios(nombre))")
          .eq("negocio_id", neg).eq("cobrable", true).eq("cobrado", false).eq("prestaciones.estado", "finalizado")
          .then(function (pr) {
            if (pr && pr.error) return;
            duenosP.then(function () {
              var rows = (pr.data || []).map(function (r) {
                var q = r.prestaciones || {}, pe = (q.perros && q.perros.nombre) || "", du = duenos[q.perro_id];
                return { id: r.prestacion_id, fecha: q.fecha || "", perro: du ? pe + " · " + du : pe, servicio: (q.servicios && q.servicios.nombre) || "", monto: r.precio_aplicado || 0 };
              }).sort(function (x, y) { return x.fecha < y.fecha ? -1 : x.fecha > y.fecha ? 1 : 0; });
              on.pendientes(rows);
            });
          });
      }

      // Mapa id→nombre de paseadores (para agrupar por paseador con nombre).
      var nombres = {};
      supa.from("profiles").select("id,nombre").eq("negocio_id", neg).eq("rol", "paseador").then(function (pr) {
        if (!(pr && pr.error)) (pr.data || []).forEach(function (r) { nombres[r.id] = r.nombre || "Paseador"; });

        supa.from("cobros")
          .select("precio_aplicado,cobrable,cobrado,prestaciones!inner(fecha,cuidador_id,servicios(nombre))")
          .eq("negocio_id", neg).gte("prestaciones.fecha", desde).lte("prestaciones.fecha", hasta)
          .then(function (res) {
            if (res && res.error) return;
            var rows = res.data || [];
            var facturado = 0, cobrado = 0;
            var porSvc = {}, porCuid = {}, porDia = {};
            rows.forEach(function (c) {
              var r = c.prestaciones || {};
              var monto = (c.cobrable === false) ? 0 : (c.precio_aplicado || 0);
              facturado += monto;
              if (c.cobrado) cobrado += monto;
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
  }

  load();
  window.addEventListener("supa:refresh", load);
}
