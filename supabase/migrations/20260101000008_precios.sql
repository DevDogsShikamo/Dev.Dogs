-- ============================================================================
-- MIGRACIÓN — Precio de la prestación desde el CATÁLOGO (arregla "cuentas en $0").
--
-- Problema: las prestaciones se creaban sin `precio_aplicado` (quedaba en 0), así
-- que factura, reportes y cobros daban SIEMPRE $0. El precio vive en `servicios`
-- pero no se copiaba a la prestación.
--
-- Solución en 2 capas:
--   (a) La app (reservarPaseo) ya toma el precio del catálogo al reservar.
--   (b) Este TRIGGER precia CUALQUIER inserción que llegue sin precio — cubre el
--       RPC mover_perro (genera la agenda), los seeds y cualquier vía futura.
--   Solo actúa si precio_aplicado viene en 0/null, así que NO pisa un precio ya
--   puesto (p.ej. un descuento explícito). Precio = "el del momento del servicio".
--
-- Regla de cobro: si el servicio es 'mensual' (suscripción), la prestación NO se
-- cobra por uso → precio_aplicado 0 y cobrable = false. Si es 'por_uso', toma
-- servicios.precio y queda cobrable.
--
-- Correr UNA vez en Supabase → SQL Editor. Idempotente (or replace / drop if exists).
-- Requiere schema_v3.sql aplicado.
-- ============================================================================

create or replace function public.prestacion_precio() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_precio integer;
  v_modelo text;
begin
  if new.servicio_id is not null and coalesce(new.precio_aplicado, 0) = 0 then
    select precio, modelo_cobro into v_precio, v_modelo
      from public.servicios where id = new.servicio_id;
    if v_modelo = 'mensual' then
      new.precio_aplicado := 0;
      new.cobrable := false;                 -- va por mensualidad, no se cobra por uso
    elsif v_precio is not null then
      new.precio_aplicado := v_precio;       -- por uso: precio del catálogo
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_prestacion_precio on public.prestaciones;
create trigger trg_prestacion_precio
  before insert on public.prestaciones
  for each row execute function public.prestacion_precio();

-- ---- Backfill: precia lo ya creado sin precio ------------------------------
-- Por uso con precio en el catálogo → copia el precio.
update public.prestaciones p
  set precio_aplicado = s.precio
  from public.servicios s
  where p.servicio_id = s.id
    and coalesce(p.precio_aplicado, 0) = 0
    and s.modelo_cobro <> 'mensual'
    and coalesce(s.precio, 0) > 0;

-- Mensual → no se cobra por uso.
update public.prestaciones p
  set cobrable = false, precio_aplicado = 0
  from public.servicios s
  where p.servicio_id = s.id
    and s.modelo_cobro = 'mensual'
    and (p.cobrable is distinct from false or coalesce(p.precio_aplicado, 0) <> 0);

-- ============================================================================
-- Tras esto: factura por perro y Reportes de la empresa muestran plata real,
-- alimentados por el precio del catálogo. Base para el cierre de cobros (#2).
-- ============================================================================
