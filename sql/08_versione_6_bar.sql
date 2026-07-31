-- VERSIONE 6.0.0 - BAR PARCO EX VELODROMO
-- Eseguire una sola volta nel SQL Editor di Supabase.

create extension if not exists pgcrypto;

create table if not exists public.bar_prodotti (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descrizione text,
  prezzo numeric(10,2) not null default 0 check (prezzo >= 0),
  immagine_url text,
  ordine integer not null default 0,
  attivo boolean not null default true,
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now()
);

create table if not exists public.bar_prenotazioni (
  id uuid primary key default gen_random_uuid(),
  prodotto_id uuid references public.bar_prodotti(id) on delete restrict,
  nome_cliente text not null,
  telefono text not null,
  persone integer not null check (persone between 1 and 30),
  data date not null,
  ora time not null,
  note text,
  stato text not null default 'confermata' check (stato in ('confermata','annullata')),
  creato_il timestamptz not null default now()
);

create index if not exists idx_bar_prodotti_ordine on public.bar_prodotti(ordine, creato_il);
create index if not exists idx_bar_prenotazioni_data_ora on public.bar_prenotazioni(data, ora);

alter table public.bar_prodotti enable row level security;
alter table public.bar_prenotazioni enable row level security;

drop policy if exists "bar prodotti lettura pubblica" on public.bar_prodotti;
create policy "bar prodotti lettura pubblica" on public.bar_prodotti for select to anon, authenticated using (attivo = true or auth.role() = 'authenticated');
drop policy if exists "bar prodotti gestione autenticata" on public.bar_prodotti;
create policy "bar prodotti gestione autenticata" on public.bar_prodotti for all to authenticated using (true) with check (true);

drop policy if exists "bar prenotazioni inserimento pubblico" on public.bar_prenotazioni;
create policy "bar prenotazioni inserimento pubblico" on public.bar_prenotazioni for insert to anon, authenticated with check (data >= current_date and stato = 'confermata');
drop policy if exists "bar prenotazioni gestione autenticata" on public.bar_prenotazioni;
create policy "bar prenotazioni gestione autenticata" on public.bar_prenotazioni for all to authenticated using (true) with check (true);

grant select on public.bar_prodotti to anon, authenticated;
grant insert on public.bar_prenotazioni to anon, authenticated;
grant select, insert, update, delete on public.bar_prodotti to authenticated;
grant select, update, delete on public.bar_prenotazioni to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bar-immagini','bar-immagini',true,5242880,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public=true, file_size_limit=5242880, allowed_mime_types=array['image/jpeg','image/png','image/webp','image/gif'];

drop policy if exists "bar immagini lettura pubblica" on storage.objects;
create policy "bar immagini lettura pubblica" on storage.objects for select to public using (bucket_id='bar-immagini');
drop policy if exists "bar immagini inserimento autenticato" on storage.objects;
create policy "bar immagini inserimento autenticato" on storage.objects for insert to authenticated with check (bucket_id='bar-immagini');
drop policy if exists "bar immagini modifica autenticata" on storage.objects;
create policy "bar immagini modifica autenticata" on storage.objects for update to authenticated using (bucket_id='bar-immagini') with check (bucket_id='bar-immagini');
drop policy if exists "bar immagini eliminazione autenticata" on storage.objects;
create policy "bar immagini eliminazione autenticata" on storage.objects for delete to authenticated using (bucket_id='bar-immagini');

insert into public.bar_prodotti(nome,descrizione,prezzo,ordine,attivo)
select * from (values
 ('Aperitivo della casa','Drink accompagnato da stuzzichini assortiti.',8.00,10,true),
 ('Tagliere misto','Salumi, formaggi e prodotti selezionati dal bar.',15.00,20,true),
 ('Aperitivo analcolico','Proposta analcolica con stuzzichini.',7.00,30,true)
) as v(nome,descrizione,prezzo,ordine,attivo)
where not exists (select 1 from public.bar_prodotti);
