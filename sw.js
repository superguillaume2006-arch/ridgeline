const SHELL_CACHE = 'ridgeline-shell-v1';
const SHELL_FILES = ['./', './index.html', './manifest.json', './icon-32.png', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache =>
      Promise.all(SHELL_FILES.map(f => cache.add(f).catch(() => {})))
    )
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// Region tile downloads, driven by postMessage from the page (see R.confirmDownload / R.removeRegion).
self.addEventListener('message', event => {
  const msg = event.data || {};
  if (msg.type === 'CACHE_TILES') {
    event.waitUntil((async () => {
      const cache = await caches.open('tiles-' + msg.regionId);
      let done = 0;
      for (const url of msg.urls) {
        try {
          const existing = await cache.match(url);
          if (!existing) {
            // OSM tile servers don't send CORS headers; no-cors gives an opaque
            // response that's still fully cacheable and renderable as an <img>.
            const resp = await fetch(url, { mode: 'no-cors' });
            await cache.put(url, resp);
          }
        } catch (err) { /* skip failed tile, keep going */ }
        done++;
        if (done % 4 === 0 || done === msg.urls.length) {
          const clients = await self.clients.matchAll();
          clients.forEach(c => c.postMessage({ type: 'TILE_PROGRESS', regionId: msg.regionId, done, total: msg.urls.length }));
        }
      }
    })());
  }
  if (msg.type === 'CLEAR_TILES') {
    event.waitUntil(caches.delete('tiles-' + msg.regionId));
  }
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = req.url;

  // Map tiles: cache-first, so a downloaded region's tiles work with no signal.
  if (url.indexOf('tile.openstreetmap.org') !== -1) {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(resp => {
          const copy = resp.clone();
          caches.open('tiles-runtime').then(c => c.put(req, copy)).catch(() => {});
          return resp;
        }).catch(() => cached);
      })
    );
    return;
  }

  // App shell: network-first so updates land, falling back to cache offline.
  if (req.mode === 'navigate' || SHELL_FILES.some(f => url.endsWith(f.replace('./', '')))) {
    event.respondWith(
      fetch(req).then(resp => {
        const copy = resp.clone();
        caches.open(SHELL_CACHE).then(c => c.put(req, copy)).catch(() => {});
        return resp;
      }).catch(() => caches.match(req).then(c => c || caches.match('./index.html')))
    );
  }
});
