-- Structural inverse of 20261025110004_festivos_co.sql: the due date counts Monday to Friday again (holidays not
-- skipped) and the two helpers are dropped. Due dates already stored are not recomputed.
create or replace function public.solicitud_datos_crear(p_tipo text, p_detalle text) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  v_uid     uuid := auth.uid();
  v_detalle text := coalesce(btrim(p_detalle), '');
  v_dias    integer := case p_tipo when 'consulta' then 10 when 'rectificacion' then 15
                                   when 'supresion' then 15 when 'revocacion' then 15 end;
  v_vence   date := (now() at time zone 'America/Bogota')::date;
  v_id      uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if v_dias is null then raise exception 'tipo_invalido' using errcode = '22023'; end if;
  if char_length(v_detalle) > 1000 then raise exception 'detalle_invalido' using errcode = '22023'; end if;
  while v_dias > 0 loop
    v_vence := v_vence + 1;
    if extract(isodow from v_vence) < 6 then v_dias := v_dias - 1; end if;
  end loop;
  insert into public.solicitudes_datos (user_id, tipo, detalle, vence_at) values (v_uid, p_tipo, v_detalle, v_vence)
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'vence_at', v_vence);
end;
$$;
drop function public.dias_habiles_sumar(date, integer);
drop function public.es_festivo_co(date);
