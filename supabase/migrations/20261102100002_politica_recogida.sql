-- New text version after M1: the data policy says the pickup point of a dog (saved by its owner or the business) is
-- stored and seen only by the business and the walker of that dog's walks, and that the walker's phone location is
-- used only on the phone for the map, never sent or stored. Same pattern as 20261030120002_politica_foto_perro.sql
-- (data only); the Términos para negocios do not change. Users are asked again by the re-consent gate.
update public.politicas set vigente = false where vigente;
insert into public.politicas (version, documentos) values ('2026-11-02-borrador', array['terminos', 'datos']);
