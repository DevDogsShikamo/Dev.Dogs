// Bridge de datos del portal CLIENTE (dueño del perro). Monta 1 vez en el root del
// panel cliente; recarga en "supa:refresh". Lee __supa en cada llamada. Sesión (uid +
// negocioId) del auth store persistido.
function mount(el, inputs, on) {
  el.style.display = "none";
  // Sesión {uid, negocioId} desde el resolver central (authActions.ts). Ver globalThis.__ddSesion.
  function sesion() {
    return (globalThis.__ddSesion || function () { return Promise.resolve({ uid: null, negocioId: null }); })();
  }
  function p(n) { return String(n).padStart(2, "0"); }
  function iso(d) { return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); }
  function today() { return iso(new Date()); }

  function load() {
    var supa = globalThis.__supa;
    if (!supa) return;
    sesion().then(function (s) {
      if (!s.uid) return;

      // Mis perros (perro_duenos activos → perros).
      supa.from("perro_duenos").select("perro_id,perros(id,nombre,raza,tamano,foto_url)").eq("dueno_id", s.uid).eq("estado", "activo").then(function (res) {
        if (res && res.error) return;
        var rows = res.data || [];
        var perros = [], ids = [];
        rows.forEach(function (r) {
          var d = r.perros || {};
          if (!d.id) return;
          ids.push(d.id);
          perros.push({ id: d.id, nombre: d.nombre || "", raza: d.raza || "", tamano: d.tamano || "", foto: d.foto_url || "" });
        });
        if (on.misPerros) on.misPerros(perros);

        // Mis paseos (prestaciones de esos perros).
        if (on.misPaseos && ids.length) {
          supa.from("prestaciones").select("id,fecha,estado,tipo,detalle,perro_id,precio_aplicado,cobrable,cobrado,perros(nombre),servicios(nombre)").in("perro_id", ids).order("fecha").then(function (pr) {
            if (pr && pr.error) return;
            var t = today();
            var paseos = (pr.data || []).map(function (r) {
              var det = r.detalle || {}, svc = r.servicios || {};
              var cobrable = r.cobrable !== false;
              var estado = r.estado || "programado";
              var precio = cobrable ? (r.precio_aplicado || 0) : 0;
              return {
                id: r.id, fecha: r.fecha || "", hora: det.hora || "", servicio: svc.nombre || r.tipo || "",
                estado: estado, perro: (r.perros && r.perros.nombre) || "", perroId: r.perro_id || "",
                precio: precio, facturable: (estado === "finalizado") ? precio : 0,
                cobrable: cobrable, cobrado: !!r.cobrado, cuidador: "", futuro: (r.fecha || "") >= t
              };
            });
            on.misPaseos(paseos);
          });
        } else if (on.misPaseos) { on.misPaseos([]); }
      });

      // Salidas disponibles del negocio (para reservar).
      if (on.salidas && s.negocioId) {
        supa.from("grupos").select("id,zona,hora,servicio_id,cuidador_id,servicios(nombre,tipo)").eq("negocio_id", s.negocioId).eq("activo", true).order("hora").then(function (gr) {
          if (gr && gr.error) return;
          var sal = (gr.data || []).map(function (g) {
            var svc = g.servicios || {};
            return { id: g.id, zona: g.zona || "", hora: g.hora || "08:00", servicio: svc.nombre || "", servicioId: g.servicio_id || "", cuidadorId: g.cuidador_id || "", tipo: svc.tipo || "paseo" };
          });
          on.salidas(sal);
        });
      }
    });
  }

  load();
  window.addEventListener("supa:refresh", load);
}
