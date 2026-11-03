// Foto del paseo (widget hoja, sin imports). Re-codifica la imagen en un canvas (el JPEG resultante
// no lleva EXIF/GPS), registra la foto con las prestaciones marcadas (RPC foto_registrar) y la sube
// al Worker de fotos con el token del usuario. Si la subida falla, la foto queda pendiente y se
// reintenta con el mismo id. Entradas: inputs(tags: @fotoTags) = perros marcados (el valor devuelto
// por mount es un updater: mantiene la lista al día). Eventos: on.uploaded(previewUrl).
// Dog profile photo: inputs(perro: @id) instead of tags. No registration: PUT /p/{perro} (the Worker asks
// perro_foto_autorizar), then "supa:refresh" so the bridges read the new perros.foto_at.
function mount(el, inputs, on) {
  el.className = "dd-fotoup";

  var MAX_EDGE = 1600;       // lado mayor, px
  var MAX_BYTES = 1500000;   // por encima se recodifica a calidad 0.6
  var tags = ids(inputs);
  var perro = (inputs && inputs.perro) || "";
  var pending = null;        // { id, blob, preview } tras un fallo reintentable
  var busy = false;

  var input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.style.display = "none";
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "dd-fotoup-btn";
  el.appendChild(btn);
  el.appendChild(input);
  paint();

  function ids(i) { return ((i && i.tags) || []).map(function (t) { return t && t.id; }).filter(Boolean); }
  function toast(m) { globalThis.__ddUtils.toast(m); }
  function paint() {
    btn.disabled = busy;
    btn.textContent = busy ? "Subiendo…" : pending ? "↻ Reintentar subida" : perro ? "📷 Cambiar foto" : "📷 Agregar foto";
  }
  function setBusy(v) { busy = v; paint(); }

  function jpeg(canvas, q) { return new Promise(function (ok) { canvas.toBlob(ok, "image/jpeg", q); }); }
  function encode(file) {
    return createImageBitmap(file, { imageOrientation: "from-image" }).then(function (bmp) {
      var k = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
      var c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(bmp.width * k));
      c.height = Math.max(1, Math.round(bmp.height * k));
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      if (bmp.close) bmp.close();
      return jpeg(c, 0.8).then(function (b) { return b && b.size > MAX_BYTES ? jpeg(c, 0.6) : b; });
    });
  }

  function registrar() {
    return globalThis.__supa.rpc("foto_registrar", { p_prestaciones: tags }).then(function (res) {
      if (res && res.error) {
        var m = String(res.error.message || "");
        throw /demasiadas_fotos/.test(m) ? "Este paseo ya tiene 10 fotos"
          : /fuera_de_ventana/.test(m) ? "Solo se pueden subir fotos de hoy o ayer"
          : /estado_invalido/.test(m) ? "Inicia el paseo para subir fotos"
          : "No se pudo registrar la foto";
      }
      return res.data;
    });
  }

  // Resuelve con el estado HTTP (0 = sin red); nunca rechaza.
  function put(id, blob, p) {
    return globalThis.__supa.auth.getSession().then(function (r) {
      var t = r && r.data && r.data.session && r.data.session.access_token;
      if (!t) return 401;
      return fetch(globalThis.__ddFotos + (p.perro ? "/p/" : "/f/") + id, { method: "PUT", headers: { authorization: "Bearer " + t, "content-type": "image/jpeg" }, body: blob })
        .then(function (res) { return res.status; });
    }).catch(function () { return 0; });
  }

  function send(p) {
    setBusy(true);
    return put(p.id, p.blob, p).then(function (status) {
      setBusy(false);
      if (status === 201) {
        pending = null; paint();
        if (p.perro) { toast("Foto del perro actualizada"); globalThis.dispatchEvent(new CustomEvent("supa:refresh")); }
        if (on.uploaded) on.uploaded(p.preview);
        return;
      }
      // 401, 5xx y sin red se reintentan con el mismo id; el resto no mejora con los mismos bytes.
      var retry = status === 0 || status === 401 || status >= 500;
      pending = retry ? p : null; paint();
      toast(status === 0 ? "Sin conexión. Toca Reintentar subida"
        : status === 401 ? "Tu sesión venció. Vuelve a entrar y toca Reintentar subida"
        : status === 413 ? "La foto es demasiado grande"
        : status === 415 || status === 422 ? "La foto no es válida"
        : status === 403 || status === 404 ? "No tienes permiso para subir esta foto"
        : "No se pudo subir la foto. Toca Reintentar subida");
    });
  }

  btn.addEventListener("click", function () {
    if (busy) return;
    if (pending) send(pending); else input.click();
  });

  input.addEventListener("change", function () {
    var file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    if (!perro && !tags.length) { toast("Marca al menos un perro en la foto"); return; }
    var dog = perro;
    setBusy(true);
    encode(file)
      .then(function (blob) {
        if (!blob) throw "No se pudo preparar la foto";
        return (dog ? Promise.resolve(dog) : registrar()).then(function (id) { return { id: id, perro: !!dog, blob: blob, preview: URL.createObjectURL(blob) }; });
      })
      .then(function (p) { setBusy(false); return send(p); })
      .catch(function (e) { setBusy(false); toast(typeof e === "string" ? e : "No se pudo preparar la foto"); });
  });

  return function (next) { tags = ids(next); perro = (next && next.perro) || ""; paint(); };
}
