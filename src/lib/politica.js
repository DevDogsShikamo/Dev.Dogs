// Single source of the version of the legal documents the user accepts (terms of use + data policy
// since 2026-10-20b; the `politicas.documentos` column says which ones each version covers).
// The consent pages pass it to provision_negocio / redeem_invite, the policy pages show it, and the
// migration seeds the same string into `politicas` (tests/security/consent.test.mjs fails if they drift).
// DRAFT: pending legal review. Bump the version (and add a `politicas` row) whenever the text changes.
export const POLITICA_VERSION = "2026-10-22-borrador";

// Current versions of the role notice (clients) and of the Términos para negocios (business owners), the
// acceptances the /aceptar-condiciones gate records in `aceptaciones`. Mirrors public.version_vigente()
// (20261022100001_aceptaciones.sql; tests/security/aceptaciones.test.mjs fails if they drift).
// DRAFT: bump the constant AND the SQL function together whenever the text of AvisoRol or TerminosNegocio changes.
export const AVISO_ROL_VERSION = "2026-10-22-borrador";
export const TERMINOS_NEGOCIO_VERSION = "2026-10-22-borrador";

// The version of the pending document of the gate ("aviso_rol" | "terminos_negocio").
export function condicionesVersion(tipo) {
  return tipo === "terminos_negocio" ? TERMINOS_NEGOCIO_VERSION : AVISO_ROL_VERSION;
}

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
