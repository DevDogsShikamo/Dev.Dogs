-- S4b: visibility switch. The app already reads and writes only the side tables and RPCs (phase 1),
-- so the legacy sensitive columns, their sync triggers and the backfill helper go away here.
-- DESTRUCTIVE and irreversible (pre-launch only): the down script re-adds the columns, it does not
-- reopen any policy or grant.
--
-- Order: fill gaps -> rewrite what still touches a legacy column -> drop the sync machinery ->
-- policies -> drop columns.

-- ---- 1. Fill gaps only. The side tables are authoritative since the frontend switch (the owner's
-- salary edits go to nomina directly), so nothing is overwritten from the legacy columns.
insert into public.contactos (user_id, negocio_id, rol, telefono)
  select id, negocio_id, rol, telefono from public.profiles where negocio_id is not null on conflict (user_id) do nothing;
insert into public.nomina (user_id, negocio_id, salario_fijo)
  select id, negocio_id, coalesce(salario_fijo, 0) from public.profiles where negocio_id is not null and rol <> 'cliente' on conflict (user_id) do nothing;
insert into public.tarifas (servicio_id, negocio_id, precio, precio_mensual)
  select id, negocio_id, coalesce(precio, 0), coalesce(precio_mensual, 0) from public.servicios on conflict (servicio_id) do nothing;
insert into public.cobros (prestacion_id, negocio_id, precio_aplicado, cobrable, cobrado, confirmado_por, confirmado_at)
  select id, negocio_id, coalesce(precio_aplicado, 0), coalesce(cobrable, false), coalesce(cobrado, false), confirmado_por, confirmado_at
  from public.prestaciones on conflict (prestacion_id) do nothing;
insert into public.perro_identidad (perro_id, microchip)
  select id, microchip from public.perros where microchip is not null on conflict (perro_id) do nothing;

-- ---- 2. Sync machinery out.
drop trigger if exists trg_sync_profile_side on public.profiles;
drop trigger if exists trg_sync_servicio_tarifa on public.servicios;
drop trigger if exists trg_sync_prestacion_cobro on public.prestaciones;
drop trigger if exists trg_sync_perro_identidad on public.perros;
drop function if exists public.sync_profile_side(), public.sync_servicio_tarifa(), public.sync_prestacion_cobro(),
  public.sync_perro_identidad(), public.backfill_side_tables();

-- ---- 3. Rewrites.
-- Every profile gets its contactos row (rol and tenant copied from the profile; phone set by contacto_set).
create or replace function public.profile_contacto() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  if new.negocio_id is not null then
    insert into public.contactos (user_id, negocio_id, rol) values (new.id, new.negocio_id, new.rol) on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;
revoke execute on function public.profile_contacto() from public, anon, authenticated;
create trigger trg_profile_contacto after insert on public.profiles for each row execute function public.profile_contacto();

-- Pricing: a row signed-in callers insert is charged from the catalogue (tarifas) x detalle.cantidad;
-- a monthly service is not charged per use. Callers without a JWT (seeds, SQL editor) get a default row.
drop trigger if exists trg_prestacion_precio on public.prestaciones;
drop function if exists public.prestacion_precio();
create or replace function public.prestacion_cobro() returns trigger
  language plpgsql security definer set search_path = '' as
$$
declare
  v_precio integer := 0; v_modelo text; v_qty integer := 1; v_cobrable boolean := true;
begin
  if auth.uid() is not null and new.servicio_id is not null then
    select t.precio, s.modelo_cobro into v_precio, v_modelo
      from public.servicios s left join public.tarifas t on t.servicio_id = s.id
      where s.id = new.servicio_id and s.negocio_id = new.negocio_id;
    v_precio := coalesce(v_precio, 0);
    if v_modelo = 'mensual' then
      v_cobrable := false; v_precio := 0;
    elsif v_modelo is not null then
      if new.tipo in ('comida', 'accesorio') and jsonb_typeof(new.detalle -> 'cantidad') = 'number' then
        v_qty := least(greatest(floor((new.detalle ->> 'cantidad')::numeric), 1), 1000)::integer;
      end if;
      v_precio := v_precio * v_qty;
    else
      v_precio := 0;
    end if;
  end if;
  insert into public.cobros (prestacion_id, negocio_id, precio_aplicado, cobrable)
    values (new.id, new.negocio_id, v_precio, v_cobrable) on conflict (prestacion_id) do nothing;
  return new;
end;
$$;
revoke execute on function public.prestacion_cobro() from public, anon, authenticated;
create trigger trg_prestacion_cobro after insert on public.prestaciones for each row execute function public.prestacion_cobro();

