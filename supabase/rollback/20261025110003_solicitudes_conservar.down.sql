-- Structural inverse of 20261025110003_solicitudes_conservar.sql: deleting an auth user cascades its requests
-- again. Rows of already deleted users (user_id null) block the NOT NULL step on purpose: export them (they are
-- the evidence that the request was attended) and delete them first.
drop trigger trg_solicitudes_datos_anonimizar on public.solicitudes_datos;
drop function public.solicitudes_datos_anonimizar();
alter table public.solicitudes_datos drop constraint solicitudes_datos_user_id_fkey,
  add constraint solicitudes_datos_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade;
alter table public.solicitudes_datos alter column user_id set not null;
alter table public.solicitudes_datos alter column detalle set not null;
