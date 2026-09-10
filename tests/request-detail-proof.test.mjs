import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function appFunction(name) {
  const start = html.search(new RegExp(`        (?:async )?function ${name}\\(`));
  assert.notEqual(start, -1, `${name} exists in the real application`);
  const end = html.indexOf('\n        }', start);
  assert.notEqual(end, -1, `${name} closes`);
  return html.slice(start, end + '\n        }'.length);
}

const modules = vm.createContext({ module: { exports: {} }, setTimeout, clearTimeout });
for (const name of ['inventory-list-contract', 'master-detail-snapshots', 'live-sync-coordinator']) {
  vm.runInContext(readFileSync(new URL(`../assets/${name}.js`, import.meta.url), 'utf8'), modules);
}

const requestRow = () => ({
  UNIQUE_ID: 'REQUEST-SYNTHETIC-1', SOURCE_TABLE: 'ph_active_request', MASTER_ID: 'MASTER-SYNTHETIC-1',
  ITEMCODE: 'ITEM-SYNTHETIC-1', LOCATIONCODE: 'LOCATION-SYNTHETIC-1', LOTCODE: 'LOT-SYNTHETIC-1',
  SOURCE: 'CURRENT', REQ_STATUS: 'Pending', REQ_SPEC: 'SERVER SPEC', REQ_PHOTO_LINK: '', ROW_VERSION: 7
});

test('initial Request hydration establishes the verified master SOURCE before binding the editor', async () => {
  const h = await fixture({ source: 'LD', contsize: '#7' });
  delete h.source.SOURCE;
  const session = h.ctx.productionMasterDetailSession;
  session.status = 'loading';
  session.rowIdentity = h.ctx.getProductionMasterDetailIdentity(h.source);
  session.masterIdentities = new Map();
  h.ctx.productionMasterDetailBindings.delete(h.source);
  h.ctx.applyProductionMasterDetailControlState = () => {};
  vm.runInContext([appFunction('bindProductionMasterDetailRow'), appFunction('ensureActiveProductionMasterDetail')].join('\n'), h.ctx);
  assert.equal(await h.ctx.ensureActiveProductionMasterDetail(session), true);
  assert.equal(h.ctx.activeItem.SOURCE, 'LD');
  assert.equal(session.rowIdentity, h.ctx.getProductionMasterDetailIdentity(h.target));
  assert.equal(h.ctx.activeItem.REQ_SPEC, 'LOCAL DRAFT');
  assert.equal(h.ctx.transferProductionRequestDetailBinding(h.ctx.activeItem, h.target), true);
  assert.equal(h.ctx.hasProductionMasterDetailForItem(h.target), true);
});

for (const [name, available, known] of [['positive', '800', true], ['zero', '0', true], ['unknown', null, false]]) {
  test(`SOURCE hydration preserves Request fields and verifies canonical ${name} quantities through the real coordinator`, async () => {
    const h = await fixture({ source: 'LD', contsize: '#7', masterFields: {
      ptronhand: '1000', ptrreviewed: '50', ptravailable: available,
      spec: 'MASTER SPEC', av_note: 'MASTER NOTE', photo_link: 'https://synthetic.invalid/master-photo.jpg',
    } });
    delete h.source.SOURCE;
    delete h.target.SOURCE;
    Object.assign(h.source, { REQ_MATCH: '50', INITIAL_PTR: '900', REQ_INITIAL_PTR: '900',
      REQ_PHOTO_LINK: 'https://synthetic.invalid/request-photo.jpg', AV_NOTE: 'LOCAL REQUEST NOTE' });
    Object.assign(h.target, { REQ_MATCH: '40', INITIAL_PTR: '700', REQ_INITIAL_PTR: '700',
      REQ_PHOTO_LINK: 'https://synthetic.invalid/saved-request-photo.jpg', AV_NOTE: 'SAVED REQUEST NOTE' });
    const sourceBefore = structuredClone(h.source), canonicalBefore = structuredClone(h.target);
    const masterBefore = structuredClone(h.rawMaster);
    const session = h.ctx.productionMasterDetailSession;
    session.status = 'loading';
    session.rowIdentity = h.ctx.getProductionMasterDetailIdentity(h.source);
    session.masterIdentities = new Map();
    h.ctx.productionMasterDetailBindings.delete(h.source);
    h.ctx.applyProductionMasterDetailControlState = () => {};
    vm.runInContext([appFunction('bindProductionMasterDetailRow'), appFunction('ensureActiveProductionMasterDetail')].join('\n'), h.ctx);

    assert.equal(await h.ctx.ensureActiveProductionMasterDetail(session), true);
    const quantities = { PTRONHAND: '1000', PTRREVIEWED: '50', PTRAVAILABLE: available,
      PHOTO_MATCH_PTR_AVAILABLE_KNOWN: known };
    assert.deepEqual(structuredClone(h.ctx.activeItem), { ...sourceBefore, SOURCE: 'LD', ...quantities });
    assert.deepEqual(h.target, { ...canonicalBefore, SOURCE: 'LD', ...quantities }, 'canonical hydration copies no unsaved editor evidence or observation baseline');
    assert.deepEqual(h.rawMaster, masterBefore, 'canonical master remains unchanged');
    assert.equal(h.ctx.isProductionMasterDetailSessionCurrent(session), true);
    assert.equal(h.ctx.hasProductionMasterDetailForItem(h.ctx.activeItem), true);
    assert.equal(h.ctx.hasProductionMasterDetailForItem(h.target), true, 'the exact canonical Request is ready for photo saves');
    assert.equal(h.ctx.productionMasterDetailBindings.get(h.target).fence.revision, '1');
    assert.equal(h.ctx.productionMasterDetailBindings.get(h.target).rowIdentity, session.rowIdentity);
  });
}

for (const [name, changes] of [
  ['Request ID', { UNIQUE_ID: 'OTHER-REQUEST' }],
  ['master ID', { MASTER_ID: 'OTHER-MASTER' }],
  ['conflicting master alias', { master_id: 'OTHER-MASTER' }],
  ['item code', { ITEMCODE: 'OTHER-ITEM' }],
  ['location', { LOCATIONCODE: 'OTHER-LOCATION' }],
  ['lot', { LOTCODE: 'OTHER-LOT' }],
  ['container size', { CONTSIZE: '#15' }],
  ['conflicting source alias', { source: 'OTHER-SOURCE' }],
]) {
  test(`initial SOURCE hydration does not change a canonical Request with a different ${name}`, async () => {
    const h = await fixture({ source: 'LD', contsize: '#7', masterFields: { ptravailable: '800' } });
    delete h.source.SOURCE;
    delete h.target.SOURCE;
    Object.assign(h.target, changes);
    const canonicalBefore = structuredClone(h.target);
    const session = h.ctx.productionMasterDetailSession;
    session.status = 'loading';
    session.rowIdentity = h.ctx.getProductionMasterDetailIdentity(h.source);
    session.masterIdentities = new Map();
    h.ctx.productionMasterDetailBindings.delete(h.source);
    h.ctx.applyProductionMasterDetailControlState = () => {};
    vm.runInContext([appFunction('bindProductionMasterDetailRow'), appFunction('ensureActiveProductionMasterDetail')].join('\n'), h.ctx);

    await h.ctx.ensureActiveProductionMasterDetail(session);
    assert.deepEqual(h.target, canonicalBefore, 'the mismatched canonical Request is never normalized or hydrated');
    assert.equal(h.ctx.productionMasterDetailBindings.has(h.target), false);
    assert.equal(h.ctx.hasProductionMasterDetailForItem(h.target), false);
  });
}

for (const key of ['ITEMCODE', 'LOCATIONCODE', 'LOTCODE', 'CONTSIZE']) {
  test(`initial Request SOURCE hydration rejects a different ${key} without changing the draft`, async () => {
    const h = await fixture({ source: 'LD', contsize: '#7' });
    delete h.source.SOURCE;
    h.source[key] = 'DIFFERENT';
    const session = h.ctx.productionMasterDetailSession;
    session.status = 'loading';
    session.rowIdentity = h.ctx.getProductionMasterDetailIdentity(h.source);
    session.masterIdentities = new Map();
    h.ctx.productionMasterDetailBindings.delete(h.source);
    h.ctx.applyProductionMasterDetailControlState = () => {};
    const before = structuredClone(h.source);
    vm.runInContext([appFunction('bindProductionMasterDetailRow'), appFunction('ensureActiveProductionMasterDetail')].join('\n'), h.ctx);
    assert.equal(await h.ctx.ensureActiveProductionMasterDetail(session), false);
    assert.deepEqual(h.ctx.activeItem, before);
    assert.equal(h.ctx.productionMasterDetailBindings.has(h.ctx.activeItem), false);
    assert.equal(session.status, 'error');
  });
}

