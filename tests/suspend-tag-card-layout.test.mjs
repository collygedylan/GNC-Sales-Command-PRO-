import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: suspend
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const html = readComposedAppSource().replace(/\r\n/g, '\n');
const css = readFileSync(new URL('../assets/ops-precision-pilot.css', import.meta.url), 'utf8');
const themeCss = readFileSync(new URL('../assets/theme-tokens.css', import.meta.url), 'utf8');
const tailwindCss = readFileSync(new URL('../assets/live-tailwind-v2026082010.min.css', import.meta.url), 'utf8');
const suspendContrastCss = html.match(/<style id="suspend-card-contrast">([\s\S]*?)<\/style>/)?.[1] || '';
const docksContrastCss = html.match(/<style id="docks-card-contrast">([\s\S]*?)<\/style>/)?.[1] || '';

function applyProductionCardStyles(window) {
  const style = window.document.createElement('style');
  style.textContent = `${themeCss}\n${tailwindCss}\n${css}\n${suspendContrastCss}\n${docksContrastCss}`;
  window.document.head.append(style);
}

function extractCssBlock(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing CSS marker ${marker}`);
  const brace = source.indexOf('{', start);
  assert.ok(brace >= 0, `missing CSS block ${marker}`);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(brace + 1, index);
    }
  }
  assert.fail(`unterminated CSS block ${marker}`);
}

test('pastel Suspend cards use dark text in both themes without recoloring buttons', t => {
  const styles = html.match(/<style id="suspend-card-contrast">([\s\S]*?)<\/style>/)?.[1];
  assert.ok(styles);
  const dom = new JSDOM(`<style>.text-white { color: white; } button { color: white; background: #166534; } ${styles}</style><div id="request-content"><article role="button" class="app-suspend-tag-compact-card app-planstart-tuesday"><h3 class="text-white">Tree</h3><p class="text-white"><span>Customer</span></p><button><span>Done</span></button></article></div>`);
  t.after(() => dom.window.close());
  for (const dark of [false, true]) {
    dom.window.document.documentElement.classList.toggle('dark', dark);
    for (const selector of ['h3', 'p', 'p span']) assert.equal(dom.window.getComputedStyle(dom.window.document.querySelector(selector)).color, 'rgb(17, 24, 39)');
    assert.equal(dom.window.getComputedStyle(dom.window.document.querySelector('button')).color, 'rgb(255, 255, 255)');
    assert.equal(dom.window.getComputedStyle(dom.window.document.querySelector('button span')).color, 'rgb(255, 255, 255)');
  }
});

