/* GREENLEAF PROFESSIONAL SERVICE WORKER
   Optimized for: Instant Load, Offline Stability, Push Notifications, and staged shell updates.
*/

const APP_SHELL_BUILD = 'V2026.04.25.04';
const APP_SHELL_QUERY_PARAM = 'shellv';
const APP_SHELL_URL = './index.html?shellv=' + encodeURIComponent(APP_SHELL_BUILD);
const CACHE_NAME = 'greenleaf-v4.2-rebuild-' + APP_SHELL_BUILD;
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  APP_SHELL_URL,
  './manifest.json',
  './Greenleaf Logo.png',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/@phosphor-icons/web'
];

function normalizeShellBuild(value = '') {
  return String(value || '').trim();
}

function buildShellUrl(build = '') {
  const safeBuild = normalizeShellBuild(build) || APP_SHELL_BUILD;
  return './index.html?' + APP_SHELL_QUERY_PARAM + '=' + encodeURIComponent(safeBuild);
}

function getRequestUrl(requestOrUrl) {
  try {
    return new URL(typeof requestOrUrl === 'string' ? requestOrUrl : requestOrUrl.url, self.location.href);
  } catch (error) {
    return null;
  }
}

function getRequestedShellBuild(request) {
  const requestUrl = getRequestUrl(request);
  if (!requestUrl) return '';
  return normalizeShellBuild(requestUrl.searchParams.get(APP_SHELL_QUERY_PARAM) || '');
}

async function cacheShellResponse(cache, requestedShellUrl, networkResponse) {
  if (!cache || !requestedShellUrl || !networkResponse || networkResponse.status !== 200) return;
  const responseClone = networkResponse.clone();
  const responseCloneForIndex = networkResponse.clone();
  await Promise.all([
    cache.put(requestedShellUrl, responseClone).catch(() => {}),
    cache.put('./index.html', responseCloneForIndex).catch(() => {})
  ]);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((key) => key !== CACHE_NAME ? caches.delete(key) : Promise.resolve()))).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  const data = event && event.data ? event.data : {};
  if (!data || typeof data !== 'object') return;
  if (data.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const requestedBuild = getRequestedShellBuild(event.request) || APP_SHELL_BUILD;
        const requestedShellUrl = buildShellUrl(requestedBuild);
        const cache = await caches.open(CACHE_NAME).catch(() => null);
        try {
          const networkResponse = await fetch(requestedShellUrl, { cache: 'no-store' });
          if (networkResponse && networkResponse.status === 200) {
            await cacheShellResponse(cache, requestedShellUrl, networkResponse);
          }
          return networkResponse;
        } catch (error) {
        }
        if (cache) {
          const cachedRequestedShell = await cache.match(requestedShellUrl);
          if (cachedRequestedShell) return cachedRequestedShell;
          const cachedCurrentShell = await cache.match(APP_SHELL_URL);
          if (cachedCurrentShell) return cachedCurrentShell;
          const cachedIndex = await cache.match('./index.html');
          if (cachedIndex) return cachedIndex;
        }
        const globalRequestedShell = await caches.match(requestedShellUrl);
        if (globalRequestedShell) return globalRequestedShell;
        const globalCurrentShell = await caches.match(APP_SHELL_URL);
        if (globalCurrentShell) return globalCurrentShell;
        const cachedRequestedNavigation = await caches.match(event.request);
        if (cachedRequestedNavigation) return cachedRequestedNavigation;
        const globalIndex = await caches.match('./index.html');
        if (globalIndex) return globalIndex;
        return Response.error();
      })()
    );
    return;
  }
  event.respondWith(
    fetch(event.request).then((networkResponse) => {
      if (networkResponse && networkResponse.status === 200) {
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone)).catch(() => {});
      }
      return networkResponse;
    }).catch(() => caches.match(event.request))
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try { data = event.data.json(); } catch (error) { data = { title: 'Greenleaf Message', body: event.data.text() }; }
  }
  const title = data.title || 'Greenleaf Message';
  const options = {
    body: data.body || 'You have a new message.',
    icon: data.icon || './Greenleaf Logo.png',
    badge: data.badge || './Greenleaf Logo.png',
    data: { url: data.url || APP_SHELL_URL, viewId: data.viewId || 'request' },
    vibrate: [200, 100, 200],
    tag: data.tag || 'greenleaf-alert',
    renotify: true
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const payload = event.notification && event.notification.data ? event.notification.data : {};
  const targetUrl = payload.url || APP_SHELL_URL;
  const targetView = payload.viewId || 'request';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          await client.focus();
          try { client.postMessage({ type: 'GNC_OPEN_VIEW', viewId: targetView }); } catch (error) {}
          return client;
        }
      }
      if (clients.openWindow) {
        const opened = await clients.openWindow(targetUrl);
        if (opened) {
          try { opened.postMessage({ type: 'GNC_OPEN_VIEW', viewId: targetView }); } catch (error) {}
        }
        return opened;
      }
      return null;
    })
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => Promise.all(clientList.map((client) => {
      try { return client.postMessage({ type: 'GNC_RESUBSCRIBE_PUSH' }); } catch (error) { return Promise.resolve(); }
    })))
  );
});













