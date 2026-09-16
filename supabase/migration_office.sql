-- ============================================================================
-- MIGRACIÓN — Oficina de gestión (empleados de gestión bajo el jefe/dueño).
--
-- Modelo de dos niveles dentro del negocio empresa:
--   JEFE     = negocios.owner_id  → is_owner()  (ya existía)
--   GESTIÓN  = profiles.rol='empresa' que NO es owner → is_office() (nuevo)
--
-- Split "Jefe controla más":
--   Compartido con gestión: ver paseadores, ver salidas/agenda, reasignar salidas.
--   Solo el jefe: clientes, perros (escritura), salarios, invitaciones, reportes.
--
-- ⚠️ NOTA sobre columnas sensibles: el RLS es por FILA, no por columna. Gestión
--   necesita leer `prestaciones` (agenda) y `profiles` de paseadores (asignar), y
--   esas filas incluyen precio_aplicado/cobrado y salario_fijo. El ocultamiento de
--   Reportes/Salarios se garantiza en la UI; el blindaje total por columna (que ni
--   la API los devuelva) sería un endurecimiento posterior con una vista sin precios.
--
-- Correr UNA vez en Supabase → SQL Editor. Idempotente (drop if exists / or replace).
-- Requiere schema_v3.sql y migration_grupos.sql ya aplicados.
-- ============================================================================

-- ---- Invitaciones: permitir invitar empleados de gestión (rol='empresa') -----
alter table public.invitaciones drop constraint if exists invitaciones_rol_check;
alter table public.invitaciones
  add constraint invitaciones_rol_check check (rol in ('paseador','cliente','empresa'));

-- ---- Helper: ¿el usuario actual es staff de gestión (rol empresa) del negocio? --
-- Incluye al jefe (el dueño también tiene rol='empresa'): para las secciones
-- compartidas alcanza con "es de la oficina". Lo sensible se sigue gateando con is_owner().
create or replace function public.is_office() returns boolean
  language sql stable security definer set search_path = public as
$$ select coalesce(public.my_rol() = 'empresa', false) $$;

-- ---- PROFILES: gestión puede leer SOLO los paseadores del negocio (no clientes) --
drop policy if exists "profiles read office paseadores" on public.profiles;
create policy "profiles read office paseadores" on public.profiles for select
  using (negocio_id = public.my_negocio() and public.is_office() and rol = 'paseador');

-- ---- GRUPOS: gestión puede REASIGNAR (update cuidador_id). Lectura ya la cubre
-- "grupos read staff" (cualquier miembro del negocio lee). ------------------------
drop policy if exists "grupos write office" on public.grupos;
create policy "grupos write office" on public.grupos for update
  using (negocio_id = public.my_negocio() and public.is_office())
  with check (negocio_id = public.my_negocio() and public.is_office());

-- ---- PRESTACIONES: gestión puede LEER las del negocio (Inicio + agenda + salidas).
-- (No update: reportar/confirmar sigue siendo del paseador asignado y del jefe.) ---
drop policy if exists "prestaciones read office" on public.prestaciones;
create policy "prestaciones read office" on public.prestaciones for select
  using (negocio_id = public.my_negocio() and public.is_office());

-- ============================================================================
-- Con esto, un profile rol='empresa' que NO es owner_id ve/gestiona la operación
-- (paseadores, salidas, agenda) pero NO clientes/perros/salarios/invitaciones/reportes.
-- El jefe (is_owner) mantiene acceso total por las políticas *owner* existentes.
-- ============================================================================
