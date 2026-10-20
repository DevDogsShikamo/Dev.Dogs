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
    var name = meta.nombre || meta.full_name || meta.name || (user.email || "").split("@")[0] || "";
    supa.from("profiles").select("rol,negocio_id").eq("id", user.id).maybeSingle().then(function (pr) {
      if (pr && pr.error) return on.failed("No pudimos cargar tu perfil. Intenta de nuevo.");
      var rol = (pr && pr.data && pr.data.rol) || "";
      var nid = (pr && pr.data && pr.data.negocio_id) || "";
      // A session without a profile (first Google login, failed provisioning) opens only /completar-registro:
      // sinPerfil closes every portal guard and the chain ends there, so no empty-rol state can cycle.
      if (!rol) return on.session({ loggedIn: true, userId: user.id, userName: name, rol: "", negocioId: "", isOwner: false, politica: "", sinPerfil: true });
      // A current policy version the user has not accepted closes every portal guard (the chain ends at
      // /aceptar-politica). Fail closed: without the answer no session is reported.
      supa.rpc("consentimiento_pendiente").then(function (cp) {
        if (cp.error) return on.failed("No pudimos verificar la política de datos. Intenta de nuevo.");
        var s = { loggedIn: true, userId: user.id, userName: name, rol: rol, negocioId: nid, isOwner: false, politica: cp.data || "", sinPerfil: false };
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
  // Profile RPCs raise perfil_existente / datos_invalidos too (provision_negocio).
  function failMsg(m) {
    if (/politica_invalida/.test(m || "")) return "La política cambió. Recarga la página y vuelve a aceptarla.";
    if (/perfil_existente/.test(m || "")) return "Esta cuenta ya tiene un perfil.";
    if (/datos_invalidos/.test(m || "")) return "Revisa tus datos: el nombre es obligatorio y admite hasta 100 caracteres.";
    return m;
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
        return on.failed(e === "demasiados_intentos" ? "Demasiados intentos. Intenta de nuevo en 15 minutos."
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
    // Signup and join need the accepted policy version (empty until the policy is accepted in the modal): without it
    // no account is created, so no profile-less user is left behind.
    if (inp.mode !== "login" && !inp.politica) return on.failed("Acepta la Política de tratamiento de datos para continuar.");
    if (inp.mode === "aceptar") return accept(inp);
    // /completar-registro: the user is already signed in (e.g. with Google) and only lacks the profile,
    // which the same RPCs as signup and /unirse create.
    if (inp.mode === "completar") {
      supa.auth.getSession().then(function (g) {
        var user = g.data && g.data.session && g.data.session.user;
        if (!user) return on.failed("Tu sesión terminó. Vuelve a iniciar sesión.");
        inp.rol === "CODIGO" ? join(inp, user) : provision(inp, user);
      });
      return;
    }
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

  // Guest pages report a session that already exists: the return from Google lands on /login with the
  // session in the URL (supabase-js stores it before getSession resolves), or an earlier signup left a
  // session without a profile.
  if (supa && (inputs.mode === "login" || inputs.mode === "signup" || inputs.mode === "join")) {
    supa.auth.getSession().then(function (g) {
      var user = g.data && g.data.session && g.data.session.user;
      if (user) reportSession(user);
    });
  }

  return function (next) {
    if (next.nonce !== last && next.nonce > 0) { last = next.nonce; submit(next); }
  };
}
