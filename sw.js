/* AG DATA SOLUTIONS PROFESSIONAL SERVICE WORKER
   Optimized for: Instant Load, Offline Stability, Push Notifications, and staged shell updates.
*/

const APP_SHELL_BUILD = 'AgData v3.0.20';
const APP_SHELL_RUNTIME_REVISION = 'cloud-relay-cache-r2';
const APP_ASSET_VERSION = '3.0.20';
const APP_SHELL_QUERY_PARAM = 'shellv';
const APP_SHELL_URL = './index.html?shellv=' + encodeURIComponent(APP_SHELL_BUILD);
const INSTALL_ASSET_TIMEOUT_MS = 8500;
const INSTALL_REMOTE_ASSET_TIMEOUT_MS = 4500;
// A fresh root cache cannot inherit a /v2 response cached by the older broad worker.
const CACHE_VERSION = 'agdata-v3.0.20';
const CACHE_NAME = CACHE_VERSION;
const IMAGE_CACHE_NAME = 'agdata-photo-cache-v1';
let runtimeImageCacheQueue = Promise.resolve();
const IMAGE_CACHE_METADATA_NAME = 'ag-data-runtime-image-metadata-v2';
const IMAGE_CACHE_METADATA_URL = './__gnc_image_cache_metadata__';
const IMAGE_CACHE_MAX_ENTRIES = 500;
const IMAGE_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const IMAGE_CACHE_MAX_BYTES = 100 * 1024 * 1024;
const OPAQUE_IMAGE_ESTIMATED_BYTES = 2 * 1024 * 1024;
// BEGIN GENERATED BRANDING ASSETS
// Derived from assets/branding/catalog.json by scripts/branding-assets.mjs.
const BRANDING_LEGACY_ALIASES = Object.freeze({
  "./ag-data-solutions-icon-v20260708023-32.png": "./assets/branding/ag-data-solutions-icon-v2026080925-32.png",
  "./ag-data-solutions-icon-v2026080923-32.png": "./assets/branding/ag-data-solutions-icon-v2026080925-32.png",
  "./ag-data-solutions-icon-v2026080925-32.png": "./assets/branding/ag-data-solutions-icon-v2026080925-32.png",
  "./ag-data-solutions-icon-v20260708023-180.png": "./assets/branding/ag-data-solutions-icon-v2026080925-180.png",
  "./ag-data-solutions-icon-v2026080923-180.png": "./assets/branding/ag-data-solutions-icon-v2026080925-180.png",
  "./ag-data-solutions-icon-v2026080925-180.png": "./assets/branding/ag-data-solutions-icon-v2026080925-180.png",
  "./ag-data-solutions-icon-v20260708023-192.png": "./assets/branding/ag-data-solutions-icon-v2026080925-192.png",
  "./ag-data-solutions-icon-v2026080923-192.png": "./assets/branding/ag-data-solutions-icon-v2026080925-192.png",
  "./ag-data-solutions-icon-v2026080925-192.png": "./assets/branding/ag-data-solutions-icon-v2026080925-192.png",
  "./ag-data-solutions-icon-v20260708023-512.png": "./assets/branding/ag-data-solutions-icon-v2026080925-512.png",
  "./ag-data-solutions-icon-v2026080923-512.png": "./assets/branding/ag-data-solutions-icon-v2026080925-512.png",
  "./ag-data-solutions-icon-v2026080925-512.png": "./assets/branding/ag-data-solutions-icon-v2026080925-512.png",
  "./ag-data-solutions-logo-v2026080923.png": "./assets/branding/ag-data-solutions-logo-v2026080925.png",
  "./ag-data-solutions-logo-v2026080925.png": "./assets/branding/ag-data-solutions-logo-v2026080925.png",
  "./ag-data-solutions-logo.png": "./assets/branding/ag-data-solutions-logo-v2026080925.png",
  "./ag-data-solutions-logo-v2026090503-224.webp": "./assets/branding/ag-data-solutions-logo-v2026090503-224.webp",
  "./ag-data-solutions-logo-v2026090503-448.webp": "./assets/branding/ag-data-solutions-logo-v2026090503-448.webp",
  "./ag-data-solutions-splash-v202607141237.png": "./assets/branding/ag-data-solutions-splash-v2026080925.png",
  "./ag-data-solutions-splash-v2026080923.png": "./assets/branding/ag-data-solutions-splash-v2026080925.png",
  "./ag-data-solutions-splash-v2026080925.png": "./assets/branding/ag-data-solutions-splash-v2026080925.png",
  "./ag-data-solutions-splash-v2026081615.png": "./assets/branding/ag-data-solutions-splash-v2026081709.png",
  "./ag-data-solutions-splash-v2026081701.png": "./assets/branding/ag-data-solutions-splash-v2026081709.png",
  "./ag-data-solutions-splash-v2026081702.png": "./assets/branding/ag-data-solutions-splash-v2026081709.png",
  "./ag-data-solutions-splash-v2026081703.png": "./assets/branding/ag-data-solutions-splash-v2026081709.png",
  "./ag-data-solutions-splash-v2026081704.png": "./assets/branding/ag-data-solutions-splash-v2026081709.png",
  "./ag-data-solutions-splash-v2026081705.png": "./assets/branding/ag-data-solutions-splash-v2026081709.png",
  "./ag-data-solutions-splash-v2026081706.png": "./assets/branding/ag-data-solutions-splash-v2026081709.png",
  "./ag-data-solutions-splash-v2026081707.png": "./assets/branding/ag-data-solutions-splash-v2026081709.png",
  "./ag-data-solutions-splash-v2026081708.png": "./assets/branding/ag-data-solutions-splash-v2026081709.png",
  "./ag-data-solutions-splash-v2026081709.png": "./assets/branding/ag-data-solutions-splash-v2026081709.png"
});
const BRANDING_CANONICAL_ASSETS = Object.freeze([
  "./assets/branding/ag-data-solutions-icon-v2026080925-32.png",
  "./assets/branding/ag-data-solutions-icon-v2026080925-180.png",
  "./assets/branding/ag-data-solutions-icon-v2026080925-192.png",
  "./assets/branding/ag-data-solutions-icon-v2026080925-512.png",
  "./assets/branding/ag-data-solutions-logo-v2026080925.png",
  "./assets/branding/ag-data-solutions-logo-v2026090503-224.webp",
  "./assets/branding/ag-data-solutions-logo-v2026090503-448.webp",
  "./assets/branding/ag-data-solutions-splash-v2026080925.png",
  "./assets/branding/ag-data-solutions-splash-v2026081709.png"
]);
// END GENERATED BRANDING ASSETS
const DEFERRED_VIEW_ASSETS = /* release-generated */ [];
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./assets/app-shell-prepaint.css",
  "./assets/location-code.js",
  "./assets/bunch-note.js",
  "./assets/bunch-queue-shell.js",
  "./assets/sales-workspace.js",
  "./assets/mobile-workspace.js",
  "./assets/navigation-preferences.js",
  "./assets/user-access-control.js",
  "./assets/bunch-note.css",
  "./assets/bunch-queue.css",
  "./assets/bunch-note-cards.css",
  "./assets/sales-workspace.css",
  "./assets/mobile-workspace.css",
  "./assets/navigation-preferences.css",
  "./assets/user-access-control.css",
  "./assets/theme-tokens.css",
  "./assets/live-tailwind-v2026082010.min.css",
  "./assets/vendor/phosphor/regular/style.css",
  "./assets/vendor/phosphor/bold/style.css",
  "./assets/vendor/phosphor/duotone/style.css",
  "./assets/vendor/phosphor/fill/style.css",
  "./assets/vendor/phosphor/light/style.css",
  "./assets/app-lifecycle.js",
  "./assets/app-shell-style-01.css",
  "./assets/app-shell-style-02.css",
  "./assets/app-shell-style-03.css",
  "./assets/app-shell-style-04.css",
  "./assets/app-shell-style-05.css",
  "./assets/app-shell-style-06.css",
  "./assets/app-shell-style-07.css",
  "./assets/app-shell-style-08.css",
  "./assets/app-shell-style-09.css",
  "./assets/ops-precision-pilot.css",
  "./assets/production-schedule.css",
  "./assets/app-shell-style-10.css",
  "./assets/app-shell-style-11.css",
  "./assets/app-shell-style-12.css",
  "./assets/app-shell-style-13.css",
  "./assets/app-shell-style-14.css",
  "./assets/app-styles.css",
  "./assets/app-shell-style-15.css",
  "./assets/app-shell-style-16.css",
  "./assets/vendor/supabase-browser-2.112.3.min.js",
  "./assets/drive-demand-detail.js",
  "./assets/inventory-list-contract.js",
  "./assets/inventory-card-window.js",
  "./assets/queue-inventory-hydration.js",
  "./assets/login-network-trace.js",
  "./assets/agdata-kernel.js",
  "./assets/runtime-watchdog.js",
  "./assets/live-sync-registry.js",
  "./assets/manager-source-live-events.js",
  "./assets/customer-mapping-live-events.js",
  "./assets/live-sync-adapters.js",
  "./assets/live-sync-coordinator.js",
  "./assets/av-derived-rows.js",
  "./assets/bounded-snapshot-cache.js",
  "./assets/stable-view-dom.js",
  "./assets/company-directory-cache.js",
  "./assets/manager-table-management.js",
  "./assets/queue-completion-state.js",
  "./assets/request-submission.js",
  "./assets/ops-precision-pilot.js",
  "./assets/production-schedule.js",
  "./assets/eval-reports-engine.js",
  "./assets/report-pages-live.js",
  "./assets/photo-history-v2026090401.js",
  "./assets/runtime-watchdog-panel.js",
  "./assets/bloom-runtime-functions.js",
    "./assets/row-workflow-functions.js",
  "./assets/app-runtime.js"
];
const SHELL_INSTALL_RECEIPT = './__agdata_shell_install_complete__';
const ASSETS_TO_CACHE = [
  './services/bunch-note-pdf.mjs',
  ...STATIC_ASSETS,
  './assets/app-styles.css',
  ...DEFERRED_VIEW_ASSETS,
  './assets/bunch-queue-shell.js?v=' + encodeURIComponent(APP_SHELL_BUILD),
  './assets/bunch-queue.js?v=' + encodeURIComponent(APP_SHELL_BUILD),
  './assets/bunch-queue.css?v=' + encodeURIComponent(APP_SHELL_BUILD),
  APP_SHELL_URL,
  './manifest.json',
  './assets/theme-tokens.css?v=' + encodeURIComponent(APP_SHELL_BUILD),
  './assets/ops-precision-pilot.css',
  './assets/ops-precision-pilot.js',
  './assets/production-schedule.css?v=' + encodeURIComponent(APP_SHELL_BUILD),
  './assets/production-schedule.js?v=' + encodeURIComponent(APP_SHELL_BUILD),
  './assets/eval-reports-engine.js',
  './assets/photo-history-v2026090401.js',
  './assets/drive-demand-detail.js',
  './assets/login-network-trace.js?v=' + encodeURIComponent(APP_SHELL_BUILD),
  './assets/navigation-preferences.js?v=' + encodeURIComponent(APP_SHELL_BUILD),
  './assets/live-sync-registry.js',
  './assets/live-sync-adapters.js',
  './assets/agdata-kernel.js',
  './assets/bloom-runtime-functions.js',
  './assets/app-shell-style-16.css',
  './assets/app-shell-prepaint.css',
  './assets/live-sync-coordinator.js',
  './assets/request-submission.js',
  './assets/request-sales-impact.js',
  './assets/inventory-list-contract.js',
  './assets/queue-inventory-hydration.js',
  './assets/av-derived-rows.js',
  './assets/bounded-snapshot-cache.js',
  './assets/live-tailwind-v2026082010.min.css',
  './assets/live-app-runtime-v2026082010.min.js?v=' + encodeURIComponent(APP_SHELL_BUILD),
  './assets/runtime-watchdog-panel.js',
  './assets/live-app-styles-base-v2026090503.css',
  './assets/live-app-styles-authority-v2026090503.css',
  './assets/image-optimize-worker-v2026090401.js',
  './assets/vendor/supabase-browser-2.112.3.min.js',
  './assets/vendor/fabric-6.7.1.min.mjs',
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
  ...BRANDING_CANONICAL_ASSETS
].map((asset) => {
  if (!/\.(?:css|js|mjs)(?:\?|$)/i.test(asset)) return asset;
  const revision = new URL(asset, 'https://cache.invalid/').searchParams.get('v') || '';
  const version = revision.startsWith(APP_ASSET_VERSION + '.') ? revision : APP_ASSET_VERSION;
  return asset.split('?')[0] + '?v=' + version;
});
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
    const value = typeof requestOrUrl === 'string' ? requestOrUrl : requestOrUrl && (requestOrUrl.url || requestOrUrl.href);
    return value ? new URL(value, self.location.href) : null;
  } catch (error) {
    return null;
  }
}

