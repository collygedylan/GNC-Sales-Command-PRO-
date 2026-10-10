import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';

const builtReclass = buildSync({ entryPoints: ['services/reclassLiveEdits.ts'], bundle: true,
  platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const reclassModule = { exports: {} };
new Function('require', 'module', 'exports', builtReclass.outputFiles[0].text)(
  createRequire(import.meta.url), reclassModule, reclassModule.exports,
);
const { confirmedReclassLiveEditsFromResult } = reclassModule.exports;

const builtEvidence = buildSync({ entryPoints: ['services/driveEvidence.ts'], bundle: true,
  platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const evidenceModule = { exports: {} };
new Function('require', 'module', 'exports', builtEvidence.outputFiles[0].text)(
  createRequire(import.meta.url), evidenceModule, evidenceModule.exports,
);
const { driveEvidenceRevision, driveEvidenceColumns, confirmedDriveEvidence } = evidenceModule.exports;

function evidenceRow(uniqueId, lastUpdated, overrides = {}) {
  return Object.assign(Object.fromEntries(driveEvidenceColumns.map(key => [key, null])), {
    unique_id: uniqueId,
    last_updated: lastUpdated,
  }, overrides);
}

function liveEdit(overrides = {}) {
  const row = {
    unique_id: '00A-Exact-Id', priority: null, holdstopcode: null, holdstopreason: null,
    av_rule_last_clear_reason: null, av_rule_last_cleared_at: null,
    last_updated: '2026-10-09T12:34:56.789Z',
    ...overrides,
  };
  return { ...row, evidence: evidenceRow(row.unique_id, row.last_updated, overrides.evidence || {}) };
}

const html = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');

test('Reclass notices disclose live field edits and inquiry-only quantity instructions', () => {
  const noticeText = 'Editable inventory fields update live inventory after confirmation and remain protected until the legacy import matches. Quantity, season, and sheared instructions remain requests for keyers.';
  const initialNotice = html.match(/id="argos-inventory-transaction-notice"[^>]*>(.*?)<\/div>/s)?.[1];
  const refreshedNotice = html.match(/notice\.innerHTML = '(<span class="font-black">Send Item Inquiry<\/span>.*?)';/s)?.[1];
  assert.ok(initialNotice?.includes(noticeText));
  assert.equal(refreshedNotice, initialNotice, 'editor updates retain the initial submission disclosure');
  assert.doesNotMatch(html, /Live inventory quantities and status remain unchanged/);
  assert.doesNotMatch(html, /Hold\/Stop actions automatically mark the configured current-season scope/);
});

function loadConfirmedApplyFixture(currentRow, revision = '9') {
  const start = html.indexOf('const confirmedArgosReclassLiveEditRevisions = new Map();');
  const end = html.indexOf('function openArgosInventoryRequestFromTransactionModal(', start);
  const returnedRowStart = html.indexOf('function applyArgosInventoryTransactionReturnedRow(', 0);
  const returnedRowEnd = html.indexOf('const confirmedArgosReclassLiveEditRevisions = new Map();', returnedRowStart);
  assert.ok(start > 0 && end > start && returnedRowStart > 0 && returnedRowEnd > returnedRowStart);
  const appliedRows = [];
  const dirtyViews = [];
  const masterState = { liveVerifiedRevision: revision, liveVerifiedScope: 'old-scope', liveVerifiedPermission: 'old-permission' };
  const fullInventory = [currentRow];
  const avOpenInventory = [];
  const context = {
    nativeAuthProfile: { id: 'user-1' },
    currentUser: 'user-1', currentRole: 'MANAGER',
    window: { GncDatabase: {
      confirmedReclassLiveEditsFromResult,
      driveEvidenceRevision,
      driveEvidenceColumns,
    } },
    normalizeSessionIdentity: value => String(value || '').trim().toLowerCase(),
    getCurrentRoleAccessValue: () => 'MANAGER',
    getCurrentLoginCacheScopeKey: () => 'user-1:manager',
    getDatasetState: () => masterState,
    fullInventory,
    avOpenInventory,
    formatFetchedRows: rows => rows.map(raw => Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== null && typeof value !== 'undefined'))),
    normalizeAppTableName: value => String(value || ''),
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== '') ?? '',
    findItemByUniqueId: uid => fullInventory.find(row => row.UNIQUE_ID === uid) || null,
    upsertRealtimeRow: (collection, row) => {
      const index = collection.findIndex(existing => existing.UNIQUE_ID === row.UNIQUE_ID);
      if (index < 0) collection.push(row);
      else collection[index] = { ...collection[index], ...row };
      if (collection === fullInventory) appliedRows.push(collection[index < 0 ? collection.length - 1 : index]);
      return true;
    },
    shouldIncludeMasterItemInAvSeasonView: () => true,
    normalizeRowPhotoFields: row => row,
    rebuildMasterInventoryIndexes: () => {},
    refreshRealtimeDetailLookupIndexes: () => {},
    getDatasetKeysForTable: () => ['master'],
    getVisibleAffectedViewIds: () => ['drive'],
    propagateCommittedEdit: () => {},
    parseAppNumber: value => value == null || value === '' ? null : Number(value),
    invalidateResolvedViewStateCaches: () => {},
    getAffectedViewsForDatasets: () => ['request', 'drive'],
    markViewDirty: view => dirtyViews.push(view),
    persistCurrentCache: () => {},
    canUseProductionLiveSync: () => false,
    signalProductionLiveSync: () => {},
    console,
  };
  vm.createContext(context);
  vm.runInContext(`${html.slice(returnedRowStart, returnedRowEnd)}; ${html.slice(start, end)}; this.apply = applyConfirmedArgosReclassLiveEdits; this.acceptRead = isConfirmedInventoryReadRevisionCurrent; this.identityKey = getArgosReclassLiveEditIdentityKey();`, context);
  return { apply: context.apply, acceptRead: context.acceptRead, appliedRows, avOpenInventory, dirtyViews, fullInventory, identityKey: context.identityKey, masterState };
}

const valid = {
  inventoryRevision: '9007199254740993',
  liveEdits: [liveEdit()],
};

test('confirmed live edit parser preserves exact IDs, clears, timestamps and bigint revisions', () => {
  assert.deepEqual(confirmedReclassLiveEditsFromResult(valid), valid);
  assert.equal(BigInt(confirmedReclassLiveEditsFromResult(valid).inventoryRevision), 9007199254740993n);
  assert.deepEqual(confirmedReclassLiveEditsFromResult(valid).liveEdits[0].evidence, valid.liveEdits[0].evidence);
});

test('confirmed live edit parser rejects duplicate or malformed IDs and missing explicit clears', () => {
  assert.throws(() => confirmedReclassLiveEditsFromResult({ ...valid, liveEdits: [valid.liveEdits[0], valid.liveEdits[0]] }), /ROW_ID_INVALID/);
  assert.throws(() => confirmedReclassLiveEditsFromResult({ ...valid, liveEdits: [{ ...valid.liveEdits[0], unique_id: ' padded ' }] }), /ROW_ID_INVALID/);
  const { holdstopreason: _holdstopreason, ...missingReason } = valid.liveEdits[0];
  assert.throws(() => confirmedReclassLiveEditsFromResult({ ...valid, liveEdits: [missingReason] }), /ROW_INVALID/);
  assert.throws(() => confirmedReclassLiveEditsFromResult({ ...valid, liveEdits: [{ ...valid.liveEdits[0], priority: 2 }] }), /FIELD_INVALID/);
});

test('confirmed live edit parser rejects invalid revisions, timestamps and unknown fields', () => {
  for (const inventoryRevision of ['', '0', '-1', '01', 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => confirmedReclassLiveEditsFromResult({ ...valid, inventoryRevision }), /REVISION_INVALID/);
  }
  assert.throws(() => confirmedReclassLiveEditsFromResult({ ...valid, liveEdits: [{ ...valid.liveEdits[0], last_updated: 'yesterday' }] }), /TIMESTAMP_INVALID/);
  assert.throws(() => confirmedReclassLiveEditsFromResult({ ...valid, liveEdits: [{ ...valid.liveEdits[0], extra: true }] }), /ROW_INVALID/);
  const { photo_link: _photoLink, ...missingPhoto } = valid.liveEdits[0].evidence;
  assert.throws(() => confirmedReclassLiveEditsFromResult({ ...valid, liveEdits: [{ ...valid.liveEdits[0], evidence: missingPhoto }] }), /EVIDENCE_INVALID/);
  assert.throws(() => confirmedReclassLiveEditsFromResult({ ...valid, liveEdits: [{ ...valid.liveEdits[0], evidence: { ...valid.liveEdits[0].evidence, unique_id: 'different-row' } }] }), /EVIDENCE_MISMATCH/);
  assert.throws(() => confirmedReclassLiveEditsFromResult({ ...valid, liveEdits: [{ ...valid.liveEdits[0], evidence: { ...valid.liveEdits[0].evidence, last_updated: '2026-10-09T12:34:56.000Z' } }] }), /EVIDENCE_MISMATCH/);
});

test('confirmed response reconciles live fields and authoritative AV evidence clears after acknowledgement', () => {
  const current = {
    UNIQUE_ID: 'row-1', PRIORITY: '3', HOLDSTOPCODE: 'H', HOLDSTOPREASON: 'old reason',
    ITEMCODE: 'A1', LOCATIONCODE: 'A.01', LOTCODE: '27.F1',
    PTRONHAND: '27', PTRAVAILABLE: '22', LAST_UPDATED: '2026-10-09T12:00:00.000Z',
    PHOTO_LINK: 'https://example.test/old.jpg', photo_link: 'https://example.test/old.jpg',
    SAVED_PHOTO_LINK: 'https://example.test/old.jpg', PHOTO_NAME: 'old.jpg', photo_name: 'old.jpg', SAVED_PHOTO_NAME: 'old.jpg',
    SPEC: 'old spec', spec: 'old spec', CALIPER: 'old caliper', caliper: 'old caliper',
    MATCH: 'old match', match: 'old match', MATCHPCT: 'old match', MATCH_PCT: 'old match', AV_NOTE: 'old AV note', av_note: 'old AV note',
    PIC_NOTE: 'old pick', pic_note: 'old pick', PICKNOTE: 'old pick', SALES_NOTE: 'old sales', SALESNOTE: 'old sales', sales_note: 'old sales', salesnote: 'old sales',
  };
  const fixture = loadConfirmedApplyFixture(current);
  const result = fixture.apply({
    inventoryRevision: '10',
    liveEdits: [liveEdit({ unique_id: 'row-1', priority: '2', av_rule_last_clear_reason: 'priority_changed', av_rule_last_cleared_at: '2026-10-09T12:01:00.000Z', last_updated: '2026-10-09T12:01:00.000Z', evidence: { itemcode: 'A1', locationcode: 'A.01', lotcode: '27.F1', ptravailable: '22', photo_link: null, photo_name: null, spec: null, caliper: null, match: null, av_note: null, pic_note: null, sales_note: null, av_rule_last_clear_reason: 'priority_changed', av_rule_last_cleared_at: '2026-10-09T12:01:00.000Z' } })],
  }, fixture.identityKey);
  assert.equal(result.applied, 1);
  assert.equal(result.stale, false);
  assert.equal(fixture.appliedRows.length, 1);
  assert.equal(fixture.appliedRows[0].PRIORITY, '2');
  assert.equal(fixture.appliedRows[0].HOLDSTOPCODE, '');
  assert.equal(fixture.appliedRows[0].PTRONHAND, '27');
  assert.equal(fixture.appliedRows[0].AV_RULE_LAST_CLEAR_REASON, 'priority_changed');
  assert.equal(fixture.appliedRows[0].AV_RULE_LAST_CLEARED_AT, '2026-10-09T12:01:00.000Z');
  for (const key of ['PHOTO_LINK', 'photo_link', 'SAVED_PHOTO_LINK', 'PHOTO_NAME', 'photo_name', 'SAVED_PHOTO_NAME',
    'SPEC', 'spec', 'CALIPER', 'caliper', 'MATCH', 'match', 'MATCHPCT', 'MATCH_PCT', 'AV_NOTE', 'av_note', 'PIC_NOTE', 'pic_note', 'PICKNOTE',
    'SALES_NOTE', 'sales_note']) {
    assert.ok(fixture.appliedRows[0][key] == null || fixture.appliedRows[0][key] === '', `${key} is cleared`);
  }
  assert.equal(fixture.appliedRows[0].SALESNOTE, 'old sales', 'physical salesnote is independent of AV evidence');
  assert.equal(fixture.appliedRows[0].salesnote, 'old sales');
  assert.equal(fixture.avOpenInventory[0].PHOTO_LINK, '');
  assert.equal(fixture.avOpenInventory[0].SPEC, null);
  assert.equal(fixture.avOpenInventory[0].AV_NOTE, null);
  assert.deepEqual(fixture.dirtyViews, ['request', 'drive']);
});

test('stale revision, timestamp, or account never overwrites a newer local row', () => {
  const confirmed = { inventoryRevision: '10', liveEdits: [liveEdit({ unique_id: 'row-1', priority: '2', av_rule_last_clear_reason: 'priority_changed', av_rule_last_cleared_at: '2026-10-09T12:01:00.000Z', last_updated: '2026-10-09T12:01:00.000Z' })] };
  const newerRevision = loadConfirmedApplyFixture({ UNIQUE_ID: 'row-1', PRIORITY: '3', LAST_UPDATED: '2026-10-09T11:00:00.000Z' }, '11');
  assert.equal(newerRevision.apply(confirmed, newerRevision.identityKey).stale, true);
  assert.equal(newerRevision.appliedRows.length, 0);

  const newerTimestamp = loadConfirmedApplyFixture({ UNIQUE_ID: 'row-1', PRIORITY: '3', LAST_UPDATED: '2026-10-09T12:02:00.000Z' });
  assert.equal(newerTimestamp.apply(confirmed, newerTimestamp.identityKey).stale, true);
  assert.equal(newerTimestamp.appliedRows.length, 0);

  const switchedAccount = loadConfirmedApplyFixture({ UNIQUE_ID: 'row-1', PRIORITY: '3', LAST_UPDATED: '2026-10-09T11:00:00.000Z' });
  assert.equal(switchedAccount.apply(confirmed, 'other-user').stale, true);
  assert.equal(switchedAccount.appliedRows.length, 0);

  const ordered = loadConfirmedApplyFixture({ UNIQUE_ID: 'row-1', PRIORITY: '3', LAST_UPDATED: '2026-10-09T11:00:00.000Z' });
  assert.equal(ordered.apply(confirmed, ordered.identityKey).applied, 1);
  const older = { ...confirmed, inventoryRevision: '9' };
  assert.equal(ordered.apply(older, ordered.identityKey).stale, true);
});

test('a malformed receipt from a different account cannot invalidate the current account cache', () => {
  const fixture = loadConfirmedApplyFixture({ UNIQUE_ID: 'row-1', PRIORITY: '3', LAST_UPDATED: '2026-10-09T12:00:00.000Z' });
  const result = fixture.apply(null, 'different-account');
  assert.equal(result.stale, true);
  assert.equal(result.applied, 0);
  assert.deepEqual(fixture.dirtyViews, []);
  assert.equal(fixture.masterState.liveVerifiedRevision, '9');
  assert.equal(fixture.fullInventory[0].PRIORITY, '3');
});

test('accepted Reclass submit is retained for its owner but cannot close or repaint a newer session modal', async () => {
  const submitStart = html.indexOf('async function submitArgosInventoryTransaction(');
  const submitEnd = html.indexOf('function canSendDriveRowToHoldRelease(', submitStart);
  assert.ok(submitStart > 0 && submitEnd > submitStart);
  const submitSource = html.slice(submitStart, submitEnd);
  let identity = 'account-a';
  let currentState = { sourceView: 'drive', submitting: false };
  const originalState = currentState;
  const button = { disabled: false, textContent: 'New modal draft' };
  let resolvePost;
  const postResult = new Promise(resolve => { resolvePost = resolve; });
  let signalPostStarted;
  const postStarted = new Promise(resolve => { signalPostStarted = resolve; });
  const retained = [];
  const sideEffects = [];
  const context = {
    argosInventoryTransactionState: currentState,
    getArgosReclassLiveEditIdentityKey: () => identity,
    getCurrentReclassDeliveryActor: () => 'account_a',
    buildArgosInventoryTransactionPayload: () => ({ workflowPolicyVersion: 'v6', idempotencyToken: 'token-a', source: { unique_id: 'row-a' } }),
    applyArgosInventoryTransactionSourceContext: payload => payload,
    applyArgosInventoryTransactionEmailRecipients: async payload => payload,
    postArgosInventoryTransactionPayload: () => { signalPostStarted(); return postResult; },
    rememberQueuedReclassDelivery: (...args) => retained.push(args),
    applyConfirmedArgosReclassLiveEdits: () => sideEffects.push('apply-receipt'),
    closeArgosInventoryTransactionModal: () => sideEffects.push('close-modal'),
    showToast: () => sideEffects.push('toast'),
    pollReclassDeliveryJobs: () => sideEffects.push('poll'),
    document: { getElementById: () => button },
    window: {},
    RECLASS_ACTION_WORKFLOW_V6_POLICY_VERSION: 'v6',
  };
  vm.createContext(context);
  vm.runInContext(`${submitSource}; this.submit = submitArgosInventoryTransaction;`, context);
  const pending = context.submit(null);
  await postStarted;
  assert.equal(originalState.submitting, true);
  currentState = { sourceView: 'drive', submitting: false };
  context.argosInventoryTransactionState = currentState;
  identity = 'account-b';
  button.disabled = true;
  button.textContent = 'Current account draft';
  resolvePost({ ok: true, jobId: 'job-a', status: 'queued' });
  await pending;
  assert.equal(retained.length, 1, 'the accepted result is retained with the captured owner and source view');
  assert.equal(retained[0][2], 'account_a');
  assert.equal(retained[0][3], 'drive');
  assert.deepEqual(sideEffects, []);
  assert.equal(currentState.submitting, false);
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, 'Current account draft');
});

