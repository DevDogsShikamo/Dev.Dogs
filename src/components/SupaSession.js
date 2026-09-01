// Headless auth-session listener. Reads the supabase-js client from globalThis
// (Custom files are inlined and cannot import) and mirrors the current session
// into the auth store on load and on every auth change. No UI, no data.
function mount(el, inputs, on) {
  el.style.display = "none";
  var supa = globalThis.__supa;
  if (!supa) return;

  function report(session) {
    if (session && session.user) {
      var meta = session.user.user_metadata || {};
      var name = meta.nombre || (session.user.email || "").split("@")[0] || "";
      on.session({ loggedIn: true, userId: session.user.id, userName: name });
    } else {
      on.session({ loggedIn: false, userId: "", userName: "" });
    }
  }

  supa.auth.getSession().then(function (res) { report(res.data.session); });
  supa.auth.onAuthStateChange(function (_event, session) { report(session); });
}
