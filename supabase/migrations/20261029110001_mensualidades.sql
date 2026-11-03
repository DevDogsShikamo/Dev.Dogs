-- F4 monthly plans: a plan (public.suscripciones, unused until now) charges a FIXED monthly amount per dog,
-- generated on the 1st of each month and owed whether or not the dog attends its walks.
--   plan_mensual_activar   owner or office with the finance permission; the current month is charged at once, in
--                          full (a mid-month start pays the whole month); a plan cancelled for later is resumed
--   plan_mensual_cancelar  same callers; the plan ends at the end of the current month by default
--   mensualidades_generar  internal (pg_cron dd_mensualidades, 01:15 Bogota on day 1): per plan and month one
--                          prestacion (the service's tipo, estado finalizado, no walker, no group, detalle
--                          {mensualidad: 'YYYY-MM', plan_id}) and its chargeable cobro at the monthly price
-- The billing mode lives on the plan (modo_cobro). Only 'fijo' exists; adding 'proporcional' or 'anticipado' is the
-- check below plus a branch of the CASE in mensualidades_generar. The walks of a monthly service stay
-- non-chargeable (prestacion_cobro, 20261029100001_agenda.sql), so nothing is charged twice. The monthly charge is
-- estado finalizado without a walker: trg_prestacion_ley_kiara (20261025100001_ley_kiara_contagio.sql) only looks at
-- recibido/en_curso (art. 7) and at walks with a walker (9.6), so it neither blocks it nor counts it.

alter table public.suscripciones add column modo_cobro text not null default 'fijo';
alter table public.suscripciones add constraint suscripciones_modo_cobro_check check (modo_cobro in ('fijo'));
-- A plan is always of one dog and one service (not validated: rows written before F4 are left alone).
alter table public.suscripciones add constraint suscripciones_plan_completo
  check (servicio_id is not null and perro_id is not null) not valid;
-- null = the service's tarifa (precio_mensual) at each generation; a value overrides it.
alter table public.suscripciones alter column precio_mensual drop default;
alter table public.suscripciones alter column inicio set default (now() at time zone 'America/Bogota')::date;
create unique index suscripciones_activa_uq on public.suscripciones (perro_id, servicio_id) where estado = 'activa';

-- Never two charges for the same plan and month.
create unique index prestaciones_mensualidad_uq on public.prestaciones ((detalle ->> 'plan_id'), (detalle ->> 'mensualidad'))
  where (detalle ->> 'mensualidad') is not null;

-- Reads: the dog's owners (policy "suscripciones read own", kept) and the owner or finance office of the business.
-- Writes only through the RPCs below.
drop policy "suscripciones owner" on public.suscripciones;
create policy "suscripciones read finanzas" on public.suscripciones for select to authenticated
  using (negocio_id = public.my_negocio() and (public.is_owner() or public.has_finanzas()));
revoke all on public.suscripciones from authenticated;
grant select on public.suscripciones to authenticated;

