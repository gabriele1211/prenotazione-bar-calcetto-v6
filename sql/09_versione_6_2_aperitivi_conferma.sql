-- VERSIONE 6.2.0 - APERITIVI, COSTO AUTOMATICO E CONFERMA GESTORE
-- Eseguire una sola volta nel SQL Editor di Supabase, dopo 08_versione_6_bar.sql.
-- Lo script aggiorna le tabelle già esistenti senza cancellare prodotti o prenotazioni.

begin;

alter table public.bar_prodotti
  add column if not exists persone_incluse integer not null default 1;

alter table public.bar_prodotti
  drop constraint if exists bar_prodotti_persone_incluse_check,
  add constraint bar_prodotti_persone_incluse_check
    check (persone_incluse between 1 and 30);

comment on column public.bar_prodotti.persone_incluse is
  'Numero di persone comprese nel prezzo di una singola proposta.';

alter table public.bar_prenotazioni
  add column if not exists canale_contatto text not null default 'whatsapp',
  add column if not exists prezzo_unitario_applicato numeric(10,2) not null default 0,
  add column if not exists persone_per_proposta_applicate integer not null default 1,
  add column if not exists quantita_proposte integer not null default 1,
  add column if not exists costo_totale numeric(10,2) not null default 0,
  add column if not exists aggiornato_il timestamptz not null default now();

-- Fotografa prezzo, capienza e totale anche sulle richieste già presenti.
update public.bar_prenotazioni b
set prezzo_unitario_applicato = greatest(0, coalesce(p.prezzo, 0)),
    persone_per_proposta_applicate = greatest(1, coalesce(p.persone_incluse, 1)),
    quantita_proposte = ceil(b.persone::numeric / greatest(1, coalesce(p.persone_incluse, 1)))::integer,
    costo_totale = greatest(0, coalesce(p.prezzo, 0))
      * ceil(b.persone::numeric / greatest(1, coalesce(p.persone_incluse, 1)))::integer
from public.bar_prodotti p
where p.id = b.prodotto_id
  and b.costo_totale = 0;

alter table public.bar_prenotazioni
  alter column stato set default 'da_confermare';

alter table public.bar_prenotazioni
  drop constraint if exists bar_prenotazioni_stato_check,
  drop constraint if exists bar_prenotazioni_canale_contatto_check,
  drop constraint if exists bar_prenotazioni_prezzo_unitario_applicato_check,
  drop constraint if exists bar_prenotazioni_persone_per_proposta_applicate_check,
  drop constraint if exists bar_prenotazioni_quantita_proposte_check,
  drop constraint if exists bar_prenotazioni_costo_totale_check,
  add constraint bar_prenotazioni_stato_check
    check (stato in ('da_confermare','confermata','rifiutata','annullata')),
  add constraint bar_prenotazioni_canale_contatto_check
    check (canale_contatto in ('whatsapp','telefono')),
  add constraint bar_prenotazioni_prezzo_unitario_applicato_check
    check (prezzo_unitario_applicato >= 0),
  add constraint bar_prenotazioni_persone_per_proposta_applicate_check
    check (persone_per_proposta_applicate between 1 and 30),
  add constraint bar_prenotazioni_quantita_proposte_check
    check (quantita_proposte >= 1),
  add constraint bar_prenotazioni_costo_totale_check
    check (costo_totale >= 0);

comment on column public.bar_prenotazioni.prezzo_unitario_applicato is
  'Prezzo della proposta fissato al momento della richiesta.';
comment on column public.bar_prenotazioni.persone_per_proposta_applicate is
  'Numero di persone comprese fissato al momento della richiesta.';
comment on column public.bar_prenotazioni.quantita_proposte is
  'Quantità calcolata come arrotondamento per eccesso delle persone richieste.';
comment on column public.bar_prenotazioni.costo_totale is
  'Costo totale fissato al momento della richiesta; non cambia modificando il prodotto.';

-- Calcolo e controlli eseguiti dal database prima dell'inserimento pubblico.
-- SECURITY INVOKER mantiene attive RLS e autorizzazioni del richiedente.
create or replace function public.prepara_richiesta_bar_v6_2()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_settings public.impostazioni_prenotazioni%rowtype;
  v_prezzo numeric(10,2);
  v_persone_incluse integer;
