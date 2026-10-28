-- S4a1 / B: RLS of the side tables and the finance-permission helper.
-- Nothing here touches a legacy table, column or policy.

-- Finance flag: an office member (rol 'empresa') of the caller's tenant holding the
-- owner-granted flag. Never opens `nomina`. NULL-safe: no profile or no row means false.
create or replace function public.has_finanzas() returns boolean
  language sql stable security definer set search_path = '' as
$$ select coalesce(public.is_office() and exists(
     select 1 from public.permisos
     where user_id = auth.uid() and negocio_id = public.my_negocio() and finanzas
   ), false) $$;

-- The caller owns (principal or co-owner) the dog of this prestacion.
create or replace function public.owns_cobro(pid uuid) returns boolean
  language sql stable security definer set search_path = '' as
$$ select coalesce(exists(
     select 1 from public.prestaciones p where p.id = pid and public.owns_dog(p.perro_id)
   ), false) $$;

revoke execute on function public.has_finanzas(), public.owns_cobro(uuid) from public, anon;
grant  execute on function public.has_finanzas(), public.owns_cobro(uuid) to authenticated;

alter table public.contactos       enable row level security;
alter table public.nomina          enable row level security;
alter table public.permisos        enable row level security;
alter table public.tarifas         enable row level security;
alter table public.cobros          enable row level security;
alter table public.perro_identidad enable row level security;

-- Reads go through RLS; writes by API callers exist only for nomina and perro_identidad (owner).
-- contactos / permisos / tarifas / cobros are written by RPCs and triggers (S4a2).
revoke all on public.contactos, public.nomina, public.permisos, public.tarifas, public.cobros, public.perro_identidad
  from public, anon, authenticated;
grant select on public.contactos, public.permisos, public.tarifas, public.cobros to authenticated;
grant select, insert, update, delete on public.nomina, public.perro_identidad to authenticated;

-- D3/D4 + P7: self; the tenant owner (the independent walker owns their tenant); office only
-- staff rows. Client contact is therefore owner-only and company walkers read just their row.
create policy "contactos read" on public.contactos for select to authenticated using (
  user_id = auth.uid()
  or (negocio_id = public.my_negocio()
      and (public.is_owner() or (public.is_office() and rol in ('paseador', 'empresa')))));

-- D5b: the owner manages salaries; every employee reads (only) its own row.
create policy "nomina read self" on public.nomina for select to authenticated using (user_id = auth.uid());
create policy "nomina owner" on public.nomina for all to authenticated
  using (negocio_id = public.my_negocio() and public.is_owner())
  with check (negocio_id = public.my_negocio() and public.is_owner()
    and exists (select 1 from public.profiles p where p.id = nomina.user_id and p.negocio_id = nomina.negocio_id));

create policy "permisos read" on public.permisos for select to authenticated using (
  user_id = auth.uid() or (negocio_id = public.my_negocio() and public.is_owner()));

-- D5: prices for the owner, finance office and the tenant's clients (the catalogue they book from).
create policy "tarifas read" on public.tarifas for select to authenticated using (
  negocio_id = public.my_negocio()
  and (public.is_owner() or (public.is_office() and public.has_finanzas()) or public.my_rol() = 'cliente'));

-- D5: charges for the owner, finance office and the owners of the dog.
create policy "cobros read" on public.cobros for select to authenticated using (
  (negocio_id = public.my_negocio() and (public.is_owner() or (public.is_office() and public.has_finanzas())))
  or public.owns_cobro(prestacion_id));

-- Microchip: tenant owner (writes) and the principal owner of the dog (reads).
create policy "perro_identidad read principal" on public.perro_identidad for select to authenticated
  using (public.is_principal(perro_id));
create policy "perro_identidad owner" on public.perro_identidad for all to authenticated
  using (public.is_owner() and exists (select 1 from public.perros p where p.id = perro_id and p.negocio_id = public.my_negocio()))
  with check (public.is_owner() and exists (select 1 from public.perros p where p.id = perro_id and p.negocio_id = public.my_negocio()));
