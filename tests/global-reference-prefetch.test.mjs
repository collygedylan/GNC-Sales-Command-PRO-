import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: foundation
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { requestMappingFunctions, requestMappingSetup } from './helpers/customer-mapping-fixture.mjs';

const indexSource = readComposedAppSource();
function extractFunction(name) {
  let start = indexSource.indexOf(`        function ${name}(`);
  if (start < 0) start = indexSource.indexOf(`        async function ${name}(`);
  if (start < 0) throw new Error(`Missing ${name}`);
  const tail = indexSource.slice(start), end = tail.slice(20).search(/\n        (?:async )?function /);
  if (end < 0) throw new Error(`Missing function boundary for ${name}`);
  return tail.slice(0, end + 20);
}

function fixture({ mockUserLoader = true } = {}) {
  const calls = { users: 0, reps: [], directory: 0 };
  const c = vm.createContext({
    window: { setTimeout, clearTimeout, GncDatabase: { prefetchCustomerRepOptions: (...args) => { calls.reps.push(args); return Promise.resolve([]); } } },
    setTimeout, clearTimeout, AbortController,
    APP_API_FUNCTION_URL: 'https://example.invalid',
    postAppFunctionJson: async () => ({ ok: true }),
  });
  vm.runInContext(`${requestMappingSetup}\n${requestMappingFunctions()}`, c);
  c.currentUser = 'manager';
  c.appAccessSnapshotState = { status: 'ready', stale: false, username: 'manager' };
  c.getRequestCapabilityUsernameKey = () => 'manager';
  c.getSupabaseReadIdentityScope = () => 'manager:permission-r7';
  c.canManageCustomerRepMappings = () => true;
  c.getManagersToolAccess = () => ({ canManageCompanyDirectory: false });
  c.getCompanyDirectoryState = () => ({ loaded: false, loading: false });
  c.loadCompanyDirectory = async () => { calls.directory += 1; };
  c.canAccessView = view => ['managers', 'drive'].includes(view);
  if (mockUserLoader) c.ensureDockAssignableUsers = async () => { calls.users += 1; return ['rep']; };
  return { c, calls };
}

test('startup warms only authorized, identity-scoped dropdown directories in the background', async () => {
  const { c, calls } = fixture();
  c.scheduleGlobalReferencePrefetch(0, c.getRequestModalLookupOwnerSignature());
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(calls.users, 1);
  assert.equal(calls.reps.length, 1);
  assert.equal(calls.reps[0][1], 'manager:permission-r7');
  assert.equal(calls.reps[0][2] instanceof AbortSignal, true);
});

test('the restricted Company Directory warms only for its authorized manager and only once per loaded state', async () => {
  const { c, calls } = fixture();
  c.canAccessView = () => false;
  c.canManageCustomerRepMappings = () => false;
  c.getManagersToolAccess = () => ({ canManageCompanyDirectory: true });
  c.scheduleGlobalReferencePrefetch(0, c.getRequestModalLookupOwnerSignature());
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls.directory, 1);

  c.getCompanyDirectoryState = () => ({ loaded: true, loading: false });
  c.scheduleGlobalReferencePrefetch(0, c.getRequestModalLookupOwnerSignature());
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls.directory, 1);
});

test('startup does not warm reference directories after permission denial or an identity switch', async () => {
  const denied = fixture();
  denied.c.appAccessSnapshotState = { status: 'ready', stale: false, username: 'manager' };
  denied.c.canManageCustomerRepMappings = () => false;
  denied.c.canAccessView = () => false;
  denied.c.scheduleGlobalReferencePrefetch(0, denied.c.getRequestModalLookupOwnerSignature());
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(denied.calls.users, 0);
  assert.equal(denied.calls.reps.length, 0);

  const switched = fixture();
  switched.c.scheduleGlobalReferencePrefetch(0, 'old-owner');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(switched.calls.users, 0);
  assert.equal(switched.calls.reps.length, 0);
});

test('the shared assignable-user cache is discarded when the authenticated read scope changes', async () => {
  const { c } = fixture({ mockUserLoader: false });
  let scope = 'user-a:permission-1';
  const reads = [];
  c.getSupabaseReadIdentityScope = () => scope;
  c.dockAssignableUsers = [];
  c.dockAssignableUsersPromise = null;
  c.dockAssignableUsersScope = '';
  c.shouldUseProductionLiveSyncSideLoad = () => false;
  c.isDockAssignableRoleValue = role => role === 'REP';
  c.updateDockAssignableTeamOptions = () => {};
  c.supabaseFetch = async () => {
    reads.push(scope);
    return [{ username: `rep-${reads.length}`, role: 'REP' }];
  };

  assert.deepEqual(Array.from(await c.ensureDockAssignableUsers()), ['rep-1']);
  scope = 'user-b:permission-2';
  assert.deepEqual(Array.from(await c.ensureDockAssignableUsers()), ['rep-2']);
  assert.deepEqual(reads, ['user-a:permission-1', 'user-b:permission-2']);
});

test('assignable-user refresh preserves transient fallback but clears rows after access denial', async () => {
  const { c } = fixture({ mockUserLoader: false });
  c.dockAssignableUsers = [];
  c.dockAssignableUsersPromise = null;
  c.dockAssignableUsersScope = '';
  c.shouldUseProductionLiveSyncSideLoad = () => false;
  c.isDockAssignableRoleValue = role => role === 'REP';
  c.isSupabaseReadTerminalDenial = error => [401, 403].includes(Number(error.status)) || error.code === '42501';
  c.updateDockAssignableTeamOptions = () => {};
  c.supabaseFetch = async () => [{ username: 'rep-a', role: 'REP' }];
  assert.deepEqual(Array.from(await c.ensureDockAssignableUsers()), ['rep-a']);
  c.supabaseFetch = async () => { throw Object.assign(new Error('Temporarily unavailable'), { status: 503 }); };
  assert.deepEqual(Array.from(await c.ensureDockAssignableUsers(true)), ['rep-a']);
  c.supabaseFetch = async () => { throw Object.assign(new Error('Permission denied'), { status: 403 }); };
  assert.deepEqual(Array.from(await c.ensureDockAssignableUsers(true)), []);
  assert.deepEqual(Array.from(c.dockAssignableUsers), []);
});

