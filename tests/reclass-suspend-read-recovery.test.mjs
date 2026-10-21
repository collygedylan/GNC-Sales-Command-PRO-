import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readComposedAppSource().replace(/\r\n/g, '\n');
const contractContext = {};
vm.runInNewContext(readFileSync(new URL('../assets/inventory-list-contract.js', import.meta.url), 'utf8'), contractContext);
const inventoryContract = contractContext.AgMetricInventoryList;
const liveSyncContext = {};
vm.runInNewContext(readFileSync(new URL('../assets/live-sync-coordinator.js', import.meta.url), 'utf8'), liveSyncContext);
// Keep production readiness/token semantics; these fixtures already provide
// normalized Map metadata so only their wire-to-snapshot adapter is synthetic.
const fixtureLiveSync = { ...liveSyncContext.AgMetricLiveSync, snapshot: value => value };


function extractAppFunction(name) {
  const match = html.match(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(match, `${name} should be defined`);
  const nextFunction = html.slice(match.index + match[0].length).search(/\r?\n        (?:async )?function \w+\(/);
  const end = nextFunction < 0 ? -1 : match.index + match[0].length + nextFunction;
  assert.ok(end > match.index, `${name} boundary`);
  return html.slice(match.index, end);
}

function makeReclassRows(itemCode = 'ITEM-001') {
  return [
    { unique_id: 'row-1', itemcode: itemCode, locationcode: 'A1', season: 'F1', saleyear: '27', locationnote: 'North', ptronhand: 0 },
    { unique_id: 'row-2', itemcode: itemCode, locationcode: 'B2', season: 'S1', saleyear: '27', locationnote: 'South', ptronhand: 12 },
  ];
}

function reclassRowsFixture(options = {}) {
  const calls = [];
  const initialScope = 'account-a';
  const initialContext = { scope: initialScope, dataPermissionVersion: 'permission-v1' };
  const row = { UNIQUE_ID: 'row-1', ITEMCODE: options.itemCode || 'ITEM-001', SOURCE_TABLE: 'ph_master_inventory' };
  const revisions = options.revisions || ['r7', 'r7'];
  const rows = options.rows || makeReclassRows(row.ITEMCODE);
  Object.defineProperty(rows, 'readMeta', {
    value: options.readMeta || { projection: 'full', fieldCoverage: 'full', columns: inventoryContract.physicalColumns },
    configurable: true,
  });
  let revisionIndex = 0;
  const ctx = {
    String, Error, Object, Set, Map, Array, AbortController, Promise, JSON, Number,
    nativeAuthSessionActive: true,
    sourceScope: initialScope,
    sourceContext: initialContext,
    fullLoaded: false,
    getSupabaseReadIdentityScope: () => ctx.sourceScope,
    getArgosReclassLiveEditIdentityKey: () => ctx.sourceScope,
    getProductionLiveSyncContext: () => ctx.sourceContext,
    canUseProductionLiveSync: () => true,
    withProductionLiveSyncSignal: async (_signal, read) => read(options.signal || new AbortController().signal),
    supabaseRpc: async (name, params, rpcOptions) => {
      calls.push({ kind: 'revision', name, params, options: rpcOptions });
      const value = revisions[Math.min(revisionIndex++, revisions.length - 1)];
      if (options.onRevision) options.onRevision(revisionIndex, ctx);
      return {
        permissionVersion: options.permissionVersions?.[revisionIndex - 1] || 'permission-v1',
        sources: new Map([['ph_master_inventory', {
          state: options.sourceState || 'ready',
          revision: value,
        }]]),
      };
    },
    fetchAllInventoryReadRows: async (operation, params, readOptions) => {
      calls.push({ kind: 'rows', operation, params, options: readOptions });
      if (options.fetchError) throw options.fetchError;
      return rows;
    },
    validateInventoryReadProjection: (meta, params) => {
      assert.equal(params.projection, 'full');
      const actual = Array.isArray(meta?.columns) ? meta.columns.slice().sort() : [];
      const expected = inventoryContract.physicalColumns.slice().sort();
      if (meta?.projection !== 'full' || meta?.fieldCoverage !== 'full'
        || actual.length !== expected.length || actual.some((column, index) => column !== expected[index])) {
        throw new Error('Full inventory field coverage was missing or invalid.');
      }
      return true;
    },
    formatFetchedRows: rows => rows.map(value => ({ ...value, UNIQUE_ID: value.unique_id, ITEMCODE: value.itemcode })),
    window: {
      AgMetricLiveSync: fixtureLiveSync,
      AgMetricInventoryList: inventoryContract,
    },
    staleSupabaseReadScopeError: () => Object.assign(new Error('scope changed'), { code: 'DATASET_READ_SCOPE_CHANGED' }),
  };
  vm.createContext(ctx);
  vm.runInContext(extractAppFunction('getArgosReclassSourceRowsSignature') + '\n' + extractAppFunction('loadArgosItemInquiryRows'), ctx);
  return { ctx, calls, row };
}

test('Reclass reads every itemcode row with full projection and a stable source revision fence', async () => {
  const { ctx, calls, row } = reclassRowsFixture();
  const result = await ctx.loadArgosItemInquiryRows(row);

  assert.equal(result.row.UNIQUE_ID, row.UNIQUE_ID);
  assert.deepEqual(Array.from(result.rows, entry => entry.UNIQUE_ID), ['row-1', 'row-2']);
  assert.deepEqual(calls.map(call => call.kind), ['revision', 'rows', 'revision']);
  assert.equal(calls[1].operation, 'master_page');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].params)), {
    dataset: 'lookup', projection: 'full', itemCode: 'ITEM-001',
  });
  assert.equal(calls[1].options.requireComplete, true);
  assert.ok(calls[1].options.signal);
  assert.equal(calls[0].name, 'get_my_dataset_revisions_v1');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].params)), { p_dataset_keys: ['ph_master_inventory'] });
  assert.equal(ctx.fullLoaded, false, 'a group lookup must not claim that global master data is fully loaded');
});

