-- Structural inverse of the S3 slice (20261013140001_s3_invitations.sql), structure only.
-- It re-adds the nullable plaintext `codigo` column so that older code that names the column
-- parses again; the column is EMPTY: the dropped plaintext codes and the hashed codes cannot be
-- restored, so every pending invitation must be revoked and created again (a lost code means
-- revoke + create a new one). It does NOT reopen anything: invitaciones stays read-only for
-- owners (no table writes, no hash column grant), redeem_invite keeps the email binding, the
-- attempt limit and the uniform error, and invitacion_crear / invitacion_revocar stay.
-- The legacy join-by-slug path is not restored by any script (it was closed in S1 and its app
-- code is removed in this slice).
-- Pre-launch the authoritative rollback is `git revert` of the slice plus
-- `node supabase/staging.mjs reset` (see supabase/README.md).

alter table public.invitaciones add column if not exists codigo text;
