(function () {
  const FUNCTION_NAME = "notifiche-push";
  const TABLE_NAME = "push_subscriptions";
  let busy = false;

  const element = id => document.getElementById(id);

  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function deviceLabel() {
    if (/iphone/i.test(navigator.userAgent)) return "iPhone";
    if (/ipad/i.test(navigator.userAgent)) return "iPad";
    if (/android/i.test(navigator.userAgent)) return "Android";
    if (/windows/i.test(navigator.userAgent)) return "PC Windows";
    if (/macintosh|mac os x/i.test(navigator.userAgent)) return "Mac";
    return "Browser";
  }

  function setStatus(text, type = "neutral") {
    const status = element("push-notification-status");
    if (!status) return;
    status.textContent = text;
    status.className = `push-notification-status ${type}`;
  }

  function setBadge(text, active = false) {
    const badge = element("push-notification-badge");
    if (!badge) return;
    badge.textContent = text;
    badge.classList.toggle("active", active);
  }

  function setButtons(active, disabled = false) {
    const enable = element("push-notification-enable");
    const test = element("push-notification-test");
    const disable = element("push-notification-disable");
    if (!enable || !test || !disable) return;
    enable.hidden = active;
    test.hidden = !active;
    disable.hidden = !active;
    enable.disabled = disabled || busy;
    test.disabled = disabled || busy;
    disable.disabled = disabled || busy;
  }

  function supportProblem() {
    if (!window.isSecureContext) return "Le notifiche richiedono una connessione HTTPS sicura.";
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      return "Questo browser non supporta le notifiche push.";
    }
    if (isIos() && !isStandalone()) {
      return "Su iPhone o iPad installa prima l’app nella schermata Home, poi riaprila da lì.";
    }
    if (Notification.permission === "denied") {
      return "Le notifiche sono bloccate nelle impostazioni del browser. Riattivale per questo sito e riprova.";
    }
    return "";
  }

  function base64UrlToUint8Array(value) {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = window.atob(base64);
    return Uint8Array.from([...raw].map(character => character.charCodeAt(0)));
  }

  async function currentSession() {
    const { data } = await db.auth.getSession();
    return data.session || null;
  }

  async function serviceWorkerRegistration() {
    return navigator.serviceWorker.ready;
  }

  async function currentSubscription() {
    const registration = await serviceWorkerRegistration();
    return registration.pushManager.getSubscription();
  }

  async function fetchPublicKey() {
    const { data, error } = await db.functions.invoke(FUNCTION_NAME, {
      body: { action: "public-key" }
    });
    if (error || !data?.publicKey) {
      throw new Error(data?.error || "La funzione notifiche non è ancora configurata in Supabase.");
    }
    return data.publicKey;
  }

  async function saveSubscription(subscription, userId) {
    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      throw new Error("Il browser non ha restituito una registrazione completa.");
    }

    const { error } = await db.from(TABLE_NAME).upsert({
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      device_label: deviceLabel(),
      user_agent: navigator.userAgent.slice(0, 500),
      updated_at: new Date().toISOString()
    }, { onConflict: "endpoint" });

    if (error) {
      throw new Error(`${error.message}. Esegui lo script SQL 12 della Versione 6.3.5.`);
    }
  }

  async function refresh() {
    const panel = element("push-notification-panel");
    if (!panel) return;

    const session = await currentSession();
    panel.hidden = !session;
    if (!session) return;

    const problem = supportProblem();
    if (problem) {
      setBadge("Non disponibile");
      setStatus(problem, "warning");
      setButtons(false, true);
      return;
    }

    try {
      const subscription = await currentSubscription();
      const active = Boolean(subscription);
      setBadge(active ? "Attive" : "Da attivare", active);
      setButtons(active);
      setStatus(
        active
          ? `Notifiche attive su questo dispositivo (${deviceLabel()}).`
          : "Premi Attiva e consenti le notifiche quando il browser lo richiede.",
        active ? "success" : "neutral"
      );
    } catch (error) {
      setBadge("Non disponibile");
      setStatus(`Controllo notifiche non riuscito: ${error.message}`, "error");
      setButtons(false, true);
    }
  }

  async function enableNotifications() {
    if (busy) return;
    const session = await currentSession();
    if (!session) return setStatus("Accedi nuovamente come gestore.", "error");

    const problem = supportProblem();
    if (problem) return setStatus(problem, "warning");

    busy = true;
    setButtons(false, true);
    setStatus("Attivazione delle notifiche…", "neutral");

    try {
      const publicKey = await fetchPublicKey();
      const registration = await serviceWorkerRegistration();
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(publicKey)
        });
      }
      await saveSubscription(subscription, session.user.id);
      setStatus("Notifiche attivate. Ora puoi inviare una notifica di prova.", "success");
    } catch (error) {
      if (Notification.permission === "denied") {
        setStatus("Autorizzazione negata. Riattiva le notifiche nelle impostazioni del browser.", "error");
      } else {
        setStatus(`Attivazione non riuscita: ${error.message}`, "error");
      }
    } finally {
      busy = false;
      await refresh();
    }
  }

  async function disableNotifications() {
    if (busy) return;
    busy = true;
    setButtons(true, true);
    setStatus("Disattivazione…", "neutral");

    try {
      const subscription = await currentSubscription();
      if (subscription) {
        const { error } = await db.from(TABLE_NAME).delete().eq("endpoint", subscription.endpoint);
        if (error) throw error;
        await subscription.unsubscribe();
      }
      setStatus("Notifiche disattivate su questo dispositivo.", "success");
    } catch (error) {
      setStatus(`Disattivazione non riuscita: ${error.message}`, "error");
    } finally {
      busy = false;
      await refresh();
    }
  }

  async function sendTestNotification() {
    if (busy) return;
    busy = true;
    setButtons(true, true);
    setStatus("Invio della notifica di prova…", "neutral");

    try {
      const { data, error } = await db.functions.invoke(FUNCTION_NAME, {
        body: { action: "test" }
      });
      if (error) throw error;
      if (!data?.sent) throw new Error(data?.error || "Nessun dispositivo attivo trovato.");
      setStatus(`Notifica di prova inviata a ${data.sent} ${data.sent === 1 ? "dispositivo" : "dispositivi"}.`, "success");
    } catch (error) {
      setStatus(`Prova non riuscita: ${error.message}`, "error");
    } finally {
      busy = false;
      setButtons(true);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    element("push-notification-enable")?.addEventListener("click", enableNotifications);
    element("push-notification-disable")?.addEventListener("click", disableNotifications);
    element("push-notification-test")?.addEventListener("click", sendTestNotification);
    refresh();

    db.auth.onAuthStateChange(() => {
      window.setTimeout(refresh, 0);
    });
  });
})();
