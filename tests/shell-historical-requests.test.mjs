import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const html = readComposedAppSource();
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
  for (const username of ['dylan_collyge', 'rep_a']) {
    for (const role of ['Eval', 'Evaluator', 'Eval Admin']) assert.equal(harness({ username, role }).canUseHistoricalRequests(), false);
  }
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

test('Eval cannot inherit administrator privileges from usernames or role substrings', () => {
  const roles = html.slice(html.indexOf('        function normalizeRoleAccessToken('), html.indexOf('        function canUseHistoricalRequests('));
  const context = vm.createContext({ currentRole: '', safeRole: '', currentUser: 'privileged_user',
    firstNonEmptyValue: (...values) => values.find(value => value !== '' && value != null),
    isPrivilegedManagerUser: () => true, canUseRequestRepScopedAccess: () => false,
    getRequestCapabilities: () => ({ canViewQueue: true }), canSeeEvalWorkRequestTab: () => false,
    isStrictDylanCollygeUser: () => false, ROLE_ACCESS_VIEWS: ['managers', 'reports', 'request-history', 'drive'],
  });
  vm.runInContext(roles, context);
  for (const role of ['Eval', 'Evaluator', 'Eval Admin']) {
    const access = context.getRoleAccessState(role);
    assert.equal(access.isAdmin, false); assert.equal(access.isPrivilegedManager, false);
    for (const view of ['managers', 'reports', 'request-history']) assert.equal(access.allowedViews.has(view), false);
    assert.equal(access.allowedViews.has('drive'), true);
  }
  const admin = context.getRoleAccessState('Admin');
  assert.equal(admin.isAdmin, true);
  for (const view of context.ROLE_ACCESS_VIEWS) assert.equal(admin.allowedViews.has(view), true);
  context.isPrivilegedManagerUser = () => false;
  assert.equal(context.getRoleAccessState('Unknown').isAdmin, false);
  assert.equal(context.getRoleAccessState('Admin Assistant').isAdmin, false);
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

test('shared history navigation destroys private financial memory on logout and leaving either history view', () => {
  assert.match(html, /id="view-historical-requests"/);
  assert.match(html, /id="view-request-history"/);
  assert.match(html, /view: 'historical-requests', label: 'Historical Requests'/);
  assert.match(html, /if \(!\['historical-requests', 'request-history'\]\.includes\(nextViewId\)\) destroyHistoricalRequestsIsland\(\)/);
  assert.match(html, /window\.ensureHistoricalRequestsIsland = ensureHistoricalRequestsIsland/);
  const clearStart = html.indexOf('        function clearInMemorySessionIdentity(');
  const clearEnd = html.indexOf('\n        function ', clearStart + 20);
  assert.match(html.slice(clearStart, clearEnd), /destroyHistoricalRequestsIsland\(\)/,
    'shared identity cleanup destroys private financial memory');
  for (const match of html.matchAll(/nativeAuthProfile = null;/g)) {
    const before = html.slice(match.index - 110, match.index);
    const followingCleanup = html.slice(match.index + match[0].length).split(/\b(?:await|return|throw)\b|\n\s*\}/, 1)[0];
    assert.ok(before.endsWith('let ') || before.includes('destroyHistoricalRequestsIsland();')
      || followingCleanup.includes('clearInMemorySessionIdentity();'), 'profile resets synchronously clear private financial memory');
  }
});

test('actual identity cleanup destroys historical memory before other account state is reset', () => {
  const start = html.indexOf('        function clearInMemorySessionIdentity(');
  const end = html.indexOf('        const APP_SESSION_RECORD_STORAGE_KEY', start);
  const calls = [];
  const context = vm.createContext({
    destroyHistoricalRequestsIsland: () => calls.push('destroy-history'),
    resetDashboardSyncMetadataForPermissionChange: () => { calls.push('reset-other-state'); throw new Error('stop after cleanup'); },
  });
  vm.runInContext(html.slice(start, end), context);
  assert.throws(() => context.clearInMemorySessionIdentity(), /stop after cleanup/);
  assert.deepEqual(calls, ['destroy-history', 'reset-other-state']);
});
