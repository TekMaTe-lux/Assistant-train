const CACHE_NAME = 'lbetaillere-v6';
const ASSETS = [
  './',
  './index42.html',
  './index42.html#home',
  './manifest.webmanifest',
  './service-worker.js',
  './logoText.png',
  './logobetailleresanstexte.png',
  './icon-192.png',
  './icon-512.png',
  './favicon.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const sameOrigin = url.origin === self.location.origin;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          // Évite les erreurs DOMException de CacheStorage (Firefox / réponses opaques / non-HTTP).
          const canCache =
            sameOrigin &&
            url.protocol.startsWith('http') &&
            response &&
            response.ok &&
            response.type === 'basic';
          if (canCache) {
            const copy = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => cache.put(event.request, copy))
              .catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match('./index40.html'));
    })
  );
});