test('Reclass itemcode group rejects source revision changes and account changes during paging', async () => {
  const changedRevision = reclassRowsFixture({ revisions: ['r7', 'r8'] });
  await assert.rejects(changedRevision.ctx.loadArgosItemInquiryRows(changedRevision.row), /changed|stale|reopen/i);

  const changedScope = reclassRowsFixture({ onRevision: (readNo, ctx) => {
    if (readNo === 1) ctx.sourceScope = 'account-b';
  } });
  await assert.rejects(changedScope.ctx.loadArgosItemInquiryRows(changedScope.row), /scope|identity|changed/i);

  const controller = new AbortController();
  const aborted = reclassRowsFixture({ signal: controller.signal, onRevision: (readNo) => {
    if (readNo === 2) controller.abort();
  } });
  await assert.rejects(aborted.ctx.loadArgosItemInquiryRows(aborted.row), /scope changed/i);
});

test('Reclass itemcode group rejects unavailable sources, missing clicked rows, and read failures', async () => {
  const unavailable = reclassRowsFixture({ sourceState: 'importing' });
  await assert.rejects(unavailable.ctx.loadArgosItemInquiryRows(unavailable.row), /ready|source|available/i);

  const missingRow = reclassRowsFixture({ rows: makeReclassRows().slice(1) });
  await assert.rejects(missingRow.ctx.loadArgosItemInquiryRows(missingRow.row), /row|uid|identity|missing/i);

  const mixedItemcode = reclassRowsFixture({ rows: [
    ...makeReclassRows(), { ...makeReclassRows()[0], unique_id: 'row-3', itemcode: 'ITEM-OTHER' },
  ] });
  await assert.rejects(mixedItemcode.ctx.loadArgosItemInquiryRows(mixedItemcode.row), /complete|locations|verified/i);

  const failedRead = reclassRowsFixture({ fetchError: new Error('temporary lookup failure') });
  await assert.rejects(failedRead.ctx.loadArgosItemInquiryRows(failedRead.row), /temporary lookup failure/);
  failedRead.ctx.fetchAllInventoryReadRows = async () => {
    const retry = makeReclassRows(failedRead.row.ITEMCODE);
    Object.defineProperty(retry, 'readMeta', {
      value: { projection: 'full', fieldCoverage: 'full', columns: inventoryContract.physicalColumns },
    });
    return retry;
  };
  const retried = await failedRead.ctx.loadArgosItemInquiryRows(failedRead.row);
  assert.equal(retried.row.UNIQUE_ID, 'row-1', 'a transient group read failure must allow a later retry');
});

