// Bootstrap de datos CONSOLIDADO — montado UNA sola vez en el root de la app
// (no por sección), así navegar entre secciones NO vuelve a pedir. Hidrata los
// stores una vez y recarga en "supa:refresh" (que dispara cada escritura).
//
// La sesión {uid, negocioId} se resuelve UNA vez y se comparte entre todos los
// loaders: camino rápido desde el auth store persistido en localStorage (0 red),
// fallback a getUser → profiles solo si falta. La memo vive en el closure; al
// hacer logout dd-app se desmonta y la memo se limpia sola.
//
// IMPORTANTE (gotcha Muten): NO retornar función desde mount — Muten la trata
// como "updater" reactivo, no como cleanup, y romper listeners. Los listeners de
// window mueren con la página al hacer logout.
function mount(el, inputs, on) {
  el.style.display = "none";

  // Sesión {uid, negocioId} desde el resolver central (authActions.ts, memoizado
  // y compartido entre todos los bridges). Ver globalThis.__ddSesion.
  function sesion() {
    return (globalThis.__ddSesion || function () { return Promise.resolve({ uid: null, negocioId: null }); })();
  }

  // ---------- helpers de fecha/idioma (grupos de hoy) ----------
  var MESC_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  var MESC_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var DIAS_ES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
  var DIAS_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  var EMO = ["🐕", "🐩", "🦮", "🐺", "🐶", "🐕‍🦺"];
  function EN() { return globalThis.__lang === "en"; }
  function p(n) { return String(n).padStart(2, "0"); }
  function iso(d) { return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); }
  function today() { return iso(new Date()); }
  function nowNum() { var d = new Date(); return d.getHours() + d.getMinutes() / 60; }
  function timeNum(t) { if (!t) return 8; var a = String(t).split(":"); return (+a[0]) + (+a[1] || 0) / 60; }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function fechaLabel() {
    var d = new Date(), dias = EN() ? DIAS_EN : DIAS_ES, mesc = EN() ? MESC_EN : MESC_ES;
    return EN() ? (dias[(d.getDay() + 6) % 7] + ", " + mesc[d.getMonth()] + " " + d.getDate())
                : (dias[(d.getDay() + 6) % 7] + " " + d.getDate() + " " + mesc[d.getMonth()]);
  }

  // ---------- PERROS (catálogo + relaciones simétricas) ----------
  function loadPerros() {
    var supa = globalThis.__supa;
    if (!supa) return;
    sesion().then(function (s) {
      if (!s.negocioId) return;
      supa.from("perros")
        .select("id,nombre,raza,tamano,conducta,tips,foto_url,sociabilidad,incompatibles")
        .eq("negocio_id", s.negocioId).eq("activo", true).order("nombre")
        .then(function (res) {
          if (res && res.error) return;   // SWR: no pisar el cache si la red falló
          var raw = res.data || [];
          var RANK = { cuidado: 1, tolera: 2, no_tolera: 3 };
          var byId = {};
          raw.forEach(function (r) { byId[r.id] = r; });
          var union = {};
          raw.forEach(function (r) { union[r.id] = {}; });
          function put(a, b, nivel, nota, motivo) {
            if (a === b || !union[a] || !byId[b]) return;
            if (!union[a][b]) union[a][b] = { nivel: nivel || "no_tolera", nota: nota || "", motivo: motivo || "" };
          }
          raw.forEach(function (r) {
            (r.incompatibles || []).forEach(function (e) {
              var other = (e && e.id) ? e.id : e;
              put(r.id, other, (e && e.nivel) ? e.nivel : "no_tolera", (e && e.nota) ? e.nota : "", (e && e.motivo) ? e.motivo : "");
              put(other, r.id, (e && e.nivel) ? e.nivel : "no_tolera", (e && e.nota) ? e.nota : "", (e && e.motivo) ? e.motivo : "");
            });
          });
          var perros = raw.map(function (r) {
            var rel = union[r.id], ids = Object.keys(rel), worst = "";
            ids.forEach(function (x) { if ((RANK[rel[x].nivel] || 0) > (RANK[worst] || 0)) worst = rel[x].nivel; });
            return {
              id: r.id, nombre: r.nombre || "", raza: r.raza || "", tamano: r.tamano || "",
              conducta: r.conducta || "", tips: r.tips || "", foto: r.foto_url || "",
              sociabilidad: r.sociabilidad || "", relN: ids.length, relWorst: worst
            };
          });
          on.perros(perros);
          if (on.relaciones) {
            var flat = [];
            raw.forEach(function (r) {
              var rel = union[r.id];
              Object.keys(rel).forEach(function (otherId) {
                var o = byId[otherId];
                if (!o) return;
                flat.push({
                  id: r.id + "|" + otherId, deId: r.id, aId: otherId,
                  aNombre: o.nombre || "", aFoto: o.foto_url || "", aRaza: o.raza || "",
                  nivel: rel[otherId].nivel, nota: rel[otherId].nota, motivo: rel[otherId].motivo || ""
                });
              });
            });
            on.relaciones(flat);
          }
        });
    });
  }

  // ---------- SERVICIOS + ZONAS ----------
  function loadServicios() {
    var supa = globalThis.__supa;
    if (!supa) return;
    sesion().then(function (s) {
      if (!s.negocioId) return;
      if (on.zonas) {
        supa.from("negocios").select("zonas").eq("id", s.negocioId).single().then(function (nr) {
          if (nr && nr.error) return;   // SWR: no pisar el cache si falló
          on.zonas((nr.data && nr.data.zonas) || []);
        });
      }
      if (on.servicios) {
        supa.from("servicios")
          .select("id,nombre,tipo,duracion_min,precio,precio_mensual,modelo_cobro")
          .eq("negocio_id", s.negocioId).eq("activo", true).order("tipo")
          .then(function (res) {
            if (res && res.error) return;   // SWR: no pisar el cache si falló
            var rows = (res.data || []).map(function (r) {
              var mensual = r.modelo_cobro === "mensual";
              return {
                id: r.id, nombre: r.nombre || "", tipo: r.tipo || "paseo", duracion: r.duracion_min || 0,
                precio: mensual ? (r.precio_mensual || 0) : (r.precio || 0), modelo: mensual ? "mensual" : "por_uso"
              };
            });
            on.servicios(rows);
          });
      }
    });
  }

  // ---------- GRUPOS (ABM: todas las salidas) ----------
  function loadGruposAdmin() {
    var supa = globalThis.__supa;
    if (!supa || !on.todos) return;
    sesion().then(function (s) {
      if (!s.negocioId) return;
      supa.from("grupos")
        .select("id,nombre,zona,hora,duracion_min,color,servicio_id,servicios(nombre)")
        .eq("negocio_id", s.negocioId).eq("activo", true).order("hora")
        .then(function (res) {
          if (res && res.error) return;   // SWR: no pisar el cache si falló
          var rows = (res.data || []).map(function (r) {
            return {
              id: r.id, nombre: r.nombre || "", zona: r.zona || "", hora: r.hora || "08:00",
              horaNum: parseInt(String(r.hora || "8"), 10) || 8, duracion: r.duracion_min || 60,
              servicio: r.servicio_id || "", color: r.color || "purple"
            };
          });
          on.todos(rows);
        });
    });
  }

  // ---------- GRUPOS DE HOY (timeline + perros del día + conflictos) ----------
  function loadGruposHoy() {
    var supa = globalThis.__supa;
    if (!supa || !on.groups) return;
    sesion().then(function (s) {
      if (!s.uid) return;
      supa.from("prestaciones")
        .select("id,estado,tipo,detalle,perros(id,nombre,foto_url,incompatibles),servicios(nombre,duracion_min)")
        .eq("cuidador_id", s.uid).eq("fecha", today())
        .then(function (res) {
          if (res && res.error) return;   // no pisar con vacío si la red falló
          var rows = res.data || [], groups = {}, order = [], perrosSeen = {}, perrosHoy = [];
          rows.forEach(function (r) {
            var d = r.detalle || {}, svc = r.servicios || {}, pobj = r.perros || {};
            var hora = d.hora || "08:00", tipo = r.tipo || "paseo";
            var key = hora + "|" + tipo + "|" + (svc.nombre || "");
            if (!groups[key]) { groups[key] = { gid: r.id, hora: hora, tipo: tipo, svc: svc.nombre || "", dur: 0, dogs: [] }; order.push(key); }
            var g = groups[key], dur = d.duracion || svc.duracion_min || 60;
            if (dur > g.dur) g.dur = dur;
            var nombre = pobj.nombre || "Perro";
            g.dogs.push({ id: pobj.id || "", nombre: nombre, foto: pobj.foto_url || "", inc: pobj.incompatibles || [] });
            if (!perrosSeen[nombre]) { perrosSeen[nombre] = true; perrosHoy.push({ nombre: nombre, foto: pobj.foto_url || "" }); }
          });
          var cards = order.map(function (k) {
            var g = groups[k], start = timeNum(g.hora), durH = Math.max(1, (g.dur || 60) / 60);
            var endN = start + durH, hh = Math.floor(endN), mm = Math.round((endN - hh) * 60), count = g.dogs.length;
            return {
              id: g.gid, titulo: g.svc || cap(g.tipo), desde: g.hora, hasta: p(hh) + ":" + p(mm), endNum: endN,
              mins: Math.round(durH * 60), count: count,
              c1: count > 0 ? EMO[0] : "", c2: count > 1 ? EMO[1] : "", c3: count > 2 ? EMO[2] : "",
              extra: count > 3 ? count - 3 : 0, estado: "programado", prox: false
            };
          }).sort(function (a, b) { return a.desde < b.desde ? -1 : 1; });
          if (cards.length) {
            var now = nowNum(), pick = -1;
            for (var i = 0; i < cards.length; i++) { if (cards[i].endNum >= now) { pick = i; break; } }
            if (pick < 0) pick = cards.length - 1;
            cards[pick].prox = true;
          }
          on.groups(cards);
          if (on.fecha) on.fecha(fechaLabel());
          if (on.perrosHoy) on.perrosHoy(perrosHoy);

          // Conflictos: pares incompatibles en la MISMA salida (tolera NO cuenta).
          if (on.conflictos) {
            var RANK = { cuidado: 1, no_tolera: 2 };
            function relBetween(a, b) {
              var e = (a.inc || []).filter(function (x) { return x && x.id === b.id; })[0];
              if (!e) e = (b.inc || []).filter(function (x) { return x && x.id === a.id; })[0];
              return e || null;
            }
            var conflictos = [];
            order.forEach(function (k) {
              var g = groups[k], ds = g.dogs, label = (g.svc || cap(g.tipo)) + " · " + g.hora;
              for (var i = 0; i < ds.length; i++) {
                for (var j = i + 1; j < ds.length; j++) {
                  if (!ds[i].id || !ds[j].id || ds[i].id === ds[j].id) continue;
                  var e = relBetween(ds[i], ds[j]);
                  if (!e || e.nivel === "tolera") continue;
                  conflictos.push({
                    id: ds[i].id + "|" + ds[j].id + "|" + k, salida: label,
                    aId: ds[i].id, aNombre: ds[i].nombre, aFoto: ds[i].foto,
                    bId: ds[j].id, bNombre: ds[j].nombre, bFoto: ds[j].foto,
                    nivel: e.nivel || "no_tolera", motivo: e.motivo || "", nota: e.nota || ""
                  });
                }
              }
            });
            conflictos.sort(function (a, b) { return (RANK[b.nivel] || 0) - (RANK[a.nivel] || 0); });
            on.conflictos(conflictos);
          }
        });
    });
  }

  function loadAll() {
    loadPerros();
    loadServicios();
    loadGruposAdmin();
    loadGruposHoy();
  }

  loadAll();
  window.addEventListener("supa:refresh", loadAll);
  // Solo grupos-hoy depende del idioma (etiqueta de fecha + emojis).
  window.addEventListener("lang:changed", loadGruposHoy);

  // ---- Fase 2: Realtime (push). Suscribe a los cambios de las tablas del usuario;
  // cada cambio recarga SOLO el dominio afectado (granular), sin polling. Requiere
  // Realtime habilitado (supabase/migration_realtime.sql). Si no lo está, subscribe()
  // no recibe eventos y la app sigue andando por supa:refresh — es aditivo, no rompe.
  function reCal() {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("cal:nav", { detail: globalThis.__calNav || {} }));
  }
  function subscribeRealtime() {
    var supa = globalThis.__supa;
    if (!supa || !supa.channel) return;
    sesion().then(function (s) {
      if (!s.negocioId) return;
      // Limpia una suscripción previa (p.ej. tras re-login) para no mezclar usuarios.
      if (globalThis.__ddChannel && supa.removeChannel) { try { supa.removeChannel(globalThis.__ddChannel); } catch (e) {} }
      var PG = "postgres_changes";
      var neg = "negocio_id=eq." + s.negocioId;
      var ch = supa.channel("dd-" + s.negocioId);
      ch.on(PG, { event: "*", schema: "public", table: "perros", filter: neg }, function () { loadPerros(); loadGruposHoy(); reCal(); });
      ch.on(PG, { event: "*", schema: "public", table: "servicios", filter: neg }, function () { loadServicios(); });
      ch.on(PG, { event: "*", schema: "public", table: "grupos", filter: neg }, function () { loadGruposAdmin(); });
      ch.on(PG, { event: "*", schema: "public", table: "negocios", filter: "id=eq." + s.negocioId }, function () { loadServicios(); });
      if (s.uid) {
        ch.on(PG, { event: "*", schema: "public", table: "prestaciones", filter: "cuidador_id=eq." + s.uid }, function () { loadGruposHoy(); reCal(); });
        ch.on(PG, { event: "*", schema: "public", table: "profiles", filter: "id=eq." + s.uid }, function () { reCal(); });
      }
      ch.subscribe();
      globalThis.__ddChannel = ch;
    });
  }
  subscribeRealtime();
  // Re-intenta suscribir si al montar no había canal (sesión/__supa no listos aún,
  // o la conexión se cayó y se limpió). No re-suscribe si ya hay canal activo.
  window.addEventListener("supa:refresh", function () { if (!globalThis.__ddChannel) subscribeRealtime(); });
}
