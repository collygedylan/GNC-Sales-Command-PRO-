import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('        function canUseHistoricalRequests('), html.indexOf('        function canAccessView('));
function harness(profile = {}) {
  const context = vm.createContext({
    nativeAuthProfile: { id: 'rep-id', username: 'rep_a', role: 'REP', disabled_at: null, locked_until: null, must_change_password: false, ...profile },
    nativeAuthSessionActive: true, currentUser: profile.username || 'rep_a', Date, Number, String, JSON,
    historicalRequestsGeneration: 0, historicalRequestsMount: null, historicalRequestsOwner: '',
    document: { getElementById: () => null },
    window: { GncDatabase: { readHistoricalRequests: async () => ({ scope: 'own' }) } },
    getSupabaseBrowserClient: () => ({}), getNativeAuthSession: async () => ({ user: { id: profile.id || 'rep-id' } }),
  });
  vm.runInContext(source, context);
  return context;
}

test('financial navigation uses native stored roles and never grants broad manager oversight', () => {
  for (const role of ['REP', 'SALESREP', 'ADMIN', 'ADMINISTRATOR']) assert.equal(harness({ role }).canUseHistoricalRequests(), true);
  for (const role of ['Manager', 'CSR', 'ADMIN ASSISTANT', 'Foreman']) assert.equal(harness({ role }).canUseHistoricalRequests(), false);
  assert.equal(harness({ username: 'dylan_collyge', role: 'Manager' }).canUseHistoricalRequests(), true);
  assert.equal(harness({ username: 'Dylan_Collyge', role: 'Manager' }).canUseHistoricalRequests(), false);
  for (const fields of [{ disabled_at: '2026-01-01' }, { must_change_password: true }, { locked_until: '2999-01-01' }, { locked_until: 'invalid' }]) {
    assert.equal(harness(fields).canUseHistoricalRequests(), false);
  }
  const runtime = harness(); runtime.nativeAuthSessionActive = false;
  assert.equal(runtime.canUseHistoricalRequests(), false);
});

test('financial cache ownership changes for account, role, lock and password requirements', () => {
  const runtime = harness(); const initial = runtime.getHistoricalRequestsOwnerKey();
  for (const fields of [{ id: 'other-id' }, { role: 'ADMIN' }, { disabled_at: 'today' }, { locked_until: 'tomorrow' }, { must_change_password: true }]) {
    assert.notEqual(runtime.getHistoricalRequestsOwnerKey({ ...runtime.nativeAuthProfile, ...fields }), initial);
  }
});

test('financial reads reject replaced identities and cancelled responses', async () => {
  const runtime = harness();
  runtime.window.GncDatabase.readHistoricalRequests = async () => { runtime.nativeAuthProfile = { ...runtime.nativeAuthProfile, role: 'Manager' }; return { scope: 'all' }; };
  await assert.rejects(runtime.historicalRequestsTransport({ operation: 'customers' }), /account changed/);
  const cancelled = harness();
  cancelled.window.GncDatabase.readHistoricalRequests = () => assert.fail('Cancelled reads never reach the database');
  await assert.rejects(cancelled.historicalRequestsTransport({ operation: 'customers' }, { aborted: true }), /cancelled/);
  const replaced = harness(); replaced.getNativeAuthSession = async () => ({ user: { id: 'other' } });
  await assert.rejects(replaced.historicalRequestsTransport({ operation: 'customers' }), /session changed/);
});

test('new navigation keeps legacy request history separate and destroys financial memory on logout', () => {
  assert.match(html, /id="view-historical-requests"/);
  assert.match(html, /id="view-request-history"/);
  assert.match(html, /view: 'historical-requests', label: 'Historical Requests'/);
  assert.match(html, /if \(nextViewId !== 'historical-requests'\) destroyHistoricalRequestsIsland\(\)/);
  for (const match of html.matchAll(/nativeAuthProfile = null;/g)) {
    const before = html.slice(match.index - 110, match.index);
    assert.ok(before.endsWith('let ') || before.includes('destroyHistoricalRequestsIsland();'), 'profile resets clear private financial memory');
  }
});
