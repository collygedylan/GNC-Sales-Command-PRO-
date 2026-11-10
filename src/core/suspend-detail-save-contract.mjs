import assert from 'node:assert/strict';
import vm from 'node:vm';
import { source, button, acknowledgement, harness, between } from '../../tests/helpers/suspend-completion-fixture.mjs';
import { readFileSync } from 'node:fs';

function installPublisher(h) {
  const master = { UNIQUE_ID: 'master-1', ITEMCODE: source().ITEMCODE,
    LOCATIONCODE: source().LOCATIONCODE, LOTCODE: source().LOTCODE };
  h.ctx.findLinkedMasterRow = () => master;
  h.ctx.getQueueCardInventoryRow = () => master;
  h.ctx.beginRowEvaluationMemoryPublication = () => () => {};
  h.ctx.scheduleRequestRender = () => {};
  h.ctx.applySuspendTagInventoryReceipt = result => !!result.inventoryRows?.length;
  vm.runInContext(between('async function publishRowEvaluationToMasterAndNotes(', 'async function publishFlyerInventoryEvidence('), h.ctx);
}

export async function detailSaveChecks() {
  let finishPhoto, failRead = true;
  const photo = new Promise(resolve => { finishPhoto = resolve; });
  const h = harness({ live: true, proof: false, api: body => {
    if (failRead) throw new Error('verification timed out');
    return { ...acknowledgement({ ...body.payload.patch, suspend_tag_status: 'pending' }), inventoryRows:[{unique_id:'master-1'}] };
  } });
  const action = button();
  installPublisher(h);
  Object.assign(h.ctx, {
    activeItem: h.mirror,
    document: { getElementById: () => action },
    getDockSuspendDcRequestFormValues: () => ({ spec: 'captured spec', caliper: '2', match: '', avNote: 'note' }),
    getPendingPhotoUploadsForItem: () => [photo], syncDockSuspendDcRequestPhotoAliases() {},
    readRowEvaluationDraft: () => ({}), clearSavedRowEvaluationDraft() {},
    buildDockSuspendDcRequestNote: () => 'captured comment',
  });
  vm.runInContext(readFileSync(new URL('../../assets/suspend-detail-save-domain.js', import.meta.url), 'utf8'), h.ctx);
  const pending = h.ctx.saveDockSuspendDcRequestMirrorData(false, h.mirror);
  await new Promise(setImmediate);
  assert.equal(h.calls.length, 0);
  h.row.DOCK_PHOTO_LINK = 'old.jpg,new.jpg'; h.row.DOCK_PHOTO_NAME = 'old,new';
  h.ctx.remoteRow.dock_photo_link = h.row.DOCK_PHOTO_LINK; h.ctx.remoteRow.dock_photo_name = h.row.DOCK_PHOTO_NAME;
  finishPhoto(); await pending;
  assert.match(h.toasts[0][1], /timed out/);
  const attempted = h.calls.filter(call => call.name === 'save');
  assert.equal(attempted.length, 4, 'automatic retries are bounded');
  assert.ok(attempted.every(call => call.body.commandId === attempted[0].body.commandId));
  failRead = false;
  await h.ctx.saveDockSuspendDcRequestMirrorData(false, h.mirror);
  const writes = h.calls.filter(call => call.name === 'save');
  assert.equal(writes.length, 5);
  assert.equal(writes[0].body.commandId, writes[4].body.commandId);
  const saved = writes[4].body.payload.patch;
  assert.equal(saved.dock_spec, 'captured spec');
  assert.equal(saved.dock_caliper, '2');
  assert.equal(saved.dock_note, 'captured comment');
  assert.equal(saved.dock_photo_link, 'old.jpg,new.jpg');
  assert.ok(h.toasts.some(([title]) => title === 'Saved'));
  assert.ok(!h.toasts.some(([title]) => title === 'Checking for updates'));
}

