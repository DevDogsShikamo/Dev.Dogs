-- The fonts are now served by the app itself (public/fonts/), so the terms (section 6) and the data policy
-- (section 8) no longer say that Google Fonts can see the browser IP. A changed text is a new version covering
-- the terms and the data policy (same pattern as 20261025100002_politica_contagio_reclamos.sql); users who
-- accepted an older one are asked again by the re-consent gate.
update public.politicas set vigente = false where vigente;
insert into public.politicas (version, documentos) values ('2026-10-25b-borrador', array['terminos', 'datos']);
