import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key) };
}

export function liveUpdateFixture() {
  const timers = new Map(), navigation = [], checkpoints = [], commits = [];
  const dom = new JSDOM('');
  let nextTimer = 0;
  const state = { busy: false, current: true, commit: true, proof: '1.2.4', snapshot: true };
  const root = {
    AbortController, DOMParser: dom.window.DOMParser,
    document: { readyState: 'loading', hidden: false, body: null, addEventListener() {}, getElementById: () => null },
    navigator: { onLine: true }, addEventListener() {},
    localStorage: storage(), sessionStorage: storage(),
    __APP_SHELL_VERSION__: 'AgData v1.2.3', __AGDATA_RUNTIME_READY__: true,
    location: { href: 'https://app.test/?view=request', replace: url => navigation.push(url) },
    setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout: id => timers.delete(id),
    fetch: async () => ({ status: 200, text: async () => `<meta name="agdata-release" content="${state.proof}">` }),
    getAppUpdateBusyState: () => ({ busy: state.busy }),
    saveWorkStateBeforeAppUpdate: async options => {
      checkpoints.push(options);
      return { ok: state.snapshot, snapshotId: 'saved-work' };
    },
    isAppUpdateSnapshotCurrent: () => state.current,
    commitAppUpdateSnapshotForReload: receipt => { commits.push(receipt); return state.commit; }
  };
  const context = vm.createContext({ window: root, URL, Date, Promise });
  for (const name of ['app-lifecycle', 'live-app-update']) {
    vm.runInContext(readFileSync(new URL(`../../assets/${name}.js`, import.meta.url), 'utf8'), context);
  }
  root.GncLiveAppUpdate.runtimeReady();
  return { root, context, state, timers, navigation, checkpoints, commits,
    close: () => dom.window.close(),
    apply: async (target = '1.2.4') => {
      await root.requestLiveAppUpdate(target);
      return root.GncLiveAppUpdate.requestApply('test');
    } };
}
