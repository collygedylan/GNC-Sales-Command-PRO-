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

async function cacheShellInstallAsset(cache, asset) {
  const response = await fetchWithTimeout(asset, { cache: 'reload', credentials: 'same-origin' }, INSTALL_ASSET_TIMEOUT_MS, async candidate => {
    if (candidate?.status !== 200) throw new Error('SHELL_ASSET_UNAVAILABLE');
    if (asset === APP_SHELL_URL && await shellResponseBuild(candidate) !== APP_SHELL_BUILD) {
      throw new Error('SHELL_INSTALL_VERSION_MISMATCH');
    }
    return candidate;
  });
  await cache.put(asset, response);
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

self.GncLiveShellWorker = Object.freeze({ cacheShellInstallAsset, fetchWithTimeout, handleShellResourceRequest, releaseDescriptorUrl });
}