// Establish exact-row proof through the real store and coordinator. No ready
// booleans, getVerifiedRows replacements, production sessions or business rows.
async function fixture(options = {}) {
  const state = { scope: 'synthetic-account-a/role-a', permission: 'permission-a', revision: '1',
    authEpoch: 1, loginGeneration: 1, projected: true, sourceState: 'ready', fetches: 0 };
  const context = { scope: state.scope, permissionVersion: state.permission, revision: state.revision,
    viewKey: 'detail', visible: true, online: true, adapters: [], backgroundAdapters: [] };
  const dataset = { listProjectionVersion: 'master-list-v1', liveVerifiedPermission: state.permission,
    liveVerifiedRevision: state.revision };
  const requestDataset = { liveVerifiedPermission: state.permission, liveVerifiedRevision: state.revision };
  const rawMaster = Object.fromEntries(modules.AgMetricInventoryList.physicalColumns.map(key => [key, null]));
  Object.assign(rawMaster, { unique_id: 'MASTER-SYNTHETIC-1', itemcode: 'ITEM-SYNTHETIC-1',
    locationcode: 'LOCATION-SYNTHETIC-1', lotcode: 'LOT-SYNTHETIC-1', source: options.source || 'CURRENT',
    contsize: options.contsize || null, spec: 'SERVER SPEC', ...options.masterFields });
  const masterAdapter = { id: 'core:master', cacheKey: 'master-list-v1:synthetic', sourceKeys: ['ph_master_inventory'],
    stage: async () => ({ rows: [rawMaster] }) };
  const requestAdapter = { id: 'core:requests', cacheKey: 'requests:synthetic', sourceKeys: ['ph_active_request'],
    stage: async () => ({ rows: [requestRow()] }) };
  let timerId = 0;
  const coordinator = modules.AgMetricLiveSync.createCoordinator({
    getContext: () => context,
    readRevisions: async keys => {
      const metadata = { contractVersion: 1, permissionVersion: state.permission,
        sources: keys.map(key => ({ key, revision: state.revision, state: state.sourceState })) };
      return state.metadataHook ? state.metadataHook(metadata) : metadata;
    },
    commitSnapshots: (snapshots, current, metadata) => {
      context.permissionVersion = dataset.liveVerifiedPermission = metadata.permissionVersion;
      context.revision = dataset.liveVerifiedRevision = metadata.sources.get('ph_master_inventory').revision;
      requestDataset.liveVerifiedPermission = metadata.permissionVersion;
      requestDataset.liveVerifiedRevision = metadata.sources.get('ph_active_request')?.revision || requestDataset.liveVerifiedRevision;
      snapshots.forEach(({ adapter, value }) => adapter.commit?.(value, current, metadata));
    },
    setTimeout: () => ++timerId, clearTimeout: () => {}
  });
  const store = modules.AgMetricMasterDetailSnapshots.createStore({
    getCoordinator: () => coordinator, getContext: () => context,
    inventoryContract: modules.AgMetricInventoryList,
    fetchExactRows: async ids => {
      state.fetches++;
      const rows = ids.map(() => ({ ...rawMaster }));
      return state.fetchHook ? await state.fetchHook(rows) : rows;
    },
    formatRows: rows => rows.map(row => ({ ...Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toUpperCase(), value])),
      SOURCE_TABLE: 'ph_master_inventory' }))
  });
  const exactAdapter = store.getAdapter(['MASTER-SYNTHETIC-1']);
  context.adapters = [masterAdapter, requestAdapter, exactAdapter];
  assert.equal(await coordinator.check('synthetic-initial-verification'), true);
  assert.equal(coordinator.isVerified(masterAdapter), true);
  assert.equal(coordinator.isVerified(requestAdapter), true);
  assert.equal(store.getVerifiedRows(['MASTER-SYNTHETIC-1']).length, 1);

  const identity = { SOURCE: rawMaster.source, ...(options.contsize ? { CONTSIZE: options.contsize } : {}) };
  const source = { ...requestRow(), ...identity, REQ_SPEC: 'LOCAL DRAFT' }, target = { ...requestRow(), ...identity };
  const ctx = vm.createContext({ Map, Set, WeakMap, Object, JSON, String, console,
    window: { AgMetricInventoryList: modules.AgMetricInventoryList },
    document: { hidden: false }, navigator: { onLine: true },
    productionMasterDetailBindings: new WeakMap(), productionMasterDetailSession: null,
    retainedRequestCameraSelections: [], pendingRequestCameraSelection: null,
    activeItem: source, activeDetailSourceView: 'request', lastView: 'request', detailHydrationToken: 1,
    ACTIVE_REQUEST_TABLE: 'ph_active_request', ACTIVE_REQUEST_LIVE_ROWS_TABLE: 'ph_active_request_live_rows',
    nativeAuthSessionActive: true,
    getDatasetState: key => key === 'requests' ? requestDataset
      : ({ ...dataset, listProjectionVersion: state.projected ? 'master-list-v1' : '' }),
    canUseProductionLiveSync: () => state.projected,
    getProductionDataScope: () => state.scope,
    getProductionMasterDetailStore: () => store,
    getProductionLiveSyncCoordinator: () => coordinator,
    createProductionCoreLiveAdapter: key => ({ master: masterAdapter, requests: requestAdapter })[key],
    getProductionDetailDatasetKeys: () => ['master', 'requests'],
    getCurrentVisibleViewId: () => 'detail',
    captureLoginSessionOwnership: () => Object.freeze({ scope: state.scope, generation: state.loginGeneration }),
    isLoginSessionOwnershipCurrent: owner => !!owner && owner.scope === state.scope && owner.generation === state.loginGeneration,
    getSupabaseReadIdentityScope: () => JSON.stringify([state.scope, state.permission, state.authEpoch]),
    getMasterInventoryExactKey: () => '',
    findRequestInventoryRowByUniqueId: uid => String(uid) === target.UNIQUE_ID ? target : null,
    showToast: () => { throw new Error('Proof transfer must not display or submit anything'); }
  });
  const names = ['firstNonEmptyValue', 'parseAppNumber', 'usesProductionMasterListProjection', 'getProductionMasterDetailContext',
    'getProductionMasterDetailIds', 'getProductionMasterDetailIdentity', 'productionMasterDetailFenceMatches',
    'bindProductionMasterDetailRow', 'isProductionMasterDetailBindingCurrent', 'hasProductionMasterDetailForItem',
    'isProductionMasterDetailSessionCurrent', 'canUseVerifiedProductionData', 'transferProductionRequestDetailBinding',
    'getRetainedRequestCameraSelections'];
  vm.runInContext(names.map(appFunction).join('\n'), ctx);
  ctx.bindProductionMasterDetailRow(source, ['MASTER-SYNTHETIC-1']);
  ctx.productionMasterDetailSession = { item: source, token: ctx.detailHydrationToken,
    owner: ctx.captureLoginSessionOwnership(), sourceView: 'request', status: 'ready',
    ids: ['MASTER-SYNTHETIC-1'], rowIdentity: ctx.getProductionMasterDetailIdentity(source),
    readIdentity: ctx.getSupabaseReadIdentityScope() };
  const proof = ctx.productionMasterDetailBindings.get(source);
  assert.equal(ctx.hasProductionMasterDetailForItem(source), true);
  // Transfer may reuse a proof; it must never manufacture a new one from the
  // current revision, nor hydrate/fetch as a side effect.
  ctx.bindProductionMasterDetailRow = () => { throw new Error('Fresh proof stamping is forbidden during transfer'); };
  return { ctx, state, context, dataset, requestDataset, coordinator, store, source, target, proof, rawMaster };
}

test('matching Request canonical swap preserves the original immutable proof without copying draft values', async () => {
  const h = await fixture();
  assert.equal(h.ctx.transferProductionRequestDetailBinding(h.source, h.target), true);
  assert.equal(h.ctx.productionMasterDetailBindings.get(h.target), h.proof);
  assert.equal(h.ctx.productionMasterDetailBindings.get(h.target).fence, h.proof.fence);
  assert.equal(Object.isFrozen(h.proof), true);
  assert.equal(Object.isFrozen(h.proof.fence), true);
  assert.equal(Object.isFrozen(h.proof.ids), true);
  assert.equal(h.target.REQ_SPEC, 'SERVER SPEC');
  assert.equal(h.source.REQ_SPEC, 'LOCAL DRAFT');
  assert.equal(h.state.fetches, 1, 'transfer performs no row read');
  h.ctx.activeItem = h.target;
  assert.equal(h.ctx.hasProductionMasterDetailForItem(h.target), true);
  h.dataset.liveVerifiedRevision = h.context.revision = h.state.revision = '2';
  assert.equal(h.ctx.hasProductionMasterDetailForItem(h.target), false, 'copied proof retains its old revision fence');
  assert.equal(h.proof.fence.revision, '1');
});

test('active verified Request can authorize its exact canonical counterpart but not another source', async () => {
  const h = await fixture(), canonicalSource = requestRow();
  assert.equal(h.ctx.productionMasterDetailBindings.has(canonicalSource), false);
  assert.equal(h.ctx.transferProductionRequestDetailBinding(canonicalSource, h.target), true);
  assert.equal(h.ctx.productionMasterDetailBindings.get(h.target), h.proof);
});

for (const [name, patch] of [
  ['Request UID', { UNIQUE_ID: 'REQUEST-SYNTHETIC-2' }],
  ['linked master UID', { MASTER_ID: 'MASTER-SYNTHETIC-2' }],
  ['source table', { SOURCE_TABLE: 'ph_sales_office' }],
  ['item code', { ITEMCODE: 'ITEM-SYNTHETIC-2' }],
  ['location', { LOCATIONCODE: 'LOCATION-SYNTHETIC-2' }],
  ['lot', { LOTCODE: 'LOT-SYNTHETIC-2' }],
  ['inventory source', { SOURCE: 'PRIOR' }],
  ['conflicting UID alias', { unique_id: 'REQUEST-SYNTHETIC-2' }],
  ['conflicting master alias', { master_id: 'MASTER-SYNTHETIC-2' }],
  ['conflicting table alias', { source_table: 'ph_master_inventory' }]
]) {
  test(`a changed ${name} cannot receive Request proof`, async () => {
    const h = await fixture(); Object.assign(h.target, patch);
    assert.equal(h.ctx.transferProductionRequestDetailBinding(h.source, h.target), false);
    assert.equal(h.ctx.productionMasterDetailBindings.has(h.target), false);
    assert.equal(h.ctx.productionMasterDetailBindings.get(h.source), h.proof);
  });
}

