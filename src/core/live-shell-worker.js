'use strict';
{
async function fetchWithTimeout(request, options = {}, timeoutMs = INSTALL_ASSET_TIMEOUT_MS, verify = response => response) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      // Reject independently of AbortController: a stalled transport may ignore abort.
      reject(Object.assign(new Error('SHELL_FETCH_TIMEOUT'), { name: 'TimeoutError' }));
      try { controller?.abort(); } catch {}
    }, Math.max(1, Number(timeoutMs) || INSTALL_ASSET_TIMEOUT_MS));
  });
  try {
    return await Promise.race([Promise.resolve().then(() => fetch(request, {
      referrerPolicy: 'no-referrer',
      ...options,
      signal: controller ? controller.signal : options.signal
    })).then(verify), timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
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
    } catch {}
  }
  return null;
}
async function shellResponseBuild(response) {
  const html = await response.clone().text();
  const release = html.match(/<meta\s+name=["']agdata-release["']\s+content=["'](\d+\.\d+\.\d+)["']/i)?.[1];
  return release ? 'AgData v' + release : '';
}

async function cacheShellInstallAsset(cache, asset, timeoutMs) {
  await fetchWithTimeout(asset, { cache: 'reload', credentials: 'same-origin' }, timeoutMs, async candidate => {
    if (candidate?.status !== 200) throw new Error('SHELL_ASSET_UNAVAILABLE');
    if (asset === APP_SHELL_URL && await shellResponseBuild(candidate) !== APP_SHELL_BUILD) {
      throw new Error('SHELL_INSTALL_VERSION_MISMATCH');
    }
    await cache.put(asset, candidate);
  });
}

async function fillShellInstallLane(cache, state) {
  while (state.next < state.pending.length && !state.failure) {
    const asset = state.pending[state.next++];
    const remaining = state.deadline - Date.now();
    if (remaining <= 0) {
      state.failure = new Error('SHELL_INSTALL_DEADLINE');
      return;
    }
    try { await cacheShellInstallAsset(cache, asset, Math.min(30_000, remaining)); }
    catch (error) { state.failure ||= error; }
  }
}

async function installCurrentShell() {
  const cache = await caches.open(CACHE_NAME);
  const pending = [...new Set([APP_SHELL_URL, ...ASSETS_TO_CACHE])];
  const state = { pending, next: 0, deadline: Date.now() + 90_000, failure: null };
  await Promise.all(Array.from({ length: Math.min(6, pending.length) }, () => fillShellInstallLane(cache, state)));
  if (state.failure) throw state.failure;
  await cache.put(SHELL_INSTALL_RECEIPT, new Response(APP_SHELL_BUILD, { status: 200 }));
  const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (!tabs.some(tab => isProductionShellUrl(tab.url))) await self.skipWaiting();
}
function releaseDescriptorUrl(request) {
  const url = getRequestUrl(request);
  if (!url || url.origin !== self.location.origin) return '';
  const scope = new URL(self.registration.scope);
  if (!['version.json','sw.js','deployment.json','deployment-fingerprint.json'].some(file => url.pathname === scope.pathname + file)) return '';
  return url.origin + url.pathname;
}

async function fetchCurrentShellResource(request, descriptor, event) {
  const url = getRequestUrl(request);
  const verification = url?.searchParams.get('verify');
  const explicitBuild = verification ? 'AgData v' + verification
    : url?.searchParams.has('_reload') ? getRequestedShellBuild(request) : '';
  let response;
  try {
    response = await fetchWithTimeout(request, {cache:'no-store', credentials:'same-origin'}, SHELL_FETCH_TIMEOUT_MS,
      candidate => validateShellNetworkResponse(candidate, descriptor, explicitBuild));
  } catch {
    // A reachability probe must not mistake offline HTML for a fresh origin response.
    if (verification) return Response.error();
    const cache = await caches.open(CACHE_NAME).catch(() => null);
    const saved = descriptor ? await matchRootCache(descriptor)
      : explicitBuild ? await matchRootCache(buildShellUrl(explicitBuild))
      : await getCachedShellFallback(cache, APP_SHELL_URL, request);
    return saved?.status === 200 ? saved : Response.error();
  }
  if (descriptor && response.status === 200) {
    const publicationResponse = response.clone();
    const publication = (async () => {
      const cache = await caches.open(CACHE_NAME);
      if (!publicationResponse.url || releaseDescriptorUrl(publicationResponse.url) === descriptor) await cache.put(descriptor, publicationResponse);
    })().catch(() => {});
    // Cache persistence cannot hold a successful network response hostage.
    event?.waitUntil?.(publication);
  }
  return response;
}

async function validateShellNetworkResponse(response, descriptor, expectedBuild) {
  if (response?.status !== 200) throw new Error('SHELL_NETWORK_UNAVAILABLE');
  if (descriptor) return response;
  const build = await shellResponseBuild(response);
  if (expectedBuild && build !== expectedBuild) throw new Error('SHELL_TARGET_MISMATCH');
  if (build && build.localeCompare(APP_SHELL_BUILD, undefined, {numeric:true}) < 0) {
    throw new Error('SHELL_NETWORK_DOWNGRADE');
  }
  return response;
}

async function handleShellResourceRequest(event, descriptor) {
  // Root documents and release descriptors must observe the origin on every request.
  // The bounded transport falls back to the last successfully installed offline shell.
  return fetchCurrentShellResource(event.request, descriptor, event);
}

function readWindowShellBuild(client) {
  const fallback = getRequestedShellBuild(client.url);
  if (typeof MessageChannel !== 'function') return Promise.resolve(fallback);
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const finish = release => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(release);
    };
    const timer = setTimeout(() => finish(fallback), 200);
    channel.port1.onmessage = event => {
      const build = typeof event.data?.build === 'string' ? event.data.build : '';
      finish(build || fallback);
    };
    try { client.postMessage({ type: 'AGDATA_SW_CLIENT_VERSION' }, [channel.port2]); }
    catch { finish(fallback); }
  });
}

