-- The terms now say that each business may publish its own policies, which its clients accept in the app,
-- and that those policies are the business's, not DevDogs' (20261022110001_politicas_negocio.sql). A
-- changed text is a new version covering the terms and the data policy (same pattern as
-- 20261022100002_politica_rol.sql); users who accepted an older one are asked again by the re-consent gate.
update public.politicas set vigente = false where vigente;
insert into public.politicas (version, documentos) values ('2026-10-22b-borrador', array['terminos', 'datos']);
