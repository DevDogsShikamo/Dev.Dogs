-- ============================================================================
-- MIGRACIÓN — Modo paseo: el paseador EJECUTA y REPORTA el paseo.
--
-- Transiciones de estado sobre `prestaciones` (el spine de salidas):
--   programado → en_curso → finalizado   (o un perro → no_asistio)
-- El paseador mueve el grupo entero; "no salió" es por perro.
-- Se estampan horas en `detalle` (hora_recibido / hora_entrega) + nota opcional.
--
-- SECURITY DEFINER con guard `cuidador_id = auth.uid()`: solo el paseador asignado
-- puede reportar SUS prestaciones (espeja la política "prestaciones cuidador update").
--
-- Correr UNA vez en Supabase → SQL Editor. Idempotente (or replace).
-- Requiere schema_v3.sql aplicado.
-- ============================================================================

-- Marca un grupo de prestaciones (iniciar = en_curso, finalizar = finalizado) y
-- estampa la hora local (Colombia). Nota opcional (se usa al finalizar).
create or replace function public.paseo_marcar(p_ids uuid[], p_estado text, p_nota text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_estado not in ('programado','en_curso','finalizado') then
    raise exception 'estado inválido: %', p_estado;
  end if;
  update public.prestaciones
    set estado = p_estado,
        detalle = coalesce(detalle,'{}'::jsonb)
          || case
               when p_estado = 'en_curso'   then jsonb_build_object('hora_recibido', to_char(now() at time zone 'America/Bogota','HH24:MI'))
               when p_estado = 'finalizado' then jsonb_build_object('hora_entrega',  to_char(now() at time zone 'America/Bogota','HH24:MI'))
               else '{}'::jsonb
             end
          || case
               when p_nota is not null and length(trim(p_nota)) > 0 then jsonb_build_object('nota', p_nota)
               else '{}'::jsonb
             end
    where id = any(p_ids) and cuidador_id = auth.uid();
end $$;

-- Un perro no salió (no_asistio) con un motivo estructurado.
create or replace function public.paseo_no_salio(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.prestaciones
    set estado = 'no_asistio',
        detalle = coalesce(detalle,'{}'::jsonb) || jsonb_build_object('motivo_no_salio', coalesce(p_motivo,''))
    where id = p_id and cuidador_id = auth.uid();
end $$;

-- ============================================================================
-- Con esto el paseador cierra el circuito operativo: la empresa ve los paseos
-- finalizados (Inicio + Reportes) y el cliente ve el estado de su perro.
-- ============================================================================
