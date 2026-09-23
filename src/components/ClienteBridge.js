// Bridge de datos del portal CLIENTE (dueño del perro). Monta 1 vez en el root del
// panel cliente; recarga en "supa:refresh". Lee __supa en cada llamada. Sesión (uid +
// negocioId) del auth store persistido.
function mount(el, inputs, on) {
  el.style.display = "none";
  // Date/session helpers: single source of truth on globalThis.__ddUtils / __ddSesion.
  var U = globalThis.__ddUtils;
  var iso = U.iso, addDaysD = U.addDays, today = U.today;

  function load() {
    var supa = globalThis.__supa;
    if (!supa) return;
    globalThis.__ddSesion().then(function (s) {
      if (!s.uid) return;

      // Mis perros (perro_duenos activos → perros).
      supa.from("perro_duenos").select("perro_id,perros(id,nombre,raza,tamano,foto_url)").eq("dueno_id", s.uid).eq("estado", "activo").then(function (res) {
        if (res && res.error) return;
        var rows = res.data || [];
        var perros = [], ids = [];
        rows.forEach(function (r) {
          var d = r.perros || {};
          if (!d.id) return;
          ids.push(d.id);
          perros.push({ id: d.id, nombre: d.nombre || "", raza: d.raza || "", tamano: d.tamano || "", foto: d.foto_url || "" });
        });
        if (on.misPerros) on.misPerros(perros);

        // Mis paseos (prestaciones de esos perros).
        if (on.misPaseos && ids.length) {
          supa.from("prestaciones").select("id,fecha,estado,tipo,detalle,perro_id,precio_aplicado,cobrable,cobrado,perros(nombre),servicios(nombre)").in("perro_id", ids).order("fecha").then(function (pr) {
            if (pr && pr.error) return;
            var t = today();
            var fotos = [];
            var paseos = (pr.data || []).map(function (r) {
              var det = r.detalle || {}, svc = r.servicios || {};
              var cobrable = r.cobrable !== false;
              var estado = r.estado || "programado";
              var precio = cobrable ? (r.precio_aplicado || 0) : 0;
              // Fotos del paseo (detalle.fotos) → lista plana {paseoId, url} para la Agenda.
              (det.fotos || []).forEach(function (u) { if (u) fotos.push({ paseoId: r.id, url: u }); });
              return {
                id: r.id, fecha: r.fecha || "", hora: det.hora || "", servicio: svc.nombre || r.tipo || "",
                estado: estado, perro: (r.perros && r.perros.nombre) || "", perroId: r.perro_id || "",
                precio: precio, facturable: (estado === "finalizado") ? precio : 0,
                cobrable: cobrable, cobrado: !!r.cobrado, cuidador: "", futuro: (r.fecha || "") >= t
              };
            });
            on.misPaseos(paseos);
            if (on.misFotos) on.misFotos(fotos);

            // Novedades (notificaciones in-app): paseos de HOY + paseos finalizados
            // recientes (≤3 días) que ya tienen fotos para ver. Sin estado "leído":
            // es un panel de lo relevante ahora.
            if (on.novedades) {
              var conFotos = {};
              fotos.forEach(function (f) { conFotos[f.paseoId] = true; });
              var cut = iso(addDaysD(new Date(), -3));
              var nov = [];
              paseos.forEach(function (p) {
                if (p.fecha === t && p.estado !== "finalizado" && p.estado !== "no_asistio") {
                  nov.push({ kind: "hoy", perro: p.perro, servicio: p.servicio, hora: p.hora, fecha: p.fecha, fotos: false });
                }
              });
              paseos.forEach(function (p) {
                if (p.estado === "finalizado" && conFotos[p.id] && p.fecha >= cut) {
                  nov.push({ kind: "foto", perro: p.perro, servicio: p.servicio, hora: p.hora, fecha: p.fecha, fotos: true });
                }
              });
              nov.sort(function (a, b) { return (b.fecha + b.hora).localeCompare(a.fecha + a.hora); });
              on.novedades(nov);
            }
          });
        } else if (on.misPaseos) { on.misPaseos([]); if (on.misFotos) on.misFotos([]); if (on.novedades) on.novedades([]); }
      });

      // Salidas disponibles del negocio (para reservar).
      if (on.salidas && s.negocioId) {
        supa.from("grupos").select("id,zona,hora,servicio_id,cuidador_id,servicios(nombre,tipo)").eq("negocio_id", s.negocioId).eq("activo", true).order("hora").then(function (gr) {
          if (gr && gr.error) return;
          var sal = (gr.data || []).map(function (g) {
            var svc = g.servicios || {};
            return { id: g.id, zona: g.zona || "", hora: g.hora || "08:00", servicio: svc.nombre || "", servicioId: g.servicio_id || "", cuidadorId: g.cuidador_id || "", tipo: svc.tipo || "paseo" };
          });
          on.salidas(sal);
        });
      }

      // Catálogo de servicios del negocio (para pedir baño/guardería/corte/etc.).
      if (on.servicios && s.negocioId) {
        supa.from("servicios").select("id,nombre,tipo,precio,modelo_cobro").eq("negocio_id", s.negocioId).eq("activo", true).order("tipo").then(function (svr) {
          if (svr && svr.error) return;
          var svs = (svr.data || []).map(function (r) {
            var mensual = r.modelo_cobro === "mensual";
            return { id: r.id, nombre: r.nombre || "", tipo: r.tipo || "paseo", precio: mensual ? 0 : (r.precio || 0), modelo: mensual ? "mensual" : "por_uso" };
          });
          on.servicios(svs);
        });
      }
    });
  }

  load();
  window.addEventListener("supa:refresh", load);
}
