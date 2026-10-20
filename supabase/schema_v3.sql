-- ============================================================================
-- DevDogs — SCHEMA v3 (dog-centric, multi-tenant, extensible)
-- Run in Supabase → SQL Editor → New query → Run.
--
-- ⚠️ DESTRUCTIVO: elimina las tablas v1/v2 (solo data de prueba) y recrea el modelo.
--
-- FILOSOFÍA (lo que hace esto extensible sin fricción):
--   1. El PERRO es el aggregate root. Todo cuelga del perro, no de la cita.
--   2. `servicios.tipo` es un CATÁLOGO POLIMÓRFICO. El CHECK ya incluye los
--      verticales futuros (comida/accesorio/veterinaria) aunque hoy solo se usen
--      paseo/guarderia → el roadmap queda DENOTADO en el schema.
--   3. `prestaciones` es un SPINE genérico para servicios agendados (paseo+guardería
--      ahora, veterinaria después). Lo específico de cada vertical vive en `detalle`
--      (JSONB) → agregar atributos de un vertical NO requiere migración.
--   4. El COMERCIO (comida/accesorios/helados) es un spine SEPARADO (`ordenes`) que se
--      agrega después referenciando el core, SIN tocar nada de lo de acá. Ver el bloque
--      "PUNTO DE ENGANCHE FUTURO" al final.
--   GARANTÍA: nunca hay que alterar el core ni un vertical existente para sumar otro.
--
-- Modelo:
--   negocios (tenant) ─┬─ profiles (owner/paseador/cliente, con verificación Didit)
--                      ├─ invitaciones (alta por invitación, NO por link público)
--                      ├─ perros (raíz; identidad canónica = microchip)
--                      │    └─ perro_duenos (N↔N persona↔perro + co-dueños)
--                      ├─ servicios (catálogo polimórfico por tipo)
--                      ├─ suscripciones (mensualidad fija, agnóstica al vertical)
--                      └─ prestaciones (spine: paseo/guardería/… = libro de salidas)
-- ============================================================================

create extension if not exists pgcrypto;

-- ---- limpieza v1/v2 --------------------------------------------------------
drop table if exists public.prestaciones  cascade;
drop table if exists public.citas         cascade;
drop table if exists public.recurrencias  cascade;
drop table if exists public.grupos        cascade;
drop table if exists public.suscripciones cascade;
drop table if exists public.servicios     cascade;
drop table if exists public.perro_duenos  cascade;
drop table if exists public.perros        cascade;
drop table if exists public.mascotas      cascade;
drop table if exists public.invitaciones  cascade;
drop table if exists public.empresa       cascade;
drop table if exists public.profiles      cascade;
drop table if exists public.negocios      cascade;

-- ============================================================================
-- NEGOCIOS — el tenant. Un paseador independiente O una empresa.
-- (El slug ya NO es la puerta de entrada; queda opcional para una página pública futura.)
-- ============================================================================
create table public.negocios (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre     text not null,
  tipo       text not null default 'independiente' check (tipo in ('independiente','empresa')),
  slug       text unique,                 -- opcional, futura vitrina pública (no es el acceso)
  eslogan    text,
  telefono   text,
  ciudad     text,
  created_at timestamptz default now()
);

-- ============================================================================
-- PROFILES — un registro por usuario. Rol + negocio + estado de verificación (Didit).
-- ============================================================================
create table public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  negocio_id        uuid references public.negocios(id) on delete set null,
  rol               text not null check (rol in ('paseador','empresa','cliente')),
  nombre            text,
  telefono          text,
  zona              text,
  salario_fijo      integer default 0,      -- pago fijo mensual (paseador empleado)
  verificado        boolean default false,  -- pasó verificación de identidad (Didit)
  verificado_at     timestamptz,
  didit_session_id  text,                   -- referencia a la sesión de Didit
  created_at        timestamptz default now()
);

-- Helpers SECURITY DEFINER: leen sin disparar RLS (evitan recursión en las políticas).
create or replace function public.my_negocio() returns uuid
  language sql stable security definer set search_path = public as
$$ select negocio_id from public.profiles where id = auth.uid() $$;

create or replace function public.my_rol() returns text
  language sql stable security definer set search_path = public as
$$ select rol from public.profiles where id = auth.uid() $$;

create or replace function public.is_owner() returns boolean
  language sql stable security definer set search_path = public as
