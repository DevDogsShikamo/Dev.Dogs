-- S5b: the app now uploads walk photos through the photo Worker (R2), so the legacy Supabase Storage
-- path is closed. The `paseos` bucket stays (deleting it is the manual step H7 / WP-1c, which also
-- discards the old test photos) but nobody can list, read or write it any more.
--   * the bucket stops being public and its two permissive policies on storage.objects are dropped
--   * paseo_agregar_foto (stores any https URL in prestaciones.detalle.fotos) is dropped, so an
--     arbitrary URL string can never be attached to a walk: only foto_registrar (walk ids) remains
--   * URLs already attached by the old flow are removed from the walk details

update storage.buckets set public = false where id = 'paseos';

drop policy if exists "paseos upload" on storage.objects;
drop policy if exists "paseos read" on storage.objects;

drop function if exists public.paseo_agregar_foto(uuid[], text);

update public.prestaciones set detalle = detalle - 'fotos' where detalle ? 'fotos';
