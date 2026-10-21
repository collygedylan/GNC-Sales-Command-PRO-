import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: suspend
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const html = readComposedAppSource().replace(/\r\n/g, '\n');

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
    window: {}, activeReqTab: 'suspend-tag', suspendTagCardActionDelegationBound: false,
    esc: value => String(value ?? ''), escJsAttrValue: value => String(value ?? '').replaceAll("'", '&#39;'),
    firstNonEmptyValue: (...values) => values.find(value => value !== '' && value != null),
    owner: 'account-1', currentUser: 'operator-1', currentRole: 'user', suspendTagCompletionActions: new Set(),
    getSupabaseReadIdentityScope: () => String(context.owner || 'account-1'),
    activeDetailSourceView: '', lastView: 'request',
    canCurrentUserViewDockSuspendDcRequests: () => allowed,
    canUseProductionLiveSync: () => false,
    canCurrentUserUseDriveCardOptions: () => allowed,
    canCurrentUserSubmitRepInventoryOperations: () => false,
    getSuspendTagStatus: () => 'pending',
    masterInventoryById: new Map([[master.UNIQUE_ID, master]]),
    masterInventoryByExactKey: new Map([['SKU-1__A1__27.U3__PH', master]]),
    masterInventoryByItemCode: new Map([['SKU-1', [master]]]),
    masterInventoryByNormalizedItemLocation: new Map(),
    fullInventory: [master],
    getMasterInventorySourceCode: row => row.SOURCE || '',
    normalizeMasterInventorySourceCode: value => ['DOCK','DOCKS','SOC'].includes(String(value || '').trim().toUpperCase()) ? '' : String(value || '').trim().toUpperCase(),
    getDatasetState: () => ({ rowCompleteness:'complete', initialLoaded:true }),
    nativeAuthSessionActive: false, nativeAuthProfile: null,
    getItemInquiryItemCode: () => 'SKU-1',
    isSameDockSuspendDcRequestCardDataLocation: (row, target) => row.ITEMCODE === target.ITEMCODE && row.LOCATIONCODE === target.LOCATIONCODE && row.LOTCODE === target.LOTCODE,
    getSuspendTagHydratedInventoryRow: () => null,
    isSuspendTagHydratedInventoryRowStale: () => false,
    findDockSuspendDcRequestSourceRow: () => source,
  });
  vm.runInContext(['isDockSuspendDcRequestMirrorRow', 'getDockSuspendDcRequestSourceUid', 'getMasterInventoryExactKey', 'findLinkedMasterRow', 'getDockSuspendDcRequestLinkedMasterRow',
    'getSuspendTagInventoryIdentity', 'matchesSuspendTagInventoryIdentity', 'getOperationalCardInventoryRow',
    'isArgosInventoryTransactionEligible', 'buildArgosInventoryTransactionRailHtml', 'buildArgosInventoryTransactionRailPlaceholderHtml', 'buildSuspendTagReclassActionHtml', 'initializeSuspendTagCardActionDelegation', 'buildSuspendTagActions'].map(extract).join('\n'), context);
  return { context, item, source, master };
}

