import assert from 'node:assert/strict';
import vm from 'node:vm';

function createWorkerCacheFixture(state, build) {
  async function match() {
    return state.installed ? { status: 200, text: async () => build } : undefined;
  }
  return {
    open: async () => ({ match }),
    keys: async () => ['agdata-v2.3.97', 'agdata-photo-cache-v1'],
    delete: async key => { state.retired.push(key); return true; },
  };
}

function makeWorkerFixture(read, worker) {
  const build = worker.match(/const APP_SHELL_BUILD = '([^']+)'/)?.[1];
  const state = { clients: [], messages: [], retired: [], claims: 0, navigation: 0, installed: true };
  const listeners = new Map();
  const shellUrl = 'https://agmetricapp.com/';
  const registration = { scope: shellUrl, navigationPreload: { disable: async () => {} } };
  const clients = { claim: async () => { state.claims += 1; }, matchAll: async () => state.clients };
  const self = { addEventListener: (type, handler) => listeners.set(type, handler),
    location: new URL('sw.js', shellUrl), registration, clients };
  const context = vm.createContext({ Promise, URL, self, caches: createWorkerCacheFixture(state, build) });
  context.importScripts = path => vm.runInContext(read(path.slice(2).split('?')[0]), context);
  vm.runInContext(worker, context, { filename: 'sw.js' });
  state.clients.push({ url: shellUrl + '?shellv=AgData+v2.3.97',
    navigate: () => { state.navigation += 1; return new Promise(() => {}); },
    postMessage: message => state.messages.push(message),
  });
  return { state, listeners, build };
}

export async function workerActivationContract(read) {
  const worker = read('sw.js');
  const { state, listeners, build } = makeWorkerFixture(read, worker);
  const listener = listeners.get('activate');
  assert.equal(typeof listener, 'function');
  let work;
  const event = { waitUntil: promise => { work = promise; } };
  state.installed = false;
  listener(event);
  assert.equal(await work, false);
  assert.equal(state.claims, 0);
  state.installed = true;
  listener(event);
  let deadline;
  const timeout = new Promise(resolve => { deadline = setTimeout(() => resolve(false), 100); });
  const completed = await Promise.race([work.then(() => true), timeout]).finally(() => clearTimeout(deadline));
  assert.equal(completed, true);
  assert.equal(state.navigation, 0);
  assert.equal(state.claims, 1);
  assert.equal(state.messages[0]?.type, 'GNC_SHELL_VERSION');
  assert.equal(state.messages[0]?.build, build);
  assert.deepEqual(state.retired, [], 'active production tabs retain their old versioned assets');
  state.clients = [];
  listener(event);
  await work;
  assert.deepEqual(state.retired, ['agdata-v2.3.97'], 'old caches retire after production tabs close');
  assert.match(worker, /navigateInactiveClientToCurrentShell\(event\.clientId, 'inactive-network-activity'\)/);
}
