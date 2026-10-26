-- Review moderation with fixed causes, so a business cannot hide a review just because it is negative
-- (Ley 1480 de 2011 arts. 29-30, Ley 256 de 1996). Rejecting needs one of four causes, stored in
-- resenas.motivo_rechazo and readable by the author (RLS "resenas read own"); anything else raises
-- motivo_invalido and stores nothing. Approving clears it; resena_guardar clears it when the author edits the
-- review (it goes back to pending). resena_moderar gains p_motivo (default null), so the old 2-argument
-- function is dropped; resena_guardar is the 20261019120001_resenas_sin_productos.sql body plus that reset.
alter table public.resenas add column motivo_rechazo text
  check (motivo_rechazo in ('ofensiva', 'datos_personales', 'no_relacionada', 'falsa_o_spam'));

drop function public.resena_moderar(uuid, text);
create function public.resena_moderar(p_id uuid, p_estado text, p_motivo text default null) returns void
  language plpgsql security definer set search_path = '' as
$$
begin
  if auth.uid() is null or not public.is_owner()
     or not exists (select 1 from public.resenas where id = p_id and negocio_id = public.my_negocio()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_estado is null or p_estado not in ('aprobada', 'rechazada') then raise exception 'estado_invalido'; end if;
  if p_estado = 'rechazada' and (p_motivo is null or p_motivo not in ('ofensiva', 'datos_personales', 'no_relacionada', 'falsa_o_spam')) then
    raise exception 'motivo_invalido';
  end if;
  update public.resenas
     set estado = p_estado, motivo_rechazo = case when p_estado = 'rechazada' then p_motivo end,
         moderated_by = auth.uid(), moderated_at = now()
   where id = p_id;
end;
$$;
revoke execute on function public.resena_moderar(uuid, text, text) from public, anon;
grant execute on function public.resena_moderar(uuid, text, text) to authenticated;

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
        estado = 'pendiente', updated_at = now(), moderated_by = null, moderated_at = null, motivo_rechazo = null;
end;
$$;
