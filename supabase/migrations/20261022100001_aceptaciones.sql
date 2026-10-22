-- Role notice and business terms. DevDogs is the software each business uses; the business is the only
-- provider and answers for the dogs. Two acceptances are recorded on the server, per user and business:
--   aviso_rol         a client acknowledges that DevDogs does not pick up, transport, walk, care for or
--                     answer for the dog: the business does (Ley 1480 art. 48 proof, like `consentimientos`)
--   terminos_negocio  the owner of a business (company or independent walker) accepts the B2B terms
--   politica_negocio  reserved for each business's own policies (a later slice; no version yet)
-- The app asks aceptacion_pendiente() after login and keeps the portals closed until aceptacion_registrar()
-- records the current version; reservar and comprar_producto refuse a client without the current notice.
-- Rows are readable by their owner only and never writable through the API; the timestamp is now().

create table public.aceptaciones (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  tipo        text not null check (tipo in ('aviso_rol', 'terminos_negocio', 'politica_negocio')),
  negocio_id  uuid not null references public.negocios (id) on delete cascade,
  version     text not null check (length(version) between 1 and 60),
  aceptado_at timestamptz not null default now(),
  unique (user_id, tipo, negocio_id, version)
);
alter table public.aceptaciones enable row level security;
revoke all on public.aceptaciones from public, anon, authenticated;
grant select on public.aceptaciones to authenticated;
create policy "aceptaciones read own" on public.aceptaciones for select using (user_id = auth.uid());

-- The current version of each document, in one place; src/lib/politica.js mirrors it
-- (AVISO_ROL_VERSION, TERMINOS_NEGOCIO_VERSION; tests/security/aceptaciones.test.mjs fails if they drift).
-- Null for a tipo with no version yet (politica_negocio), which nothing can then accept.
create function public.version_vigente(p_tipo text) returns text
  language sql immutable set search_path = '' as
$$
  select case p_tipo when 'aviso_rol' then '2026-10-22-borrador' when 'terminos_negocio' then '2026-10-22-borrador' end;
$$;

-- Whether the caller accepted the current version of p_tipo for its current business.
create function public.aceptado(p_tipo text) returns boolean
  language sql stable security definer set search_path = '' as
$$
  select exists (select 1 from public.aceptaciones a
                  where a.user_id = auth.uid() and a.tipo = p_tipo and a.negocio_id = public.my_negocio()
                    and a.version = public.version_vigente(p_tipo));
$$;

-- The first pending item of the caller, or null: the owner of a business without the current business
-- terms, then a client without the current role notice for its business. Office staff and company walkers
-- have nothing pending here.
create function public.aceptacion_pendiente() returns jsonb
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
create function public.aceptacion_registrar(p_tipo text, p_version text) returns void
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

revoke execute on function public.aceptado(text) from public, anon, authenticated;
revoke execute on function public.version_vigente(text), public.aceptacion_pendiente(), public.aceptacion_registrar(text, text) from public, anon;
grant execute on function public.version_vigente(text), public.aceptacion_pendiente(), public.aceptacion_registrar(text, text) to authenticated;

-- ---- reservar / comprar_producto: the 20261013130001_s2b2_pricing.sql bodies (still the live ones) plus
-- the role notice check right after the authorization check.
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
