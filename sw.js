/* AG DATA SOLUTIONS PROFESSIONAL SERVICE WORKER
   Optimized for: Instant Load, Offline Stability, Push Notifications, and staged shell updates.
*/

const APP_SHELL_BUILD = 'V2026.08.24.05';
const APP_SHELL_QUERY_PARAM = 'shellv';
const APP_SHELL_URL = './index.html?shellv=' + encodeURIComponent(APP_SHELL_BUILD);
const NAVIGATION_NETWORK_TIMEOUT_MS = 3200;
const INSTALL_ASSET_TIMEOUT_MS = 8500;
const INSTALL_REMOTE_ASSET_TIMEOUT_MS = 4500;
const CACHE_NAME = 'ag-data-v4.3-rebuild-' + APP_SHELL_BUILD;
const IMAGE_CACHE_NAME = 'ag-data-runtime-images-v2';
const IMAGE_CACHE_METADATA_NAME = 'ag-data-runtime-image-metadata-v2';
const IMAGE_CACHE_METADATA_URL = './__gnc_image_cache_metadata__';
const IMAGE_CACHE_MAX_ENTRIES = 500;
const IMAGE_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const IMAGE_CACHE_MAX_BYTES = 100 * 1024 * 1024;
const OPAQUE_IMAGE_ESTIMATED_BYTES = 2 * 1024 * 1024;
const ASSETS_TO_CACHE = [
  APP_SHELL_URL,
  './manifest.json',
  './assets/ops-precision-pilot.css',
  './assets/ops-precision-pilot.js',
  './assets/eval-reports-engine.js',
  './assets/live-tailwind-v2026082010.min.css',
  './assets/live-app-runtime-v2026082010.min.js',
  './assets/image-optimize-worker-v2026081709.js',
  './assets/vendor/supabase-browser-2.112.3.min.js',
  './assets/vendor/phosphor/regular/style.css',
  './assets/vendor/phosphor/regular/Phosphor.woff2',
  './assets/vendor/phosphor/bold/style.css',
  './assets/vendor/phosphor/bold/Phosphor-Bold.woff2',
  './assets/vendor/phosphor/duotone/style.css',
  './assets/vendor/phosphor/duotone/Phosphor-Duotone.woff2',
  './assets/vendor/phosphor/fill/style.css',
  './assets/vendor/phosphor/fill/Phosphor-Fill.woff2',
  './assets/vendor/phosphor/light/style.css',
  './assets/vendor/phosphor/light/Phosphor-Light.woff2',
  './ag-data-solutions-logo-v2026080925.png',
  './ag-data-solutions-splash-v2026081709.png',
  './ag-data-solutions-icon-v2026080925-32.png',
  './ag-data-solutions-icon-v2026080925-180.png',
  './ag-data-solutions-icon-v2026080925-192.png',
  './ag-data-solutions-icon-v2026080925-512.png'
];
const RUNTIME_CACHE_EXTENSION_REGEX = /\.(?:css|js|mjs|json|png|jpg|jpeg|webp|svg|ico|woff2?)$/i;
const CONTENT_VERSION_REGEX = /(?:[._-](?:v?20\d{6,}|[a-f0-9]{8,})[._-]|\/assets\/vendor\/)/i;
const PRIVATE_NETWORK_PATH_REGEX = /\/(?:auth\/v1|rest\/v1|functions\/v1|storage\/v1\/object\/sign)(?:\/|$)/i;

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

async function fetchWithTimeout(request, options = {}, timeoutMs = INSTALL_ASSET_TIMEOUT_MS) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => {
    try { controller.abort(); } catch (error) {}
  }, Math.max(1000, Number(timeoutMs) || INSTALL_ASSET_TIMEOUT_MS)) : null;
  try {
    return await fetch(request, {
      ...options,
      signal: controller ? controller.signal : options.signal
    });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function cacheShellResponse(cache, requestedShellUrl, networkResponse) {
  if (!cache || !requestedShellUrl || !networkResponse || networkResponse.status !== 200) return;
  const responseClone = networkResponse.clone();
  const responseCloneForCurrent = networkResponse.clone();
  const responseCloneForIndex = networkResponse.clone();
  await Promise.all([
    cache.put(requestedShellUrl, responseClone).catch(() => {}),
    cache.put(APP_SHELL_URL, responseCloneForCurrent).catch(() => {}),
    cache.put('./index.html', responseCloneForIndex).catch(() => {})
  ]);
}

async function getCachedShellFallback(cache, requestedShellUrl, navigationRequest) {
  const candidates = [
    APP_SHELL_URL,
    requestedShellUrl,
    './index.html',
    navigationRequest
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const cached = cache ? await cache.match(candidate) : await caches.match(candidate);
      if (cached) return cached;
    } catch (error) {}
  }
  return null;
}

