-- Business legal identity, mandatory and minimised.
-- 1. Ley 1480 de 2011, art. 53: the contact portal "deberá exigir" the provider's identity. reservar and
--    comprar_producto now refuse a client whose business has no negocio_identidad row
--    (negocio_sin_identidad), checked right after the acceptance checks. Bodies are the
--    20261022110001_politicas_negocio.sql ones plus that check.
-- 2. Ley 1581 de 2012, art. 4 (necessity): an independent walker registers a personal ID. The table is now
--    read only by the owner and the office staff of the business; every member (walkers and clients too)
--    reads it through negocio_identidad_publica(), where a CC/CE/PAS shows only its last 4 digits and a NIT
--    shows in full.

-- ---- 1. reservar / comprar_producto ----------------------------------------------------------------------
create or replace function public.reservar(p_perro uuid, p_servicio uuid, p_grupo uuid, p_fecha date)
  returns uuid language plpgsql security definer set search_path = '' as
$$
declare
  v_neg  uuid := public.my_negocio();
  v_hoy  date := (now() at time zone 'America/Bogota')::date;
  v_tipo text; v_gserv uuid; v_cuid uuid; v_hora text; v_id uuid;
begin
  if auth.uid() is null or v_neg is null or not public.owns_dog(p_perro) then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if public.my_rol() = 'cliente' and not public.aceptado('aviso_rol') then raise exception 'aviso_rol_pendiente'; end if;
  if public.my_rol() = 'cliente' and public.politica_negocio_vigente(v_neg) is not null and not public.aceptado('politica_negocio') then
    raise exception 'politica_negocio_pendiente';
  end if;
  if not exists (select 1 from public.negocio_identidad where negocio_id = v_neg) then raise exception 'negocio_sin_identidad'; end if;
  if not exists (select 1 from public.perros where id = p_perro and negocio_id = v_neg and coalesce(activo, true)) then
    raise exception 'perro_invalido';
  end if;
  select tipo into v_tipo from public.servicios
    where id = p_servicio and negocio_id = v_neg and coalesce(activo, true) and tipo not in ('comida', 'accesorio');
  if not found then raise exception 'servicio_invalido'; end if;
  if p_grupo is not null then
    select servicio_id, cuidador_id, hora into v_gserv, v_cuid, v_hora from public.grupos
      where id = p_grupo and negocio_id = v_neg and coalesce(activo, true);
    if not found or v_gserv is distinct from p_servicio then raise exception 'grupo_invalido'; end if;
  end if;
  if p_fecha is null or p_fecha < v_hoy or p_fecha > v_hoy + 365 then raise exception 'fecha_invalida'; end if;

  insert into public.prestaciones (negocio_id, perro_id, servicio_id, grupo_id, tipo, cuidador_id, fecha, estado, detalle)
    values (v_neg, p_perro, p_servicio, p_grupo, v_tipo, v_cuid, p_fecha, 'programado',
            case when p_grupo is null then '{}'::jsonb else jsonb_build_object('hora', v_hora) end)
    returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.comprar_producto(p_perro uuid, p_servicio uuid, p_cantidad integer)
  returns uuid language plpgsql security definer set search_path = '' as
$$
declare
  v_neg  uuid := public.my_negocio();
  v_tipo text; v_id uuid;
begin
  if auth.uid() is null or v_neg is null or not public.is_principal(p_perro) then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if public.my_rol() = 'cliente' and not public.aceptado('aviso_rol') then raise exception 'aviso_rol_pendiente'; end if;
  if public.my_rol() = 'cliente' and public.politica_negocio_vigente(v_neg) is not null and not public.aceptado('politica_negocio') then
    raise exception 'politica_negocio_pendiente';
  end if;
  if not exists (select 1 from public.negocio_identidad where negocio_id = v_neg) then raise exception 'negocio_sin_identidad'; end if;
  if not exists (select 1 from public.perros where id = p_perro and negocio_id = v_neg and coalesce(activo, true)) then
    raise exception 'perro_invalido';
  end if;
  if p_cantidad is null or p_cantidad not between 1 and 20 then raise exception 'cantidad_invalida'; end if;
  select tipo into v_tipo from public.servicios
    where id = p_servicio and negocio_id = v_neg and coalesce(activo, true) and tipo in ('comida', 'accesorio');
  if not found then raise exception 'servicio_invalido'; end if;

  insert into public.prestaciones (negocio_id, perro_id, servicio_id, tipo, fecha, estado, detalle)
    values (v_neg, p_perro, p_servicio, v_tipo, (now() at time zone 'America/Bogota')::date, 'finalizado',
            jsonb_build_object('cantidad', p_cantidad))
    returning id into v_id;
  return v_id;
end;
$$;

-- ---- 2. who reads the identity ---------------------------------------------------------------------------
drop policy "negocio_identidad read members" on public.negocio_identidad;
create policy "negocio_identidad read office" on public.negocio_identidad
  for select using (negocio_id = public.my_negocio() and (public.is_owner() or public.is_office()));

-- The caller's business identity (0 or 1 row) for any member of it. A personal ID (CC, CE, PAS) keeps only
-- its last 4 digits behind a fixed mask, so its length does not show either.
create function public.negocio_identidad_publica()
  returns table (razon_social text, doc_tipo text, doc_numero text, direccion text, telefono text, correo text)
  language sql stable security definer set search_path = '' as
$$
  select n.razon_social, n.doc_tipo,
         case when n.doc_tipo = 'NIT' then n.doc_numero
              else '••••••' || right(regexp_replace(n.doc_numero, '[^0-9]', '', 'g'), 4) end,
         n.direccion, n.telefono, n.correo
    from public.negocio_identidad n
   where auth.uid() is not null and n.negocio_id = public.my_negocio();
$$;
revoke execute on function public.negocio_identidad_publica() from public, anon;
grant execute on function public.negocio_identidad_publica() to authenticated;
