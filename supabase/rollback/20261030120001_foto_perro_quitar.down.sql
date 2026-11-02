-- Structural inverse of 20261030120001_foto_perro_quitar.sql: drops the guard and perro_foto_quitar and restores the
-- walker's window of today or yesterday (20261030110001_datos.sql). Revert the app and the Worker together: without
-- perro_foto_quitar, DELETE /p/{perro} answers 404 from Supabase and perroEliminar stops at it.
drop trigger trg_perro_foto_guardia on public.perros;
drop function public.perro_foto_guardia();
drop function public.perro_foto_quitar(uuid);

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
