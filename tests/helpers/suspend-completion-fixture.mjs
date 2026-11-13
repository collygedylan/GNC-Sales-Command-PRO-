import { readComposedAppSource } from '../../scripts/composed-app-source.mjs';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readComposedAppSource();
export function between(start, end) {
  const from = html.indexOf(start), to = html.indexOf(end, from + start.length);
  if (from < 0 || to <= from) throw new Error(`Missing fixture source: ${start}`);
  return html.slice(from, to);
}
const workflow = between('function getSuspendTagStatus(', 'let dockSuspendCompletionState = null;');
const helpers = between('let dockSuspendCompletionState = null;', 'async function openDockSuspendDcNotFoundRecount(');
const handler = between('async function completeDockSuspendDcRequestFromCard(', 'async function saveDockSuspendDcRequestMirrorData(');
const optimisticPainter = between('function paintOptimisticSuspendTagRemoval(', 'function forcePendingRequestRoot(');
export const revision = '2026-09-08T15:50:47.123456Z';
export const source = () => ({
  UNIQUE_ID: 'soc-1', LAST_UPDATED: revision, DATE_COMPLETED: '', SUSPEND: 'SUSPEND', SUSPEND_TO: 'DC', PTRONHAND: '0',
  TRANSACTIONNUMBER: 'tx-39-20', DOCK: '39', STOPNUMBER: '20', ITEMCODE: '009373.031.1',
  LOCATIONCODE: 'F.14.000', LOTCODE: '27.F1', QUANTITYSHIPPED: '150', TAGCODE: 'TAG-150',
  CONSIGNEE: 'Little Lime Punch',
});
export const button = () => ({ innerHTML: 'Done', disabled: false, classList: { add() {}, remove() {} } });
export const acknowledgement = (changes = {}) => ({ ok: true, row: { unique_id: 'soc-1', last_updated: revision, date_completed: '2026-09-08T16:00:00Z', suspend_tag_version: 1, suspend_tag_status: 'completed', ...changes } });
function baseHarnessContext(ctx, options, storage, documentListeners) {
  return {
    Date, Map, Set, JSON, Object, Array, String, Number, Promise,
    currentUser: 'dylan_collyge', SUPABASE_URL: 'https://isolated.invalid', allowed: true,
    suspendTagCompletionActions: new Set(),
    crypto: { randomUUID: () => `a0000000-0000-4000-8000-${String(storage.size + 1).padStart(12, '0')}` },
    console: { warn() {} },
    document: {
      addEventListener: (name, listener, capture) => documentListeners.set(name, { listener, capture }),
      querySelectorAll: () => [],
    },
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    normalizeSessionIdentity: (value) => String(value || '').trim().toLowerCase(),
    hasCompletionDateValue: (item) => Boolean(String(item?.DATE_COMPLETED || item?.date_completed || '').trim()),
    esc: (value) => String(value ?? ''),
    escJsAttrValue: (value) => String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"),
    firstNonEmptyValue: (...values) => values.find((value) => value !== null && value !== undefined && String(value).trim()) ?? '',
    canCurrentUserViewDockSuspendDcRequests: () => ctx.allowed,
    canCurrentUserWorkRequestItem: () => ctx.allowed,
    canonicalFeaturePermission: (flag) => options.canonicalPermissions?.[flag] ?? null,
    canUseProductionLiveSync: () => options.live === true,
    AbortController,
    productionLiveSyncNavigation: new AbortController(),
    view: 'detail', permission: 'permissions-1',
    getCurrentVisibleViewId: () => ctx.view,
    getProductionLiveSyncContext: () => ({ scope: ctx.currentUser, dataPermissionVersion: ctx.permission }),
    isSuspendTagWriteSurface: () => ['detail', 'request'].includes(ctx.view),
    isDockSuspendDcRequestRowAnyStatus: () => true,
    staleSupabaseReadScopeError: () => new Error('stale scope'),
    withProductionLiveSyncSignal: async (_, read) => read(ctx.productionLiveSyncNavigation.signal),
  };
}

