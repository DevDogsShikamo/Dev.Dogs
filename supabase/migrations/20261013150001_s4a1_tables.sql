-- S4a1 / A: side tables for sensitive data, copied from the legacy columns. Purely additive:
-- profiles.telefono / salario_fijo, prestaciones money columns, servicios prices and
-- perros.microchip stay where they are and the app keeps reading them until S4b.
-- Until S4a2 adds the dual-write RPCs nothing keeps these tables in sync, so
-- backfill_side_tables() is idempotent and S4a2 / S4b re-run it before relying on them.

create table public.contactos (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  negocio_id uuid not null references public.negocios(id) on delete cascade,
  rol        text not null check (rol in ('paseador', 'empresa', 'cliente')), -- copy of the immutable profile role
  telefono   text
);

create table public.nomina (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  negocio_id   uuid not null references public.negocios(id) on delete cascade,
  salario_fijo integer not null default 0 check (salario_fijo >= 0)
);

create table public.permisos (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  negocio_id   uuid not null references public.negocios(id) on delete cascade,
  finanzas     boolean not null default false,
  otorgado_por uuid references public.profiles(id) on delete set null,
  updated_at   timestamptz not null default now()
);

create table public.tarifas (
  servicio_id    uuid primary key references public.servicios(id) on delete cascade,
  negocio_id     uuid not null references public.negocios(id) on delete cascade,
  precio         integer not null default 0 check (precio >= 0),
  precio_mensual integer not null default 0 check (precio_mensual >= 0)
);

create table public.cobros (
  prestacion_id  uuid primary key references public.prestaciones(id) on delete cascade,
  negocio_id     uuid not null references public.negocios(id) on delete cascade,
  precio_aplicado integer not null default 0 check (precio_aplicado >= 0),
  cobrable       boolean not null default true,
  cobrado        boolean not null default false,
  confirmado_por uuid references public.profiles(id) on delete set null,
  confirmado_at  timestamptz
);

create table public.perro_identidad (
  perro_id  uuid primary key references public.perros(id) on delete cascade,
  microchip text not null unique
);

-- Upsert from the legacy columns. Closed to API callers (granted to service_role only).
create or replace function public.backfill_side_tables() returns void
  language sql security definer set search_path = '' as
$$
  insert into public.contactos (user_id, negocio_id, rol, telefono)
    select id, negocio_id, rol, telefono from public.profiles where negocio_id is not null
    on conflict (user_id) do update set negocio_id = excluded.negocio_id, rol = excluded.rol, telefono = excluded.telefono;
  insert into public.nomina (user_id, negocio_id, salario_fijo)
    select id, negocio_id, coalesce(salario_fijo, 0) from public.profiles where negocio_id is not null and rol <> 'cliente'
    on conflict (user_id) do update set negocio_id = excluded.negocio_id, salario_fijo = excluded.salario_fijo;
  insert into public.tarifas (servicio_id, negocio_id, precio, precio_mensual)
    select id, negocio_id, coalesce(precio, 0), coalesce(precio_mensual, 0) from public.servicios
    on conflict (servicio_id) do update set negocio_id = excluded.negocio_id, precio = excluded.precio, precio_mensual = excluded.precio_mensual;
  insert into public.cobros (prestacion_id, negocio_id, precio_aplicado, cobrable, cobrado, confirmado_por, confirmado_at)
    select id, negocio_id, coalesce(precio_aplicado, 0), coalesce(cobrable, false), coalesce(cobrado, false), confirmado_por, confirmado_at
    from public.prestaciones
    on conflict (prestacion_id) do update set negocio_id = excluded.negocio_id, precio_aplicado = excluded.precio_aplicado,
      cobrable = excluded.cobrable, cobrado = excluded.cobrado, confirmado_por = excluded.confirmado_por, confirmado_at = excluded.confirmado_at;
  insert into public.perro_identidad (perro_id, microchip)
    select id, microchip from public.perros where microchip is not null
    on conflict (perro_id) do update set microchip = excluded.microchip;
$$;
revoke execute on function public.backfill_side_tables() from public, anon, authenticated;
grant  execute on function public.backfill_side_tables() to service_role;

select public.backfill_side_tables();