for (const [name, change] of [
  ['account', h => { h.state.scope = h.context.scope = 'synthetic-account-b/role-a'; }],
  ['login generation', h => { h.state.loginGeneration++; }],
  ['detail opening generation', h => { h.ctx.detailHydrationToken++; }],
  ['source view', h => { h.ctx.activeDetailSourceView = 'drive'; }],
  ['master revision', h => { h.state.revision = h.context.revision = h.dataset.liveVerifiedRevision = '2'; }],
  ['permission version', h => { h.state.permission = h.context.permissionVersion = h.dataset.liveVerifiedPermission = 'permission-b'; }],
  ['missing scope', h => { h.state.scope = h.context.scope = ''; }],
  ['missing session', h => { h.ctx.productionMasterDetailSession = null; }],
  ['missing source proof', h => { h.ctx.productionMasterDetailBindings.delete(h.source); }],
  ['own-save checking', h => { h.ctx.productionMasterDetailSession.ownSave = { checking: true, item: h.source }; }],
]) {
  test(`${name} invalidation cannot restamp or transfer Request proof`, async () => {
    const h = await fixture(); change(h);
    assert.equal(h.ctx.transferProductionRequestDetailBinding(h.source, h.target), false);
    assert.equal(h.ctx.productionMasterDetailBindings.has(h.target), false);
    assert.equal(h.proof.fence.revision, '1');
    assert.equal(h.proof.fence.permissionVersion, 'permission-a');
  });
}

for (const [name, change] of [
  ['offline state', h => { h.ctx.navigator.onLine = false; h.context.online = false; }],
  ['lost exact canonical cache', h => { h.store.reset(); }],
  ['revoked coordinator verification', h => { h.coordinator.suspend(); }]
]) {
  test(`${name} cannot gain editing authorization through an identity-preserving proof copy`, async () => {
    const h = await fixture(); change(h);
    h.ctx.transferProductionRequestDetailBinding(h.source, h.target);
    const transferred = h.ctx.productionMasterDetailBindings.get(h.target);
    assert.ok(!transferred || transferred === h.proof, 'no new proof can replace the original');
    h.ctx.activeItem = h.target;
    assert.equal(h.ctx.hasProductionMasterDetailForItem(h.target), false);
    assert.equal(h.proof.fence.revision, '1');
    assert.equal(h.proof.fence.permissionVersion, 'permission-a');
  });
}

test('mutating both source and target identity does not turn old proof into a new authorization', async () => {
  const h = await fixture();
  h.source.LOCATIONCODE = h.target.LOCATIONCODE = 'LOCATION-SYNTHETIC-2';
  assert.equal(h.ctx.transferProductionRequestDetailBinding(h.source, h.target), false);
  assert.equal(h.ctx.productionMasterDetailBindings.has(h.target), false);
});

test('unprojected legacy Request behavior neither requires nor invents an exact-detail binding', async () => {
  const h = await fixture(); h.state.projected = false; h.ctx.nativeAuthSessionActive = false;
  h.ctx.productionMasterDetailBindings = new WeakMap(); h.ctx.productionMasterDetailSession = null;
  assert.equal(h.ctx.transferProductionRequestDetailBinding(h.source, h.target), true);
  assert.equal(h.ctx.productionMasterDetailBindings.has(h.target), false);
  assert.equal(h.ctx.hasProductionMasterDetailForItem(h.target), true);
});

const MASTER_VALUE_PATCHES = Object.freeze({ req_match: 'match', loc_match_qty: 'loc_match_qty', req_spec: 'spec',
  req_caliper: 'caliper', req_pic_note: 'pic_note', av_note: 'av_note', drive_photo_link: 'photo_link', drive_photo_name: 'photo_name' });
const RULE_COLUMNS = Object.freeze(['av_rule_priority_snapshot', 'av_rule_holdstop_snapshot', 'av_rule_match_updated_at',
  'av_rule_spec_updated_at', 'av_rule_caliper_updated_at', 'av_rule_av_note_updated_at', 'av_rule_photo_updated_at',
  'av_rule_bundle_updated_at']);
const SERVER_TIME = '2026-09-10T19:10:00.123456+00:00';

// Independent transcription of the deployed SQL SET list, not a call to the
// application comparator under test. This is synthetic acknowledgement data.
function serverAcknowledgement(before, patch, version = 9) {
  const after = structuredClone(before), has = key => Object.hasOwn(patch, key);
  for (const [key, column] of Object.entries(MASTER_VALUE_PATCHES)) {
    if (has(key)) after[column] = patch[key] === null ? null : String(patch[key]);
  }
  const evidence = ['req_match', 'req_spec', 'req_caliper', 'req_pic_note', 'av_note'].some(has);
  const photo = has('drive_photo_link') || has('drive_photo_name');
  if (evidence) {
    after.av_rule_priority_snapshot = before.priority;
    after.av_rule_holdstop_snapshot = [before.holdstopcode, before.holdstopreason]
      .map(value => String(value ?? '').trim()).filter(Boolean).join('|');
  }
  for (const [key, name] of Object.entries({ req_match: 'match', req_spec: 'spec', req_caliper: 'caliper', av_note: 'av_note' })) {
    if (has(key)) after[`av_rule_${name}_updated_at`] = SERVER_TIME;
  }
  if (photo) after.av_rule_photo_updated_at = SERVER_TIME;
  if (evidence || photo) after.av_rule_bundle_updated_at = SERVER_TIME;
  const ack = { unique_id: 'REQUEST-SYNTHETIC-1', master_id: before.unique_id,
    itemcode: before.itemcode, locationcode: before.locationcode, lotcode: before.lotcode, contsize: before.contsize,
    req_status: 'Pending', date_completed: null, row_version: version, updated_at: SERVER_TIME,
    req_match: has('req_match') && patch.req_match !== null ? Number(patch.req_match) : null,
    req_spec: has('req_spec') ? patch.req_spec : 'SERVER SPEC', req_photo_link: patch.drive_photo_link || '',
    request_note: 'UNCHANGED SERVER REQUEST NOTE' };
  for (const column of Object.values(MASTER_VALUE_PATCHES)) ack[`drive_${column}`] = after[column];
  for (const column of RULE_COLUMNS) ack[column] = after[column];
  return { after, ack };
}

async function ownSaveFixture(patch = { req_spec: 'ACKNOWLEDGED SPEC' }, options = {}) {
  const h = await fixture(options);
  const bind = appFunction('bindProductionMasterDetailRow');
  const names = ['normalizeRequestStatus', 'hasCompletionDateValue', 'hasRequestCompletionState', 'captureProductionRequestDetailOwnSave',
    'isProductionRequestDetailOwnSaveCurrent', 'buildAcknowledgedRequestMasterSnapshot',
    'continueProductionRequestDetailOwnSave', 'finishProductionRequestDetailOwnSave', 'resumeProductionRequestDetailOwnSave',
    'productionMasterCanonicalRowsMatch'];
  let timerId = 0;
  const timers = new Map();
  Object.assign(h.ctx, { structuredClone,
    requestCameraPickerOwner: null, pendingRequestCameraSelection: null,
    requestPhotoSelectionIsCurrent: () => { throw new Error('No camera selection is seeded in this fixture'); },
    applyProductionMasterDetailControlState: () => {}, refreshProtectedSections: () => {}, applyCameraPermissions: () => {},
    setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    formatFetchedRows: (rows, table) => rows.map(row => ({
      ...Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toUpperCase(), value])),
      SOURCE_TABLE: table, source_table: table
    }))
  });
  vm.runInContext(bind + '\n' + names.map(appFunction).join('\n'), h.ctx);
  const ticket = h.ctx.captureProductionRequestDetailOwnSave(h.source, patch, false);
  assert.ok(ticket, 'capture requires actual current master/Request/exact verification');
  const response = serverAcknowledgement(ticket.before, patch);
  h.ctx.fetchAllSupabaseRows = async (table, query) => {
    assert.equal(table, 'ph_active_request_live_rows');
    assert.equal(query, 'select=*&unique_id=eq.REQUEST-SYNTHETIC-1');
    return [structuredClone(response.ack)];
  };
  return { ...h, ticket, ...response, timers,
    publishAcknowledged() { Object.assign(h.rawMaster, response.after); h.state.revision = '2'; },
    response };
}

test('Request own-save maps raw numeric text and explicit nulls without modifying the frozen pre-save baseline', async () => {
  const patch = { req_match: '42.0', loc_match_qty: '12.6', req_spec: null, req_caliper: '', req_pic_note: 'PICK',
    av_note: 'ACK NOTE', drive_photo_link: 'https://synthetic.invalid/photo.jpg', drive_photo_name: 'photo.jpg' };
  const h = await ownSaveFixture(patch), before = structuredClone(h.ticket.before);
  const expected = h.ctx.buildAcknowledgedRequestMasterSnapshot(h.ticket, h.ack);
  assert.equal(expected.match, '42.0', 'master text is not inferred from numeric Request req_match=42');
  assert.equal(h.ack.req_match, 42);
  assert.equal(expected.spec, null);
  assert.equal(expected.caliper, '');
  assert.equal(expected.av_rule_match_updated_at, SERVER_TIME);
  assert.equal(expected.av_rule_photo_updated_at, SERVER_TIME);
  assert.equal(expected.last_updated, before.last_updated, 'Request RPC does not update master LAST_UPDATED');
  assert.deepEqual(JSON.parse(JSON.stringify(expected)), h.after);
  assert.deepEqual(h.ticket.before, before);
  patch.req_spec = 'LATER LOCAL EDIT';
  assert.equal(h.ticket.patch.req_spec, null, 'ticket captured the outbound patch independently');
});

