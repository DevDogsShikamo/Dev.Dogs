-- Structural inverse of 20261029110001_mensualidades.sql: removes the monthly job, the plan RPCs and the
-- generation, and restores the owner's direct access to suscripciones. Plans and monthly charges already created
-- stay (export them first); pg_cron stays (dd_purga_fotos and dd_agenda_extender use it).
select cron.unschedule(jobid) from cron.job where jobname = 'dd_mensualidades';

drop function public.plan_mensual_cancelar(uuid, date);
drop function public.plan_mensual_activar(uuid, uuid, date);
drop function public.mensualidades_generar(date, uuid);
drop function public.assert_finanzas(uuid);

drop policy "suscripciones read finanzas" on public.suscripciones;
create policy "suscripciones owner" on public.suscripciones for all
  using (negocio_id = public.my_negocio() and public.is_owner())
  with check (negocio_id = public.my_negocio() and public.is_owner());
grant insert, update, delete on public.suscripciones to authenticated;

drop index public.prestaciones_mensualidad_uq;
drop index public.suscripciones_activa_uq;
alter table public.suscripciones alter column inicio set default current_date;
alter table public.suscripciones alter column precio_mensual set default 0;
alter table public.suscripciones drop constraint suscripciones_plan_completo;
alter table public.suscripciones drop constraint suscripciones_modo_cobro_check;
alter table public.suscripciones drop column modo_cobro;
