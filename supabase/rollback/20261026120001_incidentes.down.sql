-- Structural inverse of 20261026120001_incidentes.sql: drops incidente_reportar, foto_retencion_autorizar,
-- foto_reportar and the tables incidentes and fotos_reportes (export them first: they are incident and report
-- evidence), restores can_see_foto and foto_registrar (20261014110001_s5a_photos.sql) and fotos_purgar_vencidas
-- (20261025110002_fotos_purga_cron.sql), then drops paseo_fotos.retener and oculta. Retained photos past 30 days
-- are purged by the next run and hidden photos become visible again to their audience. The r/ copies in R2 stay
-- (delete them by hand). Revert the Worker POST /retener and the UI with it.
drop function if exists public.foto_reportar(uuid, text);
drop function if exists public.foto_retencion_autorizar(uuid);
drop function if exists public.incidente_reportar(uuid, uuid, text, text);
drop table if exists public.fotos_reportes;
drop table if exists public.incidentes;

create or replace function public.can_see_foto(p_id uuid) returns boolean
  language sql stable security definer set search_path = '' as
$$ select coalesce(exists(
     select 1 from public.paseo_fotos f
     where f.id = p_id and f.expires_at > now()
       and (f.subido_por = auth.uid()
            or (f.estado = 'lista' and exists(
                  select 1 from public.paseo_foto_perros t where t.foto_id = f.id and public.owns_dog(t.perro_id))))
   ), false) $$;

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

create or replace function public.fotos_purgar_vencidas() returns integer
  language sql security definer set search_path = '' as
$$
  with borradas as (
    delete from public.paseo_fotos
     where expires_at <= now() or (estado = 'pendiente' and created_at < now() - interval '1 day')
    returning 1)
  select count(*)::integer from borradas
$$;
revoke execute on function public.fotos_purgar_vencidas() from public, anon, authenticated;

alter table public.paseo_fotos drop column retener, drop column oculta;
