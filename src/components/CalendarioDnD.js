// Drag & drop SOBRE el calendario (grilla de horas). Arrastra los bloques .dd-cal-ev.
//   • vertical  → cambia la hora (mismo día) → menú Solo hoy / Siempre.
//   • a otra columna → mueve la ocurrencia a otro día (puntual).
// Usa DELEGACIÓN en document (sobrevive los re-render de Muten) + geometría de la grilla.
// Cada bloque lleva un span oculto ".dd-ev-meta" = "gid~diaISO"; cada columna ".dd-col-meta" = diaISO.
// El tap corto sigue abriendo la ficha (solo se suprime el click si hubo arrastre).
function mount(el, inputs, on) {
  el.style.display = "none";
  globalThis.__calDnDon = on;                 // el on más reciente (por si re-monta)
  if (globalThis.__calDnDinit) return;        // listeners de document: una sola vez
  globalThis.__calDnDinit = true;

  var HB = 8, HMAX = 17;                       // rango horario de la grilla
  var lastDrag = 0;
  var STR = {
    es: { cambiar: "Cambiar a", hoy: "Solo hoy", siempre: "Siempre (recurrente)", cancelar: "Cancelar" },
    en: { cambiar: "Change to", hoy: "Only today", siempre: "Always (recurring)", cancelar: "Cancel" }
  };
  function T(k) { return STR[globalThis.__lang === "en" ? "en" : "es"][k]; }

  function rhPx() { return (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) * 3.5; }
  function pad(n) { return String(n).padStart(2, "0"); }
  function elemUnder(x, y, cls) {
    var els = document.elementsFromPoint(x, y) || [];
    for (var i = 0; i < els.length; i++) if (els[i].classList && els[i].classList.contains(cls)) return els[i];
    return null;
  }
  function colDia(col) { var m = col && col.querySelector(".dd-col-meta"); return m ? m.textContent.trim() : ""; }
  function horaAt(col, y) {
    var top = col.getBoundingClientRect().top;
    var h = HB + (y - top) / rhPx();
    h = Math.max(HB, Math.min(HMAX, h));
    var half = Math.round(h * 2) / 2;         // redondeo a 30 min
    var hh = Math.floor(half), mm = Math.round((half - hh) * 60);
    return pad(hh) + ":" + pad(mm);
  }

  function onDown(e) {
    if (e.button && e.button !== 0) return;
    var block = e.target.closest ? e.target.closest(".dd-cal-ev") : null;
    if (!block) return;
    var meta = block.querySelector(".dd-ev-meta");
    if (!meta) return;
    var parts = meta.textContent.split("~");
    var gid = parts[0], diaOld = parts[1];
    var startX = e.clientX, startY = e.clientY, moved = false, ghost = null;

    function move(ev) {
      var dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!moved && Math.sqrt(dx * dx + dy * dy) < 7) return;
      if (!moved) {
        moved = true;
        var r = block.getBoundingClientRect();
        ghost = block.cloneNode(true);
        ghost.classList.add("dd-cal-ghost");
        ghost.style.cssText = "position:fixed;left:0;top:0;margin:0;width:" + r.width + "px;height:" + r.height +
          "px;pointer-events:none;z-index:9999;opacity:.92;box-shadow:0 0.6rem 1.4rem -0.3rem rgba(30,20,60,.5)";
        ghost._ox = r.left; ghost._oy = r.top;
        document.body.appendChild(ghost);
        block.style.opacity = "0.3";
        document.body.classList.add("dd-org-grabbing");
      }
      ghost.style.transform = "translate(" + (ev.clientX - ghost._ox) + "px," + (ev.clientY - ghost._oy) + "px)";
      var col = elemUnder(ev.clientX, ev.clientY, "dd-cal-col");
      document.querySelectorAll(".dd-cal-col").forEach(function (c) { c.classList.toggle("dd-col-over", c === col); });
    }
    function up(ev) {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("dd-org-grabbing");
      document.querySelectorAll(".dd-cal-col").forEach(function (c) { c.classList.remove("dd-col-over"); });
      if (ghost) ghost.remove();
      block.style.opacity = "";
      if (!moved) return;
      lastDrag = Date.now();
      var col = elemUnder(ev.clientX, ev.clientY, "dd-cal-col");
      if (!col) return;
      var diaNew = colDia(col), hora = horaAt(col, ev.clientY);
      if (!diaNew) return;
      var fn = globalThis.__calDnDon && globalThis.__calDnDon.reprogramar;
      if (diaNew === diaOld) askMode(ev.clientX, ev.clientY, gid, diaOld, hora, fn);
      else if (fn) fn({ grupo: gid, fechaOld: diaOld, fechaNew: diaNew, hora: hora, modo: "hoy" });
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function askMode(x, y, gid, dia, hora, fn) {
    var pop = document.createElement("div");
    pop.className = "dd-org-pop";
    pop.innerHTML = '<div class="t">' + T("cambiar") + ' ' + hora + '</div>' +
      '<button type="button" data-m="hoy">' + T("hoy") + '</button>' +
      '<button type="button" data-m="siempre">' + T("siempre") + '</button>' +
      '<button type="button" data-m="cancel" class="c">' + T("cancelar") + '</button>';
    pop.style.left = Math.max(8, Math.min(x - 90, window.innerWidth - 210)) + "px";
    pop.style.top = Math.min(y + 8, window.innerHeight - 170) + "px";
    document.body.appendChild(pop);
    function close() { pop.remove(); document.removeEventListener("pointerdown", outside, true); }
    function outside(ev) { if (!pop.contains(ev.target)) close(); }
    setTimeout(function () { document.addEventListener("pointerdown", outside, true); }, 0);
    pop.querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () {
        var m = b.dataset.m; close();
        if (m === "cancel" || !fn) return;
        fn({ grupo: gid, fechaOld: dia, fechaNew: dia, hora: hora, modo: m });
      });
    });
  }

  function onClickCapture(e) {
    // Suprimir SOLO el click sobre un bloque (para no abrir la ficha tras arrastrar).
    // No tocar otros clicks (p.ej. los botones del menú Solo hoy / Siempre).
    if (Date.now() - lastDrag < 350 && e.target.closest && e.target.closest(".dd-cal-ev")) {
      e.stopPropagation();
      e.preventDefault();
    }
  }

  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("click", onClickCapture, true);
}
