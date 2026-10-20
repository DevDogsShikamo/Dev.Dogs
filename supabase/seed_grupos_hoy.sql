-- ============================================================================
-- SEED — Grupos + membresías con recurrencia POR PERRO + agenda materializada.
-- Requiere haber corrido antes: migration_grupos.sql (crea grupos, grupo_membresias,
-- prestaciones.grupo_id y la función recurrencia_aplica).
--
-- Crea 4 grupos (zonas) y 21 perros con foto/info, cada perro con SU recurrencia:
--   diario · semanal (días fijos) · cada_n_dias (días de por medio) · semanas_alternas.
-- Luego MATERIALIZA prestaciones para los próximos 56 días según cada recurrencia,
-- así el calendario muestra la variabilidad real navegando por el año.
--
-- CÓMO USAR: poné tu email en v_email y corré en Supabase → SQL Editor.
-- Re-ejecutable: borra y recrea los perros de prueba (cascade en membresías/prestaciones).
-- ============================================================================
do $$
declare
  v_email   text := 'deslvvpr@gmail.com';   -- <<< PONÉ TU EMAIL DE PRUEBA
  v_uid     uuid;
  v_negocio uuid;
  v_s1 uuid; v_s2 uuid; v_s3 uuid; v_s4 uuid;
  v_g1 uuid; v_g2 uuid; v_g3 uuid; v_g4 uuid;
  v_perro  uuid;
  v_i      integer := 0;
  v_nombre text; v_raza text; v_tam text; v_cond text; v_tip text; v_rec jsonb;
  v_names_all text[] := array[
    'Rocky','Luna','Thor',
    'Max','Nina','Zeus','Kira','Toby',
    'Coco','Lola','Bruno','Maya','Rex',
    'Simba','Duke','Chloe','Balto','Frida','Milo','Canela','Otto'
  ];
