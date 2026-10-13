// @test-group: suspend
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const css = readFileSync(new URL('../assets/ops-precision-pilot.css', import.meta.url), 'utf8');
function extract(name) {
  const start = html.indexOf(`        function ${name}(`);
  assert.ok(start >= 0, name);
  const end = html.slice(start + 10).search(/\n        (?:async )?function \w+\(/);
  assert.ok(end > 0, `${name} boundary`);
  return html.slice(start, start + 10 + end);
}

function harness(t, { photo = true, allowed = true, driveAllowed = true, master = true, status = 'pending' } = {}) {
  const dom = new JSDOM('<!doctype html><div id="request-content"></div>', { runScripts: 'dangerously' });
  t.after(() => dom.window.close());
  const w = dom.window, calls = [];
  const item = { UNIQUE_ID: 'dock_suspend_dc_soc-1', DOM_ID: 'request-soc-1', COMMONNAME: 'Test tree', CONTSIZE: '#3', ITEMCODE: 'SKU-1', LOTCODE: '27.U3', LOCATIONCODE: 'A1', DOCK_NUM: '12', DOCK_SPEC: 'Full', suspend_tag_status: status, suspend_tag_delivery_status: 'failed' };
  const inventory = master ? { ...item, UNIQUE_ID: 'master-1', SOURCE_TABLE: 'ph_master_inventory' } : null;
  const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll("'", '&#39;');
  Object.assign(w, {
    item, activeReqTab: 'suspend-tag', sourceView: 'request', activeDetailSourceView: '', lastView: 'request',
    esc, escJsAttrValue: esc, firstNonEmptyValue: (...values) => values.find(v => v != null && String(v).trim()) ?? '',
    isDockSuspendDcRequestMirrorRow: row => row?.UNIQUE_ID === item.UNIQUE_ID,
    findDockSuspendDcRequestSourceRow: () => ({ UNIQUE_ID: 'soc-1', SOURCE_TABLE: 'ph_soc_master' }),
    getDockSuspendDcRequestLinkedMasterRow: () => inventory,
    canCurrentUserViewDockSuspendDcRequests: () => allowed,
    canCurrentUserUseDriveCardOptions: () => driveAllowed,
    canCurrentUserSubmitRepInventoryOperations: () => false,
    canUseProductionLiveSync: () => false,
    getDockStopOrDropValue: () => '3', getDockDisplayQty: () => 8, formatDockDisplayQty: String,
    getOperationalCardInventoryRow: () => inventory, buildInventoryQuantityChipsHtml: () => '<div>On Hand 8</div>',
    getSuspendTagStatus: row => row.suspend_tag_status,
    findDockSuspendDcRequestMirrorRowByUniqueId: uid => uid === item.UNIQUE_ID ? item : null,
    retryPendingSuspendTagInventoryReconciliations() {}, showToast() {},
    openDetail: (...args) => calls.push(['detail', ...args]),
    openArgosInventoryTransactionModal: (...args) => { calls.push(['reclass', ...args]); return false; },
    toggleGlobalItem: (...args) => calls.push(['select', ...args]),
    completeDockSuspendDcRequestFromCard: uid => { calls.push(['done', uid]); return false; },
    sendSuspendTagApproval: uid => { calls.push(['approval', uid]); return false; },
    sendDockSuspendDcPhotoSpecEmail: uid => { calls.push(['share', uid]); return false; },
    seasonCardShellClass: '', requestCardToneClass: '', requestBorderClass: '', suspendTagPlanstartToneDataAttr: '',
    isChecked: '', requestCustomer: 'A customer', safeCardSourceViewKey: 'request', historyBadge: '', statusChip: '', reserveBadge: '',
    requestMetaHtml: '<div class="app-request-card-meta"><span class="app-request-card-meta-chip">Customer <strong>A long customer name</strong></span></div>',
    holdHtml: '<div class="app-card-note">Hold reason remains complete</div>', requestSalesNoteHtml: '<div class="app-card-note">Sales note remains complete</div>',
    dockSuspendCardDataHtml: '', inventoryEditActionHtml: '', actionBadge: '', inlineThumbHtml: photo ? '<img alt="Tree" src="about:blank">' : '',
    activeFastPress: null, lastFastPressActionKey: '', lastFastPressActionAt: 0, lastFastPressActionScope: '', lastFastPressActionScopeAt: 0,
    lastFastPressSuppressSessionId: 0, lastFastPressSuppressUntil: 0, lastFastPressSuppressScope: '', touchInteractionSessionSerial: 1,
    FAST_PRESS_MOVE_THRESHOLD_PX: 14, FAST_PRESS_CLICK_SUPPRESS_MS: 420, FAST_PRESS_SCOPE_SUPPRESS_MS: 280,
    DRIVE_DRILL_FAST_PRESS_ACTIONS: new Set(), shouldSuppressDriveDrillCardClick: () => false, armDriveDrillCardClickSuppression() {},
  });
  for (const name of [
    'encodeFastPressArgs', 'decodeFastPressArgs', 'getFastPressActionKey', 'getFastPressActionScope',
    'clearFastPressGhostClickSuppression', 'armFastPressGhostClickSuppression', 'shouldSuppressFastPressSessionClick',
    'shouldIgnoreFastPressTarget', 'clearActiveFastPress', 'beginFastPress', 'trackFastPressMove', 'cancelFastPress',
    'dispatchFastPressAction', 'finishFastPress', 'shouldSuppressFastPressClick', 'handleFastPressClick', 'handleFastPressKeydown',
    'buildFastPressAttrs', 'buildFastInvokeAttrs', 'stopNestedCardActionPress', 'isArgosInventoryTransactionEligible',
    'buildArgosInventoryTransactionRailHtml', 'buildSharedInventoryCardLayout', 'buildSuspendTagReclassActionHtml',
    'buildSuspendTagActions', 'openDockSuspendDcRequestUpdate',
  ]) w.eval(extract(name));
  const nestedAttrs = html.match(/const nestedDockActionPressAttrs = '([^\n]+)';/)[1];
  w.nestedDockActionPressAttrs = nestedAttrs;
  w.dockSuspendTagActionHtml = w.buildSuspendTagActions(item, nestedAttrs);
  const start = html.indexOf("                if (isDockSuspendDcRequestMirrorRow(item) && activeReqTab === 'suspend-tag') {", html.indexOf('function generateCard('));
  const end = html.indexOf('\n                }', start) + '\n                }'.length;
  const markup = w.eval(`(function () { ${html.slice(start, end)} })()`);
  w.document.getElementById('request-content').innerHTML = markup;
  const card = w.document.querySelector('article');
  assert.ok(card, 'render the actual Suspend Tag card branch');
  function pointer(type, target = card, y = 0) {
    const event = new w.MouseEvent(type, { bubbles: true, cancelable: true, clientX: 5, clientY: y, button: 0 });
    Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'touch' } });
    target.dispatchEvent(event);
  }
  return { w, card, calls, item, pointer };
}

