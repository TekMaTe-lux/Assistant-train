const CACHE_NAME = 'lbetaillere-v18';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './logoText.png',
  './logobetailleresanstexte.png',
  './icon-192.png',
  './icon-512.png',
  './favicon.jpg'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const sameOrigin = url.origin === self.location.origin;

  // HTML/navigation : priorité au réseau = prend les modifs GitHub
  if (event.request.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => cache.put('./index.html', copy))
              .catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Assets locaux : cache puis réseau, sans erreur console bloquante
  if (sameOrigin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;

        return fetch(event.request)
          .then((response) => {
            if (response && response.ok && response.type === 'basic') {
              const copy = response.clone();
              caches.open(CACHE_NAME)
                .then((cache) => cache.put(event.request, copy))
                .catch(() => {});
            }
            return response;
          })
          .catch(() => {
            return new Response('', {
              status: 504,
              statusText: 'Offline / fetch failed'
            });
          });
      })
    );
  }
});

// ===============================
// PUSH NOTIFICATIONS - MVP TEST
// ===============================

self.addEventListener('push', (event) => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = {};
  }

  const title = data.title || '🐮 La Bétaillère';

  const options = {
    body: data.body || 'Nouvelle alerte de La Bétaillère.',
    icon: data.icon || './icon-192.png',
    badge: data.badge || './icon-192.png',
    data: {
      url: data.url || './'
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification?.data?.url || './';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }

        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});
