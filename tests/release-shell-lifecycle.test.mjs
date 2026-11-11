// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const updater = readFileSync(new URL('../assets/live-app-update.js', import.meta.url), 'utf8');

function fixture() {
  const state = { current: true, hidden: false, busy: false, validShell: true, reloads: [], commits: 0 };
  const elements = new Map();
  let pressBanner;
  const document = { readyState: 'loading', get hidden() { return state.hidden; },
    addEventListener() {}, getElementById: id => elements.get(id) || null,
    createElement: () => ({ style: {}, setAttribute() {}, addEventListener(type,callback) { if (type === 'click') pressBanner = callback; } }),
    body: { appendChild: element => elements.set(element.id, element) } };
  const root = { document, navigator: { onLine: true }, AbortController, URL,
    __APP_SHELL_VERSION__: '1.2.3', location: { href: 'https://fixture.invalid/', replace: url => state.reloads.push(url) },
    addEventListener() {}, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1,
    withBootDeadline: promise => promise,
    fetch: async () => ({ status: state.validShell ? 200 : 503, text: async () => '<html></html>' }),
    DOMParser: class { parseFromString() { return { querySelectorAll: () => [{ getAttribute: () => '1.2.4' }] }; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    getAppUpdateBusyState: () => ({ busy: state.busy }),
    saveWorkStateBeforeAppUpdate: async () => ({ ok: true, snapshotId: 'receipt' }),
    isAppUpdateSnapshotCurrent: () => state.current,
    commitAppUpdateSnapshotForReload: () => { state.commits++; return true; },
  };
  vm.runInNewContext(updater, { window: root, AbortController, URL, console });
  root.GncLiveAppUpdate.runtimeReady();
  return { root, state, api: root.GncLiveAppUpdate, tap() { pressBanner({isTrusted:true}); return root.GncLiveAppUpdate.requestApply(); } };
}

test('a current checkpoint and verified shell allow one update navigation', async () => {
  const f = fixture();
  await f.api.request('1.2.4');
  assert.equal(await f.tap(), true);
  assert.equal(f.state.commits, 1);
  assert.equal(f.state.reloads.length, 1);
  assert.equal(new URL(f.state.reloads[0]).searchParams.get('shellv'), 'AgData v1.2.4');
  assert.equal(await f.api.requestApply('repeat'), false);
});

test('a changed snapshot, busy editor or hidden page blocks navigation', async () => {
  for (const condition of ['current', 'busy', 'hidden']) {
    const f = fixture();
    await f.api.request('1.2.4');
    f.state[condition] = condition !== 'current';
    assert.equal(await f.tap(), false, condition);
    assert.equal(f.state.commits, 0);
    assert.deepEqual(f.state.reloads, []);
  }
});

test('an unavailable shell cannot commit a snapshot or navigate', async () => {
  const f = fixture();
  await f.api.request('1.2.4');
  f.state.validShell = false;
  assert.equal(await f.tap(), false);
  assert.equal(f.state.commits, 0);
  assert.deepEqual(f.state.reloads, []);
});

test('a snapshot invalidated while checkpointing cannot navigate', async () => {
  const f = fixture();
  let finish;
  f.root.saveWorkStateBeforeAppUpdate = () => new Promise(resolve => { finish = resolve; });
  await f.api.request('1.2.4');
  const pending = f.tap();
  for (let attempt = 0; attempt < 20 && !finish; attempt++) await Promise.resolve();
  assert.ok(finish, 'the update must enter checkpointing before the race is exercised');
  f.state.current = false;
  finish({ ok: true, snapshotId: 'stale' });
  assert.equal(await pending, false);
  assert.equal(f.state.commits, 0);
  assert.deepEqual(f.state.reloads, []);
});
