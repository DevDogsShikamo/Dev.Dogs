// Bridge de reportes/cobros del portal EMPRESA. The month picked in the page (inputs.mes "YYYY-MM", the current
// month when empty): realizado / cobrado / pendiente per service, monthly charges included (on.meses lists the
// current and the 11 previous months). Plus the last 30 days: ingresos por día (últimos 7), top servicios, e
// ingresos por paseador. Monta 1 vez en el root del panel empresa; recarga en "supa:refresh". Lee __supa en cada
// llamada. Returns an updater: picking another month reloads only that month.
function mount(el, inputs, on) {
  el.style.display = "none";

  // negocioId desde el resolver central (authActions.ts). Ver globalThis.__ddSesion.
  function negocio() {
    return globalThis.__ddSesion().then(function (s) { return s.negocioId; });
  }

  // Date helpers: single source of truth on globalThis.__ddUtils (authActions.ts).
  var U = globalThis.__ddUtils;
  var p = U.pad, iso = U.iso;
  // Totals need every row: U.pageAll reads past the 1000-row cap (orders end in prestacion_id / id).
  var todas = U.pageAll;
  function shiftDays(n) { return U.addDays(new Date(), n); }

  // Los importes viven en `cobros` (RLS: dueño u oficina con el permiso de finanzas). Sin permiso no se
  // pide nada: is_owner() / has_finanzas() deciden, y `on.permiso` le avisa a la página (el permiso de la oficina).
  var mesSel = inputs.mes || U.today().slice(0, 7);
  var listo = null;   // {supa, neg} once allowed
  function load() {
    var supa = globalThis.__supa;
    if (!supa) return;
    negocio().then(function (neg) {
      if (!neg) return;
      Promise.all([supa.rpc("has_finanzas"), supa.rpc("is_owner")]).then(function (r) {
        var pm = r[0];
        if (!pm || pm.error) return;
        if (on.permiso) on.permiso(pm.data === true);
        if (pm.data !== true && r[1].data !== true) return;
        listo = { supa: supa, neg: neg };
        if (on.meses) on.meses(meses());
        cargarMes();
        cargar(supa, neg);
      });
    });
  }

  // The current month and the 11 before it, newest first.
  function meses() {
    var d = new Date(), out = [];
    for (var i = 0; i < 12; i++) {
      var x = new Date(d.getFullYear(), d.getMonth() - i, 1), ym = x.getFullYear() + "-" + p(x.getMonth() + 1);
      out.push({ id: ym, mes: ym, label: U.mesLabel(ym) });
    }
    return out;
  }

  // Realizado = finished chargeable services of the month (a monthly charge is one); cobrado = marked paid.
  // ponytail: summed in the browser over every row of the month (paged); an SQL aggregate if a month gets huge.
  function cargarMes() {
    if (!listo || !on.mesServicios) return;
    var mes = mesSel, y = Number(mes.slice(0, 4)), m = Number(mes.slice(5, 7));
    var hasta = mes + "-" + p(new Date(y, m, 0).getDate());
    var db = listo.supa, neg = listo.neg;
    todas(function () {
      return db.from("cobros")
        .select("precio_aplicado,cobrado,prestaciones!inner(fecha,estado,tipo,detalle,servicios(nombre))")
        .eq("negocio_id", neg).eq("cobrable", true).eq("prestaciones.estado", "finalizado")
        .gte("prestaciones.fecha", mes + "-01").lte("prestaciones.fecha", hasta).order("prestacion_id");
    }).then(function (res) {
        if ((res && res.error) || mes !== mesSel) return;
        var por = {};
        (res.data || []).forEach(function (c) {
          var q = c.prestaciones || {}, det = q.detalle || {}, svc = (q.servicios && q.servicios.nombre) || q.tipo || "Otro";
          var k = det.mensualidad ? "Mensualidad " + svc : svc, monto = c.precio_aplicado || 0;
          if (!por[k]) por[k] = { servicio: k, realizado: 0, cobrado: 0, pendiente: 0 };
          por[k].realizado += monto;
          if (c.cobrado) por[k].cobrado += monto; else por[k].pendiente += monto;
        });
        on.mesServicios(Object.keys(por).map(function (k) { return por[k]; }).sort(function (a, b) { return b.realizado - a.realizado; }));
      });
  }

  function cargar(supa, neg) {
      var desde = iso(shiftDays(-29)), hasta = iso(new Date());

      // Dueño de cada perro (solo el nombre) para rotular los cobros pendientes.
      var duenos = {};
      var duenosP = todas(function () { return supa.rpc("perro_duenos_nombres").order("perro_id").order("nombre"); }).then(function (dr) {
        if (!(dr && dr.error)) (dr.data || []).forEach(function (d) { duenos[d.perro_id] = d.nombre || ""; });
      });

      // Pendientes de cobro: paseos realizados (finalizados), cobrables y aún no cobrados.
      if (on.pendientes) {
        todas(function () {
          return supa.from("cobros")
            .select("prestacion_id,precio_aplicado,prestaciones!inner(fecha,estado,perro_id,detalle,perros(nombre),servicios(nombre))")
            .eq("negocio_id", neg).eq("cobrable", true).eq("cobrado", false).eq("prestaciones.estado", "finalizado").order("prestacion_id");
        }).then(function (pr) {
            if (pr && pr.error) return;
            duenosP.then(function () {
              var rows = (pr.data || []).map(function (r) {
                var q = r.prestaciones || {}, pe = (q.perros && q.perros.nombre) || "", du = duenos[q.perro_id];
                var svc = (q.servicios && q.servicios.nombre) || "";
                if (q.detalle && q.detalle.mensualidad) svc = "Mensualidad " + svc + " · " + U.mesLabel(q.detalle.mensualidad);
                return { id: r.prestacion_id, fecha: q.fecha || "", perro: du ? pe + " · " + du : pe, servicio: svc, monto: r.precio_aplicado || 0 };
              }).sort(function (x, y) { return x.fecha < y.fecha ? -1 : x.fecha > y.fecha ? 1 : 0; });
              on.pendientes(rows);
            });
          });
      }

      // Mapa id→nombre de paseadores (para agrupar por paseador con nombre).
      var nombres = {};
      todas(function () { return supa.from("profiles").select("id,nombre").eq("negocio_id", neg).eq("rol", "paseador").order("id"); }).then(function (pr) {
        if (!(pr && pr.error)) (pr.data || []).forEach(function (r) { nombres[r.id] = r.nombre || "Paseador"; });

        todas(function () {
          return supa.from("cobros")
            .select("precio_aplicado,cobrable,cobrado,prestaciones!inner(fecha,cuidador_id,servicios(nombre))")
            .eq("negocio_id", neg).gte("prestaciones.fecha", desde).lte("prestaciones.fecha", hasta).order("prestacion_id");
        }).then(function (res) {
            if (res && res.error) return;
            var rows = res.data || [];
            var porSvc = {}, porCuid = {}, porDia = {};
            rows.forEach(function (c) {
              var r = c.prestaciones || {};
              var monto = (c.cobrable === false) ? 0 : (c.precio_aplicado || 0);
              var svc = (r.servicios && r.servicios.nombre) || "Otro";
              porSvc[svc] = (porSvc[svc] || 0) + monto;
              if (r.cuidador_id) {
                if (!porCuid[r.cuidador_id]) porCuid[r.cuidador_id] = { monto: 0, paseos: 0 };
                porCuid[r.cuidador_id].monto += monto;
                porCuid[r.cuidador_id].paseos += 1;
              }
              porDia[r.fecha] = (porDia[r.fecha] || 0) + monto;
            });

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
  return function (next) {
    var m = (next && next.mes) || U.today().slice(0, 7);
    if (m !== mesSel) { mesSel = m; cargarMes(); }
  };
}