test('accepted same-account Reclass receipt still reconciles when its original modal was replaced', async () => {
  const submitStart = html.indexOf('async function submitArgosInventoryTransaction(');
  const submitEnd = html.indexOf('function canSendDriveRowToHoldRelease(', submitStart);
  const submitSource = html.slice(submitStart, submitEnd);
  const originalState = { sourceView: 'drive', submitting: false };
  const currentState = { sourceView: 'drive', submitting: false };
  let resolvePost;
  let signalPostStarted;
  const postResult = new Promise(resolve => { resolvePost = resolve; });
  const postStarted = new Promise(resolve => { signalPostStarted = resolve; });
  const sideEffects = [];
  const context = {
    argosInventoryTransactionState: originalState,
    getArgosReclassLiveEditIdentityKey: () => 'same-account-session',
    getCurrentReclassDeliveryActor: () => 'account_a',
    buildArgosInventoryTransactionPayload: () => ({ workflowPolicyVersion: 'v6', idempotencyToken: 'token-a', source: { unique_id: 'row-a' } }),
    applyArgosInventoryTransactionSourceContext: payload => payload,
    applyArgosInventoryTransactionEmailRecipients: async payload => payload,
    postArgosInventoryTransactionPayload: () => { signalPostStarted(); return postResult; },
    rememberQueuedReclassDelivery: () => sideEffects.push('remember'),
    applyConfirmedArgosReclassLiveEdits: () => { sideEffects.push('apply-receipt'); return { applied: 1, stale: false }; },
    closeArgosInventoryTransactionModal: () => sideEffects.push('close-modal'),
    showToast: () => sideEffects.push('toast'),
    pollReclassDeliveryJobs: () => sideEffects.push('poll'),
    document: { getElementById: () => ({ disabled: false, textContent: '' }) },
    window: {},
    RECLASS_ACTION_WORKFLOW_V6_POLICY_VERSION: 'v6',
  };
  vm.createContext(context);
  vm.runInContext(`${submitSource}; this.submit = submitArgosInventoryTransaction;`, context);
  const pending = context.submit(null);
  await postStarted;
  context.argosInventoryTransactionState = currentState;
  resolvePost({ ok: true, jobId: 'job-a', status: 'queued' });
  await pending;
  assert.deepEqual(sideEffects, ['remember', 'apply-receipt']);
  assert.equal(currentState.submitting, false);
});

