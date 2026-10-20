-- Ley 1480 art. 48: the provider must keep proof that the user accepted the general conditions. Until
-- now a version covered only the data policy; from this one on, the accepted version covers the terms of
-- use and the data policy shown together in the consent modal (/politicas), so the consent row that
-- provision_negocio, redeem_invite and consentimiento_aceptar already write is that proof.
-- Older rows keep documentos = {datos}: what their users accepted. The re-consent gate asks again.
alter table public.politicas
  add column documentos text[] not null default array['datos']::text[]
  check (cardinality(documentos) > 0 and documentos <@ array['terminos', 'datos']::text[]);

update public.politicas set vigente = false where vigente;
insert into public.politicas (version, documentos) values ('2026-10-20b-borrador', array['terminos', 'datos']);
