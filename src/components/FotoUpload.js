// Subida de foto del paseo a Supabase Storage (bucket 'paseos'). Un file input NO es
// un primitivo de Muten, así que entra como Custom (widget hoja). Sube el archivo,
// obtiene la URL pública y la devuelve por on.uploaded(url); la página la anexa a la
// prestación (RPC paseo_agregar_foto). Sin retorno (un retorno de mount es updater).
function mount(el, inputs, on) {
  el.className = "dd-fotoup";

  var input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.style.display = "none";

  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "dd-fotoup-btn";
  btn.textContent = "📷 Agregar foto";

  el.appendChild(btn);
  el.appendChild(input);

  function toast(msg) {
    try { window.dispatchEvent(new CustomEvent("toast", { detail: msg })); } catch (e) {}
  }
  function sesion() {
    return (globalThis.__ddSesion || function () { return Promise.resolve({ uid: null }); })();
  }

  var busy = false;
  function setBusy(v) {
    busy = v;
    btn.disabled = v;
    btn.textContent = v ? "Subiendo…" : "📷 Agregar foto";
  }

  btn.addEventListener("click", function () { if (!busy) input.click(); });

  input.addEventListener("change", function () {
    var file = input.files && input.files[0];
    if (!file) return;
    var supa = globalThis.__supa;
    if (!supa || !supa.storage) { toast("Storage no disponible"); return; }
    setBusy(true);
    sesion().then(function (s) {
      var uid = s.uid || "anon";
      var m = /\.([a-zA-Z0-9]+)$/.exec(file.name || "");
      var ext = (m && m[1]) ? m[1].toLowerCase() : "jpg";
      var path = uid + "/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
      supa.storage.from("paseos").upload(path, file, { upsert: false, contentType: file.type || undefined })
        .then(function (res) {
          input.value = "";
          if (res && res.error) { setBusy(false); toast("No se pudo subir la foto"); return; }
          var pub = supa.storage.from("paseos").getPublicUrl(path);
          var url = pub && pub.data && pub.data.publicUrl;
          setBusy(false);
          if (url && on.uploaded) on.uploaded(url);
        })
        .catch(function () { input.value = ""; setBusy(false); toast("No se pudo subir la foto"); });
    });
  });
}
