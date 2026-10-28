-- A client cancels a scheduled service of its own dog before it starts. Only an active owner of the dog
-- (principal or co-owner, owns_dog) of the caller's business, only estado 'programado', only from today
-- (Bogotá) on, never a product: no_autorizado (42501) or reserva_no_cancelable otherwise. The booking becomes
-- 'cancelado' with detalle.cancelado_por = 'cliente' and detalle.cancelado_at (server time). Its cobros row
-- stays as it was: cobro_marcar only takes 'finalizado' services and the balance only sums them, so a
-- cancelled booking is never charged in the app. Any cancellation fee or notice is the business's own policy.
-- paseo_marcar already skips 'cancelado', so the walker cannot start it afterwards.
create function public.reserva_cancelar(p_id uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  r record;
begin
  select id, negocio_id, perro_id, tipo, fecha, estado into r from public.prestaciones where id = p_id for update;
  if auth.uid() is null or not found or r.negocio_id is distinct from public.my_negocio() or not public.owns_dog(r.perro_id) then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if r.estado <> 'programado' or r.fecha < (now() at time zone 'America/Bogota')::date or r.tipo in ('comida', 'accesorio') then
    raise exception 'reserva_no_cancelable';
  end if;
  update public.prestaciones
     set estado = 'cancelado',
         detalle = coalesce(detalle, '{}'::jsonb) || jsonb_build_object('cancelado_por', 'cliente', 'cancelado_at', now())
   where id = r.id;
end;
$$;
revoke execute on function public.reserva_cancelar(uuid) from public, anon;
grant execute on function public.reserva_cancelar(uuid) to authenticated;
