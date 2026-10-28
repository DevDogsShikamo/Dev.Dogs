// Read + layout bridge for the Agenda weekly scheduler.
// Nav (anchor / view / sel) arrives via the "cal:nav" window event that the calendario
// store re-emits on every change (and is cached on globalThis.__calNav for late mounts).
// It computes the calendar structure (mini-month, day columns, month grid, header labels)
// and queries public.prestaciones for the visible date range (RLS also scopes to cuidador),
// grouping per-dog rows into time-window blocks positioned on the hour grid.
// Re-reads on every "cal:nav" and on "supa:refresh".
function mount(el, inputs, on) {
  el.style.display = "none";

  var L10N = {
    es: {
      MES: ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"],
      MESC: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
      DIAS: ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"],
      DIASC: ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]
    },
    en: {
      MES: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
      MESC: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
      DIAS: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
      DIASC: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    }
  };
  function LX() { return L10N[globalThis.__lang === "en" ? "en" : "es"]; }
  var MES, MESC, DIAS, DIASC;
  function setL() { var x = LX(); MES = x.MES; MESC = x.MESC; DIAS = x.DIAS; DIASC = x.DIASC; }
  setL();
  var EMO = ["🐕", "🐩", "🦮", "🐺", "🐶", "🐕‍🦺"];
  var HBASE = 8;   // grid starts at 08:00
  var RH = 3.5;    // rem per hour row

  // Date/color helpers: single source of truth on globalThis.__ddUtils (authActions.ts).
  var U = globalThis.__ddUtils;
  var pad = U.pad, iso = U.iso, today = U.today, addDays = U.addDays, colorFor = U.colorFor;
  function parse(s) { if (!s) return new Date(); var a = s.split("-"); return new Date(+a[0], +a[1] - 1, +a[2], 12, 0, 0); }
  function wdIdx(d) { return (d.getDay() + 6) % 7; }            // Monday-first 0..6
  function mondayOf(d) { return addDays(d, -wdIdx(d)); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function timeNum(t) { if (!t) return HBASE; var a = String(t).split(":"); return (+a[0]) + (+a[1] || 0) / 60; }

  function dayCol(d, sel) {
    var di = iso(d);
    return { dia: di, n: String(d.getDate()), wd: DIAS[wdIdx(d)], hoy: di === today(), sel: di === sel };
  }

  function diaLabel(fecha) { var d = parse(fecha); return DIASC[wdIdx(d)] + " " + d.getDate() + " " + MESC[d.getMonth()]; }

  function buildMini(A, sel, view) {
    var first = new Date(A.getFullYear(), A.getMonth(), 1, 12);
    var gridStart = mondayOf(first);
    var offset = wdIdx(first);
    var dim = new Date(A.getFullYear(), A.getMonth() + 1, 0).getDate();
    var total = Math.ceil((offset + dim) / 7) * 7;
    var t = today(), wkS = null, wkE = null;
    if (view === "semana") { var m = mondayOf(A); wkS = iso(m); wkE = iso(addDays(m, 6)); }
    var cells = [];
    for (var i = 0; i < total; i++) {
      var d = addDays(gridStart, i), di = iso(d);
      var inWk = wkS && di >= wkS && di <= wkE;
      cells.push({
        n: String(d.getDate()), dia: di,
        mut: d.getMonth() !== A.getMonth(),
        hoy: di === t, sel: di === sel,
        wk: !!inWk, first: !!inWk && di === wkS, last: !!inWk && di === wkE
      });
    }
    return cells;
  }

  function buildMonth(A, sel, counts) {
    var first = new Date(A.getFullYear(), A.getMonth(), 1, 12);
    var gridStart = mondayOf(first);
    var offset = wdIdx(first);
    var dim = new Date(A.getFullYear(), A.getMonth() + 1, 0).getDate();
    var total = Math.ceil((offset + dim) / 7) * 7;
    var t = today(), cells = [];
    for (var i = 0; i < total; i++) {
      var d = addDays(gridStart, i), di = iso(d);
      cells.push({
        n: String(d.getDate()), dia: di,
        mut: d.getMonth() !== A.getMonth(),
        hoy: di === t, sel: di === sel,
        count: (counts && counts[di]) || 0
      });
    }
    return cells;
  }

  // Group per-dog prestaciones sharing (day, time, service) into one block (grupo).
  function buildGroups(rows) {
    var groups = {}, order = [];
    (rows || []).forEach(function (r) {
      var d = r.detalle || {}, svc = r.servicios || {}, p = r.perros || {};
      var hora = d.hora || "08:00", tipo = r.tipo || "paseo";
      var key = r.fecha + "|" + hora + "|" + tipo + "|" + (svc.nombre || "");
      if (!groups[key]) { groups[key] = { gid: r.id, grupoId: r.grupo_id || "", fecha: r.fecha, hora: hora, tipo: tipo, svc: svc.nombre || "", dur: 0, dogs: [] }; order.push(key); }
      var g = groups[key];
      var dur = d.duracion || svc.duracion_min || 60;
      if (dur > g.dur) g.dur = dur;
      g.dogs.push({
        id: r.id, nombre: p.nombre || "Perro", conducta: p.conducta || "", obs: p.tips || "",
        raza: p.raza || "", tamano: p.tamano || "", foto: p.foto_url || "",
        estado: r.estado || "programado"
      });
    });
    return order.map(function (k) { return groups[k]; });
  }

  // One positioned block per grupo.
  function eventoOf(g) {
    var t = today();
    var start = timeNum(g.hora), durH = Math.max(1, (g.dur || 60) / 60);
    var endN = start + durH, hh = Math.floor(endN), mm = Math.round((endN - hh) * 60);
    var count = g.dogs.length;
    return {
      id: g.gid,
      grupoId: g.grupoId,
      titulo: g.svc || cap(g.tipo),
      dia: g.fecha,
      diaLabel: diaLabel(g.fecha),
      desde: g.hora,
      hasta: pad(hh) + ":" + pad(mm),
      top: Math.round(Math.max(0, start - HBASE) * RH * 100) / 100,
      alto: Math.round(durH * RH * 100) / 100,
      color: colorFor(g.tipo),
      svcKey: g.tipo,
      c1: count > 0 ? EMO[0] : "",
      c2: count > 1 ? EMO[1] : "",
      c3: count > 2 ? EMO[2] : "",
      extra: count > 3 ? count - 3 : 0,
      count: count,
      estado: g.dogs[0] ? g.dogs[0].estado : "programado",
      past: g.fecha < t
    };
  }

  // Flat per-dog rows for the ficha, keyed by the group's id (gid).
  function detalleOf(groups) {
    var out = [];
    groups.forEach(function (g) {
      g.dogs.forEach(function (dog) {
        out.push({
          id: dog.id, gid: g.gid, perro: dog.nombre, conducta: dog.conducta, obs: dog.obs,
          raza: dog.raza, tamano: dog.tamano, foto: dog.foto, estado: dog.estado
        });
      });
    });
    return out;
  }

  var nav = globalThis.__calNav || { anchor: today(), view: "semana", sel: today() };

  // Franjas NO disponibles (horario laboral) por columna, posicionadas en la grilla [08:00,18:00].
  var DKEY = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
  function buildNoDisp(cols, horario) {
    var GS = 8, GE = 18, RH = 3.5, out = [];
    if (!horario || !Array.isArray(horario.dias)) return out;   // sin horario configurado → no sombrear
    (cols || []).forEach(function (c) {
      var dk = DKEY[wdIdx(parse(c.dia))];
      var ranges;
      if (!horario || !horario.dias || horario.dias.indexOf(dk) < 0) {
        ranges = [[GS, GE]];                      // día no laboral → todo gris
      } else {
        var fr = (horario.franjas || []).map(function (f) {
          return [Math.max(GS, parseInt(f[0], 10) || GS), Math.min(GE, parseInt(f[1], 10) || GE)];
        }).filter(function (f) { return f[1] > f[0]; }).sort(function (a, b) { return a[0] - b[0]; });
        ranges = []; var cur = GS;
        fr.forEach(function (f) { if (f[0] > cur) ranges.push([cur, f[0]]); cur = Math.max(cur, f[1]); });
        if (cur < GE) ranges.push([cur, GE]);      // complemento de las franjas
      }
      ranges.forEach(function (r) {
        out.push({ dia: c.dia, top: Math.round((r[0] - GS) * RH * 100) / 100, alto: Math.round((r[1] - r[0]) * RH * 100) / 100 });
      });
    });
    return out;
  }

  // Vacaciones / descansos: día dentro de algún rango → bloque de día completo.
  function inVaca(dia, vacas) {
    for (var i = 0; i < (vacas || []).length; i++) { var v = vacas[i]; if (dia >= v.desde && dia <= v.hasta) return v.nota || ""; }
    return null;
  }
  function buildDescansos(cols, vacas) {
    var out = [];
    (cols || []).forEach(function (c) { var n = inVaca(c.dia, vacas); if (n !== null) out.push({ dia: c.dia, nota: n }); });
    return out;
  }
  function buildVacaOff(cols, vacas) {
    var out = [], GS = 8, GE = 18, RH = 3.5;
    (cols || []).forEach(function (c) { if (inVaca(c.dia, vacas) !== null) out.push({ dia: c.dia, top: 0, alto: Math.round((GE - GS) * RH * 100) / 100 }); });
    return out;
  }

  function load() {
    setL();                                   // idioma actual para nombres de mes/día
    var anchor = nav.anchor || today();
    var view = nav.view || "semana";
    var sel = nav.sel || anchor;
    var A = parse(anchor);

    // Structure (no I/O) — push immediately so the grid is responsive to nav.
    var start, end, cols = [];
    if (view === "dia") { start = A; end = A; cols = [dayCol(A, sel)]; }
    else if (view === "mes") {
      var f = new Date(A.getFullYear(), A.getMonth(), 1, 12);
      start = mondayOf(f); end = addDays(start, 41);
    } else {
      var m = mondayOf(A); start = m; end = addDays(m, 6);
      for (var i = 0; i < 7; i++) cols.push(dayCol(addDays(m, i), sel));
    }

    var label;
    if (view === "dia") label = DIAS[wdIdx(A)] + " " + A.getDate() + " " + MESC[A.getMonth()] + " " + A.getFullYear();
    else if (view === "mes") label = MES[A.getMonth()] + " " + A.getFullYear();
    else { var mm2 = mondayOf(A), ee2 = addDays(mm2, 6); label = mm2.getDate() + "–" + ee2.getDate() + " " + MESC[mm2.getMonth()] + " " + A.getFullYear(); }

    on.label(label);
    on.mesLabel(MES[A.getMonth()] + " " + A.getFullYear());
    on.cols(cols);
    on.mini(buildMini(A, sel, view));
    on.month(buildMonth(A, sel, null));
    if (view !== "mes") { on.eventos([]); on.detalle([]); }   // clear stale blocks until query resolves

    // Data — query the visible range (history included: any past/future date).
    // supa se lee en cada llamada (no se captura en mount): robusto y testeable.
    var supa = globalThis.__supa;
    if (!supa) return;
    globalThis.__ddSesion().then(function (s) {
      var uid = s.uid;
      if (!uid) return;
      // Horario laboral + vacaciones → disponibilidad y bloques de descanso.
      supa.from("profiles").select("horario,vacaciones").eq("id", uid).single().then(function (pr) {
        var horario = (pr.data && pr.data.horario) || {};
        var vacas = (pr.data && pr.data.vacaciones) || [];
        if (on.vacas) on.vacas(vacas);
        if (view !== "mes") {
          if (on.descansos) on.descansos(buildDescansos(cols, vacas));
          on.noDisp(buildNoDisp(cols, horario).concat(buildVacaOff(cols, vacas)));
        } else { if (on.descansos) on.descansos([]); on.noDisp([]); }
      });
      supa.from("prestaciones")
        .select("id,estado,tipo,fecha,grupo_id,detalle,perros(nombre,conducta,tips,raza,tamano,foto_url),servicios(nombre,duracion_min)")
        .eq("cuidador_id", uid)
        .neq("estado", "cancelado")   // a booking the client cancelled is not on the walker's calendar
        .gte("fecha", iso(start))
        .lte("fecha", iso(end))
        .then(function (res) {
          var data = res.data || [];
          if (view === "mes") {
            var counts = {};
            data.forEach(function (r) { counts[r.fecha] = (counts[r.fecha] || 0) + 1; });
            on.month(buildMonth(A, sel, counts));
          } else {
            var groups = buildGroups(data);
            on.eventos(groups.map(eventoOf));
            on.detalle(detalleOf(groups));
          }
        });
    });
  }

  function onNav(e) { if (e && e.detail) nav = e.detail; load(); }

  load();
  window.addEventListener("cal:nav", onNav);
  window.addEventListener("supa:refresh", load);
  window.addEventListener("lang:changed", load);
}
