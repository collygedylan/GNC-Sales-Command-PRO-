import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertInventoryReclassMoveReceiptMatchesCommand, createInventoryReclassMovesService, confirmedInventoryReclassMoveReceipt } from '../services/reclassMoves.ts';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const html = readComposedAppSource();

function extractAppFunction(name) {
  const marker = `function ${name}(`;
  let start = html.indexOf(marker);
  if (start > 0 && html.slice(start - 6, start) === 'async ') start -= 6;
  assert.ok(start >= 0, `${name} exists`);
  const open = html.indexOf(') {', start) + 2;
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`Unclosed function ${name}`);
}

function extractApplyReclassMoveFunction() {
  // These tests isolate the command/status state machine. Publication of the
  // optimistic row projection is exercised separately by the hydration tests.
  return `function publishOptimisticReclassRows() { return true; }\nfunction applyReclassSeasonStocks() { return true; }\n${extractAppFunction('applyArgosInventoryReclassMoveCommand')}`;
}

const source = { uniqueId: 'source-uid', identity: {
  unique_id: 'source-uid', itemcode: 'ITEM-1', contsize: '#3', locationcode: 'C.12.001',
  lotcode: '27.F1', season: 'F1', ptronhand: '50', ptravailable: '40',
} };
const sourceRow = { unique_id: 'source-uid', itemcode: 'ITEM-1', contsize: '#3', locationcode: 'C.12.001', lotcode: '27.F1', season: 'F1', ptronhand: '30', ptravailable: '20' };
const targetRow = { unique_id: 'server-target-uid', itemcode: 'ITEM-1', contsize: '#3', locationcode: 'C.12.001', lotcode: '27.U1', season: 'U1', ptronhand: '20', ptravailable: '20' };
const receipt = { ok: true, commandId: 'reclass-command-0001', requestId: 'request-1', revision: 42,
  rows: [{ table: 'ph_master_inventory', row: sourceRow }, { table: 'ph_master_inventory', row: targetRow }],
  movements: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 20, sourceUniqueId: 'source-uid', destinationUniqueId: 'server-target-uid' }],
  status: 'applied' };

test('Reclass move service submits a typed command and validates authoritative rows', async () => {
  const requests = [];
  const service = createInventoryReclassMovesService(async (payload, options) => { requests.push({ payload, options }); return { ok: true, data: receipt }; });
  const result = await service.submit({ commandId: 'reclass-command-0001', expectedRevision: 41,
    moves: [{ source, lines: [{ direction: 'move_up', destinationSeason: 'u1', quantity: 20 }] }] });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].payload.action, 'inventory_reclass_move');
  assert.equal(requests[0].payload.commandId, 'reclass-command-0001');
  assert.equal(requests[0].payload.expectedRevision, 41);
  assert.equal(requests[0].options.idempotencyKey, 'reclass-command-0001');
  assert.equal(result.rows[1].row.unique_id, 'server-target-uid', 'target ID comes from the server receipt');
});

test('receipt movement and row identities must match the submitted command', () => {
  const command = { commandId: 'reclass-command-bound-01', expectedRevision: 41,
    moves: [{ source, lines: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 20 }] }] };
  const boundReceipt = { ...receipt, commandId: command.commandId };
  assert.equal(assertInventoryReclassMoveReceiptMatchesCommand(confirmedInventoryReclassMoveReceipt(boundReceipt), command).requestId, 'request-1');
  assert.throws(() => assertInventoryReclassMoveReceiptMatchesCommand(confirmedInventoryReclassMoveReceipt({ ...boundReceipt,
    movements: [{ ...receipt.movements[0], quantity: 19 }] }), command), /MOVEMENTS_MISMATCH/);
  assert.throws(() => assertInventoryReclassMoveReceiptMatchesCommand(confirmedInventoryReclassMoveReceipt({ ...boundReceipt,
    rows: [receipt.rows[0], { table: 'ph_master_inventory', row: { ...targetRow, lotcode: '27.U2' } }] }), command), /DESTINATION_MISMATCH/);
  assert.throws(() => assertInventoryReclassMoveReceiptMatchesCommand(confirmedInventoryReclassMoveReceipt(receipt), command), /COMMAND_MISMATCH/);
});

test('confirmed source quantities accept the server-locked result without comparing the stale client snapshot', () => {
  const command = { commandId: 'reclass-command-quantity-01', expectedRevision: 41,
    moves: [{ source, lines: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 20 }] }] };
  const valid = confirmedInventoryReclassMoveReceipt({ ...receipt, commandId: command.commandId });
  assert.equal(assertInventoryReclassMoveReceiptMatchesCommand(valid, command).requestId, 'request-1');
  const wrongOnHand = confirmedInventoryReclassMoveReceipt({ ...receipt, commandId: command.commandId,
    rows: [{ ...receipt.rows[0], row: { ...sourceRow, ptronhand: '31' } }, receipt.rows[1]] });
  assert.equal(assertInventoryReclassMoveReceiptMatchesCommand(wrongOnHand, command).rows[0].row.ptronhand, '31',
    'server-locked stock is authoritative even when the client snapshot was stale');
  const malformedAvailable = confirmedInventoryReclassMoveReceipt({ ...receipt, commandId: command.commandId,
    rows: [{ ...receipt.rows[0], row: { ...sourceRow, ptravailable: '20x' } }, receipt.rows[1]] });
  assert.throws(() => assertInventoryReclassMoveReceiptMatchesCommand(malformedAvailable, command), /SOURCE_PTRAVAILABLE_MISMATCH/);
  const negativeAvailable = confirmedInventoryReclassMoveReceipt({ ...receipt, commandId: command.commandId,
    rows: [{ ...receipt.rows[0], row: { ...sourceRow, ptravailable: '-1' } }, receipt.rows[1]] });
  assert.throws(() => assertInventoryReclassMoveReceiptMatchesCommand(negativeAvailable, command), /SOURCE_PTRAVAILABLE_MISMATCH/);
});

test('receipt source resolves a stale UID through one normalized item/location/lot tuple', () => {
  const command = { commandId: 'reclass-command-stale-uid-01', expectedRevision: 41,
    moves: [{ source: { uniqueId: 'stale-source-uid', identity: { ...source.identity, unique_id: 'stale-source-uid',
      itemcode: 'item-1', locationcode: 'c.12.001', lotcode: '27.f1', ptronhand: '900', ptravailable: '700' } },
    lines: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 20 }] }] };
  const staleUidReceipt = { ...receipt, commandId: command.commandId,
    movements: [{ ...receipt.movements[0], sourceUniqueId: 'source-uid' }] };
  const matched = assertInventoryReclassMoveReceiptMatchesCommand(confirmedInventoryReclassMoveReceipt(staleUidReceipt), command);
  assert.equal(matched.rows[0].row.unique_id, 'source-uid');
  assert.equal(matched.rows[0].row.ptronhand, '30', 'server-locked current quantities are accepted');
});

test('stale UID fallback rejects an ambiguous normalized source tuple', () => {
  const command = { commandId: 'reclass-command-ambiguous-01', expectedRevision: 41,
    moves: [{ source: { uniqueId: 'stale-source-uid', identity: { ...source.identity, unique_id: 'stale-source-uid' } },
      lines: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 20 }] }] };
  const ambiguous = { ...receipt, commandId: command.commandId,
    rows: [...receipt.rows, { table: 'ph_master_inventory', row: { ...sourceRow, unique_id: 'source-duplicate' } }] };
  assert.throws(() => assertInventoryReclassMoveReceiptMatchesCommand(confirmedInventoryReclassMoveReceipt(ambiguous), command),
    /SOURCE_AMBIGUOUS/);
});

test('server-locked decimal quantities remain authoritative when the client snapshot differs', () => {
  const command = { commandId: 'reclass-command-decimal-scale-01', expectedRevision: 41,
    moves: [{ source: { uniqueId: 'source-uid', identity: { ...source.identity, ptronhand: '1,000.0', ptravailable: '1000.00' } },
      lines: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 610 }] }] };
  const mixedScaleReceipt = confirmedInventoryReclassMoveReceipt({ ...receipt, commandId: command.commandId,
    movements: [{ ...receipt.movements[0], quantity: 610 }],
    rows: [{ table: 'ph_master_inventory', row: { ...sourceRow, ptronhand: '390', ptravailable: '390.000' } }, receipt.rows[1]] });
  assert.equal(assertInventoryReclassMoveReceiptMatchesCommand(mixedScaleReceipt, command).requestId, 'request-1');
  const wrongScaleValue = confirmedInventoryReclassMoveReceipt({ ...receipt, commandId: command.commandId,
    movements: [{ ...receipt.movements[0], quantity: 610 }],
    rows: [{ table: 'ph_master_inventory', row: { ...sourceRow, ptronhand: '389.999', ptravailable: '390.000' } }, receipt.rows[1]] });
  assert.equal(assertInventoryReclassMoveReceiptMatchesCommand(wrongScaleValue, command).rows[0].row.ptronhand, '389.999');
});

test('unknown outcome retries can replay the exact same command and body', async () => {
  const requests = []; let attempt = 0;
  const service = createInventoryReclassMovesService(async (payload, options) => {
    requests.push({ payload: structuredClone(payload), options: { ...options } });
    if (++attempt === 1) throw Object.assign(new Error('network timeout'), { status: 0 });
    return { ok: true, data: { ...receipt, commandId: 'reclass-command-0002' } };
  });
  const command = { commandId: 'reclass-command-0002', expectedRevision: 41,
    moves: [{ source, lines: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 20 }] }] };
  await assert.rejects(service.submit(command), /network timeout/);
  await service.submit(command);
  assert.deepEqual(requests[1], requests[0]);
});

