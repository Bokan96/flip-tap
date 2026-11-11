/*
 * Offline support. Registered by src/pwa.ts as sw.js?v=<build id> in production builds only.
 * - On install: stores every file listed in precache.json in a cache named after the build.
 * - Pages (navigations): network first, falling back to the cached page when offline.
 * - Everything else: cache first, then network.
 * - A new build installs alongside the old one and waits; the page shows an "update" notice and
 *   sends 'skipWaiting' when the player accepts. Old caches are removed on activate.
 */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `fliptap-${VERSION}`;
const PAGE = new URL('./', self.location.href).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const list = await fetch(new URL('precache.json', self.location.href), { cache: 'no-store' }).then((r) => r.json());
      const cache = await caches.open(CACHE);
      await cache.addAll(list.files.map((f) => new URL(f, self.location.href).href));
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('fliptap-') && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(req);
        } catch {
          const cache = await caches.open(CACHE);
          return (await cache.match(PAGE, { ignoreVary: true })) || (await cache.match(new URL('index.html', self.location.href).href, { ignoreVary: true })) || Response.error();
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // ignoreVary: servers often send "Vary: Origin"; module scripts are requested with an Origin
      // header but were cached without one. The cached files are fixed per build, so this is safe.
      const hit = await cache.match(req, { ignoreSearch: true, ignoreVary: true });
      return hit || fetch(req);
    })(),
  );
});