async function cacheShellInstallAsset(cache, asset) {
  if (!cache || !asset) return;
  try {
    if (String(asset).startsWith('./')) {
      const response = await fetchWithTimeout(asset, { cache: 'reload', credentials: 'same-origin' }, INSTALL_ASSET_TIMEOUT_MS);
      if (response && response.status === 200) {
        await cache.put(asset, response);
      }
      return;
    }
    const response = await fetchWithTimeout(asset, { cache: 'reload', mode: 'no-cors' }, INSTALL_REMOTE_ASSET_TIMEOUT_MS);
    if (response) await cache.put(asset, response);
  } catch (error) {}
}

function getAbsoluteAssetUrl(asset = '') {
  try {
    return new URL(String(asset || ''), self.registration.scope).href;
  } catch (error) {
    return '';
  }
}

function isPrecachedRuntimeAssetUrl(url = null) {
  if (!url) return false;
  const href = typeof url === 'string' ? url : url.href;
  if (!href) return false;
  return ASSETS_TO_CACHE.some((asset) => getAbsoluteAssetUrl(asset) === href);
}

function shouldRuntimeCacheRequest(request, response) {
  if (!request || !response || response.status !== 200) return false;
  const requestUrl = getRequestUrl(request);
  if (!requestUrl) return false;
  if (requestUrl.origin !== self.location.origin) return isPrecachedRuntimeAssetUrl(requestUrl);
  if (/\/index\.html$/i.test(requestUrl.pathname)) return false;
  return RUNTIME_CACHE_EXTENSION_REGEX.test(requestUrl.pathname);
}

function shouldBypassServiceWorkerCache(request) {
  const requestUrl = getRequestUrl(request);
  if (!requestUrl) return true;
  if (requestUrl.origin !== self.location.origin && PRIVATE_NETWORK_PATH_REGEX.test(requestUrl.pathname)) return true;
  if (PRIVATE_NETWORK_PATH_REGEX.test(requestUrl.pathname)) return true;
  if (/\btoken=|\bsignature=|\bsigned=/i.test(requestUrl.search)) return true;
  return false;
}

async function readImageCacheMetadata() {
  try {
    const cache = await caches.open(IMAGE_CACHE_METADATA_NAME);
    const response = await cache.match(IMAGE_CACHE_METADATA_URL);
    const value = response ? await response.json() : null;
    return value && typeof value === 'object' && value.entries ? value : { entries: {} };
  } catch (error) {
    return { entries: {} };
  }
}

async function writeImageCacheMetadata(metadata) {
  try {
    const cache = await caches.open(IMAGE_CACHE_METADATA_NAME);
    await cache.put(IMAGE_CACHE_METADATA_URL, new Response(JSON.stringify(metadata), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    }));
  } catch (error) {}
}

