-- S2a / part 1: role- and NULL-safe guards on the three group RPCs and
-- non-destructive dog moves.
--   assert_gestor(p_neg)  the one guard: a signed-in owner or office member of
--                         tenant p_neg. A caller whose tenant or role cannot be
--                         resolved (no profile) is a denial, never a pass.
-- The RPCs keep their signatures (no frontend change). They now also validate
-- mode, hour and dates, and only ever touch future, still-`programado` rows.

create or replace function public.assert_gestor(p_neg uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_mi uuid := public.my_negocio();
begin
  if auth.uid() is null or p_neg is null or v_mi is null or p_neg <> v_mi
     or not (public.is_owner() or public.is_office()) then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
end;
$$;

-- Move a dog to another group. 'siempre' = move the recurring membership and
-- regenerate its future walks; 'hoy' = move only that date's walk.
create or replace function public.mover_perro(p_perro uuid, p_grupo uuid, p_modo text, p_fecha date)
  returns void language plpgsql security definer set search_path = '' as
$$
declare
  v_neg  uuid; v_serv uuid; v_hora text; v_dur int; v_cuid uuid;
  v_hoy  date := (now() at time zone 'America/Bogota')::date;
begin
  select negocio_id, servicio_id, hora, duracion_min, cuidador_id
    into v_neg, v_serv, v_hora, v_dur, v_cuid
    from public.grupos where id = p_grupo;
  perform public.assert_gestor(v_neg);  -- also refuses an unknown group, with the same error
  if p_modo is null or p_modo not in ('hoy', 'siempre') then raise exception 'modo_invalido'; end if;
  if p_fecha is null or p_fecha < v_hoy then raise exception 'fecha_invalida'; end if;
  if not exists (select 1 from public.perros where id = p_perro and negocio_id = v_neg) then
    raise exception 'perro_invalido';
  end if;

  if p_modo = 'siempre' then
    update public.grupo_membresias set grupo_id = p_grupo
      where perro_id = p_perro
        and grupo_id in (select id from public.grupos where negocio_id = v_neg);
    if not found then
      insert into public.grupo_membresias (grupo_id, perro_id, recurrencia)
        values (p_grupo, p_perro, '{"tipo":"diario"}'::jsonb)
        on conflict (grupo_id, perro_id) do nothing;
    end if;
    -- Replace only future, still-programado, unpaid, group-generated walks.
    delete from public.prestaciones
      where perro_id = p_perro and negocio_id = v_neg
        and fecha >= p_fecha and estado = 'programado' and not coalesce(cobrado, false)
        and tipo = 'paseo' and grupo_id is not null;
    -- Skip dates that already hold a walk (kept en_curso / paid / client-booked rows).
    insert into public.prestaciones (negocio_id, perro_id, servicio_id, grupo_id, tipo, cuidador_id, fecha, estado, detalle)
    select v_neg, m.perro_id, g.servicio_id, g.id, 'paseo', g.cuidador_id, (p_fecha + gs.i), 'programado',
           jsonb_build_object('hora', g.hora, 'duracion', g.duracion_min, 'direccion', coalesce(g.zona, ''))
    from public.grupo_membresias m
    join public.grupos g on g.id = m.grupo_id
    cross join generate_series(0, 56) as gs(i)
    where m.perro_id = p_perro and g.negocio_id = v_neg and m.activo
      and public.recurrencia_aplica(m.recurrencia, (p_fecha + gs.i))
      and not exists (
        select 1 from public.prestaciones x
        where x.perro_id = m.perro_id and x.negocio_id = v_neg and x.tipo = 'paseo' and x.fecha = (p_fecha + gs.i)
      );
  else
    update public.prestaciones
      set grupo_id = p_grupo, servicio_id = v_serv,
          detalle = coalesce(detalle, '{}'::jsonb) || jsonb_build_object('hora', v_hora, 'duracion', v_dur)
      where perro_id = p_perro and negocio_id = v_neg and fecha = p_fecha
        and tipo = 'paseo' and estado = 'programado' and not coalesce(cobrado, false);
    if not found and not exists (
      select 1 from public.prestaciones
      where perro_id = p_perro and negocio_id = v_neg and fecha = p_fecha and tipo = 'paseo'
    ) then
      insert into public.prestaciones (negocio_id, perro_id, servicio_id, grupo_id, tipo, cuidador_id, fecha, estado, detalle)
      values (v_neg, p_perro, v_serv, p_grupo, 'paseo', v_cuid, p_fecha, 'programado',
              jsonb_build_object('hora', v_hora, 'duracion', v_dur));
    end if;
  end if;
end;
$$;

-- Change the hour of a whole group and re-stamp its future programado walks.
create or replace function public.grupo_set_hora(p_grupo uuid, p_hora text, p_fecha date)
  returns void language plpgsql security definer set search_path = '' as
$$
declare
  v_neg uuid;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
begin
  select negocio_id into v_neg from public.grupos where id = p_grupo;
  perform public.assert_gestor(v_neg);
  if p_hora is null or p_hora !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'hora_invalida'; end if;
  if p_fecha is null or p_fecha < v_hoy then raise exception 'fecha_invalida'; end if;

  update public.grupos set hora = p_hora where id = p_grupo;
  update public.prestaciones
    set detalle = coalesce(detalle, '{}'::jsonb) || jsonb_build_object('hora', p_hora)
    where grupo_id = p_grupo and negocio_id = v_neg and fecha >= p_fecha and estado = 'programado';
end;
$$;

-- Reschedule one occurrence ('hoy': day and/or hour) or the group's recurring hour
-- ('siempre' on the same day).
create or replace function public.bloque_reprogramar(
  p_grupo uuid, p_fecha_old date, p_fecha_new date, p_hora text, p_modo text
) returns void language plpgsql security definer set search_path = '' as
$$
declare
  v_neg uuid;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
begin
  select negocio_id into v_neg from public.grupos where id = p_grupo;
  perform public.assert_gestor(v_neg);
  if p_modo is null or p_modo not in ('hoy', 'siempre') then raise exception 'modo_invalido'; end if;
  if p_hora is null or p_hora !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'hora_invalida'; end if;
  if p_fecha_old is null or p_fecha_new is null or p_fecha_old < v_hoy or p_fecha_new < v_hoy then
    raise exception 'fecha_invalida';
  end if;

  if p_modo = 'siempre' and p_fecha_old = p_fecha_new then
    update public.grupos set hora = p_hora where id = p_grupo;
    update public.prestaciones
      set detalle = coalesce(detalle, '{}'::jsonb) || jsonb_build_object('hora', p_hora)
      where grupo_id = p_grupo and negocio_id = v_neg and fecha >= p_fecha_old and estado = 'programado';
  else
    update public.prestaciones
      set fecha = p_fecha_new,
          detalle = coalesce(detalle, '{}'::jsonb) || jsonb_build_object('hora', p_hora)
      where grupo_id = p_grupo and negocio_id = v_neg and fecha = p_fecha_old and estado = 'programado';
  end if;
end;
$$;

-- assert_gestor is internal (called by the definer functions as their owner).
revoke execute on function public.assert_gestor(uuid) from public, anon, authenticated;
revoke execute on function public.mover_perro(uuid, uuid, text, date),
  public.grupo_set_hora(uuid, text, date),
  public.bloque_reprogramar(uuid, date, date, text, text) from public, anon;
grant execute on function public.mover_perro(uuid, uuid, text, date),
  public.grupo_set_hora(uuid, text, date),
  public.bloque_reprogramar(uuid, date, date, text, text) to authenticated;
