-- A review needs a finished SERVICE: a product purchase (comprar_producto stores it as a 'finalizado'
-- prestación of tipo 'comida' or 'accesorio', the same rows the pricing trigger treats as products) no
-- longer makes a client eligible. Only that join condition changes; signature, definer, search_path,
-- grants and every other check of 20261019110001_resenas.sql stay as they were.
create or replace function public.resena_guardar(p_negocio uuid, p_rating integer, p_texto text, p_publicar_nombre boolean)
  returns void language plpgsql security definer set search_path = '' as
$$
declare
  v_uid   uuid := auth.uid();
  v_texto text := btrim(p_texto);
begin
  if v_uid is null or p_negocio is null or coalesce(public.my_rol(), '') <> 'cliente' or not exists (
    select 1 from public.perro_duenos pd
      join public.perros d on d.id = pd.perro_id and d.negocio_id = p_negocio
      join public.prestaciones pr on pr.perro_id = d.id and pr.negocio_id = p_negocio and pr.estado = 'finalizado'
                                 and pr.tipo not in ('comida', 'accesorio')
     where pd.dueno_id = v_uid and pd.estado = 'activo'
  ) then
    raise exception 'sin_servicio_finalizado' using errcode = '42501';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'rating_invalido'; end if;
  if v_texto is null or char_length(v_texto) not between 10 and 600 then raise exception 'texto_invalido'; end if;

  insert into public.resenas (negocio_id, autor_id, rating, texto, publicar_nombre)
    values (p_negocio, v_uid, p_rating, v_texto, coalesce(p_publicar_nombre, false))
  on conflict (negocio_id, autor_id) do update
    set rating = excluded.rating, texto = excluded.texto, publicar_nombre = excluded.publicar_nombre,
        estado = 'pendiente', updated_at = now(), moderated_by = null, moderated_at = null;
end;
$$;