-- The money guard: a signed-in owner of tenant p_neg, or its office staff holding the finance permission. A NULL
-- tenant (unknown object, no profile) is a denial.
create function public.assert_finanzas(p_neg uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
begin
  if auth.uid() is null or p_neg is null or p_neg is distinct from public.my_negocio()
     or not (public.is_owner() or public.has_finanzas()) then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
end;
$$;

-- p_mes: any day of the month to charge (default: the current Bogota month). p_plan: only that plan (activation).
-- Returns the charges created. A plan counts when it overlaps the month (inicio <= last day, fin null or >= first
-- day), it is not paused, its dog and service are active and its price is above 0.
create function public.mensualidades_generar(p_mes date default null, p_plan uuid default null) returns integer
  language plpgsql security definer set search_path = '' as
$$
declare
  v_desde date := date_trunc('month', coalesce(p_mes, (now() at time zone 'America/Bogota')::date))::date;
  v_hasta date := (date_trunc('month', coalesce(p_mes, (now() at time zone 'America/Bogota')::date)) + interval '1 month - 1 day')::date;
  v_n     integer := 0;
  v_id    uuid;
  r       record;
begin
  for r in
    select s.id, s.negocio_id, s.perro_id, s.servicio_id, s.inicio, s.modo_cobro, sv.tipo,
           coalesce(s.precio_mensual, t.precio_mensual, 0) as precio
      from public.suscripciones s
      join public.servicios sv on sv.id = s.servicio_id and sv.negocio_id = s.negocio_id and coalesce(sv.activo, true)
      join public.perros p on p.id = s.perro_id and p.negocio_id = s.negocio_id and coalesce(p.activo, true)
      left join public.tarifas t on t.servicio_id = s.servicio_id
     where s.estado in ('activa', 'cancelada') and coalesce(s.inicio, v_desde) <= v_hasta
       and (s.fin is null or s.fin >= v_desde) and (p_plan is null or s.id = p_plan)
     order by s.created_at
  loop
    continue when r.precio <= 0;
    case r.modo_cobro
      when 'fijo' then
        -- The whole month whatever the attendance, dated on the 1st (or on the start day of a plan starting later).
        insert into public.prestaciones (negocio_id, perro_id, servicio_id, tipo, fecha, estado, detalle)
          values (r.negocio_id, r.perro_id, r.servicio_id, r.tipo, greatest(v_desde, r.inicio), 'finalizado',
                  jsonb_build_object('mensualidad', to_char(v_desde, 'YYYY-MM'), 'plan_id', r.id))
          on conflict ((detalle ->> 'plan_id'), (detalle ->> 'mensualidad')) where (detalle ->> 'mensualidad') is not null
          do nothing
          returning id into v_id;
        if found then
          -- prestacion_cobro priced it as a (free) use of a monthly service: the charge is the month.
          update public.cobros set precio_aplicado = r.precio, cobrable = true where prestacion_id = v_id;
          v_n := v_n + 1;
        end if;
    end case;
  end loop;
  return v_n;
end;
$$;

-- p_inicio: today by default (Bogota); from the 1st of the current month up to a year ahead. Returns the plan.
create function public.plan_mensual_activar(p_perro uuid, p_servicio uuid, p_inicio date default null) returns uuid
  language plpgsql security definer set search_path = '' as
$$
declare
  v_hoy    date := (now() at time zone 'America/Bogota')::date;
  v_inicio date := coalesce(p_inicio, (now() at time zone 'America/Bogota')::date);
  v_neg    uuid;
  v_activo boolean;
  v_id     uuid;
begin
  select negocio_id, coalesce(activo, true) into v_neg, v_activo from public.perros where id = p_perro;
  perform public.assert_finanzas(v_neg);  -- also refuses an unknown dog or one of another tenant
  if not v_activo then raise exception 'perro_invalido'; end if;
  if not exists (
    select 1 from public.servicios s join public.tarifas t on t.servicio_id = s.id
     where s.id = p_servicio and s.negocio_id = v_neg and coalesce(s.activo, true) and s.modelo_cobro = 'mensual'
       and s.tipo not in ('comida', 'accesorio') and t.precio_mensual > 0
  ) then
    raise exception 'servicio_invalido';
  end if;
  if v_inicio < date_trunc('month', v_hoy)::date or v_inicio > v_hoy + 366 then raise exception 'fecha_invalida'; end if;
  if exists (select 1 from public.suscripciones where perro_id = p_perro and servicio_id = p_servicio and estado = 'activa') then
    raise exception 'plan_existente';
  end if;

  -- A plan cancelled for a date on or after the new start is resumed: same plan, its months are not charged twice.
  update public.suscripciones set estado = 'activa', fin = null
   where id = (select id from public.suscripciones
                where perro_id = p_perro and servicio_id = p_servicio and estado = 'cancelada' and fin >= v_inicio
                order by fin desc limit 1)
   returning id into v_id;
  if v_id is null then
    insert into public.suscripciones (negocio_id, servicio_id, perro_id, estado, inicio, modo_cobro)
      values (v_neg, p_servicio, p_perro, 'activa', v_inicio, 'fijo')
      returning id into v_id;
  end if;
  perform public.mensualidades_generar(v_hoy, v_id);
  return v_id;
end;
$$;

-- p_fin: the end of the current Bogota month by default; not before today. The months up to p_fin stay charged.
create function public.plan_mensual_cancelar(p_plan uuid, p_fin date default null) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_hoy    date := (now() at time zone 'America/Bogota')::date;
  v_fin    date := coalesce(p_fin, (date_trunc('month', (now() at time zone 'America/Bogota')::date) + interval '1 month - 1 day')::date);
  v_neg    uuid;
  v_estado text;
begin
  select negocio_id, estado into v_neg, v_estado from public.suscripciones where id = p_plan for update;
  perform public.assert_finanzas(v_neg);
  if v_estado <> 'activa' then raise exception 'plan_invalido'; end if;
  if v_fin < v_hoy then raise exception 'fecha_invalida'; end if;
  update public.suscripciones set estado = 'cancelada', fin = v_fin where id = p_plan;
end;
$$;

revoke execute on function public.assert_finanzas(uuid), public.mensualidades_generar(date, uuid) from public, anon, authenticated;
revoke execute on function public.plan_mensual_activar(uuid, uuid, date), public.plan_mensual_cancelar(uuid, date) from public, anon;
grant execute on function public.plan_mensual_activar(uuid, uuid, date), public.plan_mensual_cancelar(uuid, date) to authenticated;

-- ---- monthly job: 06:15 UTC on day 1 = 01:15 Bogota, after dd_agenda_extender. Idempotent like dd_purga_fotos.
select cron.unschedule(jobid) from cron.job where jobname = 'dd_mensualidades';
select cron.schedule('dd_mensualidades', '15 6 1 * *', 'select public.mensualidades_generar()');
