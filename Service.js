const CACHE_NAME = "vex-track-v1";

const APP_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icon.svg"
];

const QR_LIBRARY =
  "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_FILES);

    // Cache the QR scanner library while online, if available.
    try {
      await cache.add(QR_LIBRARY);
    } catch (error) {
      console.warn("QR library could not be cached yet.", error);
    }

    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();

    await Promise.all(
      keys
        .filter(key => key !== CACHE_NAME)
        .map(key => caches.delete(key))
    );

    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);

    if (cached) return cached;

    try {
      const response = await fetch(request);

      if (response.ok && response.type !== "opaque") {
        await cache.put(request, response.clone());
      }

      return response;
    } catch (error) {
      return new Response(
        "This resource is not available offline yet.",
        { status: 503 }
      );
    }
  })());
});