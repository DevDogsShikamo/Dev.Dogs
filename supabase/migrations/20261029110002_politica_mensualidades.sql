-- New text version after F4 (monthly plans): the terms say a monthly plan is a fixed monthly charge per dog,
-- generated on the 1st and owed whatever the attendance, priced by each business, and that a cancellation takes
-- effect at the end of the month. Same pattern as 20261026120002_politica_lote_c2.sql (data only); the
-- Términos para negocios do not change. Users are asked again by the re-consent gate.
update public.politicas set vigente = false where vigente;
insert into public.politicas (version, documentos) values ('2026-10-29-borrador', array['terminos', 'datos']);
