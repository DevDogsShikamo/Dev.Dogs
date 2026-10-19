-- The rights section of the privacy text now names the in-app "Mis datos" channel, so it is a new
-- version (same pattern as 20261015110001_s5b_policy_version.sql). Users who accepted an older version
-- are asked again by the re-consent gate (consentimiento_pendiente) before entering a portal.
update public.politicas set vigente = false where vigente;
insert into public.politicas (version) values ('2026-10-19-borrador');
