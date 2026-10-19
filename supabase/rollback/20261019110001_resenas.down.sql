-- Structural inverse of 20261019110001_resenas.sql: drops the three review functions and the `resenas`
-- table WITH its rows (reviews have no other home; export them first if they must be kept). The app of
-- this slice (client review sheet, owner moderation, landing section) calls these functions and must be
-- reverted together with this script; the landing then simply shows no reviews section.

drop function public.resenas_publicas();
drop function public.resena_moderar(uuid, text);
drop function public.resena_guardar(uuid, integer, text, boolean);
drop table public.resenas;
