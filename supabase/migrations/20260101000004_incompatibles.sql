-- ============================================================================
-- migration_incompatibles.sql  (idempotente — se puede re-correr sin miedo)
-- Relación entre perros: la compatibilidad NO es binaria. Modelamos dos ejes.
--
-- 1) perros.sociabilidad  → disposición GENERAL del perro con otros perros:
--      'excelente' | 'bueno' | 'cuidado' | 'selectivo'   (null = sin definir)
--
-- 2) perros.incompatibles → relaciones ESPECÍFICAS por pareja (jsonb).
--    Antes era un arreglo de ids; ahora es un arreglo de OBJETOS con nivel+nota:
--      [{ "id": "<uuid del otro perro>", "nivel": "cuidado|tolera|no_tolera",
--         "nota": "texto libre" }, ...]
--      · cuidado    → se llevan, pero hay que tener cuidado
--      · tolera     → se toleran solo saliendo juntos (fuera del paseo no)
--      · no_tolera  → no se pueden ni ver
--    La relación se escribe SIMÉTRICA desde la app (relacionSet en data.ts):
--    si A lista a B con un nivel, B lista a A con el mismo. Esta columna es el
--    almacén; jsonb acepta la forma nueva sin cambios de tipo.
-- ============================================================================

alter table public.perros
  add column if not exists incompatibles jsonb not null default '[]'::jsonb;

alter table public.perros
  add column if not exists sociabilidad text
  check (sociabilidad in ('excelente','bueno','cuidado','selectivo'));
