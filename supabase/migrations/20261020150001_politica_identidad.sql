-- The data policy now lists the legal identity each business records (20261020140001_negocio_identidad.sql):
-- name or company name, ID document (a personal ID for an independent walker), notification address, phone
-- and email, seen by every member of the business, its clients included. A changed text is a new version
-- covering the terms and the data policy (same pattern as 20261020130001_politica_kiara.sql); users who
-- accepted an older one are asked again by the re-consent gate.
update public.politicas set vigente = false where vigente;
insert into public.politicas (version, documentos) values ('2026-10-20d-borrador', array['terminos', 'datos']);
