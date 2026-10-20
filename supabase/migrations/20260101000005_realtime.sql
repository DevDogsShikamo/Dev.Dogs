-- ============================================================================
-- migration_realtime.sql  (idempotente — se puede re-correr)
-- Habilita Supabase Realtime (postgres_changes) en las tablas del paseador, para
-- que los cambios se EMPUJEN al cliente por WebSocket (Fase 2, sin polling).
--
-- RLS sigue aplicando en Realtime: cada usuario solo recibe cambios de las filas
-- que su política le permite ver (su negocio / sus prestaciones / su profile).
-- La app funciona igual si esto NO se corre (se cae al flujo supa:refresh); con
-- esto habilitado, además aparecen en vivo los cambios de otros actores.
-- ============================================================================

do $$
declare
  t text;
  tablas text[] := array['perros','servicios','grupos','prestaciones','negocios','profiles'];
begin
  foreach t in array tablas loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