function isProductionShellUrl(value) {
  const url = getRequestUrl(value);
  const scope = getRequestUrl(self.registration.scope);
  if (!url || !scope || url.origin !== scope.origin) return false;
  return url.pathname === scope.pathname || url.pathname === new URL('index.html', scope).pathname;
}

function isIndependentAppUrl(value) {
  const url = getRequestUrl(value);
  const scope = getRequestUrl(self.registration.scope);
  if (!url || !scope || url.origin !== scope.origin) return false;
  const appPath = new URL('v2/', scope).pathname;
  return url.pathname === appPath.slice(0, -1) || url.pathname.startsWith(appPath);
}

function isIndependentAppRequest(request) {
  return isIndependentAppUrl(request) || Boolean(request && request.referrer && isIndependentAppUrl(request.referrer));
}

function isRetiredRootCacheName(name) {
  // Explicit release upgrade: retire all prior Cache Storage generations.
  // Authenticated snapshots and user drafts remain in their separate stores.
  return name !== CACHE_NAME && /^(?:agdata-|ag-data-v4\.3-rebuild-)/.test(name);
}

async function matchRootCache(request, options) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const current = await cache.match(request, options);
    if (current) return current;
    for (const name of (await caches.keys()).filter(name => isRetiredRootCacheName(name) && /^(?:agdata-(?:v|shell-)|ag-data-v4\.3-rebuild-)/.test(name)).reverse()) {
      const previous = await caches.open(name);
      const response = await previous.match(request, options);
      if (response) return response;
    }
    return undefined;
  } catch (error) {
    return undefined;
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
  if (!isProductionShellUrl(requestedShellUrl) || (networkResponse.url && !isProductionShellUrl(networkResponse.url))) return;
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
      const cached = (cache ? await cache.match(candidate) : null) || await matchRootCache(candidate);
      if (cached) return cached;
    } catch (error) {}
  }
  return null;
}

