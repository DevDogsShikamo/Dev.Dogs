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

  // Whole lists past the 1000-row cap (U.pageAll): every query below ends its order in id.
  function todas(build) { return globalThis.__ddUtils.pageAll(build); }

  function load() {
    var supa = globalThis.__supa;
    if (!supa) return;
    negocio().then(function (neg) {
      if (!neg) return;

      // Paseos de HOY del negocio → métricas + conteo por paseador (a booking the client cancelled, or the monthly
      // charge of a plan, does not count).
      todas(function () { return supa.from("prestaciones").select("cuidador_id,estado").eq("negocio_id", neg).eq("fecha", globalThis.__ddUtils.today()).neq("estado", "cancelado").is("detalle->>mensualidad", null).order("id"); }).then(function (res) {
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
          todas(function () { return supa.from("profiles").select("id,nombre,verificado,contactos(telefono),nomina(salario_fijo)").eq("negocio_id", neg).eq("rol", "paseador").order("nombre").order("id"); }).then(function (pr) {
            if (pr && pr.error) return;
            var ps = (pr.data || []).map(function (p) {
              return {
                id: p.id, nombre: p.nombre || "", telefono: (p.contactos && p.contactos.telefono) || "",
                salario: (p.nomina && p.nomina.salario_fijo) || 0, verificado: !!p.verificado, paseosHoy: porCuidador[p.id] || 0
              };
            });
            on.paseadores(ps);
          });
        }
      });

      // Clientes del negocio. El teléfono llega por `contactos` (RLS: solo el dueño); para los demás vuelve null.
      if (on.clientes) {
        todas(function () { return supa.from("profiles").select("id,nombre,contactos(telefono)").eq("negocio_id", neg).eq("rol", "cliente").order("nombre").order("id"); }).then(function (cr) {
          if (cr && cr.error) return;
          var cs = (cr.data || []).map(function (c) { return { id: c.id, nombre: c.nombre || "", telefono: (c.contactos && c.contactos.telefono) || "" }; });
          on.clientes(cs);
        });
      }

      // Perros del negocio: lista (para el ABM del jefe) + total (KPI).
      if (on.perros || on.perrosTot) {
        todas(function () { return supa.from("perros").select("id,nombre,raza,tamano,conducta,tips,foto_at,sociabilidad,en_celo,enfermedad_contagiosa,certificado_salud").eq("negocio_id", neg).eq("activo", true).order("nombre").order("id"); }).then(function (dr) {
          if (dr && dr.error) return;
          var raw = dr.data || [];
          if (on.perrosTot) on.perrosTot(raw.length);
          if (on.perros) {
            var emit = function () {
              on.perros(raw.map(function (r) {
                return { id: r.id, nombre: r.nombre || "", raza: r.raza || "", tamano: r.tamano || "", conducta: r.conducta || "", tips: r.tips || "", foto: globalThis.__ddUtils.perroFoto(r.id, r.foto_at), sociabilidad: r.sociabilidad || "", celo: !!r.en_celo, contagio: !!r.enfermedad_contagiosa, certificado: r.certificado_salud || "", relN: 0, relWorst: "" };
              }));
            };
            emit();
            // Profile photos come from the photo Worker after the list: shown again once they are cached.
            globalThis.__ddUtils.perroFotos(raw).then(function (n) { if (n) emit(); });
          }
        });
      }

      // Legal identity of the business (Ley 1480 art. 50 and 53): 0 or 1 row; only the owner edits it.
      if (on.identidad) {
        supa.from("negocio_identidad").select("razon_social,doc_tipo,doc_numero,direccion,telefono,correo").eq("negocio_id", neg).maybeSingle().then(function (ir) {
          if (ir && ir.error) return;
          on.identidad(ir.data ? [ir.data] : []);
        });
      }

      // Empleados de gestión (rol empresa) del negocio — la "oficina". Excluye al
      // propio jefe. Solo el jefe puede leer estos profiles (RLS is_owner). `permisos` solo lo lee el jefe.
      if (on.gestion) {
        globalThis.__ddSesion().then(function (s) {
          todas(function () { return supa.from("profiles").select("id,nombre,contactos(telefono),permisos!user_id(finanzas)").eq("negocio_id", neg).eq("rol", "empresa").order("nombre").order("id"); }).then(function (gr) {
            if (gr && gr.error) return;
            var gs = (gr.data || []).filter(function (g) { return g.id !== s.uid; })
              .map(function (g) { return { id: g.id, nombre: g.nombre || "", telefono: (g.contactos && g.contactos.telefono) || "", finanzas: !!(g.permisos && g.permisos.finanzas) }; });
            on.gestion(gs);
          });
        });
      }

      // Dueños de cada perro (principal y co-dueños) para el control de co-dueños del jefe.
      // RLS: solo el jefe lee perro_duenos del negocio; para los demás vuelve vacío.
      if (on.duenos) {
        todas(function () { return supa.from("perro_duenos").select("perro_id,dueno_id,rol,profiles!dueno_id(nombre)").eq("estado", "activo").order("id"); }).then(function (dr) {
          if (dr && dr.error) return;
          on.duenos((dr.data || []).map(function (d) {
            return { id: d.dueno_id, perroId: d.perro_id, nombre: (d.profiles && d.profiles.nombre) || "", rol: d.rol || "" };
          }));
        });
      }

      // Reseñas del negocio, pendientes primero. RLS: solo el jefe las lee; para la oficina vuelve vacío.
      if (on.resenas) {
        todas(function () { return supa.from("resenas").select("id,rating,texto,publicar_nombre,estado,created_at,profiles!autor_id(nombre)").eq("negocio_id", neg).order("created_at", { ascending: false }).order("id"); }).then(function (rr) {
          if (rr && rr.error) return;
          var rs = (rr.data || []).map(function (r) {
            return { id: r.id, autor: (r.profiles && r.profiles.nombre) || "", rating: r.rating, texto: r.texto || "", publicar: !!r.publicar_nombre, estado: r.estado || "", fecha: (r.created_at || "").slice(0, 10) };
          });
          rs.sort(function (a, b) { return (a.estado === "pendiente" ? 0 : 1) - (b.estado === "pendiente" ? 0 : 1); });
          on.resenas(rs);
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
        todas(function () { return supa.from("servicios").select("id,nombre,tipo,duracion_min,modelo_cobro,tarifas(precio,precio_mensual)").eq("negocio_id", neg).eq("activo", true).order("tipo").order("id"); }).then(function (sr) {
          if (sr && sr.error) return;
          var svs = (sr.data || []).map(function (r) {
            var mensual = r.modelo_cobro === "mensual", t = r.tarifas || {};
            return { id: r.id, nombre: r.nombre || "", tipo: r.tipo || "paseo", duracion: r.duracion_min || 0, precio: mensual ? (t.precio_mensual || 0) : (t.precio || 0), modelo: mensual ? "mensual" : "por_uso" };
          });
          on.servicios(svs);
        });
      }

      // Invitaciones pendientes y vigentes: correo y vencimiento, nunca el código (solo existe su hash).
      if (on.invitaciones) {
        todas(function () { return supa.from("invitaciones").select("id,rol,email,estado,expires_at").eq("negocio_id", neg).eq("estado", "pendiente").gt("expires_at", new Date().toISOString()).order("created_at").order("id"); }).then(function (ir) {
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
