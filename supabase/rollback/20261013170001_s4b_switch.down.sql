-- Structural inverse of S4b (20261013170001_s4b_switch.sql). Re-adds the dropped legacy columns and
-- copies the side-table values back into them. It re-opens NOTHING: the policy "profiles update owner",
-- the salary branch of profiles_guard, the tenant-wide dog read for walkers, the sync triggers and
-- backfill_side_tables() are not restored, and profiles.zona comes back empty (there is no source for it).
-- The rewritten functions keep reading and writing the side tables, so a database restored with this
-- script still works with the phase-1 app. Pre-launch the authoritative rollback is `git revert` plus
-- `node supabase/staging.mjs reset` (see supabase/README.md).

alter table public.profiles
  add column if not exists telefono text, add column if not exists zona text, add column if not exists salario_fijo integer default 0;
alter table public.servicios
  add column if not exists precio integer default 0, add column if not exists precio_mensual integer default 0;
alter table public.prestaciones
  add column if not exists precio_aplicado integer default 0, add column if not exists cobrable boolean default true,
  add column if not exists cobrado boolean default false, add column if not exists confirmado_at timestamptz,
  add column if not exists confirmado_por uuid references public.profiles(id) on delete set null;
alter table public.perros add column if not exists microchip text unique;

update public.profiles p set telefono = c.telefono from public.contactos c where c.user_id = p.id;
update public.profiles p set salario_fijo = n.salario_fijo from public.nomina n where n.user_id = p.id;
update public.servicios s set precio = t.precio, precio_mensual = t.precio_mensual from public.tarifas t where t.servicio_id = s.id;
update public.prestaciones p
  set precio_aplicado = c.precio_aplicado, cobrable = c.cobrable, cobrado = c.cobrado,
      confirmado_por = c.confirmado_por, confirmado_at = c.confirmado_at
  from public.cobros c where c.prestacion_id = p.id;
update public.perros p set microchip = i.microchip from public.perro_identidad i where i.perro_id = p.id;
