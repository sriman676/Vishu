// Minimal app-shell service worker: cache-first for same-origin GETs so Vishu is installable/offline.
// Never touches /rpc or /events — those must always hit the live core.
const CACHE = "vishu-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/rpc") || url.pathname.startsWith("/events")) return;
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const hit = await c.match(e.request);
      try {
        const res = await fetch(e.request);
        if (url.origin === location.origin) c.put(e.request, res.clone());
        return res;
      } catch {
        return hit || Response.error();
      }
    }),
  );
});
