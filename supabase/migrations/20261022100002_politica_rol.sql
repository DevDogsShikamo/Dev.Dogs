-- The terms now say what DevDogs does not do (it does not pick up, transport, walk, care for or answer for
-- the dog: the business does), that businesses accept separate Términos para negocios, and the data policy
-- lists the acceptance records of 20261022100001_aceptaciones.sql. A changed text is a new version covering
-- the terms and the data policy (same pattern as 20261020150001_politica_identidad.sql); users who accepted
-- an older one are asked again by the re-consent gate.
update public.politicas set vigente = false where vigente;
insert into public.politicas (version, documentos) values ('2026-10-22-borrador', array['terminos', 'datos']);
