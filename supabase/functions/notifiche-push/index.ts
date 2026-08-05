import { buildPushHTTPRequest } from "npm:@pushforge/builder@2.0.5";
import { createClient } from "npm:@supabase/supabase-js@2.112.1";

type SubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
  user_id: string;
};

type PushEvent = {
  id: string;
  tipo: "campo" | "bar";
  data_evento: string;
  ora_evento: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, x-supabase-api-version, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function keyDictionary(name: string): string[] {
  const raw = Deno.env.get(name);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Object.values(parsed).filter((value): value is string => typeof value === "string" && value.length > 0);
  } catch {
    return [];
  }
}

function firstKey(dictionaryName: string, legacyName: string): string {
  return keyDictionary(dictionaryName)[0] || Deno.env.get(legacyName) || "";
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get("Authorization") || "";
  return authorization.replace(/^Bearer\s+/i, "").trim();
}

function isServiceRequest(request: Request): boolean {
  const supplied = [bearerToken(request), request.headers.get("apikey") || ""].filter(Boolean);
  if (!supplied.length) return false;
  const accepted = [
    ...keyDictionary("SUPABASE_SECRET_KEYS"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
  ].filter(Boolean);
  return supplied.some(token => accepted.some(key => key === token));
}

function dateInRome(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function dateLabel(value: string): string {
  if (value === dateInRome()) return "oggi";
  return `il ${new Date(`${value}T12:00:00Z`).toLocaleDateString("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  })}`;
}

function notificationForEvent(event: PushEvent) {
  const time = String(event.ora_evento || "").slice(0, 5);
  if (event.tipo === "bar") {
    return {
      title: "🥂 Nuova richiesta aperitivo",
      body: `Richiesta per ${dateLabel(event.data_evento)} alle ${time}. Apri l’Area gestore per controllare.`,
      url: "./bar-admin.html",
      tag: `prenotazione-bar-${event.id}`,
      requireInteraction: true,
      icon: "./assets/icon-192.png",
      badge: "./assets/favicon-32.png"
    };
  }
  return {
    title: "⚽ Nuova prenotazione campo",
    body: `Prenotazione per ${dateLabel(event.data_evento)} alle ${time}. Apri l’Area gestore per controllare.`,
    url: "./admin.html",
    tag: `prenotazione-campo-${event.id}`,
    requireInteraction: false,
    icon: "./assets/icon-192.png",
    badge: "./assets/favicon-32.png"
  };
}

async function authenticatedUserId(request: Request, supabaseUrl: string, publishableKey: string) {
  const token = bearerToken(request);
  if (!token || !publishableKey) return null;
  const client = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await client.auth.getUser();
  return error ? null : data.user?.id || null;
}

async function sendPushes(
  subscriptions: SubscriptionRow[],
  payload: Record<string, unknown>,
  privateJwk: JsonWebKey,
  admin: ReturnType<typeof createClient>
) {
  const results = await Promise.all(subscriptions.map(async subscription => {
    try {
      const pushRequest = await buildPushHTTPRequest({
        privateJWK: privateJwk,
        subscription: {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth }
        },
        message: {
          payload,
          adminContact: "mailto:orione2000@libero.it",
          options: { ttl: 3600, urgency: "high" }
        }
      });

      const response = await fetch(pushRequest.endpoint, {
        method: "POST",
        headers: pushRequest.headers,
        body: pushRequest.body
      });

      if (response.ok) return { sent: true, stale: false };
      return { sent: false, stale: response.status === 404 || response.status === 410 };
    } catch {
      return { sent: false, stale: false };
    }
  }));

  const staleEndpoints = subscriptions
    .filter((_, index) => results[index]?.stale)
    .map(subscription => subscription.endpoint);

  if (staleEndpoints.length) {
    await admin.from("push_subscriptions").delete().in("endpoint", staleEndpoints);
  }

  return {
    sent: results.filter(result => result.sent).length,
    failed: results.filter(result => !result.sent).length,
    removed: staleEndpoints.length
  };
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Metodo non consentito." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const publishableKey = firstKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  const secretKey = firstKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";
  const vapidPrivateRaw = Deno.env.get("VAPID_PRIVATE_JWK") || "";

  if (!supabaseUrl || !secretKey) return json({ error: "Configurazione Supabase non disponibile." }, 500);

  let privateJwk: JsonWebKey;
  try {
    privateJwk = JSON.parse(vapidPrivateRaw);
    if (!vapidPublicKey || !privateJwk?.d || !privateJwk?.x || !privateJwk?.y) throw new Error("Chiavi mancanti");
  } catch {
    return json({ error: "Configura VAPID_PUBLIC_KEY e VAPID_PRIVATE_JWK nei Secrets di Supabase." }, 503);
  }

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let body: Record<string, any>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corpo della richiesta non valido." }, 400);
  }

  const isWebhook = body?.type === "INSERT" && body?.table === "push_notification_events";

  if (isWebhook) {
    if (!isServiceRequest(request)) return json({ error: "Webhook non autorizzato." }, 401);
    const event = body.record as PushEvent;
    if (!event?.id || !["campo", "bar"].includes(event.tipo)) return json({ error: "Evento non valido." }, 400);

    const { data: subscriptions, error } = await admin
      .from("push_subscriptions")
      .select("endpoint,p256dh,auth,user_id");

    if (error) return json({ error: "Impossibile leggere i dispositivi registrati." }, 500);
    const result = await sendPushes(subscriptions || [], notificationForEvent(event), privateJwk, admin);
    await admin.from("push_notification_events").delete().eq("id", event.id);
    return json(result);
  }

  const userId = await authenticatedUserId(request, supabaseUrl, publishableKey);
  if (!userId) return json({ error: "Accesso gestore richiesto." }, 401);

  if (body?.action === "public-key") {
    return json({ publicKey: vapidPublicKey });
  }

  if (body?.action === "test") {
    const { data: subscriptions, error } = await admin
      .from("push_subscriptions")
      .select("endpoint,p256dh,auth,user_id")
      .eq("user_id", userId);

    if (error) return json({ error: "Impossibile leggere i dispositivi registrati." }, 500);
    if (!subscriptions?.length) return json({ error: "Nessun dispositivo attivo trovato.", sent: 0 }, 404);

    const result = await sendPushes(subscriptions, {
      title: "🔔 Notifiche attive",
      body: "La prova è riuscita. Riceverai qui le nuove prenotazioni del campo e del bar.",
      url: "./bar-admin.html",
      tag: `prova-notifiche-${Date.now()}`,
      requireInteraction: false,
      icon: "./assets/icon-192.png",
      badge: "./assets/favicon-32.png"
    }, privateJwk, admin);
    return json(result);
  }

  return json({ error: "Azione non riconosciuta." }, 400);
});
