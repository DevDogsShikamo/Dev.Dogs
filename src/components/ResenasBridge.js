// Reseñas públicas de la landing: resenas_publicas() (la única función que puede llamar un visitante sin
// sesión). El servidor ya devuelve total 0 y ninguna reseña por debajo de 3, así que no hay nada que filtrar.
function mount(el, inputs, on) {
  el.style.display = "none";
  var supa = globalThis.__supa;
  if (!supa) return;
  supa.rpc("resenas_publicas").then(function (r) {
    var d = (r && !r.error && r.data) || {};
    on.items((d.items || []).map(function (x) {
      return { autor: x.autor || "", rating: x.rating || 0, texto: x.texto || "", negocio: x.negocio || "", fecha: x.fecha || "" };
    }));
    on.promedio(Number(d.promedio || 0).toFixed(1).replace(".", ","));
    on.total(d.total || 0);
  });
}
