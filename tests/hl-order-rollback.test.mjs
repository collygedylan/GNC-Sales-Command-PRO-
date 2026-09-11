import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const read = (name) => readFileSync(new URL('../' + name, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const html = read('index.html');
function appFunction(name) {
  const start = html.search(new RegExp(`        (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} exists`);
  const end = html.indexOf('\n        }', start);
  assert.ok(end > start, `${name} closes`);
  return html.slice(start, end + 10);
}

// Exact function fingerprints from the requested release, commit
// 9a29cbe6dbc043a624ffdb6693ea160568a0da34. A shallow CI checkout needs no old Git objects.
const baselineCameraFunctions = {
  handlePhotoUpload: '3466af67c158d4b3c55414c2faa0d252046c799ed5c83b11e70742816a8d5f7e',
  handleNcrPhotoSelect: '85cf28e7f73c882c7fef3263fd18b8a8b2d577007a0e0b66d4453fcce8433440',
  handleTaskDetailQuickPhotoUpload: '4f820c3c3878e0bb70fecfe3e7c5bb2db70a848dcceeab54f5f01d117db8edc8',
  applyProtectedEditState: 'eaef441bcbbaddfcbbd74f69c79c50d7bd3e546a42cc4450d79d4a09ca5f1291',
  renderProtectedControls: 'af26907ccbd1bfadba0e0085a11246484843c0b9fb7d9cc2abe61e9971fc2883',
  applyCameraPermissions: 'c480d618fe7a02d99ee30674ec6127b7d69bb953e7e0ea9b6e535330a4bc97b1',
};

test('legacy camera and protected controls are exactly the requested September 9 implementation', () => {
  for (const [name, expected] of Object.entries(baselineCameraFunctions)) {
    assert.equal(createHash('sha256').update(appFunction(name)).digest('hex'), expected, name);
  }
  assert.doesNotMatch(html, /function (?:ensureDetailPhotoCaptureReady|retryRetainedRequestCameraSelection|onProductionMasterDetailsVerified)\(/);
});

function hlFixture() {
  const state = { owner: 'dylan:epoch-1', permission: 'permission-1', revision: '1', sourceStates: {},
    rows: [{ unique_id: 'zero', itemcode: 'ITEM.003', contsize: '#3', locationcode: 'C.12.001', lotcode: '27.F1', ptravailable: '0' },
      { unique_id: 'unknown', itemcode: 'ITEM.003', contsize: '#3', locationcode: 'A.01.001', lotcode: '26.S1', ptravailable: null }] };
  const datasets = { master: {}, soc: {} };
  const context = { scope: 'dylan-scope', viewKey: 'hl-order', online: true, visible: true, adapters: [] };
  const ctx = vm.createContext({ Map, Set, Object, JSON, String, console,
    currentUser: 'dylan_collyge', nativeAuthSessionActive: true, nativeAuthAccessToken: 'synthetic-token',
    nativeAuthProfile: { id: '12345678-1234-1234-1234-123456789abc', username: 'dylan_collyge', disabled_at: null, locked_until: null, must_change_password: false },
    selectedItems: new Set(), selectedItemSources: new Map(),
    document: { hidden: false, getElementById: () => null }, navigator: { onLine: true },
    getSupabaseReadIdentityScope: () => state.owner,
    canUseProductionLiveSync: () => true, getProductionLiveSyncContext: () => ctx.observeHlOrderVerificationContext(context),
    getDatasetState: (key) => datasets[key],
    applyRepU3VisibilityScope: (rows) => rows, applyForemanPriorityRowScope: (rows) => rows,
    shouldHideNotOnInventoryApprovalRowFromInventory: (row) => !!row.hidden,
    clearInterval() {},
  });
  const start = html.indexOf('        // HL selections mirror');
  const end = html.indexOf('        function getCartSelectedItems()', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(appFunction('parseAppNumber') + '\n' + html.slice(start, end), ctx);
  const library = { module: { exports: {} }, setTimeout, clearTimeout };
  vm.runInNewContext(read('assets/live-sync-coordinator.js'), library);
  for (const key of ['master', 'soc']) {
    context.adapters.push({ id: `core:${key}`, cacheKey: key, sourceKeys: [key === 'master' ? 'ph_master_inventory' : 'ph_soc_master'],
      stage: async () => ({ key, rows: key === 'master' ? state.rows : [], owner: ctx.captureHlOrderOwnership() }) });
  }
  const coordinator = library.AgMetricLiveSync.createCoordinator({
    getContext: () => ctx.observeHlOrderVerificationContext(context),
    onStatus: (status) => ctx.captureHlOrderVerificationStatus(status, context),
    readRevisions: async (keys) => ({ contractVersion: 1, permissionVersion: state.permission,
      sources: keys.map(key => ({ key, revision: state.revision, state: state.sourceStates[key] || 'ready' })) }),
    commitSnapshots: (staged, current, metadata) => {
      for (const { value } of staged) {
        Object.assign(datasets[value.key], { fullLoaded: true, liveVerifiedScope: current.scope,
          liveVerifiedPermission: metadata.permissionVersion, liveVerifiedRevision: state.revision });
        if (value.key === 'master') {
          ctx.captureHlOrderInventorySnapshot(value, current, metadata);
          // Simulate the legacy display defaults without altering canonical availability.
          ctx.fullInventory = value.rows.map(row => ({ ...row, ptravailable: row.ptravailable ?? '0' }));
        }
      }
    },
    setTimeout: () => 1, clearTimeout() {},
  });
  ctx.getProductionLiveSyncCoordinator = () => coordinator;
  return { ctx, state, context, datasets, coordinator };
}

test('HL uses genuinely verified full rows and retains zero versus unknown after legacy display mutation', async () => {
  const f = hlFixture();
  assert.equal(f.ctx.canUseHlOrderVerifiedData(), false);
  assert.equal(await f.coordinator.check(), true);
  assert.equal(f.ctx.canUseHlOrderVerifiedData(), true);
  const snapshot = f.ctx.getHlOrderVerifiedInventoryRows(['zero', 'unknown']);
  assert.deepEqual(Array.from(snapshot, row => row.ptravailable), ['0', null]);
  assert.equal(snapshot.every(Object.isFrozen), true);
  f.state.rows[0].ptravailable = '999';
  f.ctx.fullInventory[1].ptravailable = '888';
  for (const [id, expected] of [['zero', '0'], ['unknown', '']]) {
    const source = snapshot.find(row => row.unique_id === id);
    const matches = new Map([[f.ctx.getHlOrderInventoryKey(source), new Set([id])]]);
    assert.equal(f.ctx.getHlOrderAvailability(source, matches), expected);
  }
  f.ctx.driveSearch = 'unrelated'; f.ctx.selectedDriveSeason = 'different'; f.ctx.filteredInventory = [];
  f.ctx.fullInventory.push(f.ctx.fullInventory[0]);
  assert.deepEqual(Array.from(f.ctx.getHlOrderDriveMatches([snapshot[0]]), row => row.unique_id), ['zero', 'unknown']);
});

for (const [name, mutate] of [
  ['a new login epoch', f => { f.state.owner = 'dylan:epoch-2'; }],
  ['scope replacement', f => { f.context.scope = 'another-scope'; }],
  ['permission replacement', f => { f.datasets.master.liveVerifiedPermission = 'permission-2'; }],
  ['master revision replacement', f => { f.datasets.master.liveVerifiedRevision = '2'; }],
  ['missing joined SOC data', f => { f.context.adapters = f.context.adapters.filter(adapter => adapter.id !== 'core:soc'); }],
  ['an unrelated view', f => { f.context.adapters = []; }],
  ['going offline', f => { f.ctx.navigator.onLine = false; }],
  ['backgrounding', f => { f.ctx.document.hidden = true; }],
  ['account disablement', f => { f.ctx.nativeAuthProfile.disabled_at = '2026-09-11'; }],
  ['session expiry', f => { f.ctx.nativeAuthSessionActive = false; }],
  ['account switch', f => { f.ctx.currentUser = 'other-user'; }],
  ['profile mismatch', f => { f.ctx.nativeAuthProfile.username = 'other-user'; }],
  ['required password change', f => { f.ctx.nativeAuthProfile.must_change_password = true; }],
  ['account lock', f => { f.ctx.nativeAuthProfile.locked_until = '2999-01-01'; }],
]) {
  test(`HL canonical availability is withheld after ${name}`, async () => {
    const f = hlFixture();
    assert.equal(await f.coordinator.check(), true);
    mutate(f);
    assert.equal(f.ctx.canUseHlOrderVerifiedData(), false);
    assert.equal(f.ctx.getHlOrderVerifiedInventoryRows(['zero']), null);
  });
}

test('an active SOC import withholds HL availability until both sources are verified again', async () => {
  const f = hlFixture();
  assert.equal(await f.coordinator.check(), true);
  f.state.sourceStates.ph_soc_master = 'importing';
  assert.equal(await f.coordinator.check(), false);
  assert.equal(f.ctx.canUseHlOrderVerifiedData(), false);
  f.state.sourceStates.ph_soc_master = 'ready'; f.state.revision = '2';
  assert.equal(await f.coordinator.check(), true);
  assert.equal(f.ctx.canUseHlOrderVerifiedData(), true);
});

test('an ambiguous duplicate master identity cannot establish HL canonical availability', async () => {
  const f = hlFixture();
  f.state.rows.push({ ...f.state.rows[0], ptravailable: '12' });
  await f.coordinator.check();
  assert.equal(f.ctx.canUseHlOrderVerifiedData(), false);
  assert.equal(f.ctx.getHlOrderVerifiedInventoryRows(['zero']), null);
});

test('returning from an unrelated completed check requires a new joined HL verification', async () => {
  const f = hlFixture();
  assert.equal(await f.coordinator.check(), true);
  const adapters = f.context.adapters;
  f.context.viewKey = 'static'; f.context.adapters = [];
  assert.equal(await f.coordinator.check(), true);
  f.context.viewKey = 'hl-order'; f.context.adapters = adapters;
  assert.equal(f.ctx.canUseHlOrderVerifiedData(), false);
  assert.equal(await f.coordinator.check(), true);
  assert.equal(f.ctx.canUseHlOrderVerifiedData(), true);
});

const apiSource = ts.createSourceFile('app-api.ts', read('supabase/functions/app-api/index.ts'), ts.ScriptTarget.Latest, true);
const apiFunctions = ['evalReviewSource', 'evalWorkError', 'handleEvalWorkAction'];
const apiCode = ts.transpileModule(apiSource.statements
  .filter(node => ts.isFunctionDeclaration(node) && apiFunctions.includes(node.name?.text))
  .map(node => node.getText(apiSource)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const plain = (value) => JSON.parse(JSON.stringify(value));
const legacySource = { unique_id: 'rollback-row', source_table: 'ph_master_inventory', itemcode: 'ITEM.003', locationcode: 'A.01.001', lotcode: '27.F1' };
const legacyPayload = () => ({ operation: 'create', createToken: 'rollback-token', source: legacySource,
  assigneeUsernames: ['charley_robertson'], completionRecipients: ['completion@example.invalid'], instructions: 'Review this row' });

function apiFixture({ active = true, manager = true } = {}) {
  const rpcCalls = [], resolved = [];
  const assignees = [{ username: 'charley_robertson', displayName: 'Charley Robertson', email: 'verified@example.invalid' }];
  const work = { id: 'saved-work', delivery: {} };
  const context = vm.createContext({
    normalizeUsername: (value) => String(value || '').trim().toLowerCase(),
    isEvalWorkManager: () => manager,
    resolveActiveSessionProfile: async () => active ? { id: 'active-actor' } : null,
    resolveEvalWorkAssignees: async (usernames) => { resolved.push(usernames); return assignees; },
    jsonResponse: (body) => ({ status: 200, body }),
    errorResponse: (message, status, extra = {}) => ({ status, body: { ok: false, error: message, ...extra } }),
    withEvalWorkDeliveryStatus: async (row) => row,
    recordHandledError: async () => {},
    supabase: { rpc: async (name, args) => { rpcCalls.push({ name, args }); return { data: work, error: null }; } },
  });
  vm.runInContext(apiCode, context);
  return { rpcCalls, resolved, assignees, work,
    invoke: (payload, session = { username: 'dylan_collyge' }) => context.handleEvalWorkAction(session, payload) };
}

test('September 9 review requests use the compatible RPC with trusted actor and evaluator emails', async () => {
  const f = apiFixture();
  const result = await f.invoke({ ...legacyPayload(), actorUsername: 'spoofed', assigneeEmail: 'spoofed@example.invalid',
    assignees: [{ username: 'spoofed', email: 'spoofed@example.invalid' }] });
  assert.equal(result.status, 200);
  assert.equal(result.body.data, f.work);
  assert.deepEqual(f.resolved, [['charley_robertson']]);
  assert.equal(f.rpcCalls.length, 1);
  assert.equal(f.rpcCalls[0].name, 'create_eval_work_legacy_sep09_v1');
  const payload = plain(f.rpcCalls[0].args.p_payload);
  assert.equal(payload.actorUsername, 'dylan_collyge');
  assert.equal(payload.assigneeUsername, 'charley_robertson');
  assert.equal(payload.assigneeEmail, 'verified@example.invalid');
  assert.deepEqual(payload.assignees, f.assignees);
  assert.deepEqual(payload.source, legacySource);
  assert.deepEqual(payload.completionRecipients, ['completion@example.invalid']);
});

for (const [field, value] of [
  ['expectedAssignmentRevision', 'reviewed-revision'], ['expectedAssignmentRevision', ''],
  ['expectedAssignmentRevision', null], ['expectedAssignmentRevision', undefined],
  ['additionalCompletionRecipients', []], ['additionalCompletionRecipients', null],
]) {
  test(`a present ${field}=${String(value)} retains the modern confirmation contract`, async () => {
    const f = apiFixture();
    await f.invoke({ ...legacyPayload(), [field]: value });
    assert.equal(f.resolved.length, 0);
    assert.equal(f.rpcCalls.length, 1);
    assert.equal(f.rpcCalls[0].name, 'create_eval_work_multi_v1');
    const payload = f.rpcCalls[0].args.p_payload;
    for (const name of ['assigneeUsernames', 'assigneeUsername', 'assigneeEmail', 'assignees', 'completionRecipients']) {
      assert.equal(Object.hasOwn(payload, name), false, name);
    }
  });
}

for (const [name, options, session] of [
  ['anonymous', {}, null], ['inactive', { active: false }, { username: 'dylan_collyge' }],
  ['unauthorized', { manager: false }, { username: 'other-user' }],
  ['password change', {}, { username: 'dylan_collyge', mustChangePassword: true }],
]) {
  test(`legacy review rejects ${name} before resolving recipients or calling the database`, async () => {
    const f = apiFixture(options);
    const result = await f.invoke(legacyPayload(), session);
    assert.ok([401, 403].includes(result.status));
    assert.equal(f.resolved.length, 0);
    assert.equal(f.rpcCalls.length, 0);
  });
}
