// Bridge de datos del portal CLIENTE (dueño del perro). Monta 1 vez en el root del
// panel cliente; recarga en "supa:refresh". Lee __supa en cada llamada. Sesión (uid +
// negocioId) del auth store persistido.
function mount(el, inputs, on) {
  el.style.display = "none";
  // Date/session helpers: single source of truth on globalThis.__ddUtils / __ddSesion.
  var U = globalThis.__ddUtils;
  var iso = U.iso, addDaysD = U.addDays, today = U.today;
  // The four causes a business may reject a review for (resenas.motivo_rechazo), as the author reads them.
  var MOTIVOS = { ofensiva: "Ofensiva o discriminatoria", datos_personales: "Contiene datos personales", no_relacionada: "No es sobre el servicio", falsa_o_spam: "Falsa o spam" };

  // ---- Fotos del paseo (Worker de fotos, S5b) ---------------------------------------------------
  // Cada foto se pide con mi token y se muestra como blob: (solo en memoria; no se guarda ni hay
  // en la pagina una URL con permiso). Una foto vencida, perdida o sin acceso responde 404: no se
  // muestra nada y no se avisa (WP-7a).
  var blobs = {}; // foto_id -> blob: URL
  function fotosDe(presIds) {
    var supa = globalThis.__supa;
    if (!presIds.length) return Promise.resolve([]);
    return supa.from("paseo_foto_perros").select("foto_id,prestacion_id").in("prestacion_id", presIds)
      .then(function (r) { return (r && !r.error && r.data) || []; });
  }
  function traer(id, tok) {
    if (blobs[id]) return Promise.resolve();
    return fetch(globalThis.__ddFotos + "/f/" + id, { headers: { authorization: "Bearer " + tok } })
      .then(function (res) { return res.ok ? res.blob() : null; })
      .then(function (b) { if (b) blobs[id] = URL.createObjectURL(b); })
      .catch(function () { /* sin red: se reintenta en el proximo refresco */ });
  }
  function mostrar(tags) {
    var vigentes = {};
    tags.forEach(function (t) { vigentes[t.foto_id] = true; });
    return globalThis.__supa.auth.getSession().then(function (r) {
      var tok = r && r.data && r.data.session && r.data.session.access_token;
      return tok ? Promise.all(Object.keys(vigentes).map(function (id) { return traer(id, tok); })) : null;
    }).then(function () {
      var rows = [];
      tags.forEach(function (t) { if (blobs[t.foto_id]) rows.push({ id: t.foto_id, paseoId: t.prestacion_id, url: blobs[t.foto_id] }); });
      on.misFotos(rows);
      Object.keys(blobs).forEach(function (id) { if (!vigentes[id]) { URL.revokeObjectURL(blobs[id]); delete blobs[id]; } });
    });
  }
  // Novedades (notificaciones in-app): paseos de HOY + paseos finalizados recientes (<=3 dias) que
  // ya tienen fotos para ver. Sin estado "leido": es un panel de lo relevante ahora.
  function novedades(paseos, tags) {
    var conFotos = {};
    tags.forEach(function (t) { conFotos[t.prestacion_id] = true; });
    var cut = iso(addDaysD(new Date(), -3));
    var nov = [];
    paseos.forEach(function (p) {
      if (p.fecha === today() && p.estado !== "finalizado" && p.estado !== "no_asistio" && p.estado !== "cancelado") {
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

  function load() {
    var supa = globalThis.__supa;
    if (!supa) return;
    globalThis.__ddSesion().then(function (s) {
      if (!s.uid) return;

      // Mis perros (perro_duenos activos → perros).
      supa.from("perro_duenos").select("perro_id,perros(id,nombre,raza,tamano,foto_url,activo,en_celo,enfermedad_contagiosa,certificado_salud)").eq("dueno_id", s.uid).eq("estado", "activo").then(function (res) {
        if (res && res.error) return;
        var rows = res.data || [];
        var perros = [], ids = [];
        rows.forEach(function (r) {
          var d = r.perros || {};
          if (!d.id || d.activo === false) return;   // un perro dado de baja por el negocio ya no se lista
          ids.push(d.id);
          perros.push({ id: d.id, nombre: d.nombre || "", raza: d.raza || "", tamano: d.tamano || "", foto: d.foto_url || "", celo: !!d.en_celo, contagio: !!d.enfermedad_contagiosa, certificado: d.certificado_salud || "" });
        });
        if (on.misPerros) on.misPerros(perros);
        if (on.loaded) on.loaded(true);

        // Mis paseos (prestaciones de esos perros).
        if (on.misPaseos && ids.length) {
          supa.from("prestaciones").select("id,fecha,estado,tipo,detalle,perro_id,cobros(precio_aplicado,cobrable,cobrado),perros(nombre),servicios(nombre)").in("perro_id", ids).order("fecha").then(function (pr) {
            if (pr && pr.error) return;
            var t = today();
            // Device clock, like today(): the server re-checks with the Bogotá clock.
            var nd = new Date(), ahora = String(nd.getHours()).padStart(2, "0") + ":" + String(nd.getMinutes()).padStart(2, "0");
            var paseos = (pr.data || []).map(function (r) {
              var det = r.detalle || {}, svc = r.servicios || {};
              var cb = r.cobros || {};
              var cobrable = cb.cobrable !== false;
              var estado = r.estado || "programado";
              var precio = cobrable ? (cb.precio_aplicado || 0) : 0;
              var producto = r.tipo === "comida" || r.tipo === "accesorio";
              // A cancelled booking is no longer upcoming; only a scheduled service from today on can be cancelled,
              // and a same-day one only before its hour (the rule of reserva_cancelar).
              var futuro = (r.fecha || "") >= t && estado !== "cancelado";
              var hora = /^\d\d:\d\d$/.test(det.hora || "") ? det.hora : "";
              var aTiempo = r.fecha !== t || !hora || hora > ahora;
              return {
                id: r.id, fecha: r.fecha || "", hora: det.hora || "", servicio: svc.nombre || r.tipo || "",
                estado: estado, perro: (r.perros && r.perros.nombre) || "", perroId: r.perro_id || "",
                precio: precio, facturable: (estado === "finalizado") ? precio : 0,
                cobrable: cobrable, cobrado: !!cb.cobrado, cuidador: "", futuro: futuro,
                producto: producto, cancelable: futuro && aTiempo && estado === "programado" && !producto
              };
            });
            on.misPaseos(paseos);
            // Fotos del paseo: las etiquetas que el RLS me deja ver (solo perros mios, foto subida y vigente).
            // Las novedades usan las etiquetas; las imagenes se piden despues al Worker con mi token.
            fotosDe(paseos.map(function (p) { return p.id; })).then(function (tags) {
              if (on.novedades) novedades(paseos, tags);
              if (on.misFotos) mostrar(tags);
            });
          });
        } else if (on.misPaseos) { on.misPaseos([]); if (on.misFotos) on.misFotos([]); if (on.novedades) on.novedades([]); }
      });

      // Salidas disponibles del negocio (para reservar).
      if (on.salidas && s.negocioId) {
        supa.from("grupos").select("id,zona,hora,servicio_id,servicios(nombre,tipo)").eq("negocio_id", s.negocioId).eq("activo", true).order("hora").then(function (gr) {
          if (gr && gr.error) return;
          var sal = (gr.data || []).map(function (g) {
            var svc = g.servicios || {};
            return { id: g.id, zona: g.zona || "", hora: g.hora || "08:00", servicio: svc.nombre || "", servicioId: g.servicio_id || "", tipo: svc.tipo || "paseo" };
          });
          on.salidas(sal);
        });
      }

      // Mi reseña del negocio (RLS: solo la mía). A rejection carries one of the four fixed causes, shown to me.
      if (on.miResena && s.negocioId) {
        supa.from("resenas").select("rating,texto,publicar_nombre,estado,motivo_rechazo").eq("autor_id", s.uid).eq("negocio_id", s.negocioId).then(function (rr) {
          if (rr && rr.error) return;
          on.miResena((rr.data || []).map(function (r) { return { rating: r.rating, texto: r.texto || "", publicar: !!r.publicar_nombre, estado: r.estado || "", motivo: MOTIVOS[r.motivo_rechazo] ? "No publicada: " + MOTIVOS[r.motivo_rechazo] : "No publicada" }; }));
        });
      }

      // Legal identity of the business (Ley 1480 art. 50 and 53): 0 or 1 row, read-only for the client. The RPC
      // masks a personal ID (CC/CE/PAS) to its last 4 digits; the table itself is for the owner and the office.
      if (on.identidad && s.negocioId) {
        supa.rpc("negocio_identidad_publica").then(function (ir) {
          if (ir && ir.error) return;
          on.identidad(ir.data || []);
        });
      }

      // Catálogo de servicios del negocio (para pedir baño/guardería/corte/etc.).
      if (on.servicios && s.negocioId) {
        supa.from("servicios").select("id,nombre,tipo,modelo_cobro,tarifas(precio)").eq("negocio_id", s.negocioId).eq("activo", true).order("tipo").then(function (svr) {
          if (svr && svr.error) return;
          var svs = (svr.data || []).map(function (r) {
            var mensual = r.modelo_cobro === "mensual";
            return { id: r.id, nombre: r.nombre || "", tipo: r.tipo || "paseo", precio: mensual ? 0 : ((r.tarifas && r.tarifas.precio) || 0), modelo: mensual ? "mensual" : "por_uso" };
          });
          on.servicios(svs);
        });
      }
    });
  }

  load();
  window.addEventListener("supa:refresh", load);
}
