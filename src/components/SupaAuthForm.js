// Headless login/signup submitter. Reads the supabase-js client from globalThis
// (Custom files are inlined and cannot import). Fires when its `nonce` input bumps;
// reports errors via on(failed). Success flows back through SupaSession's listener.
function mount(el, inputs, on) {
  el.style.display = "none";
  var supa = globalThis.__supa;
  var last = inputs.nonce;

  function submit(inp) {
    if (!supa) return on.failed("Cliente no disponible.");
    if (inp.mode === "signup") {
      supa.auth
        .signUp({
          email: inp.email,
          password: inp.pw,
          options: { data: { nombre: inp.nombre || "" } },
        })
        .then(function (res) {
          if (res.error) return on.failed(res.error.message);
          if (!res.data.session) on.failed("Revisa tu correo para confirmar la cuenta.");
        });
    } else {
      supa.auth
        .signInWithPassword({ email: inp.email, password: inp.pw })
        .then(function (res) {
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
