-- P3a: walker badge, business rename and three client actions.
--   paseador_verificar(p_paseador, p_verificado)  the owner records that the business checked the identity document
--                        of one of its walkers in person (profiles.verificado + verificado_at + verificado_por, no copy
--                        nor number of the document). Only a walker of the owner's business; nobody sets it on itself
--                        (profiles_guard now freezes verificado_por too); leaving or being removed clears it.
--   negocio_renombrar(p_nombre) -> text  owner only, trimmed, 1..100 characters (the limit of provision_negocio).
--                        authenticated keeps UPDATE on negocios.zonas only: the name goes through the RPC and
--                        tipo, slug, owner_id and id are no longer writable from the client.
--   resena_borrar(p_negocio)  the author deletes its own review of that business and its pending notification.
--   mi_perro_eliminar(p_perro)  the principal owner (a client) removes a dog that never had a service of any kind,
--                        e.g. registered by mistake (perro_con_historial otherwise: the business removes it). Same
--                        removal as perro_eliminar (perro_baja_aplicar): the photo goes first (perro_con_foto) and the
--                        pickup point goes with it (trg_perro_recogida_baja).
--   reserva_reprogramar(p_prestacion, p_fecha) -> uuid  an owner of the dog (principal or co-owner, like
--                        reserva_cancelar) moves its own booking: the cutoff of reserva_cancelar on the old one, the
--                        rules of reservar on the new date (an outing booking keeps its outing, walker and hour; the
--                        dog must not already walk with it that day; Ley 2480 art. 9.6 still caps the outing at 8).
--                        The old row is cancelled (so the recurring agenda does not recreate it) and a new one is
--                        booked, with one notification 'reprogramacion' for the office instead of a cancelacion and
--                        a reserva.
-- Everyone else gets 42501.

-- ---- verified walker -------------------------------------------------------------------------------------
alter table public.profiles add column verificado_por uuid references public.profiles (id) on delete set null;

create or replace function public.profiles_guard() returns trigger
  language plpgsql set search_path = '' as
$$
begin
  if current_user in ('authenticated', 'anon') then
    if new.id            is distinct from old.id
       or new.rol           is distinct from old.rol
       or new.negocio_id    is distinct from old.negocio_id
       or new.verificado    is distinct from old.verificado
       or new.verificado_at is distinct from old.verificado_at
       or new.verificado_por is distinct from old.verificado_por then
      raise exception 'identity_frozen' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create function public.paseador_verificar(p_paseador uuid, p_verificado boolean) returns void
  language plpgsql security definer set search_path = '' as
$$
begin
  if auth.uid() is null or not public.is_owner() or not exists (
    select 1 from public.profiles where id = p_paseador and negocio_id = public.my_negocio() and rol = 'paseador') then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if p_verificado is null then raise exception 'verificado_invalido' using errcode = '22023'; end if;
  update public.profiles
     set verificado = p_verificado,
         verificado_at = case when p_verificado then now() end,
         verificado_por = case when p_verificado then auth.uid() end
   where id = p_paseador;
end;
$$;

