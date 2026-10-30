// Login/signup/re-consent/acceptance submitter AND session reporter; also the account flows (forgot/new/change
// password, change email) and the live policy re-check ("watch"). Lives on the login/signup/gate pages
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

  // The current policy version this user has not accepted ("" / null = up to date): the login check and the
  // live re-check of an open session ("watch") ask the same RPC.
  function pendingPolicy() {
    return supa.rpc("consentimiento_pendiente");
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
      // A profile without a business (removed from it, or it left: miembro_dar_de_baja / miembro_salir) lands there
      // too, with baja set: it can join a business again with a new invitation or open its own.
      if (!rol || !nid) return on.session({ loggedIn: true, userId: user.id, userName: name, rol: "", negocioId: "", isOwner: false, politica: "", sinPerfil: true, aceptacion: "", negocioNombre: "", baja: !!rol });
      // A current policy version the user has not accepted closes every portal guard (the chain ends at
      // /aceptar-politica); so does a pending role notice or business terms (aceptacion_pendiente, the chain
      // ends at /aceptar-condiciones). Fail closed: without both answers no session is reported.
      Promise.all([pendingPolicy(), supa.rpc("aceptacion_pendiente")]).then(function (r) {
        var cp = r[0], ap = r[1];
        if (cp.error) return on.failed("No pudimos verificar la política de datos. Intenta de nuevo.");
        if (ap.error) return on.failed("No pudimos verificar las condiciones del servicio. Intenta de nuevo.");
        var pend = ap.data || {};
        var s = { loggedIn: true, userId: user.id, userName: name, rol: rol, negocioId: nid, isOwner: false, politica: cp.data || "", sinPerfil: false, aceptacion: pend.tipo || "", negocioNombre: pend.negocio_nombre || "", baja: false };
        // owner_id === el usuario → es el JEFE (dueño) del negocio; si no, es empleado de gestión.
        supa.from("negocios").select("owner_id,nombre").eq("id", nid).maybeSingle().then(function (ng) {
          var n = (ng && ng.data) || {};
          s.isOwner = n.owner_id === user.id;
          s.negocioNombre = n.nombre || s.negocioNombre;
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

  // /aceptar-condiciones: record the pending role notice or business terms, then report the session again
  // (the next pending item, or none: the portal of the role).
  function acceptCondiciones(inp) {
    supa.rpc("aceptacion_registrar", { p_tipo: inp.tipo, p_version: inp.version }).then(function (r) {
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
    if (/version_invalida/.test(m || "")) return "El documento cambió. Recarga la página y vuelve a leerlo.";
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

  // Supabase Auth errors of the account flows, in Spanish; anything else gets the fallback of the flow.
  function authMsg(e, fallback) {
    var c = (e && e.code) || "", m = (e && e.message) || "";
    if ((e && e.status === 429) || /rate.?limit/i.test(c + " " + m)) return "Hiciste demasiadas solicitudes. Espera unos minutos e intenta de nuevo.";
    if (c === "same_password") return "La nueva contraseña debe ser distinta de la actual.";
    if (c === "weak_password") return "La contraseña es muy débil: usa al menos 6 caracteres, una mayúscula y un número.";
    if (c === "email_exists" || /already been registered/i.test(m)) return "Ese correo ya está en uso por otra cuenta.";
    if (c === "email_address_invalid" || /invalid format/i.test(m)) return "Escribe un correo válido.";
    if (c === "session_not_found" || c === "session_expired" || /session missing/i.test(m)) return "Tu sesión terminó. Vuelve a iniciar sesión.";
    return fallback;
  }

  // "¿Olvidaste tu contraseña?" (/login) and an expired link (/nueva-clave): Supabase answers the same whether
  // or not the account exists, and so does the page (no account enumeration). The link opens /nueva-clave.
  function recover(inp) {
    var fail = "No pudimos enviar el enlace. Intenta de nuevo.";
    supa.auth.resetPasswordForEmail((inp.email || "").trim(), { redirectTo: location.origin + "/nueva-clave" }).then(function (r) {
      if (r.error) return on.failed(authMsg(r.error, fail));
      on.aviso("Si existe una cuenta con ese correo, te enviamos un enlace para crear una nueva contraseña. Revisa también la carpeta de spam.");
    }).catch(function () { on.failed(fail); });
  }

  // /nueva-clave: sets the password on the recovery session, then reports the session like a login, so the
  // guard chain (policy, registration, removed from the business) applies as after any login.
  function nuevaClave(inp) {
    supa.auth.updateUser({ password: inp.pw }).then(function (r) {
      if (r.error) return on.failed(authMsg(r.error, "No pudimos guardar la contraseña. Pide un nuevo enlace."));
      reportSession(r.data.user);
    }).catch(function () { on.failed("No pudimos guardar la contraseña. Intenta de nuevo."); });
  }

  // /mis-datos: the current password is checked by signing in with it again (a wrong one changes nothing),
  // then the new one is set.
  function cambiarClave(inp) {
    var fail = "No pudimos cambiar la contraseña. Intenta de nuevo.";
    supa.auth.getUser().then(function (g) {
      var email = g.data && g.data.user && g.data.user.email;
      if (!email) return on.failed("Tu sesión terminó. Vuelve a iniciar sesión.");
      return supa.auth.signInWithPassword({ email: email, password: inp.actual || "" }).then(function (s) {
        if (s.error) return on.failed(s.error.code === "invalid_credentials" || /invalid login credentials/i.test(s.error.message) ? "La contraseña actual no es correcta." : authMsg(s.error, fail));
        return supa.auth.updateUser({ password: inp.pw }).then(function (u) {
          if (u.error) return on.failed(authMsg(u.error, fail));
          on.aviso("Tu contraseña cambió. Úsala la próxima vez que inicies sesión.");
        });
      });
    }).catch(function () { on.failed(fail); });
  }

  // /mis-datos: Supabase mails a confirmation link (back to /login) and, with "secure email change", one to the
  // current address too; the address changes only once confirmed. It lives only in auth.users (mis_datos_exportar
  // reads it from there), so nothing else is updated here.
  function cambiarCorreo(inp) {
    var email = (inp.email || "").trim().toLowerCase(), fail = "No pudimos cambiar el correo. Intenta de nuevo.";
    supa.auth.updateUser({ email: email }, { emailRedirectTo: location.origin + "/login" }).then(function (r) {
      if (r.error) return on.failed(authMsg(r.error, fail));
      on.aviso("Te enviamos un enlace de confirmación a " + email + ". Si también te llega un correo a tu dirección actual, confírmalo: el cambio se aplica cuando confirmes en ambas. Hasta entonces sigues entrando con tu correo actual.");
    }).catch(function () { on.failed(fail); });
  }

  function submit(inp) {
    if (!supa) return on.failed("Cliente no disponible.");
    if (inp.olvido) return recover(inp);
    if (inp.mode === "nueva") return nuevaClave(inp);
    if (inp.mode === "cuenta") return inp.accion === "correo" ? cambiarCorreo(inp) : cambiarClave(inp);
    if (inp.mode === "condiciones") return acceptCondiciones(inp);
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

  // /nueva-clave opens its form only for a session that came from the recovery link in the URL (kept by
  // authActions.ts as __ddAuthHash); a used or expired link (#error_code=otp_expired) or no link at all is refused.
  if (supa && inputs.mode === "nueva") {
    var h = new URLSearchParams(String(globalThis.__ddAuthHash || "").replace(/^#/, ""));
    supa.auth.getSession().then(function (g) {
      var s = g.data && g.data.session;
      on.estado(h.get("type") === "recovery" && s && s.access_token === h.get("access_token") ? "listo" : "invalido");
    });
  }

  // Live policy re-check (portals and /mis-datos): an open session whose accepted policy is no longer the current
  // one (a deploy published a new version) reports it, which closes the portal guards and the chain lands on
  // /aceptar-politica without logging out. One small RPC on focus, on visibility and every 5 minutes, only with a
  // stored session; installed once per page load (a later mount only refreshes the callback).
  if (supa && inputs.mode === "watch") {
    var w = globalThis.__ddPoliticaWatch;
    if (w) w.on = on;
    else {
      w = globalThis.__ddPoliticaWatch = { on: on, busy: false };
      var check = function () {
        if (w.busy || document.visibilityState === "hidden" || !(globalThis.__ddUid && globalThis.__ddUid())) return;
        w.busy = true;
        pendingPolicy().then(function (r) { w.busy = false; if (!r.error && r.data) w.on.politica(r.data); }, function () { w.busy = false; });
      };
      window.addEventListener("focus", check);
      document.addEventListener("visibilitychange", check);
      setInterval(check, 5 * 60 * 1000);
    }
  }

  return function (next) {
    if (next.nonce !== last && next.nonce > 0) { last = next.nonce; submit(next); }
  };
}
