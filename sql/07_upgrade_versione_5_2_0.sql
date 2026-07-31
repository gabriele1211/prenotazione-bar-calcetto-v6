-- VERSIONE 5.2.0 COMPLETA
-- Eseguire questo script soltanto se non è già stato eseguito
-- sql/06_costo_storico_v5_1_5.sql.
--
-- Lo script è identico alla migrazione del costo storico:
-- aggiunge costo_applicato e aggiorna la funzione di prenotazione.

begin;

alter table public.prenotazioni
  add column if not exists costo_applicato numeric(10,2);

comment on column public.prenotazioni.costo_applicato is
  'Costo fissato al momento della conferma. Non cambia modificando i prezzi futuri.';

-- Fotografa il prezzo corrente anche sulle prenotazioni già presenti.
-- Dopo questa migrazione, i futuri cambi prezzo non toccheranno queste righe.
update public.prenotazioni p
set costo_applicato =
  case
    when p.ora_inizio >= time '19:00' and p.ora_inizio < time '22:00' then
      case
        when coalesce(p.settore, 'INTERO') in ('A', 'B')
          then greatest(0, coalesce(i.prezzo_mezzo_campo, 0))
        else greatest(0, coalesce(i.prezzo_campo_intero, 0))
      end
    else 0
  end
from public.impostazioni_prenotazioni i
where i.id = 1
  and p.costo_applicato is null;

alter table public.prenotazioni
  alter column costo_applicato set default 0,
  alter column costo_applicato set not null;

drop function if exists public.crea_prenotazione_v4_1(
  uuid,text,text,text,date,text,date,time,time,text,text,integer
);

create function public.crea_prenotazione_v4_1(
  p_campo_id uuid,
  p_nome_cliente text,
  p_telefono text,
  p_documento_numero text,
  p_documento_data_rilascio date,
  p_documento_rilasciato_da text,
  p_data date,
  p_ora_inizio time,
  p_ora_fine time,
  p_note text default null,
  p_tipo_prenotazione text default 'INTERO',
  p_numero_bambini integer default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_settore text;
  v_tipo text := upper(trim(coalesce(p_tipo_prenotazione, 'INTERO')));
  v_doc text := upper(regexp_replace(coalesce(p_documento_numero, ''), '[^A-Za-z0-9]', '', 'g'));
  v_settimana_inizio date := date_trunc('week', p_data::timestamp)::date;
  v_settimana_fine date := (date_trunc('week', p_data::timestamp) + interval '7 days')::date;
  v_count integer;
  v_a_occupato boolean;
  v_b_occupato boolean;
  v_intero_occupato boolean;
  v_costo numeric(10,2) := 0;
  v_settings public.impostazioni_prenotazioni%rowtype;
begin
  select * into v_settings
  from public.impostazioni_prenotazioni
  where id = 1;

  if not coalesce(v_settings.prenotazioni_attive, true)
     or (v_settings.chiusura_dal is not null and v_settings.chiusura_al is not null
         and p_data between v_settings.chiusura_dal and v_settings.chiusura_al) then
    raise exception 'PRENOTAZIONI_SOSPESE';
  end if;

  if p_ora_inizio < time '09:00'
     or p_ora_fine > time '22:00'
     or p_ora_fine - p_ora_inizio <> interval '1 hour' then
    raise exception 'ORARIO_NON_VALIDO';
  end if;

  if v_tipo not in ('INTERO','MEZZO') then
    raise exception 'TIPO_PRENOTAZIONE_NON_VALIDO';
  end if;

  if v_tipo = 'MEZZO' then
    if not coalesce(v_settings.mezzo_campo_attivo, false) then
      raise exception 'MEZZO_CAMPO_NON_ATTIVO';
    end if;
    if p_numero_bambini is null
       or p_numero_bambini < 1
       or p_numero_bambini > coalesce(v_settings.max_bambini_mezzo_campo, 6) then
      raise exception 'NUMERO_BAMBINI_NON_VALIDO';
    end if;
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_campo_id::text || '|' || p_data::text || '|' || p_ora_inizio::text)
  );

  select
    bool_or(coalesce(settore,'INTERO') = 'INTERO'),
    bool_or(settore = 'A'),
    bool_or(settore = 'B')
  into v_intero_occupato, v_a_occupato, v_b_occupato
  from public.prenotazioni
  where campo_id = p_campo_id
    and data = p_data
    and ora_inizio = p_ora_inizio
    and stato = 'confermata';

  v_intero_occupato := coalesce(v_intero_occupato, false);
  v_a_occupato := coalesce(v_a_occupato, false);
  v_b_occupato := coalesce(v_b_occupato, false);

  if v_tipo = 'INTERO' then
    if v_intero_occupato or v_a_occupato or v_b_occupato then
      raise exception 'ORARIO_OCCUPATO';
    end if;
    v_settore := 'INTERO';
  else
    if v_intero_occupato then
      raise exception 'ORARIO_OCCUPATO';
    elsif not v_a_occupato then
      v_settore := 'A';
    elsif not v_b_occupato then
      v_settore := 'B';
    else
      raise exception 'MEZZI_CAMPI_COMPLETI';
    end if;
  end if;

  -- Il prezzo viene fissato qui, lato database, nello stesso istante
  -- della prenotazione. Le modifiche future non potranno alterarlo.
  if p_ora_inizio >= time '19:00' and p_ora_inizio < time '22:00' then
    if v_settore in ('A','B') then
      v_costo := greatest(0, coalesce(v_settings.prezzo_mezzo_campo, 0));
    else
      v_costo := greatest(0, coalesce(v_settings.prezzo_campo_intero, 0));
    end if;
  else
    v_costo := 0;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_doc || v_settimana_inizio::text));

  select count(*) into v_count
  from public.prenotazioni
  where upper(regexp_replace(coalesce(documento_numero, ''), '[^A-Za-z0-9]', '', 'g')) = v_doc
    and data >= v_settimana_inizio
    and data < v_settimana_fine
    and stato = 'confermata';

  if v_count >= 2 then
    raise exception 'LIMITE_SETTIMANALE';
  end if;

  insert into public.prenotazioni (
    campo_id, nome_cliente, telefono, documento_numero,
    documento_data_rilascio, documento_rilasciato_da,
    data, ora_inizio, ora_fine, note, stato, settore,
    numero_bambini, costo_applicato
  ) values (
    p_campo_id, trim(p_nome_cliente), trim(p_telefono), v_doc,
    p_documento_data_rilascio, trim(p_documento_rilasciato_da),
    p_data, p_ora_inizio, p_ora_fine, nullif(trim(p_note),''),
    'confermata', v_settore,
    case when v_settore in ('A','B') then p_numero_bambini else null end,
    v_costo
  )
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'settore', v_settore,
    'tipo', case when v_settore = 'INTERO' then 'INTERO' else 'MEZZO' end,
    'numero_bambini', case when v_settore in ('A','B') then p_numero_bambini else null end,
    'costo_applicato', v_costo
  );
exception
  when unique_violation then
    raise exception 'ORARIO_OCCUPATO';
end;
$$;

grant execute on function public.crea_prenotazione_v4_1(
  uuid,text,text,text,date,text,date,time,time,text,text,integer
) to anon, authenticated;

commit;
