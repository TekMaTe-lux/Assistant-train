const CACHE_VERSION = 'v65';
const APP_CACHE = `lbetaillere-app-${CACHE_VERSION}`;
const STATIC_CACHE = `lbetaillere-static-${CACHE_VERSION}`;
const DATA_CACHE = `lbetaillere-data-${CACHE_VERSION}`;
const TRANSIT_CACHE = 'lbetaillere-transit-v1';
const CACHE_PREFIX = 'lbetaillere-';
const OUTBOX_DB = 'lbetaillere-offline-v1';
const OUTBOX_STORE = 'outbox';
const OUTBOX_SYNC_TAG = 'lb-outbox-sync';
const COMMUNITY_REFRESH_MS = 10000;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './config/territory.nancy-metz-lux.js?v=4',
  './assets/lb-app-shell-v3.js?v=7',
  './assets/lb-legacy.css?v=5',
  './assets/lb-design-system-v3.css?v=10',
  './assets/lb-mobile-v4.css?v=14',
  './assets/lb-v4-live-preview.css?v=20260831-3',
  './assets/lb-index-inline.css?v=1',
  './assets/lb-index-late.css?v=1',
  './assets/lb-home-premium-v2.css?v=1',
  './assets/lb-index-head.js?v=1',
  './assets/lb-index-core.js?v=3',
  './assets/lb-index-home.js?v=2',
  './assets/lb-index-features.js?v=2',
  './assets/lb-status-harmony-v1.css?v=1',
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
            .filter((key) => ![APP_CACHE, STATIC_CACHE, DATA_CACHE, TRANSIT_CACHE].includes(key))
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
    const response = await fetchWithTimeout(request, 1600);
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

