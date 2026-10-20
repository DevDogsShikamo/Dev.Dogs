-- ============================================================================
-- MIGRACIÓN — Grupos recurrentes + membresías con recurrencia POR PERRO.
--
-- Modelo (pedido del usuario: la recurrencia varía por perro):
--   grupos            = el "molde" recurrente: zona, hora, duración, cuidador, color.
--   grupo_membresias  = qué perro pertenece a qué grupo, CADA UNO con su recurrencia.
--   prestaciones.grupo_id = liga la instancia concreta (de un día) a su grupo.
--   profiles.horario  = horario laboral del paseador (jsonb) — se usa en etapa 3.
--
-- La agenda del año NO se guarda día por día como plantilla: se MATERIALIZA en
-- prestaciones para un horizonte (lo hace el seed / una acción "generar"), usando
-- recurrencia_aplica() para saber en qué fechas cae cada perro.
--
-- Recurrencia (jsonb) — formas soportadas:
--   {"tipo":"diario"}                                  todos los días
--   {"tipo":"semanal","dias":["lun","mie","vie"]}      esos días, todas las semanas
--   {"tipo":"cada_n_dias","n":2,"ancla":"2026-09-07"}  días de por medio (n=2), etc.
--   {"tipo":"semanas_alternas","dias":["lun","vie"],"ancla":"2026-09-07"}  semana sí, semana no
--   (agregar "dias" a "diario" lo limita a esos días de semana)
--
-- Correr UNA vez en Supabase → SQL Editor. Idempotente (if not exists / or replace).
-- ============================================================================

create table if not exists public.grupos (
  id           uuid primary key default gen_random_uuid(),
  negocio_id   uuid not null references public.negocios(id) on delete cascade,
  nombre       text not null,
  zona         text,
  servicio_id  uuid references public.servicios(id) on delete set null,
  cuidador_id  uuid references public.profiles(id) on delete set null,
  hora         text not null default '08:00',
  duracion_min integer not null default 90,
  color        text default 'purple',
  activo       boolean default true,
  created_at   timestamptz default now()
);

create table if not exists public.grupo_membresias (
  id          uuid primary key default gen_random_uuid(),
  grupo_id    uuid not null references public.grupos(id) on delete cascade,
  perro_id    uuid not null references public.perros(id) on delete cascade,
  recurrencia jsonb not null default '{"tipo":"diario"}'::jsonb,
  fecha_desde date default current_date,
  fecha_hasta date,
  activo      boolean default true,
  created_at  timestamptz default now(),
  unique (grupo_id, perro_id)
);

alter table public.prestaciones add column if not exists grupo_id uuid references public.grupos(id) on delete set null;
alter table public.profiles     add column if not exists horario jsonb not null default '{}'::jsonb;

create index if not exists idx_prestaciones_grupo on public.prestaciones(grupo_id);
create index if not exists idx_membresias_grupo on public.grupo_membresias(grupo_id);

-- ¿La recurrencia aplica en la fecha d? (isodow: 1=lun … 7=dom)
create or replace function public.recurrencia_aplica(rec jsonb, d date) returns boolean
language plpgsql immutable as $$
declare
  t         text  := coalesce(rec->>'tipo', 'diario');
  ancla     date  := coalesce((rec->>'ancla')::date, date '2024-01-01');
  n         int   := coalesce((rec->>'n')::int, 1);
  dias      jsonb := rec->'dias';
  dow       int   := extract(isodow from d);
  dia_txt   text  := (array['lun','mar','mie','jue','vie','sab','dom'])[dow];
  match_dia boolean;
  wk_diff   int;
begin
  match_dia := (dias is null) or (dias @> to_jsonb(dia_txt));
  if t = 'diario' then
    return match_dia;
  elsif t = 'semanal' then
    return match_dia;
  elsif t = 'cada_n_dias' then
    return d >= ancla and ((d - ancla) % greatest(n, 1)) = 0;
  elsif t = 'semanas_alternas' then
    wk_diff := floor((d - date_trunc('week', ancla)::date) / 7.0);
    return match_dia and (wk_diff % 2) = 0;
  end if;
  return false;
end $$;

-- ---- RLS (espeja el patrón de servicios/prestaciones) ----
alter table public.grupos enable row level security;
drop policy if exists "grupos read staff"    on public.grupos;
drop policy if exists "grupos read cuidador" on public.grupos;
drop policy if exists "grupos write owner"   on public.grupos;
create policy "grupos read staff"    on public.grupos for select using (negocio_id = public.my_negocio());
create policy "grupos read cuidador" on public.grupos for select using (cuidador_id = auth.uid());
create policy "grupos write owner"   on public.grupos for all
  using (negocio_id = public.my_negocio() and public.is_owner())
  with check (negocio_id = public.my_negocio() and public.is_owner());

alter table public.grupo_membresias enable row level security;
drop policy if exists "membresias read"  on public.grupo_membresias;
drop policy if exists "membresias write" on public.grupo_membresias;
create policy "membresias read"  on public.grupo_membresias for select
  using (exists (select 1 from public.grupos g where g.id = grupo_id
                 and (g.negocio_id = public.my_negocio() or g.cuidador_id = auth.uid())));
