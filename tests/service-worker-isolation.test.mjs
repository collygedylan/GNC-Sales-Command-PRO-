import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const origin = 'https://agmetric-isolation.test';
const absolute = value => new URL(typeof value === 'string' ? value : value.url, `${origin}/`).href;

function harness(clientDefinitions = []) {
  const handlers = new Map();
  const cacheStores = new Map();
  const calls = { deleted: [], put: [], navigated: [], messages: [], focused: [], opened: [], fetch: [], notifications: [], claims: 0, skipWaiting: 0 };
  const clients = clientDefinitions.map(definition => ({
    visibilityState: 'hidden', focused: false, ...definition,
    navigate: async url => calls.navigated.push({ id: definition.id, url }),
    postMessage: message => calls.messages.push({ id: definition.id, message }),
    focus: async () => calls.focused.push(definition.id),
  }));
  let fetchImpl = async () => new Response('ROOT NETWORK');
  const caches = {
    keys: async () => [...cacheStores.keys()],
    delete: async name => { calls.deleted.push(name); return cacheStores.delete(name); },
    // Cross-application cache lookup is always a test failure.
    match: () => { throw new Error('Global caches.match is not isolated'); },
    open: async name => {
      if (!cacheStores.has(name)) cacheStores.set(name, new Map());
      const entries = cacheStores.get(name);
      return {
        match: async key => entries.get(absolute(key))?.clone(),
        put: async (key, response) => { calls.put.push({ name, url: absolute(key) }); entries.set(absolute(key), response.clone()); },
        keys: async () => [...entries.keys()].map(url => ({ url })),
        delete: async key => entries.delete(absolute(key)),
      };
    },
  };
  const clientApi = {
    get: async id => clients.find(client => client.id === id),
    matchAll: async () => clients,
    claim: async () => { calls.claims += 1; },
    openWindow: async url => {
      calls.opened.push(url);
      return { postMessage: message => calls.messages.push({ id: 'opened', message }) };
    },
  };
  const context = vm.createContext({
    URL, Request, Response, AbortController, console, caches, clients: clientApi,
    setTimeout: callback => setTimeout(callback, 0), clearTimeout,
    fetch: async (input, options) => { calls.fetch.push({ url: absolute(input), options }); return fetchImpl(input, options); },
    self: {
      location: new URL(`${origin}/sw.js`), clients: clientApi,
      registration: {
        scope: `${origin}/`, navigationPreload: { enable: async () => {} },
        showNotification: async (title, options) => calls.notifications.push({ title, options }),
      },
      addEventListener: (name, handler) => handlers.set(name, handler),
      skipWaiting: async () => { calls.skipWaiting += 1; },
    },
  });
  vm.runInContext(source, context, { filename: 'sw.js' });
  const evaluate = expression => vm.runInContext(expression, context);
  async function dispatch(name, data = {}) {
    const pending = [];
    let response;
    let intercepted = false;
    const event = {
      ...data,
      waitUntil: promise => pending.push(Promise.resolve(promise)),
      respondWith: promise => { intercepted = true; response = Promise.resolve(promise); },
    };
    handlers.get(name)(event);
    const result = response ? await response : undefined;
    for (let index = 0; index < pending.length; index += 1) await pending[index];
    return { intercepted, response: result };
  }
  return { calls, clients, caches, cacheStores, evaluate, dispatch, setFetch: callback => { fetchImpl = callback; } };
}

function request(path, extra = {}) {
  return { url: absolute(path), method: 'GET', mode: 'cors', destination: '', referrer: `${origin}/index.html`, ...extra };
}

test('production shell ownership is exact, same-origin, and independent of query/hash', () => {
  const h = harness();
  for (const path of ['/', '/index.html', '/?shellv=old', '/index.html?app=ag-data-solutions#request']) {
    assert.equal(h.evaluate(`isProductionShellUrl(${JSON.stringify(absolute(path))})`), true, path);
  }
  for (const path of ['/v2', '/v2/', '/v2/index.html? shellv=old', '/reports/report.html', '/index.html/anything', 'https://another.test/']) {
    assert.equal(h.evaluate(`isProductionShellUrl(${JSON.stringify(absolute(path))})`), false, path);
  }
  assert.equal(h.evaluate('isProductionShellUrl(null)'), false);
});

