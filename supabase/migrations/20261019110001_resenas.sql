-- Real reviews (the landing's invented testimonials were removed under Ley 1480). A client who owns
-- (principal or co-owner) a dog with at least one finished service of a tenant writes ONE review of that
-- tenant through resena_guardar; any edit sends it back to pending. Only the tenant's owner moderates it
-- (resena_moderar). The public landing reads resenas_publicas(), the only function anon may execute: it
-- aggregates approved reviews whose author consented to show their name, returns nothing below 3 of them,
-- and exposes only the author's first name + surname initial, rating, text, business name and date.

create table public.resenas (
  id              uuid primary key default gen_random_uuid(),
  negocio_id      uuid not null references public.negocios (id) on delete cascade,
  autor_id        uuid not null references public.profiles (id) on delete cascade,
  rating          smallint not null check (rating between 1 and 5),
  texto           text not null check (char_length(texto) between 10 and 600),
  publicar_nombre boolean not null default false,
  estado          text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  moderated_by    uuid references public.profiles (id) on delete set null,
  moderated_at    timestamptz,
  unique (negocio_id, autor_id)
);
alter table public.resenas enable row level security;
-- No API write at all: rows change only through the definer RPCs below.
revoke all on public.resenas from public, anon, authenticated;
grant select on public.resenas to authenticated;
create policy "resenas read own" on public.resenas for select using (autor_id = auth.uid());
create policy "resenas read owner" on public.resenas for select using (public.is_owner() and negocio_id = public.my_negocio());

-- Upserts the caller's review of p_negocio. Allowed only to a client profile that actively owns a dog of
-- that tenant with a finished service there (42501 otherwise, before any input is looked at).
create function public.resena_guardar(p_negocio uuid, p_rating integer, p_texto text, p_publicar_nombre boolean)
  returns void language plpgsql security definer set search_path = '' as
$$
declare
  v_uid   uuid := auth.uid();
  v_texto text := btrim(p_texto);
begin
  if v_uid is null or p_negocio is null or coalesce(public.my_rol(), '') <> 'cliente' or not exists (
    select 1 from public.perro_duenos pd
      join public.perros d on d.id = pd.perro_id and d.negocio_id = p_negocio
      join public.prestaciones pr on pr.perro_id = d.id and pr.negocio_id = p_negocio and pr.estado = 'finalizado'
     where pd.dueno_id = v_uid and pd.estado = 'activo'
  ) then
    raise exception 'sin_servicio_finalizado' using errcode = '42501';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'rating_invalido'; end if;
  if v_texto is null or char_length(v_texto) not between 10 and 600 then raise exception 'texto_invalido'; end if;

  insert into public.resenas (negocio_id, autor_id, rating, texto, publicar_nombre)
    values (p_negocio, v_uid, p_rating, v_texto, coalesce(p_publicar_nombre, false))
  on conflict (negocio_id, autor_id) do update
    set rating = excluded.rating, texto = excluded.texto, publicar_nombre = excluded.publicar_nombre,
        estado = 'pendiente', updated_at = now(), moderated_by = null, moderated_at = null;
end;
$$;

-- Approves or rejects a review of the caller's own tenant; owner only. An unknown id is denied like a
-- foreign one. Who and when are the server's.
create function public.resena_moderar(p_id uuid, p_estado text) returns void
  language plpgsql security definer set search_path = '' as
$$
begin
  if auth.uid() is null or not public.is_owner()
     or not exists (select 1 from public.resenas where id = p_id and negocio_id = public.my_negocio()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_estado is null or p_estado not in ('aprobada', 'rechazada') then raise exception 'estado_invalido'; end if;
  update public.resenas set estado = p_estado, moderated_by = auth.uid(), moderated_at = now() where id = p_id;
end;
$$;

-- Public summary for the landing. Below 3 public reviews it returns {total: 0, promedio: null, items: []},
-- so neither the count nor the average nor any text leaks. Author = first word of the profile name + the
-- initial of the surname (2nd word, or 3rd when the name has 4+ words: "Nombre Nombre Apellido Apellido").
create function public.resenas_publicas() returns jsonb
  language sql stable security definer set search_path = '' as
$$
  with pub as (
    select r.rating, r.texto, r.moderated_at, n.nombre as negocio,
           regexp_split_to_array(btrim(p.nombre), '\s+') as w
      from public.resenas r
      join public.negocios n on n.id = r.negocio_id
      join public.profiles p on p.id = r.autor_id
     where r.estado = 'aprobada' and r.publicar_nombre
  ), agg as (select count(*) as total, round(avg(rating), 1) as promedio from pub)
  select case when agg.total < 3 then jsonb_build_object('total', 0, 'promedio', null, 'items', '[]'::jsonb)
    else jsonb_build_object('total', agg.total, 'promedio', agg.promedio, 'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'autor', left(x.w[1], 40) || case when cardinality(x.w) > 1
                     then ' ' || upper(left(x.w[case when cardinality(x.w) >= 4 then 3 else 2 end], 1)) || '.' else '' end,
          'rating', x.rating, 'texto', x.texto, 'negocio', x.negocio,
          'fecha', to_char(x.moderated_at at time zone 'America/Bogota', 'YYYY-MM-DD')
        ) order by x.moderated_at desc nulls last), '[]'::jsonb)
        from (select * from pub order by moderated_at desc nulls last limit 6) x))
    end
  from agg;
$$;

revoke execute on function public.resena_guardar(uuid, integer, text, boolean), public.resena_moderar(uuid, text),
  public.resenas_publicas() from public, anon;
grant execute on function public.resena_guardar(uuid, integer, text, boolean), public.resena_moderar(uuid, text) to authenticated;
-- The landing is public: anon (and a signed-in visitor) may read the aggregate. It is the only function anon executes.
grant execute on function public.resenas_publicas() to anon, authenticated;
