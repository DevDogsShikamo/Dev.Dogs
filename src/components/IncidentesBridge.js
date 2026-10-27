// Reads the incidents the RLS lets me see (business owner/office, dog owners, reporter) into incidentes.store.
// Mounted once in the root of the cliente, empresa and dashboard pages; reloads on "supa:refresh".
function mount(el, inputs, on) {
  el.style.display = "none";
  var TIPOS = { perdida: "Pérdida", lesion: "Lesión", salud: "Problema de salud", pelea: "Pelea", fallecimiento: "Fallecimiento", otro: "Otro" };
  function load() {
    var supa = globalThis.__supa;
    if (!supa) return;
    var semana = Date.now() - 7 * 864e5;
    supa.from("incidentes").select("id,tipo,descripcion,created_at,perros(nombre)").order("created_at", { ascending: false }).limit(100)
      .then(function (res) {
        if (!res || res.error) return; // no pisar con vacío si la red falló
        on.items((res.data || []).map(function (r) {
          return {
            id: r.id, fecha: new Date(r.created_at).toLocaleDateString("es-CO"), perro: (r.perros && r.perros.nombre) || "Perro",
            tipo: TIPOS[r.tipo] || r.tipo, descripcion: r.descripcion || "",
            grave: r.tipo === "perdida" || r.tipo === "fallecimiento", reciente: Date.parse(r.created_at) >= semana
          };
        }));
      });
  }
  load();
  window.addEventListener("supa:refresh", load);
}
