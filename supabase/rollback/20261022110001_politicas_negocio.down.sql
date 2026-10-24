-- Structural inverse of 20261022110001_politicas_negocio.sql: reservar and comprar_producto get back their
-- 20261022100001_aceptaciones.sql bodies (no business policy check), the acceptance functions their versions
-- of that migration (politica_negocio no longer pending nor acceptable, terminos_negocio back to
-- 2026-10-22-borrador), then the publishing functions and the table go. The published policies are what
-- clients accepted: export negocio_politicas first; the aceptaciones rows of tipo politica_negocio stay as
-- evidence. The app of this slice (the policy editor, the politica_negocio gate) must be reverted with it.

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

create or replace function public.version_vigente(p_tipo text) returns text
  language sql immutable set search_path = '' as
$$
  select case p_tipo when 'aviso_rol' then '2026-10-22-borrador' when 'terminos_negocio' then '2026-10-22-borrador' end;
$$;

-- Whether the caller accepted the current version of p_tipo for its current business.
create or replace function public.aceptado(p_tipo text) returns boolean
  language sql stable security definer set search_path = '' as
$$
  select exists (select 1 from public.aceptaciones a
                  where a.user_id = auth.uid() and a.tipo = p_tipo and a.negocio_id = public.my_negocio()
                    and a.version = public.version_vigente(p_tipo));
$$;

-- The first pending item of the caller, or null: the owner of a business without the current business
-- terms, then a client without the current role notice for its business. Office staff and company walkers
-- have nothing pending here.
create or replace function public.aceptacion_pendiente() returns jsonb
  language sql stable security definer set search_path = '' as
$$
  select jsonb_build_object('tipo', t.tipo, 'version', public.version_vigente(t.tipo), 'negocio_id', n.id, 'negocio_nombre', n.nombre)
    from (values (1, 'terminos_negocio', public.is_owner()),
                 (2, 'aviso_rol', coalesce(public.my_rol() = 'cliente', false))) t (orden, tipo, aplica)
    join public.negocios n on n.id = public.my_negocio()
   where auth.uid() is not null and t.aplica and not public.aceptado(t.tipo)
   order by t.orden
   limit 1;
$$;

-- Records the caller's acceptance of the current version of p_tipo for its current business. Only the
-- owner accepts terminos_negocio and only a client accepts aviso_rol (else 42501); any other version raises
-- version_invalida and stores nothing. Accepting twice keeps the first record.
create or replace function public.aceptacion_registrar(p_tipo text, p_version text) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_uid uuid := auth.uid();
  v_neg uuid := public.my_negocio();
begin
  if v_uid is null or v_neg is null
     or not coalesce((p_tipo = 'terminos_negocio' and public.is_owner())
                     or (p_tipo = 'aviso_rol' and public.my_rol() = 'cliente'), false) then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if p_version is null or p_version is distinct from public.version_vigente(p_tipo) then
    raise exception 'version_invalida';
  end if;
  insert into public.aceptaciones (user_id, tipo, negocio_id, version) values (v_uid, p_tipo, v_neg, p_version)
    on conflict (user_id, tipo, negocio_id, version) do nothing;
end;
$$;

drop function public.negocio_politica_publicar(jsonb);
drop function public.politica_negocio_vigente(uuid);
drop table public.negocio_politicas;
