-- A monthly plan charge (prestaciones.detalle.mensualidad, 20261029110001_mensualidades.sql) is a fee, not a
-- service the client received: like a product purchase, it does not make a client eligible to review.
-- resena_guardar is 20261026100003_resenas_motivo.sql with that one extra condition.
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
                                 and not coalesce(pr.detalle ? 'mensualidad', false)
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
        estado = 'pendiente', updated_at = now(), moderated_by = null, moderated_at = null, motivo_rechazo = null;
end;
$$;
