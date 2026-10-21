import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readComposedAppSource().replace(/\r\n/g, '\n');
function extract(name) {
  const start = html.indexOf(`        function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const next = html.slice(start + 1).search(/\n        (?:async )?function \w+\(/);
  return html.slice(start, next < 0 ? undefined : start + 1 + next);
}

test('direct Suspend rerender projects asynchronously hydrated inventory photo and evaluation evidence', () => {
  const source = { UNIQUE_ID: 'soc-448', ITEMCODE: '004380.010.1', LOCATIONCODE: 'C.09.000', LOTCODE: '27.F1', SOURCE: 'SOC' };
  const mirror = { UNIQUE_ID: 'dock_suspend_dc_soc-448', DOCK_SUSPEND_DC_REQUEST: true, SOURCE_TABLE: 'ph_soc_master',
    REQUEST_SOURCE: 'docks', ITEMCODE: '004380.010.1', LOCATIONCODE: 'C.09.000', LOTCODE: '27.F1' };
  const canonical = { UNIQUE_ID: 'master-448', ITEMCODE: '004380.010.1', LOCATIONCODE: 'C.09.000', LOTCODE: '27.F1', SOURCE: 'GREENLEAF',
    PHOTO_LINK: 'https://photos.example.test/2026/10/18/004380.010.1.webp', PHOTO_NAME: '2026-10-18-004380.010.1.webp',
    DATE_COMPLETED: '2026-10-18T12:00:00Z', SPEC: '6-8" H', MATCH: '80%', AV_NOTE: 'SPEC - 6-8" H' };
  let hydratedRow = null;
  const firstNonEmptyValue = (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== '') ?? '';
  const context = {
    String, Object, Array, Map,
    firstNonEmptyValue,
    isDockSuspendDcRequestMirrorRow: row => row === mirror,
    findDockSuspendDcRequestSourceRow: () => source,
    findDockSuspendDcRequestCardDisplayDataRow: () => null,
    getDockSuspendDcRequestLinkedMasterRow: () => null,
    getQueueCardInventoryRow: () => hydratedRow,
    getDriveCustomerOutreachPhotoCsv: row => row.PHOTO_LINK || row.photo_link || '',
    getDriveCustomerOutreachSpec: row => row.SPEC || row.spec || '',
    getItemDisplayValue: (row, key) => row[key] ?? row[key.toLowerCase()] ?? '',
    getCurrentCardLocPhotoMatchQtyValue: () => '',
    getDisplayLocMatchQtyValue: () => '',
    getMasterAvInvalidationReasons: () => [],
    getPhotoUrlList: value => String(value || '').split(',').filter(Boolean),
    mergePhotoCsvList: values => [...new Set(values.flatMap(value => String(value || '').split(',').map(part => part.trim()).filter(Boolean)) )].join(','),
    normalizeRowPhotoFields: row => row,
    buildSearchIndex: row => row,
    syncDockSuspendDcRequestPhotoAliases: () => {},
    syncDockSuspendDcRequestQuantityAliases: () => {},
  };
  vm.createContext(context);
  vm.runInContext(extract('syncDockSuspendCardMasterSummaryFields') + extract('buildDockSuspendDcRequestCardDisplayItem'), context);

  const firstRender = context.buildDockSuspendDcRequestCardDisplayItem(mirror, 'request');
  assert.equal(firstRender.REQ_PHOTO_LINK, undefined, 'before the deferred identity batch resolves, request has no photo');
  hydratedRow = canonical;
  const afterHydration = context.buildDockSuspendDcRequestCardDisplayItem(mirror, 'request');
  assert.equal(afterHydration.REQ_PHOTO_LINK, canonical.PHOTO_LINK);
  assert.equal(afterHydration.REQ_SPEC, '6-8" H');
  assert.equal(afterHydration.REQ_MATCH, '80%');
  assert.equal(afterHydration.AV_NOTE, 'SPEC - 6-8" H');
  assert.equal(afterHydration.AV_RULE_PHOTO_UPDATED_AT, canonical.DATE_COMPLETED);
});

test('Suspend photo options reject unrelated item and size rows before validating expensive photo data', () => {
  const target = { ITEMCODE: 'TARGET-1', COMMONNAME: 'Target Plant', CONTSIZE: '#1' };
  const exactMatch = { UNIQUE_ID: 'exact', ITEMCODE: 'TARGET-1', COMMONNAME: 'Target Plant', CONTSIZE: '#1', LOCATIONCODE: 'A.01.001' };
  const samePlantSize = { UNIQUE_ID: 'same-size', ITEMCODE: 'TARGET-2', COMMONNAME: 'Target Plant', CONTSIZE: '#1', LOCATIONCODE: 'A.01.002' };
  const unrelatedItem = { UNIQUE_ID: 'unrelated-item', ITEMCODE: 'OTHER-1', COMMONNAME: 'Other Plant', CONTSIZE: '#1' };
  const wrongSize = { UNIQUE_ID: 'wrong-size', ITEMCODE: 'TARGET-3', COMMONNAME: 'Target Plant', CONTSIZE: '#3' };
  const photoChecks = [];
  let itemCodeKeyReads = 0;
  let masterRevision = 'master-1';
  const optionState = { rows: [], cachedSignature: 'options-1' };
  const context = {
    String, Object, Array, Map, Set,
    fullInventory: [unrelatedItem, wrongSize, exactMatch],
    avOpenInventory: [samePlantSize],
    requestItemCodeOptionState: optionState,
    getDockSuspendDcRequestBaseRow: () => target,
    ensureRequestItemCodeOptionState: () => optionState,
    getRequestItemCodeOptionItemCode: row => {
      if (row !== target) itemCodeKeyReads++;
      return String(row?.ITEMCODE || '').trim().toUpperCase();
    },
    getRequestItemCodeOptionCommonNameKey: row => String(row?.COMMONNAME || '').toLowerCase().trim(),
    getRequestItemCodeOptionContSizeKey: row => String(row?.CONTSIZE || '').toLowerCase().trim(),
    getDatasetLoadSignature: dataset => dataset === 'master' ? masterRevision : 'av-open-1',
    isRequestItemCodeOptionSamePlantSize: (candidate, source) =>
      String(candidate?.COMMONNAME || '').toLowerCase() === String(source?.COMMONNAME || '').toLowerCase()
        && String(candidate?.CONTSIZE || '').toLowerCase() === String(source?.CONTSIZE || '').toLowerCase(),
    hasRequestItemCodeOptionValidPhotoData: row => { photoChecks.push(row.UNIQUE_ID); return true; },
    isEvalScopedDataRowVisibleToCurrentUser: () => true,
    firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim() !== ''),
    getDockSuspendTagPhotoSpecIdentityKey: row => `${row.ITEMCODE}|${row.LOCATIONCODE}`,
    getItemUniqueId: row => row.UNIQUE_ID,
    compareItemInquiryRows: (left, right) => String(left.LOCATIONCODE).localeCompare(String(right.LOCATIONCODE)),
  };
  vm.createContext(context);
  vm.runInContext([
    'let dockSuspendTagDriveOptionRowsIndexCache = { fullRows: null, avOpenRows: null, masterRevision: "", avOpenRevision: "", byItemCode: new Map(), byCommonName: new Map(), byCommonNameSize: new Map() };',
    extract('getDockSuspendTagDriveOptionRowsCandidateIndex'),
    extract('getDockSuspendTagValidDriveOptionRows'),
  ].join('\n'), context);

  const result = context.getDockSuspendTagValidDriveOptionRows(target);
  assert.deepEqual(JSON.parse(JSON.stringify(result.map(row => row.UNIQUE_ID))), ['exact', 'same-size']);
  assert.deepEqual(photoChecks, ['exact', 'same-size'], 'photo validation runs only after item+plant-size relevance is established');
  const readsAfterInitialIndex = itemCodeKeyReads;
  const secondResult = context.getDockSuspendTagValidDriveOptionRows(target);
  assert.deepEqual(JSON.parse(JSON.stringify(secondResult.map(row => row.UNIQUE_ID))), ['exact', 'same-size']);
  assert.equal(itemCodeKeyReads, readsAfterInitialIndex, 'repeated cards reuse the same inventory candidate index');
  masterRevision = 'master-2';
  context.getDockSuspendTagValidDriveOptionRows(target);
  assert.ok(itemCodeKeyReads > readsAfterInitialIndex, 'a master dataset revision rebuilds the candidate index');
});

test('queue inventory authorization receipt matches live-sync identity and invalidates on permission changes', () => {
  let sessionValid = true;
  let loginCacheScope = 'login-a';
  let fullContextCalls = 0;
  const context = {
    String, JSON,
    nativeAuthProfile: { id: 'profile-1' },
    appAccessSnapshotState: { snapshot: { dataPermissionVersion: 'perm-1' } },
    currentUser: 'dylan_collyge',
    currentRole: 'Admin',
    getCurrentLoginCacheScopeKey: () => loginCacheScope,
    getSupabaseReadIdentityScope: () => `read-scope:${loginCacheScope}`,
    canUseProductionLiveSync: () => sessionValid,
    getProductionLiveSyncContext: () => { fullContextCalls++; throw new Error('full adapter context must not be built'); },
  };
  vm.createContext(context);
  vm.runInContext(extract('getQueueCardInventoryAuthorizationContext'), context);

  const first = context.getQueueCardInventoryAuthorizationContext();
  assert.deepEqual(JSON.parse(JSON.stringify(first)), {
    scope: JSON.stringify(['profile-1', 'dylan_collyge', 'Admin', 'login-a']),
    readScope: 'read-scope:login-a',
    permission: 'perm-1',
  });
  assert.equal(fullContextCalls, 0);

  context.appAccessSnapshotState.snapshot.dataPermissionVersion = 'perm-2';
  assert.equal(context.getQueueCardInventoryAuthorizationContext().permission, 'perm-2');
  loginCacheScope = 'login-b';
  assert.notEqual(context.getQueueCardInventoryAuthorizationContext().scope, first.scope);
  assert.notEqual(context.getQueueCardInventoryAuthorizationContext().readScope, first.readScope);
  context.nativeAuthProfile.id = '';
  assert.equal(context.getQueueCardInventoryAuthorizationContext(), null);
  context.nativeAuthProfile.id = 'profile-1';
  sessionValid = false;
  assert.equal(context.getQueueCardInventoryAuthorizationContext(), null);
});