test('all213 physical fields are compared, including unrelated omitted fields and unknown extra keys', async () => {
  const h = await ownSaveFixture(), expected = h.ctx.buildAcknowledgedRequestMasterSnapshot(h.ticket, h.ack);
  assert.equal(Object.keys(expected).length, 213);
  assert.equal(h.ctx.productionMasterCanonicalRowsMatch(expected, h.after), true);
  for (const column of modules.AgMetricInventoryList.physicalColumns) {
    const changed = { ...h.after, [column]: h.after[column] === null ? 'UNRELATED CHANGE' : null };
    assert.equal(h.ctx.productionMasterCanonicalRowsMatch(expected, changed), false, column);
    const missing = { ...h.after }; delete missing[column];
    assert.equal(h.ctx.productionMasterCanonicalRowsMatch(expected, missing), false, `missing ${column}`);
  }
  assert.equal(h.ctx.productionMasterCanonicalRowsMatch(expected, { ...h.after, unexpected_server_field: null }), false);
});

test('every one of the16 acknowledged master values/snapshots/stamps is required and cannot be forged', async () => {
  const h = await ownSaveFixture({ req_match: '42.0', loc_match_qty: '4.2', req_spec: 'SPEC', req_caliper: '1.0',
    req_pic_note: 'PICK', av_note: 'NOTE', drive_photo_link: 'https://synthetic.invalid/photo', drive_photo_name: 'photo' });
  const keys = [...Object.values(MASTER_VALUE_PATCHES).map(column => `drive_${column}`), ...RULE_COLUMNS];
  assert.equal(keys.length, 16);
  for (const key of keys) {
    const missing = { ...h.ack }; delete missing[key];
    assert.equal(h.ctx.buildAcknowledgedRequestMasterSnapshot(h.ticket, missing), null, `missing ${key}`);
    const wrong = { ...h.ack, [key]: h.ack[key] === null ? 'FORGED VALUE' : null };
    assert.equal(h.ctx.buildAcknowledgedRequestMasterSnapshot(h.ticket, wrong), null, `wrong ${key}`);
    const uppercaseOnly = { ...missing, [key.toUpperCase()]: h.ack[key] };
    assert.equal(h.ctx.buildAcknowledgedRequestMasterSnapshot(h.ticket, uppercaseOnly), null, `formatted alias cannot replace raw ${key}`);
  }
});

for (const [name, change] of [
  ['missing raw Drive field', ack => { delete ack.drive_spec; }],
  ['unacknowledged Drive value', ack => { ack.drive_spec = 'OTHER WRITE'; }],
  ['missing rule field', ack => { delete ack.av_rule_photo_updated_at; }],
  ['wrong transaction timestamp', ack => { ack.av_rule_spec_updated_at = '2026-09-10T19:10:00.123457+00:00'; }],
  ['missing server timestamp', ack => { delete ack.updated_at; }],
  ['invalid server timestamp', ack => { ack.updated_at = 'invalid'; }],
  ['other Request ID', ack => { ack.unique_id = 'REQUEST-SYNTHETIC-2'; }],
  ['other linked master', ack => { ack.master_id = 'MASTER-SYNTHETIC-2'; }],
  ['completed acknowledgement', ack => { ack.req_status = 'Complete'; }],
  ['unchanged row version', ack => { ack.row_version = 7; }],
  ['missing row version', ack => { delete ack.row_version; }],
  ['non-numeric row version', ack => { ack.row_version = 'bad'; }],
  ['infinite row version', ack => { ack.row_version = Infinity; }],
  ['fractional row version', ack => { ack.row_version = 8.5; }]
]) {
  test(`Request own-save rejects ${name}`, async () => {
    const h = await ownSaveFixture(); change(h.ack);
    assert.equal(h.ctx.buildAcknowledgedRequestMasterSnapshot(h.ticket, h.ack), null);
  });
}

test('Request-only note save leaves all master values and evidence timestamps unchanged', async () => {
  const h = await ownSaveFixture({ req_comments: 'REQUEST-ONLY COMMENT' });
  const expected = h.ctx.buildAcknowledgedRequestMasterSnapshot(h.ticket, h.ack);
  assert.deepEqual(JSON.parse(JSON.stringify(expected)), h.ticket.before);
});

test('a fully acknowledged Request save rebinds only after exact master and Request rereads', async () => {
  const h = await ownSaveFixture(); h.publishAcknowledged();
  assert.equal(await h.ctx.continueProductionRequestDetailOwnSave(h.ticket, h.ack), true);
  assert.equal(h.ticket.rebound, true);
  assert.equal(h.ctx.productionMasterDetailBindings.get(h.source).fence.revision, '2');
  assert.equal(h.source.SOURCE, 'CURRENT', 'live Request view omits SOURCE; it must not invent an empty identity');
  assert.equal(h.source.REQ_SPEC, 'ACKNOWLEDGED SPEC');
  h.ctx.finishProductionRequestDetailOwnSave(h.ticket);
  assert.equal(h.ctx.hasProductionMasterDetailForItem(h.source), true);
});

function deferred() {
  let resolve;
  return { promise: new Promise(done => { resolve = done; }), resolve: value => resolve(value) };
}

for (const [name, change] of [
  ['account change', h => { h.state.scope = h.context.scope = 'synthetic-account-b'; }],
  ['login generation change', h => { h.state.loginGeneration++; }],
  ['same-account auth epoch change', h => { h.state.authEpoch++; }],
  ['permission change', h => { h.state.permission = h.context.permissionVersion = h.dataset.liveVerifiedPermission = 'permission-b'; }],
  ['detail token change', h => { h.ctx.detailHydrationToken++; }],
  ['master source change', h => { h.rawMaster.source = 'OTHER SOURCE'; h.state.revision = '3'; }],
  ['unrelated master field change', h => { h.rawMaster.app_tab_assignment = 'OTHER ASSIGNMENT'; h.state.revision = '3'; }],
  ['unrelated Request change', h => { h.response.ack.request_note = 'OTHER REQUEST WRITE'; }]
]) {
  test(`held own-save verification cannot rebind after ${name}`, async () => {
    const h = await ownSaveFixture(); h.publishAcknowledged();
    const held = deferred(), entered = deferred(), acknowledged = structuredClone(h.ack);
    h.ctx.fetchAllSupabaseRows = async () => { entered.resolve(); await held.promise; return [structuredClone(h.response.ack)]; };
    const pending = h.ctx.continueProductionRequestDetailOwnSave(h.ticket, acknowledged);
    await entered.promise; change(h); held.resolve();
    assert.equal(await pending, false);
    assert.notEqual(h.ticket.rebound, true);
    assert.equal(h.ctx.productionMasterDetailBindings.get(h.source), h.proof, 'no partially published fresh proof');
    h.ctx.finishProductionRequestDetailOwnSave(h.ticket);
  });
}

test('late reads after the bounded continuation timeout cannot publish a new proof', async () => {
  const h = await ownSaveFixture(); h.publishAcknowledged();
  const held = deferred(), entered = deferred();
  h.ctx.fetchAllSupabaseRows = async () => { entered.resolve(); await held.promise; return [structuredClone(h.ack)]; };
  const pending = h.ctx.continueProductionRequestDetailOwnSave(h.ticket, h.ack);
  await entered.promise;
  assert.equal(h.timers.size, 1);
  [...h.timers.values()][0]();
  assert.equal(await pending, false);
  held.resolve();
  for (let turn = 0; turn < 50; turn++) await Promise.resolve();
  assert.notEqual(h.ticket.rebound, true);
  assert.equal(h.ctx.productionMasterDetailBindings.get(h.source), h.proof);
  h.ctx.finishProductionRequestDetailOwnSave(h.ticket);
});

test('a changed canonical write object cannot leave the editor half-rebound', async () => {
  const h = await ownSaveFixture(); h.ticket.writeItem = h.target; h.publishAcknowledged();
  const held = deferred(), entered = deferred();
  h.ctx.fetchAllSupabaseRows = async () => { entered.resolve(); await held.promise; return [structuredClone(h.ack)]; };
  const pending = h.ctx.continueProductionRequestDetailOwnSave(h.ticket, h.ack);
  await entered.promise; h.target.LOCATIONCODE = 'OTHER LOCATION'; held.resolve();
  assert.equal(await pending, false);
  assert.equal(h.ctx.productionMasterDetailBindings.get(h.source), h.proof);
  assert.equal(h.source.REQ_SPEC, 'LOCAL DRAFT');
  h.ctx.finishProductionRequestDetailOwnSave(h.ticket);
});

test('a hidden native-camera acknowledgement is retained and verified once on foreground without resending', async () => {
  const h = await ownSaveFixture(); h.publishAcknowledged();
  h.ctx.document.hidden = true; h.context.visible = false;
  let exactRequestReads = 0, settled = false;
  h.ctx.fetchAllSupabaseRows = async () => { exactRequestReads++; return [structuredClone(h.ack)]; };
  h.ticket.promise.then(() => { settled = true; });
  assert.equal(await h.ctx.continueProductionRequestDetailOwnSave(h.ticket, h.ack), false);
  assert.equal(h.ticket.deferred, true);
  assert.equal(h.ticket.checking, true);
  assert.equal(exactRequestReads, 0);
  assert.equal(h.state.fetches, 1);
  h.ctx.finishProductionRequestDetailOwnSave(h.ticket);
  await Promise.resolve();
  assert.equal(settled, false, 'successful server acknowledgement waits for read-only foreground verification');
  assert.equal(h.ctx.productionMasterDetailSession.requestOwnSave, h.ticket);
  h.ctx.document.hidden = false; h.context.visible = true;
  h.ctx.resumeProductionRequestDetailOwnSave(h.ticket);
  h.ctx.resumeProductionRequestDetailOwnSave(h.ticket);
  assert.equal(await h.ticket.promise, true);
  assert.equal(exactRequestReads, 1, 'multiple foreground signals share one continuation');
  assert.equal(h.ctx.hasProductionMasterDetailForItem(h.source), true);
  assert.equal(h.ctx.productionMasterDetailSession.requestOwnSave, null);
});