test('identity changes during recipient selection prevent posting the old Reclass draft', async () => {
  const submitStart = html.indexOf('async function submitArgosInventoryTransaction(');
  const submitEnd = html.indexOf('function canSendDriveRowToHoldRelease(', submitStart);
  const submitSource = html.slice(submitStart, submitEnd);
  let identity = 'account-a';
  let resolveRecipients;
  const recipients = new Promise(resolve => { resolveRecipients = resolve; });
  const calls = [];
  const state = { sourceView: 'drive', submitting: false };
  const context = {
    argosInventoryTransactionState: state,
    getArgosReclassLiveEditIdentityKey: () => identity,
    getCurrentReclassDeliveryActor: () => 'account_a',
    buildArgosInventoryTransactionPayload: () => ({ source: { unique_id: 'row-a' } }),
    applyArgosInventoryTransactionSourceContext: payload => payload,
    applyArgosInventoryTransactionEmailRecipients: () => recipients,
    postArgosInventoryTransactionPayload: () => { calls.push('post'); return Promise.resolve({ ok: true }); },
    rememberQueuedReclassDelivery: () => calls.push('remember'),
    closeArgosInventoryTransactionModal: () => calls.push('close'),
    showToast: () => calls.push('toast'),
    document: { getElementById: () => ({ disabled: false, textContent: '' }) },
    window: {},
    RECLASS_ACTION_WORKFLOW_V6_POLICY_VERSION: 'v6',
  };
  vm.createContext(context);
  vm.runInContext(`${submitSource}; this.submit = submitArgosInventoryTransaction;`, context);
  const pending = context.submit(null);
  identity = 'account-b';
  resolveRecipients({ source: { unique_id: 'row-a' } });
  await pending;
  assert.deepEqual(calls, []);
  assert.equal(state.submitting, false);
});

