-- The terms now say that heat and an infectious-contagious disease also hold back training and daycare
-- (Ley 2480 art. 7, 20261025100001_ley_kiara_contagio.sql) and that any difference with the summary is read
-- in favour of the consumer (Ley 1480 art. 34); the data policy lists every use of the data, the technical
-- access logs of the providers and the query and claim procedure (Decreto 1377 art. 13). A changed text is a
-- new version covering the terms and the data policy (same pattern as 20261022110002_politica_negocios_propias.sql);
-- users who accepted an older one are asked again by the re-consent gate.
update public.politicas set vigente = false where vigente;
insert into public.politicas (version, documentos) values ('2026-10-25-borrador', array['terminos', 'datos']);