test('Reclass itemcode group does not trust a mismatched permission version or malformed full-row contract', async () => {
  const permissionChanged = reclassRowsFixture({ permissionVersions: ['permission-v1', 'permission-v2'] });
  await assert.rejects(permissionChanged.ctx.loadArgosItemInquiryRows(permissionChanged.row), /permission|changed|stale/i);

  const duplicateIds = reclassRowsFixture({ rows: [makeReclassRows()[0], makeReclassRows()[0]] });
  await assert.rejects(duplicateIds.ctx.loadArgosItemInquiryRows(duplicateIds.row), /complete|duplicate|unique|row/i);

  const invalidProjection = reclassRowsFixture({ readMeta: {
    projection: 'browse', fieldCoverage: 'browse', columns: inventoryContract.columns,
  } });
  await assert.rejects(invalidProjection.ctx.loadArgosItemInquiryRows(invalidProjection.row), /full|coverage|projection|invalid/i);
});

test('explicit Reclass retry clears only the current account inventory read cooldown and denial aliases', () => {
  const identity = 'account-a';
  const ctx = {
    String, Set, Map, JSON, Array,
    REQUEST_QUEUE_LIVE_ROWS_TABLE: 'ph_request_queue',
    getSupabaseReadIdentityScope: () => identity,
    supabaseReadFailureCooldowns: new Map([
      [JSON.stringify([identity, 'inventory_read:master_page:{}']), { until: 1 }],
      [JSON.stringify([identity, 'page:ph_soc_suspend_tag_rows:select=*']), { until: 1 }],
      [JSON.stringify([identity, 'page:ph_unrelated:select=*']), { until: 1 }],
      [JSON.stringify(['account-b', 'inventory_read:master_page:{}']), { until: 1 }],
    ]),
    supabaseReadTerminalDenials: new Map([
      [JSON.stringify([identity, 'inventory_read']), { denied: true }],
      [JSON.stringify([identity, 'table:ph_soc_suspend_tag_rows']), { denied: true }],
      [JSON.stringify([identity, 'table:ph_unrelated']), { denied: true }],
      [JSON.stringify(['account-b', 'inventory_read']), { denied: true }],
    ]),
  };
  vm.createContext(ctx);
  vm.runInContext(extractAppFunction('clearSupabaseReadFailuresForVisibleContext'), ctx);
  ctx.clearSupabaseReadFailuresForVisibleContext({ adapters: [{ sourceKeys: ['ph_master_inventory', 'ph_soc_master'] }] });
  assert.deepEqual(Array.from(ctx.supabaseReadFailureCooldowns.keys(), key => JSON.parse(key)), [
    [identity, 'page:ph_unrelated:select=*'], ['account-b', 'inventory_read:master_page:{}'],
  ]);
  assert.deepEqual(Array.from(ctx.supabaseReadTerminalDenials.keys(), key => JSON.parse(key)), [
    [identity, 'table:ph_unrelated'], ['account-b', 'inventory_read'],
  ]);
});

