-- F1 agenda: a recurring group owns its future walks.
--   grupo_agregar_perro / grupo_quitar_perro  owner or office puts a dog into a group (with its weekdays) or takes it
--                                             out; the dog's walks of the horizon are created / deleted with it
--   agenda_extender                           daily pg_cron job (dd_agenda_extender): every active membership keeps
--                                             its walks up to today+56 (Bogota); a full outing (Ley 2480 art. 9.6,
--                                             paseador_lleno) is skipped, never aborts the run
--   grupo_asignar / grupo_actualizar / grupo_eliminar  walker, hour, service and deletion reach the future walks
--   prestacion_asignar                        a booking without a group (bath, daycare...) gets its assignee
-- "Future" (agenda_editable): after today, or today at a later hour; still programado; no paid cobro. Rows en_curso,
-- finalizado, no_asistio, cancelado or paid are never touched. The weekdays live on the membership as the recurrence
-- recurrencia_aplica already reads: {"tipo":"diario"} (every day) or {"tipo":"semanal","dias":["lun",...]}.

-- A membership starts on the Bogota day, the clock every RPC uses (current_date is UTC: tomorrow from 19:00).
alter table public.grupo_membresias alter column fecha_desde set default (now() at time zone 'America/Bogota')::date;

-- Walks created by agenda_materializar are priced from the catalogue also without a JWT (the cron job): same body
-- as 20261013170001_s4b_switch.sql plus the transaction-local flag dd.precio_catalogo.
create or replace function public.prestacion_cobro() returns trigger
  language plpgsql security definer set search_path = '' as
$$
declare
  v_precio integer := 0; v_modelo text; v_qty integer := 1; v_cobrable boolean := true;
begin
  if (auth.uid() is not null or current_setting('dd.precio_catalogo', true) = 'on') and new.servicio_id is not null then
    select t.precio, s.modelo_cobro into v_precio, v_modelo
      from public.servicios s left join public.tarifas t on t.servicio_id = s.id
      where s.id = new.servicio_id and s.negocio_id = new.negocio_id;
    v_precio := coalesce(v_precio, 0);
    if v_modelo = 'mensual' then
      v_cobrable := false; v_precio := 0;
    elsif v_modelo is not null then
      if new.tipo in ('comida', 'accesorio') and jsonb_typeof(new.detalle -> 'cantidad') = 'number' then
        v_qty := least(greatest(floor((new.detalle ->> 'cantidad')::numeric), 1), 1000)::integer;
      end if;
      v_precio := v_precio * v_qty;
    else
      v_precio := 0;
    end if;
  end if;
  insert into public.cobros (prestacion_id, negocio_id, precio_aplicado, cobrable)
    values (new.id, new.negocio_id, v_precio, v_cobrable) on conflict (prestacion_id) do nothing;
  return new;
end;
$$;

-- ---- internal helpers -----------------------------------------------------------------------------------
create function public.agenda_editable(p public.prestaciones) returns boolean
  language sql stable set search_path = '' as
$$
  select p.estado = 'programado'
     and (p.fecha > (now() at time zone 'America/Bogota')::date
          or (p.fecha = (now() at time zone 'America/Bogota')::date
              and coalesce(p.detalle ->> 'hora', '') > to_char(now() at time zone 'America/Bogota', 'HH24:MI')))
     and not exists (select 1 from public.cobros c where c.prestacion_id = p.id and c.cobrado)
$$;

-- Creates the missing walks of one active membership from today (later hour) to today+56. A date that already holds
-- a walk of that dog and group (any state, a cancelled one too) is left alone. creados = walks created, llenos =
-- dates skipped because the walker already has 8 dogs on that outing.
create function public.agenda_materializar(p_membresia uuid, out creados integer, out llenos integer)
  language plpgsql security definer set search_path = '' as
$$
declare
  v_hoy   date := (now() at time zone 'America/Bogota')::date;
  v_ahora text := to_char(now() at time zone 'America/Bogota', 'HH24:MI');
  r record;
  d date;
