-- New text version after P3a: the data policy describes the walker verification mark (who checked the ID in person and
-- when; no copy or number of the document), who sees it and when it is removed. Same pattern as
-- 20261103100002_politica_notificaciones.sql (data only). Users are asked again by the re-consent gate.
update public.politicas set vigente = false where vigente;
insert into public.politicas (version, documentos) values ('2026-11-03b-borrador', array['terminos', 'datos']);