test('already-current local fields never receive an older server timestamp', () => {
  const current = { UNIQUE_ID: 'row-1', PRIORITY: '2', HOLDSTOPCODE: '', HOLDSTOPREASON: '', LAST_UPDATED: '2026-10-09T12:02:00.000Z' };
  const fixture = loadConfirmedApplyFixture(current, '10');
  const response = { inventoryRevision: '10', liveEdits: [liveEdit({ unique_id: 'row-1', priority: '2', av_rule_last_clear_reason: 'priority_changed', av_rule_last_cleared_at: '2026-10-09T12:01:00.000Z', last_updated: '2026-10-09T12:01:00.000Z' })] };
  assert.equal(fixture.apply(response, fixture.identityKey).applied, 1);
  assert.equal(fixture.appliedRows.length, 0);
  assert.equal(current.LAST_UPDATED, '2026-10-09T12:02:00.000Z');
});

test('confirmed reconciliation rejects a stale response within the same millisecond', () => {
  const current = { UNIQUE_ID: 'row-1', PRIORITY: '3', HOLDSTOPCODE: '', HOLDSTOPREASON: '',
    LAST_UPDATED: '2026-10-09T12:02:00.123900Z' };
  const fixture = loadConfirmedApplyFixture(current, '10');
  const response = { inventoryRevision: '10', liveEdits: [liveEdit({ unique_id: 'row-1', priority: '2', av_rule_last_clear_reason: null, av_rule_last_cleared_at: null, last_updated: '2026-10-09T07:02:00.123100-05:00' })] };
  assert.equal(Date.parse(current.LAST_UPDATED), Date.parse(response.liveEdits[0].last_updated));
  assert.equal(fixture.apply(response, fixture.identityKey).stale, true);
  assert.equal(fixture.appliedRows.length, 0);
  assert.equal(current.PRIORITY, '3');
});


