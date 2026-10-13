// @test-group: suspend
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function extract(name) {
  const match = html.match(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(match, `${name} exists`);
  const start = match.index;
  const next = html.slice(start + match[0].length).search(/\n        (?:async )?function \w+\(/);
  assert.ok(next >= 0, `${name} boundary`);
  return html.slice(start, start + match[0].length + next);
}

function actionHarness({ allowed = true, eligible = true } = {}) {
  const source = { UNIQUE_ID: 'soc-row', SOURCE_TABLE: 'ph_soc_master', SOURCE: 'PH', ITEMCODE: 'SKU-1', LOTCODE: '27.U3', LOCATIONCODE: 'A1' };
  const master = { ...source, UNIQUE_ID: 'master-row', SOURCE_TABLE: 'ph_master_inventory', LOTCODE: eligible ? '27.U3' : '' };
  const item = { UNIQUE_ID: 'dock_suspend_dc_soc-row', MASTER_ID: 'master-row', suspend: 'SUSPEND', suspend_to: 'DC' };
  const context = vm.createContext({
    String, Object, Array, Set, Map, Date,
    esc: value => String(value ?? ''), escJsAttrValue: value => String(value ?? '').replaceAll("'", '&#39;'),
    firstNonEmptyValue: (...values) => values.find(value => value !== '' && value != null),
    activeDetailSourceView: '', lastView: 'request',
    canCurrentUserViewDockSuspendDcRequests: () => allowed,
    canCurrentUserUseDriveCardOptions: () => allowed,
    canCurrentUserSubmitRepInventoryOperations: () => false,
    getSuspendTagStatus: () => 'pending',
    masterInventoryById: new Map([[master.UNIQUE_ID, master]]),
    masterInventoryByExactKey: new Map([['SKU-1__A1__27.U3__PH', master]]),
    fullInventory: [master],
    getMasterInventorySourceCode: row => row.SOURCE || '',
    findDockSuspendDcRequestSourceRow: () => source,
  });
  vm.runInContext(['getMasterInventoryExactKey', 'findLinkedMasterRow', 'getDockSuspendDcRequestLinkedMasterRow',
    'isArgosInventoryTransactionEligible', 'buildArgosInventoryTransactionRailHtml', 'buildSuspendTagActions'].map(extract).join('\n'), context);
  return { context, item, source, master };
}

test('Suspend Tag card renders shared Reclass button and its activation does not bubble to card', () => {
  const { context, item, master } = actionHarness();
  let opened = null;
  context.openArgosInventoryTransactionModal = (...args) => { opened = args; return false; };
  const dom = new JSDOM(`<article id="card">${context.buildSuspendTagActions(item, 'onpointerdown="event.stopPropagation()"')}</article>`, { runScripts: 'dangerously' });
  dom.window.openArgosInventoryTransactionModal = context.openArgosInventoryTransactionModal;
  let cardClicks = 0;
  dom.window.document.querySelector('#card').addEventListener('click', () => { cardClicks += 1; });
  const button = dom.window.document.querySelector('.app-card-bottom-btn--argos-reclass');
  assert.ok(button);
  assert.equal(button.getAttribute('aria-label'), 'Open reclass transaction');
  assert.equal(button.textContent.trim(), 'Reclass');
  const driveMarkup = dom.window.document.createElement('div');
  driveMarkup.innerHTML = context.buildArgosInventoryTransactionRailHtml(master, 'drive');
  assert.equal(button.className, driveMarkup.firstElementChild.className);
  assert.equal(button.innerHTML, driveMarkup.firstElementChild.innerHTML);
  let cardPresses = 0;
  dom.window.document.querySelector('#card').addEventListener('pointerdown', () => { cardPresses += 1; });
  button.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
  assert.equal(cardPresses, 0);
  assert.ok(button.closest('[data-suspend-tag-status]'));
  button.click();
  assert.equal(cardClicks, 0);
  assert.deepEqual(opened, ['master-row', 'reclass', 'suspend-tag']);
  assert.equal(master.UNIQUE_ID, opened[0], 'the synthetic Suspend Tag card UID is not submitted');
  assert.match(dom.window.document.querySelector('#card').textContent, /Mark Done/);
  assert.match(dom.window.document.querySelector('#card').textContent, /Share Photo \/ Spec Options/);
  dom.window.close();
});

test('Suspend Tag Reclass resolves the explicit linked master or exact source match', () => {
  const { context, item, master } = actionHarness();
  assert.match(context.buildSuspendTagActions(item), /openArgosInventoryTransactionModal\('master-row', 'reclass', 'suspend-tag'\)/);
  const exactItem = { ...item, MASTER_ID: '' };
  assert.match(context.buildSuspendTagActions(exactItem), /openArgosInventoryTransactionModal\('master-row', 'reclass', 'suspend-tag'\)/);
  assert.notEqual(exactItem.UNIQUE_ID, master.UNIQUE_ID);
});

test('Suspend Tag Reclass is hidden for absent, ineligible, or unauthorized linked rows', () => {
  const denied = actionHarness({ allowed: false });
  assert.doesNotMatch(denied.context.buildSuspendTagActions(denied.item), /app-card-bottom-btn--argos-reclass/);
  const invalid = actionHarness({ eligible: false });
  assert.doesNotMatch(invalid.context.buildSuspendTagActions(invalid.item), /app-card-bottom-btn--argos-reclass/);
  const missing = actionHarness();
  missing.context.masterInventoryById = new Map([['unrelated', {}]]);
  missing.context.masterInventoryByExactKey.clear();
  assert.doesNotMatch(missing.context.buildSuspendTagActions(missing.item), /app-card-bottom-btn--argos-reclass/);
});

test('shared rail honors both access gates and preserves existing Drive behavior', () => {
  const { context, master } = actionHarness();
  assert.match(context.buildArgosInventoryTransactionRailHtml(master, 'suspend-tag'), /aria-label="Open reclass transaction"/);
  context.canCurrentUserViewDockSuspendDcRequests = () => false;
  assert.equal(context.buildArgosInventoryTransactionRailHtml(master, 'suspend-tag'), '');
  assert.match(context.buildArgosInventoryTransactionRailHtml(master, 'drive'), /Reclass/);
  assert.equal(context.buildArgosInventoryTransactionRailHtml(master, 'request'), '');
  context.canCurrentUserViewDockSuspendDcRequests = () => true;
  context.canCurrentUserUseDriveCardOptions = () => false;
  assert.equal(context.buildArgosInventoryTransactionRailHtml(master, 'suspend-tag'), '');
  context.canCurrentUserSubmitRepInventoryOperations = () => true;
  assert.match(context.buildArgosInventoryTransactionRailHtml(master, 'suspend-tag'), /Reclass/);
});

function modalHarness() {
  const { context, master } = actionHarness();
  const dom = new JSDOM('<div id="argos-inventory-transaction-modal" class="hidden"></div><button id="argos-inventory-transaction-apply" disabled></button>');
  const modal = dom.window.document.getElementById('argos-inventory-transaction-modal');
  const calls = [], toasts = [];
  let resolveRead;
  Object.assign(context, {
    AbortController, document: dom.window.document,
    argosInquiryOpenRevision: 0, argosInquiryReadController: null, argosInventoryTransactionState: null,
    owner: 'account-a', view: 'request', requestSuspendTagDockFilter: 'dock-2',
    findItemByUniqueId: uid => uid === master.UNIQUE_ID ? master : null,
    showToast: (...args) => toasts.push(args),
    canUseProductionLiveSync: () => true,
    getSupabaseReadIdentityScope: () => context.owner,
    getCurrentVisibleViewId: () => context.view,
    clearSupabaseReadFailuresForVisibleContext: () => {},
    loadArgosItemInquiryRows: (row, options) => { calls.push({ row, options }); return new Promise(resolve => { resolveRead = resolve; }); },
    ensureArgosInventoryTransactionModal: () => modal,
    getArgosInventorySourceSnapshot: row => ({ uniqueId: row.UNIQUE_ID }),
    buildItemInquiryViewModel: (row, rows) => ({ row, rows }),
    resetArgosReclassMultiActionState: () => {},
    generateArgosInventoryTransactionId: () => 'inquiry-token',
    refreshArgosInventoryTransactionLotOptions: () => {},
    refreshArgosInventoryTransactionPriorityOptions: () => {},
    setArgosInventoryTransactionAction: () => {},
    setArgosInventoryTransactionHoldAction: () => {},
    toggleArgosInventoryTransactionHoldActionPicker: () => {},
    getDriveSearchTerm: () => { throw new Error('Suspend Tag must not capture Drive context'); },
  });
  vm.runInContext(extract('openArgosInventoryTransactionModal') + '\n' + extract('closeArgosInventoryTransactionModal'), context);
  return { context, master, modal, dom, calls, toasts, resolve: value => resolveRead(value) };
}

test('Suspend Tag modal uses the hydrated inventory group and closes without altering filters or view', async () => {
  const h = modalHarness();
  h.context.openArgosInventoryTransactionModal('master-row', 'reclass', 'suspend-tag');
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].row, h.master);
  assert.ok(h.calls[0].options.signal instanceof AbortSignal);
  assert.equal(h.context.argosInventoryTransactionState, null);
  const fresh = { ...h.master, PRIORITY: '1' };
  const rows = [fresh, { ...fresh, UNIQUE_ID: 'master-sibling', LOCATIONCODE: 'B2' }];
  h.resolve({ row: fresh, rows });
  await new Promise(setImmediate);
  assert.equal(h.context.argosInventoryTransactionState.item, fresh);
  assert.equal(h.context.argosInventoryTransactionState.inquiryModel.rows, rows);
  assert.equal(h.context.argosInventoryTransactionState.uid, 'master-row');
  assert.equal(h.context.argosInventoryTransactionState.sourceView, 'suspend-tag');
  assert.equal(h.context.argosInventoryTransactionState.driveReturnContext, null);
  assert.equal(h.modal.classList.contains('hidden'), false);
  assert.equal(h.dom.window.document.getElementById('argos-inventory-transaction-apply').disabled, false);
  h.context.closeArgosInventoryTransactionModal();
  assert.equal(h.context.argosInventoryTransactionState, null);
  assert.equal(h.modal.classList.contains('hidden'), true);
  assert.equal(h.context.requestSuspendTagDockFilter, 'dock-2');
  assert.equal(h.context.view, 'request');
  h.dom.window.close();
});

