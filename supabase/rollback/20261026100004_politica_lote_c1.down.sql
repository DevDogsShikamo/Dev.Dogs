-- Inverse of the function part of 20261026100004_politica_lote_c1.sql: the Términos para negocios go back to
-- 2026-10-22b-borrador (revert TERMINOS_NEGOCIO_VERSION with it). The politicas row 2026-10-26-borrador is data
-- and consent evidence: it stays (revert the commit and reset staging, like the other policy versions).
create or replace function public.version_vigente(p_tipo text) returns text
  language sql immutable set search_path = '' as
$$
  select case p_tipo when 'aviso_rol' then '2026-10-22-borrador' when 'terminos_negocio' then '2026-10-22b-borrador' end;
$$;
