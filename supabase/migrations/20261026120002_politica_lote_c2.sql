-- New text versions after batch C2: the terms and the data policy say how an incident is reported and who reads
-- it, that the photos of that walk are kept as evidence past the 30 days, and how a client reports a photo where
-- a person or a minor appears. The Términos para negocios say the business reports incidents of its dogs and
-- keeps that evidence. Same pattern as 20261026100004_politica_lote_c1.sql; version_vigente('terminos_negocio')
-- mirrors TERMINOS_NEGOCIO_VERSION in src/lib/politica.js. Users and owners are asked again by their gates.
update public.politicas set vigente = false where vigente;
insert into public.politicas (version, documentos) values ('2026-10-26b-borrador', array['terminos', 'datos']);

create or replace function public.version_vigente(p_tipo text) returns text
  language sql immutable set search_path = '' as
$$
  select case p_tipo when 'aviso_rol' then '2026-10-22-borrador' when 'terminos_negocio' then '2026-10-26b-borrador' end;
$$;