begin
  select id into v_uid from auth.users where email = v_email;
  if v_uid is null then
    raise exception 'No existe un usuario con email % en auth.users. Registrate primero en la app.', v_email;
  end if;

  -- Perfil + negocio.
  select negocio_id into v_negocio from public.profiles where id = v_uid;
  if v_negocio is null then
    insert into public.negocios (owner_id, nombre, tipo) values (v_uid, 'Paseos de prueba', 'independiente') returning id into v_negocio;
    insert into public.profiles (id, negocio_id, rol, nombre) values (v_uid, v_negocio, 'paseador', 'Carlos Ruiz')
      on conflict (id) do update set negocio_id = excluded.negocio_id, rol = 'paseador', nombre = excluded.nombre;
  end if;

  -- Servicios (uno por zona).
  select id into v_s1 from public.servicios where negocio_id=v_negocio and nombre='Grupo Chapinero' limit 1;
  if v_s1 is null then insert into public.servicios (negocio_id,tipo,nombre,modelo_cobro,precio,duracion_min) values (v_negocio,'paseo','Grupo Chapinero','por_uso',20000,90) returning id into v_s1; end if;
  select id into v_s2 from public.servicios where negocio_id=v_negocio and nombre='Grupo Usaquén' limit 1;
  if v_s2 is null then insert into public.servicios (negocio_id,tipo,nombre,modelo_cobro,precio,duracion_min) values (v_negocio,'paseo','Grupo Usaquén','por_uso',20000,90) returning id into v_s2; end if;
  select id into v_s3 from public.servicios where negocio_id=v_negocio and nombre='Grupo Chicó' limit 1;
  if v_s3 is null then insert into public.servicios (negocio_id,tipo,nombre,modelo_cobro,precio,duracion_min) values (v_negocio,'paseo','Grupo Chicó','por_uso',20000,90) returning id into v_s3; end if;
  select id into v_s4 from public.servicios where negocio_id=v_negocio and nombre='Grupo Norte' limit 1;
  if v_s4 is null then insert into public.servicios (negocio_id,tipo,nombre,modelo_cobro,precio,duracion_min) values (v_negocio,'paseo','Grupo Norte','por_uso',25000,120) returning id into v_s4; end if;

  -- Grupos (molde recurrente). Reusar por nombre.
  select id into v_g1 from public.grupos where negocio_id=v_negocio and nombre='Grupo Chapinero' limit 1;
  if v_g1 is null then insert into public.grupos (negocio_id,nombre,zona,servicio_id,cuidador_id,hora,duracion_min,color) values (v_negocio,'Grupo Chapinero','Chapinero',v_s1,v_uid,'08:00',90,'purple') returning id into v_g1; end if;
  select id into v_g2 from public.grupos where negocio_id=v_negocio and nombre='Grupo Usaquén' limit 1;
  if v_g2 is null then insert into public.grupos (negocio_id,nombre,zona,servicio_id,cuidador_id,hora,duracion_min,color) values (v_negocio,'Grupo Usaquén','Usaquén',v_s2,v_uid,'10:00',90,'blue') returning id into v_g2; end if;
  select id into v_g3 from public.grupos where negocio_id=v_negocio and nombre='Grupo Chicó' limit 1;
  if v_g3 is null then insert into public.grupos (negocio_id,nombre,zona,servicio_id,cuidador_id,hora,duracion_min,color) values (v_negocio,'Grupo Chicó','Chicó',v_s3,v_uid,'14:00',90,'green') returning id into v_g3; end if;
  select id into v_g4 from public.grupos where negocio_id=v_negocio and nombre='Grupo Norte' limit 1;
  if v_g4 is null then insert into public.grupos (negocio_id,nombre,zona,servicio_id,cuidador_id,hora,duracion_min,color) values (v_negocio,'Grupo Norte','Cedritos',v_s4,v_uid,'16:00',120,'purple') returning id into v_g4; end if;

  -- Reset idempotente: borra perros de prueba (cascade: membresías + prestaciones).
  delete from public.perros where negocio_id = v_negocio and nombre = any(v_names_all);

  -- ===== Perros + membresía (cada uno con SU recurrencia) =====
  -- Grupo 1 · Chapinero
  for v_nombre, v_raza, v_tam, v_cond, v_tip, v_rec in select * from unnest(
      array['Rocky','Luna','Thor'],
      array['Labrador Retriever','Criollo','Pastor Alemán'],
      array['grande','mediano','grande'],
      array['energico','tranquilo','reactivo'],
      array['Tira de la correa al arrancar; usar arnés antitirones.','Muy sociable con otros perros.','Reactivo con motos; evitar avenidas.'],
      array['{"tipo":"diario"}','{"tipo":"semanal","dias":["lun","mar","mie","jue","vie"]}','{"tipo":"cada_n_dias","n":2}']::jsonb[]
    ) as t(nombre,raza,tam,cond,tip,rec)
  loop
    v_i := v_i + 1;
    insert into public.perros (negocio_id,nombre,raza,tamano,conducta,compatible,tips,foto_url)
      values (v_negocio,v_nombre,v_raza,v_tam,v_cond,true,v_tip,'https://placedog.net/300/300?id='||v_i) returning id into v_perro;
    insert into public.grupo_membresias (grupo_id,perro_id,recurrencia) values (v_g1,v_perro,v_rec);
  end loop;

  -- Grupo 2 · Usaquén
  for v_nombre, v_raza, v_tam, v_cond, v_tip, v_rec in select * from unnest(
      array['Max','Nina','Zeus','Kira','Toby'],
      array['Golden Retriever','Beagle','Rottweiler','Border Collie','Bulldog Francés'],
      array['grande','mediano','grande','mediano','pequeno'],
      array['energico','sociable','tranquilo','energico','tranquilo'],
      array['Le encanta la pelota; buen recall.','Sigue rastros; correa corta.','Obediente pero fuerte.','Muy inteligente y activo.','Se cansa rápido; pausas.'],
      array['{"tipo":"diario"}','{"tipo":"semanas_alternas","dias":["lun","mie","vie"]}','{"tipo":"semanal","dias":["lun","mie","vie"]}','{"tipo":"cada_n_dias","n":3}','{"tipo":"diario"}']::jsonb[]
    ) as t(nombre,raza,tam,cond,tip,rec)
  loop
    v_i := v_i + 1;
    insert into public.perros (negocio_id,nombre,raza,tamano,conducta,compatible,tips,foto_url)
      values (v_negocio,v_nombre,v_raza,v_tam,v_cond,true,v_tip,'https://placedog.net/300/300?id='||v_i) returning id into v_perro;
    insert into public.grupo_membresias (grupo_id,perro_id,recurrencia) values (v_g2,v_perro,v_rec);
  end loop;

  -- Grupo 3 · Chicó
  for v_nombre, v_raza, v_tam, v_cond, v_tip, v_rec in select * from unnest(
      array['Coco','Lola','Bruno','Maya','Rex'],
      array['Poodle','Chihuahua','Boxer','Criollo','Husky Siberiano'],
      array['pequeno','pequeno','grande','mediano','grande'],
      array['tranquilo','reactivo','energico','sociable','energico'],
      array['Tranquilo y fácil.','Ladra a perros grandes; distancia.','Muy energético; trote suave.','Amistoso con niños.','Mucha energía; hidratar.'],
      array['{"tipo":"semanal","dias":["mar","jue"]}','{"tipo":"diario"}','{"tipo":"cada_n_dias","n":2}','{"tipo":"semanas_alternas","dias":["lun","mar","mie","jue","vie"]}','{"tipo":"semanal","dias":["sab"]}']::jsonb[]
    ) as t(nombre,raza,tam,cond,tip,rec)
  loop
    v_i := v_i + 1;
    insert into public.perros (negocio_id,nombre,raza,tamano,conducta,compatible,tips,foto_url)
      values (v_negocio,v_nombre,v_raza,v_tam,v_cond,true,v_tip,'https://placedog.net/300/300?id='||v_i) returning id into v_perro;
    insert into public.grupo_membresias (grupo_id,perro_id,recurrencia) values (v_g3,v_perro,v_rec);
  end loop;

  -- Grupo 4 · Norte
  for v_nombre, v_raza, v_tam, v_cond, v_tip, v_rec in select * from unnest(
      array['Simba','Duke','Chloe','Balto','Frida','Milo','Canela','Otto'],
      array['Criollo','Doberman','Cocker Spaniel','Malamute','Dálmata','Schnauzer','Criollo','Pastor Australiano'],
      array['mediano','grande','mediano','grande','mediano','pequeno','pequeno','mediano'],
      array['sociable','tranquilo','tranquilo','energico','energico','reactivo','sociable','energico'],
      array['Adaptable en grupo.','Guardián pero obediente.','Dulce y tranquila.','Fuerte tirador; arnés.','Corre mucho; vigilar calor.','Nervioso con desconocidos.','La más amistosa.','Tiende a pastorear.'],
      array['{"tipo":"diario"}','{"tipo":"semanal","dias":["lun","mie","vie"]}','{"tipo":"cada_n_dias","n":2}','{"tipo":"semanas_alternas","dias":["mar","jue"]}','{"tipo":"diario"}','{"tipo":"semanal","dias":["lun","jue"]}','{"tipo":"cada_n_dias","n":4}','{"tipo":"diario"}']::jsonb[]
    ) as t(nombre,raza,tam,cond,tip,rec)
  loop
    v_i := v_i + 1;
    insert into public.perros (negocio_id,nombre,raza,tamano,conducta,compatible,tips,foto_url)
      values (v_negocio,v_nombre,v_raza,v_tam,v_cond,true,v_tip,'https://placedog.net/300/300?id='||v_i) returning id into v_perro;
    insert into public.grupo_membresias (grupo_id,perro_id,recurrencia) values (v_g4,v_perro,v_rec);
  end loop;

  -- Ancla = HOY para patrones que la necesitan (cada_n_dias / semanas_alternas),
  -- así el ciclo arranca desde hoy.
  update public.grupo_membresias m
    set recurrencia = m.recurrencia || jsonb_build_object('ancla', current_date::text)
    from public.grupos g
    where g.id = m.grupo_id and g.negocio_id = v_negocio
      and (m.recurrencia->>'ancla') is null
      and (m.recurrencia->>'tipo') in ('cada_n_dias','semanas_alternas');

  -- ===== Materializar la agenda: próximos 56 días según recurrencia =====
  insert into public.prestaciones (negocio_id, perro_id, servicio_id, grupo_id, tipo, cuidador_id, fecha, estado, detalle)
  select v_negocio, m.perro_id, g.servicio_id, g.id, 'paseo', g.cuidador_id, (current_date + gs.i), 'programado',
         jsonb_build_object('hora', g.hora, 'duracion', g.duracion_min, 'direccion', coalesce(g.zona,''))
  from public.grupo_membresias m
  join public.grupos g on g.id = m.grupo_id
  cross join generate_series(0, 56) as gs(i)
  where g.negocio_id = v_negocio
    and m.activo
    and public.recurrencia_aplica(m.recurrencia, (current_date + gs.i))
    and (m.fecha_desde is null or (current_date + gs.i) >= m.fecha_desde);

  raise notice 'Seed OK: 4 grupos, 21 perros con recurrencia, agenda materializada 56 días para % (negocio %)', v_email, v_negocio;
end $$;
