-- Structural inverse of 20261030110001_datos.sql: drops the dog-photo and client dog-edit functions and perros.foto_at
-- (the R2 objects under p/ stay; delete them by hand if wanted) and restores the four-argument incidente_reportar of
-- 20261026120001_incidentes.sql. Incidents stored with a client id keep it. Revert the app (data.ts, FotoUpload.js,
-- the bridges) together: without p_id the outbox replays an incident as a new one.
drop function public.mi_perro_actualizar(uuid, text, text, text, text, text, text);
drop function public.perro_foto_confirmar(uuid, integer);
drop function public.perro_foto_autorizar(uuid);
drop function public.perro_foto_negocio(uuid);
alter table public.perros drop column foto_at;

drop function public.incidente_reportar(uuid, uuid, text, text, uuid);
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
revoke execute on function public.incidente_reportar(uuid, uuid, text, text) from public, anon;
grant execute on function public.incidente_reportar(uuid, uuid, text, text) to authenticated;
