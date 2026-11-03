-- Inverse of 20261103100002_politica_notificaciones.sql: 2026-11-02-borrador is current again (revert POLITICA_VERSION in
-- src/lib/politica.js with it). The 2026-11-03-borrador row is consent evidence: it stays, not current.
update public.politicas set vigente = false where vigente;
update public.politicas set vigente = true where version = '2026-11-02-borrador';
