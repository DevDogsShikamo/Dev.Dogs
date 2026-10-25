-- Ley 2480 de 2025 (Ley Kiara), art. 7: no daycare, hotel or training service for a female in heat nor for
-- an animal with an infectious-contagious disease. 20261020120001_ley_kiara.sql held back walks and daycare
-- for a dog in heat only; this adds perros.enfermedad_contagiosa and extends the same rule to training and to
-- contagious dogs. Same semantics: in an UPDATE (paseo_marcar starting a whole group) the row is left as it
-- was and the batch goes on; an INSERT already started is rejected (perro_en_celo, or perro_enfermo).
-- The 9.6 block (eight dogs per walker and outing) is unchanged.
-- enfermedad_contagiosa is written like any other dog field: "perros update owner" only.
alter table public.perros add column enfermedad_contagiosa boolean not null default false;

create or replace function public.prestacion_ley_kiara()
  returns trigger language plpgsql security definer set search_path = '' as
$$
declare
  v_hora    text := coalesce(new.detalle->>'hora', '');
  v_n       integer;
  v_celo    boolean;
  v_enfermo boolean;
begin
  -- art. 7 and 9.7: a female in heat or a dog with a contagious disease stays home.
  if new.tipo in ('paseo', 'guarderia', 'adiestramiento') and new.estado in ('recibido', 'en_curso')
     and (tg_op = 'INSERT' or old.estado is distinct from new.estado) then
    select en_celo, enfermedad_contagiosa into v_celo, v_enfermo from public.perros where id = new.perro_id;
    if v_celo or v_enfermo then
      if tg_op = 'UPDATE' then return null; end if;
      if v_celo then raise exception 'perro_en_celo' using errcode = '23514'; end if;
      raise exception 'perro_enfermo' using errcode = '23514';
    end if;
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
