-- S7 privacy consent (R8-2, D15). A profile cannot exist without a consent record: provision_negocio
-- and redeem_invite take the policy version the user accepted, verify it is the current one and insert
-- the record in the same transaction as the profile. The timestamp is the server's now(); no IP or
-- user agent is stored. Records are readable by their owner only and never writable through the API.

create table public.politicas (
  version      text primary key check (length(version) between 1 and 60),
  vigente      boolean not null default true,
  publicada_at timestamptz not null default now()
);
-- At most one current version.
create unique index politicas_una_vigente on public.politicas ((true)) where vigente;
insert into public.politicas (version) values ('2026-10-14-borrador');
alter table public.politicas enable row level security;
revoke all on public.politicas from public, anon, authenticated;

create table public.consentimientos (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  policy_version text not null references public.politicas (version),
  finalidad      text not null default 'prestacion_servicio',
  aceptado_at    timestamptz not null default now(),
  unique (user_id, policy_version)
);
alter table public.consentimientos enable row level security;
revoke all on public.consentimientos from public, anon, authenticated;
grant select on public.consentimientos to authenticated;
create policy "consentimientos read own" on public.consentimientos for select using (user_id = auth.uid());

-- The old signatures would let a caller skip the consent: drop them, do not overload.
drop function public.provision_negocio(text, text, text, text);
drop function public.redeem_invite(text);

create function public.provision_negocio(
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

-- Same body as S3 plus the consent: the record exists exactly when the profile does. A refused
-- version raises before anything is counted; a wrong code still returns {ok:false} and stores nothing.
create function public.redeem_invite(p_codigo text, p_politica text) returns jsonb
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

  insert into public.profiles (id, negocio_id, rol) values (v_uid, inv.negocio_id, inv.rol);
  insert into public.consentimientos (user_id, policy_version) values (v_uid, p_politica)
    on conflict (user_id, policy_version) do nothing;
  update public.invitaciones set estado = 'aceptada', usado_por = v_uid, usado_at = now() where id = inv.id;
  return jsonb_build_object('ok', true, 'negocio_id', inv.negocio_id, 'rol', inv.rol);
end;
$$;

revoke execute on function public.provision_negocio(text, text, text, text, text), public.redeem_invite(text, text) from public, anon;
grant execute on function public.provision_negocio(text, text, text, text, text), public.redeem_invite(text, text) to authenticated;