test('pending move commands persist before dispatch and remain isolated per account', async () => {
  const values = new Map();
  let owner = 'account-a'; let rejectApply;
  const dispatched = new Promise((_resolve, reject) => { rejectApply = reject; });
  const command = { commandId: 'reclass-command-owner-01', expectedRevision: 41,
    moves: [{ source, lines: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 20 }] }] };
  const ctx = { sessionStorage: { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    ARGOS_PENDING_INVENTORY_RECLASS_MOVE_KEY: 'pending-move',
    buildInventoryReclassMoveCommand: () => command,
    buildOptimisticInventoryReclassMoveModel: () => ({ model: { optimistic: true }, movedUids: ['source-uid'] }),
    renderArgosInventoryTransactionInquiryModel() {}, setArgosReclassMoveInputsLocked() {},
    getArgosReclassLiveEditIdentityKey: () => owner,
    getInventoryReclassMovesService: () => ({ submit: () => dispatched, status: async () => ({ status: 'missing' }) }),
    persistPendingArgosInventoryReclassMove: null, readPendingArgosInventoryReclassMove: null };
  vm.createContext(ctx);
  vm.runInContext(`${extractAppFunction('readPendingArgosInventoryReclassMove')}\n${extractAppFunction('persistPendingArgosInventoryReclassMove')}\n${extractApplyReclassMoveFunction()}`, ctx);
  const state = { inquiryModel: { original: true }, item: {}, snapshot: { uniqueId: 'source-uid' } };
  const inFlight = ctx.applyArgosInventoryReclassMoveCommand(state, {}, 'account-a');
  assert.equal(ctx.readPendingArgosInventoryReclassMove('account-a').command.commandId, command.commandId,
    'the original owner record exists before the request settles');
  owner = 'account-b';
  rejectApply(Object.assign(new Error('network timeout'), { status: 503 }));
  await assert.rejects(inFlight, /network timeout/);
  assert.equal(ctx.readPendingArgosInventoryReclassMove('account-a').command.commandId, command.commandId,
    'an account switch does not discard an unresolved command');
  const secondState = { pendingReclassMove: { command: { ...command, commandId: 'reclass-command-owner-02' }, movedUids: ['other-source'] },
    snapshot: { uniqueId: 'other-source' } };
  ctx.persistPendingArgosInventoryReclassMove(secondState, 'account-b');
  assert.equal(ctx.readPendingArgosInventoryReclassMove('account-a').command.commandId, command.commandId);
  assert.equal(ctx.readPendingArgosInventoryReclassMove('account-b').command.commandId, 'reclass-command-owner-02');
  ctx.persistPendingArgosInventoryReclassMove(null, 'account-a');
  assert.equal(ctx.readPendingArgosInventoryReclassMove('account-a'), null);
  assert.equal(ctx.readPendingArgosInventoryReclassMove('account-b').command.commandId, 'reclass-command-owner-02');
});

test('a malformed success receipt remains uncertain until status confirms the committed command', async () => {
  const command = { commandId: 'reclass-command-malformed-01', expectedRevision: 41,
    moves: [{ source, lines: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 20 }] }] };
  const committedReceipt = { ...receipt, commandId: command.commandId };
  const requests = [];
  const service = createInventoryReclassMovesService(async payload => {
    requests.push(payload);
    if (!payload.operation) return { ok: true, data: { ...committedReceipt,
      movements: [{ ...committedReceipt.movements[0], quantity: 19 }] } };
    return { ok: true, data: committedReceipt };
  });
  const applied = [];
  const ctx = { getInventoryReclassMovesService: () => service,
    buildInventoryReclassMoveCommand: () => command,
    buildOptimisticInventoryReclassMoveModel: () => ({ model: { optimistic: true }, movedUids: ['source-uid'] }),
    renderArgosInventoryTransactionInquiryModel() {}, setArgosReclassMoveInputsLocked() {},
    getArgosReclassLiveEditIdentityKey: () => 'actor', isInventoryStatusOutcomeUncertain: error => error.outcomeUncertain === true,
    getDatasetState: () => ({ liveVerifiedRevision: '41', liveVerifiedScope: 'scope', liveVerifiedPermission: 'perm' }),
    getProductionLiveSyncContext: () => ({ scope: 'scope', dataPermissionVersion: 'perm' }),
    applyArgosInventoryTransactionReturnedRow: row => { applied.push(row.unique_id); return row; },
    publishArgosInventoryTransactionReturnedRows() {},
    confirmedArgosReclassLiveEditRevisions: new Map(), invalidateArgosReclassLiveEditCaches() {},
    retireConfirmedArgosReclassMoveProposals() {}, persistPendingArgosInventoryReclassMove() {}, readPendingArgosInventoryReclassMove: () => null };
  vm.createContext(ctx);
  vm.runInContext(extractApplyReclassMoveFunction(), ctx);
  const state = { inquiryModel: { original: true }, item: {}, snapshot: { uniqueId: 'source-uid' } };
  await assert.rejects(ctx.applyArgosInventoryReclassMoveCommand(state, {}, 'actor'), error => error.inventoryMovePending === true);
  assert.equal(state.pendingReclassMove.uncertain, true);
  assert.deepEqual(state.inquiryModel, { optimistic: true });
  const result = await ctx.applyArgosInventoryReclassMoveCommand(state, {}, 'actor');
  assert.equal(result.receipt.requestId, 'request-1');
  assert.deepEqual(requests.map(item => item.operation || 'apply'), ['apply', 'status']);
  assert.deepEqual(applied, ['source-uid', 'server-target-uid']);
  assert.equal(state.pendingReclassMove, null);
});

test('pending and conflict command statuses are never accepted as confirmed inventory receipts', async () => {
  const pending = createInventoryReclassMovesService(async () => ({ ok: true, data: { ok: true, status: 'pending' } }));
  const conflict = createInventoryReclassMovesService(async () => ({ ok: true, data: { ok: true, status: 'conflict' } }));
  const command = { commandId: 'reclass-command-status-01', expectedRevision: 41,
    moves: [{ source, lines: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 20 }] }] };
  await assert.rejects(pending.submit(command), error => error.code === 'INVENTORY_RECLASS_OUTCOME_PENDING' && error.status === 503);
  await assert.rejects(conflict.submit(command), error => error.code === 'INVENTORY_RECLASS_CONFLICT' && error.status === 409);
});

