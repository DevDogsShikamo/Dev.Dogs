-- ============================================================================
-- MIGRACIÓN — Tipos de servicio ampliados (baño, corte de garras, adiestramiento).
--
-- El negocio no solo hace paseos: también guardería, baño, corte de garras,
-- adiestramiento y veterinaria. Este cambio permite crear y agendar esos tipos.
-- (Comida y snacks son PRODUCTOS → van por el módulo de comercio `ordenes`,
--  no por `servicios`/`prestaciones`; se dejan en el check por compatibilidad.)
--
-- Correr UNA vez en Supabase → SQL Editor. Idempotente (drop if exists / add).
-- Requiere schema_v3.sql aplicado.
-- ============================================================================

alter table public.servicios drop constraint if exists servicios_tipo_check;
alter table public.servicios add constraint servicios_tipo_check
  check (tipo in ('paseo','guarderia','veterinaria','bano','corte','adiestramiento','comida','accesorio'));

alter table public.prestaciones drop constraint if exists prestaciones_tipo_check;
alter table public.prestaciones add constraint prestaciones_tipo_check
  check (tipo in ('paseo','guarderia','veterinaria','bano','corte','adiestramiento','comida','accesorio'));

-- ============================================================================
-- Con esto se pueden crear servicios de baño / corte de garras / adiestramiento
-- (y guardería/veterinaria) desde la UI, y agendarlos como prestaciones.
-- ============================================================================
