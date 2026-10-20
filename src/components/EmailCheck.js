var mxCache = {};

function mount(el, inputs, on) {
  el.style.display = "none";
  var last = inputs.nonce;

  function checkMx(email) {
    var domain = (email.split("@")[1] || "").toLowerCase();
    if (!domain) { on.good(true); return; }
    if (domain in mxCache) {
      if (mxCache[domain]) on.good(true);
      else on.bad(true);
      return;
    }

    var cfg = globalThis.__ddCfg; // effective url/key, set by authActions.ts
    fetch(cfg.url + "/functions/v1/check-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": cfg.key,
        "Authorization": "Bearer " + cfg.key
      },
      body: JSON.stringify({ email: email }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        mxCache[domain] = d.valid;
        if (d.valid) on.good(true);
        else on.bad(true);
      })
      .catch(function () { on.good(true); });
  }

  return function (next) {
    if (next.nonce !== last) {
      last = next.nonce;
      checkMx(next.email);
    }
  };
}