test('optimistic inquiry rerender patches keyed cards in place and preserves drafts', async () => {
  const dom = new JSDOM('<div id="argos-reclass-item-inquiry"></div>');
  const ctx = { document: dom.window.document, renderArgosReclassInquiryEditor: () => '',
    getItemInquiryItemCode: row => String(row && row.itemcode || '') };
  ctx.hydrateArgosReclassRowCard = card => {
    const body = card.querySelector('[data-reclass-row-body]');
    body.innerHTML = '<input data-reclass-field="locationnote" value="new baseline"><span data-reclass-move-balance>Remaining -220</span>';
    body.setAttribute('data-reclass-row-hydrated', 'true');
    return true;
  };
  vm.createContext(ctx);
  vm.runInContext(`${extractAppFunction('reconcileArgosReclassCardDraftState')}
    ${extractAppFunction('findArgosReclassCardControl')}
    ${extractAppFunction('setArgosReclassAttributeIfChanged')}
    ${extractAppFunction('reconcileArgosReclassInquiryMarkup')}
    ${extractAppFunction('getArgosReclassRowRenderSignature')}
    ${extractAppFunction('getArgosReclassRowBodyId')}
    ${extractAppFunction('renderArgosInventoryTransactionInquiryModel')}`, ctx);

  const card = (uid, quantity, { expanded = false, hydrated = false, input = '', signature = 'stable',
    proposalSignature = 'proposal-stable', optimisticCommand = '' } = {}) =>
    `<section class="argos-reclass-row-card" data-reclass-row-card="${uid}" data-reclass-model-signature="${signature}" data-reclass-proposal-signature="${proposalSignature}" data-reclass-optimistic-command="${optimisticCommand}" data-reclass-row-expanded="${expanded}"><div class="argos-reclass-row-title"><button class="argos-reclass-row-toggle" aria-expanded="${expanded}" aria-controls="${ctx.getArgosReclassRowBodyId(uid)}">Toggle</button><span class="quantity">OH ${quantity}</span></div><div id="${ctx.getArgosReclassRowBodyId(uid)}" data-reclass-row-body="${uid}" data-reclass-row-hydrated="${hydrated}">${input}</div><details><summary>Details</summary></details></section>`;
  const stableMarkup = card('stable-uid', 25, { input: '<input value="stable baseline">' });
  const sourceMarkup = card('source-uid', 100, { expanded: false, hydrated: false, signature: 'source-before' });
  const initialMarkup = `<div class="argos-reclass-inquiry-heading">Rows 2</div><div class="argos-reclass-row-list">${stableMarkup}${sourceMarkup}</div>`;
  const host = ctx.document.getElementById('argos-reclass-item-inquiry');
  ctx.argosInventoryTransactionState = { pendingReclassMove: { command: { commandId: 'command-1' } } };
  host.innerHTML = initialMarkup;
  const stableNode = host.querySelector('[data-reclass-row-card="stable-uid"]');
  const rowList = host.querySelector('.argos-reclass-row-list');
  const stableInput = stableNode.querySelector('input');
  stableInput.value = 'stable draft';

  const sourceNode = host.querySelector('[data-reclass-row-card="source-uid"]');
  sourceNode.setAttribute('data-reclass-row-expanded', 'true');
  sourceNode.querySelector('.argos-reclass-row-toggle').setAttribute('aria-expanded', 'true');
  const sourceBody = sourceNode.querySelector('[data-reclass-row-body]');
  sourceBody.setAttribute('data-reclass-row-hydrated', 'true');
  sourceBody.innerHTML = '<input data-reclass-field="locationnote" value="original"><span data-reclass-move-balance>Remaining 390</span>';
  const sourceBodyNode = sourceBody;
  sourceNode.querySelector('details').open = true;
  const draftInput = sourceBody.querySelector('input');
  draftInput.value = 'unsaved field draft';
  draftInput.focus();
  draftInput.setSelectionRange(2, 8);
  const mutationRecords = [];
  const observer = new dom.window.MutationObserver(records => mutationRecords.push(...records));
  observer.observe(host, { childList: true, subtree: true });

  let rendered = `<div class="argos-reclass-inquiry-heading">Rows 3</div><div class="argos-reclass-row-list">${stableMarkup}${card('source-uid', 390, {
    signature: 'source-after', proposalSignature: 'proposal-stable', optimisticCommand: 'command-1' })}${card('target-uid', 610, { optimisticCommand: 'command-1' })}</div>`;
  ctx.renderArgosReclassInquiryEditor = () => rendered;
  const state = { inquiryModel: { locationRows: [{ unique_id: 'stable-uid' }, { unique_id: 'source-uid' }, { unique_id: 'target-uid' }] }, snapshot: { uniqueId: 'source-uid' } };
  assert.equal(ctx.renderArgosInventoryTransactionInquiryModel(state), true);

  assert.equal(host.querySelector('[data-reclass-row-card="stable-uid"]'), stableNode,
    'an unchanged keyed card and its controls keep their node identity');
  assert.equal(stableNode.querySelector('input'), stableInput);
  const updatedSource = host.querySelector('[data-reclass-row-card="source-uid"]');
  assert.equal(updatedSource, sourceNode, 'changed model rows keep their stable card container attached');
  assert.equal(updatedSource.querySelector('.quantity').textContent, 'OH 390');
  assert.equal(updatedSource.getAttribute('data-reclass-row-expanded'), 'true');
  assert.equal(updatedSource.querySelector('[data-reclass-row-body]').getAttribute('data-reclass-row-hydrated'), 'true');
  assert.equal(updatedSource.querySelector('[data-reclass-row-body]'), sourceBodyNode,
    'a quantity-only optimistic change keeps the locked hydrated editor body intact');
  assert.equal(updatedSource.querySelector('[data-reclass-move-balance]').textContent, 'Remaining 390',
    'pending move quantities do not become a misleading negative balance after optimistic subtraction');
  assert.equal(updatedSource.querySelector('details').open, true, 'expanded detail sections remain open');
  const restoredDraft = updatedSource.querySelector('[data-reclass-field="locationnote"]');
  assert.equal(restoredDraft.value, 'unsaved field draft');
  assert.equal(dom.window.document.activeElement, restoredDraft, 'focus follows the changed card control');
  assert.deepEqual([restoredDraft.selectionStart, restoredDraft.selectionEnd], [2, 8]);
  assert.equal(host.querySelector('[data-reclass-row-card="target-uid"] .quantity').textContent, 'OH 610');
  const quantityUpdateRemovals = observer.takeRecords().flatMap(record => Array.from(record.removedNodes));
  for (const node of [rowList, stableNode, sourceNode, sourceBodyNode]) {
    assert.equal(quantityUpdateRemovals.includes(node), false,
      'a quantity-only update never detaches the list, existing cards, or pending editor');
  }
  const sourceBodyId = sourceNode.querySelector('[data-reclass-row-body]').id;
  rendered = `<div class="argos-reclass-inquiry-heading">Rows 3</div><div class="argos-reclass-row-list">${card('target-uid', 610, { optimisticCommand: 'command-1' })}${card('source-uid', 390, {
    signature: 'source-hidden-field-updated', proposalSignature: 'proposal-changed', optimisticCommand: 'command-1' })}${stableMarkup}</div>`;
  ctx.renderArgosInventoryTransactionInquiryModel(state);
  assert.deepEqual(Array.from(rowList.querySelectorAll('[data-reclass-row-card]')).map(node => node.getAttribute('data-reclass-row-card')),
    ['target-uid', 'source-uid', 'stable-uid'], 'keyed cards follow the refreshed model order');
  assert.equal(sourceNode.querySelector('[data-reclass-row-body]').id, sourceBodyId, 'reordering does not alter a keyed row body id');
  const bodyIds = Array.from(rowList.querySelectorAll('[data-reclass-row-body]')).map(node => node.id);
  assert.equal(new Set(bodyIds).size, bodyIds.length, 'new and reordered rows keep unique body ids');
  rowList.querySelectorAll('[data-reclass-row-card]').forEach(cardNode => {
    assert.equal(cardNode.querySelector('.argos-reclass-row-toggle').getAttribute('aria-controls'), cardNode.querySelector('[data-reclass-row-body]').id,
      'each disclosure continues to target its own row body');
  });
  assert.notEqual(ctx.getArgosReclassRowBodyId('row/one'), ctx.getArgosReclassRowBodyId('row%2Fone'),
    'encoded source IDs cannot collide');

  const optimisticSource = updatedSource;
  rendered = `<div class="argos-reclass-inquiry-heading">Rows 3</div><div class="argos-reclass-row-list">${stableMarkup}${card('source-uid', 390, {
    signature: 'source-hidden-field-updated', proposalSignature: 'proposal-changed', optimisticCommand: 'command-1' })}${card('target-uid', 610, { optimisticCommand: 'command-1' })}</div>`;
  ctx.renderArgosInventoryTransactionInquiryModel(state);
  const hiddenFieldUpdatedSource = host.querySelector('[data-reclass-row-card="source-uid"]');
  assert.equal(hiddenFieldUpdatedSource, optimisticSource,
    'the model signature refreshes a hydrated row in place even when visible quantity text is unchanged');
  assert.equal(hiddenFieldUpdatedSource.querySelector('[data-reclass-field="locationnote"]').value, 'unsaved field draft');

  const previousCommandBody = sourceNode.querySelector('[data-reclass-row-body]');
  rendered = `<div class="argos-reclass-inquiry-heading">Rows 3</div><div class="argos-reclass-row-list">${stableMarkup}${card('source-uid', 390, {
    signature: 'source-other-command', proposalSignature: 'proposal-changed', optimisticCommand: 'command-2' })}${card('target-uid', 610)}</div>`;
  ctx.renderArgosInventoryTransactionInquiryModel(state);
  assert.notEqual(sourceNode.querySelector('[data-reclass-row-body]'), previousCommandBody,
    'a marker belonging to a different command cannot retain the previous pending editor');
  const pendingBody = sourceNode.querySelector('[data-reclass-row-body]');
  rendered = `<div class="argos-reclass-inquiry-heading">Rows 3</div><div class="argos-reclass-row-list">${stableMarkup}${card('source-uid', 390, {
    signature: 'source-canonical', proposalSignature: 'proposal-changed' })}${card('target-uid', 610)}</div>`;
  ctx.renderArgosInventoryTransactionInquiryModel(state);
  assert.notEqual(sourceNode.querySelector('[data-reclass-row-body]'), pendingBody,
    'a canonical receipt refreshes the body even before the pending state is retired');

  rendered = `<div class="argos-reclass-inquiry-heading">Rows 2</div><div class="argos-reclass-row-list">${stableMarkup}${card('source-uid', 100, { signature: 'source-rollback' })}</div>`;
  assert.equal(ctx.renderArgosInventoryTransactionInquiryModel(state), true, 'rollback rerenders the authoritative original model');
  assert.equal(host.querySelector('[data-reclass-row-card="stable-uid"]'), stableNode);
  assert.equal(host.querySelector('.argos-reclass-row-list'), rowList, 'the live row-list container is never detached');
  await new Promise(resolve => setTimeout(resolve, 0));
  observer.disconnect();
  const removedNodes = mutationRecords.flatMap(record => Array.from(record.removedNodes));
  assert.equal(removedNodes.includes(rowList), false, 'reconciliation never removes or reattaches the live list');
  // Explicit model reordering moves existing nodes with insertBefore. MutationObserver
  // reports that move as a removal; node identity (checked above) must still survive.
  assert.equal(host.querySelector('[data-reclass-row-card="source-uid"]'), sourceNode);
  assert.equal(host.querySelector('[data-reclass-row-card="source-uid"] .quantity').textContent, 'OH 100');
  assert.equal(host.querySelector('[data-reclass-row-card="target-uid"]'), null, 'the optimistic target is removed on rollback');
  assert.equal(host.querySelector('[data-reclass-row-card="source-uid"] [data-reclass-field="locationnote"]').value, 'unsaved field draft');
  assert.notEqual(ctx.getArgosReclassRowRenderSignature({ unique_id: 'source-uid', values: { ptronhand: '390', ptravailable: '390' }, sourceRow: { itemcode: 'ITEM-1' } }),
    ctx.getArgosReclassRowRenderSignature({ unique_id: 'source-uid', values: { ptronhand: '390', ptravailable: '389' }, sourceRow: { itemcode: 'ITEM-1' } }),
    'render signatures cover model values beyond the visible quantity chips');
  dom.window.close();
});

