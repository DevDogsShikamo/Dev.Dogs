-- A data-rights request outlives the account that filed it: it is the proof that the request was attended
-- (Ley 1581 art. 17). Deleting the auth user used to cascade the row away; now user_id becomes null and a
-- trigger clears the free text the user wrote (detalle), so no personal data of the deleted user is kept.
-- tipo, estado, created_at, vence_at, respondida_at and respuesta stay. An orphaned row is read by no user
-- (the read policy is user_id = auth.uid()); staff see it from the SQL editor.

alter table public.solicitudes_datos alter column user_id drop not null;
alter table public.solicitudes_datos alter column detalle drop not null;
alter table public.solicitudes_datos drop constraint solicitudes_datos_user_id_fkey,
  add constraint solicitudes_datos_user_id_fkey foreign key (user_id) references auth.users (id) on delete set null;

create function public.solicitudes_datos_anonimizar() returns trigger
  language plpgsql set search_path = '' as
$$
begin
  new.detalle := null;
  return new;
end;
$$;
revoke execute on function public.solicitudes_datos_anonimizar() from public, anon, authenticated;

create trigger trg_solicitudes_datos_anonimizar
  before update of user_id on public.solicitudes_datos
  for each row when (new.user_id is null) execute function public.solicitudes_datos_anonimizar();
