-- M1 walker map, data only: one pickup point per dog.
--   perro_recogida       lat/lng (5 decimals, about 1 m) and an optional note of up to 120 characters. RLS on and no
--                        table grant: the RPCs below are the only way in.
--   recogida_guardar / recogida_borrar / recogida_de  an active owner of the active dog, or the owner or office of its
--                        business (the rule of perro_foto_negocio, the dog photo); anyone else 42501.
--   recogida_mis_paseos(desde, hasta)  a walker reads the points of the dogs with a walk assigned to him in his
--                        current business (the rule of paseo_marcar since 20261030100002_paseo_miembro.sql), not
--                        cancelled, dated inside desde .. hasta capped at yesterday .. today + 7 (Bogotá). A removed
--                        walker has no business, so he reads nothing.
-- A removed dog loses its point: a hard delete cascades and trg_perro_recogida_baja deletes it when the dog stops
-- being active (perro_eliminar or a direct update by the owner).

create table public.perro_recogida (
  perro_id   uuid primary key references public.perros (id) on delete cascade,
  negocio_id uuid not null references public.negocios (id) on delete cascade,
  lat        numeric(7, 5) not null check (lat between -90 and 90),
  lng        numeric(8, 5) not null check (lng between -180 and 180),
  nota       text check (char_length(nota) <= 120),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
alter table public.perro_recogida enable row level security;
revoke all on public.perro_recogida from public, anon, authenticated;

create function public.recogida_guardar(p_perro uuid, p_lat numeric, p_lng numeric, p_nota text default null)
  returns void language plpgsql security definer set search_path = '' as
$$
declare
  v_neg  uuid := public.perro_foto_negocio(p_perro);
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
begin
  if v_neg is null then raise exception 'no_autorizado' using errcode = '42501'; end if;
  -- NaN and Infinity fail the ranges too.
  if p_lat is null or p_lng is null or not (p_lat between -90 and 90) or not (p_lng between -180 and 180)
     or char_length(coalesce(v_nota, '')) > 120 then
    raise exception 'recogida_invalida';
  end if;
  insert into public.perro_recogida (perro_id, negocio_id, lat, lng, nota, updated_at, updated_by)
    values (p_perro, v_neg, round(p_lat, 5), round(p_lng, 5), v_nota, now(), auth.uid())
    on conflict (perro_id) do update
      set negocio_id = excluded.negocio_id, lat = excluded.lat, lng = excluded.lng, nota = excluded.nota,
          updated_at = excluded.updated_at, updated_by = excluded.updated_by;
end;
$$;

create function public.recogida_borrar(p_perro uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
begin
  if public.perro_foto_negocio(p_perro) is null then raise exception 'no_autorizado' using errcode = '42501'; end if;
  delete from public.perro_recogida where perro_id = p_perro;
end;
$$;

-- Zero or one row.
create function public.recogida_de(p_perro uuid)
  returns table (lat numeric, lng numeric, nota text, updated_at timestamptz)
  language plpgsql stable security definer set search_path = '' as
$$
begin
  if public.perro_foto_negocio(p_perro) is null then raise exception 'no_autorizado' using errcode = '42501'; end if;
  return query select r.lat, r.lng, r.nota, r.updated_at from public.perro_recogida r where r.perro_id = p_perro;
end;
$$;

-- greatest/least ignore a null bound, so a missing one means the edge of the window.
create function public.recogida_mis_paseos(p_desde date, p_hasta date)
  returns table (perro_id uuid, nombre text, lat numeric, lng numeric, nota text)
  language plpgsql stable security definer set search_path = '' as
$$
declare
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_neg uuid := public.my_negocio();
begin
  if auth.uid() is null then raise exception 'no_autorizado' using errcode = '42501'; end if;
  return query
    select r.perro_id, p.nombre, r.lat, r.lng, r.nota
      from public.perro_recogida r join public.perros p on p.id = r.perro_id
     where r.negocio_id = v_neg and coalesce(p.activo, true)
       and exists (select 1 from public.prestaciones x
                    where x.perro_id = r.perro_id and x.negocio_id = v_neg and x.cuidador_id = auth.uid()
                      and x.estado <> 'cancelado'
                      and x.fecha between greatest(p_desde, v_hoy - 1) and least(p_hasta, v_hoy + 7))
     order by p.nombre;
end;
$$;

-- Definer: the table has no grant, and the owner deactivates a dog with his own role.
create function public.perro_recogida_baja() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  delete from public.perro_recogida where perro_id = new.id;
  return null;
end;
$$;
create trigger trg_perro_recogida_baja after update of activo on public.perros
  for each row when (old.activo is distinct from false and new.activo is false)
  execute function public.perro_recogida_baja();

revoke execute on function public.perro_recogida_baja() from public, anon, authenticated;
revoke execute on function public.recogida_guardar(uuid, numeric, numeric, text), public.recogida_borrar(uuid),
  public.recogida_de(uuid), public.recogida_mis_paseos(date, date) from public, anon;
grant execute on function public.recogida_guardar(uuid, numeric, numeric, text), public.recogida_borrar(uuid),
  public.recogida_de(uuid), public.recogida_mis_paseos(date, date) to authenticated;
