-- The data policy now lists the two dog fields added for the Ley 2480 de 2025 (20261020120001_ley_kiara.sql):
-- whether the dog is in heat and the issue date of its health certificate. A changed text is a new version
-- covering the terms and the data policy (same pattern as 20261020110001_terminos_aceptacion.sql); users
-- who accepted an older one are asked again by the re-consent gate.
update public.politicas set vigente = false where vigente;
insert into public.politicas (version, documentos) values ('2026-10-20c-borrador', array['terminos', 'datos']);
