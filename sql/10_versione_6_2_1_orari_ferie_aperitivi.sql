-- VERSIONE 6.2.1 - ORARI E FERIE APERITIVI
-- Eseguire una sola volta nel SQL Editor di Supabase, dopo lo script 09.
-- Conserva integralmente prodotti, richieste, prezzi e immagini esistenti.

begin;

-- Aggiorna il controllo centrale delle richieste aperitivo:
-- orari ammessi 09:00-21:00 e blocco ferie condiviso con il campo.
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

  if new.ora < time '09:00' or new.ora > time '21:00' then
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

comment on function public.prepara_richiesta_bar_v6_2() is
  'Valida ferie, fascia 09:00-21:00, prodotto e dati cliente; calcola il costo storico della richiesta aperitivo.';

revoke all on function public.prepara_richiesta_bar_v6_2() from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
