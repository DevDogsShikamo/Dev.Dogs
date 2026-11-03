-- New text version after F5b (data polish): the data policy says each owner (principal or co-owner) edits the name,
-- breed, size, behaviour, sociability, notes and profile photo of its dogs, who sees and uploads the dog profile photo
-- (stored in Cloudflare R2, kept while the dog is registered, replaced by a new one, not kept on the device). Same
-- pattern as 20261029110002_politica_mensualidades.sql (data only); the Términos para negocios do not change. Users
-- are asked again by the re-consent gate.
update public.politicas set vigente = false where vigente;
insert into public.politicas (version, documentos) values ('2026-10-30-borrador', array['terminos', 'datos']);