test('Reclass opens loaded rows immediately, refreshes in the background and leaves writes to submit', () => {
  const source = extractAppFunction('openArgosInventoryTransactionModal');
  assert.match(source, /loadArgosItemInquiryRows\(item, \{ signal: controller\.signal \}\)/);
  assert.match(source, /clearSupabaseReadFailuresForVisibleContext\(\{ adapters: \[\{ sourceKeys: \['ph_master_inventory'\] \}\] \}\)/);
  assert.match(source, /owner !== getSupabaseReadIdentityScope\(\).*view !== getCurrentVisibleViewId\(\)/);
  assert.match(source, /\(verifiedGroup \|\| displayGroup\)\?\.rows \|\| getItemInquiryRows\(item\)/);
  assert.ok(source.indexOf("modal.classList.remove('hidden')") < source.indexOf('void loadArgosItemInquiryRows('));
  assert.doesNotMatch(source, /Loading Item Inquiry|Item Inquiry Unavailable|ensureMasterFullProjection/);
  assert.match(source, /shouldApplyArgosItemInquiryRefresh/);
  assert.match(extractAppFunction('submitArgosInventoryTransaction'), /postArgosInventoryTransactionPayload\(inquiryPayload\)/);
});

function suspendTagPhotoFixture(options = {}) {
  const calls = [];
  const navigation = new AbortController();
  const item = {
    UNIQUE_ID: 'dock_suspend_dc-soc-9',
    DOCK_SUSPEND_SOURCE_UID: 'soc-9',
    DOCK_SUSPEND_DC_REQUEST: true,
    SOURCE_TABLE: 'ph_soc_master',
    REQUEST_SOURCE: 'docks',
  };
  const row = {
    unique_id: 'soc-9', last_updated: '2026-10-12T10:00:00Z',
    suspend_tag_version: 3, suspend_tag_status: 'pending',
    dock_photo_link: 'old-a.jpg,old-b.jpg', dock_photo_name: 'old-a.jpg,old-b.jpg',
    dock_note: 'preserve note', dock_spec: 'preserve spec', sales_note: 'preserve sales draft',
  };
  const ctx = {
    String, Error, Object, Set, Map, Array, AbortController, Promise, JSON, Number, WeakSet,
    suspendTagPhotoProofs: new WeakSet(),
    row,
    owner: 'account-a', view: 'request', permissionVersion: 'permission-v1',
    productionLiveSyncNavigation: navigation,
    getSupabaseReadIdentityScope: () => ctx.owner,
    getProductionLiveSyncContext: () => ({ scope: ctx.owner, dataPermissionVersion: ctx.permissionVersion }),
    getCurrentVisibleViewId: () => ctx.view,
    canCurrentUserViewDockSuspendDcRequests: () => options.canView !== false,
    canCurrentUserWorkRequestItem: () => options.canWork !== false,
    canUseProductionLiveSync: () => options.canSync !== false,
    getDockSuspendDcRequestSourceUid: value => value?.DOCK_SUSPEND_SOURCE_UID || value?.unique_id || '',
    isDockSuspendDcRequestMirrorRow: value => Boolean(value?.DOCK_SUSPEND_DC_REQUEST),
    isDockSuspendDcRequestRowAnyStatus: () => options.eligible !== false,
    getDockSuspendCompletionRevision: value => String(value?.last_updated || value?.LAST_UPDATED || ''),
    withProductionLiveSyncSignal: async (externalSignal, operation) => operation(externalSignal || navigation.signal),
    window: { AgMetricLiveSync: fixtureLiveSync },
    supabaseRpc: async (name, params, rpcOptions) => {
      calls.push({ type: 'revision', name, params, options: rpcOptions });
      const revision = options.revisions?.shift() || 'revision-4';
      return { permissionVersion: options.readPermissionVersion || ctx.permissionVersion,
        sources: new Map([['ph_soc_master', { state: options.sourceState || 'ready', revision }]]) };
    },
    suspendTagApi: async (operation, params, requestOptions) => {
      calls.push({ type: 'rows', operation, params, options: requestOptions });
      if (options.readError) throw options.readError;
      return { rows: [options.row || row] };
    },
    staleSupabaseReadScopeError: () => Object.assign(new Error('scope changed'), { code: 'DATASET_READ_SCOPE_CHANGED' }),
    mergePhotoCsvList: values => Array.from(new Set(values.flatMap(value => String(value || '').split(',').map(entry => entry.trim()).filter(Boolean)))).join(','),
    persistCalls: [],
    runSuspendTagRowCommand: async (...args) => { ctx.persistCalls.push(args); return { acknowledged: true, applied: true }; },
  };
  vm.createContext(ctx);
  vm.runInContext('const suspendTagPhotoProofs = new WeakSet(); const suspendTagRowWrites = new Map();', ctx);
  vm.runInContext(extractAppFunction('serializeSuspendTagRowWrite'), ctx);
  vm.runInContext(extractAppFunction('loadCurrentSuspendTagPhotoRow'), ctx);
  vm.runInContext(extractAppFunction('isCurrentSuspendTagPhotoProof'), ctx);
  vm.runInContext(extractAppFunction('persistSuspendTagUploadedPhoto'), ctx);
  return { ctx, calls, item, row, navigation };
}

