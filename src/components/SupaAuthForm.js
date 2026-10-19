// Login/signup/re-consent submitter AND session reporter. Lives on the login/signup/gate pages
// (Custom components in the shell do NOT mount in Muten, so the session bridge
// must run from a page). On auth success it loads the profile and reports the
// full session (rol + negocio) into the auth store via on(session).
function mount(el, inputs, on) {
  el.style.display = "none";
  var supa = globalThis.__supa;
  var last = inputs.nonce;

  function mapRol(r) {
    return r === "EMPRESA" ? "empresa" : "paseador";
  }

  // Load profile + negocio, then push the full session into the store ONLY once the role is known:
  // a logged-in state with an empty rol matches no portal guard, so the guard chain in app.muten
  // (/login -> /app -> /empresa -> /cliente -> /login) cycled until the stack overflowed.
  function reportSession(user) {
    var meta = user.user_metadata || {};
    var name = meta.nombre || (user.email || "").split("@")[0] || "";
    supa.from("profiles").select("rol,negocio_id").eq("id", user.id).maybeSingle().then(function (pr) {
      if (pr && pr.error) return on.failed("No pudimos cargar tu perfil. Intenta de nuevo.");
      var rol = (pr && pr.data && pr.data.rol) || "";
      var nid = (pr && pr.data && pr.data.negocio_id) || "";
      // A session without a profile has no portal: the app stays logged out on /login with a message.
      // (No supa.auth.signOut here: its SIGNED_OUT event purges and reloads the page, which would drop the message.)
      if (!rol) return on.failed("Tu cuenta no tiene un perfil. Crea una cuenta nueva o usa tu código de invitación.");
      // A current policy version the user has not accepted closes every portal guard (the chain ends at
      // /aceptar-politica). Fail closed: without the answer no session is reported.
      supa.rpc("consentimiento_pendiente").then(function (cp) {
        if (cp.error) return on.failed("No pudimos verificar la política de datos. Intenta de nuevo.");
        var s = { loggedIn: true, userId: user.id, userName: name, rol: rol, negocioId: nid, isOwner: false, politica: cp.data || "" };
        if (!nid) return on.session(s);
        // owner_id === el usuario → es el JEFE (dueño) del negocio; si no, es empleado de gestión.
        supa.from("negocios").select("owner_id").eq("id", nid).maybeSingle().then(function (ng) {
          s.isOwner = ((ng && ng.data) || {}).owner_id === user.id;
          on.session(s);
        }).catch(function () { on.session(s); });
      }).catch(function () { on.failed("No pudimos verificar la política de datos. Intenta de nuevo."); });
    }).catch(function () { on.failed("No pudimos cargar tu perfil. Intenta de nuevo."); });
  }

  // Re-consent from /aceptar-politica: record the current version, then report the session again
  // (nothing pending now), which opens the portal of the role.
  function accept(inp) {
    supa.rpc("consentimiento_aceptar", { p_politica: inp.politica }).then(function (r) {
      if (r.error) return on.failed(failMsg(r.error.message));
      return supa.auth.getSession().then(function (g) {
        var user = g.data && g.data.session && g.data.session.user;
        user ? reportSession(user) : on.failed("Tu sesión terminó. Vuelve a iniciar sesión.");
      });
    }).catch(function () { on.failed("No pudimos registrar tu aceptación. Intenta de nuevo."); });
  }

  // The server refuses a policy version that is not the current one (politica_invalida).
  function failMsg(m) {
    return /politica_invalida/.test(m || "") ? "La política cambió. Recarga la página y vuelve a aceptarla." : m;
  }

  // Alta de negocio (empresa o paseador independiente) por RPC: el servidor crea el
  // negocio y el perfil del usuario como su dueño. Ya no hay INSERT directo en profiles
  // ni negocios, y "Dueño" entra por /unirse con invitación (nunca desde el signup).
  function provision(inp, user) {
    supa.rpc("provision_negocio", { p_rol: mapRol(inp.rol), p_nombre: inp.nombre || "", p_negocio: inp.negocioNombre || "", p_telefono: inp.telefono || "", p_politica: inp.politica })
      .then(function (r) { r.error ? on.failed(failMsg(r.error.message)) : reportSession(user); })
      .catch(function () { on.failed("No pudimos crear tu cuenta."); });
  }

  // Canje de invitación: crea la cuenta y, con el código, queda asociada al negocio
  // con el rol de la invitación (redeem_invite exige que el correo sea el invitado). Luego setea el
  // nombre en su profile y reporta la sesión (la cadena de guards la rutea a su portal).
  function join(inp, user) {
    supa.rpc("redeem_invite", { p_codigo: (inp.codigo || "").trim(), p_politica: inp.politica }).then(function (r) {
      if (r.error) return on.failed(failMsg(r.error.message) || "Invitación inválida o expirada.");
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
    // Signup and join need the accepted policy version (empty until the box is ticked): without it
    // no account is created, so no profile-less user is left behind.
    if (inp.mode !== "login" && !inp.politica) return on.failed("Acepta la Política de tratamiento de datos para continuar.");
    if (inp.mode === "aceptar") return accept(inp);
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
