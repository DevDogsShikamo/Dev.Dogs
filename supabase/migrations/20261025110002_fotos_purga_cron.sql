-- Expired walk photos are deleted, not only hidden: until now paseo_fotos rows past expires_at were purged only
-- when someone registered a new photo (foto_registrar, 20261014110001_s5a_photos.sql). A pg_cron job now runs
-- the same purge every day at 03:15 UTC (22:15 in Bogota); the tag rows go with it (on delete cascade). The R2
-- objects are deleted by the bucket lifecycle rule (supabase/README.md).

create extension if not exists pg_cron with schema pg_catalog;

-- Same condition as foto_registrar: expired rows, and uploads abandoned for a day. Not callable through the API;
-- the cron job runs it as its owner. Returns how many rows it deleted.
create function public.fotos_purgar_vencidas() returns integer
  language sql security definer set search_path = '' as
$$
  with borradas as (
    delete from public.paseo_fotos
     where expires_at <= now() or (estado = 'pendiente' and created_at < now() - interval '1 day')
    returning 1)
  select count(*)::integer from borradas
$$;
revoke execute on function public.fotos_purgar_vencidas() from public, anon, authenticated;

-- Idempotent: a re-run replaces the job instead of adding a second one.
select cron.unschedule(jobid) from cron.job where jobname = 'dd_purga_fotos';
select cron.schedule('dd_purga_fotos', '15 3 * * *', 'select public.fotos_purgar_vencidas()');
