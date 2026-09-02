// Headless auth-session listener. Reads the supabase-js client from globalThis
// (Custom files are inlined and cannot import). On load and on every auth change
// it mirrors the session — plus the user's profile (rol + negocio) — into the
// auth store, so app.muten can route each rol to its portal. No UI.
function mount(el, inputs, on) {
  el.style.display = "none";
  var supa = globalThis.__supa;
  if (!supa) return;

  function report(session) {
    if (!session || !session.user) {
      on.session({ loggedIn: false, userId: "", userName: "", rol: "", negocioId: "", slug: "" });
      return;
    }
    var user = session.user;
    var meta = user.user_metadata || {};
    var name = meta.nombre || (user.email || "").split("@")[0] || "";

    // Load the profile (rol + negocio) then the negocio slug.
    supa.from("profiles").select("rol,negocio_id").eq("id", user.id).maybeSingle().then(function (pr) {
      var rol = (pr.data && pr.data.rol) || "";
      var negocioId = (pr.data && pr.data.negocio_id) || "";
      if (!negocioId) {
        on.session({ loggedIn: true, userId: user.id, userName: name, rol: rol, negocioId: "", slug: "" });
        return;
      }
      supa.from("negocios").select("slug").eq("id", negocioId).maybeSingle().then(function (ng) {
        on.session({
          loggedIn: true, userId: user.id, userName: name,
          rol: rol, negocioId: negocioId, slug: (ng.data && ng.data.slug) || ""
        });
      });
    });
  }

  function recheck() { supa.auth.getSession().then(function (res) { report(res.data.session); }); }

  supa.auth.getSession().then(function (res) { report(res.data.session); });
  supa.auth.onAuthStateChange(function (_event, session) { report(session); });
  // Re-read after signup provisioning creates the profile/negocio.
  if (typeof window !== "undefined") window.addEventListener("supa:recheck", recheck);
}
