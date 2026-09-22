// Vigía de conexión: reporta al net.store si hay red y cuántas escrituras esperan
// sincronizar (la cola de outbox.ts, que vive en localStorage "dd:outbox"). El shell
// pinta el aviso desde ese store. Va montado en cada portal porque los Custom del
// shell NO montan. Sin retorno (un retorno de mount es updater, no cleanup).
function mount(el, inputs, on) {
  el.style.display = "none";

  function pend() {
    try {
      var raw = localStorage.getItem("dd:outbox") || "[]";
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.length : 0;
    } catch (e) {
      return 0;
    }
  }

  function report() {
    if (on.online) on.online(navigator.onLine !== false);
    if (on.pending) on.pending(pend());
  }

  report();
  // Sin sondeo: reaccioná a los eventos que sí cambian el estado.
  //  online/offline → red; dd:outbox → la cola cambió (misma pestaña, lo emite
  //  outbox.ts); storage → cambió en OTRA pestaña; supa:refresh → tras sincronizar.
  window.addEventListener("online", report);
  window.addEventListener("offline", report);
  window.addEventListener("dd:outbox", report);
  window.addEventListener("storage", report);
  window.addEventListener("supa:refresh", report);
}