create or replace function public.cobro_marcar(p_prestacion uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  r record;
begin
  if auth.uid() is null then raise exception 'no_autorizado' using errcode = '42501'; end if;
  select p.id, p.negocio_id, p.estado, c.cobrable, c.cobrado into r
    from public.prestaciones p join public.cobros c on c.prestacion_id = p.id where p.id = p_prestacion for update of p, c;
  if not found or r.negocio_id is distinct from public.my_negocio() or not (public.is_owner() or public.has_finanzas()) then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if r.cobrado then return; end if;
  if r.estado <> 'finalizado' or r.cobrable is distinct from true then raise exception 'no_cobrable'; end if;
  update public.cobros set cobrado = true, confirmado_por = auth.uid(), confirmado_at = now() where prestacion_id = r.id;
end;
$$;

create or replace function public.contacto_set(p_telefono text) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_tel text := nullif(trim(coalesce(p_telefono, '')), '');
  r record;
begin
  select negocio_id, rol into r from public.profiles where id = auth.uid();
  if auth.uid() is null or not found or r.negocio_id is null then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if v_tel is not null and v_tel !~ '^[0-9+()\s-]{6,32}$' then raise exception 'telefono_invalido'; end if;
  insert into public.contactos (user_id, negocio_id, rol, telefono) values (auth.uid(), r.negocio_id, r.rol, v_tel)
    on conflict (user_id) do update set telefono = excluded.telefono;
end;
$$;

create or replace function public.servicio_guardar(
  p_id uuid, p_nombre text, p_tipo text, p_duracion integer, p_precio integer, p_modelo text
) returns uuid
  language plpgsql security definer set search_path = '' as
$$
declare
  v_neg uuid := public.my_negocio();
  v_nombre text := trim(coalesce(p_nombre, ''));
  v_mensual boolean := p_modelo = 'mensual';
  v_id uuid;
begin
  if auth.uid() is null or v_neg is null or not public.is_owner() then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if p_id is not null and not exists (select 1 from public.servicios where id = p_id and negocio_id = v_neg) then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if v_nombre = '' or length(v_nombre) > 120 then raise exception 'nombre_invalido'; end if;
  if p_modelo is null or p_modelo not in ('por_uso', 'mensual') then raise exception 'modelo_invalido'; end if;
  if p_precio is null or p_precio < 0 or p_duracion is null or p_duracion < 0 then raise exception 'precio_invalido'; end if;
  if p_id is null then
    insert into public.servicios (negocio_id, activo, nombre, tipo, duracion_min, modelo_cobro)
      values (v_neg, true, v_nombre, p_tipo, p_duracion, p_modelo) returning id into v_id;
  else
    update public.servicios set nombre = v_nombre, tipo = p_tipo, duracion_min = p_duracion, modelo_cobro = p_modelo
      where id = p_id returning id into v_id;
  end if;
  insert into public.tarifas (servicio_id, negocio_id, precio, precio_mensual)
    values (v_id, v_neg, case when v_mensual then 0 else p_precio end, case when v_mensual then p_precio else 0 end)
    on conflict (servicio_id) do update set precio = excluded.precio, precio_mensual = excluded.precio_mensual;
  return v_id;
end;
$$;

create or replace function public.provision_negocio(
  p_rol text, p_nombre text, p_negocio text default null, p_telefono text default null
) returns uuid
  language plpgsql security definer set search_path = '' as
$$
declare
  v_uid    uuid := auth.uid();
  v_nombre text := nullif(btrim(p_nombre), '');
  v_neg    text := coalesce(nullif(btrim(p_negocio), ''), v_nombre, 'Mi negocio');
  v_tel    text := nullif(btrim(p_telefono), '');
  v_id     uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_rol not in ('empresa', 'paseador') then raise exception 'rol_invalido'; end if;
  if v_nombre is null or length(v_nombre) > 100 or length(v_neg) > 100 or length(coalesce(v_tel, '')) > 30 then
    raise exception 'datos_invalidos';
  end if;
  if exists (select 1 from public.profiles where id = v_uid) then raise exception 'perfil_existente'; end if;

  insert into public.negocios (owner_id, nombre, tipo)
    values (v_uid, v_neg, case p_rol when 'empresa' then 'empresa' else 'independiente' end)
    returning id into v_id;
  insert into public.profiles (id, negocio_id, rol, nombre) values (v_uid, v_id, p_rol, v_nombre);
  update public.contactos set telefono = v_tel where user_id = v_uid;
  return v_id;
end;
$$;

-- mover_perro / perro_eliminar only test "not paid yet": the same body, now asking `cobros`.
do $$
declare
  f regprocedure;
  d text;
  n text;
begin
  foreach f in array array['public.mover_perro(uuid, uuid, text, date)'::regprocedure, 'public.perro_eliminar(uuid)'::regprocedure]
  loop
    d := pg_get_functiondef(f);
    n := replace(d, 'not coalesce(cobrado, false)',
      'not exists (select 1 from public.cobros c where c.prestacion_id = prestaciones.id and c.cobrado)');
    if n = d then raise exception 'S4b: % no longer tests cobrado', f; end if;
    execute n;
  end loop;
end $$;

-- ---- 4. Policies and guards.
drop policy if exists "profiles update owner" on public.profiles;
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
  end if;
  return new;
end;
$$;

-- profiles now holds no phone, salary, zone or email: office reads every row of its tenant (the client
-- display name, P3) and a company walker reads only the dogs it walks (walks_dog).
drop policy if exists "profiles read office paseadores" on public.profiles;
create policy "profiles read office" on public.profiles for select
  using (negocio_id = public.my_negocio() and public.is_office());
drop policy if exists "perros read staff" on public.perros;
create policy "perros read staff" on public.perros for select using (
  negocio_id = public.my_negocio()
  and (public.is_office() or public.is_owner() or (public.my_rol() = 'paseador' and public.walks_dog(id))));

-- ---- 5. Legacy columns out (their CHECK and UNIQUE constraints go with them).
alter table public.profiles     drop column telefono, drop column salario_fijo, drop column zona;
alter table public.servicios    drop column precio, drop column precio_mensual;
alter table public.prestaciones drop column precio_aplicado, drop column cobrable, drop column cobrado,
                                drop column confirmado_por, drop column confirmado_at;
alter table public.perros       drop column microchip;
