const APP_VERSION = 'V2026.08.13.v2.04';
const CACHE_NAME = `gnc-field-v2-${APP_VERSION}`;
const APP_SHELL = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('gnc-field-v2-') && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(
    fetch(request).then(response => {
      if (!response || response.status !== 200 || response.type === 'opaque') return response;
      const clone = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
      return response;
    }).catch(() => caches.match(request))
  );
});
