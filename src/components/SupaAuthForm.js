// Login/signup submitter AND session reporter. Lives on the login/signup pages
// (Custom components in the shell do NOT mount in Muten, so the session bridge
// must run from a page). On auth success it loads the profile and reports the
// full session (rol + negocio + slug) into the auth store via on(session).
function mount(el, inputs, on) {
  el.style.display = "none";
  var supa = globalThis.__supa;
  var last = inputs.nonce;

  function slugify(s) {
    return (s || "negocio").toString().toLowerCase().normalize("NFD")
      .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "").slice(0, 40) || "negocio";
  }
  function mapRol(r) {
    if (r === "EMPRESA") return "empresa";
    if (r === "DUENO") return "cliente";
    return "paseador";
  }

  // Load profile + negocio, then push the full session into the store.
  function reportSession(user) {
    var meta = user.user_metadata || {};
    var name = meta.nombre || (user.email || "").split("@")[0] || "";
    on.session({ loggedIn: true, userId: user.id, userName: name, rol: "", negocioId: "", slug: "", isOwner: false });
    supa.from("profiles").select("rol,negocio_id").eq("id", user.id).maybeSingle().then(function (pr) {
      var rol = (pr && pr.data && pr.data.rol) || "";
      var nid = (pr && pr.data && pr.data.negocio_id) || "";
      if (!nid) { on.session({ loggedIn: true, userId: user.id, userName: name, rol: rol, negocioId: "", slug: "", isOwner: false }); return; }
      // owner_id === el usuario → es el JEFE (dueño) del negocio; si no, es empleado de gestión.
      supa.from("negocios").select("slug,owner_id").eq("id", nid).maybeSingle().then(function (ng) {
        var d = (ng && ng.data) || {};
        on.session({ loggedIn: true, userId: user.id, userName: name, rol: rol, negocioId: nid, slug: d.slug || "", isOwner: d.owner_id === user.id });
      }).catch(function () { on.session({ loggedIn: true, userId: user.id, userName: name, rol: rol, negocioId: nid, slug: "", isOwner: false }); });
    }).catch(function () { /* keep logged-in with empty rol */ });
  }

  function provision(inp, user) {
    var rol = mapRol(inp.rol);
    if (rol === "cliente") {
      var slug = (inp.slug || "").trim();
      if (!slug) { on.failed("Falta el link del negocio para registrarte como cliente."); return; }
      supa.from("negocios").select("id").eq("slug", slug).maybeSingle().then(function (ng) {
        if (!ng.data) { on.failed("No encontramos ese negocio."); return; }
        supa.from("profiles").insert({ id: user.id, rol: "cliente", negocio_id: ng.data.id, nombre: inp.nombre || "" })
          .then(function (r) { r.error ? on.failed(r.error.message) : reportSession(user); });
      });
      return;
    }
    var base = slugify(inp.negocioNombre || inp.nombre);
    var slug = base + "-" + Math.random().toString(36).slice(2, 6);
    var tipo = rol === "empresa" ? "empresa" : "independiente";
    supa.from("negocios").insert({ slug: slug, tipo: tipo, nombre: inp.negocioNombre || inp.nombre || "Mi negocio" })
      .select("id").maybeSingle().then(function (ng) {
        if (ng.error || !ng.data) { on.failed(ng.error ? ng.error.message : "No se pudo crear el negocio."); return; }
        supa.from("profiles").insert({ id: user.id, rol: rol, negocio_id: ng.data.id, nombre: inp.nombre || "", telefono: inp.telefono || "" })
          .then(function (r) { r.error ? on.failed(r.error.message) : reportSession(user); });
      });
  }

  function submit(inp) {
    if (!supa) return on.failed("Cliente no disponible.");
    if (inp.mode === "signup") {
      supa.auth.signUp({ email: inp.email, password: inp.pw, options: { data: { nombre: inp.nombre || "" } } })
        .then(function (res) {
          if (res.error) return on.failed(res.error.message);
          if (!res.data.session) return on.failed("Revisa tu correo para confirmar la cuenta.");
          provision(inp, res.data.user);
        });
    } else {
      supa.auth.signInWithPassword({ email: inp.email, password: inp.pw })
        .then(function (res) {
          if (res.error) return on.failed(res.error.message);
          reportSession(res.data.user);
        });
    }
  }

  return function (next) {
    if (next.nonce !== last && next.nonce > 0) { last = next.nonce; submit(next); }
  };
}