function coldReclassHarness(t, { warmFullCache = false } = {}) {
  const h = actionHarness();
  const dom = new JSDOM('<div id="request-content"><article id="card"></article></div>', { runScripts: 'dangerously' });
  t.after(() => dom.window.close());
  const callbacks = [], reads = [];
  Object.assign(h.context, {
    window: dom.window, document: dom.window.document, owner: 'account-1', permission: 'permission-1',
    productionLiveSyncNavigation: new AbortController(),
    canUseProductionLiveSync: () => true, isSuspendTagWriteSurface: () => true,
    getSupabaseReadIdentityScope: () => h.context.owner,
    getProductionLiveSyncContext: () => ({ dataPermissionVersion: h.context.permission }),
    acceptedLocOnHandAggregateReceipt: { scope:'account-1', permission:'permission-1', revision:'1', valid:true },
    findDockSuspendDcRequestMirrorRowByUniqueId: () => h.item,
    markViewDirty() {}, scheduleRequestRender() {},
    staleSupabaseReadScopeError: () => new Error('stale scope'),
    setTimeout: callback => { callbacks.push(callback); return callbacks.length; },
    resolveSuspendTagInventoryRow: (...args) => new Promise((resolve, reject) => { reads.push({ args, resolve, reject }); }),
    esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'),
  });
  h.context.masterInventoryById.set('unrelated', {});
  h.context.masterInventoryById.delete(h.master.UNIQUE_ID);
  h.context.masterInventoryByExactKey.clear();
  h.master.PTRONHAND = 89;
  if (warmFullCache) {
    const olderCachedRow = { ...h.master, PTRONHAND:11 };
    h.context.masterInventoryByItemCode.set('SKU-1', [olderCachedRow]);
    h.context.fullInventory = [olderCachedRow];
  } else {
    h.context.masterInventoryByItemCode.clear();
    h.context.fullInventory = [];
    h.context.getDatasetState = () => ({ rowCompleteness:'partial', initialLoaded:true });
  }
  vm.runInContext('const suspendTagReclassLoads = new Map(); let suspendTagReclassLoadTimer = null; let suspendTagReclassActiveReads = 0; const SUSPEND_TAG_INVENTORY_CACHE_TTL_MS = 120000;', h.context);
  for (const name of ['getSuspendTagInventoryReceiptSignature', 'isSuspendTagInventoryHydrationStale',
    'isSuspendTagHydratedInventoryRowStale', 'getSuspendTagHydratedInventoryRow', 'scheduleSuspendTagReclassLoads',
    'hydrateRenderedSuspendTagReclassCards']) vm.runInContext(extract(name), h.context);
  vm.runInContext('globalThis.getSuspendTagTestEntry = () => [...suspendTagReclassLoads.values()][0];', h.context);
  const card = dom.window.document.getElementById('card');
  card.innerHTML = h.context.buildSuspendTagReclassActionHtml(h.item, 'onpointerdown="event.stopPropagation()"') + h.context.buildSuspendTagActions(h.item);
  const flush = async () => { while (callbacks.length) callbacks.shift()(); await new Promise(setImmediate); };
  return { ...h, dom, card, reads, flush };
}

test('cold-cache Reclass loads an exact row once and preserves Email and Complete Tag', async t => {
  const h = coldReclassHarness(t);
  await h.flush();
  h.context.hydrateRenderedSuspendTagReclassCards();
  assert.equal(h.reads.length, 1);
  assert.equal(h.reads[0].args[2].masterUid, 'master-row');
  h.reads[0].resolve(h.master);
  await new Promise(setImmediate);
  assert.equal(h.context.masterInventoryById.get('master-row'), h.master,
    'accepted exact rows enter the ID index before the asynchronous card rerender');
  await h.flush(); await h.flush();
  assert.equal(h.context.getSuspendTagHydratedInventoryRow(h.item,h.source),h.master,'the exact row is reused from the scoped cache');
  assert.equal(h.reads.length,1,'rendering a hydrated card does not repeat the exact lookup');
  const button = h.card.querySelector('.app-card-bottom-btn--argos-reclass');
  assert.ok(button);
  assert.equal(h.card.querySelectorAll('.app-card-bottom-btn--argos-reclass').length, 1);
  assert.match(h.card.textContent, /Email/);
  assert.match(h.card.textContent, /Complete Tag/);
  assert.doesNotMatch(h.card.textContent, /Mark Done/);
  let opened, bubbled = 0;
  h.dom.window.openArgosInventoryTransactionModal = (...args) => { opened = args; return false; };
  h.card.addEventListener('click', () => { bubbled += 1; });
  h.card.addEventListener('pointerdown', () => { bubbled += 1; });
  button.dispatchEvent(new h.dom.window.Event('pointerdown', { bubbles: true })); button.click();
  assert.equal(bubbled, 0);
  assert.deepEqual(opened, ['master-row', 'reclass', 'suspend-tag']);
  assert.equal(h.context.masterInventoryById.get('master-row'), h.master);
});

test('fresh exact inventory cache is reused without another read', async t => {
  const h = coldReclassHarness(t); await h.flush();
  h.reads[0].resolve(h.master); await h.flush(); await h.flush();
  const entry = h.context.getSuspendTagTestEntry();
  assert.ok(entry.verifiedAt > 0);
  assert.equal(h.context.isSuspendTagInventoryHydrationStale(entry), false);
  h.card.innerHTML = h.context.buildSuspendTagReclassActionHtml(h.item, '');
  await h.flush();
  assert.equal(h.reads.length, 1);
  assert.equal(h.context.getSuspendTagHydratedInventoryRow(h.item, h.source), h.master);
});

