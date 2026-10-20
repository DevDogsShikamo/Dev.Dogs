-- Ley 2480 de 2025 (Ley Kiara), art. 9, enforced on every path that writes a walk (reservar, mover_perro,
-- bloque_reprogramar, paseo_marcar, the owner's direct writes and the seeds), not only in the UI:
--   9.6  no more than eight (8) dogs per walker on one outing: same cuidador_id, fecha and detalle.hora,
--        tipo 'paseo', not no_asistio/cancelado. An advisory lock per outing keeps two concurrent
--        inserts from both taking the eighth place.
--   9.7  no walk or daycare for a female in heat: a dog with en_celo cannot be received or started. In an
--        UPDATE (paseo_marcar starting a whole group) the row is left as it was and the batch goes on;
--        an INSERT already started is rejected.
--   9.3  the health certificate (issued by a vet, valid six months) is recorded as its issue date. It only
--        warns: businesses have until 2027-07-16 (art. 21) to comply, so it does not block a walk.
-- en_celo and certificado_salud are written like any other dog field: "perros update owner" only.
alter table public.perros
  add column en_celo boolean not null default false,
  add column certificado_salud date
    check (certificado_salud >= date '2000-01-01'
           and certificado_salud <= (now() at time zone 'America/Bogota')::date + 1);

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

create trigger trg_prestacion_ley_kiara
  before insert or update of estado, cuidador_id, fecha, detalle, tipo, perro_id on public.prestaciones
  for each row execute function public.prestacion_ley_kiara();