test('editing actions before the 610-unit preview retains the pending body with a current proposal signature', () => {
  const dom = new JSDOM('<div id="argos-reclass-item-inquiry"></div>');
  const rules = { priority_change: { kind: 'priority', label: 'Priority Change' }, move_up: { kind: 'move', label: 'Move Up' } };
  const physical = { unique_id: 'source-uid', itemcode: 'ITEM-1', locationcode: 'A.01.001', lotcode: '27.F1',
    season: 'F1', ptronhand: '1000', ptravailable: '1000', s_lts: '1000', priority: '2' };
  const model = rows => ({ rows, locationRows: rows.map(row => ({ unique_id: row.unique_id, values: { ...row }, sourceRow: row })) });
  const state = { item: physical, snapshot: { uniqueId: physical.unique_id }, inquiryModel: model([physical]) };
  const ctx = { document: dom.window.document, window: dom.window, Map,
    argosInventoryTransactionState: state,
    argosReclassMultiActionState: { rowProposals: new Map(), rowResolutions: new Map(), holdStopProposals: {} },
    argosReclassRowEditorEntries: new Map(), RECLASS_ACTION_WORKFLOW_V2_ENABLED: true,
    RECLASS_ACTION_WORKFLOW_V3_ENABLED: true, RECLASS_ACTION_WORKFLOW_V3_HOLD_ACTIONS: [],
    RECLASS_ACTION_WORKFLOW_V5_ORDER: Object.keys(rules), RECLASS_ACTION_WORKFLOW_V2_SEASONS: ['F1', 'U1'],
    ARGOS_INVENTORY_TRANSACTION_REQUEST_LABELS: {}, isArgosReclassMobileEditorViewport: () => false,
    canCurrentUserSubmitRepInventoryOperations: () => false, getReclassActionWorkflowV5Config: action => rules[action],
    getReclassActionWorkflowV2Config: action => rules[action], getArgosReclassTemporaryOverlay: () => null,
    getArgosReclassScopeSettings: () => ({ season: 'F1', salesYear: 2027 }),
    getEvalWorkInquiryRowResolution: () => '', renderArgosReclassInventoryFields: () => '',
    getArgosReclassRowCurrentSeason: entry => entry.values.season,
    getItemInquiryItemCode: row => row?.itemcode || '', buildItemInquiryViewModel: (_item, rows) => model(rows),
    parseAppNumber: value => value == null ? null : Number(value),
    firstNonEmptyValue: (...values) => values.find(value => value !== undefined && value !== null && String(value).trim() !== ''),
    generateArgosInventoryTransactionId: () => 'draft-id', captureEvalWorkLocalDraftSoon() {},
    escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'),
  };
  vm.createContext(ctx);
  for (const name of ['getArgosReclassRowProposalMap', 'getArgosReclassV3Proposal', 'getArgosReclassV3HoldProposal',
    'cloneArgosReclassProposal', 'getArgosReclassLotOpenStock', 'getArgosReclassLotKey', 'getArgosReclassMoveUpLotState', 'getArgosReclassMoveBalance', 'getArgosReclassMoveBalanceText',
    'markArgosReclassProposalEdited', 'getArgosReclassV3ScopeActionsForEntry', 'getArgosReclassV3ActionCountForEntry',
    'refreshArgosReclassMultiActionUi', 'toggleArgosReclassV3Action', 'handleArgosReclassV3ProposalInput',
    'buildArgosReclassV3ProposalHtml', 'isArgosReclassLocationDetailsOpen', 'buildArgosReclassActionFieldsHtml',
    'buildArgosReclassRowFieldsHtml', 'getArgosReclassRowEditorEntry', 'renderArgosReclassHoldScopeNotice',
    'getArgosReclassRowRenderSignature', 'getArgosReclassProposalRenderSignature', 'getArgosReclassRowBodyId',
    'setArgosReclassAttributeIfChanged', 'renderArgosReclassInquiryEditor', 'reconcileArgosReclassCardDraftState',
    'findArgosReclassCardControl', 'reconcileArgosReclassInquiryMarkup', 'renderArgosInventoryTransactionInquiryModel',
    'reclassStockSeason', 'buildOptimisticInventoryReclassMoveModel', 'setArgosReclassMoveInputsLocked']) {
    vm.runInContext(extractAppFunction(name), ctx);
  }
  try {
    ctx.renderArgosInventoryTransactionInquiryModel(state);
    const host = ctx.document.getElementById('argos-reclass-item-inquiry');
    const card = host.querySelector('[data-reclass-row-card="source-uid"]');
    const initialSignature = card.getAttribute('data-reclass-proposal-signature');
    const edit = (action, field, value) => {
      const input = card.querySelector(`[data-reclass-v3-proposal-action="${action}"][data-reclass-v3-proposal-field="${field}"]`);
      input.value = value;
      ctx.handleArgosReclassV3ProposalInput(input);
      assert.equal(card.getAttribute('data-reclass-proposal-signature'), ctx.getArgosReclassProposalRenderSignature('source-uid', ''),
        'input edits refresh the signature from the actual proposal state');
    };
    ctx.toggleArgosReclassV3Action(card.querySelector('[data-reclass-v3-action="priority_change"]'), 'priority_change');
    assert.notEqual(card.getAttribute('data-reclass-proposal-signature'), initialSignature);
    edit('priority_change', 'priority', '1');
    ctx.toggleArgosReclassV3Action(card.querySelector('[data-reclass-v3-action="move_up"]'), 'move_up');
    assert.equal(card.getAttribute('data-reclass-proposal-signature'), ctx.getArgosReclassProposalRenderSignature('source-uid', ''));
    edit('move_up', 'quantity', '610');
    edit('move_up', 'destinationSeason', 'U1');
    const pendingBody = card.querySelector('[data-reclass-row-body]');
    const quantityInput = pendingBody.querySelector('[data-reclass-v3-proposal-field="quantity"]');
    const balance = pendingBody.querySelector('[data-reclass-move-balance]').textContent;
    assert.match(balance, /On Hand: 1000.*Open Stock \(Max Move Up\): 1000.*Requested \(Up\): 610.*Remaining Move Up: 390/);

    const command = { commandId: 'command-610', moves: [{ source: { uniqueId: 'source-uid' },
      lines: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 610 }] }] };
    const preview = ctx.buildOptimisticInventoryReclassMoveModel(state, command);
    state.pendingReclassMove = { command };
    state.inquiryModel = preview.model;
    ctx.renderArgosInventoryTransactionInquiryModel(state);
    ctx.setArgosReclassMoveInputsLocked(true);
    assert.equal(card.querySelector('[data-reclass-row-body]'), pendingBody, 'real edits do not cause an optimistic body replacement');
    assert.equal(card.querySelector('[data-reclass-v3-proposal-field="quantity"]'), quantityInput);
    assert.equal(quantityInput.disabled, true);
    assert.equal(quantityInput.value, '610');
    assert.equal(pendingBody.querySelector('[data-reclass-move-balance]').textContent, balance);
    assert.match(card.querySelector('.argos-reclass-row-toggle-meta').textContent, /OH 390.*AVL 390/);
    assert.equal(ctx.getArgosReclassV3Proposal('source-uid', 'priority_change').priority, '1');

    // A canonical receipt must refresh the retained body even while pending
    // still exists; only its committed movement proposal is retired.
    delete ctx.getArgosReclassRowProposalMap('source-uid').move_up;
    state.inquiryModel = model(preview.model.rows.map(row => { const copy = { ...row }; delete copy.__optimisticReclassMove; return copy; }));
    ctx.renderArgosInventoryTransactionInquiryModel(state);
    assert.notEqual(card.querySelector('[data-reclass-row-body]'), pendingBody);
    assert.equal(card.querySelector('[data-reclass-move-action="move_up"]'), null);
    assert.equal(card.querySelector('[data-reclass-v3-proposal-field="priority"]').value, '1');
  } finally { dom.window.close(); }
});

test('committed receipts remain confirmed when upstream import reconciliation is pending or conflicted', async () => {
  for (const importStatus of ['pending', 'conflict']) {
    const committed = { ...receipt, commandId: `reclass-command-import-${importStatus}`, importStatus,
      movements: [{ ...receipt.movements[0], status: importStatus }] };
    const service = createInventoryReclassMovesService(async () => ({ ok: true, data: committed }));
    const result = await service.submit({ commandId: `reclass-command-import-${importStatus}`, expectedRevision: 41,
      moves: [{ source, lines: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 20 }] }] });
    assert.equal(result.status, 'applied');
    assert.equal(result.importStatus, importStatus);
    assert.equal(result.movements[0].status, importStatus);
  }
});

test('Reclass move status distinguishes missing, pending, acknowledged, and malformed receipts', async () => {
  const response = { ok: true, data: { ...receipt, commandId: 'reclass-command-0005', status: 'applied', importStatus: 'conflict', movements: [{ ...receipt.movements[0], status: 'conflict' }] } };
  const service = createInventoryReclassMovesService(async (payload) => {
    if (payload.commandId === 'reclass-command-0003') return { ok: true, data: { ok: true, status: 'missing', requestId: null, movements: [] } };
    if (payload.commandId === 'reclass-command-0004') return { ok: true, data: { ok: true, status: 'pending' } };
    return response;
  });
  assert.deepEqual(await service.status('reclass-command-0003'), { status: 'missing' });
  assert.deepEqual(await service.status('reclass-command-0004'), { status: 'pending' });
  const committed = await service.status('reclass-command-0005', { commandId: 'reclass-command-0005', expectedRevision: 41,
    moves: [{ source, lines: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 20 }] }] });
  assert.equal(committed.status, 'applied');
  assert.equal(committed.receipt.importStatus, 'conflict');
  assert.equal(committed.receipt.rows[1].row.unique_id, 'server-target-uid');
  assert.throws(() => confirmedInventoryReclassMoveReceipt({ ...receipt, rows: [{ table: 'other', row: targetRow }] }), /RECEIPT/);
  const malformedStatus = createInventoryReclassMovesService(async () => ({ ok: true, data: { ...response.data,
    movements: [{ ...response.data.movements[0], quantity: 19 }] } }));
  await assert.rejects(malformedStatus.status('reclass-command-0005', { commandId: 'reclass-command-0005', expectedRevision: 41,
    moves: [{ source, lines: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 20 }] }] }),
  error => error.outcomeUncertain === true);
});

