-- Each business publishes its own service policies (how it handles pick-up, cancellations, payments, the
-- requirements for the dog, what it answers for, ...) and its clients accept each version in the app, like
-- they accept the role notice (aceptaciones tipo politica_negocio, version = the policy version as text).
-- The policies are the business's own text: DevDogs does not review or endorse them (Términos para
-- negocios, section 3). A business without a policy blocks nobody; once it publishes one, reservar and
-- comprar_producto refuse its clients until they accept the current version (politica_negocio_pendiente).
-- Versions are never edited: publishing inserts version n+1 and leaves the previous rows as history.
-- The Términos para negocios now say clients accept each new version: version_vigente() moves to
-- 2026-10-22b-borrador (TERMINOS_NEGOCIO_VERSION in src/lib/politica.js).

create table public.negocio_politicas (
  id            uuid primary key default gen_random_uuid(),
  negocio_id    uuid not null references public.negocios (id) on delete cascade,
  version       integer not null check (version >= 1),
  secciones     jsonb not null check (jsonb_typeof(secciones) = 'array'),
  publicada_at  timestamptz not null default now(),
  publicada_por uuid references auth.users (id) on delete set null,
  vigente       boolean not null default true,
  unique (negocio_id, version)
);
create unique index negocio_politicas_una_vigente on public.negocio_politicas (negocio_id) where vigente;
alter table public.negocio_politicas enable row level security;
revoke all on public.negocio_politicas from public, anon, authenticated;
grant select on public.negocio_politicas to authenticated;
create policy "negocio_politicas read members" on public.negocio_politicas
  for select using (negocio_id = public.my_negocio());

-- The current policy version of a business as text, or null when it has published none. Internal: the
-- definer functions below call it with the caller's own business.
create function public.politica_negocio_vigente(p_negocio uuid) returns text
  language sql stable set search_path = '' as
$$
  select version::text from public.negocio_politicas where negocio_id = p_negocio and vigente;
$$;
revoke execute on function public.politica_negocio_vigente(uuid) from public, anon, authenticated;

-- Publishes a new version of the caller's business policies and returns its number. Owner only (else 42501).
-- p_secciones is a JSON array of {clave, titulo, texto}: each clave at most once and from the fixed list,
-- titulo 1-80 characters, texto up to 4000 and 30000 in total; requisitos and responsabilidad are required
-- and not empty (what Ley 2480 de 2025 arts. 11 and 14 ask the service contract to settle). Anything else
-- raises politica_invalida and stores nothing. Titles and texts are stored trimmed, other keys are dropped.
create function public.negocio_politica_publicar(p_secciones jsonb) returns integer
  language plpgsql security definer set search_path = '' as
$$
declare
  v_neg uuid := public.my_negocio();
  v_ver integer;
  v_sec jsonb;
begin
  if auth.uid() is null or v_neg is null or not public.is_owner() then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if p_secciones is null or jsonb_typeof(p_secciones) <> 'array' or jsonb_array_length(p_secciones) = 0
     or exists (select 1 from jsonb_array_elements(p_secciones) e
                 where jsonb_typeof(e) <> 'object'
                    or jsonb_typeof(e -> 'clave') is distinct from 'string'
                    or jsonb_typeof(e -> 'titulo') is distinct from 'string'
                    or jsonb_typeof(e -> 'texto') is distinct from 'string') then
    raise exception 'politica_invalida' using errcode = '22023';
  end if;
  select jsonb_agg(jsonb_build_object('clave', e ->> 'clave', 'titulo', btrim(e ->> 'titulo'), 'texto', btrim(e ->> 'texto')) order by o)
    into v_sec from jsonb_array_elements(p_secciones) with ordinality s (e, o);
  if exists (select 1 from jsonb_array_elements(v_sec) e
              where not (e ->> 'clave' = any (array['servicios', 'recogida', 'cancelaciones', 'pagos', 'requisitos',
                                                    'responsabilidad', 'fotos', 'retracto', 'otras']))
                 or char_length(e ->> 'titulo') not between 1 and 80
                 or char_length(e ->> 'texto') > 4000)
     or (select count(distinct e ->> 'clave') from jsonb_array_elements(v_sec) e) <> jsonb_array_length(v_sec)
     or (select sum(char_length(e ->> 'texto')) from jsonb_array_elements(v_sec) e) > 30000
     or (select count(*) from jsonb_array_elements(v_sec) e
          where e ->> 'clave' in ('requisitos', 'responsabilidad') and e ->> 'texto' <> '') <> 2 then
    raise exception 'politica_invalida' using errcode = '22023';
  end if;

  -- One publication at a time per business, so two of them never take the same number.
  perform 1 from public.negocios where id = v_neg for update;
  select coalesce(max(version), 0) + 1 into v_ver from public.negocio_politicas where negocio_id = v_neg;
  update public.negocio_politicas set vigente = false where negocio_id = v_neg and vigente;
  insert into public.negocio_politicas (negocio_id, version, secciones, publicada_por)
    values (v_neg, v_ver, v_sec, auth.uid());
  return v_ver;