function isRuntimeImageRequest(request) {
  const requestUrl = getRequestUrl(request);
  if (!requestUrl) return false;
  if (request && request.destination === 'image') return true;
  if (/\.(?:png|jpg|jpeg|webp|gif|avif|svg)(?:$|[?#])/i.test(requestUrl.href)) return true;
  if (/\/storage\/v1\/(?:render\/image|object)\/public\//i.test(requestUrl.pathname)) return true;
  if (/drive\.google\.com$/i.test(requestUrl.hostname) && /\/(?:thumbnail|uc)$/i.test(requestUrl.pathname)) return true;
  if (/googleusercontent\.com$/i.test(requestUrl.hostname)) return true;
  return false;
}

async function pruneRuntimeImageCache(cache, metadata = null) {
  if (!cache) return;
  try {
    const keys = await cache.keys();
    const safeMetadata = metadata || await readImageCacheMetadata();
    const now = Date.now();
    const entries = keys.map((key) => {
      const stored = safeMetadata.entries[key.url] || {};
      return {
        key,
        url: key.url,
        cachedAt: Number(stored.cachedAt || 0),
        size: Math.max(0, Number(stored.size || OPAQUE_IMAGE_ESTIMATED_BYTES))
      };
    }).sort((a, b) => a.cachedAt - b.cachedAt);
    let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
    let totalEntries = entries.length;
    for (const entry of entries) {
      const expired = !entry.cachedAt || now - entry.cachedAt > IMAGE_CACHE_MAX_AGE_MS;
      const overflowing = totalEntries > IMAGE_CACHE_MAX_ENTRIES || totalBytes > IMAGE_CACHE_MAX_BYTES;
      if (!expired && !overflowing) continue;
      await cache.delete(entry.key).catch(() => false);
      delete safeMetadata.entries[entry.url];
      totalEntries -= 1;
      totalBytes -= entry.size;
    }
    await writeImageCacheMetadata(safeMetadata);
  } catch (error) {}
}

async function handleRuntimeImageRequest(event) {
  if (shouldBypassServiceWorkerCache(event.request)) return fetch(event.request);
  const imageCache = await caches.open(IMAGE_CACHE_NAME).catch(() => null);
  const cachedResponse = imageCache ? await imageCache.match(event.request, { ignoreVary: true }).catch(() => null) : null;
  if (cachedResponse) return cachedResponse;
  const networkResponse = await fetch(event.request).catch(() => null);
  if (networkResponse) {
    if (networkResponse.ok || networkResponse.type === 'opaque') {
      const responseClone = networkResponse.clone();
      event.waitUntil(
        caches.open(IMAGE_CACHE_NAME).then(async (cache) => {
            const metadata = await readImageCacheMetadata();
            const contentLength = Number(networkResponse.headers.get('content-length') || 0);
            metadata.entries[event.request.url] = {
              cachedAt: Date.now(),
              size: contentLength > 0 ? contentLength : (networkResponse.type === 'opaque' ? OPAQUE_IMAGE_ESTIMATED_BYTES : 0)
            };
            await cache.put(event.request, responseClone).catch(() => {});
            await pruneRuntimeImageCache(cache, metadata);
          })
          .catch(() => {})
      );
    }
    return networkResponse;
  }
  return caches.match(event.request).then((fallback) => fallback || Response.error());
}

async function broadcastShellVersion(type = 'GNC_SHELL_VERSION') {
  try {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await Promise.all(clientList.map((client) => {
      try {
        client.postMessage({
          type,
          build: APP_SHELL_BUILD,
          version: APP_SHELL_BUILD,
          shellUrl: APP_SHELL_URL
        });
      } catch (error) {}
      return Promise.resolve();
    }));
  } catch (error) {}
}

function buildAbsoluteShellUrl(build = APP_SHELL_BUILD, reason = '') {
  const shellUrl = new URL(buildShellUrl(build), self.registration.scope);
  shellUrl.searchParams.set('shellts', String(Date.now()));
  if (reason) shellUrl.searchParams.set('shellreason', String(reason || '').slice(0, 48));
  return shellUrl.href;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => Promise.all(
      ASSETS_TO_CACHE.map((asset) => cacheShellInstallAsset(cache, asset))
    ))
  );
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => {
        const keepCacheNames = new Set([CACHE_NAME, IMAGE_CACHE_NAME, IMAGE_CACHE_METADATA_NAME]);
        return Promise.all(keys.map((key) => keepCacheNames.has(key) ? Promise.resolve() : caches.delete(key)));
      })
      .then(() => {
        if (!self.registration || !self.registration.navigationPreload) return Promise.resolve();
        return self.registration.navigationPreload.enable().catch(() => {});
      })
      .then(() => self.clients.claim())
      .then(() => broadcastShellVersion('GNC_SHELL_ACTIVATED'))
  );
});
self.addEventListener('message', (event) => {
  const data = event && event.data ? event.data : {};
  if (!data || typeof data !== 'object') return;
  if (data.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  } else if (data.type === 'GNC_GET_SHELL_VERSION') {
    try {
      if (event.source) {
        event.source.postMessage({
          type: 'GNC_SHELL_VERSION',
          build: APP_SHELL_BUILD,
          version: APP_SHELL_BUILD,
          shellUrl: APP_SHELL_URL
        });
      }
    } catch (error) {}
  }
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) return;
  if (shouldBypassServiceWorkerCache(event.request)) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const requestedBuild = getRequestedShellBuild(event.request);
        const currentShellUrl = buildShellUrl(APP_SHELL_BUILD);
        const requestedShellUrl = buildShellUrl(requestedBuild || APP_SHELL_BUILD);
        const isStaleShellNavigation = requestedBuild && requestedBuild !== APP_SHELL_BUILD;
        const primaryShellUrl = isStaleShellNavigation
          ? buildAbsoluteShellUrl(APP_SHELL_BUILD, 'stale-navigation')
          : event.request;
        const cache = await caches.open(CACHE_NAME).catch(() => null);
        const cachedShellFallback = await getCachedShellFallback(cache, currentShellUrl, event.request);
        const preloadedNavigation = event.preloadResponse
          ? event.preloadResponse.catch(() => null)
          : Promise.resolve(null);
        const navigationNetwork = preloadedNavigation.then((preloadedResponse) => {
          if (preloadedResponse && preloadedResponse.status === 200 && !isStaleShellNavigation) return preloadedResponse;
          return fetch(primaryShellUrl, { cache: 'no-store', credentials: 'same-origin' });
        })
          .then(async (networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              await cacheShellResponse(cache, currentShellUrl, networkResponse);
            }
            return networkResponse;
          })
          .catch(() => null);
        if (isStaleShellNavigation) {
          const currentNetworkShell = await navigationNetwork;
          if (currentNetworkShell) return currentNetworkShell;
        }
        if (cachedShellFallback) {
          const fastResponse = await Promise.race([
            navigationNetwork,
            new Promise((resolve) => setTimeout(() => resolve(cachedShellFallback), NAVIGATION_NETWORK_TIMEOUT_MS))
          ]);
          if (fastResponse) {
            if (fastResponse === cachedShellFallback) {
              event.waitUntil(navigationNetwork.catch(() => null));
            }
            return fastResponse;
          }
        }
        const networkResponse = await navigationNetwork;
        if (networkResponse) return networkResponse;
        try {
          const networkResponse = await fetch(currentShellUrl, { cache: 'no-store', credentials: 'same-origin' });
          if (networkResponse && networkResponse.status === 200) {
            await cacheShellResponse(cache, currentShellUrl, networkResponse);
          }
          return networkResponse;
        } catch (error) {
        }
        if (cachedShellFallback) return cachedShellFallback;
        const cachedFromCache = await getCachedShellFallback(cache, currentShellUrl, event.request);
        if (cachedFromCache) return cachedFromCache;
        const globalCurrentShell = await caches.match(APP_SHELL_URL);
        if (globalCurrentShell) return globalCurrentShell;
        const globalRequestedShell = await caches.match(requestedShellUrl);
        if (globalRequestedShell) return globalRequestedShell;
        const cachedRequestedNavigation = await caches.match(event.request);
        if (cachedRequestedNavigation) return cachedRequestedNavigation;
        const globalIndex = await caches.match('./index.html');
        if (globalIndex) return globalIndex;
        return Response.error();
      })()
    );
    return;
  }
  if (isRuntimeImageRequest(event.request)) {
    event.respondWith(handleRuntimeImageRequest(event));
    return;
  }
  const requestUrl = getRequestUrl(event.request);
  if (isPrecachedRuntimeAssetUrl(requestUrl) || (requestUrl && requestUrl.origin === self.location.origin && CONTENT_VERSION_REGEX.test(requestUrl.pathname))) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
        if (shouldRuntimeCacheRequest(event.request, response)) {
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone())).catch(() => {}));
        }
        return response;
      }))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const networkRequest = fetch(event.request).then((networkResponse) => {
      if (shouldRuntimeCacheRequest(event.request, networkResponse)) {
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone)).catch(() => {});
      }
      return networkResponse;
      });
      if (cachedResponse) {
        event.waitUntil(networkRequest.catch(() => null));
        return cachedResponse;
      }
      return networkRequest.catch(() => caches.match(event.request));
    })
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try { data = event.data.json(); } catch (error) { data = { title: 'Ag Data Message', body: event.data.text() }; }
  }
  const title = data.title || 'Ag Data Message';
  const iconUrl = new URL(data.icon || './ag-data-solutions-icon-v2026080925-192.png', self.registration.scope).href;
  const targetUrl = new URL(data.url || APP_SHELL_URL, self.registration.scope).href;
  const options = {
    body: data.body || 'You have a new message.',
    icon: iconUrl,
    badge: iconUrl,
    data: { url: targetUrl, viewId: data.viewId || 'request', taskView: data.taskView || '', folderName: data.folderName || '', conversationId: data.conversationId || '', messageId: data.messageId || '', channelId: data.channelId || '', callId: data.callId || '', calendarEventId: data.calendarEventId || '' },
    vibrate: [200, 100, 200],
    silent: false,
    requireInteraction: true,
    timestamp: Date.now(),
    tag: data.tag || 'ag-data-alert',
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
          try { client.postMessage({ type: 'GNC_OPEN_VIEW', viewId: targetView, taskView: payload.taskView || '', folderName: payload.folderName || '', conversationId: payload.conversationId || '', messageId: payload.messageId || '', channelId: payload.channelId || '', callId: payload.callId || '', calendarEventId: payload.calendarEventId || '' }); } catch (error) {}
          return client;
        }
      }
      if (clients.openWindow) {
        const opened = await clients.openWindow(targetUrl);
        if (opened) {
          try { opened.postMessage({ type: 'GNC_OPEN_VIEW', viewId: targetView, taskView: payload.taskView || '', folderName: payload.folderName || '', conversationId: payload.conversationId || '', messageId: payload.messageId || '', channelId: payload.channelId || '', callId: payload.callId || '', calendarEventId: payload.calendarEventId || '' }); } catch (error) {}
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