test('Suspend photo preflight authorizes only the current exact source row and current account/view', async () => {
  const { ctx, calls, item, row, navigation } = suspendTagPhotoFixture();
  const proof = await ctx.loadCurrentSuspendTagPhotoRow(item);
  assert.equal(proof.row.unique_id, 'soc-9');
  assert.equal(proof.sourceUid, 'soc-9');
  assert.equal(ctx.isCurrentSuspendTagPhotoProof(proof, item), true);
  assert.equal(ctx.isCurrentSuspendTagPhotoProof({}, item), false, 'a caller-created proof is not authorized');
  assert.equal(calls.length, 3);
  assert.equal(calls[1].operation, 'rows');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].params)), { ids: ['soc-9'] });
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].params)), { p_dataset_keys: ['ph_soc_master'] });
  assert.notEqual(proof.row, item, 'the authorized payload comes from the server source row, not the request mirror');

  ctx.owner = 'account-b';
  assert.equal(ctx.isCurrentSuspendTagPhotoProof(proof, item), false);
  ctx.owner = 'account-a'; ctx.view = 'docks';
  assert.equal(ctx.isCurrentSuspendTagPhotoProof(proof, item), false);
  ctx.view = 'request';
  assert.equal(ctx.isCurrentSuspendTagPhotoProof(proof, { ...item, DOCK_SUSPEND_SOURCE_UID: 'soc-other' }), false);
  navigation.abort();
  assert.equal(ctx.isCurrentSuspendTagPhotoProof(proof, item), false);
});

test('Suspend photo preflight rejects unready, ineligible, unauthorized, and changed source reads', async () => {
  for (const options of [
    { sourceState: 'importing' },
    { eligible: false },
    { canView: false },
    { canWork: false },
    { canSync: false },
    { readPermissionVersion: 'different-permission' },
    { revisions: ['revision-4', 'revision-5'] },
    { row: { unique_id: 'different-row', last_updated: '2026-10-12T10:00:00Z', suspend_tag_version: 1, suspend_tag_status: 'pending' } },
    { row: { unique_id: 'soc-9', last_updated: '', suspend_tag_version: 1, suspend_tag_status: 'pending' } },
  ]) {
    const { ctx, item } = suspendTagPhotoFixture(options);
    await assert.rejects(ctx.loadCurrentSuspendTagPhotoRow(item));
  }

  for (const status of ['pending', 'denied', 'completed']) {
    const { ctx, item } = suspendTagPhotoFixture({ row: {
      unique_id: 'soc-9', last_updated: '2026-10-12T10:00:00Z', suspend_tag_version: 1, suspend_tag_status: status,
    } });
    const proof = await ctx.loadCurrentSuspendTagPhotoRow(item);
    assert.equal(ctx.isCurrentSuspendTagPhotoProof(proof, item), true, `${status} rows remain photo eligible`);
  }
});

