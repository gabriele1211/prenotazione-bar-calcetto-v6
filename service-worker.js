const CACHE_NAME = "campo-ex-velodromo-v6.2.1-release";
const APP_SHELL = [
  "./",
  "./index.html",
  "./admin.html",
  "./privacy.html",
  "./offline.html",
  "./js/bar-admin.js",
  "./js/bar.js",
  "./bar-admin.html",
  "./bar.html",
  "./campo.html",
  "./manifest.webmanifest",
  "./css/style.css?v=6.0.0release1",
  "./js/config.js?v=6.0.0release1",
  "./js/weather.js?v=6.0.0release1",
  "./js/supabase-client.js?v=6.0.0release1",
  "./js/cliente.js?v=6.0.0release1",
  "./js/admin.js?v=6.0.0release1",
  "./js/footer.js?v=6.0.0release1",
  "./js/pwa.js?v=6.0.0release1",
  "./assets/gf-logo.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/apple-touch-icon.png",
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
          (await caches.match("./offline.html",
  "./js/bar-admin.js",
  "./js/bar.js",
  "./bar-admin.html",
  "./bar.html",
  "./campo.html"))
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
