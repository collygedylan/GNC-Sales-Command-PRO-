import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const app = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const functionSource = (name) => {
  const expression = new RegExp(`^        (?:async )?function ${name}\\(`, 'm');
  const match = expression.exec(app);
  assert.ok(match, `${name} exists`);
  const next = /^        (?:async )?function /m.exec(app.slice(match.index + match[0].length));
  return app.slice(match.index, next ? match.index + match[0].length + next.index : undefined);
};

function fixture(overrides = {}) {
  const row = { UNIQUE_ID: 'master-1', ITEMCODE: '001.010.1', LOCATIONCODE: 'A.05.001', LOTCODE: '27.F1', SOURCE: 'LD', CONTSIZE: '#1', SOURCE_TABLE: 'ph_master_inventory' };
  const calls = [];
  const scroll = { scrollTop: 735 };
  const modal = { classList: { add: () => calls.push('close'), remove: () => calls.push('open') } };
  const context = {
    console, Map, Set, Date, Object, String, Number, JSON, Promise,
    currentUser: 'dylan_collyge', currentUserDisplay: 'Dylan', activeDetailSourceView: '', lastView: 'tasks',
    activeTaskView: 'av-blanks', activeTaskTab: 'av-blanks', activeTaskFilter: 'all', activeTaskSubview: 'all',
    EVAL_TASK_ASSIGNMENT: 'eval', EVAL_SIMPLE_TASK_FILTER_VALUES: ['all', 'av-blanks'],
    nativeAuthProfile: { username: 'dylan_collyge', disabled_at: null, locked_until: null, must_change_password: false },
    masterInventoryById: new Map([[row.UNIQUE_ID, row]]), fullInventory: [row],
    argosInventoryTransactionState: null, argosReclassRowEditorEntries: new Map(),
    productionMasterReclassGeneration: 0, productionMasterDetailDemands: new Map(),
    getDatasetState: () => ({ listProjectionVersion: '' }),
    reclassDeliveryPollActive: false,
    firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim() !== '') ?? '',
    normalizeEvalTaskFilterValue: value => value,
    getAppAccessSnapshot: () => ({ role: 'MANAGER', username: 'dylan_collyge' }),
    getAuditedAppPermission: () => ({ allowed: true, scope: 'global' }),
    isWarehouseAssignedDriveCardForCurrentUser: () => false,
    canCurrentUserUseDriveCardOptions: () => true,
    escJsAttrValue: value => String(value),
    rebuildMasterInventoryIndexes: () => {},
    findItemByUniqueId: uid => context.masterInventoryById.get(uid),
    showToast: (...args) => calls.push(['toast', ...args]),
    ensureArgosInventoryTransactionModal: () => modal,
    getArgosInventorySourceSnapshot: value => ({ uniqueId: value.UNIQUE_ID }),
    buildItemInquiryViewModel: () => ({}), getItemInquiryRows: () => [row],
    resetArgosReclassMultiActionState: () => {}, generateArgosInventoryTransactionId: () => 'stable-test-token',
    refreshArgosInventoryTransactionLotOptions: () => {}, refreshArgosInventoryTransactionPriorityOptions: () => {},
    setArgosInventoryTransactionAction: () => {}, setArgosInventoryTransactionHoldAction: () => {},
    toggleArgosInventoryTransactionHoldActionPicker: () => {}, getCurrentVisibleViewId: () => 'tasks',
    requestAnimationFrame: callback => callback(),
    document: { hidden: false, getElementById: id => id === 'main-scroll-area' ? scroll : id === 'argos-inventory-transaction-modal' ? modal : null },
    getCurrentReclassDeliveryActor: () => 'dylan_collyge', renderReclassDeliveryStatusTray: () => {},
    readReclassDeliveryJobs: () => [], upsertReclassDeliveryJob: job => calls.push(['job', job]),
    driveReclassApi: async (...args) => { calls.push(['protected', ...args]); return { ok: true, status: 'queued' }; },
    postGoogleScriptRawJsonPayload: async (...args) => { calls.push(['public', ...args]); return { ok: true, status: 'queued' }; },
    getFriendlyBackendErrorMessage: error => String(error?.message || error),
    ...overrides,
  };
  vm.createContext(context);
  const names = [
    'usesProductionMasterListProjection',
    'isArgosInventoryTransactionEligible', 'isTaskAvBlanksReclassContext', 'resolveTaskAvBlanksReclassRow',
    'canCurrentUserUseTaskAvBlanksReclass', 'buildArgosInventoryTransactionRailHtml',
    'openArgosInventoryTransactionModal', 'closeArgosInventoryTransactionModal',
    'isArgosEvalReport2Inquiry', 'applyArgosInventoryTransactionSourceContext', 'applyArgosInventoryTransactionEmailRecipients',
    'isProtectedDriveReclassPayload', 'isProtectedDriveReclassJob', 'postArgosInventoryTransactionPayload',
    'pollReclassDeliveryJobs', 'retryReclassDeliveryJob',
  ];
  vm.runInContext(names.map(functionSource).join('\n'), context);
  return { context, row, calls, scroll };
}