test('Suspend photo persistence re-reads the row and writes only current link/name fields at the unchanged revision', async () => {
  const { ctx, calls, item } = suspendTagPhotoFixture();
  const proof = await ctx.loadCurrentSuspendTagPhotoRow(item);
  await ctx.persistSuspendTagUploadedPhoto(item, proof, 'new.jpg', 'new.jpg');
  assert.equal(ctx.persistCalls.length, 1);
  assert.equal(ctx.persistCalls[0][0], 'save');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.persistCalls[0][2])), {
    dock_photo_link: 'old-a.jpg,old-b.jpg,new.jpg',
    dock_photo_name: 'old-a.jpg,old-b.jpg,new.jpg',
  });
  assert.equal(ctx.persistCalls[0][3], '2026-10-12T10:00:00Z');
  assert.equal(ctx.persistCalls[0][4].photoProof.sourceUid, 'soc-9');
  assert.deepEqual(Object.keys(ctx.persistCalls[0][2]).sort(), ['dock_photo_link', 'dock_photo_name']);
  assert.equal(ctx.row.dock_note, 'preserve note');
  assert.equal(ctx.row.dock_spec, 'preserve spec');
  assert.equal(ctx.row.sales_note, 'preserve sales draft');
  assert.equal(calls.filter(call => call.type === 'rows').length, 2, 'persistence verifies the authoritative row again');

  const { ctx: changedCtx, item: changedItem } = suspendTagPhotoFixture();
  const initial = await changedCtx.loadCurrentSuspendTagPhotoRow(changedItem);
  changedCtx.suspendTagApi = async () => ({ rows: [{ ...initial.row, last_updated: '2026-10-12T10:01:00Z' }] });
  await assert.rejects(changedCtx.persistSuspendTagUploadedPhoto(changedItem, initial, 'new.jpg', 'new.jpg'), /changed during photo upload/i);
  assert.equal(changedCtx.persistCalls.length, 0, 'a changed source row cannot receive the uploaded photo patch');
});

test('Suspend photo persistence keeps an acknowledged save successful when navigation makes the receipt stale', async () => {
  const { ctx, item } = suspendTagPhotoFixture();
  ctx.row.dock_note = 'preserve note';
  ctx.row.dock_spec = 'preserve spec';
  ctx.row.sales_note = 'preserve sales draft';
  ctx.runSuspendTagRowCommand = async (...args) => {
    ctx.persistCalls.push(args);
    return { acknowledged: true, applied: false };
  };
  const proof = await ctx.loadCurrentSuspendTagPhotoRow(item);
  const receipt = await ctx.persistSuspendTagUploadedPhoto(item, proof, 'new.jpg', 'new.jpg');
  assert.equal(receipt.acknowledged, true);
  assert.equal(receipt.applied, false);
  assert.equal(ctx.row.dock_note, 'preserve note');
  assert.equal(ctx.row.dock_spec, 'preserve spec');
  assert.equal(ctx.row.sales_note, 'preserve sales draft');
});

test('Suspend photo preflight can retry after a transient scoped read failure', async () => {
  const { ctx, item } = suspendTagPhotoFixture({ readError: new Error('temporary Suspend Tag read failure') });
  await assert.rejects(ctx.loadCurrentSuspendTagPhotoRow(item), /temporary Suspend Tag read failure/);
  ctx.suspendTagApi = async () => ({ rows: [{
    unique_id: 'soc-9', last_updated: '2026-10-12T10:00:00Z', suspend_tag_version: 3, suspend_tag_status: 'pending',
  }] });
  const proof = await ctx.loadCurrentSuspendTagPhotoRow(item);
  assert.equal(ctx.isCurrentSuspendTagPhotoProof(proof, item), true);
});

