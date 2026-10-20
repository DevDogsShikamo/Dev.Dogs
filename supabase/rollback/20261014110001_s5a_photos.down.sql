-- Inverse of S5a (20261014110001_s5a_photos.sql): drops the photo functions and both tables. Nothing legacy
-- was changed by S5a, so nothing is restored and no policy, grant or function is reopened. Photo metadata is
-- lost (the objects in R2 expire by lifecycle). The staging Worker is removed separately, by hand:
--   npx wrangler@4 delete --name devdogs-fotos-staging --config worker/wrangler.toml
-- Pre-launch the authoritative rollback is `git revert` plus `node supabase/staging.mjs reset`.

drop function if exists public.foto_confirmar(uuid, integer);
drop function if exists public.foto_subida_autorizar(uuid);
drop function if exists public.foto_registrar(uuid[]);
drop table if exists public.paseo_foto_perros;
drop table if exists public.paseo_fotos;
drop function if exists public.can_see_foto(uuid);
