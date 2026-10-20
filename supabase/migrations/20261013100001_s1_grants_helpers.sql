-- S1 / A: close the anonymous surface and pin the identity helpers.
-- The exposed schema keeps working for signed-in users, but nothing is reachable
-- without a session, and every later function must be granted explicitly.

revoke all on all tables    in schema public from anon, public;
revoke all on all sequences in schema public from anon, public;
revoke all on all functions in schema public from anon, public;

-- Fail closed for objects created later by the migration role.
alter default privileges for role postgres in schema public revoke all on tables    from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;

-- Helpers disclose only the caller's own tenant, role and dog links. A NULL result
-- (no profile) is turned into false, so a policy can never pass on NULL.
create or replace function public.my_negocio() returns uuid
  language sql stable security definer set search_path = '' as
$$ select negocio_id from public.profiles where id = auth.uid() $$;

create or replace function public.my_rol() returns text
  language sql stable security definer set search_path = '' as
$$ select rol from public.profiles where id = auth.uid() $$;

create or replace function public.is_owner() returns boolean
  language sql stable security definer set search_path = '' as
$$ select coalesce(exists(
     select 1 from public.negocios where id = public.my_negocio() and owner_id = auth.uid()
   ), false) $$;

create or replace function public.is_office() returns boolean
  language sql stable security definer set search_path = '' as
$$ select coalesce(public.my_rol() = 'empresa', false) $$;

create or replace function public.owns_dog(pid uuid) returns boolean
  language sql stable security definer set search_path = '' as
$$ select coalesce(exists(
     select 1 from public.perro_duenos
     where perro_id = pid and dueno_id = auth.uid() and estado = 'activo'
   ), false) $$;

revoke execute on function public.my_negocio(), public.my_rol(), public.is_owner(),
  public.is_office(), public.owns_dog(uuid) from public, anon;
grant execute on function public.my_negocio(), public.my_rol(), public.is_owner(),
  public.is_office(), public.owns_dog(uuid) to authenticated;