begin
  creados := 0; llenos := 0;
  select m.perro_id, m.recurrencia, m.fecha_desde, m.fecha_hasta, g.id as grupo_id, g.negocio_id, g.servicio_id,
         g.cuidador_id, g.hora, g.duracion_min, g.zona, coalesce(s.tipo, 'paseo') as tipo
    into r
    from public.grupo_membresias m
    join public.grupos g on g.id = m.grupo_id
    join public.perros p on p.id = m.perro_id and p.negocio_id = g.negocio_id
    left join public.servicios s on s.id = g.servicio_id
   where m.id = p_membresia and coalesce(m.activo, true) and coalesce(g.activo, true) and coalesce(p.activo, true);
  if not found then return; end if;
  perform set_config('dd.precio_catalogo', 'on', true);

  for d in select v_hoy + i from generate_series(0, 56) as gs(i) loop
    continue when d = v_hoy and r.hora <= v_ahora;
    continue when (r.fecha_desde is not null and d < r.fecha_desde) or (r.fecha_hasta is not null and d > r.fecha_hasta);
    continue when not public.recurrencia_aplica(r.recurrencia, d);
    continue when exists (select 1 from public.prestaciones x where x.perro_id = r.perro_id and x.grupo_id = r.grupo_id and x.fecha = d);
    begin
      insert into public.prestaciones (negocio_id, perro_id, servicio_id, grupo_id, tipo, cuidador_id, fecha, estado, detalle)
        values (r.negocio_id, r.perro_id, r.servicio_id, r.grupo_id, r.tipo, r.cuidador_id, d, 'programado',
                jsonb_build_object('hora', r.hora, 'duracion', r.duracion_min, 'direccion', coalesce(r.zona, '')));
      creados := creados + 1;
    exception when check_violation then
      if sqlerrm <> 'paseador_lleno' then raise; end if;
      llenos := llenos + 1;
    end;
  end loop;
end;
$$;

-- The pg_cron job: every active membership of an active group. Returns the walks created.
create function public.agenda_extender() returns integer
  language plpgsql security definer set search_path = '' as
$$
declare
  v_n integer := 0;
  m record;
  c integer;
begin
  for m in select gm.id from public.grupo_membresias gm join public.grupos g on g.id = gm.grupo_id
            where coalesce(gm.activo, true) and coalesce(g.activo, true) order by g.hora, gm.created_at
  loop
    select creados into c from public.agenda_materializar(m.id);
    v_n := v_n + coalesce(c, 0);
  end loop;
  return v_n;
end;
$$;

revoke execute on function public.agenda_editable(public.prestaciones), public.agenda_materializar(uuid),
  public.agenda_extender() from public, anon, authenticated;

-- ---- memberships ------------------------------------------------------------------------------------------
-- p_dias: isodow 1 (Monday) .. 7 (Sunday); null = every day. Adding a dog already in the group edits its days:
-- future walks on days no longer covered are deleted, missing ones created. Returns the dates left out because the
-- outing was full.
create function public.grupo_agregar_perro(p_grupo uuid, p_perro uuid, p_dias integer[] default null)
  returns integer language plpgsql security definer set search_path = '' as
$$
declare
  v_neg    uuid;
  v_activo boolean;
  v_rec    jsonb;
  v_id     uuid;
  v_llenos integer;
