import { lateSuspendReceiptChecks } from '../src/core/suspend-late-receipt-contract.mjs';
import { detailSaveChecks, detailMarkDoneChecks } from '../src/core/suspend-detail-save-contract.mjs';
import { revision, source, button, acknowledgement, harness, makeSuspendAction, makeSuspendActionDocument } from './helpers/suspend-completion-fixture.mjs';
import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: suspend
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readComposedAppSource();
const precisionCss = readFileSync(new URL('../assets/ops-precision-pilot.css', import.meta.url), 'utf8');
function between(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from + start.length);
  assert.ok(from > 0 && to > from);
  return html.slice(from, to);
}

test('card Email completes its exact row then queues approval without confirmation or hiding it', async () => {
  const h = harness({ live: true, proof: false, confirm: false,
    api: body => acknowledgement({ suspend_tag_status: body.operation === 'send' ? 'awaiting_rep' : 'completed',
      suspend_tag_version: body.operation === 'send' ? 2 : 1 }) });
  await h.ctx.emailSuspendTagFromCard(h.mirror.UNIQUE_ID, button());
  assert.deepEqual(h.calls.map(call => call.name), ['complete', 'rows', 'send']);
  assert.ok(h.calls.filter(call => call.name !== 'rows').every(call => call.body.payload.sourceUid === 'soc-1'));
  assert.equal(h.ctx.isOptimisticallyCompletedRow(h.mirror), false);
  assert.equal(h.mirror.SUSPEND, 'SUSPEND');
  assert.ok(h.toasts.some(([title]) => title === 'Email queued'));
});

test('rerendered Suspend actions stay disabled only for the exact busy account and source', () => {
  const h = harness();
  const owner = h.ctx.getSupabaseReadIdentityScope();
  const sourceUid = h.ctx.getDockSuspendDcRequestSourceUid(h.mirror);
  const key = owner + '|' + sourceUid;
  vm.runInContext(`suspendTagCompletionActions.add(${JSON.stringify(key)})`, h.ctx);
  assert.equal(vm.runInContext(`suspendTagCompletionActions.has(${JSON.stringify(key)})`, h.ctx), true, 'fixture seeds the exact key checked by production');
  const markup = h.ctx.buildSuspendTagActions(h.mirror);
  const buttons = markup.match(/<button[^>]*>/g) || [];
  assert.equal(buttons.length, 5);
  assert.ok(buttons.every(buttonMarkup => /\sdisabled(?:\s|>)/.test(buttonMarkup)), `all regenerated action buttons remain disabled while the row command is in flight: ${markup}`);
  const differentSource = { ...h.mirror, UNIQUE_ID: 'dock_suspend_dc_other-row', DOCK_SUSPEND_SOURCE_UID: 'soc-other' };
  const otherSourceMarkup = h.ctx.buildSuspendTagActions(differentSource);
  const otherSourceButtons = otherSourceMarkup.match(/<button[^>]*>/g) || [];
  assert.equal(otherSourceButtons.length, 5);
  assert.ok(otherSourceButtons.every(buttonMarkup => !/\sdisabled(?:\s|>)/.test(buttonMarkup)), 'busy state must not leak to a different source row for the same account');
  h.ctx.currentUser = 'another-user';
  const otherAccountMarkup = h.ctx.buildSuspendTagActions(h.mirror);
  const otherAccountButtons = otherAccountMarkup.match(/<button[^>]*>/g) || [];
  assert.equal(otherAccountButtons.length, 5);
  assert.ok(otherAccountButtons.every(buttonMarkup => !/\sdisabled(?:\s|>)/.test(buttonMarkup)), 'busy state must not leak across account identity');
});

test('Email updates replacement card buttons while busy and releases only the same owner row', async () => {
  let finishComplete;
  const h = harness({ live: true, api: body => body.operation === 'complete'
    ? new Promise(resolve => { finishComplete = resolve; })
    : acknowledgement({ suspend_tag_status: 'awaiting_rep', suspend_tag_version: 2 }) });
  const replacementActions = [makeSuspendAction(), makeSuspendAction()];
  h.ctx.document = makeSuspendActionDocument(h.mirror.UNIQUE_ID, replacementActions);
  const pending = h.ctx.emailSuspendTagFromCard(h.mirror.UNIQUE_ID, button());
  await new Promise(setImmediate);
  assert.ok(replacementActions.every(action => action.disabled && action.attributes.get('aria-disabled') === 'true'), 'the current exact row controls are disabled while its command is pending');
  const rerender = h.ctx.buildSuspendTagActions(h.mirror);
  assert.equal((rerender.match(/<button[^>]*\sdisabled(?:\s|>)[^>]*>/g) || []).length, 5, 'a fresh render preserves the in-flight disabled state');
  finishComplete(acknowledgement({ suspend_tag_status: 'completed', suspend_tag_version: 1 }));
  await pending;
  assert.ok(replacementActions.every(action => !action.disabled && !action.attributes.has('aria-disabled')), 'the exact current row is re-enabled after completion and email queueing');
  assert.ok(h.calls.filter(call => call.name !== 'rows').every(call => call.body.payload.sourceUid === 'soc-1'));
});

test('card Email does not send twice when denied completion already queued approval', async () => {
  const h = harness({ live: true, api: () => acknowledgement({ suspend_tag_status: 'awaiting_rep' }) });
  h.mirror.suspend_tag_status = h.ctx.remoteRow.suspend_tag_status = 'denied';
  await h.ctx.emailSuspendTagFromCard(h.mirror.UNIQUE_ID, button());
  assert.deepEqual(h.calls.map(call => call.name), ['complete']);
  assert.ok(h.toasts.some(([title]) => title === 'Email queued'));
});

