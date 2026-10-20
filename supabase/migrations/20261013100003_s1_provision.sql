-- S1 / C: the only two ways to get a profile.
--   provision_negocio: a signed-in user without a profile creates a tenant
--                      (company or independent walker) and becomes its owner.
--   redeem_invite:     joins a tenant with a legacy invitation code (S3 replaces
--                      the code scheme; the shape of the result stays).
-- Both refuse a caller that already has a profile and never upsert. No national ID
-- or NIT is accepted or stored.

create or replace function public.provision_negocio(
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
  insert into public.profiles (id, negocio_id, rol, nombre, telefono) values (v_uid, v_id, p_rol, v_nombre, v_tel);
  return v_id;
end;
$$;

-- Result type changes from uuid to jsonb, so the function is recreated.
drop function if exists public.redeem_invite(text);
create function public.redeem_invite(p_codigo text) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  v_uid uuid := auth.uid();
  inv   public.invitaciones;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    return jsonb_build_object('ok', false, 'error', 'perfil_existente');
  end if;

  select * into inv from public.invitaciones
    where codigo = p_codigo and estado = 'pendiente' and (expires_at is null or expires_at > now())
    for update;
  if inv.id is null then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;

  insert into public.profiles (id, negocio_id, rol) values (v_uid, inv.negocio_id, inv.rol);
  update public.invitaciones set estado = 'aceptada' where id = inv.id;
  return jsonb_build_object('ok', true, 'negocio_id', inv.negocio_id);
end;
$$;

revoke execute on function public.provision_negocio(text, text, text, text), public.redeem_invite(text) from public, anon;
grant execute on function public.provision_negocio(text, text, text, text), public.redeem_invite(text) to authenticated;
