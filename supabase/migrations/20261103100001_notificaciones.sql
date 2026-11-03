-- F6 in-app notifications of the business portal (owner and office staff of a company business).
--   notificaciones       one row per client event, written only by the AFTER triggers below (definer): clients never
--                        insert. resumen is a short summary without contact data (dog, service, date; rating; reason).
--                        para: 'office' = the owner and the office staff, 'owner' = the owner only ("Jefe controla más").
--     reserva / compra   a client books a service (reservar) or buys a product (comprar_producto)      -> office
--     cancelacion        a client cancels a booking (reserva_cancelar)                                 -> office
--     resena             a review becomes pending approval (new, or edited after moderation)           -> owner
--     perro_nuevo        a client registers a dog (crear_mi_perro); only the owner manages Perros      -> owner
--     foto_reporte       a client reports a walk photo (foto_reportar)                                 -> office
--                        "A client" = the caller's profile is rol cliente; the business's own writes and the cron jobs
--                        (no JWT) notify nobody. Only company businesses: an independent walker has no business portal.
--   notificacion_leidas  per-user read marks (one row per notification read).
--   Both tables: RLS on, no grants. The RPCs are for the office staff of the business (is_office(), the owner
--   included); anyone else, a removed member too, gets 42501.
--     notificaciones_mias(p_limit 1..100, default 50; p_antes)  newest first, older than p_antes
--     notificaciones_sin_leer()  unread count · notificacion_leer(p_id) · notificaciones_leer_todas()
--   Retention: 90 days. The RPCs never show older rows and the daily pg_cron job dd_notificaciones_purga deletes them.

create table public.notificaciones (
  id         uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios (id) on delete cascade,
  tipo       text not null check (tipo in ('reserva', 'compra', 'cancelacion', 'resena', 'perro_nuevo', 'foto_reporte')),
  ref_id     uuid not null,
  resumen    text not null check (char_length(resumen) <= 200),
  para       text not null check (para in ('owner', 'office')),
  created_at timestamptz not null default now()
);
create index on public.notificaciones (negocio_id, created_at desc);
create index on public.notificaciones (created_at);

