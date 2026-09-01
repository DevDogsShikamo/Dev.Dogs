-- ============================================================================
-- DevDogs — Supabase schema + Row Level Security (RLS)
-- Run this in: Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Design notes:
--   * Column names match the Muten entities EXACTLY (quoted for camelCase /
--     reserved words like "desc"), so `query`/`sources` map with no remapping.
--   * Every table carries owner_id = auth.uid(); RLS isolates each account's
--     data. The public/publishable key only grants what these policies allow.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- EMPRESA  (one profile row per user; merges the signup "Registro" fields)
-- ----------------------------------------------------------------------------
create table if not exists public.empresa (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre      text not null,
  eslogan     text,
  telefono    text,
  ciudad      text,
  paseadores  integer default 0,
  clientes    integer default 0,
  perros      integer default 0,
  -- onboarding / Registro fields
  rol         text,
  zona        text,
  negocio     text,
  "docTipo"   text,
  "docNumero" text,
  nit         text,
  created_at  timestamptz default now(),
  unique (owner_id)
);

-- ----------------------------------------------------------------------------
-- SERVICIOS  (catalogue offered by the company)
-- ----------------------------------------------------------------------------
create table if not exists public.servicios (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre     text not null,
  "desc"     text,
  emoji      text,
  precio     integer default 0,
  duracion   integer default 0,
  activo     boolean default true,
  created_at timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- CITAS  (appointments; fecha added for a real calendar/agenda)
-- ----------------------------------------------------------------------------
create table if not exists public.citas (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  fecha       date default current_date,
  hora        text,
  cliente     text,
  perro       text,
  servicio    text,
  "svcClass"  text,
  direccion   text,
  precio      integer default 0,
  hecho       boolean default false,
  pagado      boolean default false,
  created_at  timestamptz default now()
);

-- ============================================================================
-- ROW LEVEL SECURITY — each user sees and writes ONLY their own rows.
-- ============================================================================
alter table public.empresa   enable row level security;
alter table public.servicios enable row level security;
alter table public.citas     enable row level security;

-- EMPRESA
create policy "empresa: own select" on public.empresa
  for select using (owner_id = auth.uid());
create policy "empresa: own insert" on public.empresa
  for insert with check (owner_id = auth.uid());
create policy "empresa: own update" on public.empresa
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "empresa: own delete" on public.empresa
  for delete using (owner_id = auth.uid());

-- SERVICIOS
create policy "servicios: own select" on public.servicios
  for select using (owner_id = auth.uid());
create policy "servicios: own insert" on public.servicios
  for insert with check (owner_id = auth.uid());
create policy "servicios: own update" on public.servicios
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "servicios: own delete" on public.servicios
  for delete using (owner_id = auth.uid());

-- CITAS
create policy "citas: own select" on public.citas
  for select using (owner_id = auth.uid());
create policy "citas: own insert" on public.citas
  for insert with check (owner_id = auth.uid());
create policy "citas: own update" on public.citas
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "citas: own delete" on public.citas
  for delete using (owner_id = auth.uid());
