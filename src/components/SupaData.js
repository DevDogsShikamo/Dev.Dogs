// Headless data reader. Reads the supabase-js client from globalThis (Custom files
// are inlined and cannot import). Loads the user's rows on login and whenever a
// "supa:refresh" event fires (dispatched by data.ts after a write), pushing them
// into the stores via on(). No UI — reads only; writes live in data.ts use-fns.
function mount(el, inputs, on) {
  el.style.display = "none";
  var supa = globalThis.__supa;
  if (!supa) return;

  function loadAll() {
    supa.auth.getSession().then(function (res) {
      if (!res.data.session) return;

      supa.from("servicios").select("*").order("created_at").then(function (r) {
        if (!r.error) on.servicios(r.data || []);
      });
      supa.from("citas").select("*").order("hora").then(function (r) {
        if (!r.error) on.citas(r.data || []);
      });
      supa.from("empresa").select("*").limit(1).then(function (r) {
        if (!r.error && r.data && r.data[0]) on.empresa(r.data[0]);
      });
    });
  }

  loadAll();
  supa.auth.onAuthStateChange(function () { loadAll(); });
  if (typeof window !== "undefined") window.addEventListener("supa:refresh", loadAll);
}
