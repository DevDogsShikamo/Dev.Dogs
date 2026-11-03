-- New text version after F6: the data policy describes business notifications (short summary, per-person read
-- state, who sees each type, 90-day retention). Same pattern as 20261102100002_politica_recogida.sql (data only);
-- the Términos para negocios do not change. Users are asked again by the re-consent gate.
update public.politicas set vigente = false where vigente;
insert into public.politicas (version, documentos) values ('2026-11-03-borrador', array['terminos', 'datos']);