test('a camera interruption retires an awaited old read before the retained acknowledgement resumes', async () => {
  const h = await ownSaveFixture(); h.publishAcknowledged();
  const held = deferred(), entered = deferred(); let reads = 0;
  h.ctx.fetchAllSupabaseRows = async () => {
    reads++;
    if (reads === 1) { entered.resolve(); await held.promise; }
    return [structuredClone(h.ack)];
  };
  const oldAttempt = h.ctx.continueProductionRequestDetailOwnSave(h.ticket, h.ack);
  await entered.promise;
  const oldGeneration = h.ticket.verificationGeneration;
  h.ctx.document.hidden = true; h.context.visible = false;
  [...h.timers.values()][0]();
  assert.equal(await oldAttempt, false);
  assert.equal(h.ticket.deferred, true);
  assert.ok(h.ticket.verificationGeneration > oldGeneration);
  h.ctx.finishProductionRequestDetailOwnSave(h.ticket);
  h.ctx.document.hidden = false; h.context.visible = true;
  h.ctx.resumeProductionRequestDetailOwnSave(h.ticket);
  assert.equal(await h.ticket.promise, true);
  const freshProof = h.ctx.productionMasterDetailBindings.get(h.source);
  held.resolve();
  for (let turn = 0; turn < 50; turn++) await Promise.resolve();
  assert.equal(reads, 2);
  assert.equal(h.ctx.productionMasterDetailBindings.get(h.source), freshProof, 'late retired attempt never republishes');
  assert.equal(h.ctx.hasProductionMasterDetailForItem(h.source), true);
});

for (const [name, change] of [
  ['account', h => { h.state.scope = h.context.scope = 'synthetic-account-b'; }],
  ['auth epoch', h => { h.state.authEpoch++; }],
  ['permission version', h => { h.state.permission = h.context.permissionVersion = h.dataset.liveVerifiedPermission = 'permission-b'; }],
  ['unrelated master change', h => { h.rawMaster.app_tab_assignment = 'OTHER ASSIGNMENT'; h.state.revision = '3'; }],
  ['unrelated Request change', h => { h.response.ack.request_note = 'OTHER WRITE'; }]
]) {
  test(`deferred camera acknowledgement cannot rebind after ${name} changes`, async () => {
    const h = await ownSaveFixture(); h.publishAcknowledged();
    h.ctx.document.hidden = true; h.context.visible = false;
    assert.equal(await h.ctx.continueProductionRequestDetailOwnSave(h.ticket, h.ack), false);
    h.ctx.finishProductionRequestDetailOwnSave(h.ticket);
    assert.equal(h.ticket.deferred, true);
    h.ctx.document.hidden = false; h.context.visible = true; change(h);
    h.ctx.resumeProductionRequestDetailOwnSave(h.ticket);
    assert.equal(await h.ticket.promise, false);
    assert.notEqual(h.ticket.rebound, true);
    assert.equal(h.ctx.productionMasterDetailBindings.get(h.source), h.proof);
    assert.equal(h.source.REQ_SPEC, 'LOCAL DRAFT', 'stale continuation never repopulates the editor');
  });
}

async function requestCameraFixture(options = {}) {
  const h = await fixture(options);
  const capabilities = { canCreate: true, canManage: true, canEdit: true, canTakePhoto: true,
    canComplete: true, canView: true, scope: 'global' };
  Object.assign(h.ctx, { setTimeout, clearTimeout, currentUser: 'synthetic_admin',
    requestCapabilityState: { username: 'synthetic_admin', capabilities },
    getRoleAccessState: () => ({ isAdmin: true, isRepLike: false }),
    SECURE_DRIVE_EVIDENCE_PREFIXES: new Set(['ssn-', 'lsn-', 'na-']),
    PROTECTED_DRIVE_PHOTO_PREFIXES: new Set(['ssn-', 'lsn-', 'na-', 'flyer-']),
    isDockSuspendDcRequestMirrorRow: () => false,
    requestCameraSelectionOwners: new WeakMap(), requestCameraPickerOwner: null,
    pendingRequestCameraSelection: null,
    findRequestRowByUniqueId: uid => uid === h.target.UNIQUE_ID ? h.target : null
  });
  const names = ['getRequestCapabilityUsernameKey', 'getRequestCapabilities', 'canCurrentUserWorkRequestItem',
    'isRepReadOnlyUser', 'canRepEditDetailPrefix', 'getEditableDetailItemForPrefix', 'canEditRowDetailsByRole',
    'canEditRowDetails', 'canUploadRowPhotoByRole', 'canUploadRowPhoto', 'isRequestDetailItem',
    'captureRequestPhotoSelectionOwner', 'requestPhotoSelectionOwnerIsCurrent', 'requestPhotoSelectionIsCurrent',
    'ensureRequestPhotoSelectionReady', 'retainAndVerifyRequestCameraUpload',
    'canReviewRetainedRequestCameraSelection', 'reviewRetainedRequestCameraSelection', 'openRetainedRequestCameraSelection'];
  vm.runInContext(names.map(appFunction).join('\n'), h.ctx);
  const input = { addEventListener() {} }, file = Object.freeze({ name: 'synthetic-camera.jpg', type: 'image/jpeg' });
  const selection = h.ctx.captureRequestPhotoSelectionOwner(input);
  assert.equal(selection.reviewed, true, 'capture uses native capability policy and genuine exact-row proof');
  selection.files.push(file);
  h.ctx.pendingRequestCameraSelection = selection;
  return { ...h, capabilities, input, file, selection,
    uploaded: Object.freeze({ publicUrl: 'https://synthetic.invalid/already-uploaded.jpg', fileName: 'already-uploaded.jpg' }) };
}

function photoRows(h) {
  return structuredClone({ editor: h.source, request: h.target, master: h.rawMaster });
}

for (const [name, change] of [
  ['account', h => { h.state.scope = h.context.scope = 'synthetic-account-b'; }],
  ['login generation', h => { h.state.loginGeneration++; }],
  ['same-account auth epoch', h => { h.state.authEpoch++; }],
  ['permission revision', h => { h.state.permission = h.context.permissionVersion = h.dataset.liveVerifiedPermission = 'permission-b'; }],
  ['master revision', h => { h.state.revision = h.context.revision = h.dataset.liveVerifiedRevision = '2'; }],
  ['detail generation', h => { h.ctx.detailHydrationToken++; }],
  ['editor source', h => { h.source.SOURCE = 'OTHER SOURCE'; }],
  ['canonical Request identity', h => { h.target.MASTER_ID = 'MASTER-SYNTHETIC-2'; }],
  ['photo capability', h => { h.capabilities.canTakePhoto = false; }],
  ['Request edit capability', h => { h.capabilities.canEdit = false; }]
]) {
  test(`an upload response after ${name} changes is retained without publishing to any row`, async () => {
    const h = await requestCameraFixture(), heldUpload = deferred();
    const pending = heldUpload.promise.then(uploaded =>
      h.ctx.retainAndVerifyRequestCameraUpload(h.selection, h.source, h.file, uploaded));
    change(h);
    const beforeResponse = photoRows(h);
    heldUpload.resolve(h.uploaded);
    assert.equal(await pending, null);
    assert.deepEqual(photoRows(h), beforeResponse, 'no stale editor, Request, or linked-master mutation');
    assert.equal(h.selection.files.length, 1);
    assert.equal(h.selection.files[0], h.file, 'original File survives the rejected publication');
    const retained = h.selection.uploadedPhotos.get(h.file);
    assert.equal(retained.publicUrl, h.uploaded.publicUrl, 'successful HTTP upload is not forgotten');
    assert.equal(retained.fileName, h.uploaded.fileName);
    assert.equal(Object.isFrozen(retained), true);
    assert.equal(h.ctx.productionMasterDetailBindings.get(h.source), h.proof, 'response cannot stamp a new editor fence');
  });
}

test('the post-upload verification await cannot mask a subsequent Request source change', async () => {
  const h = await requestCameraFixture(), entered = deferred(), heldMetadata = deferred();
  h.coordinator.suspend();
  h.state.metadataHook = async metadata => { entered.resolve(); await heldMetadata.promise; return metadata; };
  const pending = h.ctx.retainAndVerifyRequestCameraUpload(h.selection, h.source, h.file, h.uploaded);
  await entered.promise;
  h.target.LOCATIONCODE = 'OTHER LOCATION';
  const beforeResponse = photoRows(h);
  heldMetadata.resolve();
  assert.equal(await pending, null);
  assert.deepEqual(photoRows(h), beforeResponse);
  assert.equal(h.selection.uploadedPhotos.get(h.file).publicUrl, h.uploaded.publicUrl);
  assert.equal(h.selection.files[0], h.file);
  assert.equal(h.ctx.productionMasterDetailBindings.has(h.target), false);
});

test('a current post-upload response resolves only its exact canonical Request and reuses the original fence', async () => {
  const h = await requestCameraFixture(), beforeResponse = photoRows(h);
  const canonical = await h.ctx.retainAndVerifyRequestCameraUpload(h.selection, h.source, h.file, h.uploaded);
  assert.equal(canonical, h.target);
  assert.deepEqual(photoRows(h), beforeResponse, 'validation itself does not publish or schedule a row write');
  assert.equal(h.ctx.productionMasterDetailBindings.get(h.target), h.proof);
  assert.equal(h.selection.files[0], h.file, 'caller removes File only after successful publication');
});