test('Email retains completed review on missing rep and retries only send with the same command', async () => {
  let fail = true;
  const h = harness({ live: true, api: body => {
    if (body.operation === 'send' && fail) throw new Error('SUSPEND_TAG_REP_EMAIL_MISSING');
    return acknowledgement({ suspend_tag_status: body.operation === 'send' ? 'awaiting_rep' : 'completed', suspend_tag_version: body.operation === 'send' ? 2 : 1 });
  } });
  await h.ctx.emailSuspendTagFromCard(h.mirror.UNIQUE_ID, button());
  assert.equal(h.ctx.getSuspendTagStatus(h.mirror), 'completed');
  assert.ok(h.toasts.some(([title]) => title === 'Review saved; email not queued'));
  assert.ok(!h.toasts.some(([title]) => title === 'Email queued'));
  fail = false;
  await h.ctx.emailSuspendTagFromCard(h.mirror.UNIQUE_ID, button());
  const writes = h.calls.filter(call => call.name !== 'rows');
  assert.deepEqual(writes.map(call => call.name), ['complete', 'send', 'send']);
  assert.equal(writes[1].body.commandId, writes[2].body.commandId);
  assert.equal(h.ctx.isOptimisticallyCompletedRow(h.mirror), false);
});

test('Email waits for row uploads and saves, blocks duplicate Email and Complete Tag taps', async () => {
  let finishUpload, finishSave;
  const h = harness({ live: true, api: body => acknowledgement({ suspend_tag_status: body.operation === 'send' ? 'awaiting_rep' : 'completed', suspend_tag_version: body.operation === 'send' ? 2 : 1 }) });
  const upload = new Promise(resolve => { finishUpload = resolve; });
  h.ctx.getPendingPhotoUploadsForItem = () => [upload];
  const save = h.ctx.serializeSuspendTagRowWrite(h.mirror, () => new Promise(resolve => { finishSave = resolve; }));
  const action = button(), pending = h.ctx.emailSuspendTagFromCard(h.mirror.UNIQUE_ID, action);
  await new Promise(setImmediate);
  assert.equal(action.disabled, true);
  await h.ctx.emailSuspendTagFromCard(h.mirror.UNIQUE_ID, button());
  await h.ctx.closeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, button());
  assert.equal(h.calls.length, 0);
  finishUpload(); await new Promise(setImmediate);
  assert.equal(h.calls.length, 0);
  finishSave(); await save; await pending;
  assert.deepEqual(h.calls.filter(call => call.name !== 'rows').map(call => call.name), ['complete', 'send']);
  assert.equal(action.disabled, false);
});

test('Email uses the revision acknowledged by queued saves and uploads before completing and sending', async () => {
  for (const queueType of ['save', 'upload']) {
    let finishQueue;
    const updatedRevision = '2026-09-08T15:51:02.654321Z';
    const h = harness({ live: true, api: body => acknowledgement({
      last_updated: body.payload.expectedLastUpdated,
      suspend_tag_status: body.operation === 'send' ? 'awaiting_rep' : 'completed',
      suspend_tag_version: body.operation === 'send' ? 3 : 2,
    }) });
    const advanceRevision = () => {
      Object.assign(h.row, { LAST_UPDATED: updatedRevision, last_updated: updatedRevision, suspend_tag_version: 1 });
      Object.assign(h.mirror, { LAST_UPDATED: updatedRevision, last_updated: updatedRevision, suspend_tag_version: 1, SUSPEND_TAG_VERSION: 1 });
      h.ctx.remoteRow = { ...h.ctx.remoteRow, last_updated: updatedRevision, suspend_tag_version: 1 };
    };
    let pendingSave;
    if (queueType === 'save') {
      pendingSave = h.ctx.serializeSuspendTagRowWrite(h.mirror, () => new Promise(resolve => { finishQueue = resolve; }));
    } else {
      const pendingUpload = new Promise(resolve => { finishQueue = resolve; });
      h.ctx.getPendingPhotoUploadsForItem = () => [pendingUpload];
    }
    const email = h.ctx.emailSuspendTagFromCard(h.mirror.UNIQUE_ID, button());
    await new Promise(setImmediate);
    advanceRevision();
    finishQueue(true);
    if (pendingSave) await pendingSave;
    await email;
    const writes = h.calls.filter(call => call.name !== 'rows');
    assert.deepEqual(writes.map(call => call.name), ['complete', 'send'], queueType);
    assert.ok(writes.every(call => call.body.payload.expectedLastUpdated === updatedRevision), `${queueType} completion and send use the queued write's exact revision`);
    assert.ok(h.toasts.some(([title]) => title === 'Email queued'), queueType);
  }
});

test('Email blocks missing data, failed uploads/saves, wrong identity, unauthorized and stale revisions', async () => {
  for (const reason of ['data', 'upload', 'save', 'identity', 'auth', 'revision', 'version']) {
    const h = harness({ live: true, ready: reason !== 'data', api: () => {
      if (['revision', 'version'].includes(reason)) throw new Error('SUSPEND_TAG_VERSION_CHANGED');
      return acknowledgement();
    } });
    if (reason === 'upload') h.ctx.getPendingPhotoUploadsForItem = () => [Promise.reject(new Error('upload failed'))];
    if (reason === 'save') vm.runInContext('suspendTagRowWrites.set(currentUser + "|soc-1", Promise.reject(new Error("save failed")))', h.ctx);
    if (reason === 'auth') h.ctx.allowed = false;
    if (reason === 'revision') h.ctx.remoteRow.last_updated = '2026-09-09T00:00:00Z';
    if (reason === 'version') h.ctx.remoteRow.suspend_tag_version = 4;
    await h.ctx.emailSuspendTagFromCard(reason === 'identity' ? 'another-row' : h.mirror.UNIQUE_ID, button());
    const writes = h.calls.filter(call => call.name !== 'rows');
    if (['revision', 'version'].includes(reason)) assert.deepEqual(writes.map(call => call.name), ['complete'], reason);
    else assert.equal(writes.length, 0, reason);
    assert.ok(!h.toasts.some(([title]) => title === 'Email queued'), reason);
  }
});

