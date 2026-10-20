-- Structural inverse of S7 (20261014100001_s7_consent.sql): restores the previous signatures of
-- provision_negocio (S4b body) and redeem_invite (S3 body) and drops the versioned ones.
-- `politicas` and `consentimientos` are KEPT: they are evidence of what users accepted and must
-- not be lost by a rollback. Without the S7 functions the database stops writing consent records,
-- and the app of this slice (which sends p_politica) must be reverted with it. Never reopens a
-- policy, grant or default. Pre-launch the authoritative rollback is `git revert` plus
-- `node supabase/staging.mjs reset` (see supabase/README.md).

drop function public.provision_negocio(text, text, text, text, text);
drop function public.redeem_invite(text, text);

create function public.provision_negocio(
  p_rol text, p_nombre text, p_negocio text default null, p_telefono text default null
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
  return v_id;
end;
$$;

create function public.redeem_invite(p_codigo text) returns jsonb
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
  update public.invitaciones set estado = 'aceptada', usado_por = v_uid, usado_at = now() where id = inv.id;
  return jsonb_build_object('ok', true, 'negocio_id', inv.negocio_id, 'rol', inv.rol);
end;
$$;

revoke execute on function public.provision_negocio(text, text, text, text), public.redeem_invite(text) from public, anon;
grant execute on function public.provision_negocio(text, text, text, text), public.redeem_invite(text) to authenticated;
