-- Structural inverse of the S2a slice (20261013110001..02).
-- Drops the one object S2a added for callers: the grupo_asignar RPC.
-- It does NOT restore the vulnerable pieces: the policy "grupos write office" stays
-- dropped, and assert_gestor plus the hardened mover_perro / grupo_set_hora /
-- bloque_reprogramar stay (same signatures, so the old app keeps working, minus the
-- office's direct group update). A rollback must never reopen the hole.
-- Pre-launch the authoritative rollback is `git revert` of the slice plus
-- `node supabase/staging.mjs reset` (see supabase/README.md). Revert src/lib/data.ts
-- together with this script, or office reassignment fails.

drop function if exists public.grupo_asignar(uuid, uuid);
