-- S3: invitations are the only way into an existing tenant (D8, P4, P6).
--   * the code is generated in the database (CSPRNG, 14 Crockford symbols = 70 bits) and
--     only its SHA-256 hash is stored; the plaintext is returned once by invitacion_crear
--   * bound to the invitee's email, 7 days by default, 30 days hard maximum, single use,
--     revocable, 5 failed redemptions per 15 minutes per user
--   * owners write only through the RPCs; reading never exposes the hash
-- Pre-launch only: legacy rows (plaintext codes, optional email) cannot be migrated to a
-- hashed, email-bound scheme, so they are deleted, and the plaintext `codigo` column is
-- dropped (not restorable).

delete from public.invitaciones;

alter table public.invitaciones
  add column codigo_hash bytea not null unique,
  add column usado_por   uuid references auth.users(id) on delete set null,
  add column usado_at    timestamptz,
  alter column email set not null,
  alter column created_at set not null,
  alter column created_at set default now(),
  alter column expires_at set not null,
  alter column expires_at set default now() + interval '7 days',
  drop column codigo;

alter table public.invitaciones
  drop constraint if exists invitaciones_estado_check,
  add constraint invitaciones_estado_check check (estado in ('pendiente', 'aceptada', 'expirada', 'revocada')),
  add constraint invitaciones_email_norm check (email = lower(btrim(email)) and length(email) between 3 and 254),
  add constraint invitaciones_expiry_max check (expires_at <= created_at + interval '30 days');

-- Owners read (never the hash) and use the RPCs; nobody writes the table directly.
drop policy if exists "invitaciones owner" on public.invitaciones;
create policy "invitaciones read owner" on public.invitaciones for select
  using (negocio_id = public.my_negocio() and public.is_owner());
revoke all on public.invitaciones from public, anon, authenticated;
grant select (id, negocio_id, rol, email, estado, invitado_por, created_at, expires_at, usado_por, usado_at)
  on public.invitaciones to authenticated;

-- Failed redemptions, for the attempt limit. No policy and no grant: only the definer sees it.
create table public.invitacion_intentos (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index invitacion_intentos_user on public.invitacion_intentos (user_id, created_at);
alter table public.invitacion_intentos enable row level security;
revoke all on public.invitacion_intentos from public, anon, authenticated;

create function public.invitacion_crear(p_rol text, p_email text) returns text
  language plpgsql security definer set search_path = '' as
$$
declare
  v_neg   uuid := public.my_negocio();
  v_email text := lower(btrim(p_email));
  v_alpha constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(14);
  v_code  text := '';
  v_tipo  text;
begin
  if auth.uid() is null or v_neg is null or not public.is_owner() then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if p_rol is null or p_rol not in ('cliente', 'paseador', 'empresa') then raise exception 'rol_invalido'; end if;
  select tipo into v_tipo from public.negocios where id = v_neg;
  -- An independent walker has no staff: it invites clients only.
  if v_tipo = 'independiente' and p_rol <> 'cliente' then
    raise exception 'rol_no_permitido' using errcode = '42501';
  end if;
  if v_email is null or length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'email_invalido';
  end if;

  -- 5 bits per byte (get_byte & 31) over a 32-symbol alphabet: no modulo bias.
  for i in 0..13 loop
    v_code := v_code || substr(v_alpha, (get_byte(v_bytes, i) & 31) + 1, 1);
  end loop;
  insert into public.invitaciones (negocio_id, rol, email, codigo_hash, invitado_por)
    values (v_neg, p_rol, v_email, extensions.digest(v_code, 'sha256'), auth.uid());
  return substr(v_code, 1, 7) || '-' || substr(v_code, 8, 7);
end;
$$;

create function public.invitacion_revocar(p_id uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_neg uuid;
begin
  if auth.uid() is null or not public.is_owner() then raise exception 'no_autorizado' using errcode = '42501'; end if;
  select negocio_id into v_neg from public.invitaciones where id = p_id for update;
  if v_neg is distinct from public.my_negocio() then raise exception 'no_autorizado' using errcode = '42501'; end if;
  update public.invitaciones set estado = 'revocada' where id = p_id and estado = 'pendiente';
end;
$$;

-- Final redeem_invite. It returns {ok,error} instead of raising so a failed attempt commits.
-- Not found, expired, used, revoked and wrong email all answer the same `invalid`.
create or replace function public.redeem_invite(p_codigo text) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  v_uid       uuid := auth.uid();
  v_email     text;
  v_confirmed boolean;
  v_norm      text;
  inv         public.invitaciones;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    return jsonb_build_object('ok', false, 'error', 'perfil_existente');
  end if;
  if (select count(*) from public.invitacion_intentos
        where user_id = v_uid and created_at > now() - interval '15 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'error', 'demasiados_intentos');
  end if;

  select lower(email), email_confirmed_at is not null into v_email, v_confirmed from auth.users where id = v_uid;
  -- Normalise: upper-case, only letters and digits, O -> 0, I and L -> 1.
  v_norm := translate(upper(regexp_replace(coalesce(p_codigo, ''), '[^0-9A-Za-z]', '', 'g')), 'OIL', '011');
  if length(v_norm) = 14 then
    select * into inv from public.invitaciones where codigo_hash = extensions.digest(v_norm, 'sha256') for update;
  end if;

  if inv.id is null or inv.estado <> 'pendiente' or inv.expires_at <= now()
     or not coalesce(v_confirmed, false) or v_email is distinct from inv.email then
    delete from public.invitacion_intentos where user_id = v_uid and created_at <= now() - interval '1 day';
    insert into public.invitacion_intentos (user_id) values (v_uid);
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  insert into public.profiles (id, negocio_id, rol) values (v_uid, inv.negocio_id, inv.rol);
  update public.invitaciones set estado = 'aceptada', usado_por = v_uid, usado_at = now() where id = inv.id;
  return jsonb_build_object('ok', true, 'negocio_id', inv.negocio_id, 'rol', inv.rol);
end;
$$;

revoke execute on function public.invitacion_crear(text, text), public.invitacion_revocar(uuid),
  public.redeem_invite(text) from public, anon;
grant execute on function public.invitacion_crear(text, text), public.invitacion_revocar(uuid),
  public.redeem_invite(text) to authenticated;