test('activation retires only proven old root shell caches and preserves unrelated contents', async () => {
  const h = harness([{ id: 'demo', url: `${origin}/v2/` }, { id: 'root', url: `${origin}/index.html` }]);
  const current = h.evaluate('CACHE_NAME');
  const previous = 'ag-data-v4.3-rebuild-V2026.09.06.02';
  const preserved = [current, 'ag-data-runtime-images-v2', 'ag-data-runtime-image-metadata-v2', 'gnc-v2-images', 'workbox-precache-v2-v2', 'bloomscapes-demo-v1', 'unrelated-cache'];
  for (const name of [previous, ...preserved]) await (await h.caches.open(name)).put('/sentinel', new Response(name));
  await h.dispatch('activate');
  assert.deepEqual(h.calls.deleted, [previous]);
  for (const name of preserved) assert.equal(await (await (await h.caches.open(name)).match('/sentinel')).text(), name);
  assert.equal(h.calls.claims, 1);
  assert.deepEqual(h.calls.navigated.map(call => call.id), ['root']);
  assert.deepEqual(h.calls.messages.map(call => call.id), ['root']);
});

test('v2, nested app, and unrelated navigations never use root response or populate root cache', async () => {
  const h = harness();
  for (const path of ['/v2', '/v2/', '/v2/index.html?shellv=old', '/v2/orders/123', '/reports/report.html']) {
    const result = await h.dispatch('fetch', { request: request(path, { mode: 'navigate' }) });
    assert.equal(result.intercepted, false, path);
  }
  assert.equal(h.calls.fetch.length, 0);
  assert.equal(h.calls.put.length, 0);
});

test('v2 assets and requests originating from v2 bypass root caches, including POST', async () => {
  const h = harness([{ id: 'demo', url: `${origin}/v2/` }]);
  for (const req of [
    request('/v2/assets/index-12345678.js'), request('/v2/runtime-config.json'),
    request('/assets/shared.png', { referrer: `${origin}/v2/`, destination: 'image' }),
    request('https://sandbox.test/functions/v1/demo', { method: 'POST', referrer: `${origin}/v2/` }),
  ]) assert.equal((await h.dispatch('fetch', { request: req, clientId: 'demo' })).intercepted, false);
  assert.equal(h.calls.navigated.length, 0);
  assert.equal(h.calls.put.length, 0);
});

test('POST from hidden v2 with origin-only referrer cannot trigger root navigation', async () => {
  const h = harness([{ id: 'demo', url: `${origin}/v2/` }]);
  await h.dispatch('fetch', { clientId: 'demo', request: request('https://sandbox.test/functions/v1/demo', { method: 'POST', referrer: `${origin}/` }) });
  assert.equal(h.calls.navigated.length, 0);
});

test('GET from v2 with suppressed referrer cannot read or write any root cache', async () => {
  const h = harness([{ id: 'demo', url: `${origin}/v2/` }]);
  await (await h.caches.open(h.evaluate('CACHE_NAME'))).put('/assets/shared.png', new Response('CACHED ROOT'));
  const before = h.calls.put.length;
  for (const path of ['/assets/shared.png', 'https://photos.test/fixture.jpg', '/assets/ops-precision-pilot.js']) {
    const result = await h.dispatch('fetch', { clientId: 'demo', request: request(path, { referrer: `${origin}/` }) });
    assert.equal(await result.response.text(), 'ROOT NETWORK');
  }
  assert.equal(h.calls.put.length, before);
});

test('production navigation remains online and offline, without reading partner caches', async () => {
  const h = harness();
  const cache = await h.caches.open(h.evaluate('CACHE_NAME'));
  const result = await h.dispatch('fetch', { request: request('/index.html', { mode: 'navigate' }) });
  assert.equal(await result.response.text(), 'ROOT NETWORK');
  assert.equal(await (await cache.match('/index.html')).text(), 'ROOT NETWORK');
  await (await h.caches.open('partner')).put('/index.html', new Response('PARTNER POISON'));
  h.setFetch(async () => { throw new Error('offline'); });
  const offline = await h.dispatch('fetch', { request: request('/', { mode: 'navigate' }) });
  assert.equal(await offline.response.text(), 'ROOT NETWORK');
});

test('a redirected non-root document cannot poison the production shell cache', async () => {
  const h = harness();
  h.setFetch(async () => {
    const response = new Response('V2 DOCUMENT');
    Object.defineProperty(response, 'url', { value: `${origin}/v2/` });
    return response;
  });
  await h.dispatch('fetch', { request: request('/', { mode: 'navigate' }) });
  assert.equal(h.calls.put.length, 0);
});

test('root asset reads do not consume identically keyed responses from partner caches', async () => {
  const h = harness();
  await (await h.caches.open('partner')).put('/assets/ops-precision-pilot.js', new Response('PARTNER POISON'));
  const result = await h.dispatch('fetch', { request: request('/assets/ops-precision-pilot.js') });
  assert.equal(await result.response.text(), 'ROOT NETWORK');
  assert.equal(h.calls.put[1].name, h.evaluate('CACHE_NAME'));
});

