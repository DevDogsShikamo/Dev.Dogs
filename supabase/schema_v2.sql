-- ============================================================================
-- DevDogs — SCHEMA v2 (multi-tenant, link-based, role-aware)
-- Fase 1: Fundaciones. Run in Supabase → SQL Editor → New query → Run.
--
-- ⚠️ DESTRUCTIVO: elimina las tablas v1 (empresa/servicios/citas) con sus datos
--    de prueba y las recrea con el modelo multi-tenant. Solo hay data de test.
--
-- Modelo:
--   negocio (tenant, con slug/link)  ──┬── profiles (owner/paseador/cliente)
--                                      ├── servicios (catálogo del negocio)
--                                      ├── mascotas (de cada cliente)
--                                      ├── grupos (de paseo)
--                                      ├── recurrencias (reglas)
--                                      └── citas (cliente+mascota+servicio+paseador)
-- ============================================================================

-- ---- limpieza v1 -----------------------------------------------------------
drop table if exists public.citas       cascade;
drop table if exists public.servicios   cascade;
drop table if exists public.empresa     cascade;
drop table if exists public.mascotas    cascade;
drop table if exists public.grupos      cascade;
drop table if exists public.recurrencias cascade;
drop table if exists public.profiles    cascade;
drop table if exists public.negocios    cascade;

-- ============================================================================
-- NEGOCIOS — el tenant. Un paseador independiente O una empresa.
-- ============================================================================
create table public.negocios (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  slug       text not null unique,                          -- el link: devdogs.co/<slug>
  tipo       text not null default 'independiente' check (tipo in ('independiente','empresa')),
  nombre     text not null,
  eslogan    text,
  telefono   text,
  ciudad     text,
  created_at timestamptz default now()
);

-- ============================================================================
-- PROFILES — un registro por usuario (auth.uid). Define rol y a qué negocio pertenece.
--   rol: 'paseador' (independiente-dueño o empleado), 'empresa' (admin), 'cliente'
-- ============================================================================
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  negocio_id  uuid references public.negocios(id) on delete set null,
  rol         text not null check (rol in ('paseador','empresa','cliente')),
  nombre      text,
  telefono    text,
  zona        text,                    -- zona/barrio asignada (paseador) o del cliente
  salario_fijo integer default 0,      -- pago fijo mensual (paseador empleado)
  created_at  timestamptz default now()
);

-- Helpers SECURITY DEFINER: leen profiles sin disparar RLS (evita recursión).
create or replace function public.my_negocio() returns uuid
  language sql stable security definer set search_path = public as
$$ select negocio_id from public.profiles where id = auth.uid() $$;

create or replace function public.my_rol() returns text
  language sql stable security definer set search_path = public as
$$ select rol from public.profiles where id = auth.uid() $$;

create or replace function public.is_owner() returns boolean
  language sql stable security definer set search_path = public as
$$ select exists(select 1 from public.negocios where id = public.my_negocio() and owner_id = auth.uid()) $$;

-- ============================================================================
-- SERVICIOS — catálogo del negocio. Precios + modelo de cobro.
-- ============================================================================
create table public.servicios (
  id               uuid primary key default gen_random_uuid(),
  negocio_id       uuid not null references public.negocios(id) on delete cascade,
  nombre           text not null,
  "desc"           text,
  emoji            text,
  duracion         integer default 0,
  activo           boolean default true,
  modelo_cobro     text not null default 'por_paseo' check (modelo_cobro in ('por_paseo','suscripcion')),
  precio           integer default 0,   -- precio por paseo
  precio_mensual   integer default 0,   -- si suscripción
  descuento_extra  integer default 0,   -- COP a descontar por salida extra del mismo perro en la semana
  created_at       timestamptz default now()
);

-- ============================================================================
-- MASCOTAS — perros de cada cliente. Fuente de conducta/observaciones.
-- ============================================================================
create table public.mascotas (
  id           uuid primary key default gen_random_uuid(),
  negocio_id   uuid not null references public.negocios(id) on delete cascade,
  cliente_id   uuid not null references public.profiles(id) on delete cascade,
  nombre       text not null,
  raza         text,
  tamano       text check (tamano in ('pequeno','mediano','grande')),
  conducta     text,                    -- 'tranquilo' | 'reactivo' | 'se_jala' | ...
  compatible   boolean default true,    -- puede salir con otros perros
  tips         text,
  vet_contacto text,
  foto_url     text,
  created_at   timestamptz default now()
);

-- ============================================================================
-- GRUPOS — grupos de paseo (auto o manual). Se asignan a un paseador.
-- ============================================================================
create table public.grupos (
  id           uuid primary key default gen_random_uuid(),
  negocio_id   uuid not null references public.negocios(id) on delete cascade,
  paseador_id  uuid references public.profiles(id) on delete set null,
  fecha        date default current_date,
  ventana_hora text,                    -- p.ej. "08:00"
  zona         text,
  tamano_max   integer default 4,
  created_at   timestamptz default now()
);