test('operational Docks weekday cards keep dark readable text and independent button colors', t => {
  const styles = html.match(/<style id="docks-card-contrast">([\s\S]*?)<\/style>/)?.[1];
  assert.ok(styles);
  const dom = new JSDOM(`<style>.text-white { color:white; } button { color:white; background:#166534; } ${styles}</style><div id="docks-content"><article class="app-smart-card app-operational-planstart-card app-card-planstart-monday app-planstart-monday"><h3 class="text-white">Monday dock</h3><button>Flag Issue</button></article></div>`);
  t.after(() => dom.window.close());
  for (const dark of [false, true]) {
    dom.window.document.body.dataset.opsTheme = dark ? 'dark' : 'light';
    dom.window.document.body.classList.add('ops-precision-pilot');
    assert.equal(dom.window.getComputedStyle(dom.window.document.querySelector('h3')).color, 'rgb(17, 24, 39)');
    assert.equal(dom.window.getComputedStyle(dom.window.document.querySelector('button')).color, 'rgb(255, 255, 255)');
  }
});
function extract(name) {
  const start = html.indexOf(`        function ${name}(`);
  assert.ok(start >= 0, name);
  const end = html.slice(start + 10).search(/\n        (?:async )?function \w+\(/);
  assert.ok(end > 0, `${name} boundary`);
  return html.slice(start, start + 10 + end);
}

function harness(t, { photo = true, allowed = true, driveAllowed = true, master = true, status = 'pending', productionStyles = false } = {}) {
  const dom = new JSDOM('<!doctype html><div id="request-content"></div>', { runScripts: 'dangerously' });
  t.after(() => dom.window.close());
  const w = dom.window, calls = [];
  if (productionStyles) {
    w.document.body.classList.add('ops-precision-pilot', 'current-view-request');
    applyProductionCardStyles(w);
  }
  const item = { UNIQUE_ID: 'dock_suspend_dc_soc-1', DOM_ID: 'request-soc-1', COMMONNAME: 'Test tree', CONTSIZE: '#3', ITEMCODE: 'SKU-1', LOTCODE: '27.U3', LOCATIONCODE: 'A1', DOCK_NUM: 'Dock 30', DOCK_SPEC: 'Full', PLANSTART: '10/19/2026', HOLDSTOPCODE: 'H', HOLDSTOPREASON: 'Await release', CONSIGNEENAME: 'A consignee', SALESREPNAME: 'A rep', suspend_tag_status: status, suspend_tag_delivery_status: 'failed' };
  const inventory = master ? { ...item, UNIQUE_ID: 'master-1', SOURCE_TABLE: 'ph_master_inventory' } : null;
  const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll("'", '&#39;');
  Object.assign(w, {
    item, activeReqTab: 'suspend-tag', sourceView: 'request', activeDetailSourceView: '', lastView: 'request',
    esc, escJsAttrValue: esc, firstNonEmptyValue: (...values) => values.find(v => v != null && String(v).trim()) ?? '',
    cleanHoldCode: 'H', holdReasonText: 'Await release',
    isDockSuspendDcRequestMirrorRow: row => row?.UNIQUE_ID === item.UNIQUE_ID,
    findDockSuspendDcRequestSourceRow: () => ({ UNIQUE_ID: 'soc-1', SOURCE_TABLE: 'ph_soc_master' }),
    getDockSuspendDcRequestLinkedMasterRow: () => inventory,
    getSuspendTagHydratedInventoryRow: () => null,
    isSuspendTagHydratedInventoryRowStale: () => false,
    scheduleSuspendTagReclassLoads() {},
    canCurrentUserViewDockSuspendDcRequests: () => allowed,
    canCurrentUserUseDriveCardOptions: () => driveAllowed,
    canCurrentUserSubmitRepInventoryOperations: () => false,
    canUseProductionLiveSync: () => false,
    getDockSuspendDcRequestPlanstartValue: row => row.PLANSTART || '',
    getDockStopOrDropValue: () => '3', getDockDisplayQty: () => 8, formatDockDisplayQty: String,
    getOperationalCardInventoryRow: () => inventory, buildInventoryQuantityChipsHtml: () => '<div class="app-card-qty-row"><span>On Hand</span><span>Review</span><span>Available</span><span>Open Stock</span><span>Loc Photo Match</span><span>Loc On Hand</span></div>',
    getSuspendTagStatus: row => row.suspend_tag_status,
    findDockSuspendDcRequestMirrorRowByUniqueId: uid => uid === item.UNIQUE_ID ? item : null,
    retryPendingSuspendTagInventoryReconciliations() {}, showToast() {},
    openDetail: (...args) => calls.push(['detail', ...args]),
    openArgosInventoryTransactionModal: (...args) => { calls.push(['reclass', ...args]); return false; },
    toggleGlobalItem: (...args) => calls.push(['select', ...args]),
    completeDockSuspendDcRequestFromCard: uid => { calls.push(['done', uid]); return false; },
    sendSuspendTagApproval: uid => { calls.push(['approval', uid]); return false; },
    emailSuspendTagFromCard: uid => { calls.push(['email', uid]); return false; },
    closeDockSuspendDcRequestFromCard: uid => { calls.push(['close', uid]); return false; },
    seasonCardShellClass: '', requestCardToneClass: '', requestBorderClass: '', suspendTagPlanstartToneDataAttr: '',
    isChecked: '', requestCustomer: 'A customer', requestConsignee: 'A consignee', suspendSalesRep: 'A rep', suspendRequestQty: '8', requestCaliper: '', safeCardSourceViewKey: 'request', historyBadge: '', statusChip: '<span>Pending</span>', reserveBadge: '<span>Reserve: NO</span>', reserve: 'NO',
    requestMetaChip: (label, value) => `<span class="app-request-card-meta-chip"><span>${label}</span><strong>${esc(value)}</strong></span>`,
    getSupabaseReadIdentityScope: () => 'suspend-card-layout-test-account',
    suspendTagCompletionActions: new Set(),
    requestMetaHtml: '<div class="app-request-card-meta"><span class="app-request-card-meta-chip">Customer <strong>A long customer name</strong></span></div>',
    suspendOperationalMetaHtml: '<div class="app-operational-card-meta"><span class="app-request-card-meta-chip">Sales Rep <strong>A rep</strong></span><span class="app-request-card-meta-chip">Request Qty <strong>8</strong></span></div>',
    holdHtml: '<div class="app-card-note">Hold reason remains complete</div>', requestSalesNoteHtml: '<div class="app-card-note">Sales note remains complete</div>',
    dockSuspendCardDataHtml: '', inventoryEditActionHtml: '', actionBadge: '', inlineThumbHtml: photo ? '<img alt="Tree" src="about:blank">' : '',
    activeFastPress: null, lastFastPressActionKey: '', lastFastPressActionAt: 0, lastFastPressActionScope: '', lastFastPressActionScopeAt: 0,
    lastFastPressSuppressSessionId: 0, lastFastPressSuppressUntil: 0, lastFastPressSuppressScope: '', touchInteractionSessionSerial: 1,
    FAST_PRESS_MOVE_THRESHOLD_PX: 14, FAST_PRESS_CLICK_SUPPRESS_MS: 420, FAST_PRESS_SCOPE_SUPPRESS_MS: 280,
    DRIVE_DRILL_FAST_PRESS_ACTIONS: new Set(), shouldSuppressDriveDrillCardClick: () => false, armDriveDrillCardClickSuppression() {},
    suspendTagCardActionDelegationBound: false,
  });
  for (const name of [
    'encodeFastPressArgs', 'decodeFastPressArgs', 'getFastPressActionKey', 'getFastPressActionScope',
    'clearFastPressGhostClickSuppression', 'armFastPressGhostClickSuppression', 'shouldSuppressFastPressSessionClick',
    'shouldIgnoreFastPressTarget', 'clearActiveFastPress', 'beginFastPress', 'trackFastPressMove', 'cancelFastPress',
    'dispatchFastPressAction', 'finishFastPress', 'shouldSuppressFastPressClick', 'handleFastPressClick', 'handleFastPressKeydown',
    'buildFastPressAttrs', 'buildFastInvokeAttrs', 'stopNestedCardActionPress', 'getDockSuspendDcRequestSourceUid', 'isArgosInventoryTransactionEligible',
    'initializeSuspendTagCardActionDelegation',
    'buildArgosInventoryTransactionRailHtml', 'buildArgosInventoryTransactionRailPlaceholderHtml',
    'parseDockCardPlanStartEpochDay', 'formatDockCardPlanStartValue',
    'buildSharedInventoryCardLayout', 'buildSuspendTagReclassActionHtml',
    'buildSuspendTagActions', 'openDockSuspendDcRequestUpdate',
  ]) w.eval(extract(name));
  const nestedAttrs = html.match(/const nestedDockActionPressAttrs = '([^\n]+)';/)[1];
  w.nestedDockActionPressAttrs = nestedAttrs;
  w.suspendOperationalMetaHtml = w.eval(html.match(/const suspendOperationalMetaHtml = ([^\n]+);/)[1]);
  w.dockSuspendTagActionHtml = w.buildSuspendTagActions(item, nestedAttrs, w.formatDockCardPlanStartValue(item.PLANSTART));
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
  const meta = h.card.querySelector('.app-operational-card-meta');
  const order = h.card.querySelector('.app-suspend-tag-order-strip');
  assert.ok(order);
  assert.equal(meta, null, 'the compact order fields are rendered only once');
  assert.deepEqual([...order.querySelectorAll('.app-suspend-tag-order-field > span:first-child')].map(node => node.textContent), ['Dock', 'Drop', 'Qty', 'Consignee', 'Sales Rep']);
  assert.equal(order.textContent.includes('A consignee'), true);
  assert.equal(order.textContent.includes('A rep'), true);
  h.card.querySelector('.app-drive-card-title').click();
  h.card.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.equal(h.calls.length, 2);
  for (const call of h.calls) assert.deepEqual([call[0], call[1], call[2], call[3].preferredTab], ['detail', h.item.UNIQUE_ID, 'request', 'request']);
});