test('a previously reviewed camera binding survives a routine unchanged metadata check at picker activation', async () => {
  const h = await requestCameraFixture(), entered = deferred(), heldMetadata = deferred();
  h.state.metadataHook = async metadata => { entered.resolve(); await heldMetadata.promise; return metadata; };
  const checking = h.coordinator.check('routine-unchanged-poll');
  await entered.promise;
  assert.equal(h.ctx.isProductionMasterDetailBindingCurrent(h.source), true);
  assert.equal(h.ctx.hasProductionMasterDetailForItem(h.source), false, 'the genuine coordinator temporarily withholds readiness');
  const duringCheck = h.ctx.captureRequestPhotoSelectionOwner({ addEventListener() {} });
  heldMetadata.resolve();
  assert.equal(await checking, true);
  assert.equal(h.ctx.hasProductionMasterDetailForItem(h.source), true);
  assert.equal(h.ctx.requestPhotoSelectionIsCurrent(duringCheck), true,
    'unchanged authorization and original exact proof must not permanently strand the returned camera File');
});

function installPhotoQueueBoundaries(h, upload) {
  const uploads = [], publications = [], persists = [], blobWrites = [];
  const makeBitmap = async () => ({ width: 10, height: 10, close() {} });
  Object.assign(h.ctx, {
    createImageBitmap: makeBitmap,
    URL: { createObjectURL: () => 'blob:synthetic-camera-preview', revokeObjectURL() {} },
    PHOTO_BUCKETS: { 'req-': 'plant_photos', default: 'plant_photos' },
    HIGH_VOLUME_PLANT_PHOTO_BUCKETS: new Set(['plant_photos']),
    SUPABASE_UPLOAD_TIMEOUT_MS: 1000, REQUEST_BLOB_STORE: 'synthetic-request-blobs',
    activeDetailTab: 'request', pendingPhotoPreviews: new Map(),
    getRequestPhotoOwnerItem: item => item,
    createPendingPhotoToken: () => `synthetic-token-${uploads.length}`,
    buildInventoryRowPhotoFileName: () => 'synthetic-camera.jpg',
    getInventoryPhotoFileExtension: () => 'jpg', getPhotoUploadContentType: () => 'image/jpeg',
    putIndexedDbRecord: async (store, record) => { blobWrites.push({ store, record }); },
    createPendingPhotoPreview: () => ({ id: 'synthetic-preview' }),
    clearPendingPhotoPreview() {}, refreshPendingPhotoUiForItem() {}, renderRequestCameraSelectionState() {},
    markCameraActivity() {}, markPhotoPersistActivity() {},
    runAfterShellInteractive: callback => callback(), scheduleDeferredPhotoUploadStart: callback => callback(),
    isIOSDevice: () => false, isTouchConstrainedDevice: () => false,
    uploadPhotoViaAppApi: upload,
    registerPendingPhotoUpload: (item, prefix, pending) => { if (!uploads.includes(pending)) uploads.push(pending); },
    applyUploadedPhotoEverywhere: (item, prefix, url, name) => {
      publications.push({ item, prefix, url, name }); item.REQ_PHOTO_LINK = url;
    },
    schedulePhotoFieldPersist: (item, prefix) => persists.push({ item, prefix }),
    formatPhotoUploadErrorMessage: error => error.message, showToast() {}
  });
  h.ctx.window.createImageBitmap = makeBitmap;
  vm.runInContext([appFunction('queueRowPhotoUpload'), appFunction('retryRetainedRequestCameraSelection')].join('\n'), h.ctx);
  // Keep the captured editor as the canonical object in this boundary fixture;
  // proof-transfer cases above separately exercise distinct canonical objects.
  h.ctx.findRequestRowByUniqueId = uid => uid === h.source.UNIQUE_ID ? h.source : null;
  return { uploads, publications, persists, blobWrites };
}

function installCameraReturnHandler(h) {
  h.selection.files = [];
  h.ctx.pendingRequestCameraSelection = null;
  h.input.files = [h.file];
  h.input.value = 'synthetic-native-camera-selection';
  vm.runInContext([appFunction('handleRetainedRequestCameraSelection'), appFunction('handlePhotoUpload')].join('\n'), h.ctx);
}

async function reopenReviewedRequest(h, active = h.source) {
  h.ctx.navigator.onLine = h.context.online = true;
  h.ctx.document.hidden = false;
  await h.coordinator.check('synthetic-reviewed-request-reopen');
  await h.store.ensure(['MASTER-SYNTHETIC-1']);
  h.ctx.activeItem = active;
  h.ctx.detailHydrationToken++;
  h.ctx.productionMasterDetailSession = {
    item: active, token: h.ctx.detailHydrationToken, owner: h.ctx.captureLoginSessionOwnership(),
    sourceView: 'request', status: 'ready', ids: ['MASTER-SYNTHETIC-1'],
    rowIdentity: h.ctx.getProductionMasterDetailIdentity(active), readIdentity: h.ctx.getSupabaseReadIdentityScope(),
  };
  vm.runInContext(appFunction('bindProductionMasterDetailRow'), h.ctx);
  h.ctx.bindProductionMasterDetailRow(active, ['MASTER-SYNTHETIC-1']);
  assert.equal(h.ctx.hasProductionMasterDetailForItem(active), true, 'reopened detail uses the real verified exact cache');
  assert.equal(h.ctx.canUseVerifiedProductionData(['master', 'requests']), true);
}

async function twoRetainedSelectionsFixture() {
  const h = await requestCameraFixture({ contsize: '#7' });
  const uploadedFiles = [];
  const q = installPhotoQueueBoundaries(h, async (_prefix, file) => {
    uploadedFiles.push(file);
    return { ...h.uploaded, filePath: h.uploaded.fileName };
  });
  installCameraReturnHandler(h);
  h.ctx.navigator.onLine = h.context.online = false;
  assert.equal(await h.ctx.handlePhotoUpload(h.input, 'req-'), false);
  const first = h.ctx.pendingRequestCameraSelection;
  await reopenReviewedRequest(h);
  const secondFile = Object.freeze({ name: 'second-camera.jpg', type: 'image/jpeg' });
  const secondInput = { addEventListener() {}, files: [secondFile], value: 'second-native-camera-selection' };
  const second = h.ctx.captureRequestPhotoSelectionOwner(secondInput);
  h.ctx.navigator.onLine = h.context.online = false;
  assert.equal(await h.ctx.handlePhotoUpload(secondInput, 'req-'), false);
  return { ...h, q, uploadedFiles, first, second, secondFile };
}

test('photo A survives an offline return, same-Request reopen and photo B, until explicit review retries only A', async () => {
  const h = await twoRetainedSelectionsFixture();
  assert.deepEqual(Array.from(h.ctx.getRetainedRequestCameraSelections()), [h.first, h.second]);
  assert.equal(h.first.files[0], h.file);
  assert.equal(h.second.files[0], h.secondFile);
  assert.equal(h.q.blobWrites.length, 0, 'pre-upload retention does not depend on the upload blob store');
  assert.equal(h.uploadedFiles.length, 0);
  const firstSession = h.first.session, firstToken = h.first.token, firstFence = h.first.fence;
  await reopenReviewedRequest(h);

  // Ordinary retry cannot silently adopt a new detail session.
  h.ctx.pendingRequestCameraSelection = h.first;
  assert.equal(await h.ctx.retryRetainedRequestCameraSelection(), false);
  assert.equal(h.first.session, firstSession);
  assert.equal(h.first.token, firstToken);
  assert.equal(h.first.fence, firstFence);
  assert.equal(h.uploadedFiles.length, 0);

  assert.equal(h.ctx.canReviewRetainedRequestCameraSelection(h.first), true);
  assert.equal(await h.ctx.reviewRetainedRequestCameraSelection(h.first), true);
  assert.equal(await h.q.uploads[0], h.uploaded.publicUrl);
  assert.deepEqual(h.uploadedFiles, [h.file], 'explicit recovery uploads the selected original File only');
  assert.equal(h.first.files.length, 0);
  assert.equal(h.second.files[0], h.secondFile);
  assert.deepEqual(Array.from(h.ctx.getRetainedRequestCameraSelections()), [h.second]);
  assert.equal(h.q.persists.length, 1);
});

for (const [name, change] of [
  ['another Request is open', async h => {
    await reopenReviewedRequest(h, { ...h.source, UNIQUE_ID: 'OTHER-REQUEST' });
  }],
  ['the linked master identity changed', h => { h.source.MASTER_ID = 'OTHER-MASTER'; }],
  ['the container changed', h => { h.source.CONTSIZE = '#15'; }],
  ['the login owner changed', h => { h.state.loginGeneration++; }],
  ['the read scope changed', h => { h.state.scope = h.context.scope = 'OTHER-ACCOUNT-SCOPE'; }],
  ['the auth epoch changed', h => { h.state.authEpoch++; }],
  ['photo permission was revoked', h => { h.capabilities.canTakePhoto = false; }],
]) {
  test(`retained photos cannot be reviewed onto an unapproved context when ${name}`, async () => {
    const h = await twoRetainedSelectionsFixture();
    await reopenReviewedRequest(h);
    await change(h);
    const before = photoRows(h), activeBefore = structuredClone(h.ctx.activeItem);
    const session = h.first.session, token = h.first.token, fence = h.first.fence;

    assert.equal(h.ctx.canReviewRetainedRequestCameraSelection(h.first), false);
    assert.equal(await h.ctx.reviewRetainedRequestCameraSelection(h.first), false);
    assert.equal(h.first.session, session);
    assert.equal(h.first.token, token);
    assert.equal(h.first.fence, fence);
    assert.equal(h.first.files[0], h.file);
    assert.equal(h.second.files[0], h.secondFile);
    assert.deepEqual(Array.from(h.ctx.getRetainedRequestCameraSelections()), [h.first, h.second]);
    assert.deepEqual(photoRows(h), before);
    assert.deepEqual(structuredClone(h.ctx.activeItem), activeBefore);
    assert.equal(h.uploadedFiles.length, 0);
    assert.equal(h.q.persists.length, 0);
  });
}

