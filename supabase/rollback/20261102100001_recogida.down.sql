-- Structural inverse of 20261102100001_recogida.sql. Drops every saved pickup point: export perro_recogida first if
-- it must be kept. Revert the app with it (the dog sheets call the recogida_* RPCs).
drop trigger trg_perro_recogida_baja on public.perros;
drop function public.perro_recogida_baja();
drop function public.recogida_mis_paseos(date, date);
drop function public.recogida_de(uuid);
drop function public.recogida_borrar(uuid);
drop function public.recogida_guardar(uuid, numeric, numeric, text);
drop table public.perro_recogida;