test('Email fences account and navigation switches between completion and send', async () => {
  for (const change of ['account', 'navigation', 'permissions']) {
    let finish;
    const h = harness({ live: true, api: () => new Promise(resolve => { finish = resolve; }) });
    h.ctx.canCurrentUserWorkRequestItem = () => h.ctx.allowed && h.ctx.permission === 'permissions-1';
    const pending = h.ctx.emailSuspendTagFromCard(h.mirror.UNIQUE_ID, button());
    await new Promise(setImmediate);
    if (change === 'account') h.ctx.currentUser = 'other';
    if (change === 'navigation') h.ctx.productionLiveSyncNavigation.abort();
    if (change === 'permissions') h.ctx.permission = 'permissions-2';
    finish(acknowledgement()); await pending;
    assert.deepEqual(h.calls.map(call => call.name), ['complete']);
    assert.ok(!h.toasts.some(([title]) => title === 'Email queued'));
  }
});

test('Email retries uncertain completion and send responses through their original receipts', async () => {
  for (const lost of ['complete', 'send']) {
    let fail = true;
    const h = harness({ live: true, api: body => {
      const result = acknowledgement({ suspend_tag_status: body.operation === 'send' ? 'awaiting_rep' : 'completed', suspend_tag_version: body.operation === 'send' ? 2 : 1 });
      if (body.operation === lost && fail) { fail = false; h.ctx.remoteRow = result.row; throw new Error('response lost'); }
      return result;
    } });
    await h.ctx.emailSuspendTagFromCard(h.mirror.UNIQUE_ID, button());
    if (!h.toasts.some(([title]) => title === 'Email queued')) {
      assert.equal(lost, 'send');
      assert.ok(h.toasts.some(([title]) => title === 'Review saved; email not confirmed'));
      await h.ctx.emailSuspendTagFromCard(h.mirror.UNIQUE_ID, button());
    }
    const retries = h.calls.filter(call => call.name === lost);
    assert.ok(retries.length >= 1 && retries.length <= 2, lost);
    if (retries.length === 2) {
      assert.equal(retries[0].body.commandId, retries[1].body.commandId);
      assert.equal(retries[0].body.expectedVersion, retries[1].body.expectedVersion);
    } else assert.ok(h.calls.some(call => call.name === 'rows'), 'a lost response needs a confirmed row');
    assert.ok(h.toasts.some(([title]) => title === 'Email queued'));
  }
});

test('Email preserves approved and awaiting states; failed delivery retries without completing again', async () => {
  for (const status of ['completed', 'awaiting_rep', 'approved', 'failed']) {
    const h = harness({ live: true, api: () => acknowledgement({ suspend_tag_status: 'awaiting_rep' }) });
    h.mirror.suspend_tag_status = h.ctx.remoteRow.suspend_tag_status = status === 'failed' ? 'awaiting_rep' : status;
    if (status === 'failed') h.mirror.suspend_tag_delivery_status = 'failed';
    await h.ctx.emailSuspendTagFromCard(h.mirror.UNIQUE_ID, button());
    assert.deepEqual(h.calls.filter(call => call.name !== 'rows').map(call => call.name), status === 'completed' ? ['send'] : status === 'failed' ? ['retry'] : []);
  }
});

test('active Suspend filter keeps emailed and approved tags visible until closure', () => {
  const h = harness();
  h.ctx.isDockSuspendDcRequestSource = row => row.SUSPEND === 'SUSPEND';
  vm.runInContext(between('function getSuspendTagRequestItems(', 'function countPendingSuspendTagQueueItems('), h.ctx);
  for (const status of ['pending', 'denied', 'completed', 'awaiting_rep', 'approved']) {
    h.mirror.suspend_tag_status = status;
    assert.equal(h.ctx.getSuspendTagRequestItems([h.mirror]).length, 1, status);
  }
  h.mirror.SUSPEND = null;
  assert.equal(h.ctx.getSuspendTagRequestItems([h.mirror]).length, 0);
});

test('native Save submits the exact source and revision while the whole view is unverified', async () => {
  const h = harness({ live: true, proof: false });
  assert.equal(await h.ctx.runSuspendTagRowCommand('save', h.mirror, { dock_spec: 'new spec', dock_photo_link: 'photo.jpg' }), true);
  assert.deepEqual(h.calls.map(call => call.name), ['save']);
  assert.equal(h.calls[0].body.expectedVersion, 0);
  assert.equal(h.calls[0].body.payload.sourceUid, 'soc-1');
  assert.equal(h.calls[0].body.payload.expectedLastUpdated, revision);
  assert.equal(h.calls[0].body.payload.patch.dock_spec, 'new spec');
  assert.equal(h.calls[0].body.payload.patch.dock_photo_link, 'photo.jpg');
  assert.equal(h.toasts.length, 0);
  assert.equal(vm.runInContext('suspendTagWriteReads.size', h.ctx), 0);
  assert.equal(vm.runInContext('suspendTagRowWrites.size', h.ctx), 0);
});

