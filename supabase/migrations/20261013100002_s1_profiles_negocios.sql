-- S1 / B: frozen identity fields, own-tenant business read, retired columns.
-- Profiles and negocios are created only by provision_negocio / redeem_invite
-- (next migration), never by a direct INSERT.

drop policy if exists "profiles insert self" on public.profiles;
drop policy if exists "negocios insert"      on public.negocios;
revoke insert, delete on public.profiles, public.negocios from authenticated;

-- A user can no longer list every tenant; the business read is the own row only.
drop policy if exists "negocios read" on public.negocios;
create policy "negocios read" on public.negocios for select using (id = public.my_negocio());

-- The owner keeps editing profiles of the tenant (salary, name) but cannot move one.
drop policy if exists "profiles update owner" on public.profiles;
create policy "profiles update owner" on public.profiles for update
  using (negocio_id = public.my_negocio() and public.is_owner())
  with check (negocio_id = public.my_negocio() and public.is_owner());

-- Identity fields are immutable for API callers (INVOKER: definer RPCs run as the
-- function owner and pass). The salary can be changed only by the tenant owner.
create or replace function public.profiles_guard() returns trigger
  language plpgsql set search_path = '' as
$$
begin
  if current_user in ('authenticated', 'anon') then
    if new.id            is distinct from old.id
       or new.rol           is distinct from old.rol
       or new.negocio_id    is distinct from old.negocio_id
       or new.verificado    is distinct from old.verificado
       or new.verificado_at is distinct from old.verificado_at then
      raise exception 'identity_frozen' using errcode = '42501';
    end if;
    if new.salario_fijo is distinct from old.salario_fijo and not public.is_owner() then
      raise exception 'salary_owner_only' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.profiles_guard() from public, anon, authenticated;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- Unreferenced columns (nothing in the app reads or writes them).
alter table public.negocios drop column if exists telefono, drop column if exists ciudad, drop column if exists eslogan;
alter table public.profiles drop column if exists didit_session_id;