test('Reclass UI builds source-bound split movement commands at the current verified revision', () => {
  const entry = { unique_id: 'source-uid', sourceRow: { unique_id: 'source-uid', itemcode: 'ITEM-1', contsize: '#3', s_lts: '40',
    locationcode: 'C.12.001', lotcode: '27.F1', season: 'F1', ptronhand: '50', ptravailable: '40',
    __reclassIdentityRaw: { unique_id: 'source-uid', itemcode: 'ITEM-1', contsize: '#3', locationcode: 'C.12.001', lotcode: '27.F1', season: 'F1', ptronhand: '50.00', ptravailable: null } } };
  const ctx = { getDatasetState: () => ({ liveVerifiedRevision: '41', liveVerifiedScope: 'scope', liveVerifiedPermission: 'perm' }),
    getProductionLiveSyncContext: () => ({ scope: 'scope', dataPermissionVersion: 'perm' }), canUseProductionLiveSync: () => true,
    isConfirmedInventoryReadRevisionCurrent: () => true, getArgosReclassLiveEditIdentityKey: () => 'actor',
    readPendingArgosInventoryReclassMove: () => null,
    generateArgosInventoryTransactionId: () => 'inventory_reclass_move_abc123' };
  vm.createContext(ctx);
  vm.runInContext(extractAppFunction('buildInventoryReclassMoveCommand'), ctx);
  const command = ctx.buildInventoryReclassMoveCommand({ rowOverlays: [{ unique_id: 'source-uid', proposals: [
    { action: 'move_up', splits: [{ destinationSeason: 'U1', quantity: 12 }, { destinationSeason: 'U2', quantity: 8 }] }
  ] }] }, { inquiryModel: { locationRows: [entry] } });
  assert.equal(command.expectedRevision, null, 'a global cache never gates or supplies proof for an unrelated displayed draft');
  assert.equal(command.moves[0].source.identity.ptronhand, '50.00', 'live identity uses the untouched row values');
  assert.equal(command.moves[0].source.identity.ptravailable, null);
  assert.deepEqual(JSON.parse(JSON.stringify(command.moves[0].lines)), [
    { direction: 'move_up', destinationSeason: 'U1', quantity: 12 },
    { direction: 'move_up', destinationSeason: 'U2', quantity: 8 },
  ]);
});

test('Reclass Move Up enforces the 253 Open Stock cap per row and across the full 27.S1 lot', () => {
  const row = (unique_id, locationcode, ptronhand) => ({ unique_id, itemcode: '004103.010.1', contsize: '#1',
    locationcode, lotcode: '27.S1', season: 'S1', ptronhand: String(ptronhand), ptravailable: String(ptronhand), s_lts: '253' });
  const entries = [row('f16', 'F.16.000', 175), row('c15', 'C.15.000', 532)]
    .map(sourceRow => ({ unique_id: sourceRow.unique_id, sourceRow }));
  const ctx = { canUseProductionLiveSync: () => true, getArgosReclassLiveEditIdentityKey: () => 'actor',
    readPendingArgosInventoryReclassMove: () => null, generateArgosInventoryTransactionId: () => 'move-253' };
  vm.createContext(ctx);
  vm.runInContext(extractAppFunction('buildInventoryReclassMoveCommand'), ctx);
  const state = { inquiryModel: { locationRows: entries } };
  const overlay = (unique_id, quantity) => ({ unique_id, proposals: [
    { action: 'move_up', splits: [{ destinationSeason: 'F1', quantity }] }
  ] });
  const allowed = ctx.buildInventoryReclassMoveCommand({ rowOverlays: [overlay('f16', 175), overlay('c15', 78)] }, state);
  assert.equal(allowed.moves.flatMap(move => move.lines).reduce((sum, line) => sum + line.quantity, 0), 253);
  assert.throws(() => ctx.buildInventoryReclassMoveCommand({ rowOverlays: [overlay('c15', 254)] }, state),
    /Cannot Move Up more than Open Stock \(253\) for lot 27\.S1/);
  assert.throws(() => ctx.buildInventoryReclassMoveCommand({ rowOverlays: [overlay('f16', 175), overlay('c15', 79)] }, state),
    /Cannot Move Up more than Open Stock \(253\) for lot 27\.S1/);
});

test('Item Inquiry can paint a complete warm snapshot immediately while live refresh continues separately', () => {
  const row = { UNIQUE_ID: 'source-uid', unique_id: 'source-uid', ITEMCODE: 'ITEM-1', itemcode: 'ITEM-1',
    PTRONHAND: '50', ptronhand: '50', PTRAVAILABLE: '40', ptravailable: '40' };
  const state = { rowCompleteness: 'complete', initialLoaded: true, fullLoaded: true, fieldCoverage: 'full',
    liveVerifiedScope: 'context-scope-a', liveVerifiedPermission: 'perm-7', liveVerifiedRevision: '41' };
  const ctx = {
    getDatasetState: () => state,
    getProductionLiveSyncContext: () => ({ scope: 'context-scope-a', dataPermissionVersion: 'perm-7' }),
    getSupabaseReadIdentityScope: () => 'read-owner-a',
    getArgosReclassLiveEditIdentityKey: () => 'profile-a/admin/login-a',
    getItemInquiryItemCode: () => 'ITEM-1',
    getItemInquiryRows: () => [row],
    masterInventoryByItemCode: new Map([['ITEM-1', [row]]]),
    getItemInquiryRowKey: value => value.unique_id,
    isConfirmedInventoryReadRevisionCurrent: () => true,
    isRequestLikeItem: () => false, isDockLikeItem: () => false, isSalesOfficeLikeItem: () => false,
    compareItemInquiryRows: () => 0
  };
  vm.createContext(ctx);
  vm.runInContext(`${extractAppFunction('getArgosReclassSourceRowsSignature')}\n${extractAppFunction('getVerifiedCachedArgosItemInquiryGroup')}`, ctx);
  const group = ctx.getVerifiedCachedArgosItemInquiryGroup(row);
  assert.equal(group.row, row);
  assert.deepEqual(Array.from(group.rows), [row]);
  assert.equal(group.scope, 'context-scope-a', 'refresh fences use the coordinator scope stored with the verified revision');
  assert.equal(group.readScope, 'read-owner-a', 'read identity scope remains a distinct cache ownership domain');
  assert.equal(group.revision, '41');
  state.fieldCoverage = 'browse';
  state.fullLoaded = false;
  assert.equal(ctx.getVerifiedCachedArgosItemInquiryGroup(row), null,
    'a complete row set with browse-only fields cannot bypass full detail hydration');
  state.fieldCoverage = 'full';
  state.fullLoaded = true;
  state.liveVerifiedScope = 'context-scope-other';
  assert.equal(ctx.getVerifiedCachedArgosItemInquiryGroup(row), null,
    'a snapshot from a different live coordinator scope cannot warm the modal');
  state.liveVerifiedScope = 'context-scope-a';
  state.liveVerifiedPermission = 'perm-old';
  assert.equal(ctx.getVerifiedCachedArgosItemInquiryGroup(row), null,
    'a snapshot from a prior permission version cannot warm the modal');
  state.liveVerifiedPermission = 'perm-7';
  ctx.getSupabaseReadIdentityScope = () => '';
  assert.equal(ctx.getVerifiedCachedArgosItemInquiryGroup(row), null,
    'an absent read-owner identity cannot warm the modal even when the coordinator scope matches');
});

test('silent warm refresh leaves edits, pending moves, and focused controls intact and skips unchanged rows', () => {
  const control = { id: 'quantity', value: '0' };
  const modal = { querySelectorAll: () => [control] };
  const inquiryEl = { contains: () => false };
  const overlayMap = new Map();
  let actionCount = 0;
  const ctx = { Map, document: { activeElement: null }, getArgosReclassV3HoldProposal: () => null,
    getArgosReclassV3ActionCountForEntry: () => actionCount, getArgosReclassTemporaryOverlayMap: () => overlayMap };
  vm.createContext(ctx);
  vm.runInContext(`${extractAppFunction('captureArgosInventoryTransactionDraftBaseline')}\n${extractAppFunction('hasUnsavedArgosInventoryTransactionDraft')}\n${extractAppFunction('getArgosItemInquiryRenderSignature')}\n${extractAppFunction('shouldApplyArgosItemInquiryRefresh')}`, ctx);
  const model = { locationRows: [{ unique_id: 'source-uid', values: { ptronhand: '50' } }] };
  const state = { inquiryModel: model, draftBaseline: ctx.captureArgosInventoryTransactionDraftBaseline(modal) };
  assert.equal(ctx.shouldApplyArgosItemInquiryRefresh(state, modal, inquiryEl, model), false,
    'an unchanged payload does not replace modal DOM');
  const changedModel = { locationRows: [{ unique_id: 'source-uid', values: { ptronhand: '49' } }] };
  assert.equal(ctx.shouldApplyArgosItemInquiryRefresh({ ...state, submitting: true }, modal, inquiryEl, changedModel), false,
    'background hydration never replaces a submitting worksheet');
  assert.equal(ctx.shouldApplyArgosItemInquiryRefresh({ ...state, pendingReclassMove: { uncertain: true } }, modal, inquiryEl, changedModel), false,
    'a pending recovered move remains fenced');
  control.value = '5';
  assert.equal(ctx.shouldApplyArgosItemInquiryRefresh(state, modal, inquiryEl, changedModel), false,
    'unsaved core fields remain untouched');
  control.value = '0';
  actionCount = 1;
  assert.equal(ctx.shouldApplyArgosItemInquiryRefresh(state, modal, inquiryEl, changedModel), false,
    'unsaved row actions remain untouched');
  actionCount = 0;
  overlayMap.set('source-uid', { temporaryChangedFields: ['locationnote'] });
  assert.equal(ctx.shouldApplyArgosItemInquiryRefresh(state, modal, inquiryEl, changedModel), false,
    'unsaved live inventory field edits remain untouched');
  overlayMap.clear();
  ctx.document.activeElement = {};
  inquiryEl.contains = element => element === ctx.document.activeElement;
  assert.equal(ctx.shouldApplyArgosItemInquiryRefresh(state, modal, inquiryEl, changedModel), false,
    'refresh does not steal focus while the user is interacting');
  ctx.document.activeElement = null;
  inquiryEl.contains = () => false;
  assert.equal(ctx.shouldApplyArgosItemInquiryRefresh(state, modal, inquiryEl, changedModel), true);
});

