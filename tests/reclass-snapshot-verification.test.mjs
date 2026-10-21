import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

const html = readComposedAppSource();
function appFunction(name) {
  let start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  if (html.slice(start - 6, start) === 'async ') start -= 6;
  const open = html.indexOf(') {', start) + 2;
  let depth = 0;
  for (let index = open; index < html.length; index++) {
    if (html[index] === '{') depth++;
    else if (html[index] === '}' && --depth === 0) return html.slice(start, index + 1);
  }
  throw new Error(`Unclosed function ${name}`);
}

function fixture() {
  const physical = { unique_id: 'jet-stream-source', itemcode: 'JET-1', contsize: '#3',
    locationcode: 'F.17.000', lotcode: '27.U1', season: 'U1', ptronhand: '234', ptravailable: '234',
    warehouseid: '1', source: 'Drive', desigitem: '', desigcust: '', desigloc: '' };
  const master = { initialLoaded: true, rowCompleteness: 'partial', fieldCoverage: 'browse', fullLoaded: false };
  const live = { scope: 'native-user-a', dataPermissionVersion: 'permission-7' };
  const runtime = { identity: 'profile-a/admin/login-a', readScope: 'owner-a', revision: 41, minRevision: 0, reads: 0,
    canUse: true, sourceState: 'ready', publishedReadable: false, beforeRead: null };
  const context = { console, Map, Set, AbortController, nativeAuthSessionActive: true, nativeAuthProfile: { id: 'profile-a' },
    getSupabaseReadIdentityScope: () => runtime.readScope,
    getProductionLiveSyncContext: () => ({ ...live }), canUseProductionLiveSync: () => runtime.canUse,
    getArgosReclassLiveEditIdentityKey: () => runtime.identity,
    isConfirmedInventoryReadRevisionCurrent: revision => Number(revision) >= runtime.minRevision,
    withProductionLiveSyncSignal: async (_signal, callback) => callback(new AbortController().signal),
    window: { AgMetricLiveSync: {
      snapshot: value => value,
      isPublishedReadable: source => !!source && ['importing', 'interrupted'].includes(source.state)
        && source.publishedReadable === true && typeof source.publishedRevision === 'string'
        && source.publishedRevision.length > 0 && Number.isFinite(Date.parse(source.publishedAt)),
      isReadableSource: source => source?.state === 'ready' || !!source && ['importing', 'interrupted'].includes(source.state)
        && source.publishedReadable === true && typeof source.publishedRevision === 'string'
        && source.publishedRevision.length > 0 && Number.isFinite(Date.parse(source.publishedAt)),
      readSourceToken: source => JSON.stringify([source?.revision || '', source?.state || '', source?.publishedRevision || ''])
    } },
    supabaseRpc: async () => ({ permissionVersion: live.dataPermissionVersion,
      sources: new Map([['ph_master_inventory', { state: runtime.sourceState, revision: runtime.revision,
        publishedReadable: runtime.publishedReadable, publishedRevision: runtime.publishedReadable ? `pub-${runtime.revision}` : '',
        publishedAt: runtime.publishedReadable ? '2026-10-20T12:00:00Z' : '' }]]) }),
    fetchAllInventoryReadRows: async () => { runtime.reads++; await runtime.beforeRead?.();
      const rows = [{ ...physical }]; rows.readMeta = { projection: 'full' }; return rows; },
    validateInventoryReadProjection: meta => assert.equal(meta.projection, 'full'),
    formatFetchedRows: rows => rows.map(row => ({ ...row })),
    staleSupabaseReadScopeError: () => new Error('Stale account scope'),
    getDatasetState: () => master, getItemInquiryRows: () => [physical],
    getItemInquiryItemCode: row => String(row.itemcode || row.ITEMCODE || '').toUpperCase(),
    masterInventoryByItemCode: new Map([['JET-1', [physical]]]),
    readPendingArgosInventoryReclassMove: () => null, generateArgosInventoryTransactionId: () => 'move-verified-01',
  };
  vm.createContext(context);
  const helpers = ['getArgosReclassSourceRowsSignature', 'getArgosReclassVerifiedInquiryRevision',
    'ensureArgosReclassSubmissionVerification'];
  vm.runInContext(['loadArgosItemInquiryRows', 'getVerifiedCachedArgosItemInquiryGroup',
    ...helpers.filter(name => html.includes(`function ${name}(`)), 'buildInventoryReclassMoveCommand'].map(appFunction).join('\n'), context);
  const makeState = group => ({ item: group.row, snapshot: { uniqueId: physical.unique_id }, verifiedInquiryGroup: group,
    inquiryModel: { locationRows: group.rows.map(sourceRow => ({ unique_id: sourceRow.unique_id, sourceRow })) } });
  const payload = { rowOverlays: [{ unique_id: physical.unique_id,
    proposals: [{ action: 'move_up', splits: [{ destinationSeason: 'F1', quantity: 34 }] }] }] };
  return { context, physical, master, live, runtime, makeState, payload };
}

