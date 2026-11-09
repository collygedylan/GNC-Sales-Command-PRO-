export const RELEASE = 'AgData v3.0.40';
export const SENTRY_BUNDLE_URL = './assets/vendor/sentry-browser-10.70.0.min.js';
export const DEVICE_THEME_STORAGE_KEY = 'gnc_last_theme_v1';
export const PREFERENCE_STORAGE_KEY_PREFIX = 'gnc_ops_precision_preferences_v2:';
export const LEGACY_PREFERENCE_STORAGE_KEY = 'gnc_ops_precision_preferences_v1';
export const LEGACY_DARK_DEFAULT_USERNAME = 'dylan_collyge';
export const LIST_VIEWS = new Set([
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
export const LIST_ROOT_IDS = Object.freeze({
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
export const DEFAULT_FLAGS = Object.freeze({ skin: false, preferences: false, card_grid: false, monitoring: false });
export const DEFAULT_PREFERENCES = Object.freeze({ themeMode: 'light', displayMode: 'cards', updatedAt: '' });
export const PERFORMANCE_KINDS = new Set(['viewSwitches', 'renders', 'chunks', 'longTasks', 'staleSkips', 'search', 'webVitals']);
export const HEALTH_ASSERTIONS = new Set(['chat_composer', 'home_modules', 'home_fit', 'nav_theme', 'toolbar_row', 'drive_card_width', 'task_search']);
export const SENSITIVE_KEY_PATTERN = /(user(name)?|name|note|item|code|customer|consignee|row|record|photo|image|body|header|query|payload|request|url|uri|email|token|password|pin|authorization|cookie)/i;
export const RECORD_CLASS_PATTERN = /(^|\s)(inv-card|drill-item|item-row|task-card|request-card|dock-card|manager-card|approval-card|low-stock-card|communication-card|sales-office-card|rounded-(?:lg|xl|2xl).*border)(\s|$)/i;
export const PREMIUM_ICON_PATHS = Object.freeze({
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
export const PREMIUM_ICON_SELECTOR = [
    '#home-dashboard-grid > :is(div, button) > i',
    '#home-rep-dashboard-grid > button > i',
    '#bottom-nav .footer-nav-btn > i',
    '#side-drawer .drawer-item > i',
    '#side-drawer .ops-pilot-settings__eyebrow > i',
    '#view-communication .communication-hub-card i',
    '#global-header-inline-back > i',
    '.nav-outdoor-toggle > i'
  ].join(',');
export const premiumDecorationRoots = new Set();
export const healthDedupe = new Map();
export const BROWSE_RAIL_SELECTOR = [
    '#drive-plant-filters.drive-top-inline .drive-top-controls-row',
    '#review-plant-filters.drive-top-inline .drive-top-controls-row',
    '#move-up-plant-filters.drive-top-inline .drive-top-controls-row',
    '#docks-filter-controls.docks-top-inline .docks-filter-row',
    '#task-tabs-container.task-top-inline',
    '.crop-roll-filter-controls',
    '.manager-crop-roll-review-filter-controls',
    '#request-dylan-filter-panel.compact-filter-rail',
    '#view-request .request-view-filters',
    '.manager-eval2-drive-controls',
    '.workflow-control-rail:not(:has(.docks-filter-row))'
  ].join(',');
export const compactBrowseRailState = new WeakMap();
export const compactBrowseRailOpenState = new Map();

export function createSessionId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
      if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
        const values = new Uint32Array(4);
        window.crypto.getRandomValues(values);
        return Array.from(values, (value) => value.toString(16).padStart(8, '0')).join('-');
      }
    } catch {}
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  }

export const shared = {
  bridge: null,
  state: {
    eligible: false,
    userKey: '',
    monitoringEligible: false,
    flags: { ...DEFAULT_FLAGS },
    preferences: { ...DEFAULT_PREFERENCES },
    sessionId: createSessionId(),
    activeView: 'home',
    initialized: false,
    provisional: false
  },
  initializeSerial: 0,
  preferenceSaveInFlight: null,
  preferenceRetryTimer: null,
  preferenceRetryAttempt: 0,
  decorateFrame: 0,
  mutationObserver: null,
  monitoringReady: false,
  monitoringLoadPromise: null,
  longTaskCount: 0,
  premiumDecorateFrame: 0,
  layoutHealthTimer: 0,
  healthRetryInFlight: false,
  viewportResizeObserver: null,
  compactBrowseRailFrame: 0,
  hasCompactBrowseRails: false,
};