-- ============================================================================
-- RECURRENCIAS — reglas que generan citas repetidas.
-- ============================================================================
create table public.recurrencias (
  id           uuid primary key default gen_random_uuid(),
  negocio_id   uuid not null references public.negocios(id) on delete cascade,
  cliente_id   uuid not null references public.profiles(id) on delete cascade,
  mascota_id   uuid references public.mascotas(id) on delete cascade,
  servicio_id  uuid references public.servicios(id) on delete set null,
  dias         text,                    -- "lun,mie,vie"
  hora         text,
  hasta        date,
  created_at   timestamptz default now()
);

-- ============================================================================
-- CITAS — el paseo. Enlaza cliente + mascota + servicio + paseador (+ grupo).
-- ============================================================================
create table public.citas (
  id              uuid primary key default gen_random_uuid(),
  negocio_id      uuid not null references public.negocios(id) on delete cascade,
  cliente_id      uuid references public.profiles(id) on delete set null,
  mascota_id      uuid references public.mascotas(id) on delete set null,
  servicio_id     uuid references public.servicios(id) on delete set null,
  paseador_id     uuid references public.profiles(id) on delete set null,
  grupo_id        uuid references public.grupos(id) on delete set null,
  recurrencia_id  uuid references public.recurrencias(id) on delete set null,
  fecha           date default current_date,
  hora            text,                 -- hora programada aproximada
  duracion        integer default 60,
  zona            text,
  direccion       text,
  estado          text not null default 'programado'
                    check (estado in ('programado','recibido','en_paseo','entregado','no_salio')),
  hora_recibido   text,
  hora_entrega    text,                 -- calculada: recibido + duración
  motivo_no_salio text,                 -- 'lluvia'|'retraso'|'cliente'|'otro'
  precio          integer default 0,
  pagado          boolean default false,
  created_at      timestamptz default now()
);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table public.negocios     enable row level security;
alter table public.profiles     enable row level security;
alter table public.servicios    enable row level security;
alter table public.mascotas     enable row level security;
alter table public.grupos       enable row level security;
alter table public.recurrencias enable row level security;
alter table public.citas        enable row level security;

-- NEGOCIOS: cualquiera autenticado puede LEER (para resolver el link/slug);
-- solo el dueño escribe el suyo.
create policy "negocios read"   on public.negocios for select using (auth.role() = 'authenticated');
create policy "negocios insert" on public.negocios for insert with check (owner_id = auth.uid());
create policy "negocios update" on public.negocios for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- PROFILES: ves el tuyo siempre; el dueño ve todos los de su negocio.
create policy "profiles read self"  on public.profiles for select using (id = auth.uid());
create policy "profiles read tenant" on public.profiles for select using (negocio_id = public.my_negocio() and public.is_owner());
create policy "profiles insert self" on public.profiles for insert with check (id = auth.uid());
create policy "profiles update self" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles update owner" on public.profiles for update using (negocio_id = public.my_negocio() and public.is_owner());

-- Tablas del tenant: helper de pertenencia = negocio_id = my_negocio().
-- SERVICIOS: todos en el negocio leen; solo el dueño escribe.
create policy "servicios read"  on public.servicios for select using (negocio_id = public.my_negocio());
create policy "servicios write" on public.servicios for all
  using (negocio_id = public.my_negocio() and public.is_owner())
  with check (negocio_id = public.my_negocio() and public.is_owner());

-- MASCOTAS: el cliente maneja las suyas; dueño y paseadores del negocio las leen.
create policy "mascotas read tenant" on public.mascotas for select using (negocio_id = public.my_negocio());
create policy "mascotas own write"   on public.mascotas for all
  using (cliente_id = auth.uid()) with check (cliente_id = auth.uid() and negocio_id = public.my_negocio());
create policy "mascotas owner write" on public.mascotas for all
  using (negocio_id = public.my_negocio() and public.is_owner())
  with check (negocio_id = public.my_negocio() and public.is_owner());

-- GRUPOS / RECURRENCIAS: leen los del negocio; escribe el dueño.
create policy "grupos read"  on public.grupos for select using (negocio_id = public.my_negocio());
create policy "grupos write" on public.grupos for all
  using (negocio_id = public.my_negocio() and public.is_owner())
  with check (negocio_id = public.my_negocio() and public.is_owner());
create policy "recur read"  on public.recurrencias for select using (negocio_id = public.my_negocio());
create policy "recur write" on public.recurrencias for all
  using (negocio_id = public.my_negocio())
  with check (negocio_id = public.my_negocio());

-- CITAS: cliente ve las suyas; paseador las asignadas; dueño todas las del negocio.
create policy "citas read cliente"  on public.citas for select using (cliente_id = auth.uid());
create policy "citas read paseador" on public.citas for select using (paseador_id = auth.uid());
create policy "citas read owner"    on public.citas for select using (negocio_id = public.my_negocio() and public.is_owner());
-- cliente crea sus citas; dueño gestiona todas; paseador actualiza las asignadas (check-in/out).
create policy "citas insert cliente" on public.citas for insert with check (cliente_id = auth.uid() and negocio_id = public.my_negocio());
create policy "citas owner all"      on public.citas for all
  using (negocio_id = public.my_negocio() and public.is_owner())
  with check (negocio_id = public.my_negocio() and public.is_owner());
create policy "citas paseador update" on public.citas for update
  using (paseador_id = auth.uid()) with check (paseador_id = auth.uid());
