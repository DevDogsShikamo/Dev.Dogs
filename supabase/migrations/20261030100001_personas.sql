-- F2 people: the principal owner of a dog, removing people from a business and leaving it.
--   perro_dueno_principal(p_perro, p_cliente)  owner or office: a client of the business becomes the ONE active
--                          principal owner of the dog (inserted or promoted); the previous principal becomes a co-owner.
--                          A dog the business registered has no owner link until then (Tienda needs the principal).
--   miembro_dar_de_baja(p_usuario)  the owner removes a walker, office employee or client of his business (not himself)
--   miembro_salir()        a walker, office employee or client leaves its business; an owner cannot (he owns it)
-- A removal keeps the history. The profile stays, with negocio_id null and baja_at set, so walks, charges, photos,
-- reviews and the dogs keep their rows (a deleted profile would cascade them away). What goes: every read of the
-- tenant (my_negocio() is null), the finance permission, the nomina and contactos rows, the pending invitations to
-- the person, its future programado unpaid walks and its groups (unassigned: they wait for "Asignar" like a booking),
-- and a client's links to the dogs of the business (estado inactivo). The person can join a business again: redeem_invite
-- and provision_negocio take a profile without a business.

-- ---- one active principal per dog ---------------------------------------------------------------------------
alter table public.perro_duenos drop constraint if exists perro_duenos_estado_check;
alter table public.perro_duenos add constraint perro_duenos_estado_check check (estado in ('activo', 'pendiente', 'inactivo'));
-- Older data: keep the oldest active principal, the others become co-owners.
update public.perro_duenos d set rol = 'co'
 where d.rol = 'principal' and d.estado = 'activo'
   and exists (select 1 from public.perro_duenos o
                where o.perro_id = d.perro_id and o.rol = 'principal' and o.estado = 'activo'
                  and (o.created_at, o.id) < (d.created_at, d.id));
create unique index perro_duenos_un_principal on public.perro_duenos (perro_id) where rol = 'principal' and estado = 'activo';

alter table public.profiles add column baja_at timestamptz;

-- Office staff is office of a business only: a removed employee keeps rol 'empresa' (history) but no tenant.
create or replace function public.is_office() returns boolean
  language sql stable security definer set search_path = '' as
$$ select coalesce(public.my_rol() = 'empresa' and public.my_negocio() is not null, false) $$;

-- A walker reads the walks assigned to him in his own business only: after a removal his past walks keep their
-- walker (history) and stop being his to read.
drop policy "prestaciones read cuidador" on public.prestaciones;
create policy "prestaciones read cuidador" on public.prestaciones for select
  using (cuidador_id = auth.uid() and negocio_id = public.my_negocio());