async function cacheShellInstallAsset(cache, asset) {
  const response = await fetchWithTimeout(asset, { cache: 'reload', credentials: 'same-origin', referrerPolicy: 'no-referrer' }, INSTALL_ASSET_TIMEOUT_MS);
  if (!response || response.status !== 200) throw new Error('SHELL_ASSET_UNAVAILABLE');
  await cache.put(asset, response);
}

async function hasCompleteShellInstall() {
  const cache = await caches.open(CACHE_NAME);
  if (!(await cache.match(SHELL_INSTALL_RECEIPT))) return false;
  const responses = await Promise.all(ASSETS_TO_CACHE.map(asset => cache.match(asset)));
  return responses.every(response => response && response.status === 200);
}

function getAbsoluteAssetUrl(asset = '') {
  try {
    return new URL(String(asset || ''), self.registration.scope).href;
  } catch (error) {
    return '';
  }
}

function getBrandingCanonicalUrl(requestOrUrl = null) {
  const requestUrl = getRequestUrl(requestOrUrl);
  const scopeUrl = getRequestUrl(self.registration.scope);
  if (!requestUrl || !scopeUrl || requestUrl.origin !== scopeUrl.origin
    || requestUrl.search || requestUrl.hash || !requestUrl.pathname.startsWith(scopeUrl.pathname)) return null;
  const relativePath = './' + requestUrl.pathname.slice(scopeUrl.pathname.length);
  const canonicalPath = BRANDING_LEGACY_ALIASES[relativePath];
  if (typeof canonicalPath !== 'string' || !canonicalPath.startsWith('./assets/branding/')) return null;
  try {
    const canonicalUrl = new URL(canonicalPath, scopeUrl);
    if (canonicalUrl.origin !== scopeUrl.origin
      || !canonicalUrl.pathname.startsWith(new URL('./assets/branding/', scopeUrl).pathname)) return null;
    return canonicalUrl;
  } catch (error) {
    return null;
  }
}