test('Done applies canonical inventory evidence and removes the row from the active Que', async () => {
  const inventoryRow = { unique_id: 'master-1', photo_link: 'new.jpg', match: '40', av_rule_photo_updated_at: '2026-10-14T11:00:00Z' };
  const h = harness({ api: () => ({ ...acknowledgement(), inventoryRow }) });
  let receipt;
  h.ctx.applySuspendTagInventoryReceipt = (result, scope) => { receipt = { result, scope }; return true; };
  assert.equal(await h.ctx.runSuspendTagRowCommand('complete', h.mirror), true);
  assert.equal(receipt.result.inventoryRow, inventoryRow);
  assert.equal(receipt.scope, h.ctx.currentUser);
  assert.equal(h.row.SUSPEND, 'SUSPEND');
  assert.equal(h.row.SUSPEND_TO, 'DC');
  assert.equal(h.ctx.isOptimisticallyCompletedRow(h.mirror), true);
});

test('Complete Tag is direct, permits pending approval, and removes eligibility without emailing', async () => {
  let finish;
  const h = harness({ live: true, proof: false, api: () => new Promise(resolve => { finish = resolve; }) });
  h.ctx.remoteRow.suspend_tag_status = h.mirror.suspend_tag_status = 'awaiting_rep';
  const action = button();
  const pending = h.ctx.closeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, action);
  await new Promise(setImmediate);
  assert.equal(action.disabled, true);
  assert.equal(h.row.SUSPEND, 'SUSPEND');
  await h.ctx.closeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, button());
  assert.deepEqual(h.calls.map(call => call.name), ['close']);
  assert.equal(h.calls[0].body.expectedVersion, null);
  assert.equal(h.calls[0].body.payload.expectedLastUpdated, revision);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].body.payload.sourceIdentity)), {
    masterUid: '', transactionnumber: 'tx-39-20', tagcode: 'TAG-150', dock: '39', stopnumber: '20', itemcode: '009373.031.1',
    locationcode: 'F.14.000', lotcode: '27.F1', quantityshipped: '150', customer: '',
    consignee: 'Little Lime Punch', salesrep: '', spec: '', photo_url: '', loc_photo_match: '',
  });
  assert.equal(h.confirmCalls, 0);
  assert.equal(h.openUpdateCalls, 0);
  finish(acknowledgement({ suspend: null, suspend_to: null }));
  await pending;
  assert.equal(h.row.SUSPEND, null);
  assert.equal(h.mirror.SUSPEND_TO, null);
  assert.equal(action.disabled, false);
  assert.ok(h.toasts.some(([title]) => title === 'Tag Complete'), JSON.stringify(h.toasts));
});

test('Suspend card actions use delegated data-action buttons and preserve nested press guards', () => {
  const h = harness();
  const markup = h.ctx.buildSuspendTagActions(h.mirror, 'data-fast-press-ignore onpointerdown="return stopNestedCardActionPress(event)"');
  assert.match(markup, /data-action="email-tag"/);
  assert.match(markup, /data-action="complete-tag"/);
  assert.match(markup, /data-fast-press-ignore onpointerdown=/);
  assert.doesNotMatch(markup, /\sonclick=/);
  const registration = h.documentListeners.get('click');
  assert.equal(registration?.capture, true);
  assert.equal(typeof registration?.listener, 'function');
  const dispatches = [];
  h.ctx.closeDockSuspendDcRequestFromCard = (id, target) => { dispatches.push([id, target]); return false; };
  const actionButton = {
    disabled: false,
    getAttribute: name => ({ 'data-unique-id': h.mirror.UNIQUE_ID, 'data-action': 'complete-tag' })[name] || null,
  };
  let prevented = false, stopped = false, immediateStopped = false;
  registration.listener({
    target: { closest: selector => selector.includes('.app-suspend-tag-actions') ? actionButton : null },
    preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; },
    stopImmediatePropagation() { immediateStopped = true; },
  });
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0][0], h.mirror.UNIQUE_ID);
  assert.equal(dispatches[0][1], actionButton);
  assert.deepEqual([prevented, stopped, immediateStopped], [true, true, true]);
});

test('Fill Tag opens the authorized location picker and detail avoids the read-only summary', () => {
  const openStart = html.indexOf('function openDockSuspendDcRequestUpdate(');
  const openEnd = html.indexOf('function refreshLocalDockSuspendDcRequestState(', openStart);
  const openPath = html.slice(openStart, openEnd);
  assert.match(openPath, /skipRequestOpenInfoModal:\s*true/);
  assert.match(openPath, /if \(safeOptions\.openAvOptions\)[\s\S]*requestAvOptionsDropdownOpen = true[\s\S]*renderRequestMatchingInventoryOptions/);
  assert.match(html, /action === 'fill-tag'\) openSuspendPullPicker\(uniqueId\)/);
  assert.match(html, /function openSuspendPullPicker\(uniqueId\)[\s\S]{0,250}canReadSuspendQueue\(\)[\s\S]{0,100}canManageLocations/);
});

test('lost close response retries its receipt even after the row leaves the eligible dataset', async () => {
  let first = true;
  const h = harness({ live: true, proof: false,
    read: ctx => ({ rows: first ? [{ ...ctx.remoteRow }] : [] }),
    api: () => {
      if (first) { first = false; throw new Error('response lost'); }
      return acknowledgement({ suspend: null, suspend_to: null });
    } });
  await h.ctx.closeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, button());
  assert.equal(h.row.SUSPEND, 'SUSPEND');
  await h.ctx.closeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, button());
  const writes = h.calls.filter(call => call.name === 'close');
  assert.equal(writes.length, 2);
  assert.equal(writes[0].body.commandId, writes[1].body.commandId);
  assert.equal(writes[0].body.expectedVersion, writes[1].body.expectedVersion);
  assert.equal(h.row.SUSPEND, null);
  const restored = harness({ storage: h.storage });
  assert.equal(restored.ctx.overlaySuspendTagReceipt(source()).suspend, null);
  assert.equal(restored.ctx.overlaySuspendTagReceipt(source()).SUSPEND, null, 'cached uppercase aliases cannot resurrect a closed tag');
  assert.equal(restored.ctx.overlaySuspendTagReceipt(source()).SUSPEND_TO, null);
});

