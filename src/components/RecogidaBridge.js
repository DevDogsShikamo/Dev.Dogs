// Pickup point of the dog open in the sheet (hidden bridge, no imports). Loads the stored point (recogida_de) when
// it mounts, when the dog changes and on "dd:recogida" (after a save or a removal in data.ts). On "dd:ubicar" (the
// "Usar mi ubicación actual" button, recogidaUbicar in data.ts) it reads the device location ONCE (high accuracy;
// never watched, never in the background) and hands it to the page, which only sends it when the user taps Guardar.
// Inputs: inputs(perro: @pedit). Events: on.cargado({perro, lat, lng, nota}), on.ubicado({lat, lng, precision}) with
// lat/lng as text with 5 decimals and precision in metres, on.fallo() when no location could be read.
function mount(el, inputs, on) {
  el.style.display = "none";
  var perro = (inputs && inputs.perro) || "";

  function toast(m) { globalThis.__ddUtils.toast(m); }
  function txt(v) { return v == null ? "" : String(v); }

  function load() {
    var id = perro;
    on.cargado({ perro: id, lat: "", lng: "", nota: "" });
    var supa = globalThis.__supa;
    if (!id || !supa) return;
    supa.rpc("recogida_de", { p_perro: id }).then(function (r) {
      if (id !== perro || !r || r.error) return;
      var p = (r.data && r.data[0]) || {};
      on.cargado({ perro: id, lat: txt(p.lat), lng: txt(p.lng), nota: p.nota || "" });
    });
  }

  function ubicar() {
    if (!navigator.geolocation) { on.fallo(); toast("Este dispositivo no permite leer la ubicación"); return; }
    navigator.geolocation.getCurrentPosition(function (pos) {
      on.ubicado({ lat: pos.coords.latitude.toFixed(5), lng: pos.coords.longitude.toFixed(5), precision: Math.round(pos.coords.accuracy) });
    }, function (e) {
      on.fallo();
      toast(e.code === 1 ? "Permite el acceso a la ubicación en tu navegador para usar este botón"
        : e.code === 3 ? "La ubicación tardó demasiado. Intenta de nuevo"
        : "No se pudo leer la ubicación. Intenta de nuevo");
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  }

  // The sheet unmounts this bridge; its listeners go with it on the next event.
  function listen(name, fn) {
    function h() {
      if (!el.isConnected) { window.removeEventListener(name, h); return; }
      fn();
    }
    window.addEventListener(name, h);
  }
  listen("dd:recogida", load);
  listen("dd:ubicar", ubicar);
  load();

  return function (next) {
    var n = (next && next.perro) || "";
    if (n !== perro) { perro = n; load(); }
  };
}
