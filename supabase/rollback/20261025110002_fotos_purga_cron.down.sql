-- Structural inverse of 20261025110002_fotos_purga_cron.sql: removes the daily job, the purge function and the
-- pg_cron extension. Expired rows are again purged only when a photo is registered (foto_registrar).
select cron.unschedule(jobid) from cron.job where jobname = 'dd_purga_fotos';
drop function public.fotos_purgar_vencidas();
drop extension if exists pg_cron;
