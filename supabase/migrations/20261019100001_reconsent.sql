-- Re-consent (closes the S7 gap noted in S5b): a user who accepted an older policy version, or who has
-- no consent record at all, must accept the current version before entering a portal. The app asks
-- consentimiento_pendiente() after login and keeps the portals closed until consentimiento_aceptar()
-- records the current version. Records stay readable by their owner only and never writable through
-- the API (S7 RLS and grants are unchanged); the timestamp is the server's now().

-- The current version when the caller has not accepted it, else null (also null without a caller or
-- without a current version). Versions only move forward and only the current one can be accepted, so
-- "no record for the current version" is "the last accepted version is not the current one".
create function public.consentimiento_pendiente() returns text
  language sql stable security definer set search_path = '' as
$$
  select p.version from public.politicas p
   where p.vigente and auth.uid() is not null
     and not exists (select 1 from public.consentimientos c where c.user_id = auth.uid() and c.policy_version = p.version);
$$;

-- Records the caller's acceptance of the current version; any other version raises politica_invalida
-- and stores nothing. Accepting twice keeps the first record.
create function public.consentimiento_aceptar(p_politica text) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not exists (select 1 from public.politicas where version = p_politica and vigente) then
    raise exception 'politica_invalida';
  end if;
  insert into public.consentimientos (user_id, policy_version) values (v_uid, p_politica)
    on conflict (user_id, policy_version) do nothing;
end;
$$;

revoke execute on function public.consentimiento_pendiente(), public.consentimiento_aceptar(text) from public, anon;
grant execute on function public.consentimiento_pendiente(), public.consentimiento_aceptar(text) to authenticated;
