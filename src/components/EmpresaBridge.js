// Bridge de datos del portal EMPRESA — agrega sobre TODO el negocio (muchos
// paseadores y clientes). Monta una vez en el root del panel empresa; recarga en
// "supa:refresh". Lee globalThis.__supa en cada llamada (convención) y resuelve el
// negocio del auth store persistido (0 red), con fallback a getUser→profiles.
function mount(el, inputs, on) {
  el.style.display = "none";

  // Sesión {uid, negocioId} desde el resolver central (authActions.ts). Ver globalThis.__ddSesion.
  function sesion() {
    return (globalThis.__ddSesion || function () { return Promise.resolve({ uid: null, negocioId: null }); })();
  }
  function negocio() {
    return sesion().then(function (s) { return s.negocioId; });
  }

  function iso(d) { function p(n) { return String(n).padStart(2, "0"); } return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); }
  function today() { return iso(new Date()); }

  function load() {
    var supa = globalThis.__supa;
    if (!supa) return;
    negocio().then(function (neg) {
      if (!neg) return;

      // Paseos de HOY del negocio → métricas + conteo por paseador.
      supa.from("prestaciones").select("cuidador_id,estado").eq("negocio_id", neg).eq("fecha", today()).then(function (res) {
        if (res && res.error) return;
        var rows = res.data || [];
        var prog = 0, curso = 0, fin = 0, porCuidador = {};
        rows.forEach(function (r) {
          var e = r.estado;
          if (e === "programado") prog += 1;
          else if (e === "recibido" || e === "en_curso") curso += 1;
          else if (e === "finalizado") fin += 1;
          if (r.cuidador_id) porCuidador[r.cuidador_id] = (porCuidador[r.cuidador_id] || 0) + 1;
        });
        if (on.stats) on.stats(rows.length, prog, curso, fin);

        // Paseadores del negocio + su carga de hoy.
        if (on.paseadores) {
          supa.from("profiles").select("id,nombre,telefono,zona,salario_fijo,verificado").eq("negocio_id", neg).eq("rol", "paseador").order("nombre").then(function (pr) {
            if (pr && pr.error) return;
            var ps = (pr.data || []).map(function (p) {
              return {
                id: p.id, nombre: p.nombre || "", telefono: p.telefono || "", zona: p.zona || "",
                salario: p.salario_fijo || 0, verificado: !!p.verificado, paseosHoy: porCuidador[p.id] || 0
              };
            });
            on.paseadores(ps);
          });
        }
      });

      // Clientes del negocio.
      if (on.clientes) {
        supa.from("profiles").select("id,nombre,telefono").eq("negocio_id", neg).eq("rol", "cliente").order("nombre").then(function (cr) {
          if (cr && cr.error) return;
          var cs = (cr.data || []).map(function (c) { return { id: c.id, nombre: c.nombre || "", telefono: c.telefono || "" }; });
          on.clientes(cs);
        });
      }

      // Total de perros activos del negocio (KPI).
      if (on.perrosTot) {
        supa.from("perros").select("id").eq("negocio_id", neg).eq("activo", true).then(function (dr) {
          if (dr && dr.error) return;
          on.perrosTot((dr.data || []).length);
        });
      }

      // Empleados de gestión (rol empresa) del negocio — la "oficina". Excluye al
      // propio jefe. Solo el jefe puede leer estos profiles (RLS is_owner).
      if (on.gestion) {
        sesion().then(function (s) {
          supa.from("profiles").select("id,nombre,telefono").eq("negocio_id", neg).eq("rol", "empresa").order("nombre").then(function (gr) {
            if (gr && gr.error) return;
            var gs = (gr.data || []).filter(function (g) { return g.id !== s.uid; })
              .map(function (g) { return { id: g.id, nombre: g.nombre || "", telefono: g.telefono || "" }; });
            on.gestion(gs);
          });
        });
      }

      // Invitaciones pendientes (paseador/cliente) para compartir el código.
      if (on.invitaciones) {
        supa.from("invitaciones").select("id,rol,email,codigo,estado").eq("negocio_id", neg).eq("estado", "pendiente").order("created_at").then(function (ir) {
          if (ir && ir.error) return;
          var inv = (ir.data || []).map(function (i) {
            return { id: i.id, rol: i.rol || "", email: i.email || "", codigo: i.codigo || "", estado: i.estado || "" };
          });
          on.invitaciones(inv);
        });
      }
    });
  }

  load();
  window.addEventListener("supa:refresh", load);
}