test('warm full inventory displays immediately while exact row hydration replaces older cached fields', async t => {
  const h = coldReclassHarness(t, { warmFullCache:true });
  Object.assign(h.item, { ITEMCODE:'SKU-1', LOCATIONCODE:'A1', LOTCODE:'27.U3' });
  const warmRow = { ...h.master, PTRONHAND:11 };
  h.context.masterInventoryByItemCode.set('SKU-1', [warmRow]);
  h.context.fullInventory = [warmRow];
  h.card.innerHTML = h.context.buildSuspendTagReclassActionHtml(h.item, '');
  assert.equal(h.context.getOperationalCardInventoryRow(h.item).PTRONHAND, 11,
    'the existing full cache stays visible while the exact row read starts');
  await h.flush();
  assert.equal(h.reads.length, 1, 'full-snapshot presence does not suppress row-scoped verification');
  h.reads[0].resolve(h.master); await new Promise(setImmediate);
  assert.equal(h.context.getOperationalCardInventoryRow(h.item).PTRONHAND, 89,
    'the accepted exact row takes precedence over an older full-snapshot row');
  await h.flush(); await h.flush();
  assert.equal(h.reads.length, 1);
});

test('expired or aggregate-revision-stale metrics stay visible while exact inventory is reverified', async t => {
  for (const staleBy of ['ttl', 'aggregate-revision']) {
    const h = coldReclassHarness(t); await h.flush();
    h.reads[0].resolve(h.master); await h.flush(); await h.flush();
    const entry = h.context.getSuspendTagTestEntry();
    if (staleBy === 'ttl') entry.verifiedAt = Date.now() - 120001;
    else h.context.acceptedLocOnHandAggregateReceipt = { scope:'account-1', permission:'permission-1', revision:'2', valid:true };
    assert.equal(h.context.isSuspendTagInventoryHydrationStale(entry), true);
    h.card.innerHTML = h.context.buildSuspendTagReclassActionHtml(h.item, '');
    await h.flush();
    assert.equal(h.reads.length, 2, `${staleBy} triggers a fresh exact read`);
    assert.equal(h.context.getSuspendTagHydratedInventoryRow(h.item, h.source), h.master,
      'known metrics remain available during refresh');
    assert.equal(h.context.getOperationalCardInventoryRow(h.item).PTRONHAND, 89,
      'the card continues rendering the cached On Hand metric while refresh is in flight');
    h.reads[1].resolve(h.master); await h.flush(); await h.flush();
    assert.equal(h.context.isSuspendTagInventoryHydrationStale(entry), false);
  }
});

test('cold-cache Reclass cannot expose a missing, ambiguous or unauthorized row', async t => {
  for (const scenario of ['missing', 'ambiguous', 'unauthorized', 'wrong-row']) {
    const h = coldReclassHarness(t); await h.flush();
    if (scenario === 'unauthorized') h.context.canCurrentUserUseDriveCardOptions = () => false;
    if (scenario === 'ambiguous') h.reads[0].reject(new Error('More than one inventory row matches'));
    else h.reads[0].resolve(scenario === 'missing' ? null : scenario === 'wrong-row' ? { ...h.master, LOTCODE: 'other' } : h.master);
    await h.flush(); await h.flush();
    const reclassButton = h.card.querySelector('.app-card-bottom-btn--argos-reclass');
    if (reclassButton) {
      assert.equal(reclassButton.disabled, true, 'an unresolved exact inventory lookup may reserve layout but cannot expose an actionable Reclass');
      assert.equal(reclassButton.hasAttribute('onclick'), false);
    }
    assert.equal(h.context.masterInventoryById.has('master-row'), scenario === 'unauthorized',
      'view-authorized exact quantity rows may be indexed even when the user cannot launch Reclass');
    assert.match(h.card.textContent, /Email/);
    assert.match(h.card.textContent, /Complete Tag/);
    assert.doesNotMatch(h.card.textContent, /Mark Done/);
  }
});