test('Complete Tag attempts closure despite an incomplete review or failed upload and rolls back server rejection', async () => {
  for (const scenario of ['upload', 'incomplete', 'conflict']) {
    const h = harness({ ready: scenario !== 'incomplete', api: () => { throw new Error('SUSPEND_TAG_VERSION_CHANGED'); } });
    if (scenario === 'upload') h.ctx.getPendingPhotoUploadsForItem = () => [Promise.reject(new Error('Upload failed'))];
    await h.ctx.closeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, button());
    assert.equal(h.row.SUSPEND, 'SUSPEND');
    assert.equal(h.calls.filter(call => call.name === 'close').length, 1);
    assert.ok(!h.toasts.some(([title]) => title === 'Tag Complete'));
    assert.equal(h.openUpdateCalls, 0, 'incomplete details must not open a summary/detail modal from the card action');
    assert.equal(h.confirmCalls, 0, 'Complete Tag must not show a confirmation modal');
  }
});

test('Suspend actions respect row access for reviewed and denied users', () => {
  const h = harness();
  vm.runInContext(between('function canCurrentUserWorkRequestItem(', 'function parseRequestCustomerFolderParts('), h.ctx);
  for (const status of ['awaiting_rep', 'approved']) {
    h.mirror.suspend_tag_status = status;
    assert.equal(h.ctx.canCurrentUserWorkRequestItem(h.mirror, 'close'), true);
    assert.equal(h.ctx.canCurrentUserWorkRequestItem(h.mirror, 'edit'), true);
    assert.equal(h.ctx.canCurrentUserWorkRequestItem(h.mirror, 'complete'), true);
  }
  h.ctx.allowed = false;
  assert.equal(h.ctx.canCurrentUserWorkRequestItem(h.mirror, 'close'), false);
});

test('an incomplete close acknowledgement cannot remove the card or report completion', async () => {
  const h = harness({ api: () => acknowledgement({ suspend: 'SUSPEND', suspend_to: 'DC' }) });
  await h.ctx.closeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, button());
  assert.equal(h.row.SUSPEND, 'SUSPEND');
  assert.ok(h.toasts.some(([title]) => title === 'Could Not Complete Tag'));
  assert.ok(!h.toasts.some(([title]) => title === 'Tag Complete'));
});

test('native verification deduplicates reads and releases pending state after failure and retry', async () => {
  let finish;
  const h = harness({ live: true, proof: false, read: () => new Promise(resolve => { finish = resolve; }) });
  const first = h.ctx.loadCurrentSuspendTagWriteRow(h.mirror, 'save');
  assert.equal(h.ctx.loadCurrentSuspendTagWriteRow(h.mirror, 'save'), first);
  await new Promise(setImmediate);
  assert.equal(h.calls.length, 1);
  finish({ rows: [] });
  await assert.rejects(first, /SOURCE_CHANGED/);
  assert.equal(vm.runInContext('suspendTagWriteReads.size', h.ctx), 0);
  const retry = h.ctx.loadCurrentSuspendTagWriteRow(h.mirror, 'save');
  await new Promise(setImmediate);
  finish({ rows: [h.ctx.remoteRow] });
  assert.equal(h.ctx.isCurrentSuspendTagWriteRowProof(await retry, h.mirror, 'save'), true);
  assert.equal(vm.runInContext('suspendTagWriteReads.size', h.ctx), 0);
});

test('native Mark Done sends once and ignores duplicate taps during transport', async () => {
  let finish;
  const h = harness({ live: true, proof: false, api: () => new Promise(resolve => { finish = resolve; }) });
  const action = button();
  const first = h.ctx.completeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, action);
  await new Promise(setImmediate);
  assert.equal(action.disabled, true);
  await h.ctx.completeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, button());
  assert.deepEqual(h.calls.map(call => call.name), ['complete']);
  assert.equal(h.calls[0].body.payload.expectedLastUpdated, revision);
  finish(acknowledgement());
  await first;
  assert.equal(action.disabled, false);
  assert.equal(vm.runInContext('suspendTagCompletionActions.size', h.ctx), 0);
});

test('native verification rejects locked, wrong-source, unauthorized and unavailable permission snapshots', async () => {
  const scenarios = [
    h => { h.ctx.remoteRow.suspend_tag_status = 'awaiting_rep'; },
    h => { h.ctx.remoteRow.unique_id = 'other-row'; },
    h => { h.ctx.allowed = false; },
    h => { h.ctx.supabaseRpc = async () => ({ contractVersion: 1, permissionVersion: 'wrong', sources: [{ key: 'ph_soc_master', state: 'ready', revision: '1' }] }); },
    h => { h.ctx.supabaseRpc = async () => ({ contractVersion: 1, permissionVersion: h.ctx.permission, sources: [{ key: 'ph_soc_master', state: 'importing', revision: '1' }] }); },
  ];
  for (const configure of scenarios) {
    const h = harness({ live: true, proof: false }); configure(h);
    await assert.rejects(h.ctx.loadCurrentSuspendTagWriteRow(h.mirror, 'save'));
    assert.equal(h.calls.filter(call => call.name === 'save').length, 0);
    assert.equal(vm.runInContext('suspendTagWriteReads.size', h.ctx), 0);
    assert.equal(vm.runInContext('suspendTagRowWrites.size', h.ctx), 0);
  }
});

