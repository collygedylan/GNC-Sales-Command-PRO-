import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function source(name) {
  const start = html.search(new RegExp(`        (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const end = html.slice(start + 1).search(/\r?\n        (?:async )?function \w+\(/);
  return html.slice(start, start + end + 1);
}

function fixture() {
  const full = [{ id: 'other' }], pending = [{ id: 'pending', group: 'one' }], calls = [];
  const ctx = vm.createContext({
    activeView: 'request', activeReqTab: 'suspend-tag', activeDetailSourceView: '',
    getCurrentVisibleViewId: () => ctx.activeView,
    socInventory: full, suspendTagInventory: pending, suspendTagInventoryScope: 'account-a',
    scope: 'account-a', getSupabaseReadIdentityScope: () => ctx.scope,
    getDockSuspendDcRequestGroupParts: item => ({ key: item?.group, canGroup: true }),
    isDockSuspendDcRequestRowAnyStatus: () => true,
    firstNonEmptyValue: (...values) => values.find(value => value !== '' && value != null),
    withProductionLiveSyncSignal: (_signal, run) => run(new AbortController().signal),
    fetchAllSupabaseRows: async (...args) => { calls.push(args); return [
      ...pending, { id: 'completed', group: 'one', DATE_COMPLETED: '2026-10-01' }, { id: 'unrelated', group: 'two' },
    ]; },
    hydrateDockSourceRows: rows => rows,
    formatFetchedRows: rows => rows,
    staleSupabaseReadScopeError: () => new Error('scope changed'),
  });
  vm.runInContext(['getDockSuspendDcSourceRows', 'getDockSuspendDcRequestGroupRows', 'loadDockSuspendDcRequestGroupRows'].map(source).join('\n'), ctx);
  return { ctx, full, pending, calls };
}

test('filtered cache stays distinct from Docks SOC and cannot cross account identity', () => {
  const { ctx, pending, full } = fixture();
  assert.equal(ctx.getDockSuspendDcSourceRows(), pending);
  ctx.activeView = 'docks';
  assert.equal(ctx.getDockSuspendDcSourceRows(), full);
  ctx.activeView = 'request'; ctx.scope = 'account-b';
  assert.equal(ctx.getDockSuspendDcSourceRows().length, 0);
  assert.equal(ctx.socInventory, full);
});

test('email details fetch completed siblings only on demand without widening the pending cache', async () => {
  const { ctx, calls, full, pending } = fixture();
  assert.equal(calls.length, 0);
  const rows = await ctx.loadDockSuspendDcRequestGroupRows({ group: 'one', ITEMCODE: 'SKU/1' });
  assert.deepEqual(Array.from(rows, row => row.id), ['pending', 'completed']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'ph_soc_master');
  assert.match(calls[0][1], /itemcode=eq.SKU%2F1/);
  assert.equal(calls[0][2].requireComplete, true);
  assert.equal(ctx.suspendTagInventory, pending);
  assert.equal(ctx.socInventory, full);
});

test('on-demand group reads reject a late response after account change', async () => {
  const { ctx } = fixture();
  ctx.fetchAllSupabaseRows = async () => { ctx.scope = 'account-b'; return []; };
  await assert.rejects(ctx.loadDockSuspendDcRequestGroupRows({ group: 'one', ITEMCODE: 'SKU1' }), /scope changed/);
});

test('master-only rehydration starts from raw SOC and recomputes assignment/link visibility while preserving SOC-owned values', () => {
  const masters = new Map([['soc-1', { unique_id: 'master-1', APP_TAB_ASSIGNMENT: 'docks' }]]);
  const context = vm.createContext({
    REQUEST_ROW_OWNED_SYNC_KEYS: ['AV_NOTE', 'MATCH', 'DATE_COMPLETED', 'PHOTO_LINK', 'PHOTO_NAME'],
    firstNonEmptyValue: (...values) => values.find(value => value !== '' && value != null),
    normalizeSocDockRowAliases: () => {},
    normalizeDockIssueSourceUniqueId: value => value,
    findLinkedMasterRow: row => masters.get(row.unique_id) || null,
    syncMasterFieldsToRequestRow: (master, row) => {
      const owned = row.AV_NOTE;
      row.MASTER_ID = master.unique_id;
      row.APP_TAB_ASSIGNMENT = master.APP_TAB_ASSIGNMENT;
      row.AV_NOTE = owned;
    },
    stampDockIssueSourceIdentity: () => {},
    normalizeRowPhotoFields: () => {},
    buildSearchIndex: () => {},
    isEvalScopedDataRowVisibleToCurrentUser: row => row.APP_TAB_ASSIGNMENT !== 'hidden',
  });
  vm.runInContext([
    source('cloneDockSourceRows'),
    "const DOCK_SOURCE_LOCAL_PRESERVE_KEYS = Object.freeze(Array.from(new Set([...REQUEST_ROW_OWNED_SYNC_KEYS, 'DOCK_SPEC', 'dock_spec', 'DOCK_CALIPER', 'dock_caliper', 'DOCK_NOTE', 'dock_note', 'DOCK_PHOTO_LINK', 'dock_photo_link', 'DOCKPHOTO_LINK', 'dockphoto_link', 'DOCK_PHOTO_NAME', 'dock_photo_name', 'DOCKPHOTO_NAME', 'dockphoto_name', 'SUSPEND', 'suspend', 'SUSPEND_TO', 'suspend_to', 'DATE_COMPLETED', 'date_completed', 'LAST_UPDATED', 'last_updated'])));",
    source('buildDockSourceRowsForMasterRefresh'),
    source('hydrateDockSourceRows'),
  ].join('\n'), context);

  const raw = [{ unique_id: 'soc-1', av_note: 'source note', dock_photo_link: 'https://example.test/photo.jpg', suspend: 'SUSPEND', suspend_to: 'DC', date_completed: null }];
  const initiallyHydrated = context.hydrateDockSourceRows(context.cloneDockSourceRows(raw));
  assert.equal(initiallyHydrated[0].APP_TAB_ASSIGNMENT, 'docks');
  initiallyHydrated[0].AV_NOTE = 'local note';
  initiallyHydrated[0].MATCH = '80';
  initiallyHydrated[0].DOCK_PHOTO_LINK = 'https://example.test/new.jpg';

  masters.set('soc-1', { unique_id: 'master-2', APP_TAB_ASSIGNMENT: 'hidden' });
  const reassignedSource = context.buildDockSourceRowsForMasterRefresh(raw, initiallyHydrated);
  assert.equal(Object.hasOwn(reassignedSource[0], 'APP_TAB_ASSIGNMENT'), false);
  assert.equal(Object.hasOwn(reassignedSource[0], 'MASTER_ID'), false);
  assert.equal(reassignedSource[0].AV_NOTE, 'local note');
  assert.equal(reassignedSource[0].MATCH, '80');
  assert.equal(reassignedSource[0].DOCK_PHOTO_LINK, 'https://example.test/new.jpg');
  assert.equal(context.hydrateDockSourceRows(reassignedSource).length, 0, 'new assignment removes the row from this user scope');

  masters.delete('soc-1');
  const unlinkedSource = context.buildDockSourceRowsForMasterRefresh(raw, initiallyHydrated);
  const unlinked = context.hydrateDockSourceRows(unlinkedSource);
  assert.equal(unlinked.length, 1, 'removing the old link clears stale assignment and restores visibility');
  assert.equal(unlinked[0].APP_TAB_ASSIGNMENT, undefined);
  assert.equal(unlinked[0].MASTER_ID, undefined);
  assert.equal(unlinked[0].AV_NOTE, 'local note');
  assert.equal(unlinked[0].date_completed, null);
  assert.equal(raw[0].APP_TAB_ASSIGNMENT, undefined, 'hydration never mutates the immutable raw source');
  const restoredAfterEmptyScope = context.hydrateDockSourceRows(context.buildDockSourceRowsForMasterRefresh(raw, []));
  assert.equal(restoredAfterEmptyScope.length, 1, 'the immutable snapshot can restore rows after prior filtering removed every row');

  const pendingLocal = { unique_id: 'soc-new', suspend: 'SUSPEND', suspend_to: 'DC', date_completed: null,
    APP_TAB_ASSIGNMENT: 'stale', MASTER_ID: 'removed-master', dock_photo_link: 'https://example.test/pending.jpg' };
  const withPendingLocal = context.buildDockSourceRowsForMasterRefresh(raw, [...initiallyHydrated, pendingLocal],
    row => row.suspend === 'SUSPEND' && row.date_completed == null);
  assert.deepEqual(Array.from(withPendingLocal, row => row.unique_id), ['soc-1', 'soc-new'],
    'a locally pending insert absent from the last raw snapshot stays available during a master-only refresh');
  assert.equal(withPendingLocal[1].APP_TAB_ASSIGNMENT, undefined);
  assert.equal(withPendingLocal[1].MASTER_ID, undefined);
  assert.match(html, /if \(hasSoc \|\| \(hasMaster && socRawSourceRowsReady\)\)/,
    'master-only refresh does not fall back to possibly stale display rows after raw-source reset');
  assert.match(html, /socRawSourceRows = \[\];\s*suspendTagRawSourceRows = \[\];\s*socRawSourceRowsReady = false;\s*suspendTagRawSourceRowsReady = false;/,
    'identity/session reset clears both source snapshots and their initialized markers');
});
