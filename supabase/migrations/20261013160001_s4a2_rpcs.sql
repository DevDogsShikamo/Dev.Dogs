-- S4a2 / A: the RPCs that write the S4a1 side tables, plus walks_dog and the widened cobro_marcar.
-- Additive: no legacy column, policy or table changes. While the app still reads the old columns
-- the RPCs write BOTH stores (the sync triggers in migration B cover every other legacy writer).

-- The caller is the assignee of a walk from yesterday onward, or of a group the dog belongs to.
-- Used by the S4b dog policy; unauthenticated or profile-less callers get false.
create or replace function public.walks_dog(pid uuid) returns boolean
  language sql stable security definer set search_path = '' as
$$ select coalesce(
     exists(select 1 from public.prestaciones p
            where p.perro_id = pid and p.cuidador_id = auth.uid() and p.negocio_id = public.my_negocio()
              and p.fecha >= (now() at time zone 'America/Bogota')::date - 1)
     or exists(select 1 from public.grupo_membresias m join public.grupos g on g.id = m.grupo_id
            where m.perro_id = pid and g.cuidador_id = auth.uid() and g.negocio_id = public.my_negocio()
              and coalesce(m.activo, true) and coalesce(g.activo, true)), false) $$;

-- A profile sets its own phone. contactos.rol / negocio_id are copied from the profile here, never
-- from the caller. ponytail: also writes profiles.telefono until S4b drops the column.
create or replace function public.contacto_set(p_telefono text) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_tel text := nullif(trim(coalesce(p_telefono, '')), '');
  r record;
begin
  select negocio_id, rol into r from public.profiles where id = auth.uid();
  if auth.uid() is null or not found or r.negocio_id is null then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if v_tel is not null and v_tel !~ '^[0-9+()\s-]{6,32}$' then raise exception 'telefono_invalido'; end if;
  update public.profiles set telefono = v_tel where id = auth.uid();
  insert into public.contactos (user_id, negocio_id, rol, telefono) values (auth.uid(), r.negocio_id, r.rol, v_tel)
    on conflict (user_id) do update set telefono = excluded.telefono;
end;
$$;

-- Only the tenant owner grants or revokes the finance flag, only on an office member (rol
-- 'empresa') of the same tenant other than itself. The flag never opens nomina.
create or replace function public.permiso_finanzas_set(p_user uuid, p_on boolean) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_neg uuid := public.my_negocio();
begin
  if auth.uid() is null or v_neg is null or not public.is_owner() then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if p_on is null then raise exception 'valor_invalido'; end if;
  if p_user is null or p_user = auth.uid()
     or not exists (select 1 from public.profiles where id = p_user and negocio_id = v_neg and rol = 'empresa') then
    raise exception 'destino_invalido';
  end if;
  insert into public.permisos (user_id, negocio_id, finanzas, otorgado_por, updated_at)
    values (p_user, v_neg, p_on, auth.uid(), now())
    on conflict (user_id) do update set finanzas = excluded.finanzas, otorgado_por = excluded.otorgado_por, updated_at = excluded.updated_at;
end;
$$;

-- Owner-only catalogue write (same fields as the app's servicioFields). A monthly service keeps its
-- price in precio_mensual. Prices reach tarifas through the sync trigger of migration B.
-- p_id null creates; an id of another tenant is the same 42501 as an unknown one.
create or replace function public.servicio_guardar(
  p_id uuid, p_nombre text, p_tipo text, p_duracion integer, p_precio integer, p_modelo text
) returns uuid
  language plpgsql security definer set search_path = '' as
$$
declare
  v_neg uuid := public.my_negocio();
  v_nombre text := trim(coalesce(p_nombre, ''));
  v_mensual boolean := p_modelo = 'mensual';
  v_id uuid;
begin
  if auth.uid() is null or v_neg is null or not public.is_owner() then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if p_id is not null and not exists (select 1 from public.servicios where id = p_id and negocio_id = v_neg) then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if v_nombre = '' or length(v_nombre) > 120 then raise exception 'nombre_invalido'; end if;
  if p_modelo is null or p_modelo not in ('por_uso', 'mensual') then raise exception 'modelo_invalido'; end if;
  if p_precio is null or p_precio < 0 or p_duracion is null or p_duracion < 0 then raise exception 'precio_invalido'; end if;
  if p_id is null then
    insert into public.servicios (negocio_id, activo, nombre, tipo, duracion_min, modelo_cobro, precio, precio_mensual)
      values (v_neg, true, v_nombre, p_tipo, p_duracion, p_modelo, case when v_mensual then 0 else p_precio end, case when v_mensual then p_precio else 0 end)
      returning id into v_id;
  else
    update public.servicios set nombre = v_nombre, tipo = p_tipo, duracion_min = p_duracion, modelo_cobro = p_modelo,
        precio = case when v_mensual then 0 else p_precio end, precio_mensual = case when v_mensual then p_precio else 0 end
      where id = p_id returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Billing label: the principal owner's display name per dog of the caller's tenant. No owner id,
-- no contact data. Only owner / office (assert_gestor).
create or replace function public.perro_duenos_nombres() returns table(perro_id uuid, nombre text)
  language plpgsql stable security definer set search_path = '' as
$$
#variable_conflict use_column
begin
  perform public.assert_gestor(public.my_negocio());
  return query
    select pd.perro_id, pr.nombre
    from public.perro_duenos pd
    join public.perros pe on pe.id = pd.perro_id and pe.negocio_id = public.my_negocio()
    join public.profiles pr on pr.id = pd.dueno_id
    where pd.rol = 'principal' and pd.estado = 'activo';
end;
$$;

-- cobro_marcar widened: the owner or an office member holding the finance flag. Same signature;
-- who and when are server-set; both stores are written so nothing diverges before S4b.
create or replace function public.cobro_marcar(p_prestacion uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  r record;
begin
  if auth.uid() is null then raise exception 'no_autorizado' using errcode = '42501'; end if;
  select id, negocio_id, estado, cobrable, cobrado into r from public.prestaciones where id = p_prestacion for update;
  if not found or r.negocio_id is distinct from public.my_negocio() or not (public.is_owner() or public.has_finanzas()) then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if r.cobrado then return; end if;
  if r.estado <> 'finalizado' or r.cobrable is distinct from true then raise exception 'no_cobrable'; end if;
  update public.prestaciones set cobrado = true, confirmado_por = auth.uid(), confirmado_at = now() where id = r.id;
  update public.cobros set cobrado = true, confirmado_por = auth.uid(), confirmado_at = now() where prestacion_id = r.id;
end;
$$;

revoke execute on function public.walks_dog(uuid), public.contacto_set(text), public.permiso_finanzas_set(uuid, boolean),
  public.servicio_guardar(uuid, text, text, integer, integer, text), public.perro_duenos_nombres(), public.cobro_marcar(uuid)
  from public, anon;
grant execute on function public.walks_dog(uuid), public.contacto_set(text), public.permiso_finanzas_set(uuid, boolean),
  public.servicio_guardar(uuid, text, text, integer, integer, text), public.perro_duenos_nombres(), public.cobro_marcar(uuid)
  to authenticated;