test('verification accepts a newer readable source while preserving its exact identity', async () => {
  const h = harness({ live: true, proof: false });
  h.ctx.remoteRow.last_updated = '2026-09-08T15:50:48Z';
  h.ctx.remoteRow.suspend_tag_version = 5;
  const proof = await h.ctx.loadCurrentSuspendTagWriteRow(h.mirror, 'save');
  assert.equal(proof.row.unique_id, 'soc-1');
  assert.equal(proof.row.suspend_tag_version, 5);
  assert.equal(h.calls.filter(call => call.name === 'save').length, 0);
});

test('navigation, account and permission changes discard an in-flight row verification', async () => {
  for (const change of [h => h.ctx.productionLiveSyncNavigation.abort(), h => { h.ctx.productionLiveSyncNavigation = new AbortController(); },
    h => { h.ctx.currentUser = 'other'; }, h => { h.ctx.permission = 'changed'; }, h => { h.ctx.view = 'home'; }]) {
    let finish;
    const h = harness({ live: true, proof: false, read: () => new Promise(resolve => { finish = resolve; }) });
    const pending = h.ctx.loadCurrentSuspendTagWriteRow(h.mirror, 'save');
    await new Promise(setImmediate); change(h); finish({ rows: [h.ctx.remoteRow] });
    await assert.rejects(pending);
    assert.equal(h.calls.filter(call => call.name === 'save').length, 0);
    assert.equal(vm.runInContext('suspendTagWriteReads.size', h.ctx), 0);
  }
});

test('native lost response recovers a matching committed row without another write', async () => {
  let fail = true;
  const h = harness({ live: true, proof: false, api: () => {
    h.ctx.remoteRow = { ...h.ctx.remoteRow, suspend_tag_version: 1, dock_spec: 'draft' };
    if (fail) { fail = false; throw new Error('response lost'); }
    return acknowledgement({ suspend_tag_status: 'pending', dock_spec: 'draft' });
  } });
  assert.equal(await h.ctx.runSuspendTagRowCommand('save', h.mirror, { dock_spec: 'draft' }), true);
  const writes = h.calls.filter(call => call.name === 'save');
  assert.equal(writes.length, 1);
  assert.ok(writes[0].body.commandId);
  assert.equal(writes[0].body.expectedVersion, 0);
  assert.equal(h.calls.filter(call => call.name === 'rows').length, 1);
});

test('row verification does not bypass the approval action guard', async () => {
  const h = harness({ live: true, proof: false });
  await assert.rejects(h.ctx.runSuspendTagRowCommand('send', h.mirror), /REVIEW_LOCKED/);
  assert.deepEqual(h.calls.map(call => call.name), ['rows']);
  h.ctx.allowed = false;
  await assert.rejects(h.ctx.runSuspendTagRowCommand('send', h.mirror), /FORBIDDEN/);
  assert.deepEqual(h.calls.map(call => call.name), ['rows']);
});

test('detail save keeps captured fields and proceeds while photos upload, with a recoverable verification timeout', detailSaveChecks);

test('detail Mark Done returns to the request list only after the current detail save is confirmed', detailMarkDoneChecks);

test('Done saves the exact source revision before marking retained rows completed; retains the source', async () => {
  let resolve;
  const wait = new Promise((done) => { resolve = done; });
  const h = harness({ api: () => wait });
  const action = button();
  const pending = h.ctx.completeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, action);
  await new Promise(setImmediate);
  assert.equal(action.disabled, true);
  assert.equal(h.row.DATE_COMPLETED, '');
  assert.equal(h.toasts.length, 0);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].name, 'complete');
  assert.equal(h.calls[0].body.payload.sourceUid, 'soc-1');
  assert.equal(h.calls[0].body.payload.expectedLastUpdated, revision);
  await h.ctx.completeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, button());
  assert.equal(h.calls.length, 1);
  resolve(acknowledgement());
  await pending;
  assert.equal(h.row.DATE_COMPLETED, acknowledgement().row.date_completed);
  assert.equal(h.row.PTRONHAND, '0');
  assert.equal(h.ctx.isAcknowledgedDockSuspendCompletion(source()), true);
});

test('unverified Suspend Tag view never starts a completion write', async () => {
  const h = harness({ proof: false });
  const action = button();
  await h.ctx.completeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, action);
  assert.equal(h.calls.length, 0);
  assert.equal(h.row.DATE_COMPLETED, '');
  assert.equal(action.disabled, false);
  assert.ok(h.toasts.length === 0);
});
test('cancel or unauthorized actor never submits a write', async () => {
  for (const denied of [false, true]) {
    const h = harness({ confirm: denied });
    h.ctx.allowed = !denied;
    const action = button();
    await h.ctx.completeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, action);
    assert.equal(h.calls.length, 0);
    assert.equal(h.row.DATE_COMPLETED, '');
    assert.equal(action.disabled, false);
  }
});

test('lost response and reopening the app preserve the command token; failures stay actionable', async () => {
  const h = harness({ api: () => { throw new Error('Connection lost'); } });
  const action = button();
  await h.ctx.completeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, action);
  assert.equal(action.disabled, false);
  assert.equal(h.row.DATE_COMPLETED, '');
  assert.equal(h.ctx.isAcknowledgedDockSuspendCompletion(h.row), false);
  const next = harness({ storage: h.storage, api: () => acknowledgement({ alreadyCompleted: true }) });
  await next.ctx.completeDockSuspendDcRequestFromCard(next.mirror.UNIQUE_ID, button());
  assert.equal(next.calls[0].body.commandId, h.calls[0].body.commandId);
  assert.equal(next.row.DATE_COMPLETED, acknowledgement().row.date_completed);
});

