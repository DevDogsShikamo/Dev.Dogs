-- Inverse of 20261102100002_politica_recogida.sql: 2026-10-30b-borrador is current again (revert POLITICA_VERSION in
-- src/lib/politica.js with it). The 2026-11-02-borrador row is consent evidence: it stays, not current.
update public.politicas set vigente = false where vigente;
update public.politicas set vigente = true where version = '2026-10-30b-borrador';