test('Reclass appears only in normal or simplified EVAL AV Blanks, not other Tasks', () => {
  const { context, row } = fixture();
  assert.match(context.buildArgosInventoryTransactionRailHtml(row, 'tasks'), /tasks-av-blanks/);
  assert.equal((context.buildArgosInventoryTransactionRailHtml(row, 'tasks').match(/<button/g) || []).length, 1);
  context.activeTaskView = 'eval'; context.activeTaskFilter = 'av-blanks';
  assert.match(context.buildArgosInventoryTransactionRailHtml(row, 'tasks'), /Reclass/);
  context.activeTaskFilter = 'season-sales';
  assert.equal(context.buildArgosInventoryTransactionRailHtml(row, 'tasks'), '');
  assert.equal(context.buildArgosInventoryTransactionRailHtml(row, 'av'), '');
  assert.match(context.buildArgosInventoryTransactionRailHtml(row, 'drive'), /Reclass/);
});

test('existing effective Reclass permission and exact role are required; AV Note exemption grants nothing', () => {
  for (const role of ['ADMIN', 'ADMINISTRATOR', 'MANAGER']) {
    const { context, row } = fixture({ getAppAccessSnapshot: () => ({ role }) });
    assert.equal(context.canCurrentUserUseTaskAvBlanksReclass(row), true, role);
    context.getAuditedAppPermission = () => ({ allowed: false });
    assert.equal(context.canCurrentUserUseTaskAvBlanksReclass(row), false, `${role} denied`);
  }
  for (const role of ['SALES/MARKETING', 'CSR', 'SALESREP', '', 'UNKNOWN']) {
    const { context, row } = fixture({ getAppAccessSnapshot: () => ({ role }), isAvBlanksPhotoBypassUserAllowed: () => true });
    assert.equal(context.canCurrentUserUseTaskAvBlanksReclass(row), false, role);
  }
  for (const role of ['EVAL', 'EVALUATOR', 'EVAL-MANAGER']) {
    const { context, row } = fixture({ getAppAccessSnapshot: () => ({ role }) });
    assert.equal(context.canCurrentUserUseTaskAvBlanksReclass(row), false);
    context.isWarehouseAssignedDriveCardForCurrentUser = () => true;
    assert.equal(context.canCurrentUserUseTaskAvBlanksReclass(row), true);
  }
});

test('anonymous, unavailable-permission, disabled and locked profiles cannot expose Task Reclass', () => {
  for (const overrides of [
    { currentUser: '' }, { getAppAccessSnapshot: () => null }, { getAuditedAppPermission: () => null },
    { nativeAuthProfile: { disabled_at: new Date().toISOString() } },
    { nativeAuthProfile: { must_change_password: true } },
    { nativeAuthProfile: { locked_until: new Date(Date.now() + 60000).toISOString() } },
  ]) {
    const { context, row } = fixture(overrides);
    assert.equal(context.buildArgosInventoryTransactionRailHtml(row, 'tasks'), '');
  }
});

test('only exact current master inventory identity may open; mirrors and changed physical rows fail closed', () => {
  const { context, row } = fixture();
  assert.equal(context.resolveTaskAvBlanksReclassRow({ ...row }), row);
  for (const field of ['UNIQUE_ID', 'ITEMCODE', 'LOCATIONCODE', 'LOTCODE', 'SOURCE', 'CONTSIZE', 'SOURCE_TABLE']) {
    assert.equal(context.resolveTaskAvBlanksReclassRow({ ...row, [field]: 'OTHER' }), null, field);
  }
  context.masterInventoryById.clear();
  assert.equal(context.resolveTaskAvBlanksReclassRow(row), null);
});

