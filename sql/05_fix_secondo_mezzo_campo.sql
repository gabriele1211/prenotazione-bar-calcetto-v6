-- ============================================================
-- FIX V4.1.1 BETA - SECONDO MEZZO CAMPO
-- Eseguire nel SQL Editor di Supabase.
--
-- Corregge il caso in cui un vecchio indice univoco impedisce
-- la prenotazione del Mezzo B dopo la prenotazione del Mezzo A.
-- Può essere eseguito anche se il precedente script V4.1 è già
-- stato applicato.
-- ============================================================

begin;

-- Elimina i vecchi VINCOLI univoci sul solo campo/data/orario,
-- lasciando intatti chiavi primarie e il nuovo indice con "settore".
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.prenotazioni'::regclass
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) ilike '%campo_id%'
      and pg_get_constraintdef(c.oid) ilike '%data%'
      and pg_get_constraintdef(c.oid) ilike '%ora_inizio%'
      and pg_get_constraintdef(c.oid) not ilike '%settore%'
  loop
    execute format(
      'alter table public.prenotazioni drop constraint if exists %I',
      r.conname
    );
  end loop;
end $$;

-- Elimina anche eventuali vecchi INDICI univoci creati direttamente
-- (non collegati a un constraint), che il primo script non rimuoveva.
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
    execute format(
      'drop index if exists %I.%I',
      r.schema_name,
      r.index_name
    );
  end loop;
end $$;

-- Ricrea/assicura l'unico indice corretto:
-- A e B possono convivere nello stesso orario, ma non può esistere
-- due volte lo stesso settore confermato.
drop index if exists public.ux_prenotazioni_slot_settore_confermato;

create unique index ux_prenotazioni_slot_settore_confermato
  on public.prenotazioni (campo_id, data, ora_inizio, settore)
  where stato = 'confermata';

commit;

-- CONTROLLO FACOLTATIVO:
-- deve comparire soltanto l'indice nuovo per la gestione dello slot.
select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'prenotazioni'
  and indexdef ilike '%campo_id%'
  and indexdef ilike '%data%'
  and indexdef ilike '%ora_inizio%'
order by indexname;
