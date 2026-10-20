-- ============================================================================
-- SEED de prueba — portal PASEADOR ("Mi día"). AUTO-SUFICIENTE e IDEMPOTENTE.
--
-- Crea el negocio + perfil (rol paseador) si faltan, y carga 3 perros con
-- prestaciones de HOY asignadas a vos. Podés re-correrlo sin duplicar.
--
-- CÓMO USAR:
--   1. Registrate/logueate en la app con tu email de prueba (debe existir en auth.users).
--   2. Poné tu email abajo (v_email).
--   3. Corré este script en Supabase → SQL Editor.
--   4. En la app: CERRÁ SESIÓN y volvé a entrar (para refrescar el perfil), luego /app.
--
-- Corre como service role (SQL Editor) → no lo frena el RLS.
-- ============================================================================
do $$
declare
  v_email    text := 'test@gmail.com';   -- <<< tu email de prueba
  v_uid      uuid;
  v_negocio  uuid;
  v_servicio uuid;
  v_perro    uuid;
begin
  select id into v_uid from auth.users where email = v_email;
  if v_uid is null then
    raise exception 'No existe un usuario con email % en auth.users. Registrate primero en la app.', v_email;
  end if;

  -- Perfil + negocio: crearlos si faltan (usuario huérfano / provisioning no corrió).
  select negocio_id into v_negocio from public.profiles where id = v_uid;
  if v_negocio is null then
    insert into public.negocios (owner_id, nombre, tipo)
      values (v_uid, 'Paseos de prueba', 'independiente')
      returning id into v_negocio;
    insert into public.profiles (id, negocio_id, rol, nombre)
      values (v_uid, v_negocio, 'paseador', 'Carlos')
      on conflict (id) do update set negocio_id = excluded.negocio_id, rol = 'paseador', nombre = excluded.nombre;
    raise notice 'Perfil + negocio creados para %', v_email;
  end if;

  -- Servicio de paseo (reusar si ya existe).
  select id into v_servicio from public.servicios
    where negocio_id = v_negocio and tipo = 'paseo' limit 1;
  if v_servicio is null then
    insert into public.servicios (negocio_id, tipo, nombre, modelo_cobro, precio, duracion_min)
      values (v_negocio, 'paseo', 'Paseo estándar', 'por_uso', 20000, 45)
      returning id into v_servicio;
  end if;

  -- Limpieza idempotente: borra los perros de prueba (cascade borra sus prestaciones).
  delete from public.perros where negocio_id = v_negocio and nombre in ('Rocky','Luna','Thor');

  insert into public.perros (negocio_id, nombre, conducta, tips)
    values (v_negocio, 'Rocky', 'energico', 'Tira de la correa al arrancar.') returning id into v_perro;
  insert into public.prestaciones (negocio_id, perro_id, servicio_id, tipo, cuidador_id, fecha, estado, detalle)
    values (v_negocio, v_perro, v_servicio, 'paseo', v_uid, current_date, 'programado',
            jsonb_build_object('hora','08:30','duracion',45,'direccion','Cra 12 #4-56, Chapinero'));

  insert into public.perros (negocio_id, nombre, conducta, tips)
    values (v_negocio, 'Luna', 'tranquilo', 'Se lleva bien con otros perros.') returning id into v_perro;
  insert into public.prestaciones (negocio_id, perro_id, servicio_id, tipo, cuidador_id, fecha, estado, detalle)
    values (v_negocio, v_perro, v_servicio, 'paseo', v_uid, current_date, 'programado',
            jsonb_build_object('hora','09:15','duracion',30,'direccion','Calle 45 #9-20, Palermo'));

  insert into public.perros (negocio_id, nombre, conducta, tips)
    values (v_negocio, 'Thor', 'reactivo', 'Reactivo con motos. Evitar avenidas.') returning id into v_perro;
  insert into public.prestaciones (negocio_id, perro_id, servicio_id, tipo, cuidador_id, fecha, estado, detalle)
    values (v_negocio, v_perro, v_servicio, 'paseo', v_uid, current_date, 'programado',
            jsonb_build_object('hora','10:00','duracion',60,'direccion','Av 7 #100-30, Usaquén'));

  raise notice 'Seed OK: 3 perros + prestaciones de hoy para % (negocio %)', v_email, v_negocio;
end $$;
