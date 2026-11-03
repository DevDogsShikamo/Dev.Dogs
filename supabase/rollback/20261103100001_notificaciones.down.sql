-- Structural inverse of 20261103100001_notificaciones.sql. Drops every notification and read mark. Revert the app
-- with it (the business portal bell calls the notificacion* RPCs).
select cron.unschedule(jobid) from cron.job where jobname = 'dd_notificaciones_purga';
drop function public.notificaciones_purgar();
drop function public.notificaciones_leer_todas();
drop function public.notificacion_leer(uuid);
drop function public.notificaciones_sin_leer();
drop function public.notificaciones_mias(integer, timestamptz);
drop trigger trg_notif_foto_reporte on public.fotos_reportes;
drop trigger trg_notif_perro_nuevo on public.perros;
drop trigger trg_notif_resena on public.resenas;
drop trigger trg_notif_prestacion_cancela on public.prestaciones;
drop trigger trg_notif_prestacion_alta on public.prestaciones;
drop function public.notif_foto_reporte();
drop function public.notif_perro_nuevo();
drop function public.notif_resena();
drop function public.notif_prestacion();
drop function public.notificacion_crear(uuid, text, uuid, text, text);
drop table public.notificacion_leidas;
drop table public.notificaciones;
