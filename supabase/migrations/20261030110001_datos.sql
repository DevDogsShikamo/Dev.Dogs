-- F5b data polish.
--   * incidente_reportar gets p_id, a client-generated id that is the idempotency key of the offline outbox: the
--     same id again from its reporter returns it (no second row, even once the walk window has passed); the same id
--     from anyone else is the usual refusal (42501). Without p_id it behaves as before.
--   * dog profile photo: perros.foto_at is set when the photo Worker stored p/{negocio}/{perro}.jpg (one object per
--     dog, replaced by each upload; outside the f/ 30-day lifecycle). perro_foto_autorizar / perro_foto_confirmar:
--     the owner or office of the dog's business, or an active owner (principal or co) of the active dog. The Worker
--     serves the photo to whoever reads the perros row (RLS), so its audience is the dog's.
--   * mi_perro_actualizar: an active owner (principal or co) edits the fields a client sets when registering a dog
--     (crear_mi_perro): name, breed, size, behaviour, sociability and care tips. Heat, contagious disease, health
--     certificate and relations stay with the business owner.

-- ---- incidents: idempotent replay ---------------------------------------------------------------------------
drop function public.incidente_reportar(uuid, uuid, text, text);
create function public.incidente_reportar(p_perro uuid, p_prestacion uuid, p_tipo text, p_descripcion text, p_id uuid default null)
  returns uuid
  language plpgsql security definer set search_path = '' as
$$
declare
  v_hoy   date := (now() at time zone 'America/Bogota')::date;
  v_neg   uuid;
  v_texto text := btrim(p_descripcion);
  v_id    uuid;
  v_por   uuid;
begin
  if auth.uid() is null then raise exception 'no_autorizado' using errcode = '42501'; end if;
  if p_id is not null then
    select reportado_por into v_por from public.incidentes where id = p_id;
    if found then
      if v_por is distinct from auth.uid() then raise exception 'no_autorizado' using errcode = '42501'; end if;
      return p_id; -- a replay of the outbox: already stored
    end if;
  end if;

  select negocio_id into v_neg from public.perros where id = p_perro;
  if v_neg is null then raise exception 'no_autorizado' using errcode = '42501'; end if;
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

  insert into public.incidentes (id, negocio_id, perro_id, prestacion_id, tipo, descripcion, reportado_por)
    values (coalesce(p_id, gen_random_uuid()), v_neg, p_perro, p_prestacion, p_tipo, v_texto, auth.uid()) returning id into v_id;
  if p_prestacion is not null then
    update public.paseo_fotos f set retener = true
     where f.estado = 'lista' and f.expires_at > now() and exists(
       select 1 from public.paseo_foto_perros t where t.foto_id = f.id and t.prestacion_id = p_prestacion and t.perro_id = p_perro);
  end if;
  return v_id;
end;
$$;

-- ---- dog profile photo ----------------------------------------------------------------------------------------
alter table public.perros add column foto_at timestamptz;

-- The business of an active dog the caller may change the photo of, or null.
create function public.perro_foto_negocio(p_perro uuid) returns uuid
  language sql stable security definer set search_path = '' as
$$ select p.negocio_id from public.perros p
    where p.id = p_perro and coalesce(p.activo, true) and auth.uid() is not null
      and ((p.negocio_id = public.my_negocio() and (public.is_owner() or public.is_office())) or public.owns_dog(p.id)) $$;

-- Called by the Worker with the caller's token: the R2 key of the dog's photo. Anyone else, an unknown or a
-- removed dog: 42501.
create function public.perro_foto_autorizar(p_perro uuid) returns text
  language plpgsql stable security definer set search_path = '' as
$$
declare
  v_neg uuid := public.perro_foto_negocio(p_perro);
begin
  if v_neg is null then raise exception 'no_autorizado' using errcode = '42501'; end if;
  return 'p/' || v_neg || '/' || p_perro || '.jpg';
end;
$$;

-- Called by the Worker once the object is stored (1 byte .. 2 MB, the Worker's own limit).
create function public.perro_foto_confirmar(p_perro uuid, p_bytes integer) returns void
  language plpgsql security definer set search_path = '' as
$$
begin
  if public.perro_foto_negocio(p_perro) is null then raise exception 'no_autorizado' using errcode = '42501'; end if;
  if p_bytes is null or p_bytes not between 1 and 2097152 then raise exception 'foto_invalida'; end if;
  update public.perros set foto_at = now() where id = p_perro;
end;
$$;

-- ---- the client edits its own dog -----------------------------------------------------------------------------
create function public.mi_perro_actualizar(
  p_perro        uuid,
  p_nombre       text,
  p_raza         text default null,
  p_tamano       text default null,
  p_conducta     text default null,
  p_tips         text default null,
  p_sociabilidad text default null
) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_nombre text := trim(coalesce(p_nombre, ''));
begin
  if auth.uid() is null or public.my_rol() is distinct from 'cliente' or not public.owns_dog(p_perro)
     or not exists(select 1 from public.perros
                    where id = p_perro and coalesce(activo, true) and negocio_id = public.my_negocio()) then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if v_nombre = '' or length(v_nombre) > 80
     or length(coalesce(p_raza, '')) > 80 or length(coalesce(p_tips, '')) > 1000
     or coalesce(nullif(trim(p_tamano), ''), 'pequeno') not in ('pequeno', 'mediano', 'grande')
     or coalesce(nullif(trim(p_conducta), ''), 'tranquilo') not in ('tranquilo', 'energico', 'reactivo', 'sociable', 'jalador')
     or coalesce(nullif(trim(p_sociabilidad), ''), 'bueno') not in ('excelente', 'bueno', 'cuidado', 'selectivo') then
    raise exception 'perro_invalido';
  end if;

  update public.perros
     set nombre = v_nombre,
         raza = nullif(trim(coalesce(p_raza, '')), ''),
         tamano = nullif(trim(coalesce(p_tamano, '')), ''),
         conducta = nullif(trim(coalesce(p_conducta, '')), ''),
         tips = nullif(trim(coalesce(p_tips, '')), ''),
         sociabilidad = nullif(trim(coalesce(p_sociabilidad, '')), '')
   where id = p_perro;
end;
$$;

revoke execute on function public.incidente_reportar(uuid, uuid, text, text, uuid), public.perro_foto_negocio(uuid),
  public.perro_foto_autorizar(uuid), public.perro_foto_confirmar(uuid, integer),
  public.mi_perro_actualizar(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.incidente_reportar(uuid, uuid, text, text, uuid), public.perro_foto_autorizar(uuid),
  public.perro_foto_confirmar(uuid, integer), public.mi_perro_actualizar(uuid, text, text, text, text, text, text)
  to authenticated;
revoke execute on function public.perro_foto_negocio(uuid) from authenticated;
