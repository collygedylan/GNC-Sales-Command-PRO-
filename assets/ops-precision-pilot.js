(function () {
  'use strict';

  const RELEASE = 'V2026.08.17.03';
  const SENTRY_BUNDLE_URL = './assets/vendor/sentry-browser-10.70.0.min.js';
  const DEVICE_THEME_STORAGE_KEY = 'gnc_last_theme_v1';
  const PREFERENCE_STORAGE_KEY_PREFIX = 'gnc_ops_precision_preferences_v2:';
  const LEGACY_PREFERENCE_STORAGE_KEY = 'gnc_ops_precision_preferences_v1';
  const LEGACY_DARK_DEFAULT_USERNAME = 'dylan_collyge';
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
  const DEFAULT_PREFERENCES = Object.freeze({ themeMode: 'light', displayMode: 'cards', updatedAt: '' });
  const PERFORMANCE_KINDS = new Set(['viewSwitches', 'renders', 'chunks', 'longTasks', 'staleSkips', 'search', 'webVitals']);
  const HEALTH_ASSERTIONS = new Set(['chat_composer', 'home_modules', 'home_fit', 'nav_theme', 'toolbar_row', 'drive_card_width', 'task_search']);
  const SENSITIVE_KEY_PATTERN = /(user(name)?|name|note|item|code|customer|consignee|row|record|photo|image|body|header|query|payload|request|url|uri|email|token|password|pin|authorization|cookie)/i;
  const RECORD_CLASS_PATTERN = /(^|\s)(inv-card|drill-item|item-row|task-card|request-card|dock-card|manager-card|approval-card|low-stock-card|communication-card|sales-office-card|rounded-(?:lg|xl|2xl).*border)(\s|$)/i;
  const PREMIUM_ICON_PATHS = Object.freeze({
    'arrow-left': '<path d="m15 18-6-6 6-6"/><path d="M9 12h10"/>',
    'arrows-clockwise': '<path d="M20 7h-5V2"/><path d="M20 7a8 8 0 0 0-13.7-2.7L4 7"/><path d="M4 17h5v5"/><path d="M4 17a8 8 0 0 0 13.7 2.7L20 17"/>',
    'bell-ringing': '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
    'buildings': '<path d="M6 22V4h8v18"/><path d="M14 9h4l2 2v11"/><path d="M2 22h20"/><path d="M9 8h2M9 12h2M9 16h2M17 14h1M17 18h1"/>',
    'calendar-check': '<path d="M8 2v4M16 2v4M3 10h18"/><rect x="3" y="4" width="18" height="17" rx="2"/><path d="m9 16 2 2 4-5"/>',
    'car': '<path d="M5 17H3v-5l2-5h14l2 5v5h-2"/><path d="M5 12h14"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
    'chart-bar': '<path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7M2 20h20"/>',
    'chat-circle-dots': '<path d="M21 12a8 8 0 0 1-9 8 9 9 0 0 1-4-.9L3 21l1.9-5A8 8 0 1 1 21 12Z"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>',
    'chats-circle': '<path d="M15 5a7 7 0 0 0-11 8.6L3 18l4.4-1A7 7 0 0 0 18 11"/><path d="M17 3a5 5 0 0 1 4 8l1 3-3-1a5 5 0 0 1-5-1"/>',
    'clipboard-text': '<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 4V2h6v2M9 10h6M9 14h6M9 18h4"/>',
    'database': '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    'envelope': '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    'hammer': '<path d="m14 5 5 5"/><path d="m12 7 3-3 5 5-3 3"/><path d="m14 10-9 9-2-2 9-9"/>',
    'handbag': '<path d="M5 8h14l1 13H4L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    'handshake': '<path d="m8 12 3 3a2 2 0 0 0 3 0l4-4"/><path d="m12 8-2-2-6 5 3 3"/><path d="m12 8 2-2 6 5-2 2"/><path d="m7 14 4 4a2 2 0 0 0 3 0l3-3"/>',
    'house': '<path d="m3 11 9-8 9 8"/><path d="M5 10v11h14V10"/><path d="M9 21v-7h6v7"/>',
    'list': '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
    'list-checks': '<path d="m3 6 2 2 3-4M3 12l2 2 3-4M3 18l2 2 3-4"/><path d="M11 6h10M11 12h10M11 18h10"/>',
    'map-pin-line': '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2"/>',
    'moon': '<path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/>',
    'notebook': '<path d="M5 3h14v18H5zM9 3v18M12 8h4M12 12h4"/>',
    'palette': '<path d="M12 3a9 9 0 1 0 0 18h1.5a1.5 1.5 0 0 0 0-3H12a2 2 0 0 1 0-4h3a6 6 0 0 0 0-12h-3Z"/><circle cx="7" cy="10" r="1"/><circle cx="9" cy="6" r="1"/><circle cx="14" cy="6" r="1"/>',
    'plant': '<path d="M12 22V10"/><path d="M12 14C7 14 4 11 4 6c5 0 8 3 8 8Z"/><path d="M12 11c0-5 3-8 8-8 0 5-3 8-8 8Z"/>',
    'shield-check': '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-5"/>',
    'sign-out': '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M14 3h6v18h-6"/>',
    'storefront': '<path d="M4 10v10h16V10"/><path d="M3 4h18l-2 6H5L3 4Z"/><path d="M8 20v-6h8v6"/>',
    'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    'truck': '<path d="M3 6h11v11H3zM14 10h4l3 3v4h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
    'users-three': '<circle cx="12" cy="8" r="3"/><circle cx="5" cy="10" r="2"/><circle cx="19" cy="10" r="2"/><path d="M6 20a6 6 0 0 1 12 0M1 19a4 4 0 0 1 5-4M23 19a4 4 0 0 0-5-4"/>'
  });
  const PREMIUM_ICON_SELECTOR = [
    '#home-dashboard-grid > :is(div, button) > i',
    '#home-rep-dashboard-grid > button > i',
    '#bottom-nav .footer-nav-btn > i',
    '#side-drawer .drawer-item > i',
    '#side-drawer .ops-pilot-settings__eyebrow > i',
    '#view-communication .communication-hub-card i',
    '#global-header-inline-back > i',
    '.nav-outdoor-toggle > i'
  ].join(',');

  let bridge = null;
  function createSessionId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
      if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
        const values = new Uint32Array(4);
        window.crypto.getRandomValues(values);
        return Array.from(values, (value) => value.toString(16).padStart(8, '0')).join('-');
      }
    } catch (_error) {}
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  }

  let state = {
    eligible: false,
    userKey: '',
    monitoringEligible: false,
    flags: { ...DEFAULT_FLAGS },
    preferences: { ...DEFAULT_PREFERENCES },
    sessionId: createSessionId(),
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
  let premiumDecorateFrame = 0;
  let layoutHealthTimer = 0;
  let viewportResizeObserver = null;
  const healthDedupe = new Map();

  if (document.body) document.body.classList.add('ops-precision-pilot', 'ag-premium-skin', 'premium-skin-v16');

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

  function normalizePreferenceUserKey(value) {
    return String(value || '').trim().toLowerCase().replace(/@.*$/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function getDefaultPreferencesForUser(userKey) {
    return {
      ...DEFAULT_PREFERENCES,
      themeMode: normalizePreferenceUserKey(userKey) === LEGACY_DARK_DEFAULT_USERNAME ? 'dark' : 'light'
    };
  }

  function getPreferenceStorageKey(userKey = state.userKey) {
    const normalizedUserKey = normalizePreferenceUserKey(userKey);
    return normalizedUserKey ? `${PREFERENCE_STORAGE_KEY_PREFIX}${normalizedUserKey}` : '';
  }

  function readRememberedDeviceTheme() {
    try {
      const remembered = String(localStorage.getItem(DEVICE_THEME_STORAGE_KEY) || '').trim().toLowerCase();
      if (remembered === 'dark' || remembered === 'light') return remembered;
    } catch (_error) {}
    const prepaintTheme = String(window.__GNC_PREPAINT_THEME__ || document.documentElement?.dataset?.opsPrepaintTheme || '').trim().toLowerCase();
    return prepaintTheme === 'dark' ? 'dark' : 'light';
  }

  function writeRememberedDeviceTheme(theme) {
    const normalizedTheme = normalizeThemeMode(theme);
    try {
      localStorage.setItem(DEVICE_THEME_STORAGE_KEY, normalizedTheme);
    } catch (_error) {}
    window.__GNC_PREPAINT_THEME__ = normalizedTheme;
    return normalizedTheme;
  }

  function getRememberedDevicePreferences() {
    return { ...DEFAULT_PREFERENCES, themeMode: readRememberedDeviceTheme() };
  }

  function readCachedPreferences(userKey = state.userKey) {
    try {
      const normalizedUserKey = normalizePreferenceUserKey(userKey);
      const storageKey = getPreferenceStorageKey(normalizedUserKey);
      if (!storageKey) return null;
      let raw = localStorage.getItem(storageKey) || '';
      if (!raw && normalizedUserKey === LEGACY_DARK_DEFAULT_USERNAME) {
        raw = localStorage.getItem(LEGACY_PREFERENCE_STORAGE_KEY) || '';
        if (raw) localStorage.setItem(storageKey, raw);
      }
      const parsed = JSON.parse(raw || 'null');
      if (!parsed || typeof parsed !== 'object') return null;
      return { ...normalizePreferences(parsed), dirty: parsed.dirty === true };
    } catch (_error) {
      return null;
    }
  }

  function writeCachedPreferences(preferences, dirty, userKey = state.userKey) {
    try {
      const normalizedPreferences = normalizePreferences(preferences);
      writeRememberedDeviceTheme(normalizedPreferences.themeMode);
      const storageKey = getPreferenceStorageKey(userKey);
      if (!storageKey) return;
      localStorage.setItem(storageKey, JSON.stringify({
        ...normalizedPreferences,
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
    if (!state.eligible && !state.provisional) return readRememberedDeviceTheme();
    return state.preferences.themeMode === 'light' ? 'light' : 'dark';
  }

  function clearPrepaintTheme() {
    const root = document.documentElement;
    if (!root) return;
    root.removeAttribute('data-ops-prepaint-theme');
    root.style.removeProperty('color-scheme');
  }

  function gridIsSupportedHere() {
    const body = document.body;
    const viewportWidth = Math.max(1, Number(window.innerWidth || document.documentElement?.clientWidth || 1));
    const viewportHeight = Math.max(1, Number(window.innerHeight || document.documentElement?.clientHeight || 1));
    return !(body && body.classList.contains('viewport-phone')) && Math.min(viewportWidth, viewportHeight) >= 640;
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
    const gridSupported = gridIsSupportedHere();
    const effectiveDisplayMode = getEffectiveDisplayMode();
    document.querySelectorAll('button[data-ops-display-mode]').forEach((button) => {
      const mode = button.getAttribute('data-ops-display-mode');
      const unavailable = mode === 'grid' && !gridSupported;
      button.setAttribute('aria-pressed', String(mode === effectiveDisplayMode));
      button.toggleAttribute('disabled', unavailable);
      button.setAttribute('aria-disabled', String(unavailable));
      button.classList.toggle('ops-display-unavailable', unavailable);
    });
    const note = document.getElementById('ops-display-note');
    if (note) {
      note.textContent = gridSupported ? '' : 'Grid is available on tablets and computers. Cards are always used on phones.';
    }
  }

  function applyUiState() {
    const body = document.body;
    if (!body) return;
    const effectiveTheme = getEffectiveTheme();
    const effectiveDisplay = getEffectiveDisplayMode();
    const skinActive = true;
    body.classList.toggle('ops-pilot-active', state.eligible && !state.provisional);
    body.classList.remove('premium-skin-v14');
    body.classList.add('ops-precision-pilot', 'ag-premium-skin', 'premium-skin-v16');
    body.classList.toggle('ops-grid-effective', skinActive && effectiveDisplay === 'grid');
    body.dataset.opsTheme = effectiveTheme;
    body.dataset.opsThemeMode = effectiveTheme;
    body.dataset.opsDisplayMode = state.preferences.displayMode;
    body.dataset.opsEffectiveDisplay = effectiveDisplay;
    const bottomNav = document.getElementById('bottom-nav');
    if (bottomNav) {
      const darkNav = effectiveTheme === 'dark';
      bottomNav.dataset.resolvedTheme = effectiveTheme;
      bottomNav.style.setProperty('background-color', darkNav ? '#0b1c16' : '#ffffff', 'important');
      bottomNav.style.setProperty('background-image', 'none', 'important');
      bottomNav.style.setProperty('border-color', darkNav ? 'rgba(99, 230, 173, .52)' : '#9eb5a9', 'important');
      bottomNav.style.setProperty('color', darkNav ? '#d4e5dc' : '#33473e', 'important');
    }
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
      themeColorMeta.setAttribute('content', effectiveTheme === 'dark' ? '#07120e' : '#07874f');
    }
    writeRememberedDeviceTheme(effectiveTheme);
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
    schedulePremiumDecorations();
    scheduleDecorateRecordCollections();
    updateMonitoringTags();
  }

  function premiumIconName(element) {
    return Array.from(element.classList || []).find((name) => name.startsWith('ph-') && !['ph-bold', 'ph-duotone', 'ph-fill', 'ph-light', 'ph-thin'].includes(name))?.slice(3) || '';
  }

  function replacePremiumIcon(element) {
    if (!(element instanceof HTMLElement) || element.dataset.premiumIcon) return;
    const iconName = premiumIconName(element);
    const paths = PREMIUM_ICON_PATHS[iconName];
    if (!paths) {
      element.classList.remove('ph-bold', 'ph-duotone', 'ph-fill', 'ph-light', 'ph-thin');
      element.classList.add('ph');
      element.dataset.premiumIcon = 'fallback';
      return;
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const retainedClasses = Array.from(element.classList).filter((name) => !name.startsWith('ph-') && name !== 'ph');
    svg.setAttribute('class', ['premium-line-icon', ...retainedClasses].join(' '));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', element.getAttribute('aria-hidden') || 'true');
    svg.setAttribute('focusable', 'false');
    svg.dataset.premiumIcon = 'true';
    svg.dataset.icon = iconName;
    const parsed = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${paths}</svg>`, 'image/svg+xml');
    Array.from(parsed.documentElement.childNodes).forEach((child) => svg.appendChild(document.importNode(child, true)));
    element.replaceWith(svg);
  }

  function decoratePremiumComponents() {
    premiumDecorateFrame = 0;
    const root = document.getElementById('app-wrapper') || document;
    root.querySelectorAll(PREMIUM_ICON_SELECTOR).forEach(replacePremiumIcon);
    root.querySelectorAll(':is(input:not([type="checkbox"]):not([type="radio"]), select, textarea)').forEach((element) => element.classList.add('ui-field'));
    root.querySelectorAll(':is(.freeze-panel, .sticky-search, .fixed-filter-rail, .task-controls-sticky, .drive-controls-sticky)').forEach((element) => element.classList.add('ui-panel'));
    root.querySelectorAll(':is(.inv-card, .drill-item, .item-row, .task-card, .request-card, .dock-card, .manager-module-card, .communication-hub-card, .app-card-shell, .app-smart-card)').forEach((element) => element.classList.add('ui-card'));
    root.querySelectorAll(':is(.task-tab, .detail-tab, [role="tab"])').forEach((element) => element.classList.add('ui-tab'));
    root.querySelectorAll(':is(.animate-pulse, [data-loading="true"], [aria-busy="true"] .skeleton)').forEach((element) => element.classList.add('ui-skeleton'));
    root.querySelectorAll(':is(button, [role="button"])').forEach((element) => {
      if (element.closest('#bottom-nav') || element.classList.contains('footer-nav-btn')) return;
      element.classList.add('ui-action');
    });
    root.querySelectorAll('.rounded-full').forEach((element) => {
      if (!element.matches('input, textarea') && !element.classList.contains('android-icon-btn')) element.classList.add('ui-pill');
    });
  }

  function schedulePremiumDecorations() {
    if (premiumDecorateFrame) cancelAnimationFrame(premiumDecorateFrame);
    premiumDecorateFrame = requestAnimationFrame(decoratePremiumComponents);
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
    if (!LIST_VIEWS.has(state.activeView)) return;
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
    mutationObserver = new MutationObserver(() => {
      schedulePremiumDecorations();
      scheduleDecorateRecordCollections();
      scheduleLayoutHealthCheck('mutation');
    });
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
    if (kind === 'display' && (!state.flags.card_grid || (normalizeDisplayMode(value) === 'grid' && !gridIsSupportedHere()))) return false;
    const next = {
      ...state.preferences,
      updatedAt: nextPreferenceTimestamp()
    };
    if (kind === 'theme') next.themeMode = normalizeThemeMode(value);
    if (kind === 'display') next.displayMode = normalizeDisplayMode(value);
    state.preferences = next;
    writeCachedPreferences(next, true);
    applyUiState();
    if (kind === 'display' && state.activeView === 'drive' && typeof window.scheduleDriveRender === 'function') {
      window.setTimeout(() => window.scheduleDriveRender(0, 0), 0);
    }
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
      session_id: state.sessionId
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
      session_id: state.sessionId
    });
  }

  function initializeMonitoring(config) {
    if (monitoringReady || !state.monitoringEligible || !state.flags.monitoring || !config || !config.dsn) return Promise.resolve(false);
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
            session_id: state.sessionId
          }
        }
      });
      if (typeof sentry.setUser === 'function') sentry.setUser(null);
      monitoringReady = true;
      updateMonitoringTags();
      scheduleLayoutHealthCheck('monitoring-ready');
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
          sample_index: safeKind === 'longTasks' ? longTaskCount : undefined,
          metric_type: typeof safePayload.metricType === 'string' ? safePayload.metricType.slice(0, 24) : undefined,
          cancelled: typeof safePayload.cancelled === 'boolean' ? safePayload.cancelled : undefined
        }
      }, function () {});
    }
  }

  function captureHealth(assertion, passed, metrics = {}) {
    const sentry = window.GncSentry;
    const safeAssertion = String(assertion || '').trim().toLowerCase();
    if (!monitoringReady || !sentry || !HEALTH_ASSERTIONS.has(safeAssertion)) return false;
    if (passed && Math.random() > 0.1) return false;
    const dedupeKey = `${RELEASE}|${state.activeView}|${getEffectiveTheme()}|${viewportClass()}|${safeAssertion}|${passed ? 'pass' : 'fail'}`;
    const now = Date.now();
    if (now - Number(healthDedupe.get(dedupeKey) || 0) < 300000) return false;
    healthDedupe.set(dedupeKey, now);
    while (healthDedupe.size > 80) healthDedupe.delete(healthDedupe.keys().next().value);
    const safeMetrics = {};
    Object.entries(metrics && typeof metrics === 'object' ? metrics : {}).slice(0, 12).forEach(([key, value]) => {
      const safeKey = String(key || '').replace(/[^a-z0-9_]/gi, '').slice(0, 30);
      if (!safeKey || SENSITIVE_KEY_PATTERN.test(safeKey)) return;
      if (typeof value === 'boolean' || Number.isFinite(Number(value))) safeMetrics[safeKey] = typeof value === 'boolean' ? value : Math.round(Number(value) * 100) / 100;
    });
    if (typeof sentry.captureMessage === 'function') {
      sentry.captureMessage(`layout.${safeAssertion}.${passed ? 'pass' : 'fail'}`, {
        level: passed ? 'info' : 'warning',
        tags: { health_assertion: safeAssertion, health_status: passed ? 'pass' : 'fail' },
        extra: safeMetrics
      });
    }
    return true;
  }

  function measureRuntimeViewport() {
    const root = document.documentElement;
    const body = document.body;
    if (!root || !body) return;
    const viewport = window.visualViewport;
    const visibleHeight = Math.max(1, Number(viewport && viewport.height || window.innerHeight || root.clientHeight || 1));
    const visibleOffsetTop = Math.max(0, Number(viewport && viewport.offsetTop || 0));
    root.style.setProperty('--ops-visible-height', `${visibleHeight}px`);
    root.style.setProperty('--ops-visible-offset-top', `${visibleOffsetTop}px`);
    const nav = document.getElementById('bottom-nav');
    const navVisible = !!(nav && getComputedStyle(nav).display !== 'none');
    const navHeight = navVisible ? Math.max(0, Number(nav.getBoundingClientRect().height || 0)) : 0;
    root.style.setProperty('--footer-nav-reserve', `${navHeight}px`);
    const mainArea = document.getElementById('main-scroll-area');
    const mainTop = mainArea ? Math.max(0, Number(mainArea.getBoundingClientRect().top || 0) - visibleOffsetTop) : 0;
    root.style.setProperty('--ops-main-top', `${mainTop}px`);
    root.style.setProperty('--ops-content-available-height', `${Math.max(180, visibleHeight - mainTop - navHeight)}px`);
    if (nav) nav.dataset.resolvedTheme = getEffectiveTheme();
  }

  function runLayoutHealthAssertions() {
    layoutHealthTimer = 0;
    measureRuntimeViewport();
    const nav = document.getElementById('bottom-nav');
    if (nav && getComputedStyle(nav).display !== 'none') {
      const background = String(getComputedStyle(nav).backgroundColor || '').toLowerCase();
      const hasSurface = background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)';
      captureHealth('nav_theme', hasSurface && nav.dataset.resolvedTheme === getEffectiveTheme(), { has_surface: hasSurface });
    }
    if (state.activeView === 'home') {
      const grid = document.getElementById('home-dashboard-grid');
      if (grid) {
        const expected = Number(grid.dataset.authorizedModuleCount || 0);
        const tiles = Array.from(grid.querySelectorAll('[data-home-module-view]:not([hidden])')).filter((element) => element instanceof HTMLElement && element.offsetParent !== null);
        const rendered = tiles.length;
        captureHealth('home_modules', expected === rendered, { expected_count: expected, rendered_count: rendered });
        const rects = tiles.map((element) => element.getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0);
        const mainArea = document.getElementById('main-scroll-area');
        const navRect = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect() : null;
        const lastBottom = rects.length ? Math.max(...rects.map((rect) => rect.bottom)) : 0;
        const navTop = navRect ? navRect.top : Number(window.innerHeight || 0);
        const clearance = Math.max(0, navTop - lastBottom);
        const overlap = Math.max(0, lastBottom - navTop);
        const minWidth = rects.length ? Math.min(...rects.map((rect) => rect.width)) : 0;
        const minHeight = rects.length ? Math.min(...rects.map((rect) => rect.height)) : 0;
        const overflowX = Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth);
        const overflowY = mainArea ? Math.max(0, mainArea.scrollHeight - mainArea.clientHeight) : 0;
        const desktop = window.innerWidth >= 1100;
        const clearancePass = desktop ? clearance >= 20 && clearance <= 52 : clearance >= 0;
        const fitPass = expected === rendered && rendered > 0 && minWidth >= 44 && minHeight >= 44 && overlap <= 1 && overflowX <= 2 && overflowY <= 2 && clearancePass;
        captureHealth('home_fit', fitPass, {
          authorized_count: expected,
          rendered_count: rendered,
          clearance_px: clearance,
          tile_width_px: minWidth,
          tile_height_px: minHeight,
          overlap_px: overlap,
          overflow_x_px: overflowX,
          overflow_y_px: overflowY,
          columns: Number(document.getElementById('view-home') && document.getElementById('view-home').dataset.homeFitColumns || 0),
          bands: Number(document.getElementById('view-home') && document.getElementById('view-home').dataset.homeFitRows || 0)
        });
      }
    }
    if (state.activeView === 'chat') {
      const composer = document.querySelector('#view-chat .chat-thread-composer');
      const navRect = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect() : null;
      const visualBottom = Number(window.visualViewport && (window.visualViewport.offsetTop + window.visualViewport.height) || window.innerHeight || 0);
      const boundary = navRect ? Math.min(visualBottom, navRect.top) : visualBottom;
      const rect = composer ? composer.getBoundingClientRect() : null;
      const visible = !!(composer && rect && getComputedStyle(composer).display !== 'none' && rect.height >= 40 && rect.top < boundary && rect.bottom <= boundary + 3);
      captureHealth('chat_composer', visible, { composer_height: rect ? rect.height : 0, overlap_px: rect ? Math.max(0, rect.bottom - boundary) : boundary });
    }
    document.querySelectorAll('#request-filter-toolbar, #docks-filter-controls .docks-filter-row, #view-tasks .task-workflow-rail, #view-tasks #task-tabs-container').forEach((rail) => {
      if (!(rail instanceof HTMLElement) || rail.offsetParent === null) return;
      const children = Array.from(rail.children).filter((child) => child instanceof HTMLElement && child.offsetParent !== null);
      if (children.length < 2) return;
      const top = children[0].getBoundingClientRect().top;
      const singleRow = children.every((child) => Math.abs(child.getBoundingClientRect().top - top) <= 4);
      captureHealth('toolbar_row', singleRow, { control_count: children.length, scroll_width: rail.scrollWidth, client_width: rail.clientWidth });
    });
    if (state.activeView === 'drive' && window.innerWidth >= 840) {
      const mains = Array.from(document.querySelectorAll('#drive-content[data-drive-detailed-records="true"] .app-drive-card-main')).filter((element) => element instanceof HTMLElement && element.offsetParent !== null);
      if (mains.length) {
        const minimum = Math.min(...mains.slice(0, 12).map((element) => element.getBoundingClientRect().width));
        captureHealth('drive_card_width', minimum >= 180, { minimum_width: minimum, sampled_cards: Math.min(12, mains.length) });
      }
    }
  }

  function scheduleLayoutHealthCheck() {
    if (layoutHealthTimer) clearTimeout(layoutHealthTimer);
    layoutHealthTimer = setTimeout(runLayoutHealthAssertions, 120);
  }

  function installWebVitalObservers() {
    if (!window.PerformanceObserver || document.documentElement.dataset.opsVitalObservers === 'true') return;
    document.documentElement.dataset.opsVitalObservers = 'true';
    try {
      let clsValue = 0;
      new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => { if (!entry.hadRecentInput) clsValue += Number(entry.value || 0); });
        recordPerformance('webVitals', { metricType: 'cls', durationMs: clsValue * 1000 });
      }).observe({ type: 'layout-shift', buffered: true });
    } catch (_error) {}
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) recordPerformance('webVitals', { metricType: 'lcp', durationMs: Number(last.startTime || 0) });
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (_error) {}
    try {
      new PerformanceObserver((list) => {
        const longest = Math.max(0, ...list.getEntries().map((entry) => Number(entry.duration || 0)));
        if (longest) recordPerformance('webVitals', { metricType: 'inp', durationMs: longest });
      }).observe({ type: 'event', buffered: true, durationThreshold: 40 });
    } catch (_error) {}
  }

  function installRuntimeHealthMonitoring() {
    measureRuntimeViewport();
    installWebVitalObservers();
    if (window.visualViewport && !window.visualViewport.__opsHealthBound) {
      window.visualViewport.__opsHealthBound = true;
      window.visualViewport.addEventListener('resize', scheduleLayoutHealthCheck, { passive: true });
      window.visualViewport.addEventListener('scroll', scheduleLayoutHealthCheck, { passive: true });
    }
    if (!viewportResizeObserver && window.ResizeObserver) {
      viewportResizeObserver = new ResizeObserver(scheduleLayoutHealthCheck);
      [document.getElementById('bottom-nav'), document.getElementById('app-top-chrome'), document.getElementById('chat-content'), document.getElementById('home-dashboard-grid')].filter(Boolean).forEach((element) => viewportResizeObserver.observe(element));
    }
    scheduleLayoutHealthCheck('install');
  }

  function setActiveView(viewId) {
    state.activeView = String(viewId || 'home').trim().toLowerCase() || 'home';
    applyUiState();
    scheduleLayoutHealthCheck('view');
  }

  function deactivate() {
    const sessionId = state.sessionId || createSessionId();
    state = {
      eligible: false,
      userKey: '',
      monitoringEligible: false,
      flags: { ...DEFAULT_FLAGS },
      preferences: getRememberedDevicePreferences(),
      sessionId,
      activeView: 'home',
      initialized: false,
      provisional: false
    };
    applyUiState();
  }

  function primeCachedAppearance(options = {}) {
    const safeOptions = options && typeof options === 'object' ? options : {};
    const userKey = normalizePreferenceUserKey(safeOptions.userKey);
    if (!userKey) return false;
    const cached = readCachedPreferences(userKey);
    const rememberedTheme = readRememberedDeviceTheme();
    state = {
      eligible: false,
      userKey,
      monitoringEligible: false,
      flags: { ...DEFAULT_FLAGS },
      preferences: normalizePreferences({ ...(cached || getRememberedDevicePreferences()), themeMode: rememberedTheme }),
      sessionId: state.sessionId || createSessionId(),
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
    const userKey = normalizePreferenceUserKey(bridge && typeof bridge.getUserKey === 'function' ? bridge.getUserKey() : state.userKey);
    if (userKey) state.userKey = userKey;
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
      if (!response || response.ok !== true) {
        deactivate();
        clearPrepaintTheme();
        return false;
      }
      const flags = response.flags && typeof response.flags === 'object' ? response.flags : {};
      const appearanceEligible = response.eligible === true;
      const monitoringEligible = response.monitoringEligible === true && !!(response.monitoring && response.monitoring.dsn);
      const serverPreferences = appearanceEligible ? normalizePreferences(response.preferences) : getRememberedDevicePreferences();
      const cached = appearanceEligible ? readCachedPreferences(state.userKey) : null;
      const useDirtyCache = !!(appearanceEligible && cached && cached.dirty && timestampIsNewer(cached.updatedAt, serverPreferences.updatedAt));
      state.eligible = appearanceEligible;
      state.userKey = userKey;
      state.monitoringEligible = monitoringEligible;
      state.flags = {
        skin: flags.skin === true,
        preferences: appearanceEligible && flags.preferences === true,
        card_grid: appearanceEligible && flags.card_grid === true,
        monitoring: monitoringEligible
      };
      state.preferences = useDirtyCache ? normalizePreferences(cached) : serverPreferences;
      state.activeView = String(bridge.getActiveView && bridge.getActiveView() || 'home').trim().toLowerCase() || 'home';
      state.initialized = true;
      state.provisional = false;
      if (appearanceEligible) writeCachedPreferences(state.preferences, useDirtyCache);
      applyUiState();
      clearPrepaintTheme();
      if (useDirtyCache) requestPreferenceSave();
      if (monitoringEligible) initializeMonitoring(response.monitoring);
      installRuntimeHealthMonitoring();
      return appearanceEligible || monitoringEligible;
    } catch (_error) {
      if (serial === initializeSerial && !state.provisional) deactivate();
      return false;
    }
  }

  window.addEventListener('resize', () => {
    applyUiState();
    scheduleLayoutHealthCheck('resize');
  }, { passive: true });
  window.addEventListener('online', () => requestPreferenceSave(), { passive: true });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      schedulePremiumDecorations();
      installMutationObserver();
    }, { once: true });
  } else {
    schedulePremiumDecorations();
    installMutationObserver();
  }

  window.__gncOpsPilot = Object.freeze({
    release: RELEASE,
    initialize,
    primeCachedAppearance,
    setActiveView,
    captureFailure,
    captureHealth,
    observeToast,
    recordPerformance,
    applyUiState,
    getState() {
      return {
        initialized: state.initialized,
        provisional: state.provisional,
        eligible: state.eligible,
        userKey: state.userKey,
        monitoringEligible: state.monitoringEligible,
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
