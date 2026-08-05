-- Versione 6.3.5 - notifiche push riservate al gestore
-- Eseguire una sola volta nel SQL Editor di Supabase.
-- Non cancella né modifica le prenotazioni esistenti.

create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Ogni riga rappresenta un telefono, tablet o PC sul quale il gestore
-- ha autorizzato le notifiche. Le chiavi qui salvate non sono chiavi API.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  device_label text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_length check (char_length(endpoint) between 20 and 2500),
  constraint push_subscriptions_p256dh_length check (char_length(p256dh) between 20 and 250),
  constraint push_subscriptions_auth_length check (char_length(auth) between 8 and 250)
);

create index if not exists idx_push_subscriptions_user_id
  on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push dispositivi lettura proprietario" on public.push_subscriptions;
drop policy if exists "push dispositivi inserimento proprietario" on public.push_subscriptions;
drop policy if exists "push dispositivi modifica proprietario" on public.push_subscriptions;
drop policy if exists "push dispositivi eliminazione proprietario" on public.push_subscriptions;

create policy "push dispositivi lettura proprietario"
on public.push_subscriptions for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "push dispositivi inserimento proprietario"
on public.push_subscriptions for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "push dispositivi modifica proprietario"
on public.push_subscriptions for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "push dispositivi eliminazione proprietario"
on public.push_subscriptions for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

comment on table public.push_subscriptions is
  'Dispositivi del gestore autorizzati a ricevere le notifiche Web Push.';

-- Coda tecnica priva di dati personali. Il webhook legge soltanto tipo,
-- data e orario; nome, telefono e documento non vengono copiati qui.
create table if not exists public.push_notification_events (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('campo', 'bar')),
  data_evento date not null,
  ora_evento time not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_push_notification_events_created_at
  on public.push_notification_events(created_at);

alter table public.push_notification_events enable row level security;
revoke all on public.push_notification_events from public, anon, authenticated;

comment on table public.push_notification_events is
  'Eventi tecnici senza dati personali usati dal webhook delle notifiche push.';

create or replace function private.accoda_notifica_nuova_prenotazione()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- La pagina cliente può conservare nel browser una sessione del gestore:
  -- auth.uid() non permette quindi di distinguere l'origine della richiesta.
  -- Solo la prenotazione campo diretta contiene questa nota tecnica esplicita.
  if tg_table_schema = 'public'
     and tg_table_name = 'prenotazioni'
     and coalesce(new.note, '') like 'Prenotazione inserita direttamente dal gestore%' then
    return new;
  end if;

  if tg_table_schema = 'public' and tg_table_name = 'prenotazioni' then
    insert into public.push_notification_events(tipo, data_evento, ora_evento)
    values ('campo', new.data, new.ora_inizio);
  elsif tg_table_schema = 'public' and tg_table_name = 'bar_prenotazioni' then
    insert into public.push_notification_events(tipo, data_evento, ora_evento)
    values ('bar', new.data, new.ora);
  end if;

  return new;
end;
$$;

revoke all on function private.accoda_notifica_nuova_prenotazione() from public, anon, authenticated;
grant execute on function private.accoda_notifica_nuova_prenotazione() to postgres;

drop trigger if exists notifica_push_nuova_prenotazione_campo on public.prenotazioni;
create trigger notifica_push_nuova_prenotazione_campo
after insert on public.prenotazioni
for each row execute function private.accoda_notifica_nuova_prenotazione();

drop trigger if exists notifica_push_nuova_prenotazione_bar on public.bar_prenotazioni;
create trigger notifica_push_nuova_prenotazione_bar
after insert on public.bar_prenotazioni
for each row execute function private.accoda_notifica_nuova_prenotazione();