begin
  select negocio_id, coalesce(activo, true) into v_neg, v_activo from public.grupos where id = p_grupo;
  perform public.assert_gestor(v_neg);
  if not v_activo then raise exception 'grupo_invalido'; end if;
  if not exists (select 1 from public.perros where id = p_perro and negocio_id = v_neg and coalesce(activo, true)) then
    raise exception 'perro_invalido';
  end if;
  if p_dias is null then
    v_rec := '{"tipo":"diario"}'::jsonb;
  elsif cardinality(p_dias) = 0 or exists (select 1 from unnest(p_dias) x where x is null or x not between 1 and 7) then
    raise exception 'dias_invalidos';
  else
    v_rec := jsonb_build_object('tipo', 'semanal', 'dias',
      (select jsonb_agg((array['lun','mar','mie','jue','vie','sab','dom'])[x] order by x) from (select distinct unnest(p_dias) as x) t));
  end if;

  insert into public.grupo_membresias as m (grupo_id, perro_id, recurrencia, activo)
    values (p_grupo, p_perro, v_rec, true)
    on conflict (grupo_id, perro_id) do update
      set recurrencia = excluded.recurrencia, activo = true, fecha_hasta = null,
          fecha_desde = case when coalesce(m.activo, true) then m.fecha_desde else excluded.fecha_desde end
    returning id into v_id;
  delete from public.prestaciones p
   where p.perro_id = p_perro and p.grupo_id = p_grupo and public.agenda_editable(p)
     and not public.recurrencia_aplica(v_rec, p.fecha);
  select llenos into v_llenos from public.agenda_materializar(v_id);
  return v_llenos;
end;
$$;

