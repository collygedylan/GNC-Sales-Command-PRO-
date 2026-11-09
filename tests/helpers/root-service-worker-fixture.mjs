import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
const release = source.match(/const APP_ASSET_VERSION = '([^']+)'/)[1];
export const origin = 'https://agmetric-isolation.test';
export const absolute = value => new URL(typeof value === 'string' ? value : value.url, `${origin}/`).href;
export const shellResponse = (body = 'ROOT NETWORK', version = release) =>
  new Response(`<meta name="agdata-release" content="${version}">${body}`);

function fixtureCaches(calls, stores) {
  return {
    keys: async () => [...stores.keys()],
    delete: async name => { calls.deleted.push(name); return stores.delete(name); },
    match: () => { throw new Error('Global caches.match is not isolated'); },
    open: async name => {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        match: async key => entries.get(absolute(key))?.clone(),
        put: async (key, response) => { calls.put.push({ name, url: absolute(key) }); entries.set(absolute(key), response.clone()); },
        keys: async () => [...entries.keys()].map(url => ({ url })),
        delete: async key => entries.delete(absolute(key)),
      };
    },
  };
}

function fixtureClients(definitions, calls) {
  return definitions.map(definition => ({
    visibilityState: 'hidden', focused: false, ...definition,
    navigate: async url => calls.navigated.push({ id: definition.id, url }),
    postMessage: (message, ports) => {
      calls.messages.push({ id: definition.id, message });
      definition.postMessage?.(message, ports);
    },
    focus: async () => calls.focused.push(definition.id),
  }));
}

function eventDispatcher(handlers) {
  return async (name, data = {}) => {
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
  };
}

export function loadWorkerSource(context, worker = source) {
  context.importScripts = url => {
    const match = /^\.\/((?:assets\/(?:storage-request-guard|service-worker-url)|src\/core\/live-shell-worker)\.js)\?v=\d+\.\d+\.\d+$/.exec(url);
    assert.ok(match, 'only owned service-worker scripts load');
    vm.runInContext(readFileSync(new URL('../../' + match[1], import.meta.url), 'utf8'), context);
    if (match[1] === 'assets/storage-request-guard.js') context.self.AgDataStorageGuard = context.AgDataStorageGuard;
  };
  vm.runInContext(worker, context, { filename: 'sw.js' });
}

export function harness(clientDefinitions = [], workerGlobals = {}) {
  const handlers = new Map(), cacheStores = new Map();
  const calls = { deleted: [], put: [], navigated: [], messages: [], focused: [], opened: [], fetch: [], notifications: [], claims: 0, skipWaiting: 0 };
  const clients = fixtureClients(clientDefinitions, calls);
  const caches = fixtureCaches(calls, cacheStores);
  let fetchImpl = async input => new URL(absolute(input)).searchParams.has('shellv')
    ? shellResponse() : new Response('ROOT NETWORK');
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
    URL, Request, Response, AbortController, console, caches, clients: clientApi, ...workerGlobals,
    setTimeout: callback => setTimeout(callback, 0), clearTimeout,
    fetch: async (input, options) => { calls.fetch.push({ url: absolute(input), options }); return fetchImpl(input, options); },
    self: {
      location: new URL(`${origin}/sw.js`), clients: clientApi,
      registration: {
        scope: `${origin}/`, navigationPreload: { enable: async () => {}, disable: async () => {} },
        showNotification: async (title, options) => calls.notifications.push({ title, options }),
      },
      addEventListener: (name, handler) => handlers.set(name, handler),
      skipWaiting: async () => { calls.skipWaiting += 1; },
    },
  });
  loadWorkerSource(context);
  const evaluate = expression => vm.runInContext(expression, context);
  return { calls, clients, caches, cacheStores, evaluate, dispatch: eventDispatcher(handlers), setFetch: callback => { fetchImpl = callback; } };
}

export function request(path, extra = {}) {
  return { url: absolute(path), method: 'GET', mode: 'cors', destination: '', referrer: `${origin}/index.html`, ...extra };
}
