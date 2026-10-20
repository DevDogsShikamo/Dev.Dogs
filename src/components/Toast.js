// Toast liviano: escucha el evento window "toast" (detail = mensaje) y lo muestra
// unos segundos. Montado en el root. Sin retorno (en Muten un retorno de mount es
// un updater, no cleanup).
function mount(el, inputs, on) {
  el.className = "dd-toast-host";
  var timer = 0;
  function show(e) {
    var msg = (e && e.detail) || "";
    if (!msg) return;
    el.textContent = msg;
    el.classList.add("on");
    clearTimeout(timer);
    timer = setTimeout(function () { el.classList.remove("on"); }, 3200);
  }
  window.addEventListener("toast", show);
}