create table public.notificacion_leidas (
  notificacion_id uuid not null references public.notificaciones (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  primary key (notificacion_id, user_id)
);

alter table public.notificaciones      enable row level security;
alter table public.notificacion_leidas enable row level security;
revoke all on public.notificaciones, public.notificacion_leidas from public, anon, authenticated;

-- ---- writers (internal) -----------------------------------------------------------------------------------
create function public.notificacion_crear(p_neg uuid, p_tipo text, p_ref uuid, p_resumen text, p_para text) returns void
  language sql security definer set search_path = '' as
$$
  insert into public.notificaciones (negocio_id, tipo, ref_id, resumen, para)
  select p_neg, p_tipo, p_ref, left(coalesce(p_resumen, ''), 200), p_para
   where exists (select 1 from public.negocios where id = p_neg and tipo = 'empresa')
$$;

-- A booking or purchase (insert) and a cancellation (update to cancelado) made by a client.
create function public.notif_prestacion() returns trigger
  language plpgsql security definer set search_path = '' as
$$
declare
  v_resumen text;
begin
  if public.my_rol() is distinct from 'cliente' then return null; end if;
  select concat_ws(' · ', p.nombre, s.nombre, to_char(new.fecha, 'DD/MM/YYYY') || coalesce(' ' || nullif(new.detalle->>'hora', ''), ''))
    into v_resumen
    from public.perros p left join public.servicios s on s.id = new.servicio_id
   where p.id = new.perro_id;
  perform public.notificacion_crear(new.negocio_id,
    case when tg_op = 'UPDATE' then 'cancelacion' when new.tipo in ('comida', 'accesorio') then 'compra' else 'reserva' end,
    new.id, v_resumen, 'office');
  return null;
end;
$$;
create trigger trg_notif_prestacion_alta after insert on public.prestaciones
  for each row execute function public.notif_prestacion();
create trigger trg_notif_prestacion_cancela after update of estado on public.prestaciones
  for each row when (new.estado = 'cancelado' and old.estado is distinct from 'cancelado')
  execute function public.notif_prestacion();

-- A review that needs moderation: new, or sent back to pending by an edit (resena_guardar). Editing a review that
-- is still pending adds nothing: it already waits in Reseñas.
create function public.notif_resena() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  if new.estado = 'pendiente' and (tg_op = 'INSERT' or old.estado is distinct from 'pendiente') then
    perform public.notificacion_crear(new.negocio_id, 'resena', new.id, 'Calificación ' || new.rating || ' de 5', 'owner');
  end if;
  return null;
end;
$$;
create trigger trg_notif_resena after insert or update of estado on public.resenas
  for each row execute function public.notif_resena();

create function public.notif_perro_nuevo() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  if public.my_rol() = 'cliente' then
    perform public.notificacion_crear(new.negocio_id, 'perro_nuevo', new.id, concat_ws(' · ', new.nombre, new.raza), 'owner');
  end if;
  return null;
end;
$$;
create trigger trg_notif_perro_nuevo after insert on public.perros
  for each row execute function public.notif_perro_nuevo();

-- foto_reportar inserts the report before it deletes or hides the photo, so its tags are still there.
create function public.notif_foto_reporte() returns trigger
  language plpgsql security definer set search_path = '' as
$$
declare
  v_perros text;
begin
  select string_agg(distinct p.nombre, ', ' order by p.nombre) into v_perros
    from public.paseo_foto_perros t join public.perros p on p.id = t.perro_id
   where t.foto_id = new.foto_id;
  perform public.notificacion_crear(new.negocio_id, 'foto_reporte', new.id,
    concat_ws(' · ', v_perros, case new.motivo when 'aparece_persona' then 'Aparece una persona'
                                               when 'aparece_menor' then 'Aparece un menor de edad' else 'Otro motivo' end),
    'office');
  return null;
end;
$$;
create trigger trg_notif_foto_reporte after insert on public.fotos_reportes
  for each row execute function public.notif_foto_reporte();

-- ---- readers ------------------------------------------------------------------------------------------------
-- What the caller sees: its business, not older than 90 days, owner-only rows for the owner.
-- ponytail: p_antes is a created_at cursor; two notifications of one transaction share it, add an id tiebreak if
-- a single statement ever creates several.
create function public.notificaciones_mias(p_limit integer default 50, p_antes timestamptz default null)
  returns table (id uuid, tipo text, ref_id uuid, resumen text, created_at timestamptz, leida boolean)
  language plpgsql stable security definer set search_path = '' as
$$
declare
  v_neg   uuid := public.my_negocio();
  v_owner boolean := public.is_owner();
begin
  if auth.uid() is null or not public.is_office() then raise exception 'no_autorizado' using errcode = '42501'; end if;
  return query
    select n.id, n.tipo, n.ref_id, n.resumen, n.created_at,
           exists (select 1 from public.notificacion_leidas l where l.notificacion_id = n.id and l.user_id = auth.uid())
      from public.notificaciones n
     where n.negocio_id = v_neg and (n.para = 'office' or v_owner) and n.created_at > now() - interval '90 days'
       and (p_antes is null or n.created_at < p_antes)
     order by n.created_at desc, n.id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

create function public.notificaciones_sin_leer() returns integer
  language plpgsql stable security definer set search_path = '' as
$$
declare
  v_neg   uuid := public.my_negocio();
  v_owner boolean := public.is_owner();
begin
  if auth.uid() is null or not public.is_office() then raise exception 'no_autorizado' using errcode = '42501'; end if;
  return (select count(*)::integer from public.notificaciones n
           where n.negocio_id = v_neg and (n.para = 'office' or v_owner) and n.created_at > now() - interval '90 days'
             and not exists (select 1 from public.notificacion_leidas l where l.notificacion_id = n.id and l.user_id = auth.uid()));
end;
$$;

-- A notification the caller does not see (another business, owner-only, expired, unknown): 42501.
create function public.notificacion_leer(p_id uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
begin
  if auth.uid() is null or not public.is_office() or not exists (
    select 1 from public.notificaciones n
     where n.id = p_id and n.negocio_id = public.my_negocio() and (n.para = 'office' or public.is_owner())
       and n.created_at > now() - interval '90 days') then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  insert into public.notificacion_leidas (notificacion_id, user_id) values (p_id, auth.uid()) on conflict do nothing;
end;
$$;

create function public.notificaciones_leer_todas() returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_neg   uuid := public.my_negocio();
  v_owner boolean := public.is_owner();
begin
  if auth.uid() is null or not public.is_office() then raise exception 'no_autorizado' using errcode = '42501'; end if;
  insert into public.notificacion_leidas (notificacion_id, user_id)
    select n.id, auth.uid() from public.notificaciones n
     where n.negocio_id = v_neg and (n.para = 'office' or v_owner) and n.created_at > now() - interval '90 days'
    on conflict do nothing;
end;
$$;

-- ---- retention ----------------------------------------------------------------------------------------------
create function public.notificaciones_purgar() returns integer
  language sql security definer set search_path = '' as
$$
  with borradas as (delete from public.notificaciones where created_at <= now() - interval '90 days' returning 1)
  select count(*)::integer from borradas
$$;
select cron.unschedule(jobid) from cron.job where jobname = 'dd_notificaciones_purga';
select cron.schedule('dd_notificaciones_purga', '45 3 * * *', 'select public.notificaciones_purgar()');

revoke execute on function public.notificacion_crear(uuid, text, uuid, text, text), public.notif_prestacion(),
  public.notif_resena(), public.notif_perro_nuevo(), public.notif_foto_reporte(), public.notificaciones_purgar()
  from public, anon, authenticated;
revoke execute on function public.notificaciones_mias(integer, timestamptz), public.notificaciones_sin_leer(),
  public.notificacion_leer(uuid), public.notificaciones_leer_todas() from public, anon;
grant execute on function public.notificaciones_mias(integer, timestamptz), public.notificaciones_sin_leer(),
  public.notificacion_leer(uuid), public.notificaciones_leer_todas() to authenticated;
