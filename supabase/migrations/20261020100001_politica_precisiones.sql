-- The privacy text now matches what the app does: the walker's device keeps the day agenda without
-- zones or notes, no walker notes or microchip are collected, and no client edits a dog's data. A
-- changed text is a new version (same pattern as 20261019130002_politica_mis_datos.sql); users who
-- accepted an older one are asked again by the re-consent gate.
update public.politicas set vigente = false where vigente;
insert into public.politicas (version) values ('2026-10-20-borrador');