test('cold-cache Reclass discards results after navigation, account or permission changes', async t => {
  for (const change of [h => h.context.productionLiveSyncNavigation.abort(), h => { h.context.owner = 'other'; }, h => { h.context.permission = 'other'; }]) {
    const h = coldReclassHarness(t); await h.flush(); change(h);
    h.reads[0].resolve(h.master); await h.flush();
    const reclassButton = h.card.querySelector('.app-card-bottom-btn--argos-reclass');
    if (reclassButton) {
      assert.equal(reclassButton.disabled, true, 'an unresolved exact inventory lookup may reserve layout but cannot expose an actionable Reclass');
      assert.equal(reclassButton.hasAttribute('onclick'), false);
    }
    assert.equal(h.context.masterInventoryById.has('master-row'), false);
  }
});

test('Suspend Tag card renders shared Reclass button and its activation does not bubble to card', () => {
  const { context, item, master } = actionHarness();
  let opened = null;
  context.openArgosInventoryTransactionModal = (...args) => { opened = args; return false; };
  const dom = new JSDOM(`<article id="card">${context.buildSuspendTagReclassActionHtml(item, 'onpointerdown="event.stopPropagation()"')}${context.buildSuspendTagActions(item)}</article>`, { runScripts: 'dangerously' });
  context.window = dom.window;
  context.document = dom.window.document;
  context.initializeSuspendTagCardActionDelegation();
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
  assert.ok(button.closest('.app-drive-card-reclass'));
  assert.equal(button.closest('[data-suspend-tag-status]'), null);
  button.click();
  assert.equal(cardClicks, 0);
  assert.deepEqual(opened, ['master-row', 'reclass', 'suspend-tag']);
  assert.equal(master.UNIQUE_ID, opened[0], 'the synthetic Suspend Tag card UID is not submitted');
  assert.match(dom.window.document.querySelector('#card').textContent, /Email/);
  assert.doesNotMatch(dom.window.document.querySelector('#card').textContent, /Mark Done/);
  assert.match(dom.window.document.querySelector('#card').textContent, /Complete Tag/);
  dom.window.close();
});

test('Suspend Tag Reclass resolves the explicit linked master or exact source match', () => {
  const { context, item, master } = actionHarness();
  assert.match(context.buildSuspendTagReclassActionHtml(item), /openArgosInventoryTransactionModal\('master-row', 'reclass', 'suspend-tag'\)/);
  const exactItem = { ...item, MASTER_ID: '' };
  assert.match(context.buildSuspendTagReclassActionHtml(exactItem), /openArgosInventoryTransactionModal\('master-row', 'reclass', 'suspend-tag'\)/);
  assert.notEqual(exactItem.UNIQUE_ID, master.UNIQUE_ID);
});