test('user options discard prior-scope directories while preserving same-scope transient fallback', async () => {
  const { c } = fixture({ mockUserLoader: false });
  c.FLYER_ASSIGNABLE_USER_FALLBACK = [{ username: 'static_user', display: 'Static User' }];
  c.flyerAssignableUsers = [{ username: 'old_flyer_user', display: 'Old Flyer User' }];
  c.assignableAppUsers = [{ username: 'old_scope_user', display: 'Old Scope User', role: 'REP' }];
  c.assignableAppUsersLoaded = true;
  c.assignableAppUsersPromise = Promise.resolve([]);
  c.flyerAssignableUsersPromise = Promise.resolve([]);
  c.dockAssignableUsers = ['old_dock_user'];
  c.normalizePushUsername = value => String(value || '').trim().toLowerCase();
  c.normalizeAssignableAppUserEntry = row => row && typeof row === 'object' ? row : null;
  c.normalizeFlyerAssignableUserEntry = row => row && typeof row === 'object' ? row : null;
  c.addAssignableAppUserOption = (map, username, display, role = '') => {
    const normalized = c.normalizePushUsername(username || display);
    if (normalized) map.set(normalized, { username: normalized, display: String(display || username || normalized), role });
  };
  c.addFlyerAssignableUserOption = (map, username, display) => {
    const normalized = c.normalizePushUsername(username || display);
    if (normalized) map.set(normalized, { username: normalized, display: String(display || username || normalized) });
  };
  c.getFlyerAssigneeList = () => [];
  c.shouldUseProductionLiveSyncSideLoad = () => false;
  c.isSupabaseReadTerminalDenial = error => [401, 403].includes(Number(error.status)) || error.code === '42501';
  let scope = 'old-scope';
  c.getSupabaseReadIdentityScope = () => scope;
  c.assignableUserDirectoryGeneration = 0;
  c.currentUser = ''; c.currentUserDisplay = ''; c.currentRole = ''; c.safeRole = '';
  vm.runInContext([
    extractFunction('getAssignableAppUserOptions'),
    extractFunction('resetAssignableUserDirectory'),
    extractFunction('ensureAssignableAppUsers'),
    extractFunction('ensureFlyerAssignableUsers'),
  ].join('\n'), c);

  assert.ok(Array.from(c.getAssignableAppUserOptions()).some(row => row.username === 'old_scope_user'));
  const resetSource = indexSource.slice(indexSource.indexOf('        function resetProductionLiveSync('));
  assert.match(resetSource.slice(0, resetSource.indexOf('\n        function ')), /resetAssignableUserDirectory\(\)/);
  c.resetAssignableUserDirectory();
  assert.deepEqual(Array.from(c.assignableAppUsers), []);
  assert.deepEqual(Array.from(c.flyerAssignableUsers), []);
  assert.equal(c.assignableAppUsersLoaded, false);
  assert.equal(c.assignableAppUsersPromise, null);
  assert.equal(c.flyerAssignableUsersPromise, null);
  assert.equal(Array.from(c.getAssignableAppUserOptions()).some(row => /old_(scope|flyer|dock)_user/.test(row.username)), false);

  let resolveOldRead;
  c.supabaseFetch = () => new Promise(resolve => { resolveOldRead = resolve; });
  const oldScopeRead = c.ensureAssignableAppUsers(true);
  await Promise.resolve();
  scope = 'new-scope';
  c.resetAssignableUserDirectory();
  resolveOldRead([{ username: 'late_old_scope_user', role: 'REP' }]);
  assert.deepEqual(Array.from(await oldScopeRead), []);
  assert.equal(Array.from(c.getAssignableAppUserOptions()).some(row => row.username === 'late_old_scope_user'), false);

  c.assignableAppUsers = [{ username: 'current_scope_user', display: 'Current Scope User', role: 'REP' }];
  c.assignableAppUsersLoaded = true;
  c.supabaseFetch = async () => { throw Object.assign(new Error('Temporary outage'), { status: 503 }); };
  assert.deepEqual(Array.from(await c.ensureAssignableAppUsers(true)).map(row => row.username), ['current_scope_user']);
  assert.ok(Array.from(c.getAssignableAppUserOptions()).some(row => row.username === 'current_scope_user'));

  c.supabaseFetch = async () => { throw Object.assign(new Error('Permission denied'), { status: 403 }); };
  assert.deepEqual(Array.from(await c.ensureAssignableAppUsers(true)), []);
  assert.equal(Array.from(c.getAssignableAppUserOptions()).some(row => row.username === 'current_scope_user'), false);

  c.flyerAssignableUsers = [{ username: 'current_flyer_user', display: 'Current Flyer User' }];
  c.supabaseFetch = async () => { throw Object.assign(new Error('Permission denied'), { status: 403 }); };
  assert.deepEqual(Array.from(await c.ensureFlyerAssignableUsers(true)).map(row => row.username), []);
  assert.equal(Array.from(c.flyerAssignableUsers).some(row => row.username === 'current_flyer_user'), false);
});
