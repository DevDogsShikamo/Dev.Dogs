-- Inverse of S4a2 (20261013160001_s4a2_rpcs.sql, 20261013160002_s4a2_sync.sql). Drops the sync
-- triggers and the new functions, and puts cobro_marcar back to its S2b2 owner-only body (the
-- narrower of the two). Nothing is reopened. After it the side tables go stale again: re-run
-- `select backfill_side_tables()` (service role) before anything reads them. Pre-launch the
-- authoritative rollback is `git revert` plus `node supabase/staging.mjs reset`.

drop trigger if exists trg_sync_profile_side on public.profiles;
drop trigger if exists trg_sync_servicio_tarifa on public.servicios;
drop trigger if exists trg_sync_prestacion_cobro on public.prestaciones;
drop trigger if exists trg_sync_perro_identidad on public.perros;
drop function if exists public.sync_profile_side();
drop function if exists public.sync_servicio_tarifa();
drop function if exists public.sync_prestacion_cobro();
drop function if exists public.sync_perro_identidad();
drop function if exists public.walks_dog(uuid);
drop function if exists public.contacto_set(text);
drop function if exists public.permiso_finanzas_set(uuid, boolean);
drop function if exists public.servicio_guardar(uuid, text, text, integer, integer, text);
drop function if exists public.perro_duenos_nombres();

create or replace function public.cobro_marcar(p_prestacion uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  r record;
begin
  if auth.uid() is null then raise exception 'no_autorizado' using errcode = '42501'; end if;
  select id, negocio_id, estado, cobrable, cobrado into r from public.prestaciones where id = p_prestacion for update;
  if not found or r.negocio_id is distinct from public.my_negocio() or not public.is_owner() then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if r.cobrado then return; end if;
  if r.estado <> 'finalizado' or r.cobrable is distinct from true then raise exception 'no_cobrable'; end if;
  update public.prestaciones set cobrado = true, confirmado_por = auth.uid(), confirmado_at = now() where id = r.id;
end;
$$;