test('Suspend Tag Reclass is hidden for absent, ineligible, or unauthorized linked rows', () => {
  const denied = actionHarness({ allowed: false });
  assert.doesNotMatch(denied.context.buildSuspendTagReclassActionHtml(denied.item), /app-card-bottom-btn--argos-reclass/);
  const invalid = actionHarness({ eligible: false });
  assert.doesNotMatch(invalid.context.buildSuspendTagReclassActionHtml(invalid.item), /app-card-bottom-btn--argos-reclass/);
  const missing = actionHarness();
  missing.context.masterInventoryById = new Map([['unrelated', {}]]);
  missing.context.masterInventoryByExactKey.clear();
  assert.doesNotMatch(missing.context.buildSuspendTagReclassActionHtml(missing.item), /app-card-bottom-btn--argos-reclass/);
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
  const calls = [], toasts = [], frames = [];
  let resolveRead;
  Object.assign(context, {
    AbortController, document: dom.window.document, permission: 'permission-a',
    getProductionLiveSyncContext: () => ({ scope: context.owner, dataPermissionVersion: context.permission }),
    requestAnimationFrame: callback => { frames.push(callback); },
    argosInquiryOpenRevision: 0, argosInquiryReadController: null, argosInventoryTransactionState: null,
    owner: 'account-a', view: 'request', requestSuspendTagDockFilter: 'dock-2',
    findItemByUniqueId: uid => uid === master.UNIQUE_ID ? master : null,
    // These tests cover the cold, access-checked Suspend Tag hydration path.
    getVerifiedCachedArgosItemInquiryGroup: () => null,
    getItemInquiryRows: () => [master],
    // The modal VM fixture has no editable controls; production captures a
    // baseline so silent hydration cannot overwrite later user input.
    captureArgosInventoryTransactionDraftBaseline: () => [],
    showToast: (...args) => toasts.push(args),
    canUseProductionLiveSync: () => true,
    getSupabaseReadIdentityScope: () => context.owner,
    getCurrentVisibleViewId: () => context.view,
    clearSupabaseReadFailuresForVisibleContext: () => {},
    loadArgosItemInquiryRows: (row, options) => { calls.push({ row, options }); return new Promise(resolve => { resolveRead = resolve; }); },
    ensureArgosInventoryTransactionModal: () => modal,
    getArgosInventorySourceSnapshot: row => ({ uniqueId: row.UNIQUE_ID }),
    buildItemInquiryViewModel: (row, rows) => ({ row, rows,
      locationRows: rows.map(item => ({ unique_id: item.UNIQUE_ID, values: { priority: item.PRIORITY || '' } })) }),
    getArgosReclassV3HoldProposal: () => null, getArgosReclassV3ActionCountForEntry: () => 0,
    getArgosReclassTemporaryOverlayMap: () => new Map(),
    renderArgosInventoryTransactionSource: () => '',
    renderArgosReclassInquiryEditor: () => '',
    resetArgosReclassMultiActionState: () => {},
    generateArgosInventoryTransactionId: () => 'inquiry-token',
    getArgosReclassLiveEditIdentityKey: () => 'actor-a',
    readPendingArgosInventoryReclassMove: () => null,
    refreshArgosInventoryTransactionLotOptions: () => {},
    refreshArgosInventoryTransactionPriorityOptions: () => {},
    setArgosInventoryTransactionAction: () => {},
    setArgosInventoryTransactionHoldAction: () => {},
    toggleArgosInventoryTransactionHoldActionPicker: () => {},
    getDriveSearchTerm: () => { throw new Error('Suspend Tag must not capture Drive context'); },
  });
  vm.runInContext(['getReadableCachedArgosItemInquiryGroup', 'hasUnsavedArgosInventoryTransactionDraft',
    'getArgosItemInquiryRenderSignature', 'shouldApplyArgosItemInquiryRefresh',
    'openArgosInventoryTransactionModal', 'closeArgosInventoryTransactionModal'].map(extract).join('\n'), context);
  return { context, master, modal, dom, calls, toasts, flushPaint: () => { while (frames.length) frames.shift()(); }, resolve: value => resolveRead(value) };
}

test('Suspend Tag modal uses the hydrated inventory group and closes without altering filters or view', async () => {
  const h = modalHarness();
  h.context.openArgosInventoryTransactionModal('master-row', 'reclass', 'suspend-tag');
  assert.equal(h.calls.length, 0, 'the loaded row opens before the exact read starts');
  assert.equal(h.context.argosInventoryTransactionState.item, h.master);
  assert.equal(h.modal.classList.contains('hidden'), false);
  h.flushPaint();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].row, h.master);
  assert.ok(h.calls[0].options.signal instanceof AbortSignal);
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

test('late inventory reads cannot replace the open row after identity, view, revision, or access changes', async () => {
  for (const change of [
    ctx => { ctx.owner = 'account-b'; },
    ctx => { ctx.view = 'drive'; },
    ctx => { ctx.argosInquiryOpenRevision += 1; },
    ctx => { ctx.canCurrentUserViewDockSuspendDcRequests = () => false; ctx.permission = 'permission-revoked'; },
  ]) {
    const h = modalHarness();
    h.context.openArgosInventoryTransactionModal('master-row', 'reclass', 'suspend-tag');
    const openedState = h.context.argosInventoryTransactionState;
    h.flushPaint();
    change(h.context);
    const fresh = { ...h.master, PRIORITY: '2' };
    h.resolve({ row: fresh, rows: [fresh], scope: 'account-a', permission: 'permission-a' });
    await new Promise(setImmediate);
    assert.equal(h.context.argosInventoryTransactionState, openedState);
    assert.equal(openedState.item, h.master, 'a stale read cannot install its returned row');
    assert.equal(openedState.verifiedInquiryGroup, null, 'a stale read cannot install proof');
    h.dom.window.close();
  }
});
