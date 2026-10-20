-- Structural inverse of the S2b2 slice (20261013130001_s2b2_pricing.sql).
-- Drops only the three callable functions: reservar, comprar_producto and cobro_marcar.
-- It does NOT restore anything vulnerable: the price trigger (every signed-in insert is
-- re-priced and cannot start paid), the non-negative CHECK constraints and the absence of a
-- client INSERT policy on prestaciones all stay. Without the functions clients cannot book or
-- buy and the owner cannot mark a charge paid until the previous app build is redeployed;
-- that build writes through the owner-only "prestaciones owner all" policy, which is the
-- same state the legacy schema had. A rollback must never reopen a hole.
-- Pre-launch the authoritative rollback is `git revert` of the slice plus
-- `node supabase/staging.mjs reset` (see supabase/README.md). Revert src/lib/data.ts and the
-- cliente / empresa pages together with this script.

drop function if exists public.reservar(uuid, uuid, uuid, date);
drop function if exists public.comprar_producto(uuid, uuid, integer);
drop function if exists public.cobro_marcar(uuid);
