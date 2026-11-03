-- Inverse of 20261103110002_politica_verificacion.sql: 2026-11-03-borrador is current again (revert POLITICA_VERSION in
-- src/lib/politica.js with it). The 2026-11-03b-borrador row is consent evidence: it stays, not current.
update public.politicas set vigente = false where vigente;
update public.politicas set vigente = true where version = '2026-11-03-borrador';