create policy "membresias write" on public.grupo_membresias for all
  using (exists (select 1 from public.grupos g where g.id = grupo_id and g.negocio_id = public.my_negocio() and public.is_owner()))
  with check (exists (select 1 from public.grupos g where g.id = grupo_id and g.negocio_id = public.my_negocio() and public.is_owner()));

-- ---- RPC: mover un perro de grupo ('siempre' = membresía recurrente + regenera; 'hoy' = solo esa fecha) ----
create or replace function public.mover_perro(p_perro uuid, p_grupo uuid, p_modo text, p_fecha date)
returns void language plpgsql security definer as $$
declare
  v_neg  uuid; v_serv uuid; v_hora text; v_dur int; v_cuid uuid;
begin
  select negocio_id, servicio_id, hora, duracion_min, cuidador_id
    into v_neg, v_serv, v_hora, v_dur, v_cuid
    from public.grupos where id = p_grupo;
  if v_neg is null then return; end if;
  if v_neg <> public.my_negocio() then raise exception 'no autorizado'; end if;

  if p_modo = 'siempre' then
    -- Mover (o crear) la membresía recurrente al nuevo grupo, conservando la recurrencia.
    update public.grupo_membresias set grupo_id = p_grupo
      where perro_id = p_perro
        and grupo_id in (select id from public.grupos where negocio_id = v_neg);
    if not found then
      insert into public.grupo_membresias (grupo_id, perro_id, recurrencia)
        values (p_grupo, p_perro, '{"tipo":"diario"}'::jsonb)
        on conflict (grupo_id, perro_id) do nothing;
    end if;
    -- Regenerar la agenda futura del perro (desde la fecha) según la recurrencia del nuevo grupo.
    delete from public.prestaciones where perro_id = p_perro and negocio_id = v_neg and fecha >= p_fecha;
    insert into public.prestaciones (negocio_id, perro_id, servicio_id, grupo_id, tipo, cuidador_id, fecha, estado, detalle)
    select v_neg, m.perro_id, g.servicio_id, g.id, 'paseo', g.cuidador_id, (p_fecha + gs.i), 'programado',
           jsonb_build_object('hora', g.hora, 'duracion', g.duracion_min, 'direccion', coalesce(g.zona,''))
    from public.grupo_membresias m join public.grupos g on g.id = m.grupo_id
    cross join generate_series(0,56) as gs(i)
    where m.perro_id = p_perro and g.negocio_id = v_neg and m.activo
      and public.recurrencia_aplica(m.recurrencia, (p_fecha + gs.i));
  else
    -- Solo ese día: mover (o crear) la prestación de esa fecha al nuevo grupo.
    update public.prestaciones
      set grupo_id = p_grupo, servicio_id = v_serv,
          detalle = coalesce(detalle,'{}'::jsonb) || jsonb_build_object('hora', v_hora, 'duracion', v_dur)
      where perro_id = p_perro and negocio_id = v_neg and fecha = p_fecha;
    if not found then
      insert into public.prestaciones (negocio_id, perro_id, servicio_id, grupo_id, tipo, cuidador_id, fecha, estado, detalle)
      values (v_neg, p_perro, v_serv, p_grupo, 'paseo', v_cuid, p_fecha, 'programado',
              jsonb_build_object('hora', v_hora, 'duracion', v_dur));
    end if;
  end if;
end $$;

-- Cambiar la HORA de un grupo entero (arrastrar el grupo a otra franja) + re-estampar sus prestaciones futuras.
create or replace function public.grupo_set_hora(p_grupo uuid, p_hora text, p_fecha date)
returns void language plpgsql security definer as $$
declare v_neg uuid;
begin
  select negocio_id into v_neg from public.grupos where id = p_grupo;
  if v_neg is null then return; end if;
  if v_neg <> public.my_negocio() then raise exception 'no autorizado'; end if;
  update public.grupos set hora = p_hora where id = p_grupo;
  update public.prestaciones
    set detalle = coalesce(detalle,'{}'::jsonb) || jsonb_build_object('hora', p_hora)
    where grupo_id = p_grupo and negocio_id = v_neg and fecha >= p_fecha;
end $$;

-- ---- RPC: reprogramar una OCURRENCIA (bloque del calendario) ----
-- 'siempre' (solo si no cambia el día) = cambia la hora recurrente del grupo.
-- 'hoy' = mueve/ajusta solo esa ocurrencia (día y/o hora).
create or replace function public.bloque_reprogramar(p_grupo uuid, p_fecha_old date, p_fecha_new date, p_hora text, p_modo text)
returns void language plpgsql security definer as $$
declare v_neg uuid;
begin
  select negocio_id into v_neg from public.grupos where id = p_grupo;
  if v_neg is null then return; end if;
  if v_neg <> public.my_negocio() then raise exception 'no autorizado'; end if;

  if p_modo = 'siempre' and p_fecha_old = p_fecha_new then
    update public.grupos set hora = p_hora where id = p_grupo;
    update public.prestaciones
      set detalle = coalesce(detalle,'{}'::jsonb) || jsonb_build_object('hora', p_hora)
      where grupo_id = p_grupo and negocio_id = v_neg and fecha >= p_fecha_old;
  else
    update public.prestaciones
      set fecha = p_fecha_new,
          detalle = coalesce(detalle,'{}'::jsonb) || jsonb_build_object('hora', p_hora)
      where grupo_id = p_grupo and negocio_id = v_neg and fecha = p_fecha_old;
  end if;
end $$;
