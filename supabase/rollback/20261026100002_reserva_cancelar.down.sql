-- Structural inverse of 20261026100002_reserva_cancelar.sql. Bookings already cancelled stay 'cancelado'
-- (with detalle.cancelado_por / cancelado_at as the record of who cancelled). The client "Cancelar" action
-- must be reverted with it.
drop function if exists public.reserva_cancelar(uuid);