async function handleBrandingAliasRequest(canonicalUrl) {
  const cache = await caches.open(CACHE_NAME).catch(() => null);
  const cached = cache ? await cache.match(canonicalUrl.href).catch(() => null) : null;
  if (cached) return cached;
  try {
    const response = await fetch(canonicalUrl.href, { cache: 'no-store', credentials: 'same-origin' });
    if (cache && response && response.status === 200
      && (!response.url || new URL(response.url).href === canonicalUrl.href)) {
      await cache.put(canonicalUrl.href, response.clone()).catch(() => {});
    }
    return response || Response.error();
  } catch (error) {
    return Response.error();
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
  if (isIndependentAppRequest(request)) return false;
  const requestUrl = getRequestUrl(request);
  if (!requestUrl) return false;
  if (requestUrl.origin !== self.location.origin) return isPrecachedRuntimeAssetUrl(requestUrl);
  if (/\/index\.html$/i.test(requestUrl.pathname)) return false;
  return RUNTIME_CACHE_EXTENSION_REGEX.test(requestUrl.pathname);
}

function shouldBypassServiceWorkerCache(request) {
  const requestUrl = getRequestUrl(request);
  if (!requestUrl) return true;
  if (isIndependentAppRequest(request)) return true;
  // AURA is loaded only after a verified authorized session. Never persist its modules
  // in the shared origin's service-worker cache on devices with multiple users.
  if (/\/(?:services\/(?:auraVoiceService|auraConversation)|utils\/(?:auraIntentParser|auraLingo)|components\/common\/(?:auraVoiceWidget|auraQueryPanel))\.js$/i.test(requestUrl.pathname)) return true;
  if (/\/assets\/aura-voice\.js$/i.test(requestUrl.pathname)) return true;
  if (/\/assets\/alpha-command-center\.(?:js|css)$/i.test(requestUrl.pathname)) return true;
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

function normalizeStoragePhotoRequest(request) {
  const url = new URL(request.url);
  if (!/\/storage\/v1\/(?:render\/image|object)\/public\//i.test(url.pathname)) return request;
  url.pathname = url.pathname.replace(/\/storage\/v1\/render\/image\/public\//, '/storage/v1/object/public/');
  ['width', 'height', 'resize', 'quality', 'format'].forEach(key => url.searchParams.delete(key));
  return new Request(url.href, { method: 'GET', mode: request.mode, credentials: 'omit', referrerPolicy: 'no-referrer' });
}
async function handleRuntimeImageRequest(event) {
  const request = normalizeStoragePhotoRequest(event.request);
  if (shouldBypassServiceWorkerCache(request)) return fetch(request);
  const imageCache = await caches.open(IMAGE_CACHE_NAME).catch(() => null);
  const cachedResponse = imageCache ? await imageCache.match(request, { ignoreVary: true }).catch(() => null) : null;
  const response = cachedResponse || await fetch(request).catch(() => null);
  if (response && (response.ok || response.type === 'opaque')) {
    const copy = response.clone();
    // Serialize metadata/touches so overlapping photos cannot lose LRU updates or exceed the cap.
    runtimeImageCacheQueue = runtimeImageCacheQueue.catch(() => {}).then(async () => {
      const cache = await caches.open(IMAGE_CACHE_NAME);
      const metadata = await readImageCacheMetadata();
      const contentLength = Number(response.headers.get('content-length') || 0);
      metadata.entries[request.url] = { cachedAt: Date.now(), size: contentLength || (response.type === 'opaque' ? OPAQUE_IMAGE_ESTIMATED_BYTES : 0) };
      if (!cachedResponse) await cache.put(request, copy);
      await pruneRuntimeImageCache(cache, metadata);
    }).catch(() => {});
    event.waitUntil(runtimeImageCacheQueue);
  }
  return response || matchRootCache(request).then(fallback => fallback || Response.error());
}

async function readWindowShellBuild(client) {
  const fromUrl = getRequestedShellBuild(client.url);
  if (typeof MessageChannel !== 'function') return fromUrl;
  // New pages can prove their actual build even at an unversioned installed-app URL.
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const finish = build => { clearTimeout(timer); channel.port1.close(); resolve(build || fromUrl); };
    const timer = setTimeout(() => finish(fromUrl), 200);
    channel.port1.onmessage = event => finish(typeof event.data?.build === 'string' ? event.data.build : '');
    try { client.postMessage({type:'AGDATA_SW_CLIENT_VERSION'}, [channel.port2]); }
    catch { finish(fromUrl); }
  });
}

async function broadcastShellVersion(type = 'GNC_SHELL_VERSION') {
  const windows = await self.clients.matchAll({type:'window', includeUncontrolled:true});
  await Promise.all(windows.filter(client => isProductionShellUrl(client.url)).map(async client => {
    const build = await readWindowShellBuild(client);
    if (type === 'GNC_SHELL_ACTIVATED' && build !== APP_SHELL_BUILD) {
      // A navigation's fetch can wait for activation. Start it here and let activation finish.
      void navigateClientToForcedUpgrade(client, build);
      return;
    }
    try { client.postMessage({type, build:APP_SHELL_BUILD, version:APP_SHELL_BUILD, shellUrl:APP_SHELL_URL}); } catch {}
  }));
}

async function navigateInactiveClientToCurrentShell(clientId = '', reason = 'inactive-shell-update') {
  const safeClientId = String(clientId || '').trim();
  if (!safeClientId) return false;
  try {
    const client = await self.clients.get(safeClientId);
    if (!client || typeof client.postMessage !== 'function') return false;
    if (client.visibilityState !== 'hidden' && client.focused !== false) return false;
    const clientUrl = getRequestUrl(client.url);
    if (!isProductionShellUrl(clientUrl)) return false;
    if (clientUrl && clientUrl.searchParams.get('shellr') === APP_SHELL_RUNTIME_REVISION) return false;
    if (clientUrl.searchParams.get(APP_SHELL_QUERY_PARAM) === APP_SHELL_BUILD) return false;
    client.postMessage({ type: 'GNC_SHELL_VERSION', build: APP_SHELL_BUILD });
    return true;
  } catch (error) {
    return false;
  }
}

async function navigateClientToForcedUpgrade(client, reportedBuild = '') {
  if (!client || !isProductionShellUrl(client.url)) return false;
  const build = reportedBuild || getRequestedShellBuild(client.url);
  const remoteVersion = APP_SHELL_BUILD;
  const localVersion = build;
  if (!(remoteVersion !== localVersion)) return false;
  // Activation follows the complete install receipt. Legacy clients may ignore messages.
  try { client.postMessage({ type: 'GNC_SHELL_VERSION', build: APP_SHELL_BUILD, version: APP_SHELL_BUILD, shellUrl: APP_SHELL_URL }); return true; } catch { return false; }
}

async function navigateInactiveClientsToCurrentShell(reason = 'inactive-shell-update') {
  try {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await Promise.all(clientList.map((client) => (
      client && isProductionShellUrl(client.url) && (client.visibilityState === 'hidden' || client.focused === false)
        ? navigateInactiveClientToCurrentShell(client.id, reason)
        : Promise.resolve(false)
    )));
  } catch (error) {}
}

function buildAbsoluteShellUrl(build = APP_SHELL_BUILD, reason = '', forceUpgrade = false) {
  const shellUrl = new URL(buildShellUrl(build), self.registration.scope);
  shellUrl.searchParams.set('shellr', APP_SHELL_RUNTIME_REVISION);
  shellUrl.searchParams.set('shellts', String(Date.now()));
  if (reason) shellUrl.searchParams.set('shellreason', String(reason || '').slice(0, 48));
  if (forceUpgrade) { shellUrl.searchParams.set('forceupgrade', APP_ASSET_VERSION); shellUrl.searchParams.set('v', APP_ASSET_VERSION); }
  return shellUrl.href;
}

const cameraCaptureClients = new Map();
const cameraCaptureBlocked = () => Array.from(cameraCaptureClients.values()).some(until => until > Date.now());
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.all(ASSETS_TO_CACHE.map(asset => cacheShellInstallAsset(cache, asset)));
      await cache.put(SHELL_INSTALL_RECEIPT, new Response(APP_SHELL_BUILD, { status: 200 }));
      await self.skipWaiting();
    })
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (!await hasCompleteShellInstall()) return;
    const keys = await caches.keys();
    await Promise.all(keys.filter(isRetiredRootCacheName).map(key => caches.delete(key)));
    const preload = self.registration.navigationPreload;
    return Promise.resolve(preload?.disable?.()).catch(() => {})
      .then(() => self.clients.claim())
      .then(() => broadcastShellVersion('GNC_SHELL_ACTIVATED'));
  })());
});
self.addEventListener('message', (event) => {
  const data = event && event.data ? event.data : {};
  if (!data || typeof data !== 'object') return;
  if (!event.source || !isProductionShellUrl(event.source.url)) return;
  if (data.type === 'GNC_TAKE_SUSPEND_ACTION') { consumeSuspendNotificationAction(event); return; }
  if (data.type === 'GNC_GET_SHELL_VERSION' && data.version && data.version !== APP_SHELL_BUILD
      && /^AgData v\d+\.\d+\.\d+$/.test(String(data.version))) {
    event.waitUntil(hasCompleteShellInstall().then(complete => complete && navigateClientToForcedUpgrade(event.source, data.version)));
  }
  if (data.type === 'CAMERA_CAPTURE_STATE' && event.source?.id) {
    cameraCaptureClients.set(event.source.id,data.active === true ? Math.min(Number(data.until)||0,Date.now()+30*60_000) : 0);
    return;
  }
  if (data.type === 'SKIP_WAITING') {
    if (cameraCaptureBlocked()) return;
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
function releaseDescriptorUrl(request) {
  const url = getRequestUrl(request);
  if (!url || url.origin !== self.location.origin) return '';
  const scope = new URL(self.registration.scope);
  if (!['version.json','deployment.json','deployment-fingerprint.json'].some(file => url.pathname === scope.pathname + file)) return '';
  return url.origin + url.pathname;
}

async function fetchCurrentShellResource(request, descriptor) {
  let response;
  try {
    response = await fetchWithTimeout(request, {cache:'no-store', credentials:'same-origin'},1500);
    if (!response.ok) throw new Error('SHELL_NETWORK_UNAVAILABLE');
  } catch {
    const cache = await caches.open(CACHE_NAME).catch(() => null);
    const saved = descriptor ? await cache?.match(descriptor) : await getCachedShellFallback(cache, APP_SHELL_URL, request);
    return saved || Response.error();
  }
  if (response.status === 200) {
    try {
      const cache = await caches.open(CACHE_NAME);
      if (!descriptor) await cacheShellResponse(cache, APP_SHELL_URL, response);
      else if (!response.url || releaseDescriptorUrl(response.url) === descriptor) await cache.put(descriptor, response.clone());
    } catch { /* A storage failure must still deliver the network response. */ }
  }
  return response;
}

function handleProductionFetch(event) {
  if (isIndependentAppRequest(event.request)) return;
  // A root registration may temporarily control /v2 before its own worker installs.
  // It must never answer another document navigation with the production shell.
  const descriptor = releaseDescriptorUrl(event.request);
  if (event.request.mode === 'navigate' && !descriptor && !isProductionShellUrl(event.request)) return;
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) {
    if (event.clientId) event.waitUntil(navigateInactiveClientToCurrentShell(event.clientId, 'inactive-network-activity'));
    return;
  }
  if (shouldBypassServiceWorkerCache(event.request)) return;
  if (isProductionShellUrl(event.request) || descriptor) {
    event.respondWith(fetchCurrentShellResource(event.request, descriptor));
    return;
  }
  const brandingCanonicalUrl = getBrandingCanonicalUrl(event.request);
  if (brandingCanonicalUrl) {
    event.respondWith(handleBrandingAliasRequest(brandingCanonicalUrl));
    return;
  }
  if (isRuntimeImageRequest(event.request)) {
    event.respondWith(handleRuntimeImageRequest(event));
    return;
  }
  const requestUrl = getRequestUrl(event.request);
  if (isPrecachedRuntimeAssetUrl(requestUrl) || (requestUrl && requestUrl.origin === self.location.origin && CONTENT_VERSION_REGEX.test(requestUrl.pathname))) {
    event.respondWith(
      matchRootCache(event.request).then(async (cached) => {
        try { const response = await fetchWithTimeout(event.request,{},1500);
          if (!response.ok) throw new Error('ASSET_NETWORK_UNAVAILABLE');
        if (shouldRuntimeCacheRequest(event.request, response)) {
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone())).catch(() => {}));
        }
        return response;
        } catch (_) { return cached || Response.error(); }
      })
    );
    return;
  }
  event.respondWith(
    matchRootCache(event.request).then((cachedResponse) => {
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
      return networkRequest.catch(() => matchRootCache(event.request));
    })
  );
}