test('card click and Enter open the shared editor for the exact Suspend Tag row', t => {
  const h = harness(t);
  h.card.querySelector('.app-drive-card-title').click();
  h.card.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.equal(h.calls.length, 2);
  for (const call of h.calls) assert.deepEqual([call[0], call[1], call[2], call[3].preferredTab], ['detail', h.item.UNIQUE_ID, 'request', 'request']);
});

test('touch opens once and suppresses its following synthetic click', t => {
  const h = harness(t);
  h.pointer('pointerdown'); h.pointer('pointerup'); h.card.click();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], 'detail');
});

test('scroll or swipe movement cancels opening, including the following click', t => {
  const h = harness(t);
  h.pointer('pointerdown'); h.pointer('pointermove', h.card, 70); h.pointer('pointerup', h.card, 70); h.card.click();
  assert.deepEqual(h.calls, []);
});

test('Reclass uses the linked master and never opens the row editor', t => {
  const h = harness(t);
  const button = h.card.querySelector('.app-drive-card-reclass button');
  h.pointer('pointerdown', button); h.pointer('pointerup', button); button.querySelector('span').click();
  assert.deepEqual(h.calls, [['reclass', 'master-1', 'reclass', 'suspend-tag']]);
});

test('selection, completion, and sharing stay independent of the card editor', t => {
  const h = harness(t);
  h.card.querySelector('input').click();
  for (const button of h.card.querySelectorAll('.app-suspend-tag-actions button')) button.click();
  assert.deepEqual(h.calls.map(call => call[0]), ['select', 'done', 'share']);
});

