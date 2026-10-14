-- S5a: walk photos on R2 (additive). Metadata and per-dog tags live here, the bytes live in R2
-- behind the photo Worker, which asks these functions (with the caller's own token) who may do what.
-- Nothing legacy is touched: paseo_agregar_foto, detalle.fotos and the `paseos` bucket stay until S5b.
--   * a photo may carry 1..12 dog tags (one per prestacion); a prestacion holds at most 10 photos
--   * audience: the uploader, and the active owners of a tagged dog once the file is uploaded.
--     The business owner, office, other walkers and other tenants are not in it (D6)
--   * 30 days after registration the row stops being visible, whatever R2 still holds

create table public.paseo_fotos (
  id         uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios(id) on delete cascade,
  subido_por uuid not null references public.profiles(id) on delete cascade,
  estado     text not null default 'pendiente' check (estado in ('pendiente', 'lista')),
  bytes      integer check (bytes between 1 and 2097152),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  check (expires_at <= created_at + interval '30 days'),
  check (estado = 'pendiente' or bytes is not null)
);

create table public.paseo_foto_perros (
  foto_id       uuid not null references public.paseo_fotos(id) on delete cascade,
  prestacion_id uuid not null references public.prestaciones(id) on delete cascade,
  perro_id      uuid not null references public.perros(id) on delete cascade,
  subido_por    uuid not null references public.profiles(id) on delete cascade,
  primary key (foto_id, prestacion_id)
);
create index on public.paseo_foto_perros (prestacion_id);
create index on public.paseo_foto_perros (perro_id);
create index on public.paseo_fotos (expires_at);

-- One definer helper for both policies, so neither table's policy reads the other under RLS (no recursion).
-- NULL-safe: no session or an unknown id is false.
create or replace function public.can_see_foto(p_id uuid) returns boolean
  language sql stable security definer set search_path = '' as
$$ select coalesce(exists(
     select 1 from public.paseo_fotos f
     where f.id = p_id and f.expires_at > now()
       and (f.subido_por = auth.uid()
            or (f.estado = 'lista' and exists(
                  select 1 from public.paseo_foto_perros t where t.foto_id = f.id and public.owns_dog(t.perro_id))))
   ), false) $$;

alter table public.paseo_fotos       enable row level security;
alter table public.paseo_foto_perros enable row level security;
revoke all on public.paseo_fotos, public.paseo_foto_perros from public, anon, authenticated;
grant select on public.paseo_fotos, public.paseo_foto_perros to authenticated;

create policy "fotos read" on public.paseo_fotos for select to authenticated using (public.can_see_foto(id));
-- A tag row is seen by the uploader, and per row by the owners of that dog: no client learns another dog's tag.
create policy "fotos tags read" on public.paseo_foto_perros for select to authenticated
  using (public.can_see_foto(foto_id) and (subido_por = auth.uid() or public.owns_dog(perro_id)));

-- Registers a photo for the caller's own walks of today or yesterday (Bogota). The dog of each tag comes from
-- the prestacion, never from the caller. Also purges expired rows (and uploads abandoned for a day); no cron.
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
    where expires_at <= now() or (estado = 'pendiente' and created_at < now() - interval '1 day');

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

-- Called by the Worker with the uploader's token: the R2 key, chosen here from the row, only for the uploader
-- of a pending, unexpired photo. A stranger, an unknown id and an already uploaded photo are the same refusal.
create or replace function public.foto_subida_autorizar(p_id uuid) returns text
  language plpgsql stable security definer set search_path = '' as
$$
declare
  v_neg uuid;
begin
  select negocio_id into v_neg from public.paseo_fotos
    where id = p_id and subido_por = auth.uid() and estado = 'pendiente' and expires_at > now();
  if not found then raise exception 'no_autorizado' using errcode = '42501'; end if;
  return 'f/' || v_neg || '/' || p_id || '.jpg';
end;
$$;

-- Called by the Worker after the object is stored. The size check is the table constraint (1..2 MB).
create or replace function public.foto_confirmar(p_id uuid, p_bytes integer) returns void
  language plpgsql security definer set search_path = '' as
$$
begin
  update public.paseo_fotos set estado = 'lista', bytes = p_bytes
    where id = p_id and subido_por = auth.uid() and estado = 'pendiente' and expires_at > now();
  if not found then raise exception 'no_autorizado' using errcode = '42501'; end if;
end;
$$;

revoke execute on function public.can_see_foto(uuid), public.foto_registrar(uuid[]),
  public.foto_subida_autorizar(uuid), public.foto_confirmar(uuid, integer) from public, anon;
grant execute on function public.can_see_foto(uuid), public.foto_registrar(uuid[]),
  public.foto_subida_autorizar(uuid), public.foto_confirmar(uuid, integer) to authenticated;
