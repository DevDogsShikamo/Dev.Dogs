// Headless login/signup submitter. Reads the supabase-js client from globalThis
// (Custom files are inlined and cannot import). Fires when its `nonce` input bumps.
// On signup it also PROVISIONS the tenant: creates the negocio (paseador/empresa)
// or joins one by slug (cliente), then the profile with the chosen rol.
// Success/rol flows back through SupaSession (we dispatch supa:recheck after provisioning).
function mount(el, inputs, on) {
  el.style.display = "none";
  var supa = globalThis.__supa;
  var last = inputs.nonce;

  function slugify(s) {
    return (s || "negocio").toString().toLowerCase().normalize("NFD")
      .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "").slice(0, 40) || "negocio";
  }

  // rol from the wizard: PASEADOR | EMPRESA | DUENO  →  profile rol
  function mapRol(r) {
    if (r === "EMPRESA") return "empresa";
    if (r === "DUENO") return "cliente";
    return "paseador";
  }

  function done() {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("supa:recheck"));
  }

  function provision(inp, user) {
    var rol = mapRol(inp.rol);
    if (rol === "cliente") {
      // Join an existing negocio via its slug (from the business link).
      var slug = (inp.slug || "").trim();
      if (!slug) { on.failed("Falta el link del negocio para registrarte como cliente."); return; }
      supa.from("negocios").select("id").eq("slug", slug).maybeSingle().then(function (ng) {
        if (!ng.data) { on.failed("No encontramos ese negocio."); return; }
        supa.from("profiles").insert({
          id: user.id, rol: "cliente", negocio_id: ng.data.id, nombre: inp.nombre || ""
        }).then(function (r) { r.error ? on.failed(r.error.message) : done(); });
      });
      return;
    }
    // paseador / empresa → create their negocio, then their profile.
    var base = slugify(inp.negocioNombre || inp.nombre);
    var slug = base + "-" + Math.random().toString(36).slice(2, 6);
    var tipo = rol === "empresa" ? "empresa" : "independiente";
    supa.from("negocios").insert({
      slug: slug, tipo: tipo, nombre: inp.negocioNombre || inp.nombre || "Mi negocio"
    }).select("id").maybeSingle().then(function (ng) {
      if (ng.error || !ng.data) { on.failed(ng.error ? ng.error.message : "No se pudo crear el negocio."); return; }
      supa.from("profiles").insert({
        id: user.id, rol: rol, negocio_id: ng.data.id, nombre: inp.nombre || "", telefono: inp.telefono || ""
      }).then(function (r) { r.error ? on.failed(r.error.message) : done(); });
    });
  }

  function submit(inp) {
    if (!supa) return on.failed("Cliente no disponible.");
    if (inp.mode === "signup") {
      supa.auth.signUp({
        email: inp.email, password: inp.pw, options: { data: { nombre: inp.nombre || "" } }
      }).then(function (res) {
        if (res.error) return on.failed(res.error.message);
        if (!res.data.session) return on.failed("Revisa tu correo para confirmar la cuenta.");
        provision(inp, res.data.user);
      });
    } else {
      supa.auth.signInWithPassword({ email: inp.email, password: inp.pw }).then(function (res) {
        if (res.error) on.failed(res.error.message);
      });
    }
  }

  return function (next) {
    if (next.nonce !== last && next.nonce > 0) {
      last = next.nonce;
      submit(next);
    }
  };
}