test('wrong-source Suspend receipts never publish or acknowledge a different row', async () => {
  for (const operation of ['save', 'complete', 'close']) {
    const h = harness({ api: () => acknowledgement({ unique_id: 'other' }) });
    let publications = 0;
    h.ctx.applySuspendCandidateRows = () => { publications += 1; };
    await assert.rejects(h.ctx.suspendTagApi(operation, { sourceUid: 'soc-1' }, { commandId: 'command-1' }), /did not confirm/);
    assert.equal(publications, 0);
    assert.equal(h.row.DATE_COMPLETED, '');
    assert.equal(h.ctx.isAcknowledgedDockSuspendCompletion(h.row), false);
  }
});

test('malformed acknowledgements never hide the row or claim success', async () => {
  for (const result of [null, {}, acknowledgement({ unique_id: 'other' }), acknowledgement({ date_completed: 'invalid' }), acknowledgement({ suspend_tag_version: undefined })]) {
    const h = harness({ api: () => result });
    const action = button();
    await h.ctx.completeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, action);
    assert.equal(h.row.DATE_COMPLETED, '', JSON.stringify(result));
    assert.equal(h.ctx.isAcknowledgedDockSuspendCompletion(h.row), false);
    assert.equal(action.disabled, false);
    assert.ok(!h.toasts.some(([title]) => title === 'Marked Done'));
  }
});

test('a confirmed completion may retain a nullable source revision', async () => {
  const h = harness({ api: () => acknowledgement({ last_updated: null }) });
  await h.ctx.completeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, button());
  assert.equal(h.row.DATE_COMPLETED, acknowledgement().row.date_completed);
  assert.ok(h.toasts.some(([title]) => title === 'Marked Done'));
});

test('receipts preserve completed state across stale snapshots without hiding rows', async () => {
  const h = harness();
  await h.ctx.completeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, button());
  const next = harness({ storage: h.storage });
  assert.equal(next.ctx.isAcknowledgedDockSuspendCompletion(source()), true);
  assert.equal(next.ctx.isAcknowledgedDockSuspendCompletion({ ...source(), LAST_UPDATED: '2026-09-08T15:50:48Z' }), false);
  next.ctx.currentUser = 'jd_jones';
  assert.equal(next.ctx.isAcknowledgedDockSuspendCompletion(source()), false);
});

test('an older acknowledgement does not mutate a newer source or a switched user session', lateSuspendReceiptChecks);

test('completion revision retains PostgreSQL microseconds and equivalent timezone formatting', () => {
  const h = harness();
  assert.equal(h.ctx.getDockSuspendCompletionRevision({ last_updated: '2026-09-08T15:50:47.123456+00:00' }), revision);
  assert.equal(h.ctx.getDockSuspendCompletionRevision({ last_updated: '2026-09-08T10:50:47.123456-05:00' }), revision);
  assert.equal(h.ctx.getDockSuspendCompletionRevision({ last_updated: null }), null);
});

test('a row changed while confirmation is open submits only the originally reviewed revision', async () => {
  const h = harness({ api: () => { throw new Error('SUSPEND_TAG_SOURCE_CHANGED'); } });
  let confirm;
  h.ctx.showAppConfirm = () => new Promise((resolve) => { confirm = resolve; });
  const pending = h.ctx.completeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, button());
  h.ctx.currentSource = { ...source(), LAST_UPDATED: '2026-09-08T17:00:00Z' };
  confirm(true);
  await pending;
  assert.equal(h.calls[0].body.payload.expectedLastUpdated, revision);
  assert.equal(h.ctx.currentSource.DATE_COMPLETED, '');
  assert.ok(h.toasts.some(([, message]) => message.includes('Refresh')));
});

test('recount completion shares the protected persistence path', async () => {
  const h = harness();
  await h.ctx.markDockSuspendDcRequestCompleteAfterRecount(h.mirror.UNIQUE_ID);
  assert.equal(h.calls[0].name, 'complete');
  assert.equal(h.row.DATE_COMPLETED, acknowledgement().row.date_completed);
});

test('server rejection of an incomplete card retains the row', async () => {
  const h = harness({ ready: false, api: () => { throw new Error('SUSPEND_TAG_REVIEW_REQUIRED'); } });
  await h.ctx.completeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, button());
  assert.equal(h.calls.filter(call => call.name === 'complete').length, 1);
  assert.equal(h.row.DATE_COMPLETED, '');
  assert.ok(h.toasts.some(([title]) => title === 'Could Not Complete'));
});
test('new denial state supersedes a cached completion without dropping photos', async () => { const h=harness(); await h.ctx.completeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID,button()); const denied={...source(),suspend_tag_status:'denied',suspend_tag_version:2,DOCK_PHOTO_LINK:'saved.jpg'}; assert.equal(h.ctx.getSuspendTagStatus(denied),'denied'); assert.equal(h.ctx.overlaySuspendTagReceipt(denied).DOCK_PHOTO_LINK,'saved.jpg'); });

