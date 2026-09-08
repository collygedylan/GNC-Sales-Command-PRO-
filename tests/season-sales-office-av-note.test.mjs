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
const formatterSource = between('function formatFetchedRows(', 'function yieldToUiFrame(');
const displaySource = between('function getSalesOfficeDisplayAvNote(', 'function getSeasonSalesOfficeSyncContext(');
const remoteSource = between('function getSeasonSalesOfficeRowsByMasterId(', 'function getSalesOfficeOrderItems(');
const completionRefreshSource = between('const protectedSeasonItemCode = getMasterItemCodeKey(', 'if (isCoordinatedAutoSave && savePayloadSignature)');
const mirror = (overrides = {}) => ({ UNIQUE_ID: 'master-1', MASTER_ID: 'master-1', SO_SOURCE: 'season', AV_NOTE: 'USER NOTE', STATE_REVISION: 7, ITEMCODE: 'TEST-1', ...overrides });

function harness(options = {}) {
  const calls = [];
  const master = { UNIQUE_ID: 'master-1', ITEMCODE: 'TEST-1', AV_NOTE: 'NEW CAV NOTE', PTRAVAILABLE: 42, APP_TAB_ASSIGNMENT: 'season' };
  const ctx = {
    Object, String, Array, Number, Date, Promise,
    navigator: { onLine: true },
    crypto: { randomUUID: () => `test-${calls.length}` },
    firstNonEmptyValue: (...values) => values.find((value) => value !== null && value !== undefined && String(value).trim() !== '') ?? '',
    normalizeAppTableName: (value) => value,
    normalizeRowPhotoFields: (row) => row,
    repairDisplayFieldsOnRow: (row) => row,
    buildSearchIndex: (row) => row,
    parseAppNumber: (value) => value === '' ? null : Number(value),
    LINKED_ROW_SYNC_KEYS: ['AV_NOTE', 'PTRAVAILABLE'],
    syncMasterFieldsToRow: (source, row, keys) => { keys.forEach((key) => { row[key] = source[key]; }); },
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
  };
  vm.createContext(ctx);
  vm.runInContext(`${ownedStateSource}\n${formatterSource}\n${displaySource}\n${remoteSource}\nfunction completionRefresh(artifacts, itemToSave, trackedChangeFlags, hasProtectedSeasonArtifacts = true) { ${completionRefreshSource}\nreturn refreshProtectedSeasonOffice; }`, ctx);
  return { ctx, calls, master };
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
