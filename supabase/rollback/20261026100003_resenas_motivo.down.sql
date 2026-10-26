-- Structural inverse of 20261026100003_resenas_motivo.sql: resena_moderar takes no cause again, resena_guardar
-- gets back its 20261019120001_resenas_sin_productos.sql body and resenas.motivo_rechazo is dropped (export
-- it first if the causes must be kept). The owner's cause picker and the author's "No publicada: ..." label
-- must be reverted with it.
drop function if exists public.resena_moderar(uuid, text, text);
-- Approves or rejects a review of the caller's own tenant; owner only. An unknown id is denied like a
-- foreign one. Who and when are the server's.
create function public.resena_moderar(p_id uuid, p_estado text) returns void
  language plpgsql security definer set search_path = '' as
$$
begin
  if auth.uid() is null or not public.is_owner()
     or not exists (select 1 from public.resenas where id = p_id and negocio_id = public.my_negocio()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_estado is null or p_estado not in ('aprobada', 'rechazada') then raise exception 'estado_invalido'; end if;
  update public.resenas set estado = p_estado, moderated_by = auth.uid(), moderated_at = now() where id = p_id;
end;
$$;
revoke execute on function public.resena_moderar(uuid, text) from public, anon;
grant execute on function public.resena_moderar(uuid, text) to authenticated;

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

alter table public.resenas drop column motivo_rechazo;
