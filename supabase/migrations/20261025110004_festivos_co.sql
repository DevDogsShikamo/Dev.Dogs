-- Business days skip Colombian public holidays (Ley 51 de 1983, "Ley Emiliani"): the due date of a data-rights
-- request (solicitud_datos_crear, 20261019130001_mis_datos.sql) counted Monday to Friday only, so around a
-- holiday it fell earlier than the legal one. Computed, no table to maintain.

-- True when d is a Colombian public holiday:
--   * fixed and never moved: 1 Jan, 1 May, 20 Jul, 7 Aug, 8 Dec, 25 Dec
--   * moved to the following Monday when they do not fall on a Monday: 6 Jan, 19 Mar, 29 Jun, 15 Aug, 12 Oct,
--     1 Nov, 11 Nov
--   * Easter-based: Holy Thursday and Good Friday (not moved); Ascension, Corpus Christi and Sacred Heart on the
--     Mondays after Easter+39, +60 and +68 (Easter+43, +64, +71)
-- Easter Sunday by the anonymous Gregorian algorithm (Meeus/Jones/Butcher).
create function public.es_festivo_co(d date) returns boolean
  language plpgsql immutable set search_path = '' as
$$
declare
  y      integer := extract(year from d);
  a      integer := y % 19;
  b      integer := y / 100;
  c      integer := y % 100;
  h      integer := (19 * a + b - b / 4 - (b - (b + 8) / 25 + 1) / 3 + 15) % 30;
  l      integer := (32 + 2 * (b % 4) + 2 * (c / 4) - h - c % 4) % 7;
  m      integer := (a + 11 * h + 22 * l) / 451;
  pascua date    := make_date(y, (h + l - 7 * m + 114) / 31, (h + l - 7 * m + 114) % 31 + 1);
  fijo   date;
begin
  if d is null then return null; end if;
  if d in (pascua - 3, pascua - 2, pascua + 43, pascua + 64, pascua + 71) then return true; end if;
  if (extract(month from d), extract(day from d)) in ((1, 1), (5, 1), (7, 20), (8, 7), (12, 8), (12, 25)) then
    return true;
  end if;
  foreach fijo in array array[make_date(y, 1, 6), make_date(y, 3, 19), make_date(y, 6, 29), make_date(y, 8, 15),
                              make_date(y, 10, 12), make_date(y, 11, 1), make_date(y, 11, 11)] loop
    if d = fijo + (8 - extract(isodow from fijo)::integer) % 7 then return true; end if;
  end loop;
  return false;
end;
$$;

-- The date p_dias business days (Monday to Friday, not a holiday) after p_desde, counting from the next day.
create function public.dias_habiles_sumar(p_desde date, p_dias integer) returns date
  language plpgsql immutable set search_path = '' as
$$
declare
  v_fecha date := p_desde;
  v_dias  integer := p_dias;
begin
  while v_dias > 0 loop
    v_fecha := v_fecha + 1;
    if extract(isodow from v_fecha) < 6 and not public.es_festivo_co(v_fecha) then v_dias := v_dias - 1; end if;
  end loop;
  return v_fecha;
end;
$$;
revoke execute on function public.es_festivo_co(date), public.dias_habiles_sumar(date, integer) from public, anon, authenticated;

-- Same body as 20261019130001_mis_datos.sql except the due date, which now skips holidays.
create or replace function public.solicitud_datos_crear(p_tipo text, p_detalle text) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  v_uid     uuid := auth.uid();
  v_detalle text := coalesce(btrim(p_detalle), '');
  v_dias    integer := case p_tipo when 'consulta' then 10 when 'rectificacion' then 15
                                   when 'supresion' then 15 when 'revocacion' then 15 end;
  v_vence   date;
  v_id      uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if v_dias is null then raise exception 'tipo_invalido' using errcode = '22023'; end if;
  if char_length(v_detalle) > 1000 then raise exception 'detalle_invalido' using errcode = '22023'; end if;
  v_vence := public.dias_habiles_sumar((now() at time zone 'America/Bogota')::date, v_dias);
  insert into public.solicitudes_datos (user_id, tipo, detalle, vence_at) values (v_uid, p_tipo, v_detalle, v_vence)
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'vence_at', v_vence);
end;
$$;
