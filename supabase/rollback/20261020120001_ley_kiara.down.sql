-- Structural inverse of 20261020120001_ley_kiara.sql.
drop trigger if exists trg_prestacion_ley_kiara on public.prestaciones;
drop function if exists public.prestacion_ley_kiara();
alter table public.perros drop column if exists certificado_salud, drop column if exists en_celo;
