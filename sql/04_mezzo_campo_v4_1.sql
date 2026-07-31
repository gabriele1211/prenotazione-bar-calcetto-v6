-- ============================================================
-- PRENOTAZIONE CALCETTO V4.1 BETA - MEZZO CAMPO
-- Eseguire UNA SOLA VOLTA nel SQL Editor di Supabase.
-- Poi caricare sul sito i file della cartella web.
-- ============================================================

begin;

alter table public.impostazioni_prenotazioni
  add column if not exists mezzo_campo_attivo boolean not null default false,
  add column if not exists max_bambini_mezzo_campo integer not null default 6,
  add column if not exists prezzo_campo_intero numeric(8,2) not null default 0,
  add column if not exists prezzo_mezzo_campo numeric(8,2) not null default 0;

alter table public.impostazioni_prenotazioni
  drop constraint if exists impostazioni_max_bambini_check,
  add constraint impostazioni_max_bambini_check
    check (max_bambini_mezzo_campo between 1 and 20);

alter table public.impostazioni_prenotazioni
  drop constraint if exists impostazioni_prezzi_check,
  add constraint impostazioni_prezzi_check
    check (prezzo_campo_intero >= 0 and prezzo_mezzo_campo >= 0);

alter table public.prenotazioni
  add column if not exists settore text not null default 'INTERO',
  add column if not exists numero_bambini integer;

update public.prenotazioni
set settore = 'INTERO'
where settore is null or settore not in ('INTERO','A','B');

alter table public.prenotazioni
  drop constraint if exists prenotazioni_settore_check,
  add constraint prenotazioni_settore_check
    check (settore in ('INTERO','A','B'));

alter table public.prenotazioni
  drop constraint if exists prenotazioni_numero_bambini_check,
  add constraint prenotazioni_numero_bambini_check
    check (
      (settore = 'INTERO' and numero_bambini is null)
      or
      (settore in ('A','B') and numero_bambini between 1 and 20)
    );

-- Rimuove eventuali vecchi vincoli univoci che impediscono due prenotazioni
-- nella stessa ora. La nuova funzione usa un lock atomico e assegna A/B.
do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.prenotazioni'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%campo_id%'
      and pg_get_constraintdef(oid) ilike '%data%'
      and pg_get_constraintdef(oid) ilike '%ora_inizio%'
  loop
    execute format('alter table public.prenotazioni drop constraint %I', r.conname);
  end loop;
end $$;

-- Rimuove anche eventuali vecchi indici univoci creati direttamente
-- e non associati a un constraint.
do $$
declare
  r record;
begin
  for r in
    select
      n.nspname as schema_name,
      i.relname as index_name
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
    join pg_class t on t.oid = x.indrelid
    join pg_namespace n on n.oid = i.relnamespace
    left join pg_constraint c on c.conindid = i.oid
    where t.oid = 'public.prenotazioni'::regclass
      and x.indisunique
      and not x.indisprimary
      and c.oid is null
      and pg_get_indexdef(i.oid) ilike '%campo_id%'
      and pg_get_indexdef(i.oid) ilike '%data%'
      and pg_get_indexdef(i.oid) ilike '%ora_inizio%'
      and pg_get_indexdef(i.oid) not ilike '%settore%'
  loop
    execute format('drop index if exists %I.%I', r.schema_name, r.index_name);
  end loop;
end $$;

-- Impedisce duplicati dello stesso settore nella medesima fascia.
create unique index if not exists ux_prenotazioni_slot_settore_confermato
  on public.prenotazioni (campo_id, data, ora_inizio, settore)
  where stato = 'confermata';

drop function if exists public.get_daily_planning_v4_1(uuid,date);

create function public.get_daily_planning_v4_1(
  p_campo_id uuid,
  p_data date
)
returns table (
  id uuid,
  ora_inizio time,
  ora_fine time,
  nome_pubblico text,
  stato text,
  settore text,
  numero_bambini integer
)
language sql
security definer
set search_path = public
as $$
  select
    p.id,
    p.ora_inizio,
    p.ora_fine,
    case
      when nullif(trim(p.nome_cliente), '') is null then 'Occupato'
      else split_part(trim(p.nome_cliente), ' ', 1) ||
           case
             when position(' ' in trim(p.nome_cliente)) > 0
             then ' ' || left(split_part(trim(p.nome_cliente), ' ', 2), 1) || '.'
             else ''
           end
    end as nome_pubblico,
    p.stato,
    coalesce(p.settore, 'INTERO') as settore,
    p.numero_bambini
  from public.prenotazioni p
  where p.campo_id = p_campo_id
    and p.data = p_data
    and p.stato = 'confermata'
  order by p.ora_inizio, p.settore;
$$;

grant execute on function public.get_daily_planning_v4_1(uuid,date) to anon, authenticated;

drop function if exists public.crea_prenotazione_v4_1(uuid,text,text,text,date,text,date,time,time,text,text,integer);

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

  -- Lock unico per campo, data e fascia: evita prenotazioni simultanee incoerenti.
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
    data, ora_inizio, ora_fine, note, stato, settore, numero_bambini
  ) values (
    p_campo_id, trim(p_nome_cliente), trim(p_telefono), v_doc,
    p_documento_data_rilascio, trim(p_documento_rilasciato_da),
    p_data, p_ora_inizio, p_ora_fine, nullif(trim(p_note),''),
    'confermata', v_settore,
    case when v_settore in ('A','B') then p_numero_bambini else null end
  )
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'settore', v_settore,
    'tipo', case when v_settore = 'INTERO' then 'INTERO' else 'MEZZO' end,
    'numero_bambini', case when v_settore in ('A','B') then p_numero_bambini else null end
  );
exception
  when unique_violation then
    raise exception 'ORARIO_OCCUPATO';
end;
$$;

grant execute on function public.crea_prenotazione_v4_1(uuid,text,text,text,date,text,date,time,time,text,text,integer)
to anon, authenticated;

commit;
