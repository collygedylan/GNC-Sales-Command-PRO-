/* GREENLEAF PROFESSIONAL SERVICE WORKER
   Optimized for: Instant Load, Offline Stability, Push Notifications, and staged shell updates.
*/

const APP_SHELL_URL = './index.html?shellv=V2026.04.02.05';
const CACHE_NAME = 'greenleaf-v4.2-rebuild-V2026.04.02.05';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  APP_SHELL_URL,
  './manifest.json',
  './Greenleaf Logo.png',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/@phosphor-icons/web'
];

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

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(APP_SHELL_URL, responseClone)).catch(() => {});
        }
        return networkResponse;
      }).catch(async () => {
        const cachedShell = await caches.match(APP_SHELL_URL);
        if (cachedShell) return cachedShell;
        const cachedIndex = await caches.match('./index.html');
        if (cachedIndex) return cachedIndex;
        return Response.error();
      })
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











