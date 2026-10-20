-- S2b2: server-side pricing. The browser never sends a price or a paid flag.
--   reservar(...)          the only way a client books a service (own dog, co-owners included)
--   comprar_producto(...)  the only way a client buys a product (principal owner only, D13)
--   cobro_marcar(...)      the only way a charge is marked paid; who and when come from the server
--   prestacion_precio      every row a signed-in caller inserts is priced from the catalogue
-- Clients have no INSERT policy on prestaciones (only "prestaciones owner all" can write),
-- so these functions are the sole client path. Any hand-made INSERT policy is dropped below.
--
-- cobro_marcar writes prestaciones.cobrado / confirmado_por / confirmado_at here, because the
-- `cobros` side table only exists from S4a1. The signature is final, so S4a2/S4b can move the
-- storage without touching callers. Only the business owner may call it until `has_finanzas()`
-- exists (S4a1); S4a2 widens it to office members holding the finance flag.

-- ---- Money sanity -----------------------------------------------------------------------
alter table public.prestaciones  drop constraint if exists prestaciones_precio_nonneg;
alter table public.prestaciones  add  constraint prestaciones_precio_nonneg check (precio_aplicado >= 0);
alter table public.servicios     drop constraint if exists servicios_precio_nonneg;
alter table public.servicios     add  constraint servicios_precio_nonneg check (precio >= 0 and precio_mensual >= 0);
alter table public.suscripciones drop constraint if exists suscripciones_precio_nonneg;
alter table public.suscripciones add  constraint suscripciones_precio_nonneg check (precio_mensual >= 0);

-- ---- No client INSERT path on prestaciones -----------------------------------------------
do $$
declare pol text;
begin
  for pol in select policyname from pg_policies
             where schemaname = 'public' and tablename = 'prestaciones' and cmd = 'INSERT'
  loop
    execute format('drop policy %I on public.prestaciones', pol);
  end loop;
end $$;

-- ---- Price trigger ---------------------------------------------------------------------------
-- Signed-in callers (owner insert, reservar, comprar_producto, mover_perro) never choose the
-- amount: catalogue unit price x detalle.cantidad (products only, 1..1000), 0 without a service,
-- and a monthly service is not charged per use. A new row can never start paid. Callers without
-- a JWT (seeds, SQL editor, migrations) are left alone.
create or replace function public.prestacion_precio() returns trigger
  language plpgsql security definer set search_path = '' as
$$
declare
  v_precio integer; v_modelo text; v_qty integer := 1;
begin
  if auth.uid() is null then return new; end if;
  new.cobrado := false; new.confirmado_por := null; new.confirmado_at := null;
  new.precio_aplicado := 0;
  if new.servicio_id is not null then
    select precio, modelo_cobro into v_precio, v_modelo
      from public.servicios where id = new.servicio_id and negocio_id = new.negocio_id;
    if v_modelo = 'mensual' then
      new.cobrable := false;
    elsif v_modelo is not null then
      if new.tipo in ('comida', 'accesorio') and jsonb_typeof(new.detalle -> 'cantidad') = 'number' then
        v_qty := least(greatest(floor((new.detalle ->> 'cantidad')::numeric), 1), 1000)::integer;
      end if;
      new.precio_aplicado := coalesce(v_precio, 0) * v_qty;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prestacion_precio on public.prestaciones;
create trigger trg_prestacion_precio before insert on public.prestaciones
  for each row execute function public.prestacion_precio();

-- ---- reservar: a client books a service for a dog it owns -----------------------------------
-- type, assignee, hour, tenant and price all come from the service and group rows.
create or replace function public.reservar(p_perro uuid, p_servicio uuid, p_grupo uuid, p_fecha date)
  returns uuid language plpgsql security definer set search_path = '' as
$$
declare
  v_neg  uuid := public.my_negocio();
  v_hoy  date := (now() at time zone 'America/Bogota')::date;
  v_tipo text; v_gserv uuid; v_cuid uuid; v_hora text; v_id uuid;
