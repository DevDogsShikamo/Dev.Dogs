-- ============================================================================
-- MIGRACIÓN — Fotos del paseo (reporte con imágenes).
--
-- El paseador sube fotos DURANTE el paseo; se guardan en Supabase Storage (bucket
-- 'paseos', público de lectura) y su URL se anexa a `prestaciones.detalle.fotos`
-- de TODAS las prestaciones del grupo (así cada dueño ve las fotos de la salida
-- en la que estuvo su perro). NUNCA se guarda el binario en la DB, solo la URL.
--
-- Correr UNA vez en Supabase → SQL Editor. Idempotente.
-- Requiere schema_v3.sql + migration_paseo.sql.
-- ============================================================================

-- 1) Bucket público (getPublicUrl sirve las imágenes sin auth para el <img>).
insert into storage.buckets (id, name, public)
  values ('paseos', 'paseos', true)
  on conflict (id) do update set public = true;

-- 2) Políticas de Storage: sube cualquier autenticado (el paseador); lectura pública.
drop policy if exists "paseos upload" on storage.objects;
create policy "paseos upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'paseos');

drop policy if exists "paseos read" on storage.objects;
create policy "paseos read" on storage.objects for select
  using (bucket_id = 'paseos');

-- 3) RPC: anexa una URL a detalle.fotos (array jsonb) de las prestaciones del grupo.
-- Guard cuidador_id = auth.uid(): solo el paseador asignado reporta SUS prestaciones
-- (espeja paseo_marcar). SECURITY DEFINER para escribir detalle sin depender del RLS
-- de UPDATE por columna.
create or replace function public.paseo_agregar_foto(p_ids uuid[], p_url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(p_url), '') = '' then
    return;
  end if;
  update public.prestaciones
    set detalle = jsonb_set(
          coalesce(detalle, '{}'::jsonb),
          '{fotos}',
          coalesce(detalle -> 'fotos', '[]'::jsonb) || to_jsonb(p_url)
        )
    where id = any(p_ids) and cuidador_id = auth.uid();
end $$;

-- ============================================================================
-- Con esto el paseo lleva evidencia visual: el cliente ve las fotos de la salida
-- de su perro en su Agenda.
-- ============================================================================