test('targeted live snapshot authorizes Reclass 34 to F1 without a global full worksheet refresh', async () => {
  const f = fixture();
  const group = await f.context.loadArgosItemInquiryRows(f.physical);
  const command = f.context.buildInventoryReclassMoveCommand(f.payload, f.makeState(group));
  assert.equal(command.expectedRevision, 41);
  assert.equal(command.moves[0].source.identity.ptronhand, '234');
  assert.equal(command.moves[0].lines[0].quantity, 34);
  assert.equal(command.moves[0].lines[0].destinationSeason, 'F1');
  assert.equal(f.master.liveVerifiedRevision, undefined, 'a targeted item read never blesses the global cache');
  assert.equal(f.master.fullLoaded, false);
});

test('verified shared full snapshot permits a warm submission without another inventory fetch', async () => {
  const f = fixture();
  Object.assign(f.master, { rowCompleteness: 'complete', fieldCoverage: 'full', fullLoaded: true,
    liveVerifiedScope: f.live.scope, liveVerifiedPermission: f.live.dataPermissionVersion, liveVerifiedRevision: '41' });
  const group = f.context.getVerifiedCachedArgosItemInquiryGroup(f.physical);
  assert.ok(group);
  const state = f.makeState(group);
  await f.context.ensureArgosReclassSubmissionVerification(state);
  assert.equal(f.context.buildInventoryReclassMoveCommand(f.payload, state).expectedRevision, 41);
  assert.equal(f.runtime.reads, 0);
});

test('a caller-supplied inquiry row cannot inherit proof from an unrelated full master snapshot', () => {
  const f = fixture();
  Object.assign(f.master, { rowCompleteness: 'complete', fieldCoverage: 'full', fullLoaded: true,
    liveVerifiedScope: f.live.scope, liveVerifiedPermission: f.live.dataPermissionVersion, liveVerifiedRevision: '41' });
  f.context.masterInventoryByItemCode.clear();
  assert.equal(f.context.getVerifiedCachedArgosItemInquiryGroup(f.physical), null);
});

test('unverified native cache submits displayed row identity without a blocking read and preserves the draft', async () => {
  const f = fixture();
  const state = f.makeState({ row: { ...f.physical }, rows: [{ ...f.physical }] });
  state.verifiedInquiryGroup = null;
  state.verificationIdentityKey = f.runtime.identity;
  const model = state.inquiryModel;
  const originalPayload = JSON.stringify(f.payload);
  await f.context.ensureArgosReclassSubmissionVerification(state);
  assert.equal(f.runtime.reads, 0);
  assert.equal(state.inquiryModel, model);
  assert.equal(JSON.stringify(f.payload), originalPayload);
  assert.equal(f.context.buildInventoryReclassMoveCommand(f.payload, state).expectedRevision, null);
  assert.equal(f.master.liveVerifiedRevision, undefined);
});

test('bracketed published last-good inventory can submit against its exact revision while a failed import is deferred', async () => {
  const f = fixture();
  f.runtime.sourceState = 'interrupted';
  f.runtime.publishedReadable = true;
  const state = f.makeState(await f.context.loadArgosItemInquiryRows(f.physical));
  state.verificationIdentityKey = f.runtime.identity;
  await f.context.ensureArgosReclassSubmissionVerification(state);
  assert.equal(state.verifiedInquiryGroup.sourceState, 'interrupted');
  assert.equal(state.verifiedInquiryGroup.sourceBracketed, true);
  assert.equal(state.verifiedInquiryGroup.sourcePublishedReadable, true);
  assert.ok(state.verifiedInquiryGroup.sourceToken);
  assert.equal(f.context.buildInventoryReclassMoveCommand(f.payload, state).expectedRevision, 41,
    'the published read bracket carries the numeric revision required by the server-side row lock/CAS');
  assert.equal(f.runtime.reads, 1);
  assert.equal(f.master.liveVerifiedRevision, undefined, 'the targeted LKG read does not bless the global cache');
});

test('an importing source never blocks submitting a loaded row to server identity checks', async () => {
  const f = fixture();
  f.runtime.sourceState = 'importing';
  f.runtime.publishedReadable = true;
  const state = f.makeState({ row: { ...f.physical }, rows: [{ ...f.physical }] });
  state.verifiedInquiryGroup = null;
  state.verificationIdentityKey = f.runtime.identity;
  await f.context.ensureArgosReclassSubmissionVerification(state);
  assert.equal(state.verifiedInquiryGroup, null);
  assert.equal(f.runtime.reads, 0);
  assert.equal(f.context.buildInventoryReclassMoveCommand(f.payload, state).expectedRevision, null);
});

