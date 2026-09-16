// Bridge de SALIDAS del portal EMPRESA: las salidas (grupos activos) del negocio
// con su paseador asignado, para reasignar. Monta 1 vez en el root; recarga en
// "supa:refresh". Lee __supa en cada llamada.
function mount(el, inputs, on) {
  el.style.display = "none";
  // negocioId desde el resolver central (authActions.ts). Ver globalThis.__ddSesion.
  function negocio() {
    return (globalThis.__ddSesion || function () { return Promise.resolve({ negocioId: null }); })()
      .then(function (s) { return s.negocioId; });
  }

  function load() {
    var supa = globalThis.__supa;
    if (!supa || !on.salidas) return;
    negocio().then(function (neg) {
      if (!neg) return;
      var nombres = {};
      supa.from("profiles").select("id,nombre").eq("negocio_id", neg).eq("rol", "paseador").then(function (pr) {
        if (!(pr && pr.error)) (pr.data || []).forEach(function (r) { nombres[r.id] = r.nombre || "Paseador"; });
        supa.from("grupos")
          .select("id,nombre,zona,hora,cuidador_id,servicios(nombre)")
          .eq("negocio_id", neg).eq("activo", true).order("hora")
          .then(function (res) {
            if (res && res.error) return;
            var rows = (res.data || []).map(function (g) {
              return {
                id: g.id, nombre: g.nombre || "", zona: g.zona || "", hora: g.hora || "08:00",
                servicio: (g.servicios && g.servicios.nombre) || "",
                cuidadorId: g.cuidador_id || "", cuidadorNombre: (g.cuidador_id && nombres[g.cuidador_id]) || ""
              };
            });
            on.salidas(rows);
          });
      });
    });
  }

  load();
  window.addEventListener("supa:refresh", load);
}