test('Task open and close retain navigation state and restore scroll without rerender', () => {
  const { context, row, scroll, calls } = fixture();
  Object.assign(context, { taskViewLevel: 2, selectedTaskBlock: 'A', selectedTaskLoc: 'A.05', taskLocationDetailSearchTerm: 'maple', selectedTaskGenusNames: new Set(['Acer']), selectedTaskContSizes: new Set(['#1']), selectedItems: new Set(['card-1']) });
  context.openArgosInventoryTransactionModal(row.UNIQUE_ID, 'reclass', 'tasks-av-blanks');
  assert.equal(context.argosInventoryTransactionState.sourceView, 'tasks-av-blanks');
  scroll.scrollTop = 0;
  context.closeArgosInventoryTransactionModal();
  assert.equal(scroll.scrollTop, 735);
  assert.equal(context.taskViewLevel, 2); assert.equal(context.selectedTaskLoc, 'A.05');
  assert.equal(context.taskLocationDetailSearchTerm, 'maple');
  assert.deepEqual([...context.selectedTaskGenusNames], ['Acer']);
  assert.deepEqual([...context.selectedTaskContSizes], ['#1']);
  assert.deepEqual([...context.selectedItems], ['card-1']);
  assert.deepEqual(calls, ['open', 'close']);
});

test('Task opening rechecks permission and context, including direct invocation', () => {
  const { context, row, calls } = fixture({ getAuditedAppPermission: () => ({ allowed: false }) });
  context.openArgosInventoryTransactionModal(row.UNIQUE_ID, 'reclass', 'tasks-av-blanks');
  assert.equal(context.argosInventoryTransactionState, null);
  assert.equal(calls[0][0], 'toast');
  assert.ok(!calls.includes('open'));
});

test('Task creation strips actor and recipient hints, uses protected Drive API, and never public fallback', async () => {
  const { context, calls } = fixture();
  context.argosInventoryTransactionState = { sourceView: 'tasks-av-blanks' };
  let payload = context.applyArgosInventoryTransactionSourceContext({ idempotencyToken: 'same-token', actor: { username: 'other' }, recipientEmails: ['other'], emailRecipients: ['other'], recipients: ['other'] });
  payload = await context.applyArgosInventoryTransactionEmailRecipients(payload);
  assert.equal(payload.sourceContext.sourceMode, 'drive');
  for (const field of ['actor', 'recipientEmails', 'emailRecipients', 'recipients']) assert.equal(field in payload, false);
  await context.postArgosInventoryTransactionPayload(payload);
  assert.equal(calls[0][0], 'protected'); assert.equal(calls[0][1], 'create');
  context.driveReclassApi = async () => { throw new Error('offline'); };
  await assert.rejects(context.postArgosInventoryTransactionPayload(payload), /offline/);
  assert.ok(!calls.some(call => call[0] === 'public'));
});

test('Task delivery polling and retry keep the protected route and same token; legacy Eval stays unchanged', async () => {
  const { context, calls } = fixture();
  const job = { token: 'same-token', sourceView: 'tasks-av-blanks', actorUsername: 'dylan_collyge', status: 'queued', payload: { sourceContext: { sourceMode: 'drive' } } };
  context.readReclassDeliveryJobs = () => [job];
  context.getReclassDeliveryJob = () => job;
  await context.pollReclassDeliveryJobs();
  assert.equal(calls[0][1], 'status'); assert.equal(calls[0][2].idempotencyToken, 'same-token');
  context.pollReclassDeliveryJobs = async () => false;
  await context.retryReclassDeliveryJob('same-token');
  assert.ok(calls.some(call => call[0] === 'protected' && call[1] === 'retry' && call[2].idempotencyToken === 'same-token'));
  assert.ok(!calls.some(call => call[0] === 'public'));
  assert.equal(context.isProtectedDriveReclassJob({ sourceView: 'tasks-av-blanks' }), true);
  assert.equal(context.isProtectedDriveReclassJob({ sourceView: 'eval-report-2', payload: { sourceContext: { sourceMode: 'eval-report-2' } } }), false);
  assert.equal(context.isProtectedDriveReclassJob({ sourceView: 'legacy', payload: {} }), false);
});