test('submission preserves original stock identity and draft quantities for server conflict detection', async () => {
  const f = fixture();
  const state = f.makeState({ row: { ...f.physical }, rows: [{ ...f.physical }] });
  state.verifiedInquiryGroup = null;
  f.physical.ptronhand = '200';
  await f.context.ensureArgosReclassSubmissionVerification(state);
  const command = f.context.buildInventoryReclassMoveCommand(f.payload, state);
  assert.equal(command.moves[0].source.identity.ptronhand, '234');
  assert.equal(f.runtime.reads, 0);
  assert.equal(state.inquiryModel.locationRows[0].sourceRow.ptronhand, '234');
  assert.equal(f.payload.rowOverlays[0].proposals[0].splits[0].quantity, 34);
  assert.equal(state.verifiedInquiryGroup, null);
});

for (const [name, change] of [
  ['account', f => { f.runtime.identity = 'profile-b/admin/login-b'; }],
  ['session', f => { f.runtime.canUse = false; }],
]) {
  test(`a changed ${name} cannot submit an old draft`, async () => {
    const f = fixture();
    const state = f.makeState(await f.context.loadArgosItemInquiryRows(f.physical));
    change(f, state);
    assert.throws(() => f.context.buildInventoryReclassMoveCommand(f.payload, state), /access changed|original account/);
    await assert.rejects(f.context.ensureArgosReclassSubmissionVerification(state), /access changed|original account/);
  });
}

for (const [name, change] of [
  ['read scope', f => { f.runtime.readScope = 'owner-b'; }],
  ['permission refresh', f => { f.live.dataPermissionVersion = 'permission-8'; }],
  ['newer inventory revision', f => { f.runtime.minRevision = 42; }],
  ['source signature', (f, state) => { state.inquiryModel.locationRows[0].sourceRow.__reclassIdentityRaw.ptronhand = '1'; }],
]) {
  test(`changed ${name} drops the cache revision hint while preserving atomic server checks`, async () => {
    const f = fixture();
    const state = f.makeState(await f.context.loadArgosItemInquiryRows(f.physical));
    change(f, state);
    const command = f.context.buildInventoryReclassMoveCommand(f.payload, state);
    assert.equal(command.expectedRevision, null);
    assert.equal(command.moves[0].source.uniqueId, f.physical.unique_id);
    assert.equal(f.runtime.reads, 1, 'submission adds no freshness read');
  });
}

test('inline verification cannot transplant an old account draft into the current account', async () => {
  const f = fixture();
  const state = f.makeState(await f.context.loadArgosItemInquiryRows(f.physical));
  f.runtime.identity = 'profile-b/admin/login-b';
  await assert.rejects(f.context.ensureArgosReclassSubmissionVerification(state), /original account/);
  assert.equal(f.runtime.reads, 1, 'no second account read occurs');
});

test('permissions and owner must remain stable through the targeted verification handshake', async () => {
  for (const mutation of [
    f => { f.runtime.readScope = 'owner-b'; },
    f => { f.runtime.identity = 'profile-b'; },
    f => { f.live.dataPermissionVersion = 'permission-8'; },
    f => { f.runtime.revision = 42; },
    f => { f.runtime.sourceState = 'loading'; },
  ]) {
    const f = fixture();
    f.runtime.beforeRead = () => mutation(f);
    await assert.rejects(f.context.loadArgosItemInquiryRows(f.physical), /Stale account scope|Inventory or permissions changed/);
  }
});

test('non-ready sources and incomplete cached previews never establish write proof', async () => {
  const f = fixture();
  assert.equal(f.context.getVerifiedCachedArgosItemInquiryGroup(f.physical), null);
  f.runtime.sourceState = 'loading';
  await assert.rejects(f.context.loadArgosItemInquiryRows(f.physical), /source or current permissions are not ready/);
  assert.equal(f.runtime.reads, 0);
});

test('an uncertain command keeps its original revision and is never reverified or regenerated', async () => {
  const f = fixture();
  const command = { commandId: 'persisted-command', expectedRevision: 38 };
  const state = { pendingReclassMove: { command } };
  await f.context.ensureArgosReclassSubmissionVerification(state);
  assert.equal(state.pendingReclassMove.command, command);
  assert.equal(f.runtime.reads, 0);
});

test('shared modal retains optional row proof and checks account ownership before every submit', () => {
  const open = appFunction('openArgosInventoryTransactionModal');
  assert.match(open, /verifiedInquiryGroup: verifiedGroup \|\| null/);
  assert.match(open, /openedState\.verifiedInquiryGroup = freshGroup/);
  const submit = appFunction('submitArgosInventoryTransaction');
  assert.ok(submit.indexOf('await ensureArgosReclassSubmissionVerification(submitState)')
    < submit.indexOf('await applyArgosInventoryReclassMoveCommand('));
  assert.ok(submit.indexOf('await ensureArgosReclassSubmissionVerification(submitState)')
    < submit.indexOf('await postArgosInventoryTransactionPayload('));
  assert.doesNotMatch(appFunction('ensureArgosReclassSubmissionVerification'), /await loadArgosItemInquiryRows|dataPermissionVersion/);
  assert.doesNotMatch(html, /Current inventory and permissions are not verified\. Refresh the worksheet and try again\./);
});
