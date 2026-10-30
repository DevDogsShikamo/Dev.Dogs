-- Structural inverse of 20261029100001_agenda.sql: removes the daily job and the agenda RPCs, and restores
-- grupo_asignar (20261013110002_s2a_grupo_asignar.sql), prestacion_cobro (20261013170001_s4b_switch.sql) and the
-- fecha_desde default. Walks and memberships already created stay. pg_cron stays (dd_purga_fotos uses it).
select cron.unschedule(jobid) from cron.job where jobname = 'dd_agenda_extender';

drop function public.prestacion_asignar(uuid, uuid);
drop function public.grupo_eliminar(uuid);
drop function public.grupo_actualizar(uuid, text, text, uuid, integer, text, text);
drop function public.grupo_quitar_perro(uuid, uuid);
drop function public.grupo_agregar_perro(uuid, uuid, integer[]);
drop function public.agenda_extender();
drop function public.agenda_materializar(uuid);
drop function public.agenda_editable(public.prestaciones);

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

create or replace function public.prestacion_cobro() returns trigger
  language plpgsql security definer set search_path = '' as
$$
declare
  v_precio integer := 0; v_modelo text; v_qty integer := 1; v_cobrable boolean := true;
begin
  if auth.uid() is not null and new.servicio_id is not null then
    select t.precio, s.modelo_cobro into v_precio, v_modelo
      from public.servicios s left join public.tarifas t on t.servicio_id = s.id
      where s.id = new.servicio_id and s.negocio_id = new.negocio_id;
    v_precio := coalesce(v_precio, 0);
    if v_modelo = 'mensual' then
      v_cobrable := false; v_precio := 0;
    elsif v_modelo is not null then
      if new.tipo in ('comida', 'accesorio') and jsonb_typeof(new.detalle -> 'cantidad') = 'number' then
        v_qty := least(greatest(floor((new.detalle ->> 'cantidad')::numeric), 1), 1000)::integer;
      end if;
      v_precio := v_precio * v_qty;
    else
      v_precio := 0;
    end if;
  end if;
  insert into public.cobros (prestacion_id, negocio_id, precio_aplicado, cobrable)
    values (new.id, new.negocio_id, v_precio, v_cobrable) on conflict (prestacion_id) do nothing;
  return new;
end;
$$;

alter table public.grupo_membresias alter column fecha_desde set default current_date;
