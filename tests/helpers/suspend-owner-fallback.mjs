import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

export function assertSuspendOwnerFallback() {
  const state = {};
  const context = vm.createContext({
    currentUser: 'dylan_collyge', currentRole: 'ADMIN', requestScopedItemsCacheKey: 'previous',
    normalizeEvalAssignableUser: value => String(value || '').trim().toLowerCase(),
    getManagerAssignedColumnState: () => state,
    getAssignedQueueOwner: row => row.owner,
  });
  vm.runInContext(readFileSync(new URL('../../assets/request-queue-membership.js', import.meta.url), 'utf8'), context);
  const dylan = { owner: 'dc' }, megan = { owner: 'ms' };
  assert.deepEqual(context.suspendQueueRowsForOwner([dylan, megan], [dylan, megan]), [dylan]);
  assert.deepEqual(context.suspendQueueRowsForOwner([megan], [dylan, megan]), []);
  assert.equal(context.getQueueScopeFilter('suspend-tag'), 'dylan_collyge');
  assert.deepEqual(context.suspendQueueRowsForOwner([megan], [megan]), [megan]);
  assert.equal(context.getQueueScopeFilter('suspend-tag'), 'ALL');
  context.currentUser = 'megan_kelly';
  assert.deepEqual(context.suspendQueueRowsForOwner([dylan, megan], [dylan, megan]), [megan]);
  context.currentRole = 'REP';
  assert.deepEqual(context.suspendQueueRowsForOwner([dylan], [dylan]), []);
  assert.equal(context.getQueueScopeFilter('suspend-tag'), 'megan_kelly');
}

export function assertSuspendSocDisplayOwnership() {
  const inventory = [{ UNIQUE_ID: 'soc-1' }];
  const context = vm.createContext({
    actor: 'megan', allowed: true, appAccessSnapshotState: {snapshot:{dataPermissionVersion:'v1'}},
    socRawSourceRows: [], socRawSourceRowsReady: false, socInventory: [],
    suspendTagInventoryScope: '', suspendTagRawSourceRowsReady: false, suspendTagInventory: [],
    getSupabaseReadIdentityScope: () => context.actor,
    canReadSuspendQueue: () => context.allowed,
    cloneDockSourceRows: rows => [...rows], hydrateDockSourceRows: rows => rows,
  });
  vm.runInContext(readFileSync(new URL('../../assets/loaded-inventory-rows.js', import.meta.url), 'utf8'), context);
  assert.equal(context.getSuspendSocDisplayRows(), null);
  context.publishLoadedDockInventory({socData:inventory}, false);
  assert.equal(context.getSuspendSocDisplayRows()[0], inventory[0]);
  assert.equal(context.suspendTagInventoryScope, '');
  assert.equal(context.suspendTagRawSourceRowsReady, false);
  context.actor = 'dylan';
  assert.equal(context.getSuspendSocDisplayRows(), null);
  context.actor = 'megan';
  context.allowed = false;
  assert.equal(context.getSuspendSocDisplayRows(), null);
  context.allowed = true;
  context.appAccessSnapshotState.snapshot.dataPermissionVersion = 'v2';
  assert.equal(context.getSuspendSocDisplayRows(), null);
}