test('pending whole-view verification leaves Mark Done available for its awaited row check', t => {
  const h = harness(t);
  const start = html.indexOf('const SUSPEND_TAG_WRITE_ACTION_NAMES = new Set(');
  const end = html.indexOf('        function isSuspendTagWriteSurface(', start);
  h.w.eval(`${html.slice(start, end)}\nconst suspendTagWriteControlState = new WeakMap();\n${extract('isSuspendTagWriteControl')}\n${extract('applySuspendTagWriteProofToNode')}\napplySuspendTagWriteProofToNode(document.getElementById('request-content'), false);`);
  const actions = Array.from(h.card.querySelectorAll('.app-suspend-tag-actions button'));
  assert.equal(actions.find(button => button.textContent === 'Mark Done').disabled, false);
  assert.equal(actions.find(button => button.textContent === 'Share Photo / Spec Options').disabled, true, 'sharing retains its existing freshness gate');
  assert.equal(h.card.querySelector('.app-drive-card-reclass button').disabled, false);
});

test('permission and missing-inventory guards never invent a Reclass target', t => {
  for (const options of [{ allowed: false }, { driveAllowed: false }, { master: false }]) {
    const h = harness(t, options);
    assert.equal(h.card.querySelector('.app-drive-card-reclass'), null);
    assert.equal(h.card.classList.contains('app-drive-card-with-reclass'), false);
    if (options.allowed === false) { h.card.click(); assert.deepEqual(h.calls, []); }
  }
});

test('photo and no-photo cards put exactly one standard Reclass in the shared header slot', t => {
  for (const photo of [true, false]) {
    const h = harness(t, { photo });
    assert.equal(h.card.querySelectorAll('.app-card-bottom-btn--argos-reclass').length, 1);
    assert.ok(h.card.querySelector('.app-drive-card-grid > .app-drive-card-reclass'));
    assert.equal(h.card.querySelector('.app-request-card-bottom .app-card-bottom-btn--argos-reclass'), null);
    assert.equal(h.card.querySelector('.app-drive-card-grid').classList.contains('app-drive-card-grid--no-photo'), !photo);
    assert.ok(h.card.classList.contains('app-drive-card-with-reclass'));
    assert.ok(h.card.textContent.includes('Hold reason remains complete'));
    assert.ok(h.card.textContent.includes('Sales note remains complete'));
    assert.equal([...h.card.querySelectorAll('button')].some(button => button.textContent === 'Photo / Specs'), false);
  }
});

test('approval and retry actions survive removal of the standalone editor button', t => {
  for (const [status, action] of [['completed', 'Email Rep for Approval'], ['awaiting_rep', 'Retry Delivery']]) {
    const h = harness(t, { status });
    const button = [...h.card.querySelectorAll('button')].find(node => node.textContent === action);
    assert.ok(button); button.click();
    assert.deepEqual(h.calls, [['approval', h.item.UNIQUE_ID]]);
  }
});

test('Suspend Tag density is scoped and keeps readable wrapping notes and touch targets', () => {
  const rules = css.slice(css.indexOf('/* Suspend Tag keeps the shared Drive frame'));
  assert.match(rules, /\.app-operational-card-header-fields \{ gap: 4px 6px; margin-bottom: 4px;/);
  assert.match(rules, /\.app-request-card-meta \{ display: flex; flex-wrap: wrap; gap: 4px 6px; margin: 0;/);
  assert.match(rules, /:is\(\.app-card-note, \.app-suspend-tag-data-note\) \{ margin: 0; padding: 6px; box-shadow: none; overflow-wrap: anywhere;/);
  assert.match(rules, /\.app-suspend-tag-action \{ min-width: 44px; min-height: 44px; padding: 6px 8px;/);
  assert.doesNotMatch(rules, /line-clamp|max-height|overflow:\s*hidden/);
  for (const selector of rules.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)) {
    assert.ok(selector[1].trim().startsWith('#request-content .app-suspend-tag-compact-card '));
  }
});
