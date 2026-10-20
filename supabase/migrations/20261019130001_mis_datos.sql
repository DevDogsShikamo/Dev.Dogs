-- "Mis datos" (Ley 1581 de 2012): every signed-in user can see and download their own personal data,
-- correct their name and phone, and file a data-rights request (consulta, rectificacion, supresion,
-- revocacion) that DevDogs staff process by SQL (supabase/README.md). Requests are written only through
-- solicitud_datos_crear and read only by their author; no one else (business owner, office) reads them.
-- The phone is corrected through the existing contacto_set; the name through the existing own-row update
-- of profiles ("profiles update self"; identity fields stay frozen by profiles_guard), now length-bounded.

-- Same bounds provision_negocio applies (1..100 after trimming). NOT VALID: rows written before are not
-- re-checked, every new or updated row is.
alter table public.profiles add constraint profiles_nombre_len
  check (char_length(btrim(nombre)) between 1 and 100) not valid;

create table public.solicitudes_datos (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  tipo          text not null check (tipo in ('consulta', 'rectificacion', 'supresion', 'revocacion')),
  detalle       text not null default '' check (char_length(detalle) <= 1000),
  estado        text not null default 'pendiente' check (estado in ('pendiente', 'en_proceso', 'respondida')),
  created_at    timestamptz not null default now(),
  -- Last day of the legal term (America/Bogota): 10 business days for a consulta, 15 for the claims.
  vence_at      date not null,
  respondida_at timestamptz,
  respuesta     text
);
alter table public.solicitudes_datos enable row level security;
-- No API write at all; the author reads their own rows. Staff use the service role / SQL editor.
revoke all on public.solicitudes_datos from public, anon, authenticated;
grant select on public.solicitudes_datos to authenticated;
create policy "solicitudes_datos read own" on public.solicitudes_datos for select using (user_id = auth.uid());

-- Records a request of the caller. Business days are Monday to Friday counted from the day after the
-- request (Bogota date); Colombian public holidays are NOT skipped, so the computed date can be earlier
-- than the legal one around a holiday (staff must check it; see supabase/README.md).
create function public.solicitud_datos_crear(p_tipo text, p_detalle text) returns jsonb
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

-- The caller's own personal data, built field by field. Every subquery is keyed on the caller's id
-- (profile, contact, salary, consents, reviews, requests) or on the caller's active perro_duenos rows
-- (dogs and their services), so no other person's data can enter: no other user's name, phone or email,
-- no walker of a service, no dog-compatibility notes that point at other dogs.
create function public.mis_datos_exportar() returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare
  v_uid     uuid := auth.uid();
  v_cliente boolean;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  v_cliente := coalesce((select p.rol = 'cliente' from public.profiles p where p.id = v_uid), false);
  return jsonb_build_object(
    'generado_at', now(),
    'cuenta', (select jsonb_build_object('email', u.email, 'creada_at', u.created_at) from auth.users u where u.id = v_uid),
    'perfil', (select jsonb_build_object('nombre', p.nombre, 'rol', p.rol, 'creado_at', p.created_at,
                 'horario', p.horario, 'vacaciones', p.vacaciones) from public.profiles p where p.id = v_uid),
    'telefono', (select c.telefono from public.contactos c where c.user_id = v_uid),
    'negocio', (select jsonb_build_object('nombre', n.nombre, 'tipo', n.tipo, 'soy_dueno', n.owner_id = v_uid)
                  from public.profiles p join public.negocios n on n.id = p.negocio_id where p.id = v_uid),
    'salario_fijo', (select m.salario_fijo from public.nomina m where m.user_id = v_uid),
    'consentimientos', coalesce((select jsonb_agg(jsonb_build_object('version', c.policy_version, 'finalidad', c.finalidad,
                         'aceptado_at', c.aceptado_at) order by c.aceptado_at)
                         from public.consentimientos c where c.user_id = v_uid), '[]'::jsonb),
    'resenas', coalesce((select jsonb_agg(jsonb_build_object('negocio', n.nombre, 'rating', r.rating, 'texto', r.texto,
                 'publicar_nombre', r.publicar_nombre, 'estado', r.estado, 'creada_at', r.created_at) order by r.created_at)
                 from public.resenas r join public.negocios n on n.id = r.negocio_id where r.autor_id = v_uid), '[]'::jsonb),
    'solicitudes', coalesce((select jsonb_agg(jsonb_build_object('tipo', s.tipo, 'detalle', s.detalle, 'estado', s.estado,
                     'creada_at', s.created_at, 'vence_at', s.vence_at, 'respondida_at', s.respondida_at, 'respuesta', s.respuesta)
                     order by s.created_at) from public.solicitudes_datos s where s.user_id = v_uid), '[]'::jsonb),
    'perros', case when not v_cliente then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
                'nombre', d.nombre, 'raza', d.raza, 'tamano', d.tamano, 'conducta', d.conducta, 'tips', d.tips,
                'activo', d.activo, 'mi_rol', pd.rol) order by d.nombre)
                from public.perro_duenos pd join public.perros d on d.id = pd.perro_id
               where pd.dueno_id = v_uid and pd.estado = 'activo'), '[]'::jsonb) end,
    'servicios', case when not v_cliente then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
                'fecha', pr.fecha, 'hora', pr.detalle ->> 'hora', 'perro', d.nombre, 'servicio', coalesce(sv.nombre, pr.tipo),
                'estado', pr.estado, 'precio', cb.precio_aplicado, 'cobrable', cb.cobrable, 'cobrado', cb.cobrado)
                order by pr.fecha, d.nombre)
                from public.perro_duenos pd
                join public.prestaciones pr on pr.perro_id = pd.perro_id
                join public.perros d on d.id = pr.perro_id
                left join public.servicios sv on sv.id = pr.servicio_id
                left join public.cobros cb on cb.prestacion_id = pr.id
               where pd.dueno_id = v_uid and pd.estado = 'activo'), '[]'::jsonb) end
  );
end;
$$;

revoke execute on function public.solicitud_datos_crear(text, text), public.mis_datos_exportar() from public, anon;
grant execute on function public.solicitud_datos_crear(text, text), public.mis_datos_exportar() to authenticated;
