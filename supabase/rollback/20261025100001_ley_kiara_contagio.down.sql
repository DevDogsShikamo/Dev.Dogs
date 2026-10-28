-- Structural inverse of 20261025100001_ley_kiara_contagio.sql: prestacion_ley_kiara() gets back its
-- 20261020120001_ley_kiara.sql body (walks and daycare held back for a dog in heat only), then the column
-- goes. The app of this slice reads and writes perros.enfermedad_contagiosa, so it must be reverted together.
create or replace function public.prestacion_ley_kiara()
  returns trigger language plpgsql security definer set search_path = '' as
$$
declare
  v_hora text := coalesce(new.detalle->>'hora', '');
  v_n    integer;
begin
  -- 9.7: a female in heat stays home.
  if new.tipo in ('paseo', 'guarderia') and new.estado in ('recibido', 'en_curso')
     and (tg_op = 'INSERT' or old.estado is distinct from new.estado)
     and exists (select 1 from public.perros where id = new.perro_id and en_celo) then
    if tg_op = 'UPDATE' then return null; end if;
    raise exception 'perro_en_celo' using errcode = '23514';
  end if;

  -- 9.6: eight dogs per walker and outing.
  if new.tipo = 'paseo' and new.cuidador_id is not null and new.fecha is not null
     and new.estado not in ('no_asistio', 'cancelado')
     and (tg_op = 'INSERT'
          or old.cuidador_id is distinct from new.cuidador_id or old.fecha is distinct from new.fecha
          or coalesce(old.detalle->>'hora', '') <> v_hora or old.tipo is distinct from new.tipo
          or old.estado in ('no_asistio', 'cancelado')) then
    perform pg_advisory_xact_lock(hashtextextended(new.cuidador_id::text || '|' || new.fecha::text || '|' || v_hora, 2480));
    select count(*) into v_n from public.prestaciones p
      where p.cuidador_id = new.cuidador_id and p.fecha = new.fecha and p.tipo = 'paseo'
        and coalesce(p.detalle->>'hora', '') = v_hora
        and p.estado not in ('no_asistio', 'cancelado')
        and p.id is distinct from new.id;
    if v_n >= 8 then raise exception 'paseador_lleno' using errcode = '23514'; end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.prestacion_ley_kiara() from public, anon, authenticated;

alter table public.perros drop column if exists enfermedad_contagiosa;
