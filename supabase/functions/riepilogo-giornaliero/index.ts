import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Metodo non consentito." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  const authHeader = request.headers.get("Authorization") || "";

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } }
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: "Accesso gestore richiesto." }, 401);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const body = await request.json().catch(() => ({}));
  const action = body?.action === "generate" ? "generate" : "status";
  const now = new Date();
  const { data: existing, error: stateError } = await admin
    .from("riepiloghi_ia_giornalieri")
    .select("riepilogo,generato_il,prossimo_disponibile_il")
    .eq("gestore_id", user.id)
    .maybeSingle();
  if (stateError) return json({ error: "Esegui prima lo script SQL 11 della Versione 6.3.0." }, 500);

  const nextAt = existing?.prossimo_disponibile_il ? new Date(existing.prossimo_disponibile_il) : null;
  const available = !nextAt || nextAt.getTime() <= now.getTime();
  if (action === "status") {
    return json({ available, summary: existing?.riepilogo || null, next_available_at: available ? null : nextAt?.toISOString() });
  }
  if (!openAiKey) return json({ error: "Chiave OpenAI non configurata nei segreti Supabase." }, 503);

  const { data: claim, error: claimError } = await admin.rpc("prenota_riepilogo_ia", { p_gestore_id: user.id });
  if (claimError) return json({ error: "Impossibile verificare la disponibilità del riepilogo." }, 500);
  if (!claim?.allowed) {
    return json({ available: false, summary: claim?.summary || existing?.riepilogo || null, next_available_at: claim?.next_available_at, error: "Hai già utilizzato il riepilogo gratuito delle ultime 24 ore." }, 429);
  }

  const releaseClaim = async () => {
    await admin.from("riepiloghi_ia_giornalieri").update({ prossimo_disponibile_il: null, aggiornato_il: new Date().toISOString() }).eq("gestore_id", user.id);
  };

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const [{ data: fieldBookings, error: fieldError }, { data: barBookings, error: barError }] = await Promise.all([
    admin.from("prenotazioni").select("ora_inizio,ora_fine,settore,numero_bambini,costo_applicato,stato").eq("data", today),
    admin.from("bar_prenotazioni").select("ora,persone,costo_totale,stato").eq("data", today)
  ]);
  if (fieldError || barError) {
    await releaseClaim();
    return json({ error: "Impossibile leggere le prenotazioni di oggi." }, 500);
  }

  const fields = fieldBookings || [];
  const bars = barBookings || [];
  const confirmedBars = bars.filter((item) => item.stato === "confermata");
  const pendingBars = bars.filter((item) => item.stato === "da_confermare");
  const facts = {
    data: today,
    prenotazioni_campo: fields.filter((item) => item.stato === "confermata").length,
    fasce_campo: fields.filter((item) => item.stato === "confermata").map((item) => `${String(item.ora_inizio).slice(0, 5)}-${String(item.ora_fine).slice(0, 5)} (${item.settore})`),
    bambini_mezzo_campo: fields.reduce((sum, item) => sum + Number(item.numero_bambini || 0), 0),
    incasso_campo_previsto: fields.reduce((sum, item) => sum + Number(item.costo_applicato || 0), 0),
    aperitivi_confermati: confirmedBars.length,
    persone_aperitivi: confirmedBars.reduce((sum, item) => sum + Number(item.persone || 0), 0),
    incasso_aperitivi_previsto: confirmedBars.reduce((sum, item) => sum + Number(item.costo_totale || 0), 0),
    aperitivi_da_confermare: pendingBars.length,
    orari_aperitivi: confirmedBars.map((item) => String(item.ora).slice(0, 5))
  };

  let aiResponse: Response;
  try {
    aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${openAiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_MODEL") || "gpt-5-nano",
        instructions: "Sei l'assistente gestionale del Parco Ex Velodromo. Scrivi in italiano un riepilogo breve, concreto e professionale. Usa soltanto i dati forniti. Evidenzia prima le richieste da confermare, poi programma campo, aperitivi, persone e incassi previsti. Non inventare dati. Massimo 120 parole.",
        input: JSON.stringify(facts),
        max_output_tokens: 220
      })
    });
  } catch {
    await releaseClaim();
    return json({ error: "Il servizio IA non è raggiungibile. Riprova più tardi." }, 502);
  }
  const aiPayload = await aiResponse.json();
  if (!aiResponse.ok) {
    await releaseClaim();
    return json({ error: "Il servizio IA non è disponibile in questo momento. Riprova più tardi." }, 502);
  }
  const summary = aiPayload.output_text || aiPayload.output?.flatMap((item: any) => item.content || []).find((item: any) => item.type === "output_text")?.text;
  if (!summary) {
    await releaseClaim();
    return json({ error: "Il servizio IA non ha prodotto un riepilogo." }, 502);
  }

  const nextAvailable = String(claim.next_available_at);
  const { error: saveError } = await admin.from("riepiloghi_ia_giornalieri").upsert({
    gestore_id: user.id,
    riepilogo: summary,
    generato_il: now.toISOString(),
    prossimo_disponibile_il: nextAvailable,
    aggiornato_il: now.toISOString()
  }, { onConflict: "gestore_id" });
  if (saveError) return json({ error: "Riepilogo generato ma non è stato possibile registrare il limite giornaliero." }, 500);
  return json({ available: false, summary, generated_at: now.toISOString(), next_available_at: nextAvailable });
});
