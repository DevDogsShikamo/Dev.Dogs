-- S5b changes the privacy text (photos now live in Cloudflare R2, 30-day lifecycle, tagged per dog), so it
-- is a new version. Accepted consents keep pointing at the version the user saw (foreign key); the new
-- version becomes the only current one (unique index politicas_una_vigente), so new signups record it.
-- Users who accepted the previous version are not asked again: the design has no re-consent flow (S7 gap).
update public.politicas set vigente = false where vigente;
insert into public.politicas (version) values ('2026-10-15-borrador');
