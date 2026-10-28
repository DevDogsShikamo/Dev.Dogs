// Single source of the privacy-policy version. The consent checkbox pages pass it to
// provision_negocio / redeem_invite, the policy page shows it, and the migration seeds the same
// string into `politicas` (tests/security/consent.test.mjs fails if they drift).
// DRAFT: pending legal review. Bump the version (and add a `politicas` row) whenever the text changes.
export const POLITICA_VERSION = "2026-10-19-borrador";

export function politicaVersion() {
  return POLITICA_VERSION;
}

// Opens the policy in a new tab so reading it does not reset the signup / join form (a Muten Link
// navigates inside the app and the page state is lost). Called as a side-effect statement from an action.
export function abrirPolitica() {
  window.open("/privacidad", "_blank", "noopener");
}

// The router does not scroll to a #hash after an in-app navigation (e.g. the landing footer
// "Contacto" -> /privacidad#derechos), so the policy page does it once it has rendered.
export function irAlAncla() {
  const id = location.hash.slice(1);
  if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
}
