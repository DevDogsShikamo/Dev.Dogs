-- Structural inverse of the S2b1 slice (20261013120001..02).
-- Drops only the objects S2b1 added for callers: perro_eliminar, coduenio_agregar,
-- coduenio_quitar and is_principal.
-- It does NOT restore the vulnerable pieces. The dropped policies ("perros write own",
-- "perro_duenos invite" / "update self" / "read staff", "prestaciones cuidador update"),
-- the revoked table privileges (perro_duenos writes, perros delete) and the NO ACTION
-- foreign key on prestaciones.perro_id all stay. The hardened crear_mi_perro and
-- paseo_marcar / paseo_no_salio / paseo_agregar_foto stay too (same signatures, so the
-- previous app keeps working for registration and the walk flow). A rollback must never
-- reopen a hole.
-- Pre-launch the authoritative rollback is `git revert` of the slice plus
-- `node supabase/staging.mjs reset` (see supabase/README.md). Revert src/lib/data.ts and
-- the empresa co-owner control together with this script, or dog deletion and co-owner
-- changes fail (there is no direct-table path any more).

drop function if exists public.perro_eliminar(uuid);
drop function if exists public.coduenio_agregar(uuid, uuid);
drop function if exists public.coduenio_quitar(uuid, uuid);
drop function if exists public.is_principal(uuid);
