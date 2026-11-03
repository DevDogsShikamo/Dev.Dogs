-- F2 follow-up: a walker removed from the business (miembro_dar_de_baja / miembro_salir) keeps cuidador_id on the
-- walks the removal does not reassign (yesterday's, and today's in progress), and paseo_marcar / paseo_no_salio only
-- checked cuidador_id. Both now also require the walk to belong to the caller's current business, like the photo and
-- incident RPCs already do. Bodies are otherwise those of 20261013120002_s2b1_walk_state.sql.

create or replace function public.paseo_marcar(p_ids uuid[], p_estado text, p_nota text default null)
  returns void language plpgsql security definer set search_path = '' as
$$
declare
  v_hoy  date := (now() at time zone 'America/Bogota')::date;
  v_hora text := to_char(now() at time zone 'America/Bogota', 'HH24:MI');
  r record;
begin
  if auth.uid() is null then raise exception 'no_autorizado' using errcode = '42501'; end if;
  if p_estado is null or p_estado not in ('en_curso', 'finalizado') then raise exception 'estado_invalido'; end if;
  if p_ids is null or cardinality(p_ids) not between 1 and 50 then raise exception 'ids_invalidos'; end if;
  if length(coalesce(p_nota, '')) > 500 then raise exception 'nota_demasiado_larga'; end if;
  if (select count(*) from public.prestaciones where id = any(p_ids) and cuidador_id = auth.uid() and negocio_id = public.my_negocio())
     <> (select count(distinct x) from unnest(p_ids) x) then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;

  for r in select id, estado, fecha from public.prestaciones
           where id = any(p_ids) and cuidador_id = auth.uid() and negocio_id = public.my_negocio() order by id for update
  loop
    continue when r.estado = p_estado or r.estado in ('no_asistio', 'cancelado');
    if r.fecha is null or r.fecha not between v_hoy - 1 and v_hoy then raise exception 'fuera_de_ventana'; end if;
    if not ((p_estado = 'en_curso' and r.estado = 'programado') or (p_estado = 'finalizado' and r.estado = 'en_curso')) then
      raise exception 'transicion_invalida';
    end if;
    update public.prestaciones
      set estado = p_estado,
          detalle = coalesce(detalle, '{}'::jsonb)
            || jsonb_build_object(case p_estado when 'en_curso' then 'hora_recibido' else 'hora_entrega' end, v_hora)
            || case when length(trim(coalesce(p_nota, ''))) > 0 then jsonb_build_object('nota', p_nota) else '{}'::jsonb end
      where id = r.id;
  end loop;
end;
$$;

create or replace function public.paseo_no_salio(p_id uuid, p_motivo text)
  returns void language plpgsql security definer set search_path = '' as
$$
declare
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  r record;
begin
  if auth.uid() is null then raise exception 'no_autorizado' using errcode = '42501'; end if;
  if length(coalesce(p_motivo, '')) > 500 then raise exception 'motivo_demasiado_largo'; end if;
  select id, estado, fecha into r from public.prestaciones
    where id = p_id and cuidador_id = auth.uid() and negocio_id = public.my_negocio() for update;
  if not found then raise exception 'no_autorizado' using errcode = '42501'; end if;
  if r.estado = 'no_asistio' then return; end if;
  if r.fecha is null or r.fecha not between v_hoy - 1 and v_hoy then raise exception 'fuera_de_ventana'; end if;
  if r.estado not in ('programado', 'en_curso') then raise exception 'transicion_invalida'; end if;
  update public.prestaciones
    set estado = 'no_asistio',
        detalle = coalesce(detalle, '{}'::jsonb) || jsonb_build_object('motivo_no_salio', coalesce(p_motivo, ''))
    where id = r.id;
end;
$$;