self.addEventListener('fetch', (event) => {
  if (isIndependentAppRequest(event.request)) return;
  if (event.request.mode === 'navigate' || event.request.method !== 'GET') {
    handleProductionFetch(event);
    return;
  }
  if (shouldBypassServiceWorkerCache(event.request)) return;
  // Referrer policy can hide /v2 behind an origin-only referrer. Resolve the
  // actual client before starting any root cache reads/writes for its resources.
  event.respondWith((async () => {
    if (event.clientId) {
      try {
        const client = await self.clients.get(event.clientId);
        if (!client || !isProductionShellUrl(client.url)) return fetch(event.request);
      } catch (error) {
        return fetch(event.request);
      }
    }
    let response;
    handleProductionFetch({
      request: event.request,
      clientId: event.clientId,
      preloadResponse: event.preloadResponse,
      waitUntil: promise => event.waitUntil(promise),
      respondWith: promise => { response = promise; }
    });
    return response || fetch(event.request);
  })());
});

self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try { data = event.data.json(); } catch (error) { data = { title: 'Ag Data Message', body: event.data.text() }; }
  }
  const assignedItemsNotice = data.homeTab === 'assigned-items-export';
  const title = assignedItemsNotice ? 'New Unassigned Item Code(s)' : data.title || 'Ag Data Message';
  const requestedIcon = data.icon ? new URL(data.icon, self.registration.scope) : null;
  const iconUrl = (requestedIcon
    ? (getBrandingCanonicalUrl(requestedIcon) || requestedIcon)
    : new URL('./assets/branding/ag-data-solutions-icon-v2026080925-192.png', self.registration.scope)).href;
  const requestedTarget = getRequestUrl(data.url || APP_SHELL_URL);
  if (assignedItemsNotice && requestedTarget) requestedTarget.searchParams.set('assignedItems', 'unassigned');
  const targetUrl = isProductionShellUrl(requestedTarget) ? requestedTarget.href : getAbsoluteAssetUrl(APP_SHELL_URL);
  const options = {
    body: assignedItemsNotice ? `${data.body || 'Unassigned item codes need review.'}${String(data.body || '').includes('Review Managers') ? '' : ' Review Managers → Assigned Items.'}` : data.body || 'You have a new message.',
    icon: iconUrl,
    badge: iconUrl,
    data: { url: targetUrl, viewId: assignedItemsNotice ? 'managers' : data.viewId || 'request', homeTab: assignedItemsNotice ? 'assigned-items-export' : data.homeTab || '', approvalId: data.approvalId || '', taskView: data.taskView || '', folderName: data.folderName || '', conversationId: data.conversationId || '', messageId: data.messageId || '', channelId: data.channelId || '', callId: data.callId || '', calendarEventId: data.calendarEventId || '' },
    actions: data.viewId === 'suspend-tag-approval' && /^[0-9a-f-]{36}$/i.test(data.approvalId || '')
      ? [{ action: 'approve', title: 'Approve' }, { action: 'deny', title: 'Deny' }] : [],
    vibrate: [200, 100, 200],
    silent: false,
    requireInteraction: true,
    timestamp: Date.now(),
    tag: assignedItemsNotice ? 'gnc-unassigned-itemcodes-summary' : data.tag || 'ag-data-alert',
    renotify: !assignedItemsNotice
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const payload = event.notification && event.notification.data ? event.notification.data : {};
  const requestedTarget = getRequestUrl(payload.url || APP_SHELL_URL);
  const targetUrl = isProductionShellUrl(requestedTarget) ? requestedTarget.href : getAbsoluteAssetUrl(APP_SHELL_URL);
  const targetView = payload.viewId || 'request';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      if (targetView === 'suspend-tag-approval' && /^[0-9a-f-]{36}$/i.test(payload.approvalId || '') && ['approve','deny'].includes(event.action)) {
        const cache = await caches.open('gnc-suspend-notification-actions');
        await cache.put(new URL('./__suspend_action/' + payload.approvalId, self.registration.scope).href,
          new Response(JSON.stringify({ decision: event.action, expiresAt: Date.now() + 10 * 60 * 1000 })));
      }
      for (const client of clientList) {
        if (isProductionShellUrl(client.url) && 'focus' in client) {
          await client.focus();
          try { client.postMessage({ type: 'GNC_OPEN_VIEW', viewId: targetView, homeTab: payload.homeTab || '', approvalId: payload.approvalId || '', taskView: payload.taskView || '', folderName: payload.folderName || '', conversationId: payload.conversationId || '', messageId: payload.messageId || '', channelId: payload.channelId || '', callId: payload.callId || '', calendarEventId: payload.calendarEventId || '' }); } catch (error) {}
          return client;
        }
      }
      if (clients.openWindow) {
        const opened = await clients.openWindow(targetUrl);
        if (opened) {
          try { opened.postMessage({ type: 'GNC_OPEN_VIEW', viewId: targetView, homeTab: payload.homeTab || '', approvalId: payload.approvalId || '', taskView: payload.taskView || '', folderName: payload.folderName || '', conversationId: payload.conversationId || '', messageId: payload.messageId || '', channelId: payload.channelId || '', callId: payload.callId || '', calendarEventId: payload.calendarEventId || '' }); } catch (error) {}
        }
        return opened;
      }
      return null;
    })
  );
});