test('background reads cannot replace confirmed inventory with an older dataset revision', () => {
  const fixture = loadConfirmedApplyFixture({UNIQUE_ID:'row-1',PRIORITY:'3',LAST_UPDATED:'2026-10-09T12:00:00Z'});
  assert.equal(fixture.acceptRead('9'), true);
  fixture.apply({inventoryRevision:'10',liveEdits:[liveEdit({unique_id:'row-1',priority:'2'})]}, fixture.identityKey);
  assert.equal(fixture.acceptRead('9'), false);
  assert.equal(fixture.acceptRead(''), false);
  assert.equal(fixture.acceptRead('10'), true);
  assert.equal(fixture.acceptRead('11'), true);
});

test('V7 confirmed fields reconcile independently of AV evidence and preserve physical quantities', () => {
  const fixture = loadConfirmedApplyFixture({UNIQUE_ID:'row-1',PRIORITY:'2',PTRONHAND:'41',SALESNOTE:'Old office note',LAST_UPDATED:'2026-10-09T12:00:00Z'});
  const before = Object.fromEntries(['locationnote','locationptn1','desigitem','desigcust','desigloc','pullerresponsibility','oversellpercentage','salesnote','suspend'].map(field=>[field,null]));
  const receipt = {workflowPolicyVersion:'reclass-action-workflow-v7-editable-fields-20261009',inventoryRevision:'10',
    liveEdits:[liveEdit({unique_id:'row-1',priority:'2',evidence:{photo_link:'keep.webp',spec:'keep specs',sales_note:'AV comments'}})],
    inventoryFields:[{unique_id:'row-1',before,after:{...before,salesnote:'Office instructions',suspend:'DC'},changedFields:['salesnote','suspend'],
      stamps:{prisetby:'DC',priupdated:'2026-10-09',locationnotedate:null,evaldate:'2026-10-09'}}]};
  const result=fixture.apply(receipt,fixture.identityKey);
  assert.equal(result.applied,1); assert.equal(result.stale,false);
  assert.equal(fixture.appliedRows[0].PTRONHAND,'41');
  assert.equal(fixture.appliedRows[0].PHOTO_LINK,'keep.webp');
  assert.equal(fixture.appliedRows[0].SPEC,'keep specs');
  assert.equal(fixture.appliedRows[0].SALESNOTE,'Office instructions');
  assert.equal(fixture.appliedRows[0].SALES_NOTE,'AV comments');
  assert.equal(fixture.appliedRows[0].SUSPEND,'DC');
  assert.equal(fixture.appliedRows[0].PRISETBY,'DC');
  assert.throws(()=>confirmedReclassLiveEditsFromResult({...receipt,workflowPolicyVersion:'legacy'}),/POLICY_INVALID/);
});