test('Complete Tag paints row removal and reconciles assigned counts before broad refresh', () => {
  const beginPath = between('async function runSerializedSuspendCommand(', 'function removePendingSuspendCloseRows(');
  assert.match(beginPath, /completion\.begin\(completionKey[\s\S]*?paintOptimisticSuspendTagRemoval\(mirror\)[\s\S]*?serializeSuspendTagRowWrite/);
  assert.match(beginPath, /paintOptimisticSuspendTagRemoval\(mirror\)[\s\S]*?await yieldToUiFrame\(\);[\s\S]*?invalidateResolvedViewStateCaches\(\);[\s\S]*?serializeSuspendTagRowWrite/);
  assert.doesNotMatch(beginPath, /refreshLocalDockSuspendDcRequestState\('suspend-tag-completing'/);
  const paintStart = html.indexOf('function paintOptimisticSuspendTagRemoval(');
  const paintEnd = html.indexOf('function forcePendingRequestRoot(', paintStart);
  const paint = html.slice(paintStart, paintEnd);
  assert.doesNotMatch(paint, /invalidateResolvedViewStateCaches/);
  assert.match(paint, /\.request-card-list--suspend-tag \[data-request-uid\]/);
  assert.match(paint, /row\.remove\(\)/);
  assert.match(paint, /const counts = getRequestTabQueueCounts\(\)/);
  assert.match(paint, /syncRequestTabButtons\(counts\)/);
  assert.match(paint, /paintFooterRequestBadgeOnly\(counts\)/);
  assert.doesNotMatch(paint, /updateFooterNavState/);
  assert.match(html, /completion\?\.rollback\(completionKey\)[\s\S]{0,180}refreshLocalDockSuspendDcRequestState\('suspend-tag-completion-settled'/);
});

test('optimistic Suspend badge paint does not synchronously rebuild mobile navigation', () => {
  const badgePaint = between('function paintFooterRequestBadgeOnly(', 'function updateFooterRequestBadge(');
  const normalUpdate = between('function updateFooterRequestBadge(', 'function isQuickDriveRequestMode(');
  const badgeClasses = new Set();
  const buttonClasses = new Set();
  const button = { classList: { toggle: (name, enabled) => enabled ? buttonClasses.add(name) : buttonClasses.delete(name) } };
  const badge = { textContent: '', classList: {
    add: name => badgeClasses.add(name),
    remove: name => badgeClasses.delete(name),
  } };
  let liveSyncCalls = 0;
  let navSyncCalls = 0;
  let assignedCounts = { pending: 0 };
  const ctx = {
    document: { getElementById: id => id === 'footer-request-btn' ? button : id === 'footer-request-badge' ? badge : null, querySelector: () => null },
    canUseFooterRequestShortcut: () => true,
    getRequestQueueAlertCount: counts => Number(counts.pending || 0),
    getActiveAssignedQueueCounts: () => assignedCounts,
    queueRequestBadgeLiveSync: () => { liveSyncCalls += 1; },
    updateFooterNavState: () => { navSyncCalls += 1; },
  };
  vm.createContext(ctx);
  vm.runInContext(`${badgePaint}\n${normalUpdate}`, ctx);

  assert.equal(ctx.paintFooterRequestBadgeOnly({ pending: 0 }), true);
  assert.equal(buttonClasses.has('hidden'), false);
  assert.equal(badgeClasses.has('hidden'), true);
  assert.equal(navSyncCalls, 0);
  assert.equal(liveSyncCalls, 0);

  assignedCounts = { pending: 1 };
  ctx.updateFooterRequestBadge({ pending: 0 });
  assert.equal(buttonClasses.has('hidden'), false);
  assert.equal(badge.textContent, '1');
  assert.equal(badgeClasses.has('hidden'), false);
  assert.equal(navSyncCalls, 1, 'ordinary badge updates retain normal navigation reconciliation');
  assert.equal(liveSyncCalls, 1, 'ordinary badge updates retain background synchronization');
});

test('iOS constrained chrome fallback overrides the glass rule on fixed filter rails', () => {
  const glassAt = precisionCss.indexOf('html:not(.outdoor-mode) body.ops-precision-pilot :is(', precisionCss.indexOf('backdrop-filter: blur(16px)'));
  const fallbackAt = precisionCss.indexOf('html body.ios-device.ops-precision-pilot :is(');
  assert.ok(glassAt >= 0 && fallbackAt > glassAt, 'the iOS override follows the shared glass rule');
  const fallbackEnd = precisionCss.indexOf('\n}', fallbackAt);
  const fallback = precisionCss.slice(fallbackAt, fallbackEnd);
  assert.match(fallback, /\.fixed-filter-rail/);
  assert.match(fallback, /-webkit-backdrop-filter:\s*none\s*!important/);
  assert.match(fallback, /backdrop-filter:\s*none\s*!important/);
});

test('queued evidence saves use the latest version and retain photos and the newest unsaved draft', async () => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  let writes = 0;
  const h = harness({ api: async body => {
    writes += 1;
    if (writes === 1) await wait;
    return acknowledgement({ ...body.payload.patch, suspend_tag_status: 'pending', suspend_tag_version: writes });
  } });
  let reconciled = 0;
  h.ctx.queueSuspendTagInventoryReconciliation = () => { reconciled += 1; };
  h.ctx.draftRow = h.mirror;
  vm.runInContext("suspendTagFormDrafts.set(getSuspendTagFormDraftKey(draftRow), { 'req-spec': 'still typing' });", h.ctx);
  const first = h.ctx.runSuspendTagRowCommand('save', h.mirror, { dock_spec: 'first', dock_photo_link: 'new.jpg', dock_photo_name: 'new.jpg' });
  const second = h.ctx.runSuspendTagRowCommand('save', h.mirror, { dock_spec: 'second', dock_photo_link: '', dock_photo_name: '' });
  await new Promise(setImmediate);
  assert.equal(h.calls.length, 1);
  release();
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.deepEqual(h.calls.map(call => call.body.expectedVersion), [0, 1]);
  assert.equal(h.calls[1].body.payload.patch.dock_photo_link, 'new.jpg');
  assert.equal(h.mirror.REQ_SPEC, 'second');
  assert.equal(h.mirror.REQ_PHOTO_LINK, 'new.jpg');
  assert.equal(vm.runInContext("suspendTagFormDrafts.get(getSuspendTagFormDraftKey(draftRow))['req-spec']", h.ctx), 'still typing');
  assert.equal(reconciled, 2);
});