test('Reclass UI blocks batches whose selected sources resolve to the same destination lineage', () => {
  const entry = uid => ({ unique_id: uid, sourceRow: { unique_id: uid, warehouseid: 'W1', itemcode: 'ITEM-1', contsize: '#3',
    locationcode: 'C.12.001', lotcode: '27.F1', season: 'F1', ptronhand: '50', ptravailable: '40', s_lts: '50' } });
  const first = entry('source-one'); const second = entry('source-two');
  const ctx = { getDatasetState: () => ({ liveVerifiedRevision: '41', liveVerifiedScope: 'scope', liveVerifiedPermission: 'perm' }),
    getProductionLiveSyncContext: () => ({ scope: 'scope', dataPermissionVersion: 'perm' }), canUseProductionLiveSync: () => true,
    isConfirmedInventoryReadRevisionCurrent: () => true, getArgosReclassLiveEditIdentityKey: () => 'actor',
    readPendingArgosInventoryReclassMove: () => null, generateArgosInventoryTransactionId: () => 'inventory_reclass_move_overlap' };
  vm.createContext(ctx);
  vm.runInContext(extractAppFunction('buildInventoryReclassMoveCommand'), ctx);
  assert.throws(() => ctx.buildInventoryReclassMoveCommand({ rowOverlays: ['source-one', 'source-two'].map(unique_id => ({ unique_id,
    proposals: [{ action: 'move_up', splits: [{ destinationSeason: 'U1', quantity: 5 }] }] })) },
  { inquiryModel: { locationRows: [first, second] } }), /same inventory row/);
});

test('after a confirmed move the UI payload retires only move proposals', () => {
  const ctx = { RECLASS_ACTION_WORKFLOW_V5_ORDER: ['hold', 'take_off_hold', 'stop_ship', 'off_stop_ship', 'recount', 'priority_change', 'move_up', 'move_down', 'sheared'] };
  vm.createContext(ctx);
  vm.runInContext(extractAppFunction('removeConfirmedMoveProposalsFromInquiryPayload'), ctx);
  const payload = { transaction: { requestActions: ['move_up', 'priority_change'], holdStopProposals: [{ action: 'hold' }] },
    rowOverlays: [{ unique_id: 'source-uid', proposals: [{ action: 'move_up' }, { action: 'priority_change' }],
      fieldEdits: [{ field: 'locationnote' }] }] };
  const updated = ctx.removeConfirmedMoveProposalsFromInquiryPayload(payload);
  assert.deepEqual(updated.rowOverlays[0].proposals.map((item) => item.action), ['priority_change']);
  assert.deepEqual(updated.transaction.requestActions, ['hold', 'priority_change', 'inventory_fields']);
  assert.deepEqual(payload.rowOverlays[0].proposals.map((item) => item.action), ['move_up', 'priority_change'], 'source draft payload is not mutated');
});

test('optimistic move worksheet subtracts source stock and uses a temporary target identity', () => {
  const sourceRow = { ...source.identity, UNIQUE_ID: 'source-uid', ITEMCODE: 'ITEM-1', CONTSIZE: '#3', LOCATIONCODE: 'C.12.001',
    LOTCODE: '27.F1', SEASON: 'F1', PTRONHAND: '50', PTRAVAILABLE: '40' };
  const ctx = { parseAppNumber: value => value == null || value === '' ? null : Number(String(value).replace(/,/g, '')),
    buildItemInquiryViewModel: (_item, rows) => ({ rows, locationRows: rows.map(row => ({ unique_id: row.UNIQUE_ID, sourceRow: row, values: row })) }) };
  vm.createContext(ctx);
  vm.runInContext(`${extractAppFunction('reclassStockSeason')}\n${extractAppFunction('buildOptimisticInventoryReclassMoveModel')}`, ctx);
  const result = ctx.buildOptimisticInventoryReclassMoveModel({ item: {}, inquiryModel: { rows: [sourceRow] } }, {
    commandId: 'reclass-command-0007', moves: [{ source: { uniqueId: 'source-uid' }, lines: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 20 }] }]
  });
  assert.equal(result.model.rows[0].ptronhand, '30');
  assert.equal(result.model.rows[0].ptravailable, '20');
  assert.equal(result.model.rows[1].lotcode, '27.U1');
  assert.equal(result.model.rows[1].ptronhand, '20');
  assert.match(result.model.rows[1].unique_id, /^pending-reclass-/);
  assert.notEqual(result.model.rows[1].unique_id, 'server-target-uid', 'the UI does not guess the server-owned target ID');
});

test('optimistic season move inserts same-location destination with season Open Stock and stable location total', () => {
  const lineage = { warehousei: 'WH1', ITEMCODE: '004103.010.1', CONTSIZE: '#1', SOURCE: 'seed', DESIGITEM: 'D1' };
  const rows = [
    { ...lineage, UNIQUE_ID: 'source-s1', LOCATIONCODE: 'C.15.000', LOTCODE: '27.S1', SEASON: 'S1', PTRONHAND: '808', PTRAVAILABLE: '808', S_LTS: '529', LOC_ON_HAND: '878' },
    { ...lineage, UNIQUE_ID: 'other-c-lot', LOCATIONCODE: 'C.15.000', LOTCODE: '27.S2', SEASON: 'S2', PTRONHAND: '70', PTRAVAILABLE: '70', S_LTS: '0', LOC_ON_HAND: '878' },
    { ...lineage, UNIQUE_ID: 'f16-f1', LOCATIONCODE: 'F.16.000', LOTCODE: '27.F1', SEASON: 'F1', PTRONHAND: '113', PTRAVAILABLE: '113', S_LTS: '-276' },
    { ...lineage, UNIQUE_ID: 'h06-f1', LOCATIONCODE: 'H.06.000', LOTCODE: '27.F1', SEASON: 'F1', PTRONHAND: '1', PTRAVAILABLE: '1', S_LTS: '-276' }
  ];
  const ctx = { parseAppNumber: value => value == null || value === '' ? null : Number(String(value).replace(/,/g, '')),
    buildItemInquiryViewModel: (_item, nextRows) => ({ rows: nextRows, locationRows: nextRows.map(row => ({ unique_id: row.UNIQUE_ID, sourceRow: row, values: row })) }) };
  vm.createContext(ctx);
  vm.runInContext(extractAppFunction('reclassStockSeason') + extractAppFunction('buildOptimisticInventoryReclassMoveModel'), ctx);
  const result = ctx.buildOptimisticInventoryReclassMoveModel({ item: {}, inquiryModel: { rows } }, {
    commandId: 'blue-dart-move', moves: [{ source: { uniqueId: 'source-s1' }, lines: [{ destinationSeason: 'F1', quantity: 276 }] }]
  }).model.rows;
  const sourceAfter = result.find(row => row.UNIQUE_ID === 'source-s1');
  const dest = result.find(row => String(row.UNIQUE_ID).startsWith('pending-reclass-'));
  assert.equal(sourceAfter.PTRONHAND, '532');
  assert.equal(sourceAfter.S_LTS, '253');
  assert.equal(dest.LOCATIONCODE, 'C.15.000');
  assert.equal(dest.LOTCODE, '27.F1');
  assert.equal(dest.PTRONHAND, '276');
  assert.equal(dest.PTRREVIEWED, '0');
  assert.equal(dest.PTRAVAILABLE, '276');
  assert.equal(dest.S_LTS, '0', 'new row starts from existing F1 season Open Stock before adding moved quantity');
  assert.equal(dest.LOC_ON_HAND, '878');
  assert.deepEqual(result.filter(row => ['f16-f1','h06-f1'].includes(row.UNIQUE_ID)).map(row => row.S_LTS), ['0','0']);
});