// A URL can open a review, but only a real notificationclick creates an action.
// Consume once through a same-origin app client; never store auth credentials.
function consumeSuspendNotificationAction(event) {
  if (event.data?.type !== 'GNC_TAKE_SUSPEND_ACTION' || !event.ports?.[0]) return;
  event.waitUntil((async () => {
    let decision = '';
    const client = event.source?.id ? await clients.get(event.source.id) : null;
    const id = String(event.data.approvalId || '');
    if (client && isProductionShellUrl(client.url) && /^[0-9a-f-]{36}$/i.test(id)) {
      const cache = await caches.open('gnc-suspend-notification-actions');
      const key = new URL('./__suspend_action/' + id, self.registration.scope).href;
      const response = await cache.match(key);
      if (response) {
        await cache.delete(key);
        const saved = await response.json();
        if (saved.expiresAt > Date.now() && ['approve','deny'].includes(saved.decision)) decision = saved.decision;
      }
    }
    event.ports[0].postMessage({ decision });
  })());
}

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => Promise.all(clientList.map((client) => {
      if (!client || !isProductionShellUrl(client.url)) return Promise.resolve();
      try { return client.postMessage({ type: 'GNC_RESUBSCRIBE_PUSH' }); } catch (error) { return Promise.resolve(); }
    })))
  );
});
