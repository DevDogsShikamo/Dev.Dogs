-- Structural inverse of the S1 identity slice (20261013100001..03).
-- Data-preserving and safe by design: it only re-adds the dropped columns (empty).
-- It does NOT restore the vulnerable pieces ("negocios read" open to every user,
-- "profiles insert self", "negocios insert", anon EXECUTE, the upserting
-- redeem_invite): the guard trigger, the own-tenant read, provision_negocio and the
-- closed anonymous surface stay, because a rollback must never reopen the hole.
-- Pre-launch the authoritative rollback is `git revert` of the slice plus
-- `node supabase/staging.mjs reset` (see supabase/README.md).

alter table public.negocios add column if not exists telefono text;
alter table public.negocios add column if not exists ciudad   text;
alter table public.negocios add column if not exists eslogan  text;
alter table public.profiles add column if not exists didit_session_id text;