create function public.grupo_quitar_perro(p_grupo uuid, p_perro uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_neg uuid;
begin
  select negocio_id into v_neg from public.grupos where id = p_grupo;
  perform public.assert_gestor(v_neg);
  update public.grupo_membresias set activo = false where grupo_id = p_grupo and perro_id = p_perro;
  if not found then raise exception 'perro_invalido'; end if;
  delete from public.prestaciones p where p.grupo_id = p_grupo and p.perro_id = p_perro and public.agenda_editable(p);
end;
$$;

-- ---- the group itself ---------------------------------------------------------------------------------------
-- A new walker reaches the group's future walks. The 9.6 trigger checks each re-stamped walk: one full outing
-- (paseador_lleno) rolls the whole call back, the group included. Body = 20261013110002_s2a_grupo_asignar.sql + re-stamp.
create or replace function public.grupo_asignar(p_grupo uuid, p_cuidador uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_neg uuid;
begin
  select negocio_id into v_neg from public.grupos where id = p_grupo;
  perform public.assert_gestor(v_neg);
  if p_cuidador is not null and not exists (
    select 1 from public.profiles p
    where p.id = p_cuidador and p.negocio_id = v_neg
      and (p.rol = 'paseador' or exists (select 1 from public.negocios n where n.id = v_neg and n.owner_id = p.id))
  ) then
    raise exception 'cuidador_invalido';
  end if;
  update public.grupos set cuidador_id = p_cuidador where id = p_grupo;
  update public.prestaciones p set cuidador_id = p_cuidador
   where p.grupo_id = p_grupo and public.agenda_editable(p) and p.cuidador_id is distinct from p_cuidador;
end;
$$;

-- Replaces the direct table update of the app: name, hour, service, duration, zone and color, re-stamped on the
-- future walks (hour, duration, address, service, type and, when the service changes, the catalogue price).
create function public.grupo_actualizar(
  p_grupo uuid, p_nombre text, p_hora text, p_servicio uuid, p_duracion integer, p_zona text, p_color text
) returns void language plpgsql security definer set search_path = '' as
$$
declare
  v_neg    uuid;
  v_serv   uuid;
  v_nombre text := trim(coalesce(p_nombre, ''));
  v_zona   text := nullif(trim(coalesce(p_zona, '')), '');
  v_tipo   text := 'paseo';
begin
  select negocio_id, servicio_id into v_neg, v_serv from public.grupos where id = p_grupo;
  perform public.assert_gestor(v_neg);
  if v_nombre = '' or length(v_nombre) > 120 then raise exception 'nombre_invalido'; end if;
  if p_hora is null or p_hora !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'hora_invalida'; end if;
  if p_duracion is null or p_duracion not between 5 and 600 then raise exception 'duracion_invalida'; end if;
  if length(coalesce(v_zona, '')) > 120 or length(coalesce(p_color, '')) > 20 then raise exception 'datos_invalidos'; end if;
  if p_servicio is not null then
    select tipo into v_tipo from public.servicios
     where id = p_servicio and negocio_id = v_neg and coalesce(activo, true) and tipo not in ('comida', 'accesorio');
    if not found then raise exception 'servicio_invalido'; end if;
  end if;

  update public.grupos
     set nombre = v_nombre, hora = p_hora, servicio_id = p_servicio, duracion_min = p_duracion, zona = v_zona,
         color = coalesce(nullif(trim(coalesce(p_color, '')), ''), 'purple')
   where id = p_grupo;
  update public.prestaciones p
     set servicio_id = p_servicio, tipo = coalesce(v_tipo, 'paseo'),
         detalle = coalesce(p.detalle, '{}'::jsonb)
                   || jsonb_build_object('hora', p_hora, 'duracion', p_duracion, 'direccion', coalesce(v_zona, ''))
   where p.grupo_id = p_grupo and public.agenda_editable(p);
  if p_servicio is distinct from v_serv then
    update public.cobros c
       set precio_aplicado = case when s.modelo_cobro = 'mensual' then 0 else coalesce(t.precio, 0) end,
           cobrable = s.modelo_cobro is distinct from 'mensual'
      from public.prestaciones p
      left join public.servicios s on s.id = p.servicio_id
      left join public.tarifas t on t.servicio_id = p.servicio_id
     where c.prestacion_id = p.id and p.grupo_id = p_grupo and public.agenda_editable(p);
  end if;
end;
$$;

-- Replaces the soft delete of the app: the group and its memberships go inactive (agenda_extender skips them) and
-- its future walks are deleted. History stays.
create function public.grupo_eliminar(p_grupo uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_neg uuid;
begin
  select negocio_id into v_neg from public.grupos where id = p_grupo;
  perform public.assert_gestor(v_neg);
  update public.grupos set activo = false where id = p_grupo;
  update public.grupo_membresias set activo = false where grupo_id = p_grupo;
  delete from public.prestaciones p where p.grupo_id = p_grupo and public.agenda_editable(p);
end;
$$;

-- ---- bookings without a group ----------------------------------------------------------------------------
-- reservar leaves cuidador_id NULL for a service without a group, so nobody could start it. The owner or office
-- assigns a walker or staff member of the tenant (the independent walker, owner of his business, takes it himself);
-- the assignee then runs it with paseo_marcar. Only a programado booking from today on; the 9.6 trigger still
-- applies to a walk.
create function public.prestacion_asignar(p_id uuid, p_cuidador uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_neg    uuid;
  v_estado text;
  v_tipo   text;
  v_fecha  date;
begin
  select negocio_id, estado, tipo, fecha into v_neg, v_estado, v_tipo, v_fecha
    from public.prestaciones where id = p_id for update;
  perform public.assert_gestor(v_neg);
  if v_estado <> 'programado' or v_fecha < (now() at time zone 'America/Bogota')::date or v_tipo in ('comida', 'accesorio') then
    raise exception 'prestacion_no_asignable';
  end if;
  if p_cuidador is null or not exists (
    select 1 from public.profiles where id = p_cuidador and negocio_id = v_neg and rol in ('paseador', 'empresa')
  ) then
    raise exception 'cuidador_invalido';
  end if;
  update public.prestaciones set cuidador_id = p_cuidador where id = p_id;
end;
$$;

revoke execute on function public.grupo_agregar_perro(uuid, uuid, integer[]), public.grupo_quitar_perro(uuid, uuid),
  public.grupo_actualizar(uuid, text, text, uuid, integer, text, text), public.grupo_eliminar(uuid),
  public.prestacion_asignar(uuid, uuid) from public, anon;
grant execute on function public.grupo_agregar_perro(uuid, uuid, integer[]), public.grupo_quitar_perro(uuid, uuid),
  public.grupo_actualizar(uuid, text, text, uuid, integer, text, text), public.grupo_eliminar(uuid),
  public.prestacion_asignar(uuid, uuid) to authenticated;

-- ---- daily job: 06:00 UTC = 01:00 Bogota, right after the Bogota day changes. Idempotent like dd_purga_fotos.
select cron.unschedule(jobid) from cron.job where jobname = 'dd_agenda_extender';
select cron.schedule('dd_agenda_extender', '0 6 * * *', 'select public.agenda_extender()');
