-- Ley 1480 de 2011, art. 50 lit. a: whoever offers products through electronic means states its name or
-- company name, NIT, judicial notification address, phone and email. Art. 53: a platform that puts
-- providers in contact with consumers keeps a record of each provider (name, ID document, notification
-- address, phones) that the buyer can consult to file a complaint. Each business records it here; an
-- independent walker can register a personal ID (CC/CE/PAS) instead of a NIT.
-- Side table, like contactos: the owner writes it only through negocio_identidad_guardar (validated);
-- every member of the business (staff and clients) reads it; other tenants and anon read nothing.
create table public.negocio_identidad (
  negocio_id   uuid primary key references public.negocios (id) on delete cascade,
  razon_social text not null check (length(trim(razon_social)) between 2 and 120),
  doc_tipo     text not null check (doc_tipo in ('NIT', 'CC', 'CE', 'PAS')),
  doc_numero   text not null check (doc_numero ~ '^[0-9][0-9.-]{4,19}$'),
  direccion    text not null check (length(trim(direccion)) between 5 and 200),
  telefono     text not null check (telefono ~ '^\+?[0-9 ()-]{7,20}$'),
  correo       text not null check (correo ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(correo) <= 120),
  updated_at   timestamptz not null default now()
);
alter table public.negocio_identidad enable row level security;
revoke all on public.negocio_identidad from public, anon, authenticated;
grant select on public.negocio_identidad to authenticated;
create policy "negocio_identidad read members" on public.negocio_identidad
  for select using (negocio_id = public.my_negocio());

create or replace function public.negocio_identidad_guardar(
  p_razon_social text, p_doc_tipo text, p_doc_numero text, p_direccion text, p_telefono text, p_correo text)
  returns void language plpgsql security definer set search_path = '' as
$$
declare
  v_neg uuid := public.my_negocio();
begin
  if auth.uid() is null or v_neg is null or not public.is_owner() then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  insert into public.negocio_identidad as n (negocio_id, razon_social, doc_tipo, doc_numero, direccion, telefono, correo)
    values (v_neg, trim(p_razon_social), upper(trim(p_doc_tipo)), trim(p_doc_numero), trim(p_direccion), trim(p_telefono), lower(trim(p_correo)))
  on conflict (negocio_id) do update set
    razon_social = excluded.razon_social, doc_tipo = excluded.doc_tipo, doc_numero = excluded.doc_numero,
    direccion = excluded.direccion, telefono = excluded.telefono, correo = excluded.correo, updated_at = now();
exception
  when check_violation or not_null_violation then raise exception 'datos_invalidos' using errcode = '22023';
end;
$$;
revoke execute on function public.negocio_identidad_guardar(text, text, text, text, text, text) from public, anon;
grant execute on function public.negocio_identidad_guardar(text, text, text, text, text, text) to authenticated;