-- ---- principal owner ---------------------------------------------------------------------------------------
create function public.perro_dueno_principal(p_perro uuid, p_cliente uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_neg uuid;
begin
  select negocio_id into v_neg from public.perros where id = p_perro for update;
  perform public.assert_gestor(v_neg);  -- also refuses an unknown dog, with the same error
  if not exists (select 1 from public.profiles where id = p_cliente and negocio_id = v_neg and rol = 'cliente') then
    raise exception 'dueno_invalido';
  end if;
  update public.perro_duenos set rol = 'co' where perro_id = p_perro and rol = 'principal' and dueno_id <> p_cliente;
  insert into public.perro_duenos (perro_id, dueno_id, rol, estado, invitado_por)
    values (p_perro, p_cliente, 'principal', 'activo', auth.uid())
    on conflict (perro_id, dueno_id) do update set rol = 'principal', estado = 'activo';
end;
$$;

-- ---- removal -----------------------------------------------------------------------------------------------
-- Internal (called by the two RPCs below as their owner): p_usuario leaves tenant p_neg.
create function public.miembro_baja_aplicar(p_usuario uuid, p_neg uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_hoy   date := (now() at time zone 'America/Bogota')::date;
  v_email text;
begin
  select lower(email) into v_email from auth.users where id = p_usuario;
  update public.profiles set negocio_id = null, baja_at = now() where id = p_usuario and negocio_id = p_neg;
  delete from public.permisos  where user_id = p_usuario;
  delete from public.nomina    where user_id = p_usuario;
  delete from public.contactos where user_id = p_usuario;
  update public.invitaciones set estado = 'revocada'
   where negocio_id = p_neg and estado = 'pendiente' and (email = v_email or invitado_por = p_usuario);
  -- Walker or staff: from today on, still programado and unpaid; started, finished or paid walks keep him.
  update public.prestaciones p set cuidador_id = null
   where p.negocio_id = p_neg and p.cuidador_id = p_usuario and p.estado = 'programado' and p.fecha >= v_hoy
     and not exists (select 1 from public.cobros c where c.prestacion_id = p.id and c.cobrado);
  update public.grupos set cuidador_id = null where negocio_id = p_neg and cuidador_id = p_usuario;
  -- Client: detached from the dogs of the business (the dogs and their history stay).
  update public.perro_duenos d set estado = 'inactivo'
   where d.dueno_id = p_usuario and d.estado <> 'inactivo'
     and exists (select 1 from public.perros x where x.id = d.perro_id and x.negocio_id = p_neg);
end;
$$;

create function public.miembro_dar_de_baja(p_usuario uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_neg uuid := public.my_negocio();
begin
  if auth.uid() is null or v_neg is null or not public.is_owner() then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if p_usuario is null or p_usuario = auth.uid() then raise exception 'miembro_invalido'; end if;
  if not exists (select 1 from public.profiles where id = p_usuario and negocio_id = v_neg) then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  perform public.miembro_baja_aplicar(p_usuario, v_neg);
end;
$$;

create function public.miembro_salir() returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_neg uuid := public.my_negocio();
begin
  if auth.uid() is null or v_neg is null then raise exception 'no_autorizado' using errcode = '42501'; end if;
  if public.is_owner() then raise exception 'dueno_no_puede_salir'; end if;
  perform public.miembro_baja_aplicar(auth.uid(), v_neg);
end;
$$;

revoke execute on function public.miembro_baja_aplicar(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.perro_dueno_principal(uuid, uuid), public.miembro_dar_de_baja(uuid),
  public.miembro_salir() from public, anon;
grant execute on function public.perro_dueno_principal(uuid, uuid), public.miembro_dar_de_baja(uuid),
  public.miembro_salir() to authenticated;

-- ---- coming back: a profile without a business is not an existing profile ------------------------------------
-- Same bodies as 20261014100001_s7_consent.sql, plus: the check refuses only a profile WITH a business, the profile
-- row is written in place (baja_at cleared) and its contactos row is created (the insert trigger does not fire on
-- the update path).
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
  if exists (select 1 from public.profiles where id = v_uid and negocio_id is not null) then raise exception 'perfil_existente'; end if;

  insert into public.negocios (owner_id, nombre, tipo)
    values (v_uid, v_neg, case p_rol when 'empresa' then 'empresa' else 'independiente' end)
    returning id into v_id;
  insert into public.profiles (id, negocio_id, rol, nombre) values (v_uid, v_id, p_rol, v_nombre)
    on conflict (id) do update set negocio_id = excluded.negocio_id, rol = excluded.rol, nombre = excluded.nombre, baja_at = null;
  insert into public.contactos (user_id, negocio_id, rol) values (v_uid, v_id, p_rol) on conflict (user_id) do nothing;
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
  if exists (select 1 from public.profiles where id = v_uid and negocio_id is not null) then
    return jsonb_build_object('ok', false, 'error', 'perfil_existente');
  end if;
  if (select count(*) from public.invitacion_intentos
        where user_id = v_uid and created_at > now() - interval '15 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'error', 'demasiados_intentos');
  end if;

  select lower(email), email_confirmed_at is not null into v_email, v_confirmed from auth.users where id = v_uid;
  -- Normalise: upper-case, only letters and digits, O -> 0, I and L -> 1.
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

  insert into public.profiles (id, negocio_id, rol) values (v_uid, inv.negocio_id, inv.rol)
    on conflict (id) do update set negocio_id = excluded.negocio_id, rol = excluded.rol, baja_at = null;
  insert into public.contactos (user_id, negocio_id, rol) values (v_uid, inv.negocio_id, inv.rol) on conflict (user_id) do nothing;
  insert into public.consentimientos (user_id, policy_version) values (v_uid, p_politica)
    on conflict (user_id, policy_version) do nothing;
  update public.invitaciones set estado = 'aceptada', usado_por = v_uid, usado_at = now() where id = inv.id;
  return jsonb_build_object('ok', true, 'negocio_id', inv.negocio_id, 'rol', inv.rol);
end;
$$;
