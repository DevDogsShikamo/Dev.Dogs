// Login/signup submitter AND session reporter. Lives on the login/signup pages
// (Custom components in the shell do NOT mount in Muten, so the session bridge
// must run from a page). On auth success it loads the profile and reports the
// full session (rol + negocio + slug) into the auth store via on(session).
function mount(el, inputs, on) {
  el.style.display = "none";
  var supa = globalThis.__supa;
  var last = inputs.nonce;

  function mapRol(r) {
    return r === "EMPRESA" ? "empresa" : "paseador";
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

  // Alta de negocio (empresa o paseador independiente) por RPC: el servidor crea el
  // negocio y el perfil del usuario como su dueño. Ya no hay INSERT directo en profiles
  // ni negocios, y "Dueño" entra por /unirse con invitación (nunca desde el signup).
  function provision(inp, user) {
    supa.rpc("provision_negocio", { p_rol: mapRol(inp.rol), p_nombre: inp.nombre || "", p_negocio: inp.negocioNombre || "", p_telefono: inp.telefono || "" })
      .then(function (r) { r.error ? on.failed(r.error.message) : reportSession(user); })
      .catch(function () { on.failed("No pudimos crear tu cuenta."); });
  }

  // Canje de invitación: crea la cuenta y, con el código, queda asociada al negocio
  // con el rol de la invitación (redeem_invite exige que el correo sea el invitado). Luego setea el
  // nombre en su profile y reporta la sesión (la cadena de guards la rutea a su portal).
  function join(inp, user) {
    supa.rpc("redeem_invite", { p_codigo: (inp.codigo || "").trim() }).then(function (r) {
      if (r.error) return on.failed(r.error.message || "Invitación inválida o expirada.");
      if (!r.data || !r.data.ok) {
        var e = r.data && r.data.error;
        return on.failed(e === "demasiados_intentos" ? "Demasiados intentos. Probá de nuevo en 15 minutos."
          : e === "perfil_existente" ? "Esta cuenta ya tiene un perfil." : "Invitación inválida, vencida o para otro correo.");
      }
      var nombre = (inp.nombre || "").trim();
      if (nombre) {
        supa.from("profiles").update({ nombre: nombre }).eq("id", user.id)
          .then(function () { reportSession(user); }).catch(function () { reportSession(user); });
      } else {
        reportSession(user);
      }
    }).catch(function () { on.failed("No pudimos validar la invitación."); });
  }

  function submit(inp) {
    if (!supa) return on.failed("Cliente no disponible.");
    if (inp.mode === "login") {
      supa.auth.signInWithPassword({ email: inp.email, password: inp.pw })
        .then(function (res) {
          if (res.error) return on.failed(res.error.message);
          reportSession(res.data.user);
        });
      return;
    }
    // signup y join crean la cuenta primero; difieren en qué hacen después.
    supa.auth.signUp({ email: inp.email, password: inp.pw, options: { data: { nombre: inp.nombre || "" } } })
      .then(function (res) {
        if (res.error) return on.failed(res.error.message);
        if (!res.data.session) return on.failed("Revisa tu correo para confirmar la cuenta.");
        if (inp.mode === "join") { join(inp, res.data.user); }
        else { provision(inp, res.data.user); }
      });
  }

  return function (next) {
    if (next.nonce !== last && next.nonce > 0) { last = next.nonce; submit(next); }
  };
}
