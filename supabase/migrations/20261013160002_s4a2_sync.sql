-- S4a2 / B: dual-write sync. While the app still reads and writes the legacy columns, every legacy
-- write (API, RPC, SQL) is mirrored into the S4a1 side tables, including rows inserted after S4a1.
-- Deleting a parent removes its side row through the existing ON DELETE CASCADE foreign keys.
-- S4b drops these triggers together with the legacy columns. Trigger functions are not callable.

create or replace function public.sync_profile_side() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  if new.negocio_id is null then return new; end if;
  insert into public.contactos (user_id, negocio_id, rol, telefono) values (new.id, new.negocio_id, new.rol, new.telefono)
    on conflict (user_id) do update set negocio_id = excluded.negocio_id, rol = excluded.rol, telefono = excluded.telefono;
  if new.rol <> 'cliente' then
    insert into public.nomina (user_id, negocio_id, salario_fijo) values (new.id, new.negocio_id, coalesce(new.salario_fijo, 0))
      on conflict (user_id) do update set negocio_id = excluded.negocio_id, salario_fijo = excluded.salario_fijo;
  end if;
  return new;
end;
$$;

create or replace function public.sync_servicio_tarifa() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  insert into public.tarifas (servicio_id, negocio_id, precio, precio_mensual)
    values (new.id, new.negocio_id, coalesce(new.precio, 0), coalesce(new.precio_mensual, 0))
    on conflict (servicio_id) do update set negocio_id = excluded.negocio_id, precio = excluded.precio, precio_mensual = excluded.precio_mensual;
  return new;
end;
$$;

create or replace function public.sync_prestacion_cobro() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  insert into public.cobros (prestacion_id, negocio_id, precio_aplicado, cobrable, cobrado, confirmado_por, confirmado_at)
    values (new.id, new.negocio_id, coalesce(new.precio_aplicado, 0), coalesce(new.cobrable, false), coalesce(new.cobrado, false),
            new.confirmado_por, new.confirmado_at)
    on conflict (prestacion_id) do update set negocio_id = excluded.negocio_id, precio_aplicado = excluded.precio_aplicado,
      cobrable = excluded.cobrable, cobrado = excluded.cobrado, confirmado_por = excluded.confirmado_por, confirmado_at = excluded.confirmado_at;
  return new;
end;
$$;

create or replace function public.sync_perro_identidad() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  if new.microchip is null then
    delete from public.perro_identidad where perro_id = new.id;
  else
    insert into public.perro_identidad (perro_id, microchip) values (new.id, new.microchip)
      on conflict (perro_id) do update set microchip = excluded.microchip;
  end if;
  return new;
end;
$$;

revoke execute on function public.sync_profile_side(), public.sync_servicio_tarifa(), public.sync_prestacion_cobro(),
  public.sync_perro_identidad() from public, anon, authenticated;

create trigger trg_sync_profile_side after insert or update of telefono, salario_fijo, rol, negocio_id on public.profiles
  for each row execute function public.sync_profile_side();
create trigger trg_sync_servicio_tarifa after insert or update of precio, precio_mensual, negocio_id on public.servicios
  for each row execute function public.sync_servicio_tarifa();
create trigger trg_sync_prestacion_cobro
  after insert or update of precio_aplicado, cobrable, cobrado, confirmado_por, confirmado_at, negocio_id on public.prestaciones
  for each row execute function public.sync_prestacion_cobro();
create trigger trg_sync_perro_identidad after insert or update of microchip on public.perros
  for each row execute function public.sync_perro_identidad();

-- Re-sync anything written between S4a1 and this migration.
select public.backfill_side_tables();
