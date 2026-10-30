import { readComposedRuntimeSource } from '../scripts/composed-app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readComposedRuntimeSource();

function runtimeFunctions(names) {
  return names.map(name => {
    const start = source.indexOf(`        function ${name}(`);
    assert.notEqual(start, -1, `runtime function ${name} exists`);
    const end = source.indexOf('\n        function ', start + 10);
    return source.slice(start, end < 0 ? source.length : end);
  }).join('\n');
}

function makeRuntime({ canonicalQue = true, denied = false, profileId = 'profile-1', sessionId = profileId,
  explicitCapabilities = null, capabilityUsername = 'dylan_collyge' } = {}) {
  const currentUser = 'dylan_collyge';
  const context = vm.createContext({
    currentUser,
    currentRole: 'Admin',
    requestCapabilityState: { username: capabilityUsername, capabilities: explicitCapabilities },
    nativeAuthProfile: { id: profileId, username: currentUser, role: 'Admin', active: true, must_change_password: false },
    nativeAuthSessionActive: true,
    nativeAuthSessionUserId: sessionId,
    window: { GncUserAccessControl: { getSelfState: () => ({ denied }) } },
    getRequestCapabilityUsernameKey: value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    normalizeRoleAccessToken: value => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, ''),
    canonicalFeaturePermission: flag => flag === 'can_access_que' ? canonicalQue : null,
    getRoleAccessState: () => ({}),
    canSeeRegularRequestTabs: () => false,
    canUseInvBunchNotes: () => false,
    canSeeEvalWorkRequestTab: () => false,
    canSeeSuspendTagRequestTab: () => true,
    canSeeMovesRequestTab: () => false,
    canSeeRecountRequestTab: () => false,
    canSeeShearListRequestTab: () => false,
    isRestrictedEvalUser: () => false,
    requestSalesRepsManagerMode: false,
  });
  vm.runInContext(runtimeFunctions(['getRequestCapabilities', 'getRequestEntryCapabilities', 'normalizeRequestTabValue']), context);
  return context;
}

test('same-account verified Queue access keeps Suspend visible before capability RPC resolves', () => {
  const runtime = makeRuntime();
  assert.equal(runtime.getRequestCapabilities().canViewQueue, true);
  assert.equal(runtime.normalizeRequestTabValue('suspend-tag'), 'suspend-tag');
  const notStarted = makeRuntime({ capabilityUsername: '' });
  assert.equal(notStarted.getRequestCapabilities().canViewQueue, true, 'verified account can navigate before the RPC starts');
});

test('explicit server denial, canonical denial, revocation and account mismatch never use the Queue fallback', () => {
  const explicitDenied = makeRuntime({ explicitCapabilities: { canViewQueue: false } });
  assert.equal(explicitDenied.getRequestCapabilities().canViewQueue, false);
  assert.equal(explicitDenied.normalizeRequestTabValue('suspend-tag'), 'pending');

  const canonicalDenied = makeRuntime({ canonicalQue: false });
  assert.equal(canonicalDenied.getRequestCapabilities().canViewQueue, false);
  assert.equal(canonicalDenied.normalizeRequestTabValue('suspend-tag'), 'pending');

  const revoked = makeRuntime({ denied: true });
  assert.equal(revoked.getRequestCapabilities(), null);
  assert.equal(revoked.normalizeRequestTabValue('suspend-tag'), 'pending');

  const switched = makeRuntime({ sessionId: 'another-profile' });
  assert.equal(switched.getRequestCapabilities(), null);
  assert.equal(switched.normalizeRequestTabValue('suspend-tag'), 'pending');
  const staleAccountState = makeRuntime({ capabilityUsername: 'other_account' });
  assert.equal(staleAccountState.getRequestCapabilities(), null);
});