-- Body = 20261030100001_personas.sql plus the badge reset: a verification belongs to the business that made it.
create or replace function public.miembro_baja_aplicar(p_usuario uuid, p_neg uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_hoy   date := (now() at time zone 'America/Bogota')::date;
  v_email text;
begin
  select lower(email) into v_email from auth.users where id = p_usuario;
  update public.profiles set negocio_id = null, baja_at = now(), verificado = false, verificado_at = null, verificado_por = null
   where id = p_usuario and negocio_id = p_neg;
  delete from public.permisos  where user_id = p_usuario;
  delete from public.nomina    where user_id = p_usuario;
  delete from public.contactos where user_id = p_usuario;
  update public.invitaciones set estado = 'revocada'
   where negocio_id = p_neg and estado = 'pendiente' and (email = v_email or invitado_por = p_usuario);
  -- Walker or staff: from today on, still programado and unpaid; started, finished or paid walks keep him.
  update public.prestaciones p set cuidador_id = null
   where p.negocio_id = p_neg and p.cuidador_id = p_usuario and p.estado = 'programado' and p.fecha >= v_hoy
     and not exists (select 1 from public.cobros c where c.prestacion_id = p.id and c.cobrado);
  update public.grupos set cuidador_id = null where negocio_id = p_neg and cuidador_id = p_usuario;
  -- Client: detached from the dogs of the business (the dogs and their history stay).
  update public.perro_duenos d set estado = 'inactivo'
   where d.dueno_id = p_usuario and d.estado <> 'inactivo'
     and exists (select 1 from public.perros x where x.id = d.perro_id and x.negocio_id = p_neg);
end;
$$;

-- ---- rename the business ---------------------------------------------------------------------------------
create function public.negocio_renombrar(p_nombre text) returns text
  language plpgsql security definer set search_path = '' as
$$
declare
  v_nombre text := btrim(p_nombre);
begin
  if auth.uid() is null or not public.is_owner() then raise exception 'no_autorizado' using errcode = '42501'; end if;
  if v_nombre is null or char_length(v_nombre) not between 1 and 100 then
    raise exception 'nombre_invalido' using errcode = '22023';
  end if;
  update public.negocios set nombre = v_nombre where id = public.my_negocio();
  return v_nombre;
end;
$$;
revoke update on public.negocios from authenticated;
grant update (zonas) on public.negocios to authenticated;

-- ---- delete my review ------------------------------------------------------------------------------------
create function public.resena_borrar(p_negocio uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_id uuid;
begin
  delete from public.resenas where negocio_id = p_negocio and autor_id = auth.uid() returning id into v_id;
  if v_id is null then raise exception 'no_autorizado' using errcode = '42501'; end if;
  delete from public.notificaciones where tipo = 'resena' and ref_id = v_id;
end;
$$;

-- ---- remove a dog ----------------------------------------------------------------------------------------
-- The removal itself, shared by perro_eliminar (the business) and mi_perro_eliminar (its principal owner): the dog
-- stops being active (history kept), its unpaid future programado rows, its memberships and its place in the other
-- dogs' incompatibles go. Body = the one of perro_eliminar since 20261013170001_s4b_switch.sql.
create function public.perro_baja_aplicar(p_id uuid, p_neg uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_hoy date := (now() at time zone 'America/Bogota')::date;
begin
  update public.perros set activo = false where id = p_id;
  delete from public.prestaciones
    where perro_id = p_id and estado = 'programado' and not exists (select 1 from public.cobros c where c.prestacion_id = prestaciones.id and c.cobrado) and fecha >= v_hoy;
  delete from public.grupo_membresias where perro_id = p_id;
  update public.perros o
    set incompatibles = coalesce((
      select jsonb_agg(e) from jsonb_array_elements(o.incompatibles) e
      where coalesce(case when jsonb_typeof(e) = 'object' then e ->> 'id' else e #>> '{}' end, '') <> p_id::text
    ), '[]'::jsonb)
    where o.negocio_id = p_neg and o.id <> p_id and jsonb_typeof(o.incompatibles) = 'array'
      and o.incompatibles::text like '%' || p_id::text || '%';
end;
$$;

create or replace function public.perro_eliminar(p_id uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_neg uuid;
begin
  select negocio_id into v_neg from public.perros where id = p_id;
  if auth.uid() is null or v_neg is null or v_neg is distinct from public.my_negocio() or not public.is_owner() then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  perform public.perro_baja_aplicar(p_id, v_neg);
end;
$$;

create function public.mi_perro_eliminar(p_perro uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_neg uuid;
begin
  select negocio_id into v_neg from public.perros where id = p_perro and coalesce(activo, true) for update;
  if auth.uid() is null or v_neg is null or v_neg is distinct from public.my_negocio()
     or public.my_rol() is distinct from 'cliente' or not public.is_principal(p_perro) then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if exists (select 1 from public.prestaciones where perro_id = p_perro) then raise exception 'perro_con_historial'; end if;
  perform public.perro_baja_aplicar(p_perro, v_neg);
end;
$$;

-- ---- reschedule my booking -------------------------------------------------------------------------------
alter table public.notificaciones drop constraint notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check
  check (tipo in ('reserva', 'compra', 'cancelacion', 'resena', 'perro_nuevo', 'foto_reporte', 'reprogramacion'));

-- Body = 20261103100001_notificaciones.sql plus the transaction-local dd.sin_notif: reserva_reprogramar writes its
-- own notification instead of the cancelacion and the reserva of its two writes.
create or replace function public.notif_prestacion() returns trigger
  language plpgsql security definer set search_path = '' as
$$
declare
  v_resumen text;
begin
  if public.my_rol() is distinct from 'cliente' or current_setting('dd.sin_notif', true) = 'on' then return null; end if;
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

create function public.reserva_reprogramar(p_prestacion uuid, p_fecha date) returns uuid
  language plpgsql security definer set search_path = '' as
$$
declare
  r        record;
  v_ahora  timestamp := now() at time zone 'America/Bogota';
  v_hora   text;
  v_id     uuid;
  v_resumen text;
begin
  select id, negocio_id, perro_id, servicio_id, grupo_id, tipo, fecha, estado, detalle into r
    from public.prestaciones where id = p_prestacion for update;
  if auth.uid() is null or not found or r.negocio_id is distinct from public.my_negocio() or not public.owns_dog(r.perro_id) then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  -- The cutoff of reserva_cancelar; a monthly charge of a plan is no booking.
  if r.estado <> 'programado' or r.fecha < v_ahora::date or r.tipo in ('comida', 'accesorio')
     or coalesce(r.detalle ? 'mensualidad', false)
     or (r.fecha = v_ahora::date and coalesce(r.detalle->>'hora', '') ~ '^\d{2}:\d{2}$'
         and r.detalle->>'hora' <= to_char(v_ahora, 'HH24:MI')) then
    raise exception 'reserva_no_reprogramable';
  end if;
  if p_fecha is null or p_fecha = r.fecha then raise exception 'fecha_invalida'; end if;
  if r.grupo_id is not null then
    select hora into v_hora from public.grupos where id = r.grupo_id;
    if p_fecha = v_ahora::date and v_hora <= to_char(v_ahora, 'HH24:MI') then raise exception 'fecha_invalida'; end if;
    if exists (select 1 from public.prestaciones x where x.perro_id = r.perro_id and x.grupo_id = r.grupo_id
                and x.fecha = p_fecha and x.estado <> 'cancelado') then
      raise exception 'fecha_ocupada';
    end if;
  end if;

  perform set_config('dd.sin_notif', 'on', true);
  update public.prestaciones
     set estado = 'cancelado',
         detalle = coalesce(detalle, '{}'::jsonb) || jsonb_build_object('cancelado_por', 'cliente', 'cancelado_at', now(), 'reprogramado_a', p_fecha)
   where id = r.id;
  -- reservar: role notice, business policy, legal identity, active dog / service / outing, today .. today+365.
  v_id := public.reservar(r.perro_id, r.servicio_id, r.grupo_id, p_fecha);
  perform set_config('dd.sin_notif', 'off', true);

  select concat_ws(' · ', p.nombre, s.nombre,
                   to_char(n.fecha, 'DD/MM/YYYY') || coalesce(' ' || nullif(n.detalle->>'hora', ''), ''),
                   'antes ' || to_char(r.fecha, 'DD/MM/YYYY'))
    into v_resumen
    from public.prestaciones n join public.perros p on p.id = n.perro_id left join public.servicios s on s.id = n.servicio_id
   where n.id = v_id;
  perform public.notificacion_crear(r.negocio_id, 'reprogramacion', v_id, v_resumen, 'office');
  return v_id;
end;
$$;

-- ---- grants ----------------------------------------------------------------------------------------------
revoke execute on function public.perro_baja_aplicar(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.paseador_verificar(uuid, boolean), public.negocio_renombrar(text),
  public.resena_borrar(uuid), public.mi_perro_eliminar(uuid), public.reserva_reprogramar(uuid, date) from public, anon;
grant execute on function public.paseador_verificar(uuid, boolean), public.negocio_renombrar(text),
  public.resena_borrar(uuid), public.mi_perro_eliminar(uuid), public.reserva_reprogramar(uuid, date) to authenticated;