test('opening retained photo A navigates only its original Request without restamping proof or uploading', async () => {
  const h = await twoRetainedSelectionsFixture();
  await reopenReviewedRequest(h, { ...h.source, UNIQUE_ID: 'OTHER-REQUEST' });
  const opened = [];
  h.ctx.openDetail = (...args) => opened.push(args);
  const session = h.first.session, token = h.first.token, fence = h.first.fence;
  assert.equal(h.ctx.openRetainedRequestCameraSelection(h.first), true);
  assert.deepEqual(opened, [[h.source.UNIQUE_ID, 'request']]);
  assert.equal(h.first.session, session);
  assert.equal(h.first.token, token);
  assert.equal(h.first.fence, fence);
  assert.equal(h.first.files[0], h.file);
  assert.equal(h.second.files[0], h.secondFile);
  assert.equal(h.uploadedFiles.length, 0);
  h.state.loginGeneration++;
  assert.equal(h.ctx.openRetainedRequestCameraSelection(h.first), false, 'another login cannot open the prior owner’s retained record');
  assert.equal(opened.length, 1);
});

test('saving retained photos to the device uses the original Files and cannot expose another login’s files', async () => {
  const h = await twoRetainedSelectionsFixture();
  const blobs = [], downloads = [], revoked = [], timers = [];
  Object.assign(h.ctx, {
    URL: { createObjectURL: file => { blobs.push(file); return `blob:retained-${blobs.length}`; },
      revokeObjectURL: url => revoked.push(url) },
    document: { createElement: tag => {
      assert.equal(tag, 'a');
      return { click() { downloads.push({ href: this.href, name: this.download }); } };
    } },
    setTimeout: (callback, delay) => { assert.equal(delay, 1000); timers.push(callback); },
  });
  vm.runInContext(appFunction('downloadRetainedRequestCameraPhotos'), h.ctx);
  assert.equal(h.ctx.downloadRetainedRequestCameraPhotos(h.first), true);
  assert.deepEqual(blobs, [h.file]);
  assert.deepEqual(downloads, [{ href: 'blob:retained-1', name: h.file.name }]);
  assert.equal(h.first.files[0], h.file, 'download does not silently discard the original');
  assert.equal(h.second.files[0], h.secondFile);
  timers.forEach(callback => callback());
  assert.deepEqual(revoked, ['blob:retained-1']);
  h.state.loginGeneration++;
  assert.equal(h.ctx.downloadRetainedRequestCameraPhotos(h.first), false);
  assert.equal(blobs.length, 1);
  assert.equal(downloads.length, 1);
  assert.equal(h.uploadedFiles.length, 0);
});

test('discard requires confirmation and affects only the selected owner’s idle retained photos', async () => {
  const h = await twoRetainedSelectionsFixture();
  let confirmed = false, prompts = 0;
  h.ctx.window.confirm = () => { prompts++; return confirmed; };
  vm.runInContext(appFunction('discardRetainedRequestCameraPhotos'), h.ctx);
  assert.equal(h.ctx.discardRetainedRequestCameraPhotos(h.first), false);
  assert.equal(prompts, 1);
  assert.equal(h.first.files[0], h.file);
  assert.deepEqual(Array.from(h.ctx.getRetainedRequestCameraSelections()), [h.first, h.second]);

  confirmed = true;
  h.first.uploading = 1;
  assert.equal(h.ctx.discardRetainedRequestCameraPhotos(h.first), false);
  h.first.uploading = 0;
  h.first.promise = Promise.resolve();
  assert.equal(h.ctx.discardRetainedRequestCameraPhotos(h.first), false);
  h.first.promise = null;
  h.state.loginGeneration++;
  assert.equal(h.ctx.discardRetainedRequestCameraPhotos(h.first), false);
  assert.equal(prompts, 1, 'busy or differently owned files never reach a discard prompt');
  h.state.loginGeneration--;

  assert.equal(h.ctx.discardRetainedRequestCameraPhotos(h.first), true);
  assert.equal(prompts, 2);
  assert.equal(h.first.files.length, 0);
  assert.equal(h.second.files[0], h.secondFile);
  assert.deepEqual(Array.from(h.ctx.getRetainedRequestCameraSelections()), [h.second]);
  assert.equal(h.uploadedFiles.length, 0);
});

for (const [name, change] of [
  ['linked master changes', h => { h.target.MASTER_ID = 'OTHER-MASTER'; }],
  ['canonical location changes', h => { h.target.LOCATIONCODE = 'OTHER-LOCATION'; }],
  ['canonical inventory source changes', h => { h.target.SOURCE = 'OTHER-SOURCE'; }],
  ['login owner changes', h => { h.state.loginGeneration++; }],
  ['read scope changes', h => { h.state.scope = h.context.scope = 'OTHER-SCOPE'; }],
  ['photo permission is revoked', h => { h.capabilities.canTakePhoto = false; }],
]) {
  test(`the actual Request queue performs no photo merge before rejecting when ${name}`, async () => {
    const h = await requestCameraFixture();
    let httpUploads = 0;
    const q = installPhotoQueueBoundaries(h, async () => { httpUploads++; return h.uploaded; });
    // Exercise the real canonical-owner lookup and photo merge, rather than
    // the identity-preserving queue boundary used by other upload tests.
    Object.assign(h.ctx, {
      findRequestRowByUniqueId: uid => uid === h.target.UNIQUE_ID ? h.target : null,
      findLinkedMasterRow: () => null,
      normalizeRowPhotoFields: row => row,
      mergePhotoCsvList: values => [...new Set(values.filter(Boolean))].join(','),
    });
    vm.runInContext([appFunction('getRequestPhotoOwnerItem'), appFunction('mergeRequestPhotoFields')].join('\n'), h.ctx);
    h.source.REQ_PHOTO_LINK = 'https://synthetic.invalid/previous-plant.jpg';
    h.source.REQ_PHOTO_NAME = 'previous-plant.jpg';
    change(h);
    const before = photoRows(h);

    assert.equal(h.ctx.queueRowPhotoUpload(h.source, 'req-', h.file, { requestSelection: h.selection }), false);
    assert.deepEqual(photoRows(h), before, 'a rejected queue cannot copy any editor photo fields into the canonical Request');
    assert.equal(httpUploads, 0);
    assert.equal(q.blobWrites.length, 0);
    assert.equal(q.publications.length, 0);
    assert.equal(q.persists.length, 0);
    assert.equal(h.selection.files[0], h.file);
  });
}

test('the actual camera return retains its File through a genuine pending metadata check before uploading once', async () => {
  const h = await requestCameraFixture(), entered = deferred(), heldMetadata = deferred();
  let httpUploads = 0;
  const q = installPhotoQueueBoundaries(h, async () => {
    httpUploads++;
    return { ...h.uploaded, filePath: h.uploaded.fileName };
  });
  installCameraReturnHandler(h);
  h.state.metadataHook = async metadata => { entered.resolve(); await heldMetadata.promise; return metadata; };
  const checking = h.coordinator.check('synthetic-native-camera-return');
  await entered.promise;
  assert.equal(h.ctx.hasProductionMasterDetailForItem(h.source), false, 'real coordinator invalidates readiness while checking');

  const pending = h.ctx.handlePhotoUpload(h.input, 'req-');
  assert.equal(h.input.value, '', 'native input is reset only after retaining its selected File');
  assert.equal(h.ctx.pendingRequestCameraSelection, h.selection);
  assert.equal(h.selection.files.length, 1);
  assert.equal(h.selection.files[0], h.file);
  assert.equal(httpUploads, 0, 'verification is still required before upload');
  assert.equal(q.publications.length, 0);
  assert.equal(q.persists.length, 0);

  heldMetadata.resolve();
  assert.equal(await checking, true);
  assert.equal(await pending, true);
  assert.equal(await q.uploads[0], h.uploaded.publicUrl);
  assert.equal(httpUploads, 1);
  assert.equal(q.publications.length, 1);
  assert.equal(q.persists.length, 1);
  assert.equal(h.selection.files.length, 0);
});

for (const unavailable of ['offline', 'hidden']) {
  test(`the actual ${unavailable} camera return retains its original File without starting an upload`, async () => {
    const h = await requestCameraFixture();
    let httpUploads = 0;
    const q = installPhotoQueueBoundaries(h, async () => { httpUploads++; return h.uploaded; });
    installCameraReturnHandler(h);
    if (unavailable === 'offline') h.ctx.navigator.onLine = h.context.online = false;
    else { h.ctx.document.hidden = true; h.context.visible = false; }
    const before = photoRows(h);

    assert.equal(await h.ctx.handlePhotoUpload(h.input, 'req-'), false);
    assert.equal(h.ctx.pendingRequestCameraSelection, h.selection);
    assert.equal(h.selection.files.length, 1);
    assert.equal(h.selection.files[0], h.file);
    assert.equal(httpUploads, 0);
    assert.equal(q.publications.length, 0);
    assert.equal(q.persists.length, 0);
    assert.deepEqual(photoRows(h), before);
  });
}

