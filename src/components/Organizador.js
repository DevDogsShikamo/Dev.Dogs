// Organizador de grupos — drag & drop PROPIO (pointer events → touch + mouse).
// Layout de CARRILES horarios: cada hora es una fila-zona.
//   • Arrastrar un CHIP (perro) a otro grupo  → on.mover  (menú Solo hoy / Siempre).
//   • Arrastrar un GRUPO (por su cabecera) a otro carril → on.moverGrupo (cambia la hora).
//   • "Sin grupo" lists the active dogs in no group: dragging one into a group → on.mover with desde "".
// Auto-fetch de grupos + membresías; re-lee en supa:refresh.
function mount(el, inputs, on) {
  var grupos = (inputs && inputs.grupos) || [];
  var sueltos = [];
  var supa = globalThis.__supa;
  var HORA_MIN = 6, HORA_MAX = 19;
  var lastX = 0, lastY = 0;
  var STR = {
    es: { sinPerros: "Sin perros", mover: "Mover perro a este grupo", sinGrupo: "Sin grupo" },
    en: { sinPerros: "No dogs", mover: "Move dog to this group", sinGrupo: "No group" }
  };
  function T(k) { return STR[globalThis.__lang === "en" ? "en" : "es"][k]; }

  // Fecha de hoy: single source of truth on globalThis.__ddUtils (authActions.ts).
  var today = globalThis.__ddUtils.today;
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function laneHora(h) { return String(h || "08:00").slice(0, 2) + ":00"; }
  function grupoHora(id) { for (var i = 0; i < grupos.length; i++) if (grupos[i].id === id) return grupos[i].hora; return "08:00"; }

  function load() {
    if (!supa) return;
    supa.auth.getUser().then(function (u) {
      var uid = u.data.user && u.data.user.id;
      if (!uid) return;
      supa.from("profiles").select("negocio_id").eq("id", uid).single().then(function (pr) {
        var neg = pr.data && pr.data.negocio_id;
        if (!neg) return;
        supa.from("grupos")
          .select("id,nombre,hora,color,grupo_membresias(perro_id,perros(id,nombre,foto_url))")
          .eq("negocio_id", neg).eq("activo", true).eq("grupo_membresias.activo", true).order("hora")
          .then(function (res) {
            if (res && res.error) return;
            grupos = (res.data || []).map(function (g) {
              return {
                id: g.id, nombre: g.nombre, hora: g.hora, color: g.color || "purple",
                perros: (g.grupo_membresias || []).map(function (m) {
                  var p = m.perros || {};
                  return { id: p.id, nombre: p.nombre || "Perro", foto: p.foto_url || "" };
                })
              };
            });
            var enGrupo = {};
            grupos.forEach(function (g) { g.perros.forEach(function (p) { enGrupo[p.id] = true; }); });
            supa.from("perros").select("id,nombre,foto_url").eq("negocio_id", neg).eq("activo", true).order("nombre").then(function (pr) {
              sueltos = (pr.data || []).filter(function (p) { return !enGrupo[p.id]; })
                .map(function (p) { return { id: p.id, nombre: p.nombre || "Perro", foto: p.foto_url || "" }; });
              render();
            });
          });
      });
    });
  }

  function render() {
    el.className = "dd-org";
    el.innerHTML = "";
    if (sueltos.length) el.appendChild(gcard({ id: "", nombre: T("sinGrupo"), hora: "", color: "pool", perros: sueltos }));
    var lanes = document.createElement("div");
    lanes.className = "dd-org-lanes";
    for (var H = HORA_MIN; H <= HORA_MAX; H++) {
      var hh = String(H).padStart(2, "0") + ":00";
      var lane = document.createElement("div");
      lane.className = "dd-org-lane";
      lane.dataset.hora = hh;
      var hr = document.createElement("div");
      hr.className = "dd-org-lanehr";
      hr.textContent = hh;
      var body = document.createElement("div");
      body.className = "dd-org-lanebody";
      grupos.filter(function (g) { return laneHora(g.hora) === hh; }).forEach(function (g) {
        body.appendChild(gcard(g));
      });
      lane.appendChild(hr);
      lane.appendChild(body);
      lanes.appendChild(lane);
    }
    el.appendChild(lanes);
  }

  function gcard(g) {
    var card = document.createElement("div");
    card.className = "dd-org-gcard dd-org-c-" + (g.color || "purple");
    card.dataset.grupo = g.id;
    var head = document.createElement("div");
    head.className = "dd-org-ghead";
    head.dataset.grupo = g.id;
    head.innerHTML = '<span class="grip" aria-hidden="true">⠿</span><b>' + esc(g.nombre) + '</b><span class="h">' + esc(g.hora) + '</span>';
    if (g.id) head.addEventListener("pointerdown", onGroupDown);
    var drop = document.createElement("div");
    // The pool is no drop target: taking a dog out of its group is "Quitar" in the group list.
    drop.className = g.id ? "dd-org-drop" : "dd-org-pool";
    drop.dataset.grupo = g.id;
    (g.perros || []).forEach(function (p) {
      var chip = document.createElement("button");
      chip.className = "dd-org-chip";
      chip.type = "button";
      chip.dataset.perro = p.id;
      chip.dataset.grupo = g.id;
      chip.innerHTML = (p.foto ? '<img src="' + esc(p.foto) + '" alt="">' : '<span class="e">🐕</span>') +
        '<span class="nm">' + esc(p.nombre) + '</span>';
      chip.addEventListener("pointerdown", onChipDown);
      drop.appendChild(chip);
    });
    if (!(g.perros || []).length) {
      var empty = document.createElement("div");
      empty.className = "dd-org-empty";
      empty.textContent = T("sinPerros");
      drop.appendChild(empty);
    }
    card.appendChild(head);
    card.appendChild(drop);
    return card;
  }

  function targetUnder(x, y, cls) {
    var els = document.elementsFromPoint(x, y) || [];
    for (var i = 0; i < els.length; i++) if (els[i].classList && els[i].classList.contains(cls)) return els[i];
    return null;
  }
  function makeGhost(node, isGroup) {
    var r = node.getBoundingClientRect();
    var g = node.cloneNode(true);
    g.className = isGroup ? "dd-org-gghost" : "dd-org-ghost";
    g.style.width = r.width + "px";
    g._ox = r.left; g._oy = r.top;
    document.body.appendChild(g);
    return g;
  }

  // Motor genérico de arrastre.
  function startDrag(e, handle, ghostNode, dropClass, isGroup, onDrop) {
    if (e.button && e.button !== 0) return;
    var startX = e.clientX, startY = e.clientY, moved = false, ghost = null;
    function move(ev) {
      lastX = ev.clientX; lastY = ev.clientY;
      var dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!moved && Math.sqrt(dx * dx + dy * dy) < 6) return;
      if (!moved) {
        moved = true;
        ghost = makeGhost(ghostNode, isGroup);
        handle.classList.add("dragging");
        document.body.classList.add("dd-org-grabbing");
      }
      ghost.style.transform = "translate(" + (ev.clientX - ghost._ox) + "px," + (ev.clientY - ghost._oy) + "px)";
      var t = targetUnder(ev.clientX, ev.clientY, dropClass);
      el.querySelectorAll("." + dropClass).forEach(function (d) { d.classList.toggle("over", d === t); });
    }
    function up(ev) {
      try { handle.releasePointerCapture(ev.pointerId); } catch (x) {}
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("dd-org-grabbing");
      el.querySelectorAll("." + dropClass).forEach(function (d) { d.classList.remove("over"); });
      if (ghost) ghost.remove();
      handle.classList.remove("dragging");
      if (!moved) return;
      onDrop(targetUnder(ev.clientX, ev.clientY, dropClass));
    }
    try { handle.setPointerCapture(e.pointerId); } catch (x) {}
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function onChipDown(e) {
    var chip = e.currentTarget;
    var from = chip.dataset.grupo, perroId = chip.dataset.perro;
    startDrag(e, chip, chip, "dd-org-drop", false, function (target) {
      var to = target && target.dataset.grupo;
      if (to && to !== from) {
        globalThis.__ddUtils.askMode(lastX, lastY, T("mover"), function (modo) {
          if (on && on.mover) on.mover({ perro: perroId, desde: from, hacia: to, modo: modo, fecha: today() });
        });
      }
    });
  }

  function onGroupDown(e) {
    var head = e.currentTarget;
    var card = head.parentNode;
    var gid = head.dataset.grupo;
    startDrag(e, head, card, "dd-org-lane", true, function (target) {
      var hora = target && target.dataset.hora;
      if (hora && hora !== laneHora(grupoHora(gid))) {
        if (on && on.moverGrupo) on.moverGrupo({ grupo: gid, hora: hora, fecha: today() });
      }
    });
  }

  if (inputs && inputs.grupos) { render(); }
  else { load(); window.addEventListener("supa:refresh", load); }
  window.addEventListener("lang:changed", render);
  return function (next) { if (next && next.grupos) { grupos = next.grupos; render(); } };
}
