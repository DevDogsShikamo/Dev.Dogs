-- ============================================================================
-- MIGRACIÓN — Zonas de trabajo (del negocio) + Vacaciones/descansos (del paseador).
--   negocios.zonas       = lista de zonas donde trabaja la persona/empresa (jsonb array de strings).
--                          Se define en la sección Servicios; los grupos eligen una zona de esta lista.
--   profiles.vacaciones  = bloques de descanso [{desde:"YYYY-MM-DD", hasta:"YYYY-MM-DD", nota}].
--                          Se ponen sobre el calendario; esos días se marcan no disponibles.
-- Correr UNA vez en Supabase → SQL Editor. Idempotente.
-- ============================================================================
alter table public.negocios add column if not exists zonas      jsonb not null default '[]'::jsonb;
alter table public.profiles add column if not exists vacaciones jsonb not null default '[]'::jsonb;
