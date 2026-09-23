// Lee el horario laboral del paseador (profiles.horario) y lo empuja al editor.
// horario = { dias:["lun",...], franjas:[["07:00","12:00"], ...] }
// Re-lee en "supa:refresh" (tras guardar).
function mount(el, inputs, on) {
  el.style.display = "none";

  function load() {
    var supa = globalThis.__supa;
    if (!supa) return;
    // uid desde el resolver central (authActions.ts).
    globalThis.__ddSesion().then(function (s) {
      if (!s.uid) return;
      supa.from("profiles").select("horario").eq("id", s.uid).single().then(function (res) {
        var h = (res.data && res.data.horario) || {};
        var dias = h.dias || [];
        var franjas = (h.franjas || []).map(function (f) { return { desde: parseInt(f[0], 10) || 0, hasta: parseInt(f[1], 10) || 0 }; });
        on.dias(dias);
        on.franjas(franjas);
      });
    });
  }

  load();
  window.addEventListener("supa:refresh", load);
}
