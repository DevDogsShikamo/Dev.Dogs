// Reads the incidents the RLS lets me see (business owner/office, dog owners, reporter) into incidentes.store.
// Mounted once in the root of the cliente, empresa and dashboard pages; reloads on "supa:refresh".
// Newest first, 50 at a time: "Ver más" (data.ts incidentesVerMas → "incidentes:mas") appends the next page with
// .range(); on.mas tells the page whether older ones exist (one extra row is asked to know it).
function mount(el, inputs, on) {
  el.style.display = "none";
  var TIPOS = { perdida: "Pérdida", lesion: "Lesión", salud: "Problema de salud", pelea: "Pelea", fallecimiento: "Fallecimiento", otro: "Otro" };
  var PAGE = 50;
  var items = [];
  function fila(r) {
    var semana = Date.now() - 7 * 864e5;
    return {
      id: r.id, fecha: new Date(r.created_at).toLocaleDateString("es-CO"), perro: (r.perros && r.perros.nombre) || "Perro",
      tipo: TIPOS[r.tipo] || r.tipo, descripcion: r.descripcion || "",
      grave: r.tipo === "perdida" || r.tipo === "fallecimiento", reciente: Date.parse(r.created_at) >= semana
    };
  }
  // n rows from `desde` plus one, to know whether there are older ones.
  function pedir(desde, n) {
    return globalThis.__supa.from("incidentes").select("id,tipo,descripcion,created_at,perros(nombre)")
      .order("created_at", { ascending: false }).order("id", { ascending: false }).range(desde, desde + n);
  }
  function emit(rows, n) {
    on.items(items);
    if (on.mas) on.mas(rows.length > n);
  }
  // The first page, or as many as are shown, so a refresh keeps what "Ver más" opened.
  function load() {
    if (!globalThis.__supa) return;
    var n = Math.max(PAGE, items.length);
    pedir(0, n).then(function (res) {
      if (!res || res.error) return; // no pisar con vacío si la red falló
      var rows = res.data || [];
      items = rows.slice(0, n).map(fila);
      emit(rows, n);
    });
  }
  function verMas() {
    if (!globalThis.__supa) return;
    pedir(items.length, PAGE).then(function (res) {
      if (!res || res.error) return;
      var rows = res.data || [], vistos = {};
      items.forEach(function (i) { vistos[i.id] = true; });
      // A report that arrived meanwhile shifts the offset: skip what is already listed.
      items = items.concat(rows.slice(0, PAGE).filter(function (r) { return !vistos[r.id]; }).map(fila));
      emit(rows, PAGE);
    });
  }
  load();
  window.addEventListener("supa:refresh", load);
  window.addEventListener("incidentes:mas", verMas);
}
