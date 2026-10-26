-- A same-day booking can only be cancelled before its time: once detalle.hora has passed (Bogotá) the service
-- should already have started, so it is handled with the business. A booking without an hour (no group)
-- keeps the whole day. Everything else is 20261026100002_reserva_cancelar.sql unchanged.
create or replace function public.reserva_cancelar(p_id uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  r record;
  v_ahora timestamp := now() at time zone 'America/Bogota';
begin
  select id, negocio_id, perro_id, tipo, fecha, estado, detalle into r from public.prestaciones where id = p_id for update;
  if auth.uid() is null or not found or r.negocio_id is distinct from public.my_negocio() or not public.owns_dog(r.perro_id) then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if r.estado <> 'programado' or r.fecha < v_ahora::date or r.tipo in ('comida', 'accesorio')
     or (r.fecha = v_ahora::date and coalesce(r.detalle->>'hora', '') ~ '^\d{2}:\d{2}$'
         and r.detalle->>'hora' <= to_char(v_ahora, 'HH24:MI')) then
    raise exception 'reserva_no_cancelable';
  end if;
  update public.prestaciones
     set estado = 'cancelado',
         detalle = coalesce(detalle, '{}'::jsonb) || jsonb_build_object('cancelado_por', 'cliente', 'cancelado_at', now())
   where id = r.id;
end;
$$;