$$ select exists(select 1 from public.negocios where id = public.my_negocio() and owner_id = auth.uid()) $$;

-- owns_dog() se define MÁS ABAJO, después de crear la tabla perro_duenos:
-- las funciones LANGUAGE sql validan su cuerpo al crearse, así que la tabla debe existir antes.

-- ============================================================================
-- INVITACIONES — alta por invitación (reemplaza el link público de negocio).
-- La empresa invita a clientes/paseadores; el código los asocia a SU negocio.
-- ============================================================================
create table public.invitaciones (
  id           uuid primary key default gen_random_uuid(),
  negocio_id   uuid not null references public.negocios(id) on delete cascade,
  rol          text not null check (rol in ('paseador','cliente')),
  email        text,
  codigo       text not null unique,
  estado       text not null default 'pendiente' check (estado in ('pendiente','aceptada','expirada')),
  invitado_por uuid references public.profiles(id) on delete set null,
  created_at   timestamptz default now(),
  expires_at   timestamptz
);

-- ============================================================================
-- PERROS — el aggregate root. Identidad canónica = microchip (único, anti-duplicado).
-- ============================================================================
create table public.perros (
  id           uuid primary key default gen_random_uuid(),
  negocio_id   uuid not null references public.negocios(id) on delete cascade,
  nombre       text not null,
  raza         text,
  tamano       text check (tamano in ('pequeno','mediano','grande')),
  conducta     text,                       -- 'tranquilo' | 'energico' | 'reactivo' | ...
  compatible   boolean default true,       -- puede salir con otros perros
  microchip    text unique,                -- ISO 11784/85; identidad única real del perro
  tips         text,
  foto_url     text,                        -- REFERENCIA a object storage (Storage/S3). NUNCA blob en DB.
  activo       boolean default true,
  created_at   timestamptz default now()
);

-- ============================================================================
-- PERRO_DUENOS — N↔N persona↔perro. Una persona varios perros; un perro varios dueños.
-- Co-dueño invitado = fila con estado 'pendiente' hasta que acepta.
-- ============================================================================
create table public.perro_duenos (
  id           uuid primary key default gen_random_uuid(),
  perro_id     uuid not null references public.perros(id) on delete cascade,
  dueno_id     uuid not null references public.profiles(id) on delete cascade,
  rol          text not null default 'principal' check (rol in ('principal','co')),
  estado       text not null default 'activo'    check (estado in ('activo','pendiente')),
  invitado_por uuid references public.profiles(id) on delete set null,
  created_at   timestamptz default now(),
  unique (perro_id, dueno_id)
);

