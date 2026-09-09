import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function between(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing AV Note source: ${start}`);
  return html.slice(from, to);
}

const ownedStateSource = between('function getSeasonSalesOfficeOwnedAvNote(', 'function maybeAdoptSalesOfficeOwnedStateToMaster(');
const adoptionSource = between('function maybeAdoptSalesOfficeOwnedStateToMaster(', 'function getRowPhotoLink(');
const photoOwnedValueSource = between('function getLocPhotoOwnedValue(', 'function parseLocPhotoEvidenceTimestamp(');
const normalizePhotoSource = between('function normalizeRowPhotoFields(', 'function getSharedAppPhotoName(');
const masterSyncSource = between('function syncMasterFieldsToRow(', 'const REQUEST_ROW_OWNED_SYNC_KEYS');
const clearPayloadSource = between('function buildMasterAvRuleClearPayload(', 'function getDetailPhotoUrls(');
const explicitClearSource = between('async function clearCurrentSectionData(', 'function movePhotoInSet(');
const officeHydrationSource = between('function syncRealtimeSalesOfficeRows(', 'function syncRealtimeReserveRows(');
const fieldDisplaySource = between('function getItemDisplayValue(', 'function normalizeSpecIdentityValue(');
const formatterSource = between('function formatFetchedRows(', 'function yieldToUiFrame(');
const displaySource = between('function getSalesOfficeDisplayAvNote(', 'function getSeasonSalesOfficeSyncContext(');
const remoteSource = between('function getSeasonSalesOfficeRowsByMasterId(', 'function getSalesOfficeOrderItems(');
const realtimeDetailSource = between('function refreshActiveMasterDetailFromRealtimeRow(', 'function normalizeAppLiveEventRow(');
const completionRefreshSource = between('const protectedSeasonItemCode = getMasterItemCodeKey(', 'if (isCoordinatedAutoSave && savePayloadSignature)');
const mirror = (overrides = {}) => ({ UNIQUE_ID: 'master-1', MASTER_ID: 'master-1', SO_SOURCE: 'season', AV_NOTE: 'USER NOTE', STATE_REVISION: 7, ITEMCODE: 'TEST-1', ...overrides });

function harness(options = {}) {
  const calls = [];
  const writes = [];
  const rendered = [];
  const master = { UNIQUE_ID: 'master-1', ITEMCODE: 'TEST-1', AV_NOTE: 'NEW CAV NOTE', PTRAVAILABLE: 42, APP_TAB_ASSIGNMENT: 'season' };
  const ctx = {
    Object, String, Array, Number, Date, Promise,
    navigator: { onLine: true },
    crypto: { randomUUID: () => `test-${calls.length}` },
    firstNonEmptyValue: (...values) => values.find((value) => value !== null && value !== undefined && String(value).trim() !== '') ?? '',
    normalizeAppTableName: (value) => value,
    normalizeFlyerShadowFields: (row) => row,
    sortPhotoCsvPairByCaptureOrder: (photoCsv, photoNameCsv) => ({ photoCsv: String(photoCsv ?? ''), photoNameCsv: String(photoNameCsv ?? '') }),
    mergePhotoCsvList: (values) => values.filter(Boolean).join(','),
    getSharedAppPhotoName: (row) => row.SAVED_PHOTO_NAME || '',
    repairDisplayFieldsOnRow: (row) => row,
    buildSearchIndex: (row) => row,
    parseAppNumber: (value) => value === '' ? null : Number(value),
    LINKED_ROW_SYNC_KEYS: ['AV_NOTE', 'SPEC', 'CALIPER', 'SALES_NOTE', 'PTRAVAILABLE'],
    clonePhotoFields: (source, row) => { row.PHOTO_LINK = source.PHOTO_LINK ?? ''; row.PHOTO_NAME = source.PHOTO_NAME ?? ''; },
    syncSharedFlyerPhotoFields() {},
    findLinkedMasterRow: () => master,
    findItemByUniqueId: () => master,
    fullInventory: [master],
    salesOfficeInventory: options.rows ?? [mirror()],
    isBloomPickerSalesOfficeItem: (row) => row.SO_SOURCE === 'bloom_picker',
    getMasterItemCodeKey: (row) => row?.ITEMCODE || '',
    invalidateSalesOfficeLocalState() {},
    seasonSalesOfficeApi: async (operation, payload, apiOptions) => {
      calls.push({ operation, payload, options: apiOptions });
      if (options.api) return options.api(operation, payload, apiOptions);
      return operation === 'save_av_note'
        ? { avNote: payload.avNote || null, revision: payload.expectedRevision + 1, readinessStatus: 'needs_photo_data', workflowDetail: { missing: ['photo'] } }
        : { ok: true };
    },
    refreshSeasonSalesOfficeDataset: async () => { calls.push({ operation: 'dataset' }); },
    syncSeasonSalesOfficeStateForItemCodes: (itemCodes) => {
      calls.push({ operation: 'completion_refresh', itemCodes });
      return [Promise.resolve(true)];
    },
    isViewVisible: () => true,
    hasCompletionDateValue: () => false,
    scheduleUiRender() {},
    lastView: 'sales-office',
    activeItem: null,
    activeDetailTab: 'gallery',
    hasActiveTextEntryFocus: () => false,
    refreshDetailInputsFromActiveItem: () => rendered.push({ avNote: ctx.activeItem.AV_NOTE, spec: ctx.activeItem.SPEC, photo: ctx.activeItem.PHOTO_LINK }),
    renderSavedPhotos() {},
    renderPhotoGallery() {},
    refreshProtectedSections() {},
    isAcknowledgedSeasonSalesOfficeRow: () => false,
    isSalesOfficeComplete: () => false,
    isSalesOfficeMoveSource: () => false,
    avRuleColumnsReady: true,
    REQUEST_REALTIME_UI_DELAY_MS: 18,
    getPrioritySnapshotFromItem: (row) => row.PRIORITY || '',
    getHoldStopSnapshotFromItem: (row) => row.HOLDSTOPCODE || '',
    canEditRowDetails: () => true,
    isProtectedSectionCompleted: () => false,
    isFlyerFolderRow: () => false,
    getDatasetKeysForTable: () => [],
    getVisibleAffectedViewIds: () => [],
    propagateCommittedEdit() {},
    supabaseFetch: async (...args) => { writes.push(args); },
    showToast() {},
  };
  vm.createContext(ctx);
  vm.runInContext(`${photoOwnedValueSource}\n${normalizePhotoSource}\n${masterSyncSource}\n${ownedStateSource}\n${adoptionSource}\n${formatterSource}\n${displaySource}\n${remoteSource}\n${realtimeDetailSource}\n${clearPayloadSource}\n${explicitClearSource}\n${officeHydrationSource}\n${fieldDisplaySource}\nfunction completionRefresh(artifacts, itemToSave, trackedChangeFlags, hasProtectedSeasonArtifacts = true) { ${completionRefreshSource}\nreturn refreshProtectedSeasonOffice; }`, ctx);
  return { ctx, calls, master, writes, rendered };
}

test('a saved Season AV Note survives fresh data hydration and repeated imported master changes', () => {
  const { ctx, master } = harness();
  const raw = { unique_id: 'master-1', so_source: 'season', av_note: ' USER ENTERED NOTE ', ptravailable: 12 };
  for (const importedNote of ['NEW CAV NOTE', '', null]) {
    master.AV_NOTE = importedNote;
    const row = ctx.formatFetchedRows([raw], 'ph_sales_office')[0];
    ctx.syncMasterFieldsToSalesOfficeRow(master, row);
    assert.equal(row.AV_NOTE, 'USER ENTERED NOTE');
    assert.equal(row.av_note, 'USER ENTERED NOTE');
    assert.equal(row.PTRAVAILABLE, 42, 'catalog fields still receive current inventory data');
    assert.equal(ctx.getSalesOfficeDisplayAvNote(row, 'No AV Note Provided'), 'USER ENTERED NOTE');
  }
});

test('an explicitly cleared Season AV Note remains blank after null formatting, hydration, and display', () => {
  const { ctx, master } = harness();
  for (const avNote of [null, '', '   ']) {
    const row = ctx.formatFetchedRows([{ unique_id: 'master-1', so_source: 'season', av_note: avNote }], 'ph_sales_office')[0];
    assert.ok(Object.hasOwn(row, 'AV_NOTE'), 'a database null still represents an owned note');
    ctx.syncMasterFieldsToSalesOfficeRow(master, row);
    assert.equal(row.AV_NOTE, '');
    assert.equal(row.av_note, '');
    assert.equal(ctx.getSalesOfficeDisplayAvNote(row), '');
    assert.equal(ctx.getSalesOfficeDisplayAvNote(row, 'No AV Note Provided'), 'No AV Note Provided');
  }
  const staleAlias = mirror({ AV_NOTE: '', av_note: 'STALE ALIAS' });
  ctx.syncMasterFieldsToSalesOfficeRow(master, staleAlias);
  assert.equal(staleAlias.AV_NOTE, '');
  assert.equal(staleAlias.av_note, '');
  assert.equal(ctx.getSalesOfficeDisplayAvNote({ SO_SOURCE: 'season', av_note: 'RAW NOTE' }), 'RAW NOTE');
});

test('master realtime updates preserve the active Sales Office snapshot and source identity', () => {
  for (const uniqueId of ['master-1', 'linked-mirror-1']) {
    for (const note of ['USER NOTE', '']) {
      const { ctx, master } = harness();
      const row = mirror({ UNIQUE_ID: uniqueId, AV_NOTE: note, SOURCE_TABLE: 'ph_sales_office', source_table: 'ph_sales_office', DOM_ID: `so_${uniqueId}`, PTRAVAILABLE: 12 });
      ctx.salesOfficeInventory = [row];
      ctx.activeItem = row;
      assert.equal(ctx.refreshActiveMasterDetailFromRealtimeRow({ ...master, SOURCE_TABLE: 'ph_master_inventory', source_table: 'ph_master_inventory', DOM_ID: 'master_master-1' }, 'UPDATE'), true);
      assert.equal(row.AV_NOTE, note);
      assert.equal(row.av_note, note);
      assert.equal(row.SOURCE_TABLE, 'ph_sales_office');
      assert.equal(row.source_table, 'ph_sales_office');
      assert.equal(row.DOM_ID, `so_${uniqueId}`);
      assert.equal(row.UNIQUE_ID, uniqueId);
      assert.equal(row.STATE_REVISION, 7);
      assert.equal(row.PTRAVAILABLE, 42, 'current master inventory fields still refresh');
      assert.equal(ctx.getSalesOfficeDisplayAvNote(ctx.salesOfficeInventory[0]), note);
    }
  }
});

test('master detail realtime updates keep their existing direct-merge behavior', () => {
  const { ctx, master } = harness();
  ctx.activeItem = { ...master, AV_NOTE: 'OLD MASTER NOTE', SOURCE_TABLE: 'ph_master_inventory' };
  ctx.refreshActiveMasterDetailFromRealtimeRow({ ...master, AV_NOTE: 'NEW MASTER NOTE', SOURCE_TABLE: 'ph_master_inventory', IMPORTED_FIELD: 'CURRENT' }, 'UPDATE');
  assert.equal(ctx.activeItem.AV_NOTE, 'NEW MASTER NOTE');
  assert.equal(ctx.activeItem.IMPORTED_FIELD, 'CURRENT');
});

test('authoritative cleared Season snapshots clear note, spec and photo aliases in active detail', () => {
  const { ctx, master, rendered } = harness();
  Object.assign(master, { SPEC: 'OLD MASTER SPEC', CALIPER: 'OLD CALIPER', PHOTO_LINK: 'https://old-master-photo', PHOTO_NAME: 'old-master-photo' });
  ctx.activeItem = mirror({ SOURCE_TABLE: 'ph_sales_office', SPEC: 'OLD SPEC', spec: 'STALE ALIAS', CALIPER: 'OLD CALIPER', PHOTO_LINK: 'https://old-office-photo', SAVED_PHOTO_LINK: 'https://old-office-photo', PHOTO_NAME: 'old-office-photo', SAVED_PHOTO_NAME: 'old-office-photo', DOM_ID: 'so_master-1' });
  const cleared = ctx.formatFetchedRows([{ unique_id: 'master-1', master_id: 'master-1', so_source: 'season', av_note: null, spec: null, caliper: null, photo_link: null, photo_name: null, state_revision: 8, workflow_detail: { reasons: ['explicit_clear_data'] } }], 'ph_sales_office')[0];
  assert.equal(cleared.SPEC, null, 'the authoritative SQL null survives formatting');
  ctx.salesOfficeInventory = [cleared];
  ctx.scheduleUiRender = (_key, render) => render();
  ctx.syncRealtimeSalesOfficeRows();
  for (const row of [ctx.salesOfficeInventory[0], ctx.activeItem]) {
    for (const field of ['AV_NOTE', 'av_note', 'SPEC', 'spec', 'CALIPER', 'caliper', 'PHOTO_LINK', 'SAVED_PHOTO_LINK', 'PHOTOLINK', 'PHOTO_NAME', 'SAVED_PHOTO_NAME']) {
      assert.equal(row[field], '', `${field} stays authoritatively cleared despite stale master data`);
    }
    assert.equal(ctx.getSalesOfficeDisplayAvNote(row), '');
    row.ITEMSPEC = 'CATALOG FALLBACK';
    assert.equal(ctx.getItemDisplayValue(row, 'SPEC', 'sales-office'), '', 'cleared measured spec cannot fall back to catalog text');
    assert.equal(row.STATE_REVISION, 8);
    assert.equal(row.SOURCE_TABLE, 'ph_sales_office');
  }
  assert.deepEqual(rendered, [{ avNote: '', spec: '', photo: '' }]);
});

test('an older office event cannot restore an active detail cleared by a newer reset', () => {
  const { ctx } = harness();
  ctx.activeItem = mirror({ SOURCE_TABLE: 'ph_sales_office', AV_NOTE: '', SPEC: '', PHOTO_LINK: '', STATE_REVISION: 9 });
  const stale = mirror({ SOURCE_TABLE: 'ph_sales_office', AV_NOTE: 'OLD NOTE', SPEC: 'OLD SPEC', PHOTO_LINK: 'https://old-photo', STATE_REVISION: 8 });
  assert.equal(ctx.refreshActiveSalesOfficeDetailFromRow(stale), false);
  assert.equal(ctx.activeItem.AV_NOTE, '');
  assert.equal(ctx.activeItem.SPEC, '');
  assert.equal(ctx.activeItem.PHOTO_LINK, '');
});

test('reading a Season snapshot never repopulates cleared master evidence or creates field timestamps', () => {
  const { ctx } = harness();
  const clearedMaster = { UNIQUE_ID: 'master-1', AV_NOTE: '', SPEC: '', PHOTO_LINK: '', DATE_COMPLETED: '', AV_RULE_LAST_CLEARED_AT: '2026-09-09T00:00:00Z', AV_RULE_LAST_CLEAR_REASON: 'stale_10_day' };
  const before = JSON.stringify(clearedMaster);
  const staleOffice = mirror({ SPEC: 'OLD SPEC', PHOTO_LINK: 'https://old-photo', SAVED_PHOTO_LINK: 'https://old-photo', UPDATED_AT: new Date().toISOString() });
  assert.equal(ctx.maybeAdoptSalesOfficeOwnedStateToMaster(clearedMaster, staleOffice), false);
  assert.equal(JSON.stringify(clearedMaster), before);
});

test('missing or invalid photo readiness does not itself clear a staged note', () => {
  const { ctx, master } = harness();
  Object.assign(master, { AV_NOTE: null, SPEC: null, PHOTO_LINK: null });
  for (const reason of ['photo_missing', 'photo_stale', 'photo_invalid', 'spec_missing']) {
    const row = mirror({ SOURCE_TABLE: 'ph_sales_office', WORKFLOW_DETAIL: { ready: false, reasons: [reason] }, PHOTO_LINK: '' });
    ctx.syncMasterFieldsToSalesOfficeRow(master, row);
    assert.equal(row.AV_NOTE, 'USER NOTE');
  }
});

test('explicit shared Clear Data writes the full reset marker without freshening any evidence', async () => {
  for (const prefix of ['ssn-', 'lsn-', 'na-']) {
    const { ctx, writes } = harness();
    ctx.avRuleColumnsReady = false;
    ctx.activeItem = { UNIQUE_ID: 'master-1', SOURCE_TABLE: 'ph_master_inventory', PRIORITY: '1', AV_NOTE: 'USER NOTE', SPEC: 'SPEC', PHOTO_LINK: 'https://photo', PHOTO_NAME: 'photo', DATE_COMPLETED: '2026-09-01T00:00:00Z' };
    assert.equal(await ctx.clearCurrentSectionData(prefix), true);
    assert.equal(writes.length, 1);
    const [table, method, payload] = writes[0];
    assert.equal(table, 'ph_master_inventory');
    assert.equal(method, 'PATCH');
    assert.equal(payload.av_rule_last_clear_reason, 'explicit_clear_data');
    assert.ok(Number.isFinite(Date.parse(payload.av_rule_last_cleared_at)));
    for (const field of ['av_note', 'spec', 'caliper', 'photo_link', 'photo_name', 'match', 'loc_match_qty', 'date_completed', 'av_rule_bundle_updated_at', 'av_rule_av_note_updated_at', 'av_rule_spec_updated_at', 'av_rule_photo_updated_at']) assert.equal(payload[field], null, field);
    assert.equal(ctx.activeItem.AV_RULE_LAST_CLEARED_AT, payload.av_rule_last_cleared_at);
    assert.equal(ctx.activeItem.AV_RULE_LAST_CLEAR_REASON, 'explicit_clear_data');
    assert.equal(ctx.activeItem.AV_NOTE, '');
    assert.equal(ctx.activeItem.SPEC, '');
    assert.equal(ctx.activeItem.PHOTO_LINK, '');
  }
});

test('removing the last photo with Keep Data preserves note and spec without a bundle reset', async () => {
  const { ctx, writes } = harness();
  const saves = [];
  ctx.activeItem = { UNIQUE_ID: 'master-1', SOURCE_TABLE: 'ph_master_inventory', AV_NOTE: 'KEEP NOTE', SPEC: 'KEEP SPEC', PHOTO_LINK: 'https://photo' };
  ctx.getProtectedEditConfig = () => ({});
  ctx.canRemoveProtectedPhoto = () => true;
  ctx.resolvePhotoDeleteTargetUrl = () => 'https://photo';
  ctx.removePhotoFromAliasFields = (row) => { const removed = !!row.PHOTO_LINK; row.PHOTO_LINK = ''; return { removed }; };
  ctx.syncRowDataAcrossViews = () => {};
  ctx.refreshPhotoAcrossViews = () => {};
  ctx.saveData = (...args) => saves.push(args);
  ctx.parsePhotoCsvValues = (value) => String(value || '').split(',').filter(Boolean);
  ctx.getCompletionPhotoCsvForPrefix = () => '';
  ctx.sectionHasEnteredRowData = () => true;
  ctx.showAppConfirm = async () => false;
  await ctx.removePhotoAtIndex('ssn-', 0);
  assert.equal(ctx.activeItem.AV_NOTE, 'KEEP NOTE');
  assert.equal(ctx.activeItem.SPEC, 'KEEP SPEC');
  assert.equal(ctx.activeItem.AV_RULE_LAST_CLEARED_AT, undefined);
  assert.equal(writes.length, 0, 'Keep Data never invokes the full-section clear PATCH');
  assert.equal(saves.length, 1);
  assert.equal(saves[0][4].photoChanged, true);
});

test('non-Season notes retain their prior fallback and hydration behavior', () => {
  const { ctx, master } = harness();
  for (const source of ['bloom_picker', 'moves', 'flyer_folder']) {
    const row = mirror({ SO_SOURCE: source, AV_NOTE: '' });
    assert.equal(ctx.getSalesOfficeDisplayAvNote(row), master.AV_NOTE);
    ctx.syncMasterFieldsToSalesOfficeRow(master, row);
    assert.equal(row.AV_NOTE, master.AV_NOTE);
    row.AV_NOTE = 'OWN NOTE';
    ctx.syncMasterFieldsToSalesOfficeRow(master, row);
    assert.equal(row.AV_NOTE, 'OWN NOTE');
    const preserved = ctx.captureSalesOfficeOwnedState({ SO_SOURCE: source, SALESNOTE: 'LEGACY SALES', sales_note: 'LOWER SALES', SAVED_PHOTO_LINK: 'SAVED PHOTO', PHOTO_LINK: 'CANONICAL PHOTO' });
    assert.equal(preserved.SALES_NOTE, 'LEGACY SALES');
    assert.equal(preserved.SAVED_PHOTO_LINK, 'SAVED PHOTO');
    assert.equal(Object.hasOwn(ctx.formatFetchedRows([{ so_source: source, spec: null }], 'ph_sales_office')[0], 'SPEC'), false);
  }
  assert.equal(Object.hasOwn(ctx.formatFetchedRows([{ av_note: null }], 'ph_master_inventory')[0], 'AV_NOTE'), false);
  assert.equal(ctx.getSalesOfficeDisplayAvNote({ SO_SOURCE: 'season' }), master.AV_NOTE, 'legacy snapshots without a note field can still hydrate');
});

test('explicit detail edits save the retained note with the current revision before reconciliation', async () => {
  const { ctx, calls } = harness();
  await ctx.syncSeasonSalesOfficeAvNoteRemote('master-1', ' edited by user ');
  assert.deepEqual(calls.map((call) => call.operation), ['save_av_note', 'refresh', 'dataset']);
  assert.equal(calls[0].payload.avNote, 'EDITED BY USER');
  assert.equal(calls[0].payload.expectedRevision, 7);
  assert.equal(calls[0].payload.idempotencyKey, calls[0].options.idempotencyKey);
  assert.equal(ctx.salesOfficeInventory[0].AV_NOTE, 'EDITED BY USER');
  assert.equal(ctx.salesOfficeInventory[0].STATE_REVISION, 8);
  assert.equal(ctx.salesOfficeInventory[0].state_revision, 8);
  calls.length = 0;
  await ctx.syncSeasonSalesOfficeAvNoteRemote('master-1', '');
  assert.equal(calls[0].payload.expectedRevision, 8);
  assert.equal(calls[0].payload.avNote, '');
  assert.equal(ctx.salesOfficeInventory[0].AV_NOTE, '', 'a null response is an acknowledged explicit clear');
  assert.equal(ctx.salesOfficeInventory[0].STATE_REVISION, 9);
  assert.equal(ctx.salesOfficeInventory[0].WORKFLOW_STATUS, 'needs_photo_data');
});

test('initial staging captures the existing master note without a redundant protected edit', async () => {
  const { ctx, calls } = harness({ rows: [] });
  await ctx.syncSeasonSalesOfficeAvNoteRemote('master-1', 'FIRST NOTE');
  assert.deepEqual(calls.map((call) => call.operation), ['refresh', 'dataset']);
  const otherSource = harness({ rows: [mirror({ SO_SOURCE: 'bloom_picker' })] });
  assert.equal(await otherSource.ctx.saveSeasonSalesOfficeAvNoteSnapshot('master-1', 'IGNORE'), false);
  assert.equal(otherSource.calls.length, 0);
});

test('a rejected revision never falls through to reconciliation or advances the local snapshot', async () => {
  const conflict = Object.assign(new Error('SEASON_SALES_STALE_REVISION'), { status: 409 });
  const { ctx, calls } = harness({ api: () => { throw conflict; } });
  await assert.rejects(ctx.syncSeasonSalesOfficeAvNoteRemote('master-1', 'REJECTED'), /SEASON_SALES_STALE_REVISION/);
  assert.deepEqual(calls.map((call) => call.operation), ['save_av_note']);
  assert.equal(ctx.salesOfficeInventory[0].STATE_REVISION, 7);
  assert.equal(ctx.salesOfficeInventory[0].AV_NOTE, 'USER NOTE');
});

test('completion saves an existing staged note once before its dependent refreshes', async () => {
  let acknowledge;
  const pending = new Promise((resolve) => { acknowledge = resolve; });
  const { ctx, calls, master } = harness({ api: () => pending });
  const refresh = ctx.completionRefresh({ soPayload: { master_id: 'master-1', av_note: 'COMPLETION EDIT' }, masterSyncItem: master }, master, { avNote: true });
  const first = refresh('completion');
  const second = refresh('master-sync');
  assert.deepEqual(calls.map((call) => call.operation), ['save_av_note']);
  acknowledge({ avNote: 'COMPLETION EDIT', revision: 8 });
  await Promise.all([first, second]);
  assert.deepEqual(calls.map((call) => call.operation), ['save_av_note', 'completion_refresh', 'completion_refresh']);
  assert.equal(ctx.salesOfficeInventory[0].AV_NOTE, 'COMPLETION EDIT');
});

test('first completion never turns a newly staged row into another user edit', async () => {
  const { ctx, calls, master } = harness({ rows: [] });
  const refresh = ctx.completionRefresh({ soPayload: { master_id: 'master-1', av_note: 'FIRST NOTE' }, masterSyncItem: master }, master, { avNote: true });
  await refresh('completion');
  ctx.salesOfficeInventory.push(mirror({ AV_NOTE: 'FIRST NOTE' }));
  await refresh('master-sync');
  assert.deepEqual(calls.map((call) => call.operation), ['completion_refresh', 'completion_refresh']);
});
