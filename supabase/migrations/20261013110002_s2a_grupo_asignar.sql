-- S2a / part 2: reassigning a group's walker goes through grupo_asignar, so the
-- table policy that let any office member rewrite whole group rows is dropped.
-- The cuidador must be a walker of the group's tenant or its owner (NULL unassigns).
-- Ships with the data.ts switch to this RPC.

create or replace function public.grupo_asignar(p_grupo uuid, p_cuidador uuid) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_neg uuid;
begin
  select negocio_id into v_neg from public.grupos where id = p_grupo;
  perform public.assert_gestor(v_neg);
  if p_cuidador is not null and not exists (
    select 1 from public.profiles p
    where p.id = p_cuidador and p.negocio_id = v_neg
      and (p.rol = 'paseador' or exists (select 1 from public.negocios n where n.id = v_neg and n.owner_id = p.id))
  ) then
    raise exception 'cuidador_invalido';
  end if;
  update public.grupos set cuidador_id = p_cuidador where id = p_grupo;
end;
$$;

revoke execute on function public.grupo_asignar(uuid, uuid) from public, anon;
grant execute on function public.grupo_asignar(uuid, uuid) to authenticated;

drop policy if exists "grupos write office" on public.grupos;
