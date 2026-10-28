-- Inverse of S5b (20261015100001_s5b_photos_switch.sql), structural only. It restores the hardened
-- paseo_agregar_foto of S2b1 so a frontend revert does not call a missing function. It never makes the
-- `paseos` bucket public again, never recreates its storage policies and cannot bring back the photo URLs
-- the migration removed from prestaciones.detalle: reopening a public, unauthenticated photo store is not a
-- rollback this repo offers. Pre-launch the authoritative rollback is `git revert` plus
-- `node supabase/staging.mjs reset`.
create or replace function public.paseo_agregar_foto(p_ids uuid[], p_url text)
  returns void language plpgsql security definer set search_path = '' as
$$
declare
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  r record;
begin
  if auth.uid() is null then raise exception 'no_autorizado' using errcode = '42501'; end if;
  if coalesce(trim(p_url), '') = '' then return; end if;
  if length(p_url) > 2048 or p_url !~ '^https://' then raise exception 'url_invalida'; end if;
  if p_ids is null or cardinality(p_ids) not between 1 and 50 then raise exception 'ids_invalidos'; end if;
  if (select count(*) from public.prestaciones where id = any(p_ids) and cuidador_id = auth.uid())
     <> (select count(distinct x) from unnest(p_ids) x) then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  for r in select id, fecha, estado, detalle from public.prestaciones
           where id = any(p_ids) and cuidador_id = auth.uid() order by id for update
  loop
    continue when r.estado not in ('en_curso', 'finalizado');
    if r.fecha is null or r.fecha not between v_hoy - 1 and v_hoy then raise exception 'fuera_de_ventana'; end if;
    if jsonb_array_length(coalesce(r.detalle -> 'fotos', '[]'::jsonb)) >= 20 then raise exception 'demasiadas_fotos'; end if;
    update public.prestaciones
      set detalle = jsonb_set(coalesce(detalle, '{}'::jsonb), '{fotos}', coalesce(detalle -> 'fotos', '[]'::jsonb) || to_jsonb(p_url))
      where id = r.id;
  end loop;
end;
$$;
revoke execute on function public.paseo_agregar_foto(uuid[], text) from public, anon;
grant execute on function public.paseo_agregar_foto(uuid[], text) to authenticated;
