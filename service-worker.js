const CACHE_VERSION = 'v43';
const APP_CACHE = `lbetaillere-app-${CACHE_VERSION}`;
const STATIC_CACHE = `lbetaillere-static-${CACHE_VERSION}`;
const CACHE_PREFIX = 'lbetaillere-';

const APP_SHELL = [
  './',
  './index.html',
  './carte.html',
  './manifest.webmanifest',
  './config/territory.nancy-metz-lux.js?v=5',
  './assets/lb-app-shell-v3.js?v=7',
  './assets/lb-legacy.css?v=4',
  './assets/lb-design-system-v3.css?v=9',
  './assets/lb-mobile-v4.css?v=13',
  './assets/lb-v4-live-preview.css?v=20260831-3',
  './assets/lb-mobile-v4.js?v=6',
  './assets/lb-traffic-details-v1.css?v=4',
  './assets/lb-traffic-details-v1.js?v=4',
  './jeuBETA1.html?v=2',
  './logoText.png',
  './logobetailleresanstexte.png',
  './logobetaillere2026trans.png',
  './favicon.jpg',
  './icon-192.png',
  './icon-512.png',
  './ber_icons_pack/accueil.svg',
  './ber_icons_pack/tableau.svg',
  './ber_icons_pack/carte.svg',
  './ber_icons_pack/favoris.svg',
  './ber_icons_pack/stats.svg',
  './ber_icons_pack/loisirs.svg',
  './ber_icons_pack/compte.svg'
];

function cacheIndividually(cacheName, requests) {
  return caches.open(cacheName).then((cache) =>
    Promise.allSettled(
      requests.map((request) =>
        cache.add(request).catch(() => undefined)
      )
    )
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    cacheIndividually(APP_CACHE, APP_SHELL).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX))
            .filter((key) => ![APP_CACHE, STATIC_CACHE].includes(key))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function fetchWithTimeout(request, timeout = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function navigationNetworkFirst(request) {
  const cache = await caches.open(APP_CACHE);
  const requestUrl = new URL(request.url);
  const indexUrl = new URL('./index.html', self.registration.scope);
  const rootUrl = new URL('./', self.registration.scope);
  const isAppEntry =
    requestUrl.pathname === indexUrl.pathname ||
    requestUrl.pathname === rootUrl.pathname;

  try {
    const response = await fetchWithTimeout(request, 5500);
    if (response?.ok) {
      const writes = [cache.put(request, response.clone())];
      if (isAppEntry) writes.push(cache.put('./index.html', response.clone()));
      await Promise.allSettled(writes);
    }
    return response;
  } catch (_) {
    return (
      (await cache.match(request, { ignoreSearch: true })) ||
      (await cache.match('./index.html', { ignoreSearch: true })) ||
      Response.error()
    );
  }
}

// LB_MAP_BRIDGE_FAST_CACHE_V1
// La rubrique #carte conserve historiquement un ancien query-string. On sert
// donc la petite passerelle carte.html depuis le cache APP frais installé avec
// le SW courant, sans attendre jusqu'à 5,5 s la navigation réseau. Le réseau
// est rafraîchi en arrière-plan pour la visite suivante.
async function mapNavigationFast(request) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match('./carte.html', { ignoreSearch: true });
  const refresh = fetch(request, { cache: 'no-store' })
    .then(async (response) => {
      if (response?.ok) {
        await cache.put('./carte.html', response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    refresh.catch(() => {});
    return cached;
  }
  return (await refresh) || Response.error();
}

async function staleWhileRevalidate(request, cacheName = STATIC_CACHE) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: false });
  const refresh = fetch(request)
    .then((response) => {
      if (response?.ok || response?.type === 'opaque') {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);
  return cached || (await refresh) || Response.error();
}

async function uiStyleNetworkFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response?.ok) {
      await cache.put(request, response.clone()).catch(() => {});
      return response;
    }
  } catch (_) {}
  return (await cache.match(request, { ignoreSearch: true })) || Response.error();
}

function isStaticAsset(url) {
  return /\.(?:css|js|mjs|png|jpe?g|gif|webp|svg|ico|woff2?|mp3)$/i.test(url.pathname);
}

function isDynamicData(url) {
  return (
    /\.(?:json|txt|geojson)$/i.test(url.pathname) ||
    url.pathname.includes('/api/') ||
    url.pathname.includes('/gtfs/') ||
    url.pathname.includes('/sncf/')
  );
}

function isUiStyle(url) {
  return (
    url.pathname.endsWith('/assets/lb-mobile-v4.css') ||
    url.pathname.endsWith('/assets/lb-home-favorites-pro.css') ||
    url.pathname.endsWith('/assets/lb-home-mobile-layout-v2.css') ||
    url.pathname.endsWith('/assets/lb-v4-live-preview.css')
  );
}

function isCriticalCommunityAsset(url) {
  return (
    url.pathname.endsWith('/assets/home-major-alerts.js') ||
    url.pathname.endsWith('/assets/lb-community-map-bridge-v1.js') ||
    url.pathname.endsWith('/assets/lb-home-favorites-delay-v1.js') ||
    url.pathname.endsWith('/assets/signal-stations-fix.js')
  );
}

function isCacheableExternal(url) {
  return [
    'cdn.jsdelivr.net',
    'code.jquery.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com'
  ].includes(url.hostname);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  if (request.mode === 'navigate') {
    if (sameOrigin && url.pathname.endsWith('/carte.html')) {
      event.respondWith(mapNavigationFast(request));
    } else {
      event.respondWith(navigationNetworkFirst(request));
    }
    return;
  }

  if (isDynamicData(url)) {
    return;
  }

  // Les scripts communautaires doivent toujours privilégier la dernière
  // version réseau : aucun ancien pont ou correctif de signalement ne doit
  // survivre à une mise à jour et réinjecter un comportement obsolète.
  if (sameOrigin && isCriticalCommunityAsset(url)) {
    event.respondWith(uiStyleNetworkFirst(request));
    return;
  }

  // Les feuilles qui pilotent le rendu de l'accueil doivent être fraîches dès
  // le premier rechargement après une mise à jour, même si index.html garde un
  // ancien query-string pendant quelques minutes.
  if (sameOrigin && isUiStyle(url)) {
    event.respondWith(uiStyleNetworkFirst(request));
    return;
  }

  if (sameOrigin && isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }

  if (isCacheableExternal(url)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
  }
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'CLEAR_RUNTIME_CACHE') {
    event.waitUntil(
      caches.delete(STATIC_CACHE)
    );
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { body: event.data?.text?.() || '' };
  }

  const title = data.title || '🐮 La Bétaillère';
  const options = {
    body: data.body || 'Nouvelle alerte de La Bétaillère.',
    icon: data.icon || './icon-192.png',
    badge: data.badge || './icon-192.png',
    image: data.image,
    tag: data.tag || 'lbetaillere-alert',
    renotify: Boolean(data.renotify),
    timestamp: data.timestamp || Date.now(),
    vibrate: [120, 70, 120],
    data: {
      url: data.url || './index.html#home'
    },
    actions: [
      { action: 'open', title: 'Ouvrir' },
      { action: 'dismiss', title: 'Plus tard' }
    ]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const targetUrl = new URL(
    event.notification?.data?.url || './index.html#home',
    self.location.origin
  ).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (clientList) => {
        for (const client of clientList) {
          if ('navigate' in client) await client.navigate(targetUrl);
          if ('focus' in client) return client.focus();
        }
        return clients.openWindow ? clients.openWindow(targetUrl) : undefined;
      })
  );
});
