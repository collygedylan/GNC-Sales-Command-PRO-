(function installRuntimeWatchdog(global) {
  'use strict';
  if (global.GncRuntimeWatchdog) return;
  const STALL_MS = 4000;
  const ROLE_ALIASES = Object.freeze({
    admin: 'admin', 'sales rep': 'sales_rep', salesrep: 'sales_rep', sales_rep: 'sales_rep',
    supervisor: 'supervisor', evaluator: 'evaluator', kier: 'kier', 'dock office': 'dock_office', dock_office: 'dock_office',
    'qc supervisor': 'qc_supervisor', qc_supervisor: 'qc_supervisor', shipping: 'shipping', 'data entry': 'data_entry',
    data_entry: 'data_entry', foreman: 'foreman', 'take backs': 'take_backs', take_backs: 'take_backs'
  });
  const OWNERS = Object.freeze({ home: 'agdata-sync-and-supabase-architect', drive: 'agdata-drive-and-av-specialist', av: 'agdata-drive-and-av-specialist', docks: 'agdata-docks-and-orders-specialist', que: 'agdata-queue-and-reclass-specialist', managers: 'agdata-field-ops-and-qc', bloom: 'agdata-bloom-and-request-specialist', comm: 'agdata-docks-and-orders-specialist', chat: 'agdata-docks-and-orders-specialist' });
  const state = { configured: false, apiUrl: '', username: '', role: '', revisions: {}, pending: new Map(), seen: new Set(), report: null, viewKey: '', viewVisitId: 0, viewStartedAt: Date.now(), viewBaselines: new Map(), measuredViews: new Set() };
  function normalizedRole(value) { const key = String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); return ROLE_ALIASES[key] || key.replace(/\W+/g, '_').replace(/^_+|_+$/g, '') || 'unknown'; }
  function view() { return String(document.body?.dataset?.currentView || document.querySelector('[id^="view-"]:not(.hidden)')?.id?.replace(/^view-/, '') || 'unknown').toLowerCase(); }
  function fingerprint(event) { return [event.event_type, event.view_id, event.sub_module, event.error_message].join('|').toLowerCase().slice(0, 400); }
  function send(event) {
    if (!state.configured || !state.username) return;
    const key = `${event.fingerprint}:${event.app_version}`;
    if (state.seen.has(key)) return;
    state.seen.add(key);
    try { if (typeof state.report === 'function') Promise.resolve(state.report(event)).catch(() => {}); } catch (_) { /* telemetry never affects the app */ }
  }
  function record(type, details = {}) {
    const currentView = String(details.view_id || view());
    const event = {
      event_type: String(type).slice(0, 64), severity: details.severity || (type.includes('LOCKOUT') || type.includes('PARITY') ? 'high' : 'medium'),
      app_version: String(global.__APP_RELEASE_VERSION__ || 'unknown'), username: state.username, normalized_role: normalizedRole(state.role),
      view_id: currentView, sub_module: String(details.sub_module || ''), duration_ms: Math.max(0, Number(details.duration_ms) || 0),
      error_message: String(details.error_message || '').slice(0, 1000), dataset_revisions_snapshot: state.revisions,
      cluster_id: ({ home: 'Cluster 8', drive: 'Cluster 3', av: 'Cluster 3', docks: 'Cluster 7', que: 'Cluster 4', managers: 'Cluster 5', bloom: 'Cluster 6', comm: 'Cluster 7', chat: 'Cluster 7' })[currentView] || 'Cluster 1',
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
  function inspect() {
    const current = view(); const root = document.getElementById(`view-${current}`) || document.body;
    const subModule = String(global.activeHomeTab || '');
    const key = `${current}:${subModule}`;
    if (key !== state.viewKey) { state.viewKey = key; state.viewVisitId++; state.viewStartedAt = Date.now(); }
    const waiting = root.querySelector('.skeleton, .skeleton-bar, [aria-busy="true"], .loading, [data-loading="true"]') ||
      [...root.querySelectorAll('*')].find(node => node.children.length === 0 && /LOADING DATA\.\.\./i.test(node.textContent || ''));
    if (waiting) {
      if (!state.pending.has(key)) state.pending.set(key, setTimeout(() => {
        state.pending.delete(key);
        const nextRoot = document.getElementById(`view-${current}`) || document.body;
        if (view() === current && (nextRoot.querySelector('.skeleton, .skeleton-bar, [aria-busy="true"], .loading, [data-loading="true"]') || /LOADING DATA\.\.\./i.test(nextRoot.textContent || ''))) record('VIEW_LOAD_STALL', { view_id: current, sub_module: String(global.activeHomeTab || ''), duration_ms: STALL_MS, error_message: 'Loading indicator persisted beyond 4000ms' });
      }, STALL_MS));
    } else {
      if (state.pending.has(key)) { clearTimeout(state.pending.get(key)); state.pending.delete(key); }
      const visitKey = `${key}@${state.viewVisitId}`;
      if (!state.measuredViews.has(visitKey)) {
        state.measuredViews.add(visitKey);
        const duration = Math.max(0, Date.now() - state.viewStartedAt);
        const baselineKey = `${normalizedRole(state.role)}:${key}`;
        const baseline = state.viewBaselines.get(baselineKey);
        if (baseline && duration > baseline * 2.5 && duration > 250) record('ROLE_LATENCY_ANOMALY', { view_id: current, sub_module: subModule, duration_ms: duration, error_message: `View completed in ${duration}ms versus ${Math.round(baseline)}ms session baseline` });
        state.viewBaselines.set(baselineKey, baseline ? baseline * 0.8 + duration * 0.2 : duration);
      }
    }
    const banners = [...root.querySelectorAll('[role="alert"], .error-banner, .load-error, .text-red-600, .text-red-700')].filter(node => /Load Failed|Access permissions changed|Some data could not be verified|Chat could not load|Could not load these rows/i.test(node.textContent || ''));
    for (const banner of banners) record('UI_LOCKOUT_BANNER', { view_id: current, severity: 'high', error_message: (banner.textContent || '').trim().slice(0, 300) });
  }
  global.addEventListener('error', event => record('UNHANDLED_JS_EXCEPTION', { severity: 'high', error_message: String(event.message || 'Unhandled error'), suspected_functions: [String(event.filename || '').split('/').pop() + ':' + (event.lineno || '')] }));
  global.addEventListener('unhandledrejection', event => record('UNHANDLED_PROMISE_REJECTION', { severity: 'high', error_message: String(event.reason?.message || event.reason || 'Unhandled rejection') }));
  const observer = new MutationObserver(inspect);
  if (document.documentElement) observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-busy', 'data-loading'] });
  global.GncRuntimeWatchdog = Object.freeze({
    configure(options = {}) { state.apiUrl = String(options.apiUrl || ''); state.username = String(options.username || '').trim().toLowerCase(); state.role = String(options.role || ''); state.report = options.reportEvent; state.configured = true; state.revisions = options.datasetRevisions && typeof options.datasetRevisions === 'object' ? options.datasetRevisions : {}; inspect(); },
    record, capture, normalizeRole: normalizedRole, setDatasetRevisions(value) { state.revisions = value && typeof value === 'object' ? value : {}; },
    inspect, constants: Object.freeze({ stallMs: STALL_MS, roles: Object.freeze(Object.keys(ROLE_ALIASES)) })
  });
})(window);
