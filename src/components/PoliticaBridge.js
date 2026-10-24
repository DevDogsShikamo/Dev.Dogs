// Current policy of the caller's own business (negocio_politicas; RLS: only members of that business read
// it): on(secciones) gets its sections [{clave,titulo,texto}] and on(meta) [{version,fecha}], both [] when the
// business has not published one. Reloads on supa:refresh but reports only a new version, so a refresh
// caused by another write does not wipe what the owner is typing in the editor.
function mount(el, inputs, on) {
  el.style.display = "none";
  var last = null;
  function load() {
    var supa = globalThis.__supa;
    if (!supa) return;
    supa.from("negocio_politicas").select("version,secciones,publicada_at").eq("vigente", true).maybeSingle().then(function (r) {
      if (!r || r.error) return;   // SWR: keep what is shown if the network failed
      var p = r.data;
      var key = p ? String(p.version) : "";
      if (key === last) return;
      last = key;
      if (on.meta) on.meta(p ? [{ version: key, fecha: new Date(p.publicada_at).toLocaleDateString("es-CO") }] : []);
      if (on.secciones) on.secciones(p ? (p.secciones || []).map(function (s) { return { clave: s.clave || "", titulo: s.titulo || "", texto: s.texto || "" }; }) : []);
    });
  }
  load();
  window.addEventListener("supa:refresh", load);
}
