-- S2b1 / A: dog ownership links, dogs, group memberships and the co-owner functions.
--   perro_duenos   readable as own rows (and by the business owner); never written
--                  through the table. Links are created by crear_mi_perro and
--                  coduenio_agregar and removed by coduenio_quitar (P2: no invite flow).
--   perros         a client only REGISTERS a dog (crear_mi_perro, P1); the business
--                  owner edits it; nobody hard-deletes, perro_eliminar soft-deletes.
--   grupo_membresias  no access for clients; a walker sees only its own groups.
--   prestaciones.perro_id  stops cascading: a dog with history cannot be hard-deleted.

-- Principal owner of the dog (a co-owner is not). Used from S2b2 on (purchases).
create or replace function public.is_principal(pid uuid) returns boolean
  language sql stable security definer set search_path = '' as
$$ select coalesce(exists(
     select 1 from public.perro_duenos
     where perro_id = pid and dueno_id = auth.uid() and estado = 'activo' and rol = 'principal'
   ), false) $$;

-- ---- perro_duenos: own rows + business owner, read-only -------------------------------
drop policy if exists "perro_duenos invite"      on public.perro_duenos;
drop policy if exists "perro_duenos update self" on public.perro_duenos;
drop policy if exists "perro_duenos read staff"  on public.perro_duenos;
drop policy if exists "perro_duenos owner"       on public.perro_duenos;
drop policy if exists "perro_duenos read owner"  on public.perro_duenos;
create policy "perro_duenos read owner" on public.perro_duenos for select
  using (public.is_owner() and exists (
    select 1 from public.perros p where p.id = perro_id and p.negocio_id = public.my_negocio()));
-- "perro_duenos read self" stays. Without table privileges the denial is a hard 42501.
revoke insert, update, delete on public.perro_duenos from authenticated;

-- ---- perros: owner insert/update only, no delete for anyone ---------------------------
drop policy if exists "perros write own"   on public.perros;
drop policy if exists "perros write owner" on public.perros;
create policy "perros insert owner" on public.perros for insert
  with check (negocio_id = public.my_negocio() and public.is_owner());
create policy "perros update owner" on public.perros for update
  using (negocio_id = public.my_negocio() and public.is_owner())
  with check (negocio_id = public.my_negocio() and public.is_owner());
revoke delete on public.perros from authenticated;

-- ---- grupo_membresias: tenant owner/office, or the group's own walker -----------------
drop policy if exists "membresias read" on public.grupo_membresias;
create policy "membresias read" on public.grupo_membresias for select
  using (exists (
    select 1 from public.grupos g where g.id = grupo_id
      and ((g.negocio_id = public.my_negocio() and (public.is_owner() or public.is_office()))
           or g.cuidador_id = auth.uid())));

-- ---- prestaciones.perro_id: NO ACTION instead of CASCADE ------------------------------
-- The design says RESTRICT. NO ACTION blocks the same hard delete of a dog with history
-- (23503) but is checked at the end of the statement, so deleting a whole tenant (or an
-- auth user that owns one) still cascades through both perros and prestaciones.
alter table public.prestaciones drop constraint if exists prestaciones_perro_id_fkey;
alter table public.prestaciones
  add constraint prestaciones_perro_id_fkey foreign key (perro_id) references public.perros(id) on delete no action;

-- ---- crear_mi_perro: clients only, validated, business fields keep their defaults -----
create or replace function public.crear_mi_perro(
  p_nombre       text,
  p_raza         text default null,
  p_tamano       text default null,
  p_conducta     text default null,
  p_tips         text default null,
  p_sociabilidad text default null
) returns uuid
  language plpgsql security definer set search_path = '' as
$$
declare
  v_neg    uuid := public.my_negocio();
  v_nombre text := trim(coalesce(p_nombre, ''));
  v_perro  uuid;