async function staleWhileRevalidate(request, cacheName = STATIC_CACHE) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: false });
  let shellCached = null;
  if (!cached && cacheName === STATIC_CACHE) {
    try {
      const shell = await caches.open(APP_CACHE);
      shellCached = await shell.match(request, { ignoreSearch: false });
    } catch (_) {}
  }
  const sameOrigin = new URL(request.url).origin === self.location.origin;
  const refresh = fetch(request, sameOrigin ? { cache: 'no-cache' } : undefined)
    .then((response) => {
      if (response?.ok || response?.type === 'opaque') {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);
  return cached || shellCached || (await refresh) || Response.error();
}

function canonicalDataKey(request) {
  const url = new URL(request.url);
  url.searchParams.delete('_');
  url.searchParams.delete('t');
  url.searchParams.delete('client');
  return url.href;
}

function isCommunityApi(url) {
  return url.hostname === 'vps.labetaillere.fr' && url.pathname === '/api/comments';
}

function pendingCommunityActionId(url) {
  if (url.hostname !== 'vps.labetaillere.fr') return '';
  const match = url.pathname.match(/^\/api\/comments\/offline-([A-Za-z0-9-]+)$/);
  return match ? match[1] : '';
}

function isCommunityItemApi(url) {
  return url.hostname === 'vps.labetaillere.fr' && (
    /^\/api\/comments\/\d+$/.test(url.pathname) ||
    !!pendingCommunityActionId(url)
  );
}

function isOfflineAuthApi(url) {
  return url.hostname === 'vps.labetaillere.fr' && (url.pathname === '/api/me' || url.pathname === '/api/prefs');
}

function transitPolicy(url) {
  const path = url.pathname;
  if (url.hostname === 'raw.githubusercontent.com' && path === '/TekMaTe-lux/Assistant-train/main/Compotrains.json') {
    return { label: 'compositions', maxAgeMs: 24 * 60 * 60 * 1000 };
  }
  if (url.hostname !== 'vps.labetaillere.fr') return null;
  if (path === '/sncf/hub') return { label: 'SNCF', maxAgeMs: 6 * 60 * 60 * 1000 };
  if (path === '/api/train-static') return { label: 'horaires', maxAgeMs: 30 * 24 * 60 * 60 * 1000 };
  if (path === '/gtfs/train_static_today.json') return { label: 'horaires du jour', maxAgeMs: 36 * 60 * 60 * 1000 };
  if (/^\/gtfs\/retards[^/]*\.json$/i.test(path)) return { label: 'temps réel', maxAgeMs: 30 * 60 * 1000 };
  if (path === '/gtfs/voies_by_train.json') return { label: 'voies', maxAgeMs: 2 * 60 * 60 * 1000 };
  if (path === '/gtfs/Compotrains.json') return { label: 'compositions', maxAgeMs: 24 * 60 * 60 * 1000 };
  if (path === '/hafas/departureBoard') return { label: 'CFL', maxAgeMs: 30 * 60 * 1000 };
  return null;
}

function isSafeTransitData(url) {
  return !!transitPolicy(url);
}

function transitMetaKey(key) {
  const url = new URL(String(key));
  url.searchParams.set('__lbmeta', '1');
  return url.href;
}

async function writeTransitCache(cache, key, response, cachedAt) {
  await Promise.all([
    cache.put(key, response.clone()),
    cache.put(transitMetaKey(key), new Response(JSON.stringify({ cachedAt }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }))
  ]);
}

async function readTransitCachedAt(cache, key, cached) {
  try {
    const meta = await cache.match(transitMetaKey(key));
    if (meta) {
      const data = await meta.json();
      const value = Number(data?.cachedAt || 0);
      if (value > 0) return value;
    }
  } catch (_) {}
  return Number(cached?.headers?.get?.('x-lb-cached-at') || 0);
}

async function deleteTransitPair(cache, requestOrUrl) {
  const key = typeof requestOrUrl === 'string' ? requestOrUrl : requestOrUrl.url;
  await Promise.all([cache.delete(key), cache.delete(transitMetaKey(key))]);
}

async function trimTransitCache(cache, keep = 180) {
  const keys = (await cache.keys()).filter((request) => !new URL(request.url).searchParams.has('__lbmeta'));
  const daily = keys.filter((request) => new URL(request.url).pathname === '/gtfs/train_static_today.json');
  if (daily.length > 2) {
    await Promise.all(daily.slice(0, daily.length - 2).map((request) => deleteTransitPair(cache, request)));
  }
  const remaining = (await cache.keys()).filter((request) => !new URL(request.url).searchParams.has('__lbmeta'));
  if (remaining.length <= keep) return;
  await Promise.all(remaining.slice(0, remaining.length - keep).map((request) => deleteTransitPair(cache, request)));
}

async function transitResponseUsable(url, response) {
  if (!response?.ok) return false;
  if (url.pathname !== '/sncf/hub') return true;
  try {
    const data = await response.clone().json();
    return Object.values(data?.trains || {}).some((item) => item?.ok && item?.data);
  } catch (_) {
    return false;
  }
}

async function notifyTransitState(policy, source, cachedAt = null) {
  const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  windows.forEach((client) => client.postMessage({
    type: 'LB_DATA_STATE',
    label: policy?.label || 'données',
    source,
    cachedAt: cachedAt ? Number(cachedAt) : null
  }));
}

async function transitFallback(cache, key, policy) {
  const cached = await cache.match(key);
  if (!cached) return null;
  const cachedAt = await readTransitCachedAt(cache, key, cached);
  if (!cachedAt || (Date.now() - cachedAt) > policy.maxAgeMs) return null;
  await notifyTransitState(policy, 'cache', cachedAt);
  return cached;
}

async function transitNetworkFirst(request) {
  const url = new URL(request.url);
  const policy = transitPolicy(url);
  if (!policy) return fetch(request);
  const cache = await caches.open(TRANSIT_CACHE);
  const key = canonicalDataKey(request);
  try {
    const response = await fetchWithTimeout(request, 2200);
    const usable = await transitResponseUsable(url, response);
    if (usable) {
      const cachedAt = Date.now();
      await writeTransitCache(cache, key, response, cachedAt);
      await trimTransitCache(cache).catch(() => {});
      notifyTransitState(policy, 'network', cachedAt).catch(() => {});
      return response;
    }
    const fallback = await transitFallback(cache, key, policy);
    if (fallback && (response.status >= 500 || [408, 429].includes(response.status) || response.ok)) return fallback;
    return response;
  } catch (_) {
    return (await transitFallback(cache, key, policy)) || Response.error();
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function openOutboxDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OUTBOX_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) db.createObjectStore(OUTBOX_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function outboxPut(item) {
  const db = await openOutboxDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(OUTBOX_STORE, 'readwrite');
      tx.objectStore(OUTBOX_STORE).put(item);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

async function outboxDelete(id) {
  const db = await openOutboxDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(OUTBOX_STORE, 'readwrite');
      tx.objectStore(OUTBOX_STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

async function outboxAll() {
  const db = await openOutboxDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(OUTBOX_STORE, 'readonly');
      const req = tx.objectStore(OUTBOX_STORE).getAll();
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0)));
      req.onerror = () => reject(req.error);
    });
  } finally { db.close(); }
}