test('actual Request queue retains a late uploaded response and manual recovery reuses its URL without a second HTTP upload', async () => {
  const h = await requestCameraFixture(), entered = deferred(), heldUpload = deferred();
  let httpUploads = 0;
  const q = installPhotoQueueBoundaries(h, async () => {
    httpUploads++; entered.resolve(); await heldUpload.promise;
    return { ...h.uploaded, bucketName: 'plant_photos', filePath: h.uploaded.fileName };
  });
  assert.equal(await h.ctx.retryRetainedRequestCameraSelection(), true);
  await entered.promise;
  h.capabilities.canTakePhoto = false;
  const beforeResponse = photoRows(h);
  heldUpload.resolve();
  await assert.rejects(q.uploads[0], /uploaded and retained/);
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
  assert.deepEqual(photoRows(h), beforeResponse);
  assert.equal(q.publications.length, 0);
  assert.equal(q.persists.length, 0, 'denied response schedules no Request save');
  assert.equal(h.selection.files[0], h.file);
  assert.equal(h.selection.uploadedPhotos.get(h.file).publicUrl, h.uploaded.publicUrl);
  assert.equal(httpUploads, 1);
  assert.equal(h.selection.uploading, 0);
  assert.equal(q.uploads.length, 1, 'failure does not automatically resend');

  // Restore the unchanged native photo capability, then explicitly retry.
  // The actual queue must skip its HTTP loop using the retained URL sidecar.
  h.capabilities.canTakePhoto = true;
  assert.equal(await h.ctx.retryRetainedRequestCameraSelection(), true);
  assert.equal(await q.uploads[1], h.uploaded.publicUrl);
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
  assert.equal(httpUploads, 1, 'manual retry did not duplicate the successful upload');
  assert.equal(q.publications.length, 1);
  assert.equal(q.publications[0].item, h.source);
  assert.equal(q.publications[0].url, h.uploaded.publicUrl);
  assert.equal(q.persists.length, 1);
  assert.equal(h.selection.files.length, 0, 'only successful guarded publication removes the retained File');
  assert.equal(h.ctx.pendingRequestCameraSelection, null);
  assert.ok(q.blobWrites.every(write => write.record.blob === h.file));
});

test('the actual Request queue rechecks ownership after the upload-proof helper resolves but before local publication', async () => {
  const h = await requestCameraFixture();
  const q = installPhotoQueueBoundaries(h, async () => ({ ...h.uploaded, filePath: h.uploaded.fileName }));
  const actualVerify = h.ctx.retainAndVerifyRequestCameraUpload;
  let verifiedCanonical;
  h.ctx.retainAndVerifyRequestCameraUpload = async (...args) => {
    verifiedCanonical = await actualVerify(...args);
    // Simulate an auth event in the await continuation gap, after the genuine
    // helper has verified the row. The caller still must protect publication.
    queueMicrotask(() => { h.state.authEpoch++; });
    return verifiedCanonical;
  };
  const beforeResponse = photoRows(h);
  assert.equal(await h.ctx.retryRetainedRequestCameraSelection(), true);
  await assert.rejects(q.uploads[0], /Request changed/);
  assert.equal(verifiedCanonical, h.source);
  assert.deepEqual(photoRows(h), beforeResponse);
  assert.equal(q.publications.length, 0);
  assert.equal(q.persists.length, 0);
  assert.equal(h.selection.files[0], h.file);
  assert.equal(h.selection.uploadedPhotos.get(h.file).publicUrl, h.uploaded.publicUrl);
});

async function refreshedNativeRequestFixture() {
  const h = await ownSaveFixture({ av_note: 'ACKNOWLEDGED NOTE' }, { source: 'LD', contsize: 'SYNTHETIC #7' });
  h.publishAcknowledged();
  assert.equal(await h.ctx.continueProductionRequestDetailOwnSave(h.ticket, h.ack), true);
  h.ctx.finishProductionRequestDetailOwnSave(h.ticket);
  const fresh = h.ctx.formatFetchedRows([structuredClone(h.ack)], 'ph_active_request')[0];
  assert.equal(Object.hasOwn(fresh, 'SOURCE'), false, 'native live Request view does not project master SOURCE');
  assert.equal(Object.hasOwn(fresh, 'source'), false);
  assert.equal(h.source.SOURCE, 'LD', 'the reviewed editor keeps its exact master SOURCE');
  Object.assign(h.ctx, { isDockSuspendDcRequestMirrorRow: () => false,
    findRequestRowByUniqueId: uid => uid === fresh.UNIQUE_ID ? fresh : null });
  vm.runInContext(appFunction('getRequestPhotoOwnerItem'), h.ctx);
  const currentProof = h.ctx.productionMasterDetailBindings.get(h.source);
  h.ctx.bindProductionMasterDetailRow = () => { throw new Error('Missing SOURCE must never stamp a fresh proof'); };
  return { ...h, fresh, currentProof };
}

test('a refreshed native Request without SOURCE recovers only verified master identity after an acknowledged note save', async () => {
  const h = await refreshedNativeRequestFixture();
  const before = structuredClone(h.fresh), rawMasterBefore = structuredClone(h.rawMaster);
  assert.equal(h.ctx.getRequestPhotoOwnerItem(h.source), h.fresh);
  assert.equal(h.fresh.SOURCE, 'LD', 'the current exact canonical master supplies the omitted source');
  const expected = { ...before, SOURCE: 'LD' };
  assert.deepEqual(JSON.parse(JSON.stringify(h.fresh)), expected, 'no editor draft fields merge into the canonical Request');
  assert.equal(h.ctx.productionMasterDetailBindings.get(h.fresh), h.currentProof);
  assert.equal(h.ctx.productionMasterDetailBindings.get(h.fresh).fence, h.currentProof.fence);
  assert.equal(h.currentProof.fence.revision, '2');
  assert.equal(h.ctx.hasProductionMasterDetailForItem(h.fresh), true);
  assert.deepEqual(h.rawMaster, rawMasterBefore, 'source recovery never modifies the canonical master');
});

test('a background Request save can prove the same SOURCE-omitted canonical as both transfer arguments', async () => {
  const h = await refreshedNativeRequestFixture();
  assert.equal(h.ctx.transferProductionRequestDetailBinding(h.fresh, h.fresh), true);
  assert.equal(h.fresh.SOURCE, 'LD');
  assert.equal(h.ctx.productionMasterDetailBindings.get(h.fresh), h.currentProof);
  assert.equal(h.ctx.hasProductionMasterDetailForItem(h.fresh), true);
});

test('SOURCE recovery validates both fresh objects before mutating either one', async () => {
  const h = await refreshedNativeRequestFixture(), otherTarget = structuredClone(h.fresh);
  otherTarget.CONTSIZE = 'OTHER SIZE';
  const beforeSource = structuredClone(h.fresh), beforeTarget = structuredClone(otherTarget);
  assert.equal(h.ctx.transferProductionRequestDetailBinding(h.fresh, otherTarget), false);
  assert.deepEqual(JSON.parse(JSON.stringify(h.fresh)), beforeSource);
  assert.deepEqual(otherTarget, beforeTarget);
  assert.equal(h.ctx.productionMasterDetailBindings.has(h.fresh), false);
  assert.equal(h.ctx.productionMasterDetailBindings.has(otherTarget), false);
  assert.equal(h.ctx.productionMasterDetailBindings.get(h.source), h.currentProof);
});

for (const [name, change] of [
  ['supplied conflicting SOURCE', h => { h.fresh.SOURCE = 'OTHER SOURCE'; }],
  ['supplied conflicting lowercase source', h => { h.fresh.source = 'OTHER SOURCE'; }],
  ['conflicting SOURCE aliases', h => { h.fresh.SOURCE = 'LD'; h.fresh.source = 'OTHER SOURCE'; }],
  ['Request UID', h => { h.fresh.UNIQUE_ID = 'REQUEST-SYNTHETIC-2'; }],
  ['Request table', h => { h.fresh.SOURCE_TABLE = h.fresh.source_table = 'ph_sales_office'; }],
  ['linked master', h => { h.fresh.MASTER_ID = 'MASTER-SYNTHETIC-2'; }],
  ['conflicting linked-master alias', h => { h.fresh.master_id = 'MASTER-SYNTHETIC-2'; }],
  ['item code', h => { h.fresh.ITEMCODE = 'OTHER ITEM'; }],
  ['location', h => { h.fresh.LOCATIONCODE = 'OTHER LOCATION'; }],
  ['lot', h => { h.fresh.LOTCODE = 'OTHER LOT'; }],
  ['container size', h => { h.fresh.CONTSIZE = 'OTHER SIZE'; }],
  ['conflicting container alias', h => { h.fresh.contsize = 'OTHER SIZE'; }],
  ['missing verified master', h => { h.store.reset(); }],
  ['checking metadata', h => { h.coordinator.suspend(); }],
  ['changed account', h => { h.state.scope = h.context.scope = 'OTHER ACCOUNT'; }],
  ['changed permission', h => { h.state.permission = h.context.permissionVersion = h.dataset.liveVerifiedPermission = 'OTHER PERMISSION'; }],
  ['changed master revision', h => { h.state.revision = h.context.revision = h.dataset.liveVerifiedRevision = '3'; }]
]) {
  test(`native Request SOURCE omission cannot conceal ${name}`, async () => {
    const h = await refreshedNativeRequestFixture(); change(h);
    const before = structuredClone(h.fresh);
    assert.equal(h.ctx.transferProductionRequestDetailBinding(h.source, h.fresh), false);
    assert.deepEqual(JSON.parse(JSON.stringify(h.fresh)), before, 'failed normalization is all-or-nothing');
    assert.equal(h.ctx.productionMasterDetailBindings.has(h.fresh), false);
    assert.equal(h.ctx.productionMasterDetailBindings.get(h.source), h.currentProof);
  });
}