-- ¿El usuario actual es dueño (principal o co) de este perro? Para que el cliente
-- vea SOLO lo de sus perros. SECURITY DEFINER para no recursar sobre perro_duenos.
create or replace function public.owns_dog(pid uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select exists(
     select 1 from public.perro_duenos
     where perro_id = pid and dueno_id = auth.uid() and estado = 'activo'
   ) $$;

-- ============================================================================
-- SERVICIOS — CATÁLOGO POLIMÓRFICO del negocio. El `tipo` ya incluye los verticales
-- futuros: agregar comida/accesorios/vet al catálogo NO requiere migración.
-- ============================================================================
create table public.servicios (
  id             uuid primary key default gen_random_uuid(),
  negocio_id     uuid not null references public.negocios(id) on delete cascade,
  tipo           text not null check (tipo in ('paseo','guarderia','comida','accesorio','veterinaria')),
  nombre         text not null,
  descripcion    text,
  emoji          text,
  modelo_cobro   text not null default 'por_uso' check (modelo_cobro in ('por_uso','mensual')),
  precio         integer default 0,         -- precio por uso (paseo/día de guardería/…)
  precio_mensual integer default 0,         -- si mensual
  duracion_min   integer default 0,         -- aplica a servicios con duración (paseo)
  activo         boolean default true,
  config         jsonb   default '{}'::jsonb,-- ajustes específicos del tipo, sin migración
  created_at     timestamptz default now()
);

-- ============================================================================
-- SUSCRIPCIONES — mensualidad fija (agnóstica al vertical). El perro con fijo mensual
-- no suma cobro por prestación; su cobro sale de acá.
-- ============================================================================
create table public.suscripciones (
  id             uuid primary key default gen_random_uuid(),
  negocio_id     uuid not null references public.negocios(id) on delete cascade,
  servicio_id    uuid references public.servicios(id) on delete set null,
  perro_id       uuid references public.perros(id) on delete cascade,
  dueno_id       uuid references public.profiles(id) on delete set null,
  estado         text not null default 'activa' check (estado in ('activa','pausada','cancelada')),
  precio_mensual integer default 0,
  inicio         date default current_date,
  fin            date,
  created_at     timestamptz default now()
);

-- ============================================================================
-- PRESTACIONES — el SPINE de servicios agendados (paseo + guardería hoy; vet luego).
-- Es el "libro de salidas/estadías": el paseador reporta, la empresa confirma, se cuenta.
--   estado genérico compartido por todos los verticales de servicio.
--   `detalle` (JSONB) guarda lo específico → nuevo vertical = sin migración.
--     paseo:     { duracion, direccion, hora_recibido, hora_entrega, motivo_no_salio }
--     guarderia: { check_in, check_out, dias }
-- ============================================================================
create table public.prestaciones (
  id             uuid primary key default gen_random_uuid(),
  negocio_id     uuid not null references public.negocios(id) on delete cascade,
  perro_id       uuid not null references public.perros(id) on delete cascade,
  servicio_id    uuid references public.servicios(id) on delete set null,
  tipo           text not null check (tipo in ('paseo','guarderia','comida','accesorio','veterinaria')),
  cuidador_id    uuid references public.profiles(id) on delete set null,  -- paseador/encargado asignado
  fecha          date default current_date,
  estado         text not null default 'programado'
                   check (estado in ('programado','recibido','en_curso','finalizado','no_asistio','cancelado')),
  precio_aplicado integer default 0,
  cobrable       boolean default true,      -- false si el perro va por mensualidad fija
  cobrado        boolean default false,
  confirmado_por uuid references public.profiles(id) on delete set null, -- empresa confirma el reporte (P4)
  confirmado_at  timestamptz,
  detalle        jsonb default '{}'::jsonb,  -- campos específicos del vertical
  created_at     timestamptz default now()
);
create index on public.prestaciones (negocio_id, fecha);
create index on public.prestaciones (perro_id, fecha);
create index on public.prestaciones (cuidador_id, fecha);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table public.negocios      enable row level security;
alter table public.profiles      enable row level security;
alter table public.invitaciones  enable row level security;
alter table public.perros        enable row level security;
alter table public.perro_duenos  enable row level security;
alter table public.servicios     enable row level security;
alter table public.suscripciones enable row level security;
alter table public.prestaciones  enable row level security;

-- NEGOCIOS: autenticado lee (para resolver el tenant); solo el dueño escribe el suyo.
create policy "negocios read"   on public.negocios for select using (auth.role() = 'authenticated');
create policy "negocios insert" on public.negocios for insert with check (owner_id = auth.uid());
create policy "negocios update" on public.negocios for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- PROFILES: ves el tuyo; el dueño ve los de su negocio.
create policy "profiles read self"   on public.profiles for select using (id = auth.uid());
create policy "profiles read tenant" on public.profiles for select using (negocio_id = public.my_negocio() and public.is_owner());
create policy "profiles insert self" on public.profiles for insert with check (id = auth.uid());
create policy "profiles update self" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles update owner" on public.profiles for update using (negocio_id = public.my_negocio() and public.is_owner());

-- INVITACIONES: el dueño gestiona las de su negocio. (El canje se hace por función server-side.)
create policy "invitaciones owner" on public.invitaciones for all
  using (negocio_id = public.my_negocio() and public.is_owner())
  with check (negocio_id = public.my_negocio() and public.is_owner());

-- PERROS: el cliente ve/gestiona SUS perros; empresa y paseadores del negocio los leen.
create policy "perros read own"    on public.perros for select using (public.owns_dog(id));
create policy "perros read staff"  on public.perros for select using (negocio_id = public.my_negocio() and public.my_rol() in ('empresa','paseador'));
create policy "perros write own"   on public.perros for all
  using (public.owns_dog(id)) with check (negocio_id = public.my_negocio());
create policy "perros write owner" on public.perros for all
  using (negocio_id = public.my_negocio() and public.is_owner())
  with check (negocio_id = public.my_negocio() and public.is_owner());

-- PERRO_DUENOS: el dueño ve sus vínculos; el staff del negocio los ve; un dueño puede
-- invitar co-dueños a un perro que ya posee.
create policy "perro_duenos read self"  on public.perro_duenos for select using (dueno_id = auth.uid());
create policy "perro_duenos read staff" on public.perro_duenos for select
  using (exists (select 1 from public.perros p where p.id = perro_id and p.negocio_id = public.my_negocio() and public.my_rol() in ('empresa','paseador')));
create policy "perro_duenos invite"     on public.perro_duenos for insert with check (public.owns_dog(perro_id));
create policy "perro_duenos update self" on public.perro_duenos for update using (dueno_id = auth.uid()) with check (dueno_id = auth.uid());
create policy "perro_duenos owner"      on public.perro_duenos for all
  using (exists (select 1 from public.perros p where p.id = perro_id and p.negocio_id = public.my_negocio() and public.is_owner()))
  with check (exists (select 1 from public.perros p where p.id = perro_id and p.negocio_id = public.my_negocio() and public.is_owner()));

-- SERVICIOS: todos en el negocio leen el catálogo; solo el dueño escribe.
create policy "servicios read"  on public.servicios for select using (negocio_id = public.my_negocio());
create policy "servicios write" on public.servicios for all
  using (negocio_id = public.my_negocio() and public.is_owner())
  with check (negocio_id = public.my_negocio() and public.is_owner());

-- SUSCRIPCIONES: el cliente ve las de sus perros; el dueño gestiona todas.
create policy "suscripciones read own"  on public.suscripciones for select using (public.owns_dog(perro_id));
create policy "suscripciones owner"     on public.suscripciones for all
  using (negocio_id = public.my_negocio() and public.is_owner())
  with check (negocio_id = public.my_negocio() and public.is_owner());

-- PRESTACIONES: cliente ve las de SUS perros; paseador las asignadas; dueño todas del negocio.
create policy "prestaciones read own"      on public.prestaciones for select using (public.owns_dog(perro_id));
create policy "prestaciones read cuidador" on public.prestaciones for select using (cuidador_id = auth.uid());
create policy "prestaciones read owner"    on public.prestaciones for select using (negocio_id = public.my_negocio() and public.is_owner());
-- el paseador actualiza las asignadas (check-in/out, estados); el dueño gestiona todas.
create policy "prestaciones cuidador update" on public.prestaciones for update
  using (cuidador_id = auth.uid()) with check (cuidador_id = auth.uid());
create policy "prestaciones owner all"     on public.prestaciones for all
  using (negocio_id = public.my_negocio() and public.is_owner())
  with check (negocio_id = public.my_negocio() and public.is_owner());

-- ============================================================================
-- CANJE DE INVITACIONES — el usuario recién registrado canjea su código y queda
-- asociado a su negocio con su rol. SECURITY DEFINER: valida el código en nombre
-- del usuario (que NO tiene acceso de lectura a invitaciones) y escribe su profile.
-- ============================================================================
create or replace function public.redeem_invite(p_codigo text)
  returns uuid
  language plpgsql security definer set search_path = public as
$$
declare
  inv public.invitaciones;
begin
  select * into inv from public.invitaciones
    where codigo = p_codigo and estado = 'pendiente'
      and (expires_at is null or expires_at > now())
    limit 1;
  if inv.id is null then
    raise exception 'Invitación inválida o expirada';
  end if;
  insert into public.profiles (id, negocio_id, rol)
    values (auth.uid(), inv.negocio_id, inv.rol)
    on conflict (id) do update set negocio_id = excluded.negocio_id, rol = excluded.rol;
  update public.invitaciones set estado = 'aceptada' where id = inv.id;
  return inv.negocio_id;
end;
$$;

-- ============================================================================
-- PUNTO DE ENGANCHE FUTURO (NO crear ahora — documentado para que quede claro
-- que el comercio entra SIN tocar lo de arriba):
--
--   COMERCIO (comida, accesorios, helados P5) = spine separado, e-commerce:
--     ordenes(id, negocio_id, perro_id?, dueno_id, estado, total, created_at)
--     orden_items(id, orden_id, servicio_id -> servicios(tipo in comida/accesorio), cantidad, precio)
--   Oferta masiva en guardería (helados a todos los asignados ese día) = crear N `ordenes`
--   para los perros con prestacion tipo 'guarderia' de la fecha. Referencia perros/servicios
--   del core; el core NO cambia.
--
--   VETERINARIA (tangencial) = usa el mismo spine `prestaciones` con tipo 'veterinaria'
--   y su propio `detalle` JSONB. Cero cambios estructurales.
-- ============================================================================