begin
  if auth.uid() is null or v_neg is null or public.my_rol() is distinct from 'cliente' then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if v_nombre = '' or length(v_nombre) > 80
     or length(coalesce(p_raza, '')) > 80 or length(coalesce(p_tips, '')) > 1000
     or coalesce(nullif(trim(p_tamano), ''), 'pequeno') not in ('pequeno', 'mediano', 'grande')
     or coalesce(nullif(trim(p_conducta), ''), 'tranquilo') not in ('tranquilo', 'energico', 'reactivo', 'sociable', 'jalador')
     or coalesce(nullif(trim(p_sociabilidad), ''), 'bueno') not in ('excelente', 'bueno', 'cuidado', 'selectivo') then
    raise exception 'perro_invalido';
  end if;

  insert into public.perros (negocio_id, nombre, raza, tamano, conducta, tips, sociabilidad)
    values (v_neg, v_nombre, nullif(trim(coalesce(p_raza, '')), ''), nullif(trim(coalesce(p_tamano, '')), ''),
            nullif(trim(coalesce(p_conducta, '')), ''), nullif(trim(coalesce(p_tips, '')), ''),
            nullif(trim(coalesce(p_sociabilidad, '')), ''))
    returning id into v_perro;
  insert into public.perro_duenos (perro_id, dueno_id, rol, estado)
    values (v_perro, auth.uid(), 'principal', 'activo');
  return v_perro;
end;
$$;

-- ---- perro_eliminar: owner-only soft delete ---------------------------------------------
-- Keeps the dog and all its history. Removes what would keep it alive operationally:
-- future unpaid programado rows, group memberships, and its id in other dogs' relations.
create or replace function public.perro_eliminar(p_id uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_neg uuid;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
begin
  select negocio_id into v_neg from public.perros where id = p_id;
  if auth.uid() is null or v_neg is null or v_neg is distinct from public.my_negocio() or not public.is_owner() then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  update public.perros set activo = false where id = p_id;
  delete from public.prestaciones
    where perro_id = p_id and estado = 'programado' and not coalesce(cobrado, false) and fecha >= v_hoy;
  delete from public.grupo_membresias where perro_id = p_id;
  update public.perros o
    set incompatibles = coalesce((
      select jsonb_agg(e) from jsonb_array_elements(o.incompatibles) e
      where coalesce(case when jsonb_typeof(e) = 'object' then e ->> 'id' else e #>> '{}' end, '') <> p_id::text
    ), '[]'::jsonb)
    where o.negocio_id = v_neg and o.id <> p_id and jsonb_typeof(o.incompatibles) = 'array'
      and o.incompatibles::text like '%' || p_id::text || '%';
end;
$$;

-- ---- co-owners: business owner only (P2) -------------------------------------------------
create or replace function public.coduenio_agregar(p_perro uuid, p_dueno uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_neg uuid;
begin
  select negocio_id into v_neg from public.perros where id = p_perro;
  if auth.uid() is null or v_neg is null or v_neg is distinct from public.my_negocio() or not public.is_owner() then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_dueno and negocio_id = v_neg and rol = 'cliente') then
    raise exception 'dueno_invalido';
  end if;
  insert into public.perro_duenos (perro_id, dueno_id, rol, estado, invitado_por)
    values (p_perro, p_dueno, 'co', 'activo', auth.uid())
    on conflict (perro_id, dueno_id) do update set estado = 'activo' where public.perro_duenos.rol = 'co';
end;
$$;

create or replace function public.coduenio_quitar(p_perro uuid, p_dueno uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_neg uuid;
begin
  select negocio_id into v_neg from public.perros where id = p_perro;
  if auth.uid() is null or v_neg is null or v_neg is distinct from public.my_negocio() or not public.is_owner() then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  delete from public.perro_duenos where perro_id = p_perro and dueno_id = p_dueno and rol = 'co';
  if not found then raise exception 'coduenio_inexistente'; end if;
end;
$$;

revoke execute on function public.is_principal(uuid), public.perro_eliminar(uuid),
  public.coduenio_agregar(uuid, uuid), public.coduenio_quitar(uuid, uuid) from public, anon;
grant execute on function public.is_principal(uuid), public.perro_eliminar(uuid),
  public.coduenio_agregar(uuid, uuid), public.coduenio_quitar(uuid, uuid) to authenticated;
revoke execute on function public.crear_mi_perro(text, text, text, text, text, text) from public, anon;
grant execute on function public.crear_mi_perro(text, text, text, text, text, text) to authenticated;
