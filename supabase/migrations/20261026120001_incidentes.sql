-- Incidents (Ley 2480 de 2025 arts. 15 and 16) and photo reports (Ley 1581 art. 7).
--   * incidentes: the assigned walker reports on his own walk of today or yesterday (Bogota), the owner or office
--     of the dog's business on any dog of it. Read by the business owner and office, the active owners of the dog
--     and the reporter; written only through incidente_reportar.
--   * evidence: reporting on a walk sets paseo_fotos.retener on the ready, unexpired photos of that walk where the
--     dog is tagged. A retained row survives the 30-day purge and stays visible to the same audience as before
--     (the uploader and the dog owners, never the business). The Worker copies its R2 object from f/ to r/ (the
--     bucket lifecycle rule only expires f/) with the keys of foto_retencion_autorizar.
--     ponytail: photos uploaded after the report are not retained; report again to include them.
--   * fotos_reportes: an active owner of a tagged dog reports a photo (a person or a minor in it, or other).
--     A photo that is not evidence is deleted with its tags; a retained one becomes paseo_fotos.oculta: hidden
--     from clients and the uploader, kept for the business owner and office. The report row is kept.

alter table public.paseo_fotos
  add column retener boolean not null default false,
  add column oculta  boolean not null default false;

create table public.incidentes (
  id            uuid primary key default gen_random_uuid(),
  negocio_id    uuid not null references public.negocios(id) on delete cascade,
  perro_id      uuid not null references public.perros(id) on delete cascade,
  prestacion_id uuid references public.prestaciones(id) on delete set null,
  tipo          text not null check (tipo in ('perdida', 'lesion', 'salud', 'pelea', 'fallecimiento', 'otro')),
  descripcion   text not null check (char_length(descripcion) between 10 and 2000),
  reportado_por uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index on public.incidentes (negocio_id, created_at desc);
create index on public.incidentes (perro_id);
create index on public.incidentes (prestacion_id);

-- No foreign key on foto_id: the report outlives the photo it deleted.
create table public.fotos_reportes (
  id            uuid primary key default gen_random_uuid(),
  foto_id       uuid not null,
  negocio_id    uuid not null references public.negocios(id) on delete cascade,
  reportado_por uuid references public.profiles(id) on delete set null,
  motivo        text not null check (motivo in ('aparece_persona', 'aparece_menor', 'otro')),
  created_at    timestamptz not null default now()
);
create index on public.fotos_reportes (foto_id);
create index on public.fotos_reportes (negocio_id, created_at desc);

alter table public.incidentes     enable row level security;
alter table public.fotos_reportes enable row level security;
revoke all on public.incidentes, public.fotos_reportes from public, anon, authenticated;
grant select on public.incidentes, public.fotos_reportes to authenticated;

create policy "incidentes read" on public.incidentes for select to authenticated
  using ((negocio_id = public.my_negocio() and (public.is_owner() or public.is_office()))
         or public.owns_dog(perro_id) or reportado_por = auth.uid());
create policy "fotos reportes read" on public.fotos_reportes for select to authenticated
  using (reportado_por = auth.uid() or (negocio_id = public.my_negocio() and (public.is_owner() or public.is_office())));

-- Who sees a photo. Not hidden: the uploader and, once uploaded, the active owners of a tagged dog, while it is
-- unexpired or retained. Hidden (reported evidence): the owner and office of its business only.
create or replace function public.can_see_foto(p_id uuid) returns boolean
  language sql stable security definer set search_path = '' as
$$ select coalesce(exists(
     select 1 from public.paseo_fotos f
     where f.id = p_id
       and ((not f.oculta and (f.expires_at > now() or f.retener)
             and (f.subido_por = auth.uid()
                  or (f.estado = 'lista' and exists(
                        select 1 from public.paseo_foto_perros t where t.foto_id = f.id and public.owns_dog(t.perro_id)))))
            or (f.oculta and f.negocio_id = public.my_negocio() and (public.is_owner() or public.is_office())))
   ), false) $$;

-- Same body as 20261014110001_s5a_photos.sql; the purge keeps retained rows.
create or replace function public.foto_registrar(p_prestaciones uuid[]) returns uuid
  language plpgsql security definer set search_path = '' as
$$
declare
  v_hoy  date := (now() at time zone 'America/Bogota')::date;
  v_neg  uuid := public.my_negocio();
  v_ids  uuid[];
  v_foto uuid;
  r record;
begin
  if auth.uid() is null then raise exception 'no_autorizado' using errcode = '42501'; end if;
  if p_prestaciones is null or cardinality(p_prestaciones) not between 1 and 12
     or array_position(p_prestaciones, null) is not null then
    raise exception 'ids_invalidos';
  end if;
  select array_agg(distinct x) into v_ids from unnest(p_prestaciones) x;
  if (select count(*) from public.prestaciones
      where id = any(v_ids) and cuidador_id = auth.uid() and negocio_id = v_neg) <> cardinality(v_ids) then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;

  delete from public.paseo_fotos
    where (expires_at <= now() and not retener) or (estado = 'pendiente' and created_at < now() - interval '1 day');

  for r in select id, estado, fecha from public.prestaciones where id = any(v_ids) order by id for update loop
    if r.estado not in ('en_curso', 'finalizado') then raise exception 'estado_invalido'; end if;
    if r.fecha is null or r.fecha not between v_hoy - 1 and v_hoy then raise exception 'fuera_de_ventana'; end if;
    if (select count(*) from public.paseo_foto_perros where prestacion_id = r.id) >= 10 then
      raise exception 'demasiadas_fotos';
    end if;
  end loop;

  insert into public.paseo_fotos (negocio_id, subido_por) values (v_neg, auth.uid()) returning id into v_foto;
  insert into public.paseo_foto_perros (foto_id, prestacion_id, perro_id, subido_por)
    select v_foto, id, perro_id, auth.uid() from public.prestaciones where id = any(v_ids);
  return v_foto;
end;
$$;

create or replace function public.fotos_purgar_vencidas() returns integer
  language sql security definer set search_path = '' as
$$
  with borradas as (
    delete from public.paseo_fotos
     where (expires_at <= now() and not retener) or (estado = 'pendiente' and created_at < now() - interval '1 day')
    returning 1)
  select count(*)::integer from borradas
$$;
revoke execute on function public.fotos_purgar_vencidas() from public, anon, authenticated;

-- Reports an incident and retains the photos of that walk where the dog is tagged. Unknown dog, no session or
-- a caller outside the audience: 42501. A bad type, text or walk: incidente_invalido. Returns the incident id.
create function public.incidente_reportar(p_perro uuid, p_prestacion uuid, p_tipo text, p_descripcion text) returns uuid
  language plpgsql security definer set search_path = '' as
$$
declare
  v_hoy   date := (now() at time zone 'America/Bogota')::date;
  v_neg   uuid;
  v_texto text := btrim(p_descripcion);
  v_id    uuid;
begin
  select negocio_id into v_neg from public.perros where id = p_perro;
  if auth.uid() is null or v_neg is null then raise exception 'no_autorizado' using errcode = '42501'; end if;
  if coalesce(v_neg = public.my_negocio() and (public.is_owner() or public.is_office()), false) then
    if p_prestacion is not null and not exists(
         select 1 from public.prestaciones where id = p_prestacion and perro_id = p_perro and negocio_id = v_neg) then
      raise exception 'incidente_invalido';
    end if;
  elsif not coalesce(exists(
         select 1 from public.prestaciones
          where id = p_prestacion and perro_id = p_perro and negocio_id = v_neg and negocio_id = public.my_negocio()
            and cuidador_id = auth.uid() and fecha between v_hoy - 1 and v_hoy), false) then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('perdida', 'lesion', 'salud', 'pelea', 'fallecimiento', 'otro')
     or v_texto is null or char_length(v_texto) not between 10 and 2000 then
    raise exception 'incidente_invalido';
  end if;

  insert into public.incidentes (negocio_id, perro_id, prestacion_id, tipo, descripcion, reportado_por)
    values (v_neg, p_perro, p_prestacion, p_tipo, v_texto, auth.uid()) returning id into v_id;
  if p_prestacion is not null then
    update public.paseo_fotos f set retener = true
     where f.estado = 'lista' and f.expires_at > now() and exists(
       select 1 from public.paseo_foto_perros t where t.foto_id = f.id and t.prestacion_id = p_prestacion and t.perro_id = p_perro);
  end if;
  return v_id;
end;
$$;

-- Called by the Worker with the caller's token: the R2 keys (f/...) of the retained photos of an incident, for
-- its reporter or the owner and office of its business. An unknown incident is the same refusal (42501).
create function public.foto_retencion_autorizar(p_incidente uuid) returns text[]
  language plpgsql stable security definer set search_path = '' as
$$
declare
  i record;
begin
  select perro_id, prestacion_id into i from public.incidentes
   where id = p_incidente
     and (reportado_por = auth.uid() or coalesce(negocio_id = public.my_negocio() and (public.is_owner() or public.is_office()), false));
  if auth.uid() is null or not found then raise exception 'no_autorizado' using errcode = '42501'; end if;
  return coalesce((
    select array_agg('f/' || f.negocio_id || '/' || f.id || '.jpg' order by f.id) from public.paseo_fotos f
     where f.retener and f.estado = 'lista' and exists(
       select 1 from public.paseo_foto_perros t where t.foto_id = f.id and t.prestacion_id = i.prestacion_id and t.perro_id = i.perro_id)
  ), '{}');
end;
$$;

-- An active owner of a tagged dog reports a visible photo. Not evidence: deleted (tags by cascade). Retained:
-- hidden (oculta). A stranger, an unknown or already hidden photo: 42501. A bad reason: reporte_invalido.
create function public.foto_reportar(p_foto uuid, p_motivo text) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  f record;
begin
  if auth.uid() is null then raise exception 'no_autorizado' using errcode = '42501'; end if;
  select p.id, p.negocio_id, p.retener into f from public.paseo_fotos p
   where p.id = p_foto and not p.oculta and p.estado = 'lista' and (p.expires_at > now() or p.retener)
     and exists(select 1 from public.paseo_foto_perros t where t.foto_id = p.id and public.owns_dog(t.perro_id))
   for update;
  if not found then raise exception 'no_autorizado' using errcode = '42501'; end if;
  if p_motivo is null or p_motivo not in ('aparece_persona', 'aparece_menor', 'otro') then
    raise exception 'reporte_invalido';
  end if;

  insert into public.fotos_reportes (foto_id, negocio_id, reportado_por, motivo) values (f.id, f.negocio_id, auth.uid(), p_motivo);
  if f.retener then
    update public.paseo_fotos set oculta = true where id = f.id;
  else
    delete from public.paseo_fotos where id = f.id;
  end if;
end;
$$;

revoke execute on function public.incidente_reportar(uuid, uuid, text, text), public.foto_retencion_autorizar(uuid),
  public.foto_reportar(uuid, text) from public, anon;
grant execute on function public.incidente_reportar(uuid, uuid, text, text), public.foto_retencion_autorizar(uuid),
  public.foto_reportar(uuid, text) to authenticated;
