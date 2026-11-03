-- Structural inverse of 20261030100001_personas.sql: removes the principal-owner and removal RPCs, the one-principal
-- index and baja_at, and restores is_office, the walker's walk read, provision_negocio and redeem_invite
-- (20261013100001_s1_grants_helpers.sql, 20260101000001_schema_v3.sql, 20261014100001_s7_consent.sql). Removed people
-- stay without a business and inactive links become active again (estado 'inactivo' is not allowed any more):
-- give them their access back first if that is not wanted.
drop function public.miembro_salir();
drop function public.miembro_dar_de_baja(uuid);
drop function public.miembro_baja_aplicar(uuid, uuid);
drop function public.perro_dueno_principal(uuid, uuid);

drop index public.perro_duenos_un_principal;
update public.perro_duenos set estado = 'activo' where estado = 'inactivo';
alter table public.perro_duenos drop constraint perro_duenos_estado_check;
alter table public.perro_duenos add constraint perro_duenos_estado_check check (estado in ('activo', 'pendiente'));
alter table public.profiles drop column baja_at;

create or replace function public.is_office() returns boolean
  language sql stable security definer set search_path = '' as
$$ select coalesce(public.my_rol() = 'empresa', false) $$;

drop policy "prestaciones read cuidador" on public.prestaciones;
create policy "prestaciones read cuidador" on public.prestaciones for select using (cuidador_id = auth.uid());

create or replace function public.provision_negocio(
  p_rol text, p_nombre text, p_politica text, p_negocio text default null, p_telefono text default null
) returns uuid
  language plpgsql security definer set search_path = '' as
$$
declare
  v_uid    uuid := auth.uid();
  v_nombre text := nullif(btrim(p_nombre), '');
  v_neg    text := coalesce(nullif(btrim(p_negocio), ''), v_nombre, 'Mi negocio');
  v_tel    text := nullif(btrim(p_telefono), '');
  v_id     uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not exists (select 1 from public.politicas where version = p_politica and vigente) then
    raise exception 'politica_invalida';
  end if;
  if p_rol not in ('empresa', 'paseador') then raise exception 'rol_invalido'; end if;
  if v_nombre is null or length(v_nombre) > 100 or length(v_neg) > 100 or length(coalesce(v_tel, '')) > 30 then
    raise exception 'datos_invalidos';
  end if;
  if exists (select 1 from public.profiles where id = v_uid) then raise exception 'perfil_existente'; end if;

  insert into public.negocios (owner_id, nombre, tipo)
    values (v_uid, v_neg, case p_rol when 'empresa' then 'empresa' else 'independiente' end)
    returning id into v_id;
  insert into public.profiles (id, negocio_id, rol, nombre) values (v_uid, v_id, p_rol, v_nombre);
  update public.contactos set telefono = v_tel where user_id = v_uid;
  insert into public.consentimientos (user_id, policy_version) values (v_uid, p_politica)
    on conflict (user_id, policy_version) do nothing;
  return v_id;
end;
$$;

create or replace function public.redeem_invite(p_codigo text, p_politica text) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  v_uid       uuid := auth.uid();
  v_email     text;
  v_confirmed boolean;
  v_norm      text;
  inv         public.invitaciones;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not exists (select 1 from public.politicas where version = p_politica and vigente) then
    raise exception 'politica_invalida';
  end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    return jsonb_build_object('ok', false, 'error', 'perfil_existente');
  end if;
  if (select count(*) from public.invitacion_intentos
        where user_id = v_uid and created_at > now() - interval '15 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'error', 'demasiados_intentos');
  end if;

  select lower(email), email_confirmed_at is not null into v_email, v_confirmed from auth.users where id = v_uid;
  v_norm := translate(upper(regexp_replace(coalesce(p_codigo, ''), '[^0-9A-Za-z]', '', 'g')), 'OIL', '011');
  if length(v_norm) = 14 then
    select * into inv from public.invitaciones where codigo_hash = extensions.digest(v_norm, 'sha256') for update;
  end if;

  if inv.id is null or inv.estado <> 'pendiente' or inv.expires_at <= now()
     or not coalesce(v_confirmed, false) or v_email is distinct from inv.email then
    delete from public.invitacion_intentos where user_id = v_uid and created_at <= now() - interval '1 day';
    insert into public.invitacion_intentos (user_id) values (v_uid);
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  insert into public.profiles (id, negocio_id, rol) values (v_uid, inv.negocio_id, inv.rol);
  insert into public.consentimientos (user_id, policy_version) values (v_uid, p_politica)
    on conflict (user_id, policy_version) do nothing;
  update public.invitaciones set estado = 'aceptada', usado_por = v_uid, usado_at = now() where id = inv.id;
  return jsonb_build_object('ok', true, 'negocio_id', inv.negocio_id, 'rol', inv.rol);
end;
$$;