test('optimistic destination selection uses full lineage and rejects duplicate canonical targets', () => {
  const sourceLineage = { warehouseid: 'WH1', source: 'seed', desigitem: 'D1', desigcust: 'C1', desigloc: 'L1' };
  const sourceRow = { ...source.identity, ...sourceLineage, UNIQUE_ID: 'source-uid', ITEMCODE: 'ITEM-1', CONTSIZE: '#3',
    LOCATIONCODE: 'C.12.001', LOTCODE: '27.F1', SEASON: 'F1', PTRONHAND: '50', PTRAVAILABLE: '40' };
  const foreignTarget = { ...sourceRow, UNIQUE_ID: 'foreign-target', unique_id: 'foreign-target', LOTCODE: '27.U1', lotcode: '27.U1',
    SEASON: 'U1', season: 'U1', warehouseid: 'WH2',
    PTRONHAND: '99', PTRAVAILABLE: '99' };
  const build = rows => {
    const ctx = { parseAppNumber: value => value == null || value === '' ? null : Number(String(value).replace(/,/g, '')),
      buildItemInquiryViewModel: (_item, input) => ({ rows: input, locationRows: input.map(row => ({ unique_id: row.UNIQUE_ID, sourceRow: row, values: row })) }) };
    vm.createContext(ctx);
    vm.runInContext(`${extractAppFunction('reclassStockSeason')}\n${extractAppFunction('buildOptimisticInventoryReclassMoveModel')}`, ctx);
    return ctx.buildOptimisticInventoryReclassMoveModel({ item: {}, inquiryModel: { rows } }, {
      commandId: 'reclass-command-lineage-01', moves: [{ source: { uniqueId: 'source-uid' },
        lines: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 20 }] }]
    });
  };
  const result = build([sourceRow, foreignTarget]);
  assert.equal(result.model.rows.find(row => row.unique_id === 'foreign-target').PTRONHAND, '99');
  assert.equal(result.model.rows.find(row => row.unique_id.startsWith('pending-reclass-')).ptronhand, '20');
  assert.throws(() => build([sourceRow, { ...foreignTarget, UNIQUE_ID: 'canonical-one', unique_id: 'canonical-one', warehouseid: 'WH1' },
    { ...foreignTarget, UNIQUE_ID: 'canonical-two', unique_id: 'canonical-two', warehouseid: 'WH1' }]), /ambiguous/);
});

test('unknown Reclass move outcomes keep the optimistic worksheet and retry the identical command', async () => {
  const calls = [], applied = [], persists = [];
  let submits = 0;
  const service = { status: async (id) => { calls.push(['status', id]); return { status: 'missing' }; },
    submit: async (command) => { calls.push(['submit', structuredClone(command)]); if (++submits === 1) throw Object.assign(new Error('request timed out'), { status: 500 }); return { ...receipt, status: 'applied' }; } };
  const ctx = { getInventoryReclassMovesService: () => service,
    buildInventoryReclassMoveCommand: () => ({ commandId: 'reclass-command-0006', expectedRevision: 41, moves: [{ source, lines: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 20 }] }] }),
    buildOptimisticInventoryReclassMoveModel: () => ({ model: { optimistic: true }, movedUids: ['source-uid'] }),
    renderArgosInventoryTransactionInquiryModel() {}, setArgosReclassMoveInputsLocked() {},
    getArgosReclassLiveEditIdentityKey: () => 'actor', isInventoryStatusOutcomeUncertain: error => error.status === 500,
    getDatasetState: () => ({ liveVerifiedRevision: '41', liveVerifiedScope: 'scope', liveVerifiedPermission: 'perm' }),
    getProductionLiveSyncContext: () => ({ scope: 'scope', dataPermissionVersion: 'perm' }),
    applyArgosInventoryTransactionReturnedRow: row => { applied.push(row.unique_id); return row; },
    publishArgosInventoryTransactionReturnedRows() {},
    confirmedArgosReclassLiveEditRevisions: new Map(), invalidateArgosReclassLiveEditCaches() {},
    retireConfirmedArgosReclassMoveProposals() {}, persistPendingArgosInventoryReclassMove: (_state, _identity) => persists.push(_state),
    readPendingArgosInventoryReclassMove: () => null,
  };
  vm.createContext(ctx);
  vm.runInContext(extractApplyReclassMoveFunction(), ctx);
  const state = { inquiryModel: { original: true }, item: {}, snapshot: { uniqueId: 'source-uid' } };
  await assert.rejects(ctx.applyArgosInventoryReclassMoveCommand(state, {}, 'actor'), error => error.inventoryMovePending === true);
  assert.equal(state.pendingReclassMove.uncertain, true);
  assert.deepEqual(state.inquiryModel, { optimistic: true });
  const result = await ctx.applyArgosInventoryReclassMoveCommand(state, {}, 'actor');
  assert.equal(calls[0][0], 'submit');
  assert.equal(calls[1][0], 'status');
  assert.deepEqual(calls[0][1], calls[2][1], 'retry uses the original id and body');
  assert.equal(result.receipt.requestId, 'request-1');
  assert.deepEqual(applied, ['source-uid', 'server-target-uid']);
  assert.equal(state.pendingReclassMove, null);
});

test('pending move retry reuses the original validated inquiry draft after optimistic stock changes', async () => {
  const calls = [], persisted = [];
  let submits = 0;
  const command = { commandId: 'reclass-command-pending-draft-01', expectedRevision: 41,
    moves: [{ source, lines: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 20 }] }] };
  const draft = { transaction: { requestActions: ['priority_change'] }, rowOverlays: [{ unique_id: 'source-uid',
    proposals: [{ action: 'move_up', splits: [{ quantity: '20', destinationSeason: 'U1' }] },
      { action: 'priority_change', priority: '1' }], fieldEdits: [{ field: 'locationnote', value: 'Keep this draft' }] }] };
  const service = { status: async id => { calls.push(['status', id]); return { status: 'missing' }; },
    submit: async input => { calls.push(['submit', structuredClone(input)]); if (++submits === 1) throw Object.assign(new Error('lost response'), { status: 503 }); return { ...receipt, status: 'applied' }; } };
  const ctx = { getInventoryReclassMovesService: () => service,
    buildInventoryReclassMoveCommand: () => command,
    buildOptimisticInventoryReclassMoveModel: () => ({ model: { rows: [{ unique_id: 'source-uid', ptronhand: '30' }] }, movedUids: ['source-uid'] }),
    renderArgosInventoryTransactionInquiryModel() {}, setArgosReclassMoveInputsLocked() {},
    getArgosReclassLiveEditIdentityKey: () => 'actor', isInventoryStatusOutcomeUncertain: error => error.status === 503,
    getDatasetState: () => ({ liveVerifiedRevision: '41', liveVerifiedScope: 'scope', liveVerifiedPermission: 'perm' }),
    getProductionLiveSyncContext: () => ({ scope: 'scope', dataPermissionVersion: 'perm' }),
    applyArgosInventoryTransactionReturnedRow: row => row, confirmedArgosReclassLiveEditRevisions: new Map(),
    publishArgosInventoryTransactionReturnedRows() {},
    invalidateArgosReclassLiveEditCaches() {}, retireConfirmedArgosReclassMoveProposals() {},
    persistPendingArgosInventoryReclassMove: state => persisted.push(state?.pendingReclassMove?.inquiryPayload || null),
    readPendingArgosInventoryReclassMove: () => null };
  vm.createContext(ctx);
  vm.runInContext(`${extractApplyReclassMoveFunction()}\n${extractAppFunction('getArgosInventoryTransactionPayloadForPendingMove')}`, ctx);
  const state = { inquiryModel: { original: true }, item: {}, snapshot: { uniqueId: 'source-uid' } };
  await assert.rejects(ctx.applyArgosInventoryReclassMoveCommand(state, draft, 'actor'), error => error.inventoryMovePending === true);
  assert.deepEqual(state.inquiryModel, { rows: [{ unique_id: 'source-uid', ptronhand: '30' }] });
  assert.equal(JSON.stringify(persisted.at(-1)), JSON.stringify(draft), 'the pre-move remaining inquiry draft is persisted with the idempotent command');
  const newlyBuiltFromOptimisticState = { transaction: { requestActions: [] }, rowOverlays: [] };
  const retryPayload = ctx.getArgosInventoryTransactionPayloadForPendingMove(state, newlyBuiltFromOptimisticState);
  assert.equal(JSON.stringify(retryPayload), JSON.stringify(draft), 'pending retry keeps the original remaining draft instead of validating against optimistic balances');
  const result = await ctx.applyArgosInventoryReclassMoveCommand(state, retryPayload, 'actor');
  assert.equal(result.receipt.requestId, 'request-1');
  assert.deepEqual(calls.map(call => call[0]), ['submit', 'status', 'submit']);
  assert.deepEqual(calls[0][1], calls[2][1], 'the retry uses the exact original stock command');
  assert.equal(state.pendingReclassMove, null);
});

test('pending worksheet lock restores only controls it disabled and preserves authorization state', () => {
  const makeControl = disabled => {
    const attrs = new Map();
    return { disabled,
      hasAttribute: name => attrs.has(name),
      getAttribute: name => attrs.get(name) ?? null,
      setAttribute: (name, value) => attrs.set(name, String(value)),
      removeAttribute: name => attrs.delete(name) };
  };
  const editable = makeControl(false);
  const permissionDisabled = makeControl(true);
  let controls = [editable, permissionDisabled];
  const ctx = { document: { getElementById: id => id === 'argos-reclass-item-inquiry'
    ? { querySelectorAll: () => controls } : null } };
  vm.createContext(ctx);
  vm.runInContext(extractAppFunction('setArgosReclassMoveInputsLocked'), ctx);
  ctx.setArgosReclassMoveInputsLocked(true);
  assert.equal(editable.disabled, true);
  assert.equal(permissionDisabled.disabled, true);

  const rendererDisabled = makeControl(true);
  const rendererEditable = makeControl(false);
  controls = [rendererDisabled, rendererEditable];
  ctx.setArgosReclassMoveInputsLocked(false);
  assert.equal(rendererDisabled.disabled, true, 'freshly rendered permission-disabled controls remain disabled');
  assert.equal(rendererEditable.disabled, false, 'freshly rendered controls retain renderer state');

  controls = [editable, permissionDisabled];
  ctx.setArgosReclassMoveInputsLocked(false);
  assert.equal(editable.disabled, false, 'a control originally enabled is restored');
  assert.equal(permissionDisabled.disabled, true, 'a control originally disabled by authorization remains disabled');
  assert.equal(editable.hasAttribute('data-reclass-pending-disabled'), false);
  assert.equal(permissionDisabled.hasAttribute('data-reclass-pending-disabled'), false);
});