function prepareDetail(h) {
    installPublisher(h);
    h.ctx.restoreCapturedPhotoFields = () => {};
    h.ctx.applySuspendTagInventoryReceipt = result => !!result.inventoryRows?.length;
    h.ctx.applySavedSuspendDisplay = () => {};
    h.ctx.suspendTagApi = async (operation,payload,options) => (await h.ctx.postAppFunctionJson(h.ctx.APP_API_FUNCTION_URL,
      {action:'suspend_tag',operation,payload,commandId:options.commandId,expectedVersion:options.expectedVersion})).data;
    h.ctx.activeItem = h.mirror;
    h.ctx.activeDetailSourceView = 'request';
    h.ctx.lastView = 'request';
    h.ctx.view = 'detail';
    h.ctx.detailBackCalls = 0;
    h.ctx.isViewVisible = viewId => h.ctx.view === viewId;
    h.ctx.goBackFromDetail = () => { h.ctx.detailBackCalls += 1; };
    h.ctx.document = { ...h.ctx.document, getElementById: () => button() };
    h.ctx.getDockSuspendDcRequestFormValues = () => ({ spec: 'saved', caliper: '', match: '', avNote: '' });
    h.ctx.buildDockSuspendDcRequestNote = () => '';
    h.ctx.getDockSuspendDcRequestCompletionReadiness = () => ({ ready: true, missing: [] });
    h.ctx.syncDockSuspendDcRequestPhotoAliases = () => {};
    vm.runInContext(readFileSync(new URL('../../assets/suspend-detail-save-domain.js', import.meta.url), 'utf8'), h.ctx);
  };

async function detailImmediateChecks() {

  const successful = harness({api:()=>({...acknowledgement({date_completed:null,suspend_tag_status:'pending'}),
    inventoryRows:[{unique_id:'master-1',itemcode:source().ITEMCODE,locationcode:source().LOCATIONCODE,lotcode:source().LOTCODE,spec:'saved'}]})});
  prepareDetail(successful);
  await successful.ctx.saveDockSuspendDcRequestMirrorData(true, successful.mirror);
  assert.equal(successful.ctx.detailBackCalls, 1, JSON.stringify(successful.toasts));

  const ordinarySave = harness();
  prepareDetail(ordinarySave);
  await ordinarySave.ctx.saveDockSuspendDcRequestMirrorData(false, ordinarySave.mirror);
  assert.equal(ordinarySave.ctx.detailBackCalls, 0, 'Save leaves the detail editor open');
}

async function detailLateChecks() {
  let acknowledge;
  const late = harness({ api: () => new Promise(resolve => { acknowledge = resolve; }) });
  prepareDetail(late);
  const pending = late.ctx.saveDockSuspendDcRequestMirrorData(true, late.mirror);
  await new Promise(setImmediate);
  assert.equal(late.ctx.detailBackCalls, 1, 'completion returns optimistically before the receipt');
  late.ctx.view = 'request';
  late.ctx.activeDetailSourceView = '';
  acknowledge(acknowledgement());
  await pending;
  assert.equal(late.ctx.detailBackCalls, 1, 'a late response cannot navigate again');

  let acknowledgeAfterScopeChange;
  const changedScope = harness({ api: () => new Promise(resolve => { acknowledgeAfterScopeChange = resolve; }) });
  prepareDetail(changedScope);
  const scopePending = changedScope.ctx.saveDockSuspendDcRequestMirrorData(true, changedScope.mirror);
  await new Promise(setImmediate);
  assert.equal(changedScope.ctx.detailBackCalls, 1);
  changedScope.ctx.currentUser = 'another-user';
  acknowledgeAfterScopeChange(acknowledgement());
  await scopePending;
  assert.equal(changedScope.ctx.detailBackCalls, 1, 'a response from a prior account scope cannot navigate again');

  const failed = harness({ api: () => { throw new Error('SUSPEND_TAG_VERSION_CHANGED'); } });
  prepareDetail(failed);
  await failed.ctx.saveDockSuspendDcRequestMirrorData(true, failed.mirror);
  assert.equal(failed.ctx.detailBackCalls, 1, 'the optimistic return happens before rejection');
  assert.ok(failed.toasts.some(([title]) => title === 'Save Stopped'));

  await suspendUploadFailureChecks();
}

