const CACHE_NAME = "parco-ex-velodromo-v6.2.4-release1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./campo.html",
  "./bar.html",
  "./bar-admin.html",
  "./admin.html",
  "./privacy.html",
  "./offline.html",
  "./manifest.webmanifest",
  "./css/style.css?v=6.2.4release1",
  "./css/bar.css?v=6.2.4release1",
  "./js/config.js?v=6.2.4release1",
  "./js/weather.js?v=6.2.4release1",
  "./js/supabase-client.js?v=6.2.4release1",
  "./js/cliente.js?v=6.2.4release1",
  "./js/admin.js?v=6.2.4release1",
  "./js/bar.js?v=6.2.4release1",
  "./js/bar-admin.js?v=6.2.4release1",
  "./js/footer.js?v=6.2.4release1",
  "./js/pwa.js?v=6.2.4release1",
  "./js/update-manager.js?v=6.2.4",
  "./version.json",
  "./assets/gf-logo.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/apple-touch-icon.png",
  "./assets/favicon-32.png",
  "./assets/maskable-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const externalApi =
    url.hostname.includes("supabase.co") ||
    url.hostname.includes("open-meteo.com") ||
    url.hostname.includes("raw.githubusercontent.com") ||
    url.hostname.includes("cdn.jsdelivr.net");

  if (externalApi) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then(response => {
          if (sameOrigin && response.ok) {
            caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(async () =>
          (await caches.match(request)) ||
          (await caches.match("./offline.html"))
        )
    );
    return;
  }

  if (sameOrigin) {
    const appCode =
      url.pathname.endsWith(".js") ||
      url.pathname.endsWith(".css") ||
      url.pathname.endsWith(".webmanifest");

    if (appCode) {
      event.respondWith(
        fetch(request, { cache: "no-store" })
          .then(response => {
            if (response.ok) {
              caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
            }
            return response;
          })
          .catch(() => caches.match(request))
      );
      return;
    }

    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.ok) {
            caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
          }
          return response;
        });
      })
    );
  }
});
