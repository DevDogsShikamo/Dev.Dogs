-- Structural inverse of 20261103110001_p3a.sql. Revert the app with it (the portals call the new RPCs). The badge
-- author (verificado_por) and the reprogramacion notifications are dropped; rescheduled bookings stay as they are.
drop function public.reserva_reprogramar(uuid, date);
drop function public.mi_perro_eliminar(uuid);
drop function public.resena_borrar(uuid);
drop function public.negocio_renombrar(text);
drop function public.paseador_verificar(uuid, boolean);

grant update on public.negocios to authenticated;

delete from public.notificaciones where tipo = 'reprogramacion';
alter table public.notificaciones drop constraint notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check
  check (tipo in ('reserva', 'compra', 'cancelacion', 'resena', 'perro_nuevo', 'foto_reporte'));

create or replace function public.notif_prestacion() returns trigger
  language plpgsql security definer set search_path = '' as
$$
declare
  v_resumen text;
begin
  if public.my_rol() is distinct from 'cliente' then return null; end if;
  select concat_ws(' · ', p.nombre, s.nombre, to_char(new.fecha, 'DD/MM/YYYY') || coalesce(' ' || nullif(new.detalle->>'hora', ''), ''))
    into v_resumen
    from public.perros p left join public.servicios s on s.id = new.servicio_id
   where p.id = new.perro_id;
  perform public.notificacion_crear(new.negocio_id,
    case when tg_op = 'UPDATE' then 'cancelacion' when new.tipo in ('comida', 'accesorio') then 'compra' else 'reserva' end,
    new.id, v_resumen, 'office');
  return null;
end;
$$;

create or replace function public.perro_eliminar(p_id uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_neg uuid;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
begin
  select negocio_id into v_neg from public.perros where id = p_id;
  if auth.uid() is null or v_neg is null or v_neg is distinct from public.my_negocio() or not public.is_owner() then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  update public.perros set activo = false where id = p_id;
  delete from public.prestaciones
    where perro_id = p_id and estado = 'programado' and not exists (select 1 from public.cobros c where c.prestacion_id = prestaciones.id and c.cobrado) and fecha >= v_hoy;
  delete from public.grupo_membresias where perro_id = p_id;
  update public.perros o
    set incompatibles = coalesce((
      select jsonb_agg(e) from jsonb_array_elements(o.incompatibles) e
      where coalesce(case when jsonb_typeof(e) = 'object' then e ->> 'id' else e #>> '{}' end, '') <> p_id::text
    ), '[]'::jsonb)
    where o.negocio_id = v_neg and o.id <> p_id and jsonb_typeof(o.incompatibles) = 'array'
      and o.incompatibles::text like '%' || p_id::text || '%';
end;
$$;
drop function public.perro_baja_aplicar(uuid, uuid);

create or replace function public.miembro_baja_aplicar(p_usuario uuid, p_neg uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_hoy   date := (now() at time zone 'America/Bogota')::date;
  v_email text;
begin
  select lower(email) into v_email from auth.users where id = p_usuario;
  update public.profiles set negocio_id = null, baja_at = now() where id = p_usuario and negocio_id = p_neg;
  delete from public.permisos  where user_id = p_usuario;
  delete from public.nomina    where user_id = p_usuario;
  delete from public.contactos where user_id = p_usuario;
  update public.invitaciones set estado = 'revocada'
   where negocio_id = p_neg and estado = 'pendiente' and (email = v_email or invitado_por = p_usuario);
  update public.prestaciones p set cuidador_id = null
   where p.negocio_id = p_neg and p.cuidador_id = p_usuario and p.estado = 'programado' and p.fecha >= v_hoy
     and not exists (select 1 from public.cobros c where c.prestacion_id = p.id and c.cobrado);
  update public.grupos set cuidador_id = null where negocio_id = p_neg and cuidador_id = p_usuario;
  update public.perro_duenos d set estado = 'inactivo'
   where d.dueno_id = p_usuario and d.estado <> 'inactivo'
     and exists (select 1 from public.perros x where x.id = d.perro_id and x.negocio_id = p_neg);
end;
$$;

create or replace function public.profiles_guard() returns trigger
  language plpgsql set search_path = '' as
$$
begin
  if current_user in ('authenticated', 'anon') then
    if new.id            is distinct from old.id
       or new.rol           is distinct from old.rol
       or new.negocio_id    is distinct from old.negocio_id
       or new.verificado    is distinct from old.verificado
       or new.verificado_at is distinct from old.verificado_at then
      raise exception 'identity_frozen' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
alter table public.profiles drop column verificado_por;