async function notifyOutboxStatus() {
  let pending = 0;
  try { pending = (await outboxAll()).length; } catch (_) {}
  const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  windows.forEach((client) => client.postMessage({ type: 'LB_OUTBOX_STATUS', pending }));
}

function actionId() {
  if (self.crypto?.randomUUID) return self.crypto.randomUUID();
  return `lb-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

async function communityWriteDescriptor(request) {
  const method = String(request.method || 'POST').toUpperCase();
  let body = method === 'DELETE' ? '' : await request.clone().text();
  let id = actionId();
  if (method === 'POST') {
    try {
      const parsed = JSON.parse(body || '{}');
      id = String(parsed.client_action_id || id);
      parsed.client_action_id = id;
      body = JSON.stringify(parsed);
    } catch (_) {}
  }
  const headers = {};
  request.headers.forEach((value, key) => { headers[key] = value; });
  if (method === 'POST') headers['content-type'] = headers['content-type'] || 'application/json';
  return { id, url: request.url, method, headers, body, createdAt: Date.now(), attempts: 0 };
}

function requestFromOutbox(item) {
  return new Request(item.url, {
    method: item.method,
    headers: item.headers || {},
    body: item.method === 'GET' || item.method === 'HEAD' || item.method === 'DELETE' ? undefined : item.body,
    credentials: 'include',
    cache: 'no-store',
    redirect: 'follow'
  });
}

async function queueCommunityWrite(request) {
  const item = await communityWriteDescriptor(request);
  await outboxPut(item);
  try { await self.registration.sync?.register(OUTBOX_SYNC_TAG); } catch (_) {}
  await notifyOutboxStatus();
  return item;
}

async function handleCommunityWrite(request) {
  const requestUrl = new URL(request.url);
  const pendingActionId = request.method === 'DELETE' ? pendingCommunityActionId(requestUrl) : '';
  if (pendingActionId) {
    await outboxDelete(pendingActionId);
    await notifyOutboxStatus();
    return jsonResponse({ ok: true, cancelled: true, pending: false, client_action_id: pendingActionId });
  }
  const item = await communityWriteDescriptor(request);
  const networkRequest = requestFromOutbox(item);
  try {
    const response = await fetchWithTimeout(networkRequest, 3200);
    if (response.ok || (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status))) {
      return response;
    }
  } catch (_) {}
  await outboxPut(item);
  try { await self.registration.sync?.register(OUTBOX_SYNC_TAG); } catch (_) {}
  await notifyOutboxStatus();
  return jsonResponse({ ok: true, queued: true, pending: true, client_action_id: item.id }, 202);
}

let outboxFlushPromise = null;
async function flushOutbox() {
  if (outboxFlushPromise) return outboxFlushPromise;
  outboxFlushPromise = (async () => {
    const items = await outboxAll().catch(() => []);
    for (const item of items) {
      try {
        const response = await fetch(requestFromOutbox(item));
        const terminal4xx = response.status >= 400 && response.status < 500 && ![401, 403, 408, 429].includes(response.status);
        const repeatedDelete = item.method === 'DELETE' && response.status === 404;
        if (response.ok || terminal4xx || repeatedDelete) {
          await outboxDelete(item.id);
          continue;
        }
        break;
      } catch (_) { break; }
    }
    await notifyOutboxStatus();
  })().finally(() => { outboxFlushPromise = null; });
  return outboxFlushPromise;
}

async function cachedAuthGet(request) {
  const cache = await caches.open(DATA_CACHE);
  const key = canonicalDataKey(request);
  try {
    const response = await fetchWithTimeout(request, 1500);
    if (response.ok) await cache.put(key, response.clone());
    else if (response.status === 401 || response.status === 403) await cache.delete(key);
    return response;
  } catch (_) {
    return (await cache.match(key)) || Response.error();
  }
}

function pendingRecord(item) {
  if (item.method !== 'POST') return null;
  let body = null;
  try { body = JSON.parse(item.body || '{}'); } catch (_) { return null; }
  const scope = String(body.scope || 'wall');
  return {
    id: `offline-${item.id}`,
    user_id: null,
    pseudo: 'Vous · en attente',
    display_pseudo: 'Vous · en attente',
    message: String(body.message || ''),
    train_number: body.train_number || null,
    scope,
    station: body.station || null,
    signal_type: body.signal_type || null,
    delay_min: body.delay_min ?? null,
    info_tag: body.info_tag || null,
    account_id: body.account_id || null,
    created_at: new Date(item.createdAt || Date.now()).toISOString(),
    pending: true,
    client_action_id: item.id
  };
}

async function mergePendingCommunity(request, baseList) {
  const wanted = new URL(request.url).searchParams.get('scope') || 'wall';
  const items = await outboxAll().catch(() => []);
  const deletedIds = new Set(items.filter((item) => item.method === 'DELETE').map((item) => {
    const match = item.url.match(/\/api\/comments\/(\d+)$/);
    return match ? String(match[1]) : '';
  }).filter(Boolean));
  const current = (Array.isArray(baseList) ? baseList : []).filter((row) => !deletedIds.has(String(row?.id || '')));
  const pending = items.map(pendingRecord).filter((row) => row && row.scope === wanted);
  return [...current, ...pending];
}

async function communityGet(request) {
  const cache = await caches.open(DATA_CACHE);
  const key = canonicalDataKey(request);
  const cached = await cache.match(key);
  const cachedAt = cached ? Date.parse(cached.headers.get('date') || '') : NaN;
  const cacheFresh = cached && Number.isFinite(cachedAt) && (Date.now() - cachedAt) < COMMUNITY_REFRESH_MS;
  let response = null;
  if (cacheFresh) {
    response = cached;
  } else {
    try {
      const network = await fetchWithTimeout(request, 1500);
      if (network.ok) {
        await cache.put(key, network.clone());
        response = network;
      } else {
        response = network;
      }
    } catch (_) { response = cached; }
  }
  let data = [];
  if (response?.ok) {
    try { data = await response.clone().json(); } catch (_) {}
  }
  const merged = await mergePendingCommunity(request, Array.isArray(data) ? data : (Array.isArray(data?.comments) ? data.comments : []));
  return jsonResponse(merged, 200);
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
    url.pathname.endsWith('/assets/lb-status-harmony-v1.css') ||
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
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  if ((request.method === 'POST' && isCommunityApi(url)) || (request.method === 'DELETE' && isCommunityItemApi(url))) {
    event.respondWith(handleCommunityWrite(request));
    return;
  }

  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(navigationNetworkFirst(request));
    event.waitUntil(flushOutbox().catch(() => {}));
    return;
  }

  if (isCommunityApi(url)) {
    event.respondWith(communityGet(request));
    event.waitUntil(flushOutbox().catch(() => {}));
    return;
  }

  if (isOfflineAuthApi(url)) {
    event.respondWith(cachedAuthGet(request));
    event.waitUntil(flushOutbox().catch(() => {}));
    return;
  }

  if (isSafeTransitData(url)) {
    event.respondWith(transitNetworkFirst(request));
    return;
  }

  if (isDynamicData(url)) return;

  if (sameOrigin && isCriticalCommunityAsset(url)) {
    event.respondWith(uiStyleNetworkFirst(request));
    return;
  }

  if (sameOrigin && isUiStyle(url)) {
    event.respondWith(uiStyleNetworkFirst(request));
    return;
  }

  if (sameOrigin && isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }

  if (isCacheableExternal(url)) event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'CLEAR_RUNTIME_CACHE') {
    event.waitUntil(Promise.all([caches.delete(STATIC_CACHE), caches.delete(DATA_CACHE), caches.delete(TRANSIT_CACHE)]));
  }
  if (event.data?.type === 'LB_FLUSH_OUTBOX') {
    event.waitUntil(flushOutbox().catch(() => {}));
  }
  if (event.data?.type === 'LB_OUTBOX_STATUS') {
    event.waitUntil(notifyOutboxStatus());
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === OUTBOX_SYNC_TAG) event.waitUntil(flushOutbox());
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