begin
  if auth.uid() is null or v_neg is null or not public.owns_dog(p_perro) then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if not exists (select 1 from public.perros where id = p_perro and negocio_id = v_neg and coalesce(activo, true)) then
    raise exception 'perro_invalido';
  end if;
  select tipo into v_tipo from public.servicios
    where id = p_servicio and negocio_id = v_neg and coalesce(activo, true) and tipo not in ('comida', 'accesorio');
  if not found then raise exception 'servicio_invalido'; end if;
  if p_grupo is not null then
    select servicio_id, cuidador_id, hora into v_gserv, v_cuid, v_hora from public.grupos
      where id = p_grupo and negocio_id = v_neg and coalesce(activo, true);
    if not found or v_gserv is distinct from p_servicio then raise exception 'grupo_invalido'; end if;
  end if;
  if p_fecha is null or p_fecha < v_hoy or p_fecha > v_hoy + 365 then raise exception 'fecha_invalida'; end if;

  insert into public.prestaciones (negocio_id, perro_id, servicio_id, grupo_id, tipo, cuidador_id, fecha, estado, detalle)
    values (v_neg, p_perro, p_servicio, p_grupo, v_tipo, v_cuid, p_fecha, 'programado',
            case when p_grupo is null then '{}'::jsonb else jsonb_build_object('hora', v_hora) end)
    returning id into v_id;
  return v_id;
end;
$$;

-- ---- comprar_producto: the principal owner buys food or accessories --------------------------
-- Registered as a finished service of today so it flows into invoices and reports.
create or replace function public.comprar_producto(p_perro uuid, p_servicio uuid, p_cantidad integer)
  returns uuid language plpgsql security definer set search_path = '' as
$$
declare
  v_neg  uuid := public.my_negocio();
  v_tipo text; v_id uuid;
begin
  if auth.uid() is null or v_neg is null or not public.is_principal(p_perro) then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if not exists (select 1 from public.perros where id = p_perro and negocio_id = v_neg and coalesce(activo, true)) then
    raise exception 'perro_invalido';
  end if;
  if p_cantidad is null or p_cantidad not between 1 and 20 then raise exception 'cantidad_invalida'; end if;
  select tipo into v_tipo from public.servicios
    where id = p_servicio and negocio_id = v_neg and coalesce(activo, true) and tipo in ('comida', 'accesorio');
  if not found then raise exception 'servicio_invalido'; end if;

  insert into public.prestaciones (negocio_id, perro_id, servicio_id, tipo, fecha, estado, detalle)
    values (v_neg, p_perro, p_servicio, v_tipo, (now() at time zone 'America/Bogota')::date, 'finalizado',
            jsonb_build_object('cantidad', p_cantidad))
    returning id into v_id;
  return v_id;
end;
$$;

-- ---- cobro_marcar: the business owner marks a finished charge as paid ------------------------
-- An unknown id and another tenant's id get the same 42501. A replay keeps the first confirmation.
create or replace function public.cobro_marcar(p_prestacion uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  r record;
begin
  if auth.uid() is null then raise exception 'no_autorizado' using errcode = '42501'; end if;
  select id, negocio_id, estado, cobrable, cobrado into r from public.prestaciones where id = p_prestacion for update;
  if not found or r.negocio_id is distinct from public.my_negocio() or not public.is_owner() then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if r.cobrado then return; end if;
  if r.estado <> 'finalizado' or r.cobrable is distinct from true then raise exception 'no_cobrable'; end if;
  update public.prestaciones set cobrado = true, confirmado_por = auth.uid(), confirmado_at = now() where id = r.id;
end;
$$;

revoke execute on function public.reservar(uuid, uuid, uuid, date) from public, anon;
revoke execute on function public.comprar_producto(uuid, uuid, integer) from public, anon;
revoke execute on function public.cobro_marcar(uuid) from public, anon;
grant execute on function public.reservar(uuid, uuid, uuid, date) to authenticated;
grant execute on function public.comprar_producto(uuid, uuid, integer) to authenticated;
grant execute on function public.cobro_marcar(uuid) to authenticated;
