-- New text versions after batch C1: the terms say the client can cancel a scheduled service in the app (the
-- business sets any fee), reviews are rejected only for four fixed causes the author sees, and the business
-- identity is mandatory with a personal ID shown masked; the data policy says who sees the business legal
-- data. The Términos para negocios say the identity is mandatory to receive bookings and sales, mention the
-- contagious-disease flag and the review causes. Same pattern as 20261025110001_politica_fuentes_propias.sql
-- for the policy row; version_vigente('terminos_negocio') mirrors TERMINOS_NEGOCIO_VERSION in
-- src/lib/politica.js. Users and owners who accepted an older version are asked again by their gates.
update public.politicas set vigente = false where vigente;
insert into public.politicas (version, documentos) values ('2026-10-26-borrador', array['terminos', 'datos']);

create or replace function public.version_vigente(p_tipo text) returns text
  language sql immutable set search_path = '' as
$$
  select case p_tipo when 'aviso_rol' then '2026-10-22-borrador' when 'terminos_negocio' then '2026-10-26-borrador' end;
$$;