function domainHarnessContext(ctx, options, row, mirror, calls, toasts, counters) {
  return {
    window: {},
    supabaseRpc: async () => ({ contractVersion: 1, permissionVersion: ctx.permission,
      sources: [{ key: 'ph_soc_master', state: 'ready', revision: '1' }] }),
    remoteRow: { unique_id: 'soc-1', last_updated: revision, suspend_tag_version: 0, suspend_tag_status: 'pending' },
    requireCurrentSuspendTagWriteProof: () => options.proof !== false,
    getDockSuspendDcRequestSourceUid: (item) => item?.DOCK_SUSPEND_SOURCE_UID || item?.UNIQUE_ID?.replace(/^dock_suspend_dc_/, '') || '',
    findDockSuspendDcRequestSourceRow: () => ctx.currentSource,
    findDockSuspendDcRequestMirrorRowByUniqueId: () => mirror,
    isDockSuspendDcRequestMirrorRow: (item) => Boolean(item?.DOCK_SUSPEND_SOURCE_UID),
    getDockSuspendDcRequestGroupParts: () => ({}),
    showAppConfirm: async () => { counters.confirmCalls += 1; return options.confirm !== false; },
    showToast: (...args) => toasts.push(args),
    getDetailRowWriteTimeoutMs: () => 1000,
    postAppFunctionJson: async (_url, body) => {
      calls.push({ name: body.operation, body });
      if (body.operation === 'rows') return { ok: true, data: options.read ? await options.read(ctx) : { rows: [{ ...ctx.remoteRow }] } };
      const result = options.api ? await options.api(body) : acknowledgement();
      if (options.live && result?.row) ctx.remoteRow = { ...result.row };
      return { ok: true, data: result };
    },
    APP_API_FUNCTION_URL: 'https://example.invalid', normalizeRowPhotoFields() {}, buildSearchIndex() {},
    getDockSuspendDcRequestCompletionReadiness: () => ({ ready: options.ready !== false, missing: ['photo'] }), openDockSuspendDcRequestUpdate() { counters.openUpdateCalls += 1; },
    getSuspendTagExistingReviewPatch: () => ({}),
    applyDockSuspendDcRequestHandledState: (item, at) => { item.DATE_COMPLETED = at; item.date_completed = at; },
    refreshLocalDockSuspendDcRequestState() {}, markViewDirty() {},
    isViewVisible: view => ctx.view === view, renderRequestCategoryToolbar() {}, scheduleRequestRender() {},
    yieldToUiFrame: async () => {},
    requestTabQueueCountsSnapshot: null, requestTabQueueCountsSnapshotScope: '',
    queueSuspendTagInventoryReconciliation() {},
    invalidateSuspendTagInventoryRows() {},
    invalidateDockSuspendDcSourceRowLookup() {},
    getPendingPhotoUploadsForItem: () => [],
    applySavedSuspendDisplay() {}, readRowEvaluationDraft: () => ({}), clearSavedRowEvaluationDraft() {},
    restoreCapturedPhotoFields() {}, mergeActiveItemDetailPhotoFields() {},
    reconcileConfirmedDriveEvidence: (...args) => { ctx.inventoryReconciliation = args; return true; },
    matchesSuspendTagInventoryIdentity: () => true,
    getSuspendTagInventoryIdentity: () => ({}),
    getSupabaseReadIdentityScope: () => ctx.currentUser,
    mergePhotoCsvList: values => [...new Set(values.flatMap(value => String(value || '').split(',').filter(Boolean)))].join(','),
    dockSuspendDcRequestMirrorRowsCacheKey: 'stale', requestScopedItemsCacheKey: 'stale',
    requestsInventory: [mirror], socInventory: [row], socRawSourceRows: [row], suspendTagInventory: [row], suspendTagRawSourceRows: [row],
    detailReturnState: null, currentSource: row,
    optimisticCompletedRowIds: new Set(),
    getItemUniqueId: item => typeof item === 'string' ? item : item?.UNIQUE_ID || item?.unique_id || '',
    invalidateResolvedViewStateCaches() {},
    getRequestTabQueueCounts: () => ({}), syncRequestTabButtons() {}, paintFooterRequestBadgeOnly() {},
    updateFooterRequestBadge() {}, persistCurrentCache() {},
    preserveInventoryScrollPosition: callback => callback(), applySuspendCandidateRows() {},
    applySuspendTagInventoryReceipt() {}, setTimeout,
  };
}

export function harness(options = {}) {
  const storage = options.storage || new Map();
  const calls = [], toasts = [], documentListeners = new Map();
  const counters = { confirmCalls: 0, openUpdateCalls: 0 };
  const row = source();
  const mirror = { ...row, UNIQUE_ID: 'dock_suspend_dc_soc-1', DOCK_SUSPEND_SOURCE_UID: row.UNIQUE_ID };
  const ctx = {};
  Object.assign(ctx, baseHarnessContext(ctx, options, storage, documentListeners));
  Object.assign(ctx, domainHarnessContext(ctx, options, row, mirror, calls, toasts, counters));

  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../../assets/live-sync-coordinator.js', import.meta.url), 'utf8'), ctx);
  ctx.window.AgMetricLiveSync = ctx.AgMetricLiveSync;
  ctx.window.localStorage = ctx.localStorage;
  vm.runInContext(readFileSync(new URL('../../assets/queue-completion-state.js', import.meta.url), 'utf8'), ctx);
  vm.runInContext(readFileSync(new URL('../../assets/suspend-receipt-domain.js', import.meta.url), 'utf8'), ctx);
  vm.runInContext(readFileSync(new URL('../../assets/request-inventory-card.js', import.meta.url), 'utf8'), ctx);
  vm.runInContext(readFileSync(new URL('../../assets/row-publication-branches.js', import.meta.url), 'utf8'), ctx);
  vm.runInContext(readFileSync(new URL('../../assets/canonical-inventory-evidence.js', import.meta.url), 'utf8'), ctx);
  vm.runInContext(between('function applyExplicitAvNotePayload(', 'function mergeConfirmedRowEvaluationUploads('), ctx);
  const transport = between('function currentSuspendSourceSnapshot(', 'function getManagerAssignedSelectionSnapshot(');
  const falseBlock = between("function isFalseBlockLocation(", 'function ');
  vm.runInContext(`${transport}\n${falseBlock}`, ctx);
  const completions = between('let queueCompletionState = null;', 'function trackOptimisticCompletedRows(');
  const command = readFileSync(new URL('../../assets/suspend-detail-save-domain.js', import.meta.url), 'utf8');
  vm.runInContext(`${completions}\n${workflow}\n${helpers}\n${optimisticPainter}\n${handler}\n${command}`, ctx);
  ctx.applySuspendCandidateRows = () => {};
  return { ctx, row, mirror, calls, toasts, storage, documentListeners, get confirmCalls() { return counters.confirmCalls; }, get openUpdateCalls() { return counters.openUpdateCalls; } };
}

export function makeSuspendAction() {
  return { disabled: false, attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
    getAttribute(name) { return this.attributes.get(name) ?? null; } };
}

export function makeSuspendActionDocument(uid, actions) {
  const card = { getAttribute: name => name === 'data-request-uid' ? uid : null, querySelectorAll: () => actions };
  return { addEventListener() {}, querySelectorAll: selector => selector === '#request-content [data-request-uid]' ? [card] : [] };
}