test('stale activation and permission changes cannot open the Suspend Tag Reclass modal', async () => {
  for (const gate of ['canCurrentUserViewDockSuspendDcRequests', 'canCurrentUserUseDriveCardOptions']) {
    const h = modalHarness();
    h.context[gate] = () => false;
    h.context.openArgosInventoryTransactionModal('master-row', 'reclass', 'suspend-tag');
    assert.equal(h.calls.length, 0);
    assert.equal(h.context.argosInventoryTransactionState, null);
    assert.equal(h.toasts.at(-1)[2], true);
    h.dom.window.close();
  }
  const h = modalHarness();
  h.context.openArgosInventoryTransactionModal('removed-master', 'reclass', 'suspend-tag');
  assert.equal(h.calls.length, 0);
  assert.equal(h.toasts.at(-1)[0], 'Unavailable');
  h.dom.window.close();
});

test('late inventory reads are discarded after identity, view, revision, or access changes', async () => {
  for (const change of [
    ctx => { ctx.owner = 'account-b'; },
    ctx => { ctx.view = 'drive'; },
    ctx => { ctx.argosInquiryOpenRevision += 1; },
    ctx => { ctx.canCurrentUserViewDockSuspendDcRequests = () => false; },
  ]) {
    const h = modalHarness();
    h.context.openArgosInventoryTransactionModal('master-row', 'reclass', 'suspend-tag');
    change(h.context);
    h.resolve({ row: h.master, rows: [h.master] });
    await new Promise(setImmediate);
    assert.equal(h.context.argosInventoryTransactionState, null);
    assert.equal(h.modal.classList.contains('hidden'), true);
    h.dom.window.close();
  }
});