test('all live-sync modules remain available offline in the root cache without crossing into v2', async () => {
  const modules = ['registry', 'adapters', 'coordinator'].map(name => `/assets/live-sync-${name}.js`);
  const h = harness([{ id: 'demo', url: `${origin}/v2/` }]);
  const cacheName = h.evaluate('CACHE_NAME');
  for (const path of modules) {
    assert.equal(h.evaluate(`isPrecachedRuntimeAssetUrl(new URL(${JSON.stringify(absolute(path))}))`), true, path);
    await (await h.caches.open('bloomscapes-demo-v1')).put(path, new Response('PARTNER POISON'));
    h.setFetch(async () => new Response(`ROOT ${path}`));
    const online = await h.dispatch('fetch', { request: request(path) });
    assert.equal(await online.response.text(), `ROOT ${path}`);
    assert.equal(await (await (await h.caches.open(cacheName)).match(path)).text(), `ROOT ${path}`);
    h.setFetch(async () => { throw new Error('offline'); });
    const offline = await h.dispatch('fetch', { request: request(path) });
    assert.equal(await offline.response.text(), `ROOT ${path}`);
    const before = h.calls.put.length;
    h.setFetch(async () => new Response('V2 NETWORK'));
    const independent = await h.dispatch('fetch', { clientId: 'demo', request: request(path, { referrer: `${origin}/` }) });
    assert.equal(await independent.response.text(), 'V2 NETWORK');
    assert.equal(h.calls.put.length, before, 'A v2 request must not populate root cache');
  }
});

test('inactive production upgrade behavior remains, but active/current and foreign clients are untouched', async () => {
  const h = harness([
    { id: 'root', url: `${origin}/index.html` },
    { id: 'active', url: `${origin}/`, focused: true, visibilityState: 'visible' },
    { id: 'current', url: `${origin}/?shellr=photo-egress-r1-scope-r1` },
    { id: 'demo', url: `${origin}/v2/?shellr=old` },
    { id: 'other', url: 'https://another.test/' },
  ]);
  for (const client of h.clients) await h.dispatch('fetch', { clientId: client.id, request: request('/write', { method: 'POST', referrer: '' }) });
  assert.deepEqual(h.calls.navigated.map(call => call.id), ['root']);
  assert.match(h.calls.navigated[0].url, /shellv=V2026\.09\.11\.05/);
  assert.match(h.calls.navigated[0].url, /shellr=photo-egress-r1-scope-r1/);
});

test('worker control messages only accept production shell clients', async () => {
  const h = harness([{ id: 'demo', url: `${origin}/v2/` }, { id: 'root', url: `${origin}/` }]);
  for (const name of ['SKIP_WAITING', 'GNC_GET_SHELL_VERSION']) {
    await h.dispatch('message', { data: { type: name }, source: h.clients[0] });
    await h.dispatch('message', { data: { type: name } });
  }
  assert.equal(h.calls.skipWaiting, 0);
  assert.equal(h.calls.messages.length, 0);
  await h.dispatch('message', { data: { type: 'SKIP_WAITING' }, source: h.clients[1] });
  await h.dispatch('message', { data: { type: 'GNC_GET_SHELL_VERSION' }, source: h.clients[1] });
  assert.equal(h.calls.skipWaiting, 1);
  assert.equal(h.calls.messages[0].id, 'root');
});

test('production notifications focus/message only root and never redirect a v2 tab', async () => {
  const h = harness([{ id: 'demo', url: `${origin}/v2/` }, { id: 'root', url: `${origin}/` }]);
  await h.dispatch('notificationclick', { notification: { close() {}, data: { viewId: 'request' } } });
  assert.deepEqual(h.calls.focused, ['root']);
  assert.deepEqual(h.calls.messages.map(call => call.id), ['root']);
  assert.equal(h.calls.opened.length, 0);
  await h.dispatch('pushsubscriptionchange');
  assert.deepEqual(h.calls.messages.map(call => call.id), ['root', 'root']);
});

test('when only v2 is open, notification opens root; foreign/demo push targets are contained', async () => {
  const h = harness([{ id: 'demo', url: `${origin}/v2/` }]);
  for (const url of [`${origin}/v2/`, 'https://another.test/']) {
    await h.dispatch('notificationclick', { notification: { close() {}, data: { url } } });
    await h.dispatch('push', { data: { json: () => ({ url, title: 'Production notification' }) } });
  }
  assert.equal(h.calls.focused.length, 0);
  assert.equal(h.calls.navigated.length, 0);
  for (const url of h.calls.opened) assert.equal(new URL(url).pathname, '/index.html');
  for (const call of h.calls.notifications) assert.equal(new URL(call.options.data.url).pathname, '/index.html');
});
