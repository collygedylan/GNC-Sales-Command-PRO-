import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { parseExpressionAt } from 'acorn';

function populateCardWindow(w, { item, inventory, allowed, driveAllowed, photo, esc, calls }) {
  Object.assign(w, {
    watchdogQueueOwnerMismatch: () => false, buildEvalOwnerBadge: () => '', isFalseBlockLocation: value => String(value) === '0.00.111',
    item, activeReqTab: 'suspend-tag', sourceView: 'request', activeDetailSourceView: '', lastView: 'request',
    esc, escapeHtml: esc, escJsAttrValue: esc, firstNonEmptyValue: (...values) => values.find(v => v != null && String(v).trim()) ?? '',
    cleanHoldCode: 'H', holdReasonText: 'Await release',
    isDockSuspendDcRequestMirrorRow: row => row?.UNIQUE_ID === item.UNIQUE_ID,
    findDockSuspendDcRequestSourceRow: () => ({ UNIQUE_ID: 'soc-1', SOURCE_TABLE: 'ph_soc_master' }),
    getDockSuspendDcRequestLinkedMasterRow: () => inventory,
    getSuspendTagHydratedInventoryRow: () => null,
    isSuspendTagHydratedInventoryRowStale: () => false,
    scheduleSuspendTagReclassLoads() {},
    canReadSuspendQueue: () => allowed, canUseRequestSuspendTagAssignedToFilter: () => true,
    canCurrentUserViewDockSuspendDcRequests: () => allowed,
    canCurrentUserUseDriveCardOptions: () => driveAllowed,
    canCurrentUserSubmitRepInventoryOperations: () => false,
    canUseProductionLiveSync: () => false,
    getDockSuspendDcRequestPlanstartValue: row => row.PLANSTART || '',
    getDockStopOrDropValue: () => '3', getDockDisplayQty: () => 8, formatDockDisplayQty: String,
    getOperationalCardInventoryRow: () => inventory, buildInventoryQuantityChipsHtml: () => '<div class="app-card-qty-row"><span>On Hand</span><span>Review</span><span>Available</span><span>Open Stock</span><span>Loc Photo Match</span><span>Loc On Hand</span></div>',
    getSuspendTagStatus: row => row.suspend_tag_status,
    findDockSuspendDcRequestMirrorRowByUniqueId: uid => uid === item.UNIQUE_ID ? item : null,
    hydrateSuspendTagItemOptions() {}, retryPendingSuspendTagInventoryReconciliations() {}, showToast() {},
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
}

export function extractCardFunction(html, name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const node = parseExpressionAt(html, start, { ecmaVersion: 'latest' });
  return html.slice(start, node.end);
}

export function createSuspendCardHarness(t, { html, applyProductionCardStyles }, { photo = true, allowed = true, driveAllowed = true, master = true, status = 'pending', productionStyles = false } = {}) {
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
  populateCardWindow(w, { item, inventory, allowed, driveAllowed, photo, esc, calls });

  for (const name of [
    'normalizeQueueNoteText', 'escapeQueueNoteText', 'encodeFastPressArgs', 'decodeFastPressArgs', 'getFastPressActionKey', 'getFastPressActionScope',
    'clearFastPressGhostClickSuppression', 'armFastPressGhostClickSuppression', 'shouldSuppressFastPressSessionClick',
    'shouldIgnoreFastPressTarget', 'clearActiveFastPress', 'beginFastPress', 'trackFastPressMove', 'cancelFastPress',
    'dispatchFastPressAction', 'finishFastPress', 'shouldSuppressFastPressClick', 'handleFastPressClick', 'handleFastPressKeydown',
    'buildFastPressAttrs', 'buildFastInvokeAttrs', 'stopNestedCardActionPress', 'getDockSuspendDcRequestSourceUid', 'isArgosInventoryTransactionEligible',
    'initializeSuspendTagCardActionDelegation',
    'buildArgosInventoryTransactionRailHtml', 'buildArgosInventoryTransactionRailPlaceholderHtml',
    'parseDockCardPlanStartEpochDay', 'formatDockCardPlanStartValue',
    'buildSharedInventoryCardLayout', 'buildSuspendTagReclassActionHtml',
    'buildSuspendTagActions', 'openDockSuspendDcRequestUpdate',
  ]) w.eval(extractCardFunction(html, name));
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

