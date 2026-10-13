var SUPABASE_URL = "https://agutaluxzruuthbbagkh.supabase.co";
var ANON_KEY = "sb_publishable_2OTPocZUTdUcLo18VmmDWg_sksO5uqj";
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

    fetch(SUPABASE_URL + "/functions/v1/check-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": ANON_KEY,
        "Authorization": "Bearer " + ANON_KEY
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
