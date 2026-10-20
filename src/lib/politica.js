// Single source of the privacy-policy version. The consent checkbox pages pass it to
// provision_negocio / redeem_invite, the policy page shows it, and the migration seeds the same
// string into `politicas` (tests/security/consent.test.mjs fails if they drift).
// DRAFT: pending legal review. Bump the version (and add a `politicas` row) whenever the text changes.
export const POLITICA_VERSION = "2026-10-19-borrador";

export function politicaVersion() {
  return POLITICA_VERSION;
}

// The consent modal unlocks "Acepto" once its document has been scrolled to the end. Called from the
// scroll action of the document body.
export function alFinal(id) {
  const el = document.getElementById(id);
  return !!el && el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
}

// The router does not scroll to a #hash after an in-app navigation (e.g. the landing footer
// "Contacto" -> /privacidad#derechos), so the policy page does it once it has rendered.
export function irAlAncla() {
  const id = location.hash.slice(1);
  if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
}
