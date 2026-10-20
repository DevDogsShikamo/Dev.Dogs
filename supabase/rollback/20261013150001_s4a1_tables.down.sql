-- Structural inverse of S4a1 (20261013150001_s4a1_tables.sql, 20261013150002_s4a1_policies.sql).
-- The slice is additive: the legacy columns and policies were never changed, so dropping the six
-- side tables (their policies go with them) and the three functions restores the previous state
-- and re-opens nothing. Roll back only if no later slice (S4a2 RPCs, S4b app switch) is applied;
-- afterwards the app would read tables that no longer exist. Pre-launch the authoritative
-- rollback is `git revert` plus `node supabase/staging.mjs reset` (see supabase/README.md).

drop table if exists public.cobros, public.tarifas, public.permisos, public.nomina, public.contactos, public.perro_identidad;
drop function if exists public.has_finanzas();
drop function if exists public.owns_cobro(uuid);
drop function if exists public.backfill_side_tables();