begin
  select * into v_settings
  from public.impostazioni_prenotazioni
  where id = 1;

  if not coalesce(v_settings.prenotazioni_attive, true)
     or (v_settings.chiusura_dal is not null
         and v_settings.chiusura_al is not null
         and new.data between v_settings.chiusura_dal and v_settings.chiusura_al) then
    raise exception 'APERITIVI_SOSPESI';
  end if;

  if new.data < current_date then
    raise exception 'DATA_NON_VALIDA';
  end if;

  if new.ora < time '16:00' or new.ora > time '22:30' then
    raise exception 'ORARIO_NON_VALIDO';
  end if;

  if new.persone is null or new.persone < 1 or new.persone > 30 then
    raise exception 'NUMERO_PERSONE_NON_VALIDO';
  end if;

  select prezzo, persone_incluse
    into v_prezzo, v_persone_incluse
  from public.bar_prodotti
  where id = new.prodotto_id
    and attivo = true;

  if not found then
    raise exception 'PRODOTTO_NON_DISPONIBILE';
  end if;

  new.nome_cliente := trim(new.nome_cliente);
  new.telefono := trim(new.telefono);
  new.note := nullif(trim(new.note), '');

  if char_length(new.nome_cliente) < 2 or char_length(new.nome_cliente) > 100 then
    raise exception 'NOME_NON_VALIDO';
  end if;
  if char_length(new.telefono) < 6 or char_length(new.telefono) > 30 then
    raise exception 'TELEFONO_NON_VALIDO';
  end if;

  new.stato := 'da_confermare';
  new.prezzo_unitario_applicato := greatest(0, coalesce(v_prezzo, 0));
  new.persone_per_proposta_applicate := greatest(1, coalesce(v_persone_incluse, 1));
  new.quantita_proposte := ceil(new.persone::numeric / new.persone_per_proposta_applicate)::integer;
  new.costo_totale := new.prezzo_unitario_applicato * new.quantita_proposte;
  new.aggiornato_il := now();
  return new;
end;
$$;

revoke all on function public.prepara_richiesta_bar_v6_2() from public, anon, authenticated;

drop trigger if exists prepara_richiesta_bar_v6_2 on public.bar_prenotazioni;
create trigger prepara_richiesta_bar_v6_2
before insert on public.bar_prenotazioni
for each row execute function public.prepara_richiesta_bar_v6_2();

-- RLS: il pubblico legge soltanto le proposte attive e può inviare richieste
-- in stato "da_confermare". Soltanto il gestore autenticato legge o modifica
-- le richieste e gestisce tutte le proposte.
alter table public.bar_prodotti enable row level security;
alter table public.bar_prenotazioni enable row level security;

drop policy if exists "bar prodotti lettura pubblica" on public.bar_prodotti;
drop policy if exists "bar prodotti lettura anonima" on public.bar_prodotti;
drop policy if exists "bar prodotti lettura gestore" on public.bar_prodotti;
drop policy if exists "bar prodotti gestione autenticata" on public.bar_prodotti;

create policy "bar prodotti lettura anonima"
on public.bar_prodotti for select to anon
using (attivo = true);

create policy "bar prodotti lettura gestore"
on public.bar_prodotti for select to authenticated
using (true);

create policy "bar prodotti gestione autenticata"
on public.bar_prodotti for all to authenticated
using (true) with check (true);

drop policy if exists "bar prenotazioni inserimento pubblico" on public.bar_prenotazioni;
drop policy if exists "bar prenotazioni gestione autenticata" on public.bar_prenotazioni;

create policy "bar prenotazioni inserimento pubblico"
on public.bar_prenotazioni for insert to anon, authenticated
with check (data >= current_date and stato = 'da_confermare');

create policy "bar prenotazioni gestione autenticata"
on public.bar_prenotazioni for all to authenticated
using (true) with check (true);

revoke all on public.bar_prodotti from anon, authenticated;
revoke all on public.bar_prenotazioni from anon, authenticated;
grant select on public.bar_prodotti to anon;
grant select, insert, update, delete on public.bar_prodotti to authenticated;
grant insert on public.bar_prenotazioni to anon;
grant select, insert, update, delete on public.bar_prenotazioni to authenticated;

-- Cancellazione automatica dei dati del bar dopo 30 giorni, come per il campo.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.elimina_prenotazioni_bar_scadute_30_giorni()
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_eliminate integer;
begin
  delete from public.bar_prenotazioni where data < (current_date - 30);
  get diagnostics v_eliminate = row_count;
  return v_eliminate;
end;
$$;

revoke all on function private.elimina_prenotazioni_bar_scadute_30_giorni() from public, anon, authenticated;
grant usage on schema private to postgres;
grant execute on function private.elimina_prenotazioni_bar_scadute_30_giorni() to postgres;

create extension if not exists pg_cron with schema extensions;

do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'elimina-prenotazioni-bar-dopo-30-giorni'
  limit 1;
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
end $$;

select cron.schedule(
  'elimina-prenotazioni-bar-dopo-30-giorni',
  '25 3 * * *',
  $$select private.elimina_prenotazioni_bar_scadute_30_giorni();$$
);

notify pgrst, 'reload schema';

commit;
