-- F5c.
--   * perro_foto_quitar: clears perros.foto_at for whoever may upload (owner, office, active owner of the active dog);
--     the Worker calls it from DELETE /p/{perro} after deleting the object. No photo is a success.
--   * trg_perro_foto_guardia: a database function cannot call R2, so a dog marked with a photo cannot stop being
--     registered (soft delete, hard delete, a cascade from its business or the owner's account) until the photo is
--     removed: perro_con_foto. The app removes it through the Worker before perro_eliminar. Whoever hard-deletes by
--     hand (service role) deletes p/{negocio}/{perro}.jpg with wrangler and clears foto_at first. foto_at is also
--     closed to direct writes through the API, which would pass the guard.
--   * incidente_reportar: the walker's window goes from yesterday to 7 days, so a report queued offline survives a few
--     days without signal. The rest of the function is unchanged.

create or replace function public.incidente_reportar(p_perro uuid, p_prestacion uuid, p_tipo text, p_descripcion text, p_id uuid default null)
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
            and cuidador_id = auth.uid() and fecha between v_hoy - 7 and v_hoy), false) then
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

create function public.perro_foto_quitar(p_perro uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
begin
  if public.perro_foto_negocio(p_perro) is null then raise exception 'no_autorizado' using errcode = '42501'; end if;
  update public.perros set foto_at = null where id = p_perro;
end;
$$;
revoke execute on function public.perro_foto_quitar(uuid) from public, anon;
grant execute on function public.perro_foto_quitar(uuid) to authenticated;

-- Not definer: current_user tells a direct API write (authenticated) from the definer functions above.
create function public.perro_foto_guardia() returns trigger
  language plpgsql set search_path = '' as
$$
begin
  if tg_op = 'UPDATE' and new.foto_at is distinct from old.foto_at and current_user in ('authenticated', 'anon') then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if old.foto_at is not null and (tg_op = 'DELETE' or (coalesce(old.activo, true) and new.activo is false)) then
    raise exception 'perro_con_foto';
  end if;
  return coalesce(new, old);
end;
$$;
revoke execute on function public.perro_foto_guardia() from public, anon, authenticated;
create trigger trg_perro_foto_guardia before update or delete on public.perros
  for each row execute function public.perro_foto_guardia();