export async function suspendUploadFailureChecks() {
  const uploadFailed = harness();
  prepareDetail(uploadFailed);
  uploadFailed.ctx.getPendingPhotoUploadsForItem = () => [Promise.reject(new Error('Upload failed'))];
  await uploadFailed.ctx.saveDockSuspendDcRequestMirrorData(true, uploadFailed.mirror);
  assert.equal(uploadFailed.ctx.detailBackCalls, 0, 'a failed photo upload keeps the user in the editor');
  assert.equal(uploadFailed.calls.filter(call => call.name === 'complete').length, 0);
}

export async function detailMarkDoneChecks() {
  await detailImmediateChecks();
  await detailLateChecks();
  await suspendAcceptedUploadChecks();
  await suspendExactUploadIdentityChecks();
}

async function suspendExactUploadIdentityChecks() {
  const tag = {UNIQUE_ID:'dock_suspend_dc_soc-1', ITEMCODE:'011851.031.1', LOCATIONCODE:'E.06.000', LOTCODE:'27.F1'};
  const exact = {...tag,UNIQUE_ID:'master-elderberry'};
  const sibling = {...exact,UNIQUE_ID:'master-sibling',LOTCODE:'27.S1'};
  let scope = 'owner', fallback = exact, reads = 0;
  const ctx = {
    canCurrentUserWorkRequestItem: () => true,
    getSupabaseReadIdentityScope: () => scope,
    staleSupabaseReadScopeError: () => new Error('account changed'),
    findDockSuspendDcRequestSourceRow: () => tag,
    getSuspendTagInventoryIdentity: () => tag,
    findLinkedMasterRow: () => sibling,
    getQueueCardInventoryRow: () => null,
    matchesSuspendTagInventoryIdentity: (row,id) => row?.LOTCODE === id.LOTCODE,
    resolveSuspendTagInventoryRow: async () => { reads += 1; return fallback; }
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../../assets/suspend-detail-save-domain.js', import.meta.url),'utf8'),ctx);
  const signal = new AbortController().signal;
  assert.equal(await ctx.resolveSuspendPhotoMaster(tag,signal),exact);
  assert.equal(reads,1);
  fallback = null;
  await assert.rejects(ctx.resolveSuspendPhotoMaster(tag,signal),/Exact inventory row/);
  ctx.resolveSuspendTagInventoryRow = async () => { scope = 'different owner'; return exact; };
  await assert.rejects(ctx.resolveSuspendPhotoMaster(tag,signal),/account changed/);
}

async function suspendAcceptedUploadChecks() {
  const neverFinished = new Promise(() => {});
  const h = harness({api: body => ({...acknowledgement({...body.payload.patch,suspend_tag_status:'pending'}),
    inventoryRows:[{unique_id:'master-1'}]})});
  prepareDetail(h);
  h.ctx.getPendingPhotoUploadsForItem = () => [neverFinished];
  h.ctx.mergeConfirmedRowEvaluationUploads = () => {};
  h.ctx.getDockSuspendDcRequestFormValues = () => ({spec:'14-16" HxW',caliper:'',match:'80',avNote:'SPEC - 14-16" HXW'});
  h.ctx.getLocMatchPercentPayloadValue = Number;
  h.ctx.buildQueueInventoryMetricsHtml = () => ({onHand:80});
  h.ctx.calculateDockSuspendDcRequestLocMatchQty = (metrics, match) => metrics.onHand * Number(match) / 100;
  h.ctx.getDockSuspendDcRequestLocMatchBaselinePtr = metrics => metrics.onHand;
  const result = await Promise.race([
    h.ctx.saveDockSuspendDcRequestMirrorData(true,h.mirror,false,{markDoneConfirmationAccepted:true,markDoneSnapshot:{uploads:[neverFinished]}}),
    new Promise(resolve => setImmediate(() => resolve('still waiting')))
  ]);
  assert.equal(result,true);
  assert.equal(h.ctx.detailBackCalls,1);
  const writes = h.calls.filter(call => call.name === 'save');
  assert.equal(writes.length,1);
  assert.equal(writes[0].body.payload.patch.dock_spec,'14-16" HxW');
  assert.equal(writes[0].body.payload.patch.av_note,'SPEC - 14-16" HXW');
  assert.equal(writes[0].body.payload.patch.loc_match_qty,64);
  assert.equal(h.calls.filter(call => call.name === 'close').length,0);
}
