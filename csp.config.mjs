// Content-Security-Policy of the PRODUCTION build: the single source of truth.
// scripts/csp-inject.mjs writes it into dist/index.html as a <meta> (`npm run build`); the source index.html
// carries none, because `muten dev` injects inline/eval HMR scripts that script-src 'self' would block.
// img-src keeps https: because perros.foto_url is a free-text URL; walk photos are blob: images fetched
// from the photo Worker (connect-src). frame-ancestors and HSTS need response headers (hosting follow-up).
const SUPABASE = 'agutaluxzruuthbbagkh.supabase.co' // production project
const FOTOS = 'https://devdogs-fotos.devdogsco.workers.dev' // production photo Worker

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  `img-src 'self' data: blob: https: ${FOTOS}`,
  `connect-src 'self' https://${SUPABASE} wss://${SUPABASE} ${FOTOS}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')
