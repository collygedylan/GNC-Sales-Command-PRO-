import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readComposedAppSource();
function appFunction(name) {
  const match = html.match(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(match, `${name} exists`);
  const next = html.slice(match.index + match[0].length).search(/\r?\n        (?:async )?function \w+\(/);
  assert.ok(next >= 0, `${name} boundary`);
  return html.slice(match.index, match.index + match[0].length + next);
}

function modalFixture({ permission = '', freshRows = null } = {}) {
  const row = { UNIQUE_ID: 'loaded-row', ITEMCODE: 'ITEM-1', LOTCODE: '27.U1', LOCATIONCODE: 'A1', PTRONHAND: '234' };
  const controls = new Map();
  const modal = { classList: { remove(value) { modal.open = value === 'hidden'; } }, querySelectorAll: () => [] };
  const inquiry = { innerHTML: '' };
  controls.set('argos-reclass-item-inquiry', inquiry);
  controls.set('argos-inventory-transaction-apply', { disabled: true });
  const frames = []; let reads = 0;
  const ctx = {
    document: { getElementById: id => controls.get(id) || null }, AbortController,
    argosInventoryTransactionState: null, argosInquiryOpenRevision: 0, argosInquiryReadController: null,
    activeDetailSourceView: '', lastView: 'drive', currentUser: 'dylan_collyge', currentUserDisplay: 'Dylan Collyge',
    getVerifiedCachedArgosItemInquiryGroup: () => null,
    getReadableCachedArgosItemInquiryGroup: () => null,
    findItemByUniqueId: () => row,
    isArgosInventoryTransactionEligible: () => true,
    isEvalReclassRowAssigned: () => true,
    canCurrentUserViewDockSuspendDcRequests: () => true,
    canCurrentUserUseDriveCardOptions: () => true,
    canCurrentUserSubmitRepInventoryOperations: () => false,
    canUseProductionLiveSync: () => true,
    needsMasterDetailHydration: () => true,
    getSupabaseReadIdentityScope: () => 'account-a',
    getCurrentVisibleViewId: () => 'drive',
    getProductionLiveSyncContext: () => ({ scope: 'account-a', dataPermissionVersion: permission }),
    clearSupabaseReadFailuresForVisibleContext() {},
    showToast: (...args) => { throw new Error(`Unexpected lockout: ${args.join(' ')}`); },
    loadArgosItemInquiryRows: async () => { reads++; if (freshRows) return { row: freshRows[0], rows: freshRows }; throw new Error('refresh offline'); },
    ensureArgosInventoryTransactionModal: () => modal,
    getArgosInventorySourceSnapshot: () => ({ uniqueId: row.UNIQUE_ID, commonName: 'Loaded plant' }),
    buildItemInquiryViewModel: (item, rows) => ({ item, locationRows: rows.map(sourceRow => ({ unique_id: sourceRow.UNIQUE_ID, sourceRow })) }),
    getItemInquiryRows: () => [row], resetArgosReclassMultiActionState() {},
    getArgosReclassLiveEditIdentityKey: () => 'account-a',
    generateArgosInventoryTransactionId: () => 'inquiry-idempotency-001',
    getDriveSearchTerm: () => '', readPendingArgosInventoryReclassMove: () => null,
    renderArgosInventoryTransactionSource: () => '', renderArgosReclassInquiryEditor: () => '<input value="234">',
    refreshArgosInventoryTransactionLotOptions() {}, refreshArgosInventoryTransactionPriorityOptions() {},
    setArgosInventoryTransactionAction() {}, setArgosInventoryTransactionHoldAction() {},
    isEvalWorkManagerUser: () => false, captureArgosInventoryTransactionDraftBaseline: () => [],
    requestAnimationFrame: callback => frames.push(callback), shouldApplyArgosItemInquiryRefresh: () => false,
  };
  vm.createContext(ctx);
  vm.runInContext(appFunction('openArgosInventoryTransactionModal'), ctx);
  return { ctx, row, modal, inquiry, controls, frames, reads: () => reads };
}

for (const permission of ['', 'stale-permission']) {
  test(`a loaded partial row immediately opens Reclass during ${permission || 'pending'} verification`, async () => {
    const f = modalFixture({ permission });
    assert.equal(f.ctx.openArgosInventoryTransactionModal('loaded-row', 'reclass', 'drive'), false);
    assert.equal(f.modal.open, true, 'opening does not wait for a network read');
    assert.match(f.inquiry.innerHTML, /234/);
    assert.equal(f.controls.get('argos-inventory-transaction-apply').disabled, false);
    assert.equal(f.reads(), 0);
    f.frames.forEach(callback => callback());
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.reads(), 1, 'exact hydration starts after paint');
    assert.equal(f.modal.open, true, 'failed background hydration retains the editor');
  });
}

test('late exact hydration cannot replace a draft or cross an account boundary', async () => {
  const fresh = [{ UNIQUE_ID: 'loaded-row', ITEMCODE: 'ITEM-1', PTRONHAND: '200' }];
  for (const accountChanged of [false, true]) {
    const f = modalFixture({ freshRows: fresh });
    f.ctx.openArgosInventoryTransactionModal('loaded-row', 'reclass', 'drive');
    const state = f.ctx.argosInventoryTransactionState;
    state.quantityDraft = 34;
    const model = state.inquiryModel;
    if (accountChanged) f.ctx.getSupabaseReadIdentityScope = () => 'account-b';
    f.frames.forEach(callback => callback());
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(state.inquiryModel, model);
    assert.equal(state.quantityDraft, 34);
    assert.match(f.inquiry.innerHTML, /234/);
  }
});

test('submission checks account ownership without waiting for cache, permission refresh or inventory hydration', async () => {
  const state = { verificationIdentityKey: 'account-a', inquiryModel: { locationRows: [] } };
  const ctx = { getArgosReclassLiveEditIdentityKey: () => 'account-a', getSupabaseReadIdentityScope: () => 'account-a',
    canUseProductionLiveSync: () => true,
    getArgosReclassVerifiedInquiryRevision: () => '',
    getVerifiedCachedArgosItemInquiryGroup: () => null,
    loadArgosItemInquiryRows: () => { throw new Error('Submission must not wait for hydration'); },
    getArgosReclassSourceRowsSignature: () => '',
  };
  vm.createContext(ctx);
  vm.runInContext(appFunction('ensureArgosReclassSubmissionVerification'), ctx);
  await ctx.ensureArgosReclassSubmissionVerification(state);
  ctx.getArgosReclassLiveEditIdentityKey = () => 'account-b';
  assert.throws(() => ctx.ensureArgosReclassSubmissionVerification(state), /access changed|original account/i);
  ctx.getArgosReclassLiveEditIdentityKey = () => 'account-a';
  ctx.canUseProductionLiveSync = () => false;
  assert.throws(() => ctx.ensureArgosReclassSubmissionVerification(state), /access changed|original account/i);
});

test('quantity commands carry displayed row identity without requiring a verified global cache', () => {
  const row = { unique_id: 'loaded-row', warehouseid: '1', itemcode: 'ITEM-1', contsize: '#3', locationcode: 'A1',
    lotcode: '27.U1', season: 'U1', ptronhand: '234', ptravailable: '234', s_lts: '234' };
  const state = { verificationIdentityKey: 'account-a', inquiryModel: { locationRows: [{ unique_id: row.unique_id, sourceRow: row }] } };
  const payload = { rowOverlays: [{ unique_id: row.unique_id,
    proposals: [{ action: 'move_up', splits: [{ destinationSeason: 'F1', quantity: 34 }] }] }] };
  const ctx = { getArgosReclassLiveEditIdentityKey: () => 'account-a', getSupabaseReadIdentityScope: () => 'account-a',
    canUseProductionLiveSync: () => true,
    getDatasetState: () => ({ liveVerifiedRevision: '', rowCompleteness: 'partial' }),
    getProductionLiveSyncContext: () => ({ scope: 'account-a', dataPermissionVersion: '' }),
    getArgosReclassVerifiedInquiryRevision: () => '', readPendingArgosInventoryReclassMove: () => null,
    generateArgosInventoryTransactionId: () => 'move-from-loaded-row', isConfirmedInventoryReadRevisionCurrent: () => false,
  };
  vm.createContext(ctx);
  vm.runInContext(appFunction('buildInventoryReclassMoveCommand'), ctx);
  const command = ctx.buildInventoryReclassMoveCommand(payload, state);
  assert.equal(command.expectedRevision, null);
  assert.equal(command.moves[0].source.identity.ptronhand, '234');
  assert.equal(command.moves[0].lines[0].quantity, 34);
  assert.equal(state.moveCommandId, command.commandId);
});
