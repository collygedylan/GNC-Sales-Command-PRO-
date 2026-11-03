import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
export const origin = 'https://agmetric-isolation.test';
export const absolute = value => new URL(typeof value === 'string' ? value : value.url, `${origin}/`).href;

export function harness(clientDefinitions = [], workerGlobals = {}) {
  const handlers = new Map();
  const cacheStores = new Map();
  const calls = { deleted: [], put: [], navigated: [], messages: [], focused: [], opened: [], fetch: [], notifications: [], claims: 0, skipWaiting: 0 };
  const clients = clientDefinitions.map(definition => ({
    visibilityState: 'hidden', focused: false, ...definition,
    navigate: async url => calls.navigated.push({ id: definition.id, url }),
    postMessage: (message, ports) => {
      calls.messages.push({ id: definition.id, message });
      definition.postMessage?.(message, ports);
    },
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
    URL, Request, Response, AbortController, console, caches, clients: clientApi, ...workerGlobals,
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

export function request(path, extra = {}) {
  return { url: absolute(path), method: 'GET', mode: 'cors', destination: '', referrer: `${origin}/index.html`, ...extra };
}