end;
$$;
revoke execute on function public.negocio_politica_publicar(jsonb) from public, anon;
grant execute on function public.negocio_politica_publicar(jsonb) to authenticated;

-- ---- acceptances: the 20261022100001_aceptaciones.sql functions, now aware of politica_negocio ----
create or replace function public.version_vigente(p_tipo text) returns text
  language sql immutable set search_path = '' as
$$
  select case p_tipo when 'aviso_rol' then '2026-10-22-borrador' when 'terminos_negocio' then '2026-10-22b-borrador' end;
$$;

-- politica_negocio counts only for the current policy version of the caller's business.
create or replace function public.aceptado(p_tipo text) returns boolean
  language sql stable security definer set search_path = '' as
$$
  select exists (select 1 from public.aceptaciones a
                  where a.user_id = auth.uid() and a.tipo = p_tipo and a.negocio_id = public.my_negocio()
                    and a.version = case when p_tipo = 'politica_negocio' then public.politica_negocio_vigente(public.my_negocio())
                                         else public.version_vigente(p_tipo) end);
$$;

-- A client gets the role notice first, then the current policy of its business (only when there is one).
create or replace function public.aceptacion_pendiente() returns jsonb
  language sql stable security definer set search_path = '' as
$$
  select jsonb_build_object('tipo', t.tipo, 'version', t.version, 'negocio_id', n.id, 'negocio_nombre', n.nombre)
    from (values (1, 'terminos_negocio', public.is_owner(), public.version_vigente('terminos_negocio')),
                 (2, 'aviso_rol', coalesce(public.my_rol() = 'cliente', false), public.version_vigente('aviso_rol')),
                 (3, 'politica_negocio', coalesce(public.my_rol() = 'cliente', false), public.politica_negocio_vigente(public.my_negocio())))
         t (orden, tipo, aplica, version)
    join public.negocios n on n.id = public.my_negocio()
   where auth.uid() is not null and t.aplica and t.version is not null and not public.aceptado(t.tipo)
   order by t.orden
   limit 1;
$$;

-- A client also accepts politica_negocio, only the current version of its business (version_invalida
-- otherwise, including when the business has no policy).
create or replace function public.aceptacion_registrar(p_tipo text, p_version text) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_uid uuid := auth.uid();
  v_neg uuid := public.my_negocio();
  v_req text;
begin
  if v_uid is null or v_neg is null
     or not coalesce((p_tipo = 'terminos_negocio' and public.is_owner())
                     or (p_tipo in ('aviso_rol', 'politica_negocio') and public.my_rol() = 'cliente'), false) then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  v_req := case when p_tipo = 'politica_negocio' then public.politica_negocio_vigente(v_neg) else public.version_vigente(p_tipo) end;
  if p_version is null or v_req is null or p_version is distinct from v_req then
    raise exception 'version_invalida';
  end if;
  insert into public.aceptaciones (user_id, tipo, negocio_id, version) values (v_uid, p_tipo, v_neg, p_version)
    on conflict (user_id, tipo, negocio_id, version) do nothing;
end;
$$;

-- ---- reservar / comprar_producto: the 20261022100001_aceptaciones.sql bodies plus the business policy
-- check right after the role notice check.
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
