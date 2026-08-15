(function () {
  'use strict';

  const RELEASE = 'V2026.08.15.08';
  const SENTRY_BUNDLE_URL = './assets/vendor/sentry-browser-10.70.0.min.js';
  const PREFERENCE_STORAGE_KEY = 'gnc_ops_precision_preferences_v1';
  const LIST_VIEWS = new Set([
    'drive',
    'docks',
    'request',
    'tasks',
    'av',
    'sales-inventory',
    'office',
    'managers',
    'communication',
    'review',
    'low-stock',
    'po-management'
  ]);
  const LIST_ROOT_IDS = Object.freeze({
    drive: 'drive-content',
    docks: 'docks-content',
    request: 'request-content',
    tasks: 'task-content',
    av: 'av-content',
    'sales-inventory': 'sales-inventory-hub-grid',
    office: 'sales-office-content',
    managers: 'managers-content',
    communication: 'view-communication',
    review: 'review-content',
    'low-stock': 'view-low-stock',
    'po-management': 'po-management-content'
  });
  const DEFAULT_FLAGS = Object.freeze({ skin: false, preferences: false, card_grid: false, monitoring: false });
  const DEFAULT_PREFERENCES = Object.freeze({ themeMode: 'dark', displayMode: 'cards', updatedAt: '' });
  const PERFORMANCE_KINDS = new Set(['viewSwitches', 'renders', 'chunks', 'longTasks', 'staleSkips']);
  const SENSITIVE_KEY_PATTERN = /(user(name)?|name|note|item|code|customer|consignee|row|record|photo|image|body|header|query|payload|request|url|uri|email|token|password|pin|authorization|cookie)/i;
  const RECORD_CLASS_PATTERN = /(^|\s)(inv-card|drill-item|item-row|task-card|request-card|dock-card|manager-card|approval-card|low-stock-card|communication-card|sales-office-card|rounded-(?:lg|xl|2xl).*border)(\s|$)/i;

  let bridge = null;
  let state = {
    eligible: false,
    flags: { ...DEFAULT_FLAGS },
    preferences: { ...DEFAULT_PREFERENCES },
    cohortId: '',
    activeView: 'home',
    initialized: false,
    provisional: false
  };
  let initializeSerial = 0;
  let preferenceSaveInFlight = null;
  let preferenceRetryTimer = null;
  let preferenceRetryAttempt = 0;
  let decorateFrame = 0;
  let mutationObserver = null;
  let monitoringReady = false;
  let monitoringLoadPromise = null;
  let longTaskCount = 0;

  function normalizeThemeMode(value) {
    const mode = String(value || '').trim().toLowerCase();
    return mode === 'light' ? 'light' : 'dark';
  }

  function normalizeDisplayMode(value) {
    return String(value || '').trim().toLowerCase() === 'grid' ? 'grid' : 'cards';
  }

  function normalizeTimestamp(value) {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
  }

  function normalizePreferences(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      themeMode: normalizeThemeMode(source.themeMode || source.theme_mode || source.theme),
      displayMode: normalizeDisplayMode(source.displayMode || source.display_mode),
      updatedAt: normalizeTimestamp(source.updatedAt || source.updated_at)
    };
  }

  function readCachedPreferences() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PREFERENCE_STORAGE_KEY) || 'null');
      if (!parsed || typeof parsed !== 'object') return null;
      return { ...normalizePreferences(parsed), dirty: parsed.dirty === true };
    } catch (_error) {
      return null;
    }
  }

  function writeCachedPreferences(preferences, dirty) {
    try {
      localStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify({
        ...normalizePreferences(preferences),
        dirty: dirty === true
      }));
    } catch (_error) {}
  }

  function timestampIsNewer(left, right) {
    return (Date.parse(String(left || '')) || 0) > (Date.parse(String(right || '')) || 0);
  }

  function nextPreferenceTimestamp() {
    const previous = Date.parse(String(state.preferences.updatedAt || '')) || 0;
    return new Date(Math.max(Date.now(), previous + 1)).toISOString();
  }

  function getEffectiveTheme() {
    return state.preferences.themeMode === 'light' ? 'light' : 'dark';
  }

  function clearPrepaintTheme() {
    const root = document.documentElement;
    if (!root) return;
    root.removeAttribute('data-ops-prepaint-theme');
    root.style.removeProperty('color-scheme');
  }

  function gridIsSupportedHere() {
    const coarsePointer = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    return !(coarsePointer && Math.min(window.innerWidth || 0, window.screen && window.screen.width || Infinity) < 768);
  }

  function getEffectiveDisplayMode() {
    if ((!state.flags.card_grid && !state.provisional) || !LIST_VIEWS.has(state.activeView)) return 'cards';
    if (state.preferences.displayMode !== 'grid' || !gridIsSupportedHere()) return 'cards';
    return 'grid';
  }

  function updateControlState() {
    document.querySelectorAll('button[data-ops-theme-mode]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-ops-theme-mode') === state.preferences.themeMode));
    });
    document.querySelectorAll('button[data-ops-display-mode]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-ops-display-mode') === state.preferences.displayMode));
    });
    const note = document.getElementById('ops-display-note');
    if (note) {
      note.textContent = state.preferences.displayMode === 'grid' && !gridIsSupportedHere()
        ? 'Grid is saved; this phone stays in Cards.'
        : '';
    }
  }

  function applyUiState() {
    const body = document.body;
    if (!body) return;
    const effectiveTheme = getEffectiveTheme();
    const effectiveDisplay = getEffectiveDisplayMode();
    const skinActive = state.provisional || (state.eligible && state.flags.skin);
    body.classList.toggle('ops-pilot-active', state.eligible && !state.provisional);
    body.classList.toggle('ops-precision-pilot', skinActive);
    body.classList.toggle('ops-grid-effective', skinActive && effectiveDisplay === 'grid');
    body.dataset.opsTheme = effectiveTheme;
    body.dataset.opsThemeMode = state.preferences.themeMode;
    body.dataset.opsDisplayMode = state.preferences.displayMode;
    body.dataset.opsEffectiveDisplay = effectiveDisplay;
    if (typeof window.syncGlobalHeaderChrome === 'function') {
      window.requestAnimationFrame(() => {
        window.syncGlobalHeaderChrome({ reason: 'ops-precision-state', force: true });
        if (typeof window.updateGlobalBackButton === 'function') window.updateGlobalBackButton();
      });
    }
    body.dataset.opsView = state.activeView;
    const panel = document.getElementById('ops-pilot-settings');
    const themeGroup = document.getElementById('ops-theme-settings');
    const displayGroup = document.getElementById('ops-display-settings');
    if (panel) panel.classList.toggle('hidden', state.provisional || !state.eligible || (!state.flags.preferences && !state.flags.card_grid));
    if (themeGroup) themeGroup.classList.toggle('hidden', !state.flags.preferences);
    if (displayGroup) displayGroup.classList.toggle('hidden', !state.flags.card_grid);
    updateControlState();
    scheduleDecorateRecordCollections();
    updateMonitoringTags();
  }

  function isRecordNode(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.matches('form, fieldset, [role="dialog"], .hidden')) return false;
    if (element.closest('#manager-approval-detail-workspace, #view-chat, [role="dialog"], form')) return false;
    const className = String(element.className || '');
    if (RECORD_CLASS_PATTERN.test(className)) return true;
    if (element.matches('button[onclick], article[onclick], div[onclick]') && /border|card|row/i.test(className)) return true;
    return false;
  }

  function decorateRecordCollections() {
    decorateFrame = 0;
    if (!(state.provisional || (state.eligible && state.flags.skin)) || !LIST_VIEWS.has(state.activeView)) return;
    const rootId = LIST_ROOT_IDS[state.activeView];
    const root = rootId ? document.getElementById(rootId) : null;
    if (!root) return;
    root.classList.remove('ops-record-collection', 'ops-record-node');
    root.querySelectorAll('.ops-record-collection, .ops-record-node').forEach((element) => {
      element.classList.remove('ops-record-collection', 'ops-record-node');
    });
    const candidates = [root, ...Array.from(root.querySelectorAll('div, section, ul')).slice(0, 500)];
    candidates.forEach((container) => {
      if (container !== root && container.closest('.ops-record-node')) return;
      const directChildren = Array.from(container.children || []).filter((child) => child instanceof HTMLElement);
      const recordChildren = directChildren.filter(isRecordNode);
      const qualifies = recordChildren.length >= 2 && recordChildren.length >= Math.ceil(directChildren.length * 0.6);
      container.classList.toggle('ops-record-collection', qualifies);
      directChildren.forEach((child) => child.classList.toggle('ops-record-node', qualifies && recordChildren.includes(child)));
    });
  }

  function scheduleDecorateRecordCollections() {
    if (decorateFrame) cancelAnimationFrame(decorateFrame);
    decorateFrame = requestAnimationFrame(decorateRecordCollections);
  }

  function installMutationObserver() {
    if (mutationObserver || !window.MutationObserver) return;
    const wrapper = document.getElementById('view-wrapper');
    if (!wrapper) return;
    mutationObserver = new MutationObserver(() => scheduleDecorateRecordCollections());
    mutationObserver.observe(wrapper, { childList: true, subtree: true });
  }

  function requestPreferenceSave() {
    if (!state.eligible || (!state.flags.preferences && !state.flags.card_grid) || !bridge || typeof bridge.request !== 'function') return Promise.resolve(false);
    if (preferenceSaveInFlight) return preferenceSaveInFlight;
    const cached = readCachedPreferences();
    if (!cached || !cached.dirty) return Promise.resolve(true);
    const attemptedAt = cached.updatedAt;
    preferenceSaveInFlight = bridge.request('set_user_preferences', {
      preferences: {
        themeMode: cached.themeMode,
        displayMode: cached.displayMode,
        updatedAt: attemptedAt
      }
    }).then((response) => {
      const serverPreferences = normalizePreferences(response && response.preferences);
      const currentCache = readCachedPreferences();
      if (currentCache && currentCache.updatedAt === attemptedAt) {
        state.preferences = serverPreferences.updatedAt ? serverPreferences : state.preferences;
        writeCachedPreferences(state.preferences, false);
        applyUiState();
      }
      preferenceRetryAttempt = 0;
      return true;
    }).catch(() => {
      schedulePreferenceRetry();
      return false;
    }).finally(() => {
      preferenceSaveInFlight = null;
      const latest = readCachedPreferences();
      if (latest && latest.dirty && latest.updatedAt !== attemptedAt) requestPreferenceSave();
    });
    return preferenceSaveInFlight;
  }

  function schedulePreferenceRetry() {
    if (preferenceRetryTimer || !state.eligible) return;
    const delay = Math.min(30000, 1000 * (2 ** Math.min(5, preferenceRetryAttempt++)));
    preferenceRetryTimer = setTimeout(() => {
      preferenceRetryTimer = null;
      if (navigator.onLine !== false) requestPreferenceSave();
      else schedulePreferenceRetry();
    }, delay);
  }

  function updatePreference(kind, value) {
    if (!state.eligible) return false;
    if (kind === 'theme' && !state.flags.preferences) return false;
    if (kind === 'display' && !state.flags.card_grid) return false;
    const next = {
      ...state.preferences,
      updatedAt: nextPreferenceTimestamp()
    };
    if (kind === 'theme') next.themeMode = normalizeThemeMode(value);
    if (kind === 'display') next.displayMode = normalizeDisplayMode(value);
    state.preferences = next;
    writeCachedPreferences(next, true);
    applyUiState();
    requestPreferenceSave();
    return false;
  }

  function installControlHandlers() {
    document.querySelectorAll('button[data-ops-theme-mode]').forEach((button) => {
      if (button.dataset.opsBound === 'true') return;
      button.dataset.opsBound = 'true';
      button.addEventListener('click', () => updatePreference('theme', button.getAttribute('data-ops-theme-mode')));
    });
    document.querySelectorAll('button[data-ops-display-mode]').forEach((button) => {
      if (button.dataset.opsBound === 'true') return;
      button.dataset.opsBound = 'true';
      button.addEventListener('click', () => updatePreference('display', button.getAttribute('data-ops-display-mode')));
    });
  }

  function browserFamily() {
    const ua = String(navigator.userAgent || '');
    if (/Edg\//.test(ua)) return 'edge';
    if (/CriOS\//.test(ua)) return 'chrome-ios';
    if (/Chrome\//.test(ua)) return 'chrome';
    if (/FxiOS\//.test(ua)) return 'firefox-ios';
    if (/Firefox\//.test(ua)) return 'firefox';
    if (/Safari\//.test(ua) && /Mobile\//.test(ua)) return 'safari-ios';
    if (/Safari\//.test(ua)) return 'safari';
    return 'other';
  }

  function viewportClass() {
    const width = Number(window.innerWidth || 0);
    if (width < 600) return 'phone';
    if (width < 1024) return 'tablet';
    if (width < 1440) return 'desktop';
    return 'wide';
  }

  function redactText(value) {
    return String(value == null ? '' : value)
      .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '[photo-data]')
      .replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
      .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[email]')
      .replace(/\bdylan_collyge\b/gi, '[user]')
      .replace(/\b(?:[A-Z]{1,5}[-_.])?\d{4,}[A-Z0-9._-]*\b/gi, '[code]')
      .replace(/([?&][^=\s]+)=([^&#\s]*)/g, '$1=[redacted]')
      .slice(0, 320);
  }

  function scrubValue(value, depth, key) {
    if (SENSITIVE_KEY_PATTERN.test(String(key || ''))) return '[redacted]';
    if (depth > 8) return '[truncated]';
    if (typeof value === 'string') return redactText(value);
    if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => scrubValue(item, depth + 1, ''));
    if (typeof value === 'object') {
      const output = {};
      Object.keys(value).slice(0, 40).forEach((childKey) => {
        output[childKey] = scrubValue(value[childKey], depth + 1, childKey);
      });
      return output;
    }
    return String(value);
  }

  function scrubSentryEvent(event) {
    if (!event || typeof event !== 'object') return event;
    delete event.user;
    delete event.request;
    delete event.breadcrumbs;
    if (event.message) event.message = redactText(event.message);
    if (event.transaction) event.transaction = redactText(event.transaction).replace(/\?.*$/, '');
    if (event.exception && Array.isArray(event.exception.values)) {
      event.exception.values.forEach((entry) => {
        if (entry && entry.value) entry.value = redactText(entry.value);
      });
    }
    event.extra = scrubValue(event.extra || {}, 0, 'extra');
    event.contexts = scrubValue(event.contexts || {}, 0, 'contexts');
    const tags = {
      release: RELEASE,
      browser_family: browserFamily(),
      viewport_class: viewportClass(),
      active_view: state.activeView,
      theme: getEffectiveTheme(),
      theme_mode: state.preferences.themeMode,
      display_mode: getEffectiveDisplayMode(),
      cohort_id: state.cohortId
    };
    const scrubbedEvent = scrubValue(event, 0, '');
    scrubbedEvent.tags = tags;
    return scrubbedEvent;
  }

  function loadMonitoringBundle() {
    if (window.GncSentry && typeof window.GncSentry.init === 'function') return Promise.resolve(window.GncSentry);
    if (monitoringLoadPromise) return monitoringLoadPromise;
    monitoringLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${SENTRY_BUNDLE_URL}?v=${encodeURIComponent(RELEASE)}`;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.dataset.opsSentryBundle = '10.70.0';
      script.addEventListener('load', () => resolve(window.GncSentry));
      script.addEventListener('error', () => reject(new Error('Monitoring bundle failed to load.')));
      document.head.appendChild(script);
    });
    return monitoringLoadPromise;
  }

  function updateMonitoringTags() {
    const sentry = window.GncSentry;
    if (!monitoringReady || !sentry || typeof sentry.setTags !== 'function') return;
    sentry.setTags({
      release: RELEASE,
      browser_family: browserFamily(),
      viewport_class: viewportClass(),
      active_view: state.activeView,
      theme: getEffectiveTheme(),
      theme_mode: state.preferences.themeMode,
      display_mode: getEffectiveDisplayMode(),
      cohort_id: state.cohortId
    });
  }

  function initializeMonitoring(config) {
    if (monitoringReady || !state.eligible || !state.flags.monitoring || !config || !config.dsn) return Promise.resolve(false);
    state.cohortId = String(config.cohortId || config.cohort_id || '').trim().slice(0, 80);
    return loadMonitoringBundle().then((sentry) => {
      if (!sentry || typeof sentry.init !== 'function') return false;
      const defaultIntegrationsFilter = (integrations) => (integrations || []).filter((integration) => {
        const name = String(integration && integration.name || '');
        return !/Replay|Breadcrumbs|Feedback|UserAgent/i.test(name);
      });
      const integrations = [];
      if (typeof sentry.browserTracingIntegration === 'function') integrations.push(sentry.browserTracingIntegration());
      sentry.init({
        dsn: String(config.dsn || '').trim(),
        release: RELEASE,
        environment: 'production-pilot',
        enabled: true,
        sampleRate: 1,
        sendDefaultPii: false,
        tracesSampleRate: Math.max(0, Math.min(1, Number(config.tracesSampleRate || config.traces_sample_rate || 0.1))),
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        maxBreadcrumbs: 0,
        normalizeDepth: 3,
        tracePropagationTargets: [],
        integrations(defaultIntegrations) {
          return [...defaultIntegrationsFilter(defaultIntegrations), ...integrations];
        },
        beforeBreadcrumb() {
          return null;
        },
        beforeSend(event) {
          return scrubSentryEvent(event);
        },
        beforeSendTransaction(event) {
          return scrubSentryEvent(event);
        },
        beforeSendSpan(span) {
          return scrubValue(span, 0, 'span');
        },
        initialScope: {
          tags: {
            release: RELEASE,
            browser_family: browserFamily(),
            viewport_class: viewportClass(),
            active_view: state.activeView,
            theme: getEffectiveTheme(),
            theme_mode: state.preferences.themeMode,
            display_mode: getEffectiveDisplayMode(),
            cohort_id: state.cohortId
          }
        }
      });
      if (typeof sentry.setUser === 'function') sentry.setUser(null);
      monitoringReady = true;
      updateMonitoringTags();
      return true;
    }).catch(() => false);
  }

  function captureFailure(kind, error) {
    const sentry = window.GncSentry;
    if (!monitoringReady || !sentry) return;
    const safeKind = /upload/i.test(kind) ? 'upload' : /commit/i.test(kind) ? 'commit' : 'operation';
    if (error instanceof Error && typeof sentry.captureException === 'function') {
      const sanitizedError = new Error(redactText(error.message || `${safeKind} failed`));
      sanitizedError.name = `${safeKind[0].toUpperCase()}${safeKind.slice(1)}Failure`;
      sentry.captureException(sanitizedError, { tags: { failure_kind: safeKind } });
    } else if (typeof sentry.captureMessage === 'function') {
      sentry.captureMessage(`${safeKind} failed`, { level: 'error', tags: { failure_kind: safeKind } });
    }
  }

  function observeToast(title, message, isAlert) {
    if (!monitoringReady) return;
    const combined = `${String(title || '')} ${String(message || '')}`;
    if (!isAlert && !/fail|error|unable|could not/i.test(combined)) return;
    if (/upload|photo/i.test(combined)) captureFailure('upload');
    else if (/commit/i.test(combined)) captureFailure('commit');
  }

  function recordPerformance(kind, payload) {
    const sentry = window.GncSentry;
    if (!monitoringReady || !sentry) return;
    const safeKind = String(kind || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'performance';
    if (!PERFORMANCE_KINDS.has(safeKind)) return;
    const safePayload = scrubValue(payload && typeof payload === 'object' ? payload : {}, 0, 'perf');
    const duration = Number(safePayload.duration || safePayload.durationMs || 0);
    if (safeKind === 'longTasks' && duration >= 100) longTaskCount += 1;
    if (typeof sentry.startSpan === 'function') {
      sentry.startSpan({
        name: `ops.${safeKind}`,
        op: safeKind === 'viewSwitches' ? 'navigation.route' : safeKind === 'chunks' ? 'ui.chunk' : safeKind === 'longTasks' ? 'ui.long-task' : safeKind === 'staleSkips' ? 'ui.stale-work' : 'ui.render',
        attributes: {
          duration_ms: Math.round(duration * 100) / 100,
          active_view: state.activeView,
          sample_index: safeKind === 'longTasks' ? longTaskCount : undefined
        }
      }, function () {});
    }
  }

  function setActiveView(viewId) {
    state.activeView = String(viewId || 'home').trim().toLowerCase() || 'home';
    applyUiState();
  }

  function deactivate() {
    state = {
      eligible: false,
      flags: { ...DEFAULT_FLAGS },
      preferences: { ...DEFAULT_PREFERENCES },
      cohortId: '',
      activeView: 'home',
      initialized: false,
      provisional: false
    };
    applyUiState();
  }

  function primeCachedAppearance(options = {}) {
    const safeOptions = options && typeof options === 'object' ? options : {};
    const cached = readCachedPreferences();
    state = {
      eligible: false,
      flags: { ...DEFAULT_FLAGS },
      preferences: normalizePreferences(cached || DEFAULT_PREFERENCES),
      cohortId: '',
      activeView: String(safeOptions.activeView || 'home').trim().toLowerCase() || 'home',
      initialized: false,
      provisional: true
    };
    const theme = getEffectiveTheme();
    const root = document.documentElement;
    if (root) {
      root.dataset.opsPrepaintTheme = theme;
      root.style.colorScheme = theme;
    }
    applyUiState();
    return true;
  }

  async function initialize(options) {
    const serial = ++initializeSerial;
    bridge = options && typeof options === 'object' ? options : null;
    installControlHandlers();
    installMutationObserver();
    if (!bridge || typeof bridge.request !== 'function') {
      deactivate();
      clearPrepaintTheme();
      return false;
    }
    try {
      const response = await bridge.request('get_user_preferences', {});
      if (serial !== initializeSerial) return false;
      if (!response || response.ok !== true || response.eligible !== true) {
        deactivate();
        clearPrepaintTheme();
        return false;
      }
      const flags = response.flags && typeof response.flags === 'object' ? response.flags : {};
      const serverPreferences = normalizePreferences(response.preferences);
      const cached = readCachedPreferences();
      const useDirtyCache = !!(cached && cached.dirty && timestampIsNewer(cached.updatedAt, serverPreferences.updatedAt));
      state.eligible = true;
      state.flags = {
        skin: flags.skin === true,
        preferences: flags.preferences === true,
        card_grid: flags.card_grid === true,
        monitoring: flags.monitoring === true
      };
      state.preferences = useDirtyCache ? normalizePreferences(cached) : serverPreferences;
      state.cohortId = String(response.monitoring && (response.monitoring.cohortId || response.monitoring.cohort_id) || '').trim().slice(0, 80);
      state.activeView = String(bridge.getActiveView && bridge.getActiveView() || 'home').trim().toLowerCase() || 'home';
      state.initialized = true;
      state.provisional = false;
      writeCachedPreferences(state.preferences, useDirtyCache);
      applyUiState();
      clearPrepaintTheme();
      if (useDirtyCache) requestPreferenceSave();
      if (state.flags.monitoring) initializeMonitoring(response.monitoring);
      return true;
    } catch (_error) {
      if (serial === initializeSerial && !state.provisional) deactivate();
      return false;
    }
  }

  window.addEventListener('resize', applyUiState, { passive: true });
  window.addEventListener('online', () => requestPreferenceSave(), { passive: true });

  window.__gncOpsPilot = Object.freeze({
    release: RELEASE,
    initialize,
    primeCachedAppearance,
    setActiveView,
    captureFailure,
    observeToast,
    recordPerformance,
    applyUiState,
    getState() {
      return {
        initialized: state.initialized,
        provisional: state.provisional,
        eligible: state.eligible,
        flags: { ...state.flags },
        preferences: { ...state.preferences },
        activeView: state.activeView,
        effectiveDisplayMode: getEffectiveDisplayMode(),
        effectiveTheme: getEffectiveTheme(),
        monitoringReady
      };
    }
  });
})();
