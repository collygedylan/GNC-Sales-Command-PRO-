import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const NOW = Date.parse('2026-09-10T18:00:00Z');
const PHOTO = 'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/v2/2026-09-10_crop.webp';

function source(name) {
  const syncStart = html.indexOf(`        function ${name}(`);
  const start = syncStart >= 0 ? syncStart : html.indexOf(`        async function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const end = html.indexOf('\n        }', start);
  assert.notEqual(end, -1, `${name} closes`);
  return html.slice(start, end + '\n        }'.length);
}

function constant(name) {
  const match = html.match(new RegExp(`        const ${name} = \\[[\\s\\S]*?\\];`));
  assert.ok(match, `${name} exists`);
  return match[0];
}

function runtime() {
  class FixedDate extends Date { static now() { return NOW; } }
  const ctx = vm.createContext({
    Date: FixedDate, URL,
    normalizeAppTableName: value => value,
    normalizeRequestDesiredMeasurementValue: value => String(value || ''),
    normalizeRequestStatus: value => value,
    hydrateEvalTaskRequestRowFromMeta: row => row,
    repairDisplayFieldsOnRow: row => row,
    normalizeRowPhotoFields: row => row,
    buildSearchIndex: row => row,
    clonePhotoFields: () => {},
    syncSharedFlyerPhotoFields: row => row,
  });
  const names = [
    'firstNonEmptyValue', 'parseAppNumber', 'normalizeLocMatchPercentText', 'parseLocMatchPercent',
    'normalizeCardQuantityValue', 'getCardPtrOnHandValue', 'getCardPtrAvailableValue',
    'calculateLocMatchQtyValue', 'getLocPhotoEvidenceContext', 'getLocPhotoOwnedValue',
    'parseLocPhotoEvidenceTimestamp', 'getLocPhotoCaptureEvidence', 'getLocPhotoEvidenceState',
    'getPhotoQualifiedLocMatchQtyValue', 'formatFetchedRows',
    'captureRequestOwnedSyncValues', 'syncMasterFieldsToRow', 'syncMasterFieldsToRequestRow',
  ];
  vm.runInContext([
    constant('LINKED_ROW_SYNC_KEYS'), constant('REQUEST_ROW_OWNED_SYNC_KEYS'),
    ...names.map(source),
  ].join('\n'), ctx);
  return ctx;
}

function persistedRequest(ctx, changes = {}) {
  return ctx.formatFetchedRows([{
    unique_id: 'request-1', master_id: 'master-1', itemcode: 'ITEM-1',
    locationcode: 'A1', lotcode: 'LOT-1', req_match: '50',
    req_photo_link: PHOTO, req_photo_name: '2026-09-10_crop.webp',
    ...changes,
  }], 'ph_active_request')[0];
}

function master(changes = {}) {
  return {
    UNIQUE_ID: 'master-1', SOURCE_TABLE: 'ph_master_inventory', ITEMCODE: 'ITEM-1',
    LOCATIONCODE: 'A1', LOTCODE: 'LOT-1', PTRONHAND: '1000', PTRAVAILABLE: '800',
    PHOTO_MATCH_PTR_AVAILABLE_KNOWN: true, ...changes,
  };
}

test('Request quantities arriving from the linked master repair an initially unknown calculation base', () => {
  const ctx = runtime();
  const request = persistedRequest(ctx);
  assert.equal(request.PHOTO_MATCH_PTR_AVAILABLE_KNOWN, false);
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(request, 'request'), null);
  ctx.syncMasterFieldsToRequestRow(master(), request);
  assert.equal(ctx.getCardPtrOnHandValue(request), '1000');
  assert.equal(ctx.getCardPtrAvailableValue(request), '800');
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(request, 'request'), 400);
});

test('a verified zero Available quantity produces zero rather than an unknown calculation', () => {
  const ctx = runtime();
  const request = persistedRequest(ctx);
  ctx.syncMasterFieldsToRequestRow(master({ PTRONHAND: '100', PTRAVAILABLE: '0' }), request);
  assert.equal(ctx.getCardPtrOnHandValue(request), '100');
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(request, 'request'), 0);
});

test('the calculation uses Available and preserves the Request observation baseline', () => {
  const ctx = runtime();
  const request = persistedRequest(ctx, { ptravailable: '900', initial_ptr: '900' });
  ctx.syncMasterFieldsToRequestRow(master({ INITIAL_PTR: '1000', MATCH: '95' }), request);
  assert.equal(request.REQ_MATCH, '50');
  assert.equal(request.INITIAL_PTR, '900');
  assert.equal(ctx.getCardPtrOnHandValue(request), '1000');
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(request, 'request'), 350);
});

test('unknown master availability does not manufacture a calculation from On Hand', () => {
  const ctx = runtime();
  const request = persistedRequest(ctx, { ptravailable: '800' });
  ctx.syncMasterFieldsToRequestRow(master({ PTRAVAILABLE: undefined, PHOTO_MATCH_PTR_AVAILABLE_KNOWN: false }), request);
  assert.equal(ctx.getCardPtrOnHandValue(request), '1000');
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(request, 'request'), null);
});

test('quantity hydration does not bypass missing or stale Request-owned photo evidence', () => {
  const ctx = runtime();
  for (const change of [
    { req_photo_link: null, req_photo_name: null },
    { req_photo_link: PHOTO.replace('2026-09-10', '2026-08-01'), req_photo_name: '2026-08-01_crop.webp' },
  ]) {
    const request = persistedRequest(ctx, { ptravailable: '800', ...change });
    ctx.syncMasterFieldsToRequestRow(master({ PHOTO_LINK: PHOTO, PHOTO_NAME: '2026-09-10_crop.webp' }), request);
    assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(request, 'request'), null);
  }
});

function detailRuntime({ verified = true, delayed = false, canonicalChanges = null } = {}) {
  const ctx = runtime();
  const request = persistedRequest(ctx, {
    initial_ptr: '900', req_initial_ptr: '900', req_spec: 'Request spec',
    req_caliper: '2 inch', av_note: 'Request note', request_note: 'Customer instruction',
    req_status: 'Pending', source: 'REQUEST-SOURCE',
  });
  request.DOM_ID = 'req_request-1';
  const canonicalRequest = canonicalChanges ? { ...request, ...canonicalChanges } : request;
  const inventory = master({
    SOURCE: 'MASTER-SOURCE', PTRREVIEWED: '50', INITIAL_PTR: '1200', MATCH: '95',
    SPEC: 'Master spec', AV_NOTE: 'Master note', PHOTO_LINK: PHOTO.replace('crop', 'master'),
  });
  const fence = { scope: 'quantity-fixture', permissionVersion: 'permissions-1', revision: 'master-1' };
  const verification = { ready: verified, exactReads: 0, ensuredKeys: [] };
  let release;
  const rowPromise = delayed ? new Promise(resolve => { release = () => resolve([inventory]); }) : Promise.resolve([inventory]);
  Object.assign(ctx, {
    activeItem: request, activeDetailSourceView: 'request', lastView: 'request', detailHydrationToken: 1,
    loginSessionGeneration: 1, currentUser: 'quantity-fixture', currentRole: 'ADMIN', currentUserDivision: '10',
    nativeAuthSessionActive: false,
    productionMasterDetailSession: null,
    productionMasterDetailBindings: new WeakMap(),
    requestsInventory: [canonicalRequest],
    usesProductionMasterListProjection: () => true,
    getItemUniqueId: row => String(row.UNIQUE_ID || '').trim(),
    getProductionMasterDetailContext: () => fence,
    getCurrentVisibleViewId: () => 'detail',
    getProductionMasterDetailStore: () => ({ ensure: async ids => {
      assert.deepEqual(Array.from(ids), ['master-1']);
      verification.exactReads += 1;
      return rowPromise;
    }, getVerifiedRows: ids => verification.ready && ids.length === 1 && ids[0] === inventory.UNIQUE_ID ? [inventory] : null }),
    getProductionDetailDatasetKeys: () => ['master', 'requests'],
    canUseVerifiedProductionData: () => verification.ready,
    createProductionCoreLiveAdapter: key => ({ key }),
    getProductionLiveSyncCoordinator: () => ({ ensure: async adapter => {
      verification.ensuredKeys.push(adapter.key);
      return verification.ready;
    } }),
    applyProductionMasterDetailControlState: () => {},
  });
  vm.runInContext([
    source('captureLoginSessionOwnership'), source('isLoginSessionIdentityCurrent'), source('isLoginSessionOwnershipCurrent'),
    source('findRequestInventoryRowByUniqueId'), source('getProductionMasterDetailIds'),
    source('productionMasterDetailFenceMatches'), source('bindProductionMasterDetailRow'),
    source('isProductionMasterDetailBindingCurrent'), source('hasProductionMasterDetailForItem'),
    source('getProductionMasterDetailIdentity'), source('isProductionMasterDetailSessionCurrent'),
    source('ensureActiveProductionMasterDetail'),
  ].join('\n'), ctx);
  const session = {
    token: 1, owner: ctx.captureLoginSessionOwnership(), sourceView: 'request', rowIdentity: ctx.getProductionMasterDetailIdentity(request),
    ids: ['master-1'], status: 'loading', promise: null, error: '',
    masterIdentities: new Map([['master-1', ctx.getProductionMasterDetailIdentity(inventory)]]),
  };
  ctx.productionMasterDetailSession = session;
  return { ctx, session, request, canonicalRequest, inventory, release, verification };
}

function pauseDetailVerification() {
  const detail = detailRuntime({ verified: false });
  let entered, release;
  const waiting = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  detail.ctx.getProductionLiveSyncCoordinator = () => ({ ensure: async adapter => {
    detail.verification.ensuredKeys.push(adapter.key);
    entered();
    await gate;
    return detail.verification.ready;
  } });
  return { ...detail, waiting, finishVerification: () => { detail.verification.ready = true; release(); } };
}

test('detail awaits temporary dependency verification and reads the exact row again before hydration', async () => {
  const detail = pauseDetailVerification();
  const { ctx, session, canonicalRequest, inventory, verification } = detail;
  const before = structuredClone(canonicalRequest);
  const firstSnapshot = { ...inventory, PTRONHAND: '500', PTRAVAILABLE: '400' };
  ctx.getProductionMasterDetailStore = () => ({
    ensure: async ids => {
      assert.deepEqual(Array.from(ids), ['master-1']);
      verification.exactReads += 1;
      return [verification.exactReads === 1 ? firstSnapshot : inventory];
    },
    getVerifiedRows: () => verification.ready ? [inventory] : null,
  });
  const pending = ctx.ensureActiveProductionMasterDetail(session);
  await detail.waiting;
  assert.equal(session.status, 'loading');
  assert.deepEqual(structuredClone(canonicalRequest), before, 'the first snapshot cannot hydrate an unverified Request');
  assert.equal(ctx.productionMasterDetailBindings.has(canonicalRequest), false);
  detail.finishVerification();
  assert.equal(await pending, true);
  assert.deepEqual(verification.ensuredKeys, ['master', 'requests']);
  assert.equal(verification.exactReads, 2);
  assert.equal(session.status, 'ready');
  assert.equal(ctx.getCardPtrOnHandValue(ctx.activeItem), '1000');
  assert.equal(ctx.getCardPtrAvailableValue(ctx.activeItem), '800');
  assert.equal(ctx.hasProductionMasterDetailForItem(canonicalRequest), true);
});

test('navigation or login scope changes during dependency verification cannot hydrate the old Request', async () => {
  for (const change of [
    ctx => { ctx.detailHydrationToken += 1; },
    ctx => { ctx.currentUserDivision = '20'; },
  ]) {
    const detail = pauseDetailVerification();
    const { ctx, session, canonicalRequest, verification } = detail;
    const before = structuredClone(canonicalRequest);
    const pending = ctx.ensureActiveProductionMasterDetail(session);
    await detail.waiting;
    change(ctx);
    detail.finishVerification();
    assert.equal(await pending, false);
    assert.deepEqual(verification.ensuredKeys, ['master'], 'stale detail stops after the awaited dependency');
    assert.equal(verification.exactReads, 1, 'stale detail does not start a second exact read');
    assert.equal(ctx.activeItem, canonicalRequest);
    assert.deepEqual(structuredClone(canonicalRequest), before);
    assert.equal(ctx.productionMasterDetailBindings.has(canonicalRequest), false);
  }
});

test('verified compact detail fills Request quantities without replacing Request-owned evidence or identity', async () => {
  const { ctx, session, request, inventory } = detailRuntime();
  const requestBefore = structuredClone(request);
  const inventoryBefore = structuredClone(inventory);
  assert.equal(await ctx.ensureActiveProductionMasterDetail(session), true);
  assert.equal(ctx.getCardPtrOnHandValue(ctx.activeItem), '1000');
  assert.equal(ctx.getCardPtrAvailableValue(ctx.activeItem), '800');
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(ctx.activeItem, 'request'), 350);
  for (const key of ['UNIQUE_ID', 'SOURCE_TABLE', 'MASTER_ID', 'DOM_ID', 'SOURCE', 'REQ_MATCH', 'REQ_SPEC',
    'REQ_CALIPER', 'AV_NOTE', 'REQUEST_NOTE', 'REQ_STATUS', 'REQ_PHOTO_LINK', 'REQ_PHOTO_NAME', 'INITIAL_PTR', 'REQ_INITIAL_PTR']) {
    assert.equal(ctx.activeItem[key], requestBefore[key], `${key} remains Request-owned`);
  }
  assert.equal(ctx.isProductionMasterDetailSessionCurrent(session), true);
  assert.equal(ctx.hasProductionMasterDetailForItem(ctx.activeItem), true);
  assert.equal(ctx.hasProductionMasterDetailForItem(request), true, 'the canonical Request retains the same verified proof');
  assert.deepEqual(structuredClone(request), {
    ...requestBefore, PTRONHAND: '1000', PTRREVIEWED: '50', PTRAVAILABLE: '800', PHOTO_MATCH_PTR_AVAILABLE_KNOWN: true,
  }, 'only verified quantities change on the canonical Request');
  assert.deepEqual(inventory, inventoryBefore, 'the canonical master snapshot is not mutated');
});

test('Request autosave can adopt its canonical row without losing quantities or verification', async () => {
  const { ctx, session, canonicalRequest } = detailRuntime();
  assert.equal(await ctx.ensureActiveProductionMasterDetail(session), true);
  assert.notEqual(ctx.activeItem, canonicalRequest);
  let permissionRow;
  Object.assign(ctx, {
    autoSaveTimer: null,
    document: { getElementById: () => null },
    isDockSuspendDcRequestMirrorRow: () => false,
    findRequestRowByUniqueId: id => ctx.findRequestInventoryRowByUniqueId(id),
    mergePhotoCsvList: values => [...new Set(values.filter(Boolean))].join(','),
    getRowSaveCoordinatorKey: () => 'request-1',
    beginFieldSaveActivity: () => {}, endFieldSaveActivity: () => {},
    // Exercise the real save adoption and proof gates, then stop at the role
    // boundary so this regression never constructs or writes a business payload.
    canEditRowDetailsByRole: (_prefix, item) => { permissionRow = item; return false; },
  });
  vm.runInContext([
    source('mergeRequestPhotoFields'), source('getEditableDetailItemForPrefix'),
    source('canEditRowDetails'), source('saveData'),
  ].join('\n'), ctx);
  await ctx.saveData(false, 'req-', true);
  assert.equal(ctx.activeItem, canonicalRequest, 'saveData uses the canonical Request object');
  assert.equal(permissionRow, canonicalRequest, 'canonical proof passes before the role boundary');
  assert.equal(ctx.isProductionMasterDetailSessionCurrent(session), true);
  assert.equal(ctx.hasProductionMasterDetailForItem(ctx.activeItem), true);
  assert.equal(ctx.getCardPtrOnHandValue(ctx.activeItem), '1000');
  assert.equal(ctx.getCardPtrAvailableValue(ctx.activeItem), '800');
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(ctx.activeItem, 'request'), 350);
  assert.equal(ctx.activeItem.REQ_SPEC, 'Request spec');
  assert.equal(ctx.activeItem.INITIAL_PTR, '900');
  assert.equal(ctx.activeItem.REQ_PHOTO_LINK, PHOTO);
});

test('a replaced or differently linked canonical Request receives no quantities or detail proof', async () => {
  for (const change of [
    { UNIQUE_ID: 'another-request' },
    { LOCATIONCODE: 'OTHER-LOCATION' },
    { MASTER_ID: 'another-master', MASTER_UNIQUE_ID: 'another-master' },
  ]) {
    const { ctx, session, canonicalRequest } = detailRuntime({ canonicalChanges: change });
    const before = structuredClone(canonicalRequest);
    await ctx.ensureActiveProductionMasterDetail(session);
    assert.deepEqual(structuredClone(canonicalRequest), before, 'mismatched canonical Request is untouched');
    assert.equal(ctx.productionMasterDetailBindings.has(canonicalRequest), false);
    assert.equal(ctx.hasProductionMasterDetailForItem(canonicalRequest), false);
  }
});

test('unverified or superseded compact detail cannot inject inventory quantities into a Request', async () => {
  const unverified = detailRuntime({ verified: false });
  assert.equal(await unverified.ctx.ensureActiveProductionMasterDetail(unverified.session), false);
  assert.equal(unverified.ctx.activeItem, unverified.request);
  assert.equal(unverified.ctx.getCardPtrOnHandValue(unverified.ctx.activeItem), '0');

  const superseded = detailRuntime({ delayed: true });
  const pending = superseded.ctx.ensureActiveProductionMasterDetail(superseded.session);
  superseded.ctx.detailHydrationToken = 2;
  superseded.release();
  assert.equal(await pending, false);
  assert.equal(superseded.ctx.activeItem, superseded.request);
  assert.equal(superseded.ctx.getCardPtrOnHandValue(superseded.ctx.activeItem), '0');

  const changedIdentity = detailRuntime();
  changedIdentity.inventory.LOCATIONCODE = 'B999';
  assert.equal(await changedIdentity.ctx.ensureActiveProductionMasterDetail(changedIdentity.session), false);
  assert.equal(changedIdentity.ctx.activeItem, changedIdentity.request);
  assert.match(changedIdentity.session.error, /inventory identity changed/i);
});