test('a new stock command is not dispatched when its recovery record cannot be persisted', async () => {
  let rpcCalls = 0; const lockStates = [];
  const command = { commandId: 'reclass-command-storage-block-01', expectedRevision: 41,
    moves: [{ source, lines: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 20 }] }] };
  const ctx = { getInventoryReclassMovesService: () => ({ status: async () => { rpcCalls++; }, submit: async () => { rpcCalls++; } }),
    buildInventoryReclassMoveCommand: () => command,
    buildOptimisticInventoryReclassMoveModel: () => ({ model: { optimistic: true }, movedUids: ['source-uid'] }),
    renderArgosInventoryTransactionInquiryModel() {}, setArgosReclassMoveInputsLocked: locked => lockStates.push(locked),
    getArgosReclassLiveEditIdentityKey: () => 'actor', isInventoryStatusOutcomeUncertain: () => false,
    readPendingArgosInventoryReclassMove: () => null,
    getDatasetState: () => ({ liveVerifiedRevision: '41', liveVerifiedScope: 'scope', liveVerifiedPermission: 'perm' }),
    getProductionLiveSyncContext: () => ({ scope: 'scope', dataPermissionVersion: 'perm' }),
    confirmedArgosReclassLiveEditRevisions: new Map(), applyArgosInventoryTransactionReturnedRow: row => row,
    publishArgosInventoryTransactionReturnedRows() {},
    invalidateArgosReclassLiveEditCaches() {}, retireConfirmedArgosReclassMoveProposals() {},
    persistPendingArgosInventoryReclassMove: () => false };
  vm.createContext(ctx);
  vm.runInContext(extractApplyReclassMoveFunction(), ctx);
  const originalModel = { rows: [{ unique_id: 'source-uid', ptronhand: '50' }] };
  const state = { inquiryModel: originalModel, item: {}, snapshot: { uniqueId: 'source-uid' } };
  await assert.rejects(ctx.applyArgosInventoryReclassMoveCommand(state, {}, 'actor'), error =>
    error.code === 'INVENTORY_RECLASS_PENDING_STORAGE_UNAVAILABLE');
  assert.equal(rpcCalls, 0, 'no mutation or status request is made without a recoverable command record');
  assert.equal(state.pendingReclassMove, null);
  assert.equal(state.inquiryModel, originalModel, 'optimistic quantities are rolled back');
  assert.deepEqual(lockStates, [true, false], 'worksheet controls are released after rollback');

  for (const stored of [
    { command: { ...command, expectedRevision: 42 }, inquiryPayload: {} },
    { command, inquiryPayload: { changed: true } },
  ]) {
    ctx.readPendingArgosInventoryReclassMove = () => stored;
    const mismatchState = { inquiryModel: originalModel, item: {}, snapshot: { uniqueId: 'source-uid' } };
    await assert.rejects(ctx.applyArgosInventoryReclassMoveCommand(mismatchState, {}, 'actor'), error =>
      error.code === 'INVENTORY_RECLASS_PENDING_STORAGE_UNAVAILABLE');
    assert.equal(mismatchState.pendingReclassMove, null, 'a same-ID but mismatched stored record is never treated as recovery');
  }
  assert.equal(rpcCalls, 0, 'mismatched saved bodies and drafts cannot authorize a stock dispatch');
});

test('lost responses finalize committed pending or conflicted import receipts without resubmitting stock', async () => {
  for (const importStatus of ['pending', 'conflict']) {
    const calls = [], applied = [];
    const command = { commandId: `reclass-command-status-${importStatus}`, expectedRevision: 41,
      moves: [{ source, lines: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 20 }] }] };
    const committed = { ...receipt, status: 'applied', importStatus };
    const service = { status: async (id, expected) => { calls.push(['status', id, structuredClone(expected)]); return { status: 'applied', receipt: committed }; },
      submit: async input => { calls.push(['submit', structuredClone(input)]); throw new Error('A committed movement must not be replayed.'); } };
    const ctx = { getInventoryReclassMovesService: () => service, buildInventoryReclassMoveCommand: () => command,
      buildOptimisticInventoryReclassMoveModel: () => ({ model: { optimistic: true }, movedUids: ['source-uid'] }),
      renderArgosInventoryTransactionInquiryModel() {}, setArgosReclassMoveInputsLocked() {},
      getArgosReclassLiveEditIdentityKey: () => 'actor', isInventoryStatusOutcomeUncertain: () => true,
      getDatasetState: () => ({ liveVerifiedRevision: '41', liveVerifiedScope: 'scope', liveVerifiedPermission: 'perm' }),
      getProductionLiveSyncContext: () => ({ scope: 'scope', dataPermissionVersion: 'perm' }),
      applyArgosInventoryTransactionReturnedRow: row => { applied.push(row.unique_id); return row; },
      publishArgosInventoryTransactionReturnedRows() {},
      confirmedArgosReclassLiveEditRevisions: new Map(), invalidateArgosReclassLiveEditCaches() {},
      retireConfirmedArgosReclassMoveProposals() {}, persistPendingArgosInventoryReclassMove() {}, readPendingArgosInventoryReclassMove: () => null };
    vm.createContext(ctx);
    vm.runInContext(extractApplyReclassMoveFunction(), ctx);
    const state = { inquiryModel: { original: true }, item: {}, snapshot: { uniqueId: 'source-uid' },
      pendingReclassMove: { command, originalModel: { original: true }, movedUids: ['source-uid'], uncertain: true } };
    const result = await ctx.applyArgosInventoryReclassMoveCommand(state, {}, 'actor');
    assert.equal(result.receipt.importStatus, importStatus);
    assert.deepEqual(calls, [['status', command.commandId, command]]);
    assert.deepEqual(applied, ['source-uid', 'server-target-uid']);
    assert.equal(state.pendingReclassMove, null);
  }
});

test('recovering an older committed receipt never overwrites newer stock or lowers the revision fence', async () => {
  const command = { commandId: 'reclass-command-stale-receipt-01', expectedRevision: 10,
    moves: [{ source, lines: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 20 }] }] };
  const staleReceipt = { ...receipt, commandId: command.commandId, revision: '11' };
  const statusCalls = []; const appliedRows = []; const invalidations = []; const retired = [];
  const state = { inquiryModel: { newerCanonical: true }, item: {}, snapshot: { uniqueId: 'source-uid' },
    pendingReclassMove: { command, movedUids: ['source-uid'], uncertain: true, inFlight: false } };
  const revisions = new Map([['actor', '14']]);
  const ctx = {
    getArgosReclassLiveEditIdentityKey: () => 'actor',
    getInventoryReclassMovesService: () => ({ status: async (...args) => { statusCalls.push(args); return { status: 'applied', receipt: staleReceipt }; },
      submit: async () => { throw new Error('confirmed status must prevent duplicate apply'); } }),
    getDatasetState: () => ({ liveVerifiedRevision: '14', liveVerifiedScope: 'scope', liveVerifiedPermission: 'permission' }),
    getProductionLiveSyncContext: () => ({ scope: 'scope', dataPermissionVersion: 'permission' }),
    confirmedArgosReclassLiveEditRevisions: revisions,
    applyArgosInventoryTransactionReturnedRow: row => { appliedRows.push(row.unique_id); return row; },
    publishArgosInventoryTransactionReturnedRows() {},
    invalidateArgosReclassLiveEditCaches: reason => { invalidations.push(reason); },
    retireConfirmedArgosReclassMoveProposals: (_state, movedUids) => { retired.push([...movedUids]); },
    persistPendingArgosInventoryReclassMove() {}, readPendingArgosInventoryReclassMove: () => null, setArgosReclassMoveInputsLocked() {},
    isInventoryStatusOutcomeUncertain: error => error.outcomeUncertain === true,
  };
  vm.createContext(ctx);
  vm.runInContext(extractApplyReclassMoveFunction(), ctx);
  const result = await ctx.applyArgosInventoryReclassMoveCommand(state, {}, 'actor');
  assert.equal(result.receipt.requestId, staleReceipt.requestId, 'status still resolves the committed operation');
  assert.equal(statusCalls.length, 1);
  assert.deepEqual(appliedRows, [], 'stale receipt rows never overwrite newer canonical inventory');
  assert.equal(revisions.get('actor'), '14', 'the local revision fence stays monotonic');
  assert.deepEqual(retired, [['source-uid']], 'only committed move proposals are retired');
  assert.equal(state.pendingReclassMove, null);
  assert.deepEqual(invalidations, [], 'a newer, permission-matched canonical snapshot remains valid');

  ctx.getDatasetState = () => ({ liveVerifiedRevision: '', liveVerifiedScope: '', liveVerifiedPermission: '' });
  const needsRefresh = { inquiryModel: { newerCanonical: true }, item: {}, snapshot: { uniqueId: 'source-uid' },
    pendingReclassMove: { command, movedUids: ['source-uid'], uncertain: true, inFlight: false } };
  await ctx.applyArgosInventoryReclassMoveCommand(needsRefresh, {}, 'actor');
  assert.equal(statusCalls.length, 2);
  assert.deepEqual(appliedRows, [], 'an old receipt stays unapplied without a verified newer snapshot too');
  assert.deepEqual(invalidations, ['inventory-reclass-move-stale-receipt'],
    'when no current verified snapshot covers the old receipt, canonical refresh is requested');
  assert.equal(revisions.get('actor'), '14');
});
