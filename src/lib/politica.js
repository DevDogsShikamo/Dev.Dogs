// Single source of the privacy-policy version. The consent checkbox pages pass it to
// provision_negocio / redeem_invite, the policy page shows it, and the migration seeds the same
// string into `politicas` (tests/security/consent.test.mjs fails if they drift).
// DRAFT: pending legal review. Bump the version (and add a `politicas` row) whenever the text changes.
export const POLITICA_VERSION = "2026-10-20-borrador";

export function politicaVersion() {
  return POLITICA_VERSION;
}

// The consent modal unlocks "Acepto" once its document has been scrolled to the end. Called from the
// scroll action of the document body.
export function alFinal(id) {
  const el = document.getElementById(id);
  return !!el && el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
}

// The router does not scroll to a #hash: after every navigation (an in-app link such as the landing
// footer "Contacto" -> /privacidad#derechos, or a hash link of the /politicas index, which fires
// popstate and re-renders the page) it runs scrollTo(0,0) and focuses <main>, which cancels the smooth
// scroll of html{scroll-behavior:smooth}. So the page jumps to the anchor itself, after the router is done.
export function irAlAncla() {
  const id = location.hash.slice(1);
  if (id) requestAnimationFrame(() => setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "instant", block: "start" }), 0));
}
