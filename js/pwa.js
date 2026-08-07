(function () {
  const installButton = document.getElementById("install-app");
  const iosHelp = document.getElementById("ios-install-help");
  const updateBox = document.getElementById("pwa-update-box");
  const updateButton = document.getElementById("pwa-update-now");
  let deferredPrompt = null;
  let waitingWorker = null;

  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

  function hideInstallButton() {
    if (installButton) installButton.hidden = true;
  }

  function showInstallButton() {
    if (installButton && !isStandalone && deferredPrompt) {
      installButton.hidden = false;
    }
  }

  function showInstalledMessage() {
    const existing = document.getElementById("pwa-installed-message");
    if (existing) existing.remove();

    const message = document.createElement("div");
    message.id = "pwa-installed-message";
    message.className = "pwa-installed-message";
    message.setAttribute("role", "status");
    message.textContent = "✅ Parco Ex Velodromo è stata installata con successo.";
    document.body.appendChild(message);

    requestAnimationFrame(() => message.classList.add("visible"));
    window.setTimeout(() => {
      message.classList.remove("visible");
      window.setTimeout(() => message.remove(), 300);
    }, 4000);
  }

  // Il pulsante parte sempre nascosto e compare solo dopo
  // l'evento ufficiale del browser che conferma l'installabilità.
  hideInstallButton();

  if (isStandalone) {
    if (iosHelp) iosHelp.hidden = true;
  } else if (iosHelp && isIos) {
    // Safari iOS non espone beforeinstallprompt: mostra solo l'istruzione nativa.
    iosHelp.hidden = false;
  }

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredPrompt = event;
    showInstallButton();
  });

  installButton?.addEventListener("click", async () => {
    if (!deferredPrompt) {
      hideInstallButton();
      return;
    }

    const promptEvent = deferredPrompt;
    deferredPrompt = null;
    hideInstallButton();

    promptEvent.prompt();
    const choice = await promptEvent.userChoice;

    // Se l'utente annulla, il comando torna visibile finché il browser
    // considera ancora disponibile lo stesso invito di installazione.
    if (choice?.outcome === "dismissed") {
      deferredPrompt = promptEvent;
      showInstallButton();
    }
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    hideInstallButton();
    if (iosHelp) iosHelp.hidden = true;
    showInstalledMessage();
  });

  window.matchMedia("(display-mode: standalone)").addEventListener?.("change", event => {
    if (event.matches) {
      deferredPrompt = null;
      hideInstallButton();
      if (iosHelp) iosHelp.hidden = true;
    }
  });

  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./service-worker.js?v=6.3.10release1", { scope: "./" });

      const showUpdate = worker => {
        waitingWorker = worker;
        if (updateBox) updateBox.hidden = false;
      };

      if (registration.waiting) showUpdate(registration.waiting);

      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) showUpdate(worker);
        });
      });

      updateButton?.addEventListener("click", () => {
        waitingWorker?.postMessage({ type: "SKIP_WAITING" });
      });

      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    } catch (error) {
      console.warn("Registrazione PWA non riuscita:", error);
    }
  });
})();
