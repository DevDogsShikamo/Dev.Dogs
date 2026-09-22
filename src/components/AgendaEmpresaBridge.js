// Bridge de AGENDA del portal EMPRESA (multi-paseador). Lee las prestaciones del
// negocio de los próximos 7 días y las agrupa por (día, hora, servicio, paseador) en
// "salidas" con su paseador, cantidad de perros y estado. Monta 1 vez; recarga en
// "supa:refresh". Lee __supa en cada llamada. Sin retorno (mount return = updater).
function mount(el, inputs, on) {
  el.style.display = "none";
  function sesion() {
    return (globalThis.__ddSesion || function () { return Promise.resolve({ negocioId: null }); })();
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function iso(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }

  var ES = {
    DIASC: ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"],
    MESC: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
  };
  function dayLabel(d, i) {
    if (i === 0) return "Hoy";
    if (i === 1) return "Mañana";
    return ES.DIASC[d.getDay()] + " " + d.getDate() + " " + ES.MESC[d.getMonth()];
  }
  // Color por tipo de servicio (espeja AgendaCalendario.colorFor).
  function colorFor(tipo) {
    if (tipo === "paseo") return "purple";
    if (tipo === "guarderia") return "blue";
    if (tipo === "veterinaria") return "green";
    if (tipo === "bano") return "teal";
    if (tipo === "corte") return "orange";
    if (tipo === "adiestramiento") return "pink";
    return "yellow";
  }
  // Estado agregado de la salida: en_curso > programado > finalizado (lo relevante arriba).
  function rollup(estados) {
    if (estados.indexOf("en_curso") >= 0) return "en_curso";
    if (estados.indexOf("programado") >= 0) return "programado";
    if (estados.length && estados.every(function (e) { return e === "finalizado" || e === "no_asistio"; })) return "finalizado";
    return "programado";
  }

  function load() {
    var supa = globalThis.__supa;
    if (!supa) return;
    sesion().then(function (s) {
      var neg = s.negocioId;
      if (!neg) return;
      var t0 = new Date(); var start = iso(t0), end = iso(addDays(t0, 6));

      // 7 días candidatos (con su etiqueta); el count se llena tras la query.
      var dias = [];
      for (var i = 0; i < 7; i++) { var d = addDays(t0, i); dias.push({ fecha: iso(d), label: dayLabel(d, i), count: 0 }); }

      // Nombres de paseadores del negocio.
      var nombres = {};
      supa.from("profiles").select("id,nombre").eq("negocio_id", neg).eq("rol", "paseador").then(function (pr) {
        if (!(pr && pr.error)) (pr.data || []).forEach(function (r) { nombres[r.id] = r.nombre || "Paseador"; });

        supa.from("prestaciones")
          .select("id,estado,tipo,fecha,detalle,cuidador_id,servicios(nombre)")
          .eq("negocio_id", neg).gte("fecha", start).lte("fecha", end)
          .then(function (res) {
            if (res && res.error) return;
            var groups = {}, order = [];
            (res.data || []).forEach(function (r) {
              var det = r.detalle || {}, svc = r.servicios || {};
              var hora = det.hora || "08:00", tipo = r.tipo || "paseo", cid = r.cuidador_id || "";
              var key = r.fecha + "|" + hora + "|" + tipo + "|" + (svc.nombre || "") + "|" + cid;
              if (!groups[key]) {
                groups[key] = {
                  fecha: r.fecha || "", hora: hora, tipo: tipo, servicio: svc.nombre || tipo,
                  cuidador: cid ? (nombres[cid] || "Paseador") : "Sin asignar",
                  dogs: 0, estados: [],
                };
                order.push(key);
              }
              groups[key].dogs += 1;
              groups[key].estados.push(r.estado || "programado");
            });
            var rows = order.map(function (k) {
              var g = groups[k];
              return { fecha: g.fecha, hora: g.hora, tipo: g.tipo, servicio: g.servicio, cuidador: g.cuidador, dogs: g.dogs, estado: rollup(g.estados), color: colorFor(g.tipo) };
            }).sort(function (a, b) { return (a.fecha + a.hora).localeCompare(b.fecha + b.hora); });
            // Contar salidas por día para mostrar solo los días con actividad.
            var cnt = {};
            rows.forEach(function (r) { cnt[r.fecha] = (cnt[r.fecha] || 0) + 1; });
            dias.forEach(function (d) { d.count = cnt[d.fecha] || 0; });
            if (on.agendaDias) on.agendaDias(dias);
            if (on.agenda) on.agenda(rows);
          });
      });
    });
  }

  load();
  window.addEventListener("supa:refresh", load);
}
