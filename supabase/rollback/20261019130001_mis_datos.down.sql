-- Structural inverse of 20261019130001_mis_datos.sql: drops the two functions and the `solicitudes_datos`
-- table WITH its rows (export pending requests first: they are legal deadlines) and the name-length check.
-- The "Mis datos" page calls these functions and must be reverted together with this script.

drop function public.mis_datos_exportar();
drop function public.solicitud_datos_crear(text, text);
drop table public.solicitudes_datos;
alter table public.profiles drop constraint profiles_nombre_len;