async function broadcastShellVersion(type) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  await Promise.all(windows.filter(client => isProductionShellUrl(client.url)).map(async client => {
    const build = await readWindowShellBuild(client);
    if (type === 'GNC_SHELL_ACTIVATED' && build !== APP_SHELL_BUILD) {
      // Announce the update even if the tab missed the handshake. Only the page can apply it.
      await navigateClientToForcedUpgrade(client, build);
      return;
    }
    try { client.postMessage({ type, build: APP_SHELL_BUILD, version: APP_SHELL_BUILD, shellUrl: APP_SHELL_URL }); } catch {}
  }));
}

let retirementFlight = null;
function retireUnusedShellGenerations() {
  if (retirementFlight) return retirementFlight;
  retirementFlight = (async () => {
    if (!await hasCompleteShellInstall()) return;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const builds = await Promise.all(windows.filter(client => isProductionShellUrl(client.url)).map(readWindowShellBuild));
    if (builds.some(build => build !== APP_SHELL_BUILD)) return;
    await Promise.all((await caches.keys()).filter(isRetiredRootCacheName).map(name => caches.delete(name)));
  })().finally(() => { retirementFlight = null; });
  return retirementFlight;
}

function acceptsBannerCheckpoint(data) {
  return ['update-banner', 'update-auto'].includes(data.trigger) && data.protocol === 'agdata-update-restore-v1'
    && typeof data.snapshotId === 'string' && data.snapshotId.trim().length > 0
    && data.targetBuild === APP_SHELL_BUILD;
}

async function activateBannerCheckpoint(data, captureBlocked) {
  if (!acceptsBannerCheckpoint(data) || captureBlocked()) return false;
  if (!await hasCompleteShellInstall() || captureBlocked()) return false;
  await self.skipWaiting();
  return true;
}

async function prepareCurrentShellActivation() {
  if (!await hasCompleteShellInstall()) return false;
  // Older documents retain their versioned assets while the new worker serves them.
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }).catch(() => null);
  if (windows && !windows.some(client => isProductionShellUrl(client.url))) {
    const keys = await caches.keys();
    await Promise.all(keys.filter(isRetiredRootCacheName).map(key => caches.delete(key)));
  }
  const preload = self.registration.navigationPreload;
  await Promise.resolve(preload?.disable?.()).catch(() => {});
  return true;
}

self.GncLiveShellWorker = Object.freeze({ installCurrentShell, fetchWithTimeout, handleShellResourceRequest, acceptsBannerCheckpoint,
  releaseDescriptorUrl, broadcastShellVersion, retireUnusedShellGenerations, activateBannerCheckpoint, prepareCurrentShellActivation });
}
