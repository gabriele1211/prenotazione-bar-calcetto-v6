-- VERSIONE 6.3.0 - RIEPILOGO IA GRATUITO OGNI 24 ORE
-- Eseguire una sola volta nel SQL Editor di Supabase.

create table if not exists public.riepiloghi_ia_giornalieri (
  gestore_id uuid primary key references auth.users(id) on delete cascade,
  riepilogo text,
  generato_il timestamptz,
  prossimo_disponibile_il timestamptz,
  aggiornato_il timestamptz not null default now()
);

alter table public.riepiloghi_ia_giornalieri enable row level security;

-- La tabella viene usata soltanto dalla funzione protetta con service_role.
revoke all on public.riepiloghi_ia_giornalieri from public, anon, authenticated;
grant all on public.riepiloghi_ia_giornalieri to service_role;

create index if not exists idx_riepiloghi_ia_prossimo_disponibile
  on public.riepiloghi_ia_giornalieri (prossimo_disponibile_il);

comment on table public.riepiloghi_ia_giornalieri is
  'Memorizza il riepilogo IA del gestore e applica il limite server di una generazione ogni 24 ore.';

create or replace function public.prenota_riepilogo_ia(p_gestore_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.riepiloghi_ia_giornalieri%rowtype;
begin
  insert into public.riepiloghi_ia_giornalieri (gestore_id)
  values (p_gestore_id)
  on conflict (gestore_id) do nothing;

  select * into v_row
  from public.riepiloghi_ia_giornalieri
  where gestore_id = p_gestore_id
  for update;

  if v_row.prossimo_disponibile_il is not null and v_row.prossimo_disponibile_il > now() then
    return jsonb_build_object(
      'allowed', false,
      'summary', v_row.riepilogo,
      'next_available_at', v_row.prossimo_disponibile_il
    );
  end if;

  update public.riepiloghi_ia_giornalieri
  set prossimo_disponibile_il = now() + interval '24 hours',
      aggiornato_il = now()
  where gestore_id = p_gestore_id
  returning * into v_row;

  return jsonb_build_object(
    'allowed', true,
    'summary', v_row.riepilogo,
    'next_available_at', v_row.prossimo_disponibile_il
  );
end;
$$;

revoke all on function public.prenota_riepilogo_ia(uuid) from public, anon, authenticated;
grant execute on function public.prenota_riepilogo_ia(uuid) to service_role;
