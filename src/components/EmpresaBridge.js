// Bridge de datos del portal EMPRESA — agrega sobre TODO el negocio (muchos
// paseadores y clientes). Monta una vez en el root del panel empresa; recarga en
// "supa:refresh". Lee globalThis.__supa en cada llamada (convención) y resuelve el
// negocio del auth store persistido (0 red), con fallback a getUser→profiles.
function mount(el, inputs, on) {
  el.style.display = "none";

  // Sesión {uid, negocioId} desde el resolver central (authActions.ts). Ver globalThis.__ddSesion.
  function negocio() {
    return globalThis.__ddSesion().then(function (s) { return s.negocioId; });
  }

  function load() {
    var supa = globalThis.__supa;
    if (!supa) return;
    negocio().then(function (neg) {
      if (!neg) return;

      // Paseos de HOY del negocio → métricas + conteo por paseador.
      supa.from("prestaciones").select("cuidador_id,estado").eq("negocio_id", neg).eq("fecha", globalThis.__ddUtils.today()).then(function (res) {
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
        if (on.loaded) on.loaded(true);

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

      // Perros del negocio: lista (para el ABM del jefe) + total (KPI).
      if (on.perros || on.perrosTot) {
        supa.from("perros").select("id,nombre,raza,tamano,conducta,tips,foto_url,sociabilidad").eq("negocio_id", neg).eq("activo", true).order("nombre").then(function (dr) {
          if (dr && dr.error) return;
          var raw = dr.data || [];
          if (on.perrosTot) on.perrosTot(raw.length);
          if (on.perros) {
            on.perros(raw.map(function (r) {
              return { id: r.id, nombre: r.nombre || "", raza: r.raza || "", tamano: r.tamano || "", conducta: r.conducta || "", tips: r.tips || "", foto: r.foto_url || "", sociabilidad: r.sociabilidad || "", relN: 0, relWorst: "" };
            }));
          }
        });
      }

      // Empleados de gestión (rol empresa) del negocio — la "oficina". Excluye al
      // propio jefe. Solo el jefe puede leer estos profiles (RLS is_owner).
      if (on.gestion) {
        globalThis.__ddSesion().then(function (s) {
          supa.from("profiles").select("id,nombre,telefono").eq("negocio_id", neg).eq("rol", "empresa").order("nombre").then(function (gr) {
            if (gr && gr.error) return;
            var gs = (gr.data || []).filter(function (g) { return g.id !== s.uid; })
              .map(function (g) { return { id: g.id, nombre: g.nombre || "", telefono: g.telefono || "" }; });
            on.gestion(gs);
          });
        });
      }

      // Dueños de cada perro (principal y co-dueños) para el control de co-dueños del jefe.
      // RLS: solo el jefe lee perro_duenos del negocio; para los demás vuelve vacío.
      if (on.duenos) {
        supa.from("perro_duenos").select("perro_id,dueno_id,rol,profiles!dueno_id(nombre)").eq("estado", "activo").then(function (dr) {
          if (dr && dr.error) return;
          on.duenos((dr.data || []).map(function (d) {
            return { id: d.dueno_id, perroId: d.perro_id, nombre: (d.profiles && d.profiles.nombre) || "", rol: d.rol || "" };
          }));
        });
      }

      // Zonas del negocio (para el picker de zona al crear/editar una salida/grupo).
      if (on.zonas) {
        supa.from("negocios").select("zonas").eq("id", neg).single().then(function (nr) {
          if (nr && nr.error) return;
          on.zonas((nr.data && nr.data.zonas) || []);
        });
      }

      // Catálogo de servicios del negocio (ABM del jefe: crear/editar/borrar).
      if (on.servicios) {
        supa.from("servicios").select("id,nombre,tipo,duracion_min,precio,precio_mensual,modelo_cobro").eq("negocio_id", neg).eq("activo", true).order("tipo").then(function (sr) {
          if (sr && sr.error) return;
          var svs = (sr.data || []).map(function (r) {
            var mensual = r.modelo_cobro === "mensual";
            return { id: r.id, nombre: r.nombre || "", tipo: r.tipo || "paseo", duracion: r.duracion_min || 0, precio: mensual ? (r.precio_mensual || 0) : (r.precio || 0), modelo: mensual ? "mensual" : "por_uso" };
          });
          on.servicios(svs);
        });
      }

      // Invitaciones pendientes y vigentes: correo y vencimiento, nunca el código (solo existe su hash).
      if (on.invitaciones) {
        supa.from("invitaciones").select("id,rol,email,estado,expires_at").eq("negocio_id", neg).eq("estado", "pendiente").gt("expires_at", new Date().toISOString()).order("created_at").then(function (ir) {
          if (ir && ir.error) return;
          on.invitaciones((ir.data || []).map(function (i) {
            return { id: i.id, rol: i.rol || "", email: i.email || "", estado: i.estado || "", vence: new Date(i.expires_at).toLocaleDateString("es") };
          }));
        });
      }
    });
  }

  load();
  window.addEventListener("supa:refresh", load);
  // Código recién creado (data.ts invitarCrear): llega una vez y se entrega a la página para mostrarlo.
  window.addEventListener("invite:code", function (e) { if (on.codigoNuevo) on.codigoNuevo(e.detail); });
}
