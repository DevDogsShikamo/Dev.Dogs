-- New text version after F5c: the data policy says the dog profile photo can be removed and is deleted from storage
-- when removed or when the dog is removed, and that a refused incident report stays on the walker's device until
-- discarded. Same pattern as 20261030110002_politica_datos.sql (data only); the Términos para negocios do not change.
-- Users are asked again by the re-consent gate.
update public.politicas set vigente = false where vigente;
insert into public.politicas (version, documentos) values ('2026-10-30b-borrador', array['terminos', 'datos']);