test('Suspend photo-only saves use a consumed scoped proof and preserve the general action proof gate', () => {
  const source = extractAppFunction('runSuspendTagRowCommand');
  assert.match(source, /const receiptRow = photoOnly \? Object\.fromEntries\(\['unique_id', 'last_updated', 'date_completed', 'suspend_tag_status',\s*'suspend_tag_version', 'dock_photo_link', 'dock_photo_name'\]/);
  assert.match(extractAppFunction('loadCurrentSuspendTagPhotoRow'), /const photoRow = Object\.fromEntries\(\['unique_id', 'last_updated', 'suspend', 'suspend_to', 'suspendto',\s*'suspend_tag_version', 'suspend_tag_status', 'dock_photo_link', 'dock_photo_name'\]/);
  assert.doesNotMatch(source.match(/const receiptRow = photoOnly[\s\S]*?: result\.row;/)?.[0] || '', /dock_note|dock_spec|sales_note|match|caliper/);
  assert.match(source, /Object\.keys\(patch\)\.length === 2/);
  assert.match(source, /\['dock_photo_link', 'dock_photo_name'\]/);
  assert.match(source, /isCurrentSuspendTagPhotoProof\(options\.photoProof, mirror\)/);
  assert.match(source, /if \(photoOnly\) suspendTagPhotoProofs\.delete\(options\.photoProof\)/);
  assert.match(source, /if \(\(!photoOnly && !writeProof && !requireCurrentSuspendTagWriteProof\(operation, mirror\)\)/);
  assert.match(source, /!photoOnly && \['save', 'complete', 'close', 'send', 'retry'\]\.includes\(operation\) && canUseProductionLiveSync\(\)/);
  assert.match(source, /await loadCurrentSuspendTagWriteRow\(mirror, operation, retryCommand\)/);
  assert.match(source, /isCurrentSuspendTagWriteRowProof\(writeProof, mirror, operation\)/);
  assert.match(source, /expectedRevision === getDockSuspendCompletionRevision\(options\.photoProof\.row\)/);
});

test('Suspend upload keeps its synchronous queue API while preflighting inside the registered upload task', () => {
  const source = extractAppFunction('queueRowPhotoUpload');
  assert.match(source, /function queueRowPhotoUpload\(/);
  assert.match(source, /const scopedSuspendTagUpload = isSuspendTagRequestUpload && \(nativeAuthSessionActive \|\| !!nativeAuthProfile\?\.id \|\| canUseProductionLiveSync\(\)\)/);
  assert.match(source, /const previousSuspendUploads = scopedSuspendTagUpload \? getPendingPhotoUploadsForItem\(itemToUpload, prefix\)\.slice\(\) : \[\]/);
  assert.match(source, /const startUpload = async \(\) =>/);
  assert.match(source, /await Promise\.allSettled\(previousSuspendUploads\)/);
  assert.match(source, /suspendPhotoProof = await loadCurrentSuspendTagPhotoRow\(itemToUpload\)/);
  assert.ok(source.indexOf('loadCurrentSuspendTagPhotoRow(itemToUpload)') < source.indexOf('uploadPhotoViaAppApi(prefix, blob'));
  assert.match(source, /if \(scopedSuspendTagUpload\) \{\s*photoReceipt = await persistSuspendTagUploadedPhoto/);
  assert.ok(source.indexOf('await persistSuspendTagUploadedPhoto') < source.indexOf('applySuspendTagUploadedPhotoEverywhere'));
  assert.match(source, /if \(!scopedSuspendTagUpload \|\| photoReceipt\.applied && isCurrentSuspendTagPhotoProof\(suspendPhotoProof, itemToUpload\)\)/);
  assert.match(source, /registerPendingPhotoUpload\(detailUploadItem, prefix, queuedUploadPromise\)/);
  assert.match(source, /if \(!scopedSuspendTagUpload\) schedulePhotoFieldPersist/);
  assert.match(source, /if \(isSuspendTagRequestUpload && !scopedSuspendTagUpload && !requireCurrentSuspendTagWriteProof/);
  assert.match(source, /registerPendingPhotoUpload\(itemToUpload, prefix, queuedUploadPromise\)/);
  assert.match(source, /registerPendingPhotoUpload\(suspendTagSourceUploadItem, prefix, queuedUploadPromise\)/);
  assert.match(source, /return true;\s*\}/);
});
