(function installRuntimeWatchdog(global) {
  'use strict';
  if (global.GncRuntimeWatchdog) return;
  const STALL_MS = 4000;
  const PARITY_STALL_MS = 2000;
  const ROLE_ALIASES = Object.freeze({
    admin: 'admin', 'sales rep': 'sales_rep', salesrep: 'sales_rep', sales_rep: 'sales_rep',
    supervisor: 'supervisor', evaluator: 'evaluator', kier: 'kier', 'dock office': 'dock_office', dock_office: 'dock_office',
    'qc supervisor': 'qc_supervisor', qc_supervisor: 'qc_supervisor', shipping: 'shipping', 'data entry': 'data_entry',
    data_entry: 'data_entry', foreman: 'foreman', 'take backs': 'take_backs', take_backs: 'take_backs'
  });
  const OWNERS = Object.freeze({ home: 'agdata-sync-and-supabase-architect', drive: 'agdata-drive-and-av-specialist', av: 'agdata-drive-and-av-specialist', docks: 'agdata-docks-and-orders-specialist', que: 'agdata-queue-and-reclass-specialist', request: 'agdata-queue-and-reclass-specialist', managers: 'agdata-field-ops-and-qc', bloom: 'agdata-bloom-and-request-specialist', comm: 'agdata-docks-and-orders-specialist', chat: 'agdata-docks-and-orders-specialist' });
  const REPORT_QUEUE_PREFIX = 'agdata.runtime-watchdog.pending.v1:';
  const MAX_QUEUED_REPORTS = 100;
  const state = { configured: false, apiUrl: '', username: '', role: '', revisions: {}, pending: new Map(), seen: new Set(), report: null, getSubModule: null, reportQueue: [], reportQueueOwner: '', reportTimer: null, reportRetryMs: 1000, reportGeneration: 0, reportFlushGeneration: null, viewKey: '', viewVisitId: 0, viewStartedAt: Date.now(), viewBaselines: new Map(), measuredViews: new Set() };
  let parityWait = null;
  function normalizedRole(value) { const key = String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); return ROLE_ALIASES[key] || key.replace(/\W+/g, '_').replace(/^_+|_+$/g, '') || 'unknown'; }
  function view() { return String(document.body?.dataset?.currentView || document.querySelector('[id^="view-"]:not(.hidden)')?.id?.replace(/^view-/, '') || 'unknown').toLowerCase(); }
  function subModule() { try { return String(typeof state.getSubModule === 'function' ? state.getSubModule() || '' : global.activeHomeTab || ''); } catch (_) { return ''; } }
  function fingerprint(event) { return [event.event_type, event.view_id, event.sub_module, event.error_message].join('|').toLowerCase().slice(0, 400); }
  function reportKey(event) { return `${event.username}:${event.fingerprint}:${event.app_version}`; }
  function reportStorageKey(username = state.username) { return `${REPORT_QUEUE_PREFIX}${String(username || '').trim().toLowerCase()}`; }
  function persistReportQueue() {
    if (!state.reportQueueOwner) return;
    try {
      if (state.reportQueue.length) global.localStorage?.setItem(reportStorageKey(state.reportQueueOwner), JSON.stringify(state.reportQueue.slice(-MAX_QUEUED_REPORTS)));
      else global.localStorage?.removeItem(reportStorageKey(state.reportQueueOwner));
    } catch (_) { /* Storage failure must never block the app. */ }
  }
  function loadReportQueue(username) {
    const owner = String(username || '').trim().toLowerCase();
    state.reportQueueOwner = owner;
    state.reportQueue = [];
    if (!owner) return;
    try {
      const parsed = JSON.parse(global.localStorage?.getItem(reportStorageKey(owner)) || '[]');
      if (!Array.isArray(parsed)) return;
      state.reportQueue = parsed.filter(event => event && typeof event === 'object' && !Array.isArray(event)
        && String(event.username || '').trim().toLowerCase() === owner && String(event.fingerprint || '')
        && String(event.app_version || '')).slice(-MAX_QUEUED_REPORTS);
      state.reportQueue.forEach(event => state.seen.add(reportKey(event)));
    } catch (_) { state.reportQueue = []; }
  }
  function scheduleReportRetry() {
    if (state.reportTimer !== null || !state.reportQueue.length) return;
    const delay = state.reportRetryMs;
    state.reportRetryMs = Math.min(60000, Math.max(1000, state.reportRetryMs * 2));
    state.reportTimer = global.setTimeout(() => { state.reportTimer = null; flushPendingReports(); }, delay);
  }
  async function flushPendingReports() {
    if (state.reportFlushGeneration === state.reportGeneration || !state.configured || !state.username || typeof state.report !== 'function'
      || state.reportQueueOwner !== state.username || !state.reportQueue.length) return false;
    const generation = state.reportGeneration;
    state.reportFlushGeneration = generation;
    const owner = state.username;
    const reporter = state.report;
    try {
      while (state.reportQueue.length && state.reportQueueOwner === owner && state.username === owner) {
        const event = state.reportQueue[0];
        try {
          const result = await reporter(event);
          if (result === false || result?.ok === false) throw new Error('Watchdog report was not accepted.');
          if (state.reportGeneration !== generation || state.reportQueueOwner !== owner || state.username !== owner || state.reportQueue[0] !== event) return false;
          state.reportQueue.shift();
          state.reportRetryMs = 1000;
          persistReportQueue();
          if (!state.reportQueue.length && state.reportTimer !== null) { global.clearTimeout(state.reportTimer); state.reportTimer = null; }
        } catch (_) {
          if (state.reportGeneration === generation && state.reportQueueOwner === owner && state.username === owner) {
            persistReportQueue();
            scheduleReportRetry();
          }
          return false;
        }
      }
      return true;
    } finally {
      if (state.reportFlushGeneration === generation) state.reportFlushGeneration = null;
      if (state.reportQueue.length && state.reportQueueOwner === state.username && state.reportFlushGeneration === null) scheduleReportRetry();
    }
  }
  function send(event) {
    if (!state.configured || !state.username || state.reportQueueOwner !== state.username) return;
    const key = reportKey(event);
    if (state.seen.has(key) || state.reportQueue.some(row => reportKey(row) === key)) return;
    state.seen.add(key);
    state.reportQueue.push(event);
    if (state.reportQueue.length > MAX_QUEUED_REPORTS) state.reportQueue.splice(0, state.reportQueue.length - MAX_QUEUED_REPORTS);
    persistReportQueue();
    void flushPendingReports();
  }
  function record(type, details = {}) {
    const currentView = String(details.view_id || view());
    const event = {
      event_type: String(type).slice(0, 64), severity: details.severity || (type.includes('LOCKOUT') || type.includes('PARITY') ? 'high' : 'medium'),
      app_version: String(global.__APP_RELEASE_VERSION__ || 'unknown'), username: state.username, normalized_role: normalizedRole(state.role),
      view_id: currentView, sub_module: String(details.sub_module || subModule()), duration_ms: Math.max(0, Number(details.duration_ms) || 0),
      error_message: String(details.error_message || '').slice(0, 1000), dataset_revisions_snapshot: state.revisions,
      cluster_id: ({ home: 'Cluster 8', drive: 'Cluster 3', av: 'Cluster 3', docks: 'Cluster 7', que: 'Cluster 4', request: 'Cluster 4', managers: 'Cluster 5', bloom: 'Cluster 6', comm: 'Cluster 7', chat: 'Cluster 7' })[currentView] || 'Cluster 1',
      owning_skill: OWNERS[currentView] || 'agdata-app-shell-and-navigation', suspected_functions: Array.isArray(details.suspected_functions) ? details.suspected_functions.slice(0, 8) : [], fingerprint: ''
    };
    event.fingerprint = fingerprint(event); send(event); return event;
  }
  function capture(error, operation = 'unknown') {
    if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return false;
    const owner = String(operation).replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 160) || 'unknown';
    const code = String(error?.code || error?.name || 'Error').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 64);
    // Do not send payloads, credentials, row data or arbitrary exception messages.
    // This sensor never mutates app state or repairs code. Its own transport failure
    // is intentionally terminal, so observing an error cannot recurse into itself.
    try { record('OPERATIONAL_FAILURE', { severity: 'high', error_message: `${owner} failed (${code || 'Error'})`, suspected_functions: [owner] }); }
    catch (_) { return false; }
    return true;
  }
  function isVisibleParityNode(node) { return !!node && !node.hidden && !node.closest?.('.hidden, [hidden], [aria-hidden="true"]'); }
  function hasEvalLoadingText(root) {
    return [...root.querySelectorAll('*')].some(node => node.children.length === 0 && isVisibleParityNode(node)
      && /^Loading(?:\.{3}|\u2026)$/i.test(String(node.textContent || '').trim()));
  }
  function inspectDataParity(root, current, currentSubModule) {
    const eval2 = current === 'managers' && currentSubModule === 'eval-reports-2';
    const waiting = eval2 && !document.hidden && hasEvalLoadingText(root);
    const key = `${state.reportGeneration}:${current}:${currentSubModule}`;
    if (parityWait && (!waiting || parityWait.key !== key)) { global.clearTimeout(parityWait.timer); parityWait = null; }
    if (waiting && !parityWait) {
      const startedAt = Date.now();
      parityWait = { key, timer: global.setTimeout(() => {
        if (!parityWait || parityWait.key !== key) return;
        parityWait = null;
        const nextRoot = document.getElementById(`view-${current}`) || document.body;
        if (!document.hidden && view() === current && subModule() === currentSubModule
          && key === `${state.reportGeneration}:${current}:${currentSubModule}` && hasEvalLoadingText(nextRoot)) {
          record('DATA_PARITY_MISMATCH', { view_id: current, sub_module: currentSubModule,
            duration_ms: Math.max(PARITY_STALL_MS, Date.now() - startedAt),
            error_message: 'Eval Reports #2 Loading... rows persisted beyond 2000ms',
            suspected_functions: ['renderManagerEvalReport2Records', 'mountPagedManagerReport'] });
        }
      }, PARITY_STALL_MS) };
    }
    if (document.hidden) return;
    if (current === 'request' || current === 'que') {
      const missing = [...root.querySelectorAll('[data-suspend-tag-card="true"]')].filter(isVisibleParityNode)
        .some(card => [...card.querySelectorAll('[data-queue-metric]')]
          .some(metric => isVisibleParityNode(metric) && String(metric.textContent || '').trim() === '--'));
      if (missing) record('DATA_PARITY_MISMATCH', { view_id: current, sub_module: 'suspend',
        error_message: 'Que SUSPEND rendered unresolved -- inventory metrics',
        suspected_functions: ['buildSuspendTagRenderPlan', 'buildQueueInventoryMetricsHtml'] });
    }
    if (eval2) {
      const countsRoot = root.querySelector('[data-eval-report-counts-ready="true"]');
      const counts = countsRoot ? [...countsRoot.querySelectorAll('[data-eval-report-count]')] : [];
      // A legitimately empty published dataset or report is not an incident.
      if (Number(countsRoot?.dataset?.evalSourceRowCount) > 0 && Number(countsRoot?.dataset?.evalReportMatchCount) > 0
        && counts.length === 11 && counts.every(node => Number(node.dataset.evalReportCount) === 0)) {
        record('DATA_PARITY_MISMATCH', { view_id: current, sub_module: currentSubModule,
          error_message: 'All 11 Eval report counts are zero despite matching published source rows',
          suspected_functions: ['buildManagerEvalReport2IndexAsync', 'report_read_v2'] });
      }
    }
  }
  function inspect() {
    const current = view(); const root = document.getElementById(`view-${current}`) || document.body;
    const currentSubModule = subModule();
    inspectDataParity(root, current, currentSubModule);
    const key = `${current}:${currentSubModule}`;
    if (key !== state.viewKey) { state.viewKey = key; state.viewVisitId++; state.viewStartedAt = Date.now(); }
    const waiting = root.querySelector('.skeleton, .skeleton-bar, [aria-busy="true"], .loading, [data-loading="true"]') ||
      [...root.querySelectorAll('*')].find(node => node.children.length === 0 && /LOADING DATA\.\.\./i.test(node.textContent || ''));
    if (waiting) {
      if (!state.pending.has(key)) state.pending.set(key, setTimeout(() => {
        state.pending.delete(key);
        const nextRoot = document.getElementById(`view-${current}`) || document.body;
        if (view() === current && (nextRoot.querySelector('.skeleton, .skeleton-bar, [aria-busy="true"], .loading, [data-loading="true"]') || /LOADING DATA\.\.\./i.test(nextRoot.textContent || ''))) record('VIEW_LOAD_STALL', { view_id: current, sub_module: subModule(), duration_ms: STALL_MS, error_message: 'Loading indicator persisted beyond 4000ms' });
      }, STALL_MS));
    } else {
      if (state.pending.has(key)) { clearTimeout(state.pending.get(key)); state.pending.delete(key); }
      const visitKey = `${key}@${state.viewVisitId}`;
      if (!state.measuredViews.has(visitKey)) {
        state.measuredViews.add(visitKey);
        const duration = Math.max(0, Date.now() - state.viewStartedAt);
        const baselineKey = `${normalizedRole(state.role)}:${key}`;
        const baseline = state.viewBaselines.get(baselineKey);
        if (baseline && duration > baseline * 2.5 && duration > 250) record('ROLE_LATENCY_ANOMALY', { view_id: current, sub_module: currentSubModule, duration_ms: duration, error_message: `View completed in ${duration}ms versus ${Math.round(baseline)}ms session baseline` });
        state.viewBaselines.set(baselineKey, baseline ? baseline * 0.8 + duration * 0.2 : duration);
      }
    }
    const banners = [...root.querySelectorAll('[role="alert"], .error-banner, .load-error, .text-red-600, .text-red-700')].filter(node => /Load Failed|Access permissions changed|Some data could not be verified|Chat could not load|Could not load these rows/i.test(node.textContent || ''));
    for (const banner of banners) record('UI_LOCKOUT_BANNER', { view_id: current, severity: 'high', error_message: (banner.textContent || '').trim().slice(0, 300) });
  }
  global.addEventListener('error', event => record('UNHANDLED_JS_EXCEPTION', { severity: 'high', error_message: String(event.message || 'Unhandled error'), suspected_functions: [String(event.filename || '').split('/').pop() + ':' + (event.lineno || '')] }));
  global.addEventListener('unhandledrejection', event => record('UNHANDLED_PROMISE_REJECTION', { severity: 'high', error_message: String(event.reason?.message || event.reason || 'Unhandled rejection') }));
  const observer = new MutationObserver(inspect);
  if (document.documentElement) observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'aria-busy', 'data-loading', 'data-eval-report-counts-ready', 'data-eval-report-count'] });
  global.addEventListener('online', () => { state.reportRetryMs = 1000; if (state.reportTimer !== null) { global.clearTimeout(state.reportTimer); state.reportTimer = null; } void flushPendingReports(); });
  document.addEventListener?.('visibilitychange', () => { if (!document.hidden) void flushPendingReports(); });
  global.GncRuntimeWatchdog = Object.freeze({
    configure(options = {}) { const username = String(options.username || '').trim().toLowerCase(); if (username !== state.username || username !== state.reportQueueOwner) { state.reportGeneration += 1; if (state.reportTimer !== null) { global.clearTimeout(state.reportTimer); state.reportTimer = null; } state.reportRetryMs = 1000; loadReportQueue(username); } state.apiUrl = String(options.apiUrl || ''); state.username = username; state.role = String(options.role || ''); state.report = options.reportEvent; state.getSubModule = options.getSubModule; state.configured = true; state.revisions = options.datasetRevisions && typeof options.datasetRevisions === 'object' ? options.datasetRevisions : {}; inspect(); void flushPendingReports(); },
    record, capture, normalizeRole: normalizedRole, setDatasetRevisions(value) { state.revisions = value && typeof value === 'object' ? value : {}; },
    inspect, flushPendingReports, constants: Object.freeze({ stallMs: STALL_MS, parityStallMs: PARITY_STALL_MS, roles: Object.freeze(Object.keys(ROLE_ALIASES)), maxQueuedReports: MAX_QUEUED_REPORTS })
  });
})(window);