test('Suspend Tag shows five order fields before six inventory metrics and places one hold row before PLANSTART', t => {
  const h = harness(t);
  const order = h.card.querySelector('.app-suspend-tag-order-strip');
  const metrics = h.card.querySelector('.app-card-qty-row');
  const hold = h.card.querySelector('.app-suspend-tag-holdstop-row');
  const status = h.card.querySelector('.app-suspend-tag-status');
  assert.ok(order && metrics && hold && status);
  assert.ok(order.compareDocumentPosition(metrics) & h.w.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(metrics.compareDocumentPosition(hold) & h.w.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(hold.compareDocumentPosition(status) & h.w.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.equal(order.querySelectorAll('.app-suspend-tag-order-field').length, 5);
  assert.equal(metrics.children.length, 6);
  assert.ok(hold.textContent.includes('H') && hold.textContent.includes('Await release'));
  assert.equal(h.card.querySelectorAll('.app-suspend-tag-holdstop-row').length, 1);
  assert.match(status.textContent, /PLANSTART:\s*10\/19\/2026/);
});

test('Suspend Tag mobile metrics use a readable three-by-two grid and keep numeric values on one line', () => {
  const mobileBlock = [...css.matchAll(/@media \(max-width:\s*639px\)\s*\{([\s\S]*?)\n\}/g)].at(-1)?.[1] || '';
  assert.match(mobileBlock, /\.app-suspend-tag-compact-card \.app-card-qty-row\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/s);
  assert.match(mobileBlock, /\.app-suspend-tag-compact-card \.app-card-qty-value\s*\{[^}]*white-space:\s*nowrap !important;[^}]*overflow-wrap:\s*normal !important;/s);
  assert.match(mobileBlock, /\.app-suspend-tag-compact-card \.app-card-qty-chip\s*\{[^}]*min-width:\s*0;/s);
  assert.match(css, /\.app-suspend-tag-order-strip\s*\{[^}]*grid-template-columns:\s*repeat\(5,/s);
  assert.match(css, /\.app-suspend-tag-compact-card \.app-card-qty-row\s*\{[^}]*grid-template-columns:\s*repeat\(6,/s);
});

test('Suspend Tag mobile compaction preserves desktop order-field font sizes', () => {
  const field = extractCssBlock(css, '#request-content .app-suspend-tag-compact-card .app-suspend-tag-order-field {');
  const strong = extractCssBlock(css, '#request-content .app-suspend-tag-compact-card .app-suspend-tag-order-field strong {');
  const mobile = extractCssBlock(css, '@media (max-width: 600px) {');
  assert.match(field, /font-size:\s*14px/);
  assert.match(strong, /font-size:\s*14px/);
  assert.doesNotMatch(mobile, /app-suspend-tag-order-field[^}]*font-size\s*:/s);
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

test('selection, Email, and Complete Tag stay independent of the card editor', t => {
  const h = harness(t);
  h.card.querySelector('input').click();
  for (const button of h.card.querySelectorAll('.app-suspend-tag-actions button')) button.click();
  assert.deepEqual(h.calls.map(call => call[0]), ['select', 'email', 'close']);
  assert.equal([...h.card.querySelectorAll('.app-suspend-tag-actions button')].some(button => button.textContent === 'Mark Done'), false);
});

test('pending whole-view verification leaves Email and Complete Tag available for their awaited checks', t => {
  const h = harness(t);
  const start = html.indexOf('const SUSPEND_TAG_WRITE_ACTION_NAMES = new Set(');
  const end = html.indexOf('        function isSuspendTagWriteSurface(', start);
  h.w.eval(`${html.slice(start, end)}\nconst suspendTagWriteControlState = new WeakMap();\n${extract('isSuspendTagWriteControl')}\n${extract('getSuspendTagWriteActionKey')}\n${extract('isSuspendTagWriteActionBusy')}\n${extract('syncSuspendTagActionBusyState')}\n${extract('applySuspendTagWriteProofToNode')}\napplySuspendTagWriteProofToNode(document.getElementById('request-content'), false);`);
  const actions = Array.from(h.card.querySelectorAll('.app-suspend-tag-actions button'));
  assert.equal(actions.find(button => button.textContent === 'Email').disabled, false);
  assert.equal(actions.find(button => button.textContent === 'Complete Tag').disabled, false, 'closure performs its own awaited row verification');
  assert.equal(actions.some(button => button.textContent === 'Mark Done' || button.textContent === 'Share Photo / Spec Options'), false);
  assert.equal(h.card.querySelector('.app-drive-card-reclass button').disabled, false);
});

test('fresh read proof cannot re-enable a Suspend Tag action while its owner-scoped command is in flight', t => {
  const h = harness(t);
  const requestId = h.card.getAttribute('data-request-uid');
  const sourceUid = 'soc-1';
  const proofAction = h.w.document.createElement('button');
  proofAction.setAttribute('onclick', `markDockSuspendDcRequestHandled('${requestId}')`);
  h.card.append(proofAction);
  const start = html.indexOf('const SUSPEND_TAG_WRITE_ACTION_NAMES = new Set(');
  const end = html.indexOf('        function isSuspendTagWriteSurface(', start);
  h.w.eval(`${html.slice(start, end)}
const suspendTagWriteControlState = new WeakMap();
const suspendTagCompletionActions = new Set(['scope-1|${sourceUid}']);
const getSupabaseReadIdentityScope = () => 'scope-1';
const getDockSuspendDcRequestSourceUid = item => item?.DOCK_SUSPEND_SOURCE_UID || '';
const findDockSuspendDcRequestMirrorRowByUniqueId = uid => uid === '${requestId}' ? { UNIQUE_ID: '${requestId}', DOCK_SUSPEND_SOURCE_UID: '${sourceUid}' } : null;
${extract('isSuspendTagWriteControl')}
${extract('getSuspendTagWriteActionKey')}
${extract('isSuspendTagWriteActionBusy')}
${extract('syncSuspendTagActionBusyState')}
${extract('applySuspendTagWriteProofToNode')}
applySuspendTagWriteProofToNode(document.getElementById('request-content'), false);
applySuspendTagWriteProofToNode(document.getElementById('request-content'), true);`);
  assert.equal(proofAction.disabled, true);
  assert.equal(proofAction.getAttribute('aria-disabled'), 'true',
    'the proof gate must not override the exact row command lock after a fresh render');
});

test('late-staged Email and Complete Tag actions inherit an exact in-flight row lock', t => {
  const h = harness(t);
  const requestId = h.card.getAttribute('data-request-uid');
  const sourceUid = 'soc-1';
  h.w.eval(`
const suspendTagWriteControlState = new WeakMap();
const suspendTagCompletionActions = new Set(['scope-1|${sourceUid}']);
const getSupabaseReadIdentityScope = () => 'scope-1';
const getDockSuspendDcRequestSourceUid = item => item?.DOCK_SUSPEND_SOURCE_UID || '';
const findDockSuspendDcRequestMirrorRowByUniqueId = uid => uid === '${requestId}' ? { UNIQUE_ID: '${requestId}', DOCK_SUSPEND_SOURCE_UID: '${sourceUid}' } : null;
${extract('isSuspendTagWriteControl')}
${extract('getSuspendTagWriteActionKey')}
${extract('isSuspendTagWriteActionBusy')}
${extract('syncSuspendTagActionBusyState')}
${extract('applySuspendTagWriteProofToNode')}`);
  for (const label of ['Email', 'Complete Tag']) {
    const staged = h.w.document.createElement('button');
    staged.className = 'app-suspend-tag-action';
    staged.textContent = label;
    h.card.querySelector('.app-suspend-tag-actions').append(staged);
    h.w.applySuspendTagWriteProofToNode(staged, true);
    assert.equal(staged.disabled, true, `${label} inserted after lock acquisition must not appear enabled`);
    assert.equal(staged.getAttribute('aria-disabled'), 'true');
  }
});

test('owner-keyed release remains authoritative after observing initially-busy markup', t => {
  const h = harness(t);
  const requestId = h.card.getAttribute('data-request-uid');
  const sourceUid = 'soc-1';
  h.w.suspendTagCompletionActions = new Set([`scope-1|${sourceUid}`]);
  h.w.getSupabaseReadIdentityScope = () => 'scope-1';
  h.w.getDockSuspendDcRequestSourceUid = item => item?.DOCK_SUSPEND_SOURCE_UID || '';
  h.w.findDockSuspendDcRequestMirrorRowByUniqueId = uid => uid === requestId ? { UNIQUE_ID: requestId, DOCK_SUSPEND_SOURCE_UID: sourceUid } : null;
  h.w.eval(`
const SUSPEND_TAG_WRITE_ACTION_NAMES = new Set(['markDockSuspendDcRequestHandled']);
const suspendTagWriteControlState = new WeakMap();
${extract('isSuspendTagWriteControl')}
${extract('getSuspendTagWriteActionKey')}
${extract('isSuspendTagWriteActionBusy')}
${extract('syncSuspendTagActionBusyState')}
${extract('applySuspendTagWriteProofToNode')}
${extract('setSuspendTagCardActionsBusy')}`);
  const staged = h.w.document.createElement('button');
  staged.className = 'app-suspend-tag-action';
  staged.disabled = true;
  staged.setAttribute('aria-disabled', 'true');
  h.card.querySelector('.app-suspend-tag-actions').append(staged);
  h.w.applySuspendTagWriteProofToNode(staged, true);
  assert.equal(staged.disabled, true);

  h.w.suspendTagCompletionActions.delete(`scope-1|${sourceUid}`);
  assert.equal(h.w.setSuspendTagCardActionsBusy(requestId, 'scope-1', false), true);
  h.w.applySuspendTagWriteProofToNode(staged, true);
  assert.equal(staged.disabled, false, 'later proof passes must not restore stale busy=true markup');
  assert.equal(staged.hasAttribute('aria-disabled'), false);
  assert.equal(staged.hasAttribute('title'), false, 'released controls must not retain the busy tooltip');
});

test('owner-keyed release preserves disabled state not owned by its busy marker', t => {
  const h = harness(t);
  const scope = h.w.getSupabaseReadIdentityScope();
  const requestId = h.card.getAttribute('data-request-uid');
  const email = h.card.querySelector('.app-suspend-tag-action');
  email.disabled = true;
  const sourceUid = h.w.getDockSuspendDcRequestSourceUid(h.item);
  h.w.eval(`${extract('setSuspendTagCardActionsBusy')}`);
  assert.equal(h.w.setSuspendTagCardActionsBusy(requestId, scope, false), true);
  assert.equal(email.disabled, true, 'release must not enable a control without the matching busy marker');
});

test('the write-control observer reconciles stale owner markers on existing buttons', async t => {
  const h = harness(t);
  const requestId = h.card.getAttribute('data-request-uid');
  const sourceUid = 'soc-1';
  const scope = 'scope-1';
  const email = h.card.querySelector('.app-suspend-tag-actions .app-suspend-tag-action');
  assert.ok(email);
  h.w.getSupabaseReadIdentityScope = () => scope;
  h.w.getDockSuspendDcRequestSourceUid = row => row?.DOCK_SUSPEND_SOURCE_UID || '';
  h.w.findDockSuspendDcRequestMirrorRowByUniqueId = uid => uid === requestId
    ? { UNIQUE_ID: requestId, DOCK_SUSPEND_SOURCE_UID: sourceUid }
    : null;
  h.w.suspendTagCompletionActions = new Set([`${scope}|${sourceUid}`]);
  const namesStart = html.indexOf('const SUSPEND_TAG_WRITE_ACTION_NAMES = new Set(');
  const namesEnd = html.indexOf('        function isSuspendTagWriteSurface(', namesStart);
  h.w.eval(`${html.slice(namesStart, namesEnd)}
const suspendTagWriteControlState = new WeakMap();
const suspendTagWriteControlObservers = new Map();
const isSuspendTagWriteSurface = () => true;
const canUseProductionLiveSync = () => true;
const hasCurrentSuspendTagWriteProof = () => true;
const getCurrentVisibleViewId = () => 'request';
const activeItem = {};
${extract('isSuspendTagWriteControl')}
${extract('getSuspendTagWriteActionKey')}
${extract('isSuspendTagWriteActionBusy')}
${extract('syncSuspendTagActionBusyState')}
${extract('applySuspendTagWriteProofToNode')}
${extract('updateSuspendTagWriteControlGate')}`);
  h.w.updateSuspendTagWriteControlGate();

  // A render/reconciler drops the disabled attributes from an existing node
  // while the exact owner/source operation is still in flight.
  email.disabled = false;
  email.removeAttribute('aria-disabled');
  email.removeAttribute('data-suspend-action-busy');
  await new Promise(resolve => h.w.setTimeout(resolve, 0));
  assert.equal(email.disabled, true, 'the attribute observer must restore an active exact-row lock');
  assert.equal(email.getAttribute('data-suspend-action-busy'), `${scope}|${sourceUid}`);

  // Once the owner releases, a stale busy patch arriving on that same node is
  // cleared, while the observer remains bounded because normalization is idempotent.
  h.w.suspendTagCompletionActions.delete(`${scope}|${sourceUid}`);
  email.disabled = true;
  email.setAttribute('aria-disabled', 'true');
  email.setAttribute('data-suspend-action-busy', `${scope}|${sourceUid}`);
  await new Promise(resolve => h.w.setTimeout(resolve, 0));
  assert.equal(email.disabled, false, 'a matching stale busy patch must not keep the released row locked');
  assert.equal(email.hasAttribute('aria-disabled'), false);
  assert.equal(email.hasAttribute('data-suspend-action-busy'), false);
});

test('late-mounted markup clears only its matching released owner-keyed busy marker', t => {
  const h = harness(t);
  const scope = h.w.getSupabaseReadIdentityScope();
  const sourceUid = h.w.getDockSuspendDcRequestSourceUid(h.item);
  h.w.suspendTagCompletionActions.add(`${scope}|${sourceUid}`);
  const fragment = h.w.document.createElement('div');
  fragment.innerHTML = h.w.buildSuspendTagActions(h.item);
  const stagedEmail = fragment.querySelector('.app-suspend-tag-action');
  assert.ok(stagedEmail?.disabled);
  assert.equal(stagedEmail.getAttribute('data-suspend-action-busy'), `${scope}|${sourceUid}`);

  h.w.suspendTagCompletionActions.delete(`${scope}|${sourceUid}`);
  h.card.querySelector('.app-suspend-tag-actions').append(stagedEmail);
  h.w.eval(`
const SUSPEND_TAG_WRITE_ACTION_NAMES = new Set(['markDockSuspendDcRequestHandled']);
const suspendTagWriteControlState = new WeakMap();
${extract('isSuspendTagWriteControl')}
${extract('getSuspendTagWriteActionKey')}
${extract('isSuspendTagWriteActionBusy')}
${extract('syncSuspendTagActionBusyState')}
${extract('applySuspendTagWriteProofToNode')}`);
  h.w.applySuspendTagWriteProofToNode(stagedEmail, true);
  assert.equal(stagedEmail.disabled, false);
  assert.equal(stagedEmail.hasAttribute('data-suspend-action-busy'), false);
  assert.equal(stagedEmail.hasAttribute('aria-disabled'), false);
});

test('late-mounted busy markup stays disabled when its row or owner proof is unavailable', t => {
  for (const mismatch of ['missing-row', 'different-owner']) {
    const h = harness(t);
    const sourceUid = h.w.getDockSuspendDcRequestSourceUid(h.item);
    const oldScope = h.w.getSupabaseReadIdentityScope();
    const staged = h.w.document.createElement('button');
    staged.className = 'app-suspend-tag-action';
    staged.disabled = true;
    staged.setAttribute('aria-disabled', 'true');
    staged.setAttribute('data-suspend-action-busy', `${oldScope}|${sourceUid}`);
    h.card.querySelector('.app-suspend-tag-actions').append(staged);
    if (mismatch === 'missing-row') h.w.findDockSuspendDcRequestMirrorRowByUniqueId = () => null;
    else h.w.getSupabaseReadIdentityScope = () => 'different-account';
    h.w.eval(`
const SUSPEND_TAG_WRITE_ACTION_NAMES = new Set(['markDockSuspendDcRequestHandled']);
const suspendTagWriteControlState = new WeakMap();
${extract('isSuspendTagWriteControl')}
${extract('getSuspendTagWriteActionKey')}
${extract('isSuspendTagWriteActionBusy')}
${extract('syncSuspendTagActionBusyState')}
${extract('applySuspendTagWriteProofToNode')}`);
    h.w.applySuspendTagWriteProofToNode(staged, true);
    assert.equal(staged.disabled, true, `${mismatch} must not clear another identity's busy marker`);
    assert.equal(staged.getAttribute('data-suspend-action-busy'), `${oldScope}|${sourceUid}`);
  }
});

test('permission and missing-inventory guards never invent a Reclass target', t => {
  for (const options of [{ allowed: false }, { driveAllowed: false }, { master: false }]) {
    const h = harness(t, options);
    assert.equal(h.card.querySelector('.app-drive-card-reclass'), null);
    assert.equal(h.card.classList.contains('app-drive-card-with-reclass'), false);
    if (options.allowed === false) { h.card.click(); assert.deepEqual(h.calls, []); }
  }
});

test('verified-inventory refresh keeps a disabled Reclass rail with the live button geometry', t => {
  const h = harness(t);
  h.w.getOperationalCardInventoryRow = () => null;
  h.w.getDockSuspendDcRequestLinkedMasterRow = () => null;
  h.w.canUseProductionLiveSync = () => true;
  h.w.isSuspendTagWriteSurface = () => true;
  h.w.buildArgosInventoryTransactionRailHtml = () => '';
  const markup = h.w.buildSuspendTagReclassActionHtml(h.item, 'data-fast-press-ignore');
  const parsed = new JSDOM(`<div id="root">${markup}</div>`, { runScripts: 'dangerously' });
  t.after(() => parsed.window.close());
  const rail = parsed.window.document.querySelector('.app-drive-card-reclass');
  const placeholder = rail?.querySelector('button');
  assert.ok(rail?.hasAttribute('aria-busy'));
  assert.ok(placeholder, 'an exact button-shaped placeholder should reserve the loading rail');
  assert.equal(placeholder.disabled, true);
  assert.equal(placeholder.getAttribute('aria-disabled'), 'true');
  assert.equal(placeholder.hasAttribute('onclick'), false, 'refresh placeholders must not expose a Reclass action');
  assert.equal(placeholder.className, 'app-card-bottom-btn app-card-bottom-btn--argos-reclass');
  assert.equal(placeholder.querySelector('span')?.textContent, 'Reclass');
});

test('photo and no-photo cards put exactly one standard Reclass in the shared header slot', t => {
  for (const photo of [true, false]) {
    const h = harness(t, { photo });
    assert.equal(h.card.querySelectorAll('.app-card-bottom-btn--argos-reclass').length, 1);
    assert.ok(h.card.querySelector('.app-drive-card-header .app-suspend-tag-header-row > .app-drive-card-reclass'));
    const reclass = h.card.querySelector('.app-drive-card-header .app-suspend-tag-header-row > .app-drive-card-reclass');
    const spec = reclass.querySelector('.app-suspend-tag-reclass-spec');
    assert.ok(spec, 'SPEC stays directly below Reclass in the top-right header rail');
    assert.equal(spec.previousElementSibling?.textContent, 'Reclass');
    assert.equal(h.card.querySelectorAll('.app-suspend-tag-reclass-spec').length, 1);
    assert.doesNotMatch(h.card.textContent, /(^|\s)MATCH(?:\s|:|$)/, 'the duplicate MATCH badge is removed');
    const textColumn = h.card.querySelector('.app-suspend-tag-text-column');
    assert.ok(textColumn?.contains(h.card.querySelector('.app-drive-card-title')));
    assert.ok(textColumn?.contains(h.card.querySelector('.app-drive-card-itemcode')));
    assert.ok(textColumn?.contains(h.card.querySelector('.app-drive-card-meta')));
    assert.equal(h.card.querySelector('.app-drive-card-title-row > .app-drive-card-reclass'), null);
    assert.equal(h.card.querySelector('.app-request-card-bottom .app-card-bottom-btn--argos-reclass'), null);
    assert.equal(h.card.querySelector('.app-drive-card-grid').classList.contains('app-drive-card-grid--no-photo'), !photo);
    assert.ok(h.card.classList.contains('app-drive-card-with-reclass'));
    assert.ok(h.card.textContent.includes('Await release'));
    assert.ok(h.card.textContent.includes('Sales note remains complete'));
    assert.equal([...h.card.querySelectorAll('button')].some(button => button.textContent === 'Photo / Specs'), false);
  }
});

test('compact Suspend metadata has Dock/Drop/Qty immediately after location and PLANSTART immediately before actions', t => {
  const h = harness(t);
  const location = h.card.querySelector('.app-drive-card-meta');
  const fields = h.card.querySelector('.app-suspend-tag-order-strip');
  assert.ok(location);
  assert.ok(h.card.querySelector('.app-drive-card-header').compareDocumentPosition(fields) & h.w.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.deepEqual([...fields.querySelectorAll('.app-suspend-tag-order-field')].map(node => node.textContent.replace(/\s+/g, '')), ['Dock30', 'Drop3', 'Qty8', 'ConsigneeAconsignee', 'SalesRepArep']);
  const date = h.card.querySelector('.app-operational-planstart-date');
  assert.equal(date.textContent, 'PLANSTART: 10/19/2026');
  assert.equal(date.nextElementSibling, h.card.querySelector('.app-suspend-tag-actions'));
  assert.ok(h.card.querySelector('.app-request-card-bottom').contains(date));
  assert.equal(h.card.querySelector('.app-drive-card-header .app-operational-planstart-date'), null);
  assert.equal(h.card.querySelector('.app-suspend-tag-status-label'), null);
  assert.doesNotMatch(h.card.textContent, /Pending|Reserve: NO|Customer|Request Qty|Dock Dock/);
});

test('compact Reclass keeps pure white semibold labels across production themes and disabled state', t => {
  const h = harness(t, { productionStyles: true });
  const button = h.card.querySelector('.app-drive-card-reclass button');
  for (const theme of ['light', 'dark', 'outdoor']) {
    h.w.document.body.dataset.opsTheme = theme;
    for (const disabled of [false, true]) {
      button.disabled = disabled;
      for (const element of [button, button.querySelector('span')]) {
        const style = h.w.getComputedStyle(element);
        assert.equal(style.color, 'rgb(255, 255, 255)');
        assert.equal(style.getPropertyValue('-webkit-text-fill-color'), 'rgb(255, 255, 255)');
        assert.equal(style.fontWeight, '600');
      }
    }
  }
});

test('Suspend detail chips omit photo-count and duplicate location-photo badges while preserving notes and specs', t => {
  const h = harness(t);
  Object.assign(h.w, {
    syncDockSuspendDcRequestPhotoAliases() {}, mergePhotoCsvList: () => 'photo.jpg',
    getRowPhotoLink: () => 'photo.jpg', getPendingPhotoPreviewEntries: () => [], getPhotoUrlList: () => ['photo.jpg'],
    getDockSuspendDcRequestCompletionValues: () => ({ spec: 'Full', avNote: 'Keep this note' }),
    getItemDisplayValue: () => '', formatLocPhotoMatchQtyValue: () => 'Not verified', normalizeCardQuantityValue: String
  });
  h.w.eval(extract('buildDockSuspendDcRequestCardDataHtml'));
  const markup = h.w.buildDockSuspendDcRequestCardDataHtml(h.item);
  assert.doesNotMatch(markup, /PHOTOS|LOC PHOTO MATCH/);
  assert.match(markup, /Keep this note/);
  assert.match(h.card.querySelector('.app-suspend-tag-reclass-spec')?.textContent || '', /Full/);
});

test('Email and retry actions use the shared card action guard', t => {
  for (const [status, action] of [['completed', 'Email'], ['pending', 'Email'], ['denied', 'Email'], ['awaiting_rep', 'Retry Delivery']]) {
    const h = harness(t, { status });
    const button = [...h.card.querySelectorAll('button')].find(node => node.textContent === action);
    assert.ok(button); button.click();
    assert.deepEqual(h.calls, [['email', h.item.UNIQUE_ID]]);
  }
});

test('generated email and completion actions stay readable on the real brand-green surface in every theme', t => {
  for (const status of ['completed', 'awaiting_rep', 'pending', 'denied']) {
    const h = harness(t, { status, productionStyles: true });
    const label = status === 'awaiting_rep' ? 'Retry Delivery' : 'Email';
    const buttons = [...h.card.querySelectorAll('.app-suspend-tag-action')];
    const button = buttons.find(node => node.textContent === label);
    const completeTag = buttons.find(node => node.textContent === 'Complete Tag');
    assert.ok(button, `${status} status generates ${label}`);
    assert.ok(completeTag, `${status} status generates Complete Tag`);
    for (const theme of ['light', 'dark', 'outdoor']) {
      h.w.document.body.dataset.opsTheme = theme;
      for (const action of [button, completeTag]) {
        assert.equal(h.w.getComputedStyle(action).backgroundColor, 'rgb(0, 122, 77)', `${theme} ${action.textContent} background`);
        assert.equal(h.w.getComputedStyle(action).color, 'rgb(255, 255, 255)', `${theme} ${action.textContent} label`);
        assert.equal(h.w.getComputedStyle(action).getPropertyValue('-webkit-text-fill-color'), 'rgb(255, 255, 255)', `${theme} ${action.textContent} WebKit text fill`);
      }
    }
    button.disabled = true;
    assert.equal(h.w.getComputedStyle(button).backgroundColor, 'rgb(82, 117, 101)', `${label} disabled surface remains dark`);
    assert.equal(h.w.getComputedStyle(button).color, 'rgb(255, 255, 255)', `${label} disabled label remains readable`);
    button.disabled = false;
  }
  assert.match(css, /#request-content \.app-suspend-tag-compact-card \.app-suspend-tag-action,\s*#request-content \.app-suspend-tag-compact-card \.app-suspend-tag-action :is\(span, i, svg\)\s*\{[^}]*-webkit-text-fill-color:\s*#fff/i);
  for (const [state, color] of [['hover', '#006640'], ['focus-visible', '#006640'], ['active', '#005a38']]) {
    assert.match(css, new RegExp(`#request-content \\\.app-suspend-tag-compact-card \\\.app-suspend-tag-action:${state}[\\s\\S]*?background-color: ${color} !important;`));
  }
  assert.match(css, /\.app-suspend-tag-action:disabled[\s\S]*?background-color: #527565 !important;/);
});

test('Complete Tag remains on the card face beside Email for reviewed and pending-approval rows', t => {
  for (const status of ['pending', 'completed', 'awaiting_rep', 'approved', 'denied']) {
    const h = harness(t, { status });
    const button = [...h.card.querySelectorAll('button')].find(node => node.textContent === 'Complete Tag');
    assert.ok(button); button.click();
    assert.deepEqual(h.calls, [['close', h.item.UNIQUE_ID]]);
  }
});

test('legacy Suspend Tag sharing code is removed while the approval action remains', () => {
  const gs = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /sendDockSuspendDcPhotoSpecEmail|maybePromptDockSuspendTagPhotoSpecSendAfterSave|Share Photo \/ Spec Options/);
  assert.doesNotMatch(gs, /suspend_tag_photo_spec|isSuspendTagPhotoSpecEmail/);
  assert.match(html, /Email Rep for Approval/);
});

test('Suspend Tag density is scoped and keeps readable wrapping notes and touch targets', () => {
  const start = css.indexOf('/* Suspend Tag keeps the shared Drive frame');
  const nextSection = css.indexOf('/* Que navigation', start);
  const rules = css.slice(start, nextSection < 0 ? undefined : nextSection);
  const compactStart = css.indexOf('/* Compact Suspend uses an independent Reclass rail');
  const compactRules = css.slice(compactStart, start);
  assert.match(compactRules, /body\.ops-precision-pilot\.current-view-request #request-content[\s\S]*?\.app-drive-card-grid,[\s\S]*?\.app-drive-card-grid:not\([\s\S]*?\) \{[\s\S]*?row-gap: 5px !important;/);
  assert.match(compactRules, /body\.ops-precision-pilot\.current-view-request #request-content[\s\S]*?\.app-drive-card-grid\.app-drive-card-grid--no-photo,[\s\S]*?\.app-drive-card-grid\.app-drive-card-grid--no-photo:not\([\s\S]*?\) \{[\s\S]*?row-gap: 5px !important;/);
  assert.match(compactRules, /\.app-suspend-tag-header-row \{[\s\S]*?display: grid;[\s\S]*?grid-template-columns: minmax\(0, 1fr\) clamp\(5rem, 23vw, 7rem\);[\s\S]*?gap: 6px;/);
  assert.match(compactRules, /\.app-suspend-tag-text-column \{[\s\S]*?flex-direction: column;[\s\S]*?gap: 3px;/);
  assert.match(compactRules, /\.app-operational-planstart-date \{ margin: 0; \}/);
  assert.match(rules, /\.app-operational-card-header-fields \{ gap: 4px 6px; margin: 0;/);
  assert.match(rules, /\.app-drive-card-quantity-band \{ margin-top: 2px !important;/);
  assert.match(rules, /\.app-suspend-tag-status \{ margin: 0; padding-top: 0;/);
  assert.match(rules, /\.app-suspend-tag-actions \{ display: flex; flex-wrap: wrap; gap: 6px; margin-top: 5px;/);
  assert.match(rules, /\.app-drive-card-details \{ gap: 5px;/);
  assert.match(rules, /\.app-request-card-meta \{ display: grid; grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\); align-items: start; gap: 3px 6px; margin: 0;/);
  assert.match(compactRules, /grid-template-areas: "photo header" "details details" !important;/);
  assert.match(compactRules, /\.app-card-qty-label \{\s*font-size: 13px !important;\s*font-weight: 700 !important;/);
  assert.match(compactRules, /\.app-card-qty-value \{\s*font-size: 22px !important;\s*font-weight: 800 !important;/);
  assert.match(rules, /:is\(\.app-card-note, \.app-suspend-tag-data-note\) \{ margin: 0; padding: 6px; box-shadow: none; overflow-wrap: anywhere;/);
  assert.match(rules, /\.app-suspend-tag-action \{ min-width: 44px; min-height: 44px; padding: 6px 8px;/);
  assert.doesNotMatch(rules, /line-clamp|max-height|overflow:\s*hidden/);
  const scopedSource = rules.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [];
  let depth = 0, buffer = '';
  for (const char of scopedSource) {
    if (char === '{') {
      const head = buffer.trim();
      if (head && !head.startsWith('@')) selectors.push(head);
      depth += 1; buffer = '';
    } else if (char === '}') { depth = Math.max(0, depth - 1); buffer = ''; }
    else if (depth === 0) buffer += char;
  }
  const splitSelectorList = value => {
    const parts = [];
    let depth = 0, start = 0;
    for (let index = 0; index < value.length; index += 1) {
      if (value[index] === '(' || value[index] === '[') depth += 1;
      else if (value[index] === ')' || value[index] === ']') depth = Math.max(0, depth - 1);
      else if (value[index] === ',' && depth === 0) {
        parts.push(value.slice(start, index));
        start = index + 1;
      }
    }
    parts.push(value.slice(start));
    return parts;
  };
  for (const selector of selectors.flatMap(splitSelectorList)) {
    assert.ok(selector.trim().startsWith('#request-content .app-suspend-tag-compact-card '), selector.trim());
  }
});

test('compact Suspend pilot grid rules outrank the later production inline grid rules', () => {
  assert.ok(docksContrastCss, 'include the actual later inline Docks/Request contrast stylesheet');
  const compactStart = css.indexOf('/* Compact Suspend uses an independent Reclass rail');
  const compactEnd = css.indexOf('/* Suspend Tag keeps the shared Drive frame', compactStart);
  const compactRules = css.slice(compactStart, compactEnd);
  const pilotSelectors = compactRules.match(/([^{}]+)\{\s*grid-template-columns:\s*var\(--drive-card-photo-width\) minmax\(0, 1fr\) !important;\s*grid-template-areas:\s*"photo header" "details details" !important;/)?.[1]
    ?.split(',').map(selector => selector.trim()) || [];
  const productionSelectors = [...docksContrastCss.matchAll(/([^{}]+)\{[^{}]*grid-template-areas:[^{}]*\}/g)]
    .flatMap(match => match[1].split(',').map(selector => selector.trim()))
    .filter(selector => selector.includes('#request-content') && selector.includes('.app-suspend-tag-compact-card') && selector.includes('.app-drive-card-grid'));
  const specificity = (selector) => [
    (selector.match(/#[\w-]+/g) || []).length,
    (selector.match(/\.[\w-]+/g) || []).length,
    (selector.match(/(?:^|\s|[>+~])(?:article|body|div|section)(?=\s|$|[.#[:])/g) || []).length,
  ];
  const compareSpecificity = (left, right) => {
    const a = specificity(left), b = specificity(right);
    for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
    return 0;
  };
  assert.ok(pilotSelectors.some(selector => selector.includes('body.ops-precision-pilot.current-view-request') && selector.includes('.app-inventory-card-overhaul')),
    'the pilot override is scoped to the live request shell and production card wrapper');
  assert.ok(productionSelectors.length >= 4, 'compare all four production grid variants (rail/no-rail and photo/no-photo)');
  const strongestProductionRule = productionSelectors.sort(compareSpecificity).at(-1);
  assert.ok(pilotSelectors.some(selector => compareSpecificity(selector, strongestProductionRule) > 0),
    `pilot selector must beat the later inline selector ${strongestProductionRule}`);
});

test('Bloom summary, Suspend order strip, AV filters, and empty photos retain readable responsive styles', () => {
  const addedStylesStart = css.indexOf('/* Shared Bloom card contract:');
  assert.notEqual(addedStylesStart, -1, 'shared Bloom/Suspend/AV rules are present');
  const addedStyles = css.slice(addedStylesStart);

  assert.match(addedStyles, /\.app-bloom-card-header\s*\{[^}]*grid-template-columns:\s*64px minmax\(0, 1fr\) auto;/);
  assert.match(addedStyles, /\.app-bloom-card-photo\s*\{[^}]*width:\s*64px;[^}]*height:\s*64px;/);
  assert.match(addedStyles, /\.app-bloom-card-metrics \.app-card-qty-row\s*\{[^}]*grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\) !important;/);
  assert.match(addedStyles, /#bloom-picker-actions-list:not\(\.hidden\)\s*\{[^}]*overflow-x:\s*auto !important;/);

  const suspendStart = addedStyles.indexOf('/* Suspend uses the same five-field');
  const avStart = addedStyles.indexOf('/* AV filter buttons used to be compressed', suspendStart);
  const suspendRules = addedStyles.slice(suspendStart, avStart < 0 ? undefined : avStart);
  assert.match(suspendRules, /grid-template-columns:\s*minmax\(0, \.65fr\) minmax\(0, \.65fr\) minmax\(0, \.7fr\) minmax\(0, 1\.6fr\) minmax\(0, 1\.4fr\) !important;/);
  assert.match(suspendRules, /#request-content \.app-suspend-tag-compact-card \.app-card-qty-row\s*\{\s*grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\) !important;/);
  assert.match(suspendRules, /\.app-inline-thumb-column--empty \.app-inline-thumb-box--empty\s*\{[^}]*background:\s*var\(--ops-photo-placeholder, #e8f2ec\);/);
  assert.doesNotMatch(suspendRules, /font-size\s*:/i, 'the compact order and metric overrides do not shrink type');

  assert.match(addedStyles, /#view-av #av-top-filters\.av-top-inline \.av-top-controls-row\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit, minmax\(min\(100%, 156px\), 1fr\)\) !important;/);
  assert.match(addedStyles, /\.task-top-control-title\s*\{[^}]*font-size:\s*11px !important;/);
  assert.match(addedStyles, /\.task-top-control-summary\s*\{[^}]*font-size:\s*13px !important;/);
  assert.match(addedStyles, /@media \(max-width: 720px\), \(pointer: coarse\)[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\) !important;/);
  assert.match(html, /app-inline-thumb-column--empty[\s\S]*?app-inline-thumb-box--empty/);
});
