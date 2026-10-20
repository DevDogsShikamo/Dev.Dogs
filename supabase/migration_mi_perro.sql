-- ============================================================================
-- MIGRACIÓN — El CLIENTE registra su propio perro.
--
-- Problema (RLS): un cliente PUEDE insertar en `perros` (política "perros write own"
-- solo exige negocio_id = my_negocio en el INSERT), pero NO puede crear la primera
-- fila de `perro_duenos`: la política "perro_duenos invite" exige owns_dog(perro_id),
-- que es falso antes de que exista el vínculo. Huevo-y-gallina.
--
-- Solución (espeja redeem_invite): una función SECURITY DEFINER que, en nombre del
-- usuario, crea el perro bajo SU negocio y lo enlaza como dueño principal, atómico.
--
-- Correr UNA vez en Supabase → SQL Editor. Idempotente (or replace).
-- Requiere schema_v3.sql + migration_incompatibles.sql (columna sociabilidad).
-- ============================================================================

create or replace function public.crear_mi_perro(
  p_nombre       text,
  p_raza         text default null,
  p_tamano       text default null,
  p_conducta     text default null,
  p_tips         text default null,
  p_sociabilidad text default null
) returns uuid
  language plpgsql security definer set search_path = public as
$$
declare
  v_neg   uuid;
  v_perro uuid;
begin
  select negocio_id into v_neg from public.profiles where id = auth.uid();
  if v_neg is null then
    raise exception 'Sin negocio asociado';
  end if;
  if coalesce(trim(p_nombre), '') = '' then
    raise exception 'El perro necesita un nombre';
  end if;

  insert into public.perros (negocio_id, nombre, raza, tamano, conducta, tips, sociabilidad)
    values (
      v_neg,
      trim(p_nombre),
      nullif(trim(coalesce(p_raza, '')),       ''),
      nullif(trim(coalesce(p_tamano, '')),     ''),
      nullif(trim(coalesce(p_conducta, '')),   ''),
      nullif(trim(coalesce(p_tips, '')),       ''),
      nullif(trim(coalesce(p_sociabilidad, '')), '')
    )
    returning id into v_perro;

  insert into public.perro_duenos (perro_id, dueno_id, rol, estado)
    values (v_perro, auth.uid(), 'principal', 'activo')
    on conflict (perro_id, dueno_id) do nothing;

  return v_perro;
end;
$$;

-- ============================================================================
-- Con esto el cliente da de alta su perro (queda como dueño principal) y ya lo
-- ve en "Mis perros" y puede reservar/comprar para él.
-- ============================================================================
