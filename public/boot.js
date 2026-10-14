// Boot scripts that used to be inline in index.html (the CSP allows script-src 'self' only).

// Silencia el warning BENIGNO de ResizeObserver (los Charts nativos lo disparan);
// el overlay de error de dev de Muten lo trataba como fatal. Capturing + temprano.
window.addEventListener("error", function (e) {
  if (e && e.message && e.message.indexOf("ResizeObserver loop") !== -1) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
}, true);

// PWA: registra el Service Worker (usar sin conexión). network-first, seguro para dev.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js").catch(function () { /* noop */ });
  });
}

// Finishes a purge started by authActions.ts: the previous page rewrites its in-memory state to
// localStorage while unloading, so the keys are removed again before the app boots.
try {
  if (sessionStorage.getItem("dd_purge")) {
    sessionStorage.removeItem("dd_purge");
    Object.keys(localStorage).forEach(function (k) {
      if (k.indexOf("muten:") === 0 || k.indexOf("dd:") === 0) localStorage.removeItem(k);
    });
  }
} catch (e) { /* storage unavailable */ }
