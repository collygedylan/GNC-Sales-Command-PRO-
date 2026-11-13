import { DEFAULT_PREFERENCES, DEVICE_THEME_STORAGE_KEY, LEGACY_DARK_DEFAULT_USERNAME, LEGACY_PREFERENCE_STORAGE_KEY, LIST_VIEWS, PREFERENCE_STORAGE_KEY_PREFIX, PREMIUM_ICON_PATHS, PREMIUM_ICON_SELECTOR, premiumDecorationRoots, shared } from './ops-pilot-state.js';
import { scheduleDecorateRecordCollections } from './ops-pilot-collections.js';
import { updateMonitoringTags } from './ops-pilot-monitoring.js';

export function normalizeThemeMode(value) {
    const mode = String(value || '').trim().toLowerCase();
    return mode === 'light' ? 'light' : 'dark';
  }

export function normalizeDisplayMode(value) {
    return String(value || '').trim().toLowerCase() === 'grid' ? 'grid' : 'cards';
  }

export function normalizeTimestamp(value) {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
  }

export function normalizePreferences(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      themeMode: normalizeThemeMode(source.themeMode || source.theme_mode || source.theme),
      displayMode: normalizeDisplayMode(source.displayMode || source.display_mode),
      updatedAt: normalizeTimestamp(source.updatedAt || source.updated_at)
    };
  }

export function normalizePreferenceUserKey(value) {
    return String(value || '').trim().toLowerCase().replace(/@.*$/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

export function getDefaultPreferencesForUser(userKey) {
    return {
      ...DEFAULT_PREFERENCES,
      themeMode: normalizePreferenceUserKey(userKey) === LEGACY_DARK_DEFAULT_USERNAME ? 'dark' : 'light'
    };
  }

export function getPreferenceStorageKey(userKey = shared.state.userKey) {
    const normalizedUserKey = normalizePreferenceUserKey(userKey);
    return normalizedUserKey ? `${PREFERENCE_STORAGE_KEY_PREFIX}${normalizedUserKey}` : '';
  }

export function readRememberedDeviceTheme() {
    try {
      const remembered = String(localStorage.getItem(DEVICE_THEME_STORAGE_KEY) || '').trim().toLowerCase();
      if (remembered === 'dark' || remembered === 'light') return remembered;
    } catch {}
    const prepaintTheme = String(window.__GNC_PREPAINT_THEME__ || document.documentElement?.dataset?.opsPrepaintTheme || '').trim().toLowerCase();
    return prepaintTheme === 'dark' ? 'dark' : 'light';
  }

export function writeRememberedDeviceTheme(theme) {
    const normalizedTheme = normalizeThemeMode(theme);
    try {
      localStorage.setItem(DEVICE_THEME_STORAGE_KEY, normalizedTheme);
    } catch {}
    window.__GNC_PREPAINT_THEME__ = normalizedTheme;
    return normalizedTheme;
  }

export function getRememberedDevicePreferences() {
    return { ...DEFAULT_PREFERENCES, themeMode: readRememberedDeviceTheme() };
  }

export function readCachedPreferences(userKey = shared.state.userKey) {
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
    } catch {
      return null;
    }
  }

export function writeCachedPreferences(preferences, dirty, userKey = shared.state.userKey) {
    try {
      const normalizedPreferences = normalizePreferences(preferences);
      writeRememberedDeviceTheme(normalizedPreferences.themeMode);
      const storageKey = getPreferenceStorageKey(userKey);
      if (!storageKey) return;
      localStorage.setItem(storageKey, JSON.stringify({
        ...normalizedPreferences,
        dirty: dirty === true
      }));
    } catch {}
  }

export function timestampIsNewer(left, right) {
    return (Date.parse(String(left || '')) || 0) > (Date.parse(String(right || '')) || 0);
  }

export function nextPreferenceTimestamp() {
    const previous = Date.parse(String(shared.state.preferences.updatedAt || '')) || 0;
    return new Date(Math.max(Date.now(), previous + 1)).toISOString();
  }

export function getEffectiveTheme() {
    if (['home', 'drive', 'av', 'av-photo'].includes(shared.state.activeView)) return 'dark';
    if (!shared.state.eligible && !shared.state.provisional) return readRememberedDeviceTheme();
    return shared.state.preferences.themeMode === 'light' ? 'light' : 'dark';
  }

export function clearPrepaintTheme() {
    const root = document.documentElement;
    if (!root) return;
    root.removeAttribute('data-ops-prepaint-theme');
    root.style.removeProperty('color-scheme');
  }

export function gridIsSupportedHere() {
    const body = document.body;
    const viewportWidth = Math.max(1, Number(window.innerWidth || document.documentElement?.clientWidth || 1));
    const viewportHeight = Math.max(1, Number(window.innerHeight || document.documentElement?.clientHeight || 1));
    return !(body && body.classList.contains('viewport-phone')) && Math.min(viewportWidth, viewportHeight) >= 640;
  }

export function getEffectiveDisplayMode() {
    if ((!shared.state.flags.card_grid && !shared.state.provisional) || !LIST_VIEWS.has(shared.state.activeView)) return 'cards';
    if (shared.state.preferences.displayMode !== 'grid' || !gridIsSupportedHere()) return 'cards';
    return 'grid';
  }

export function updateControlState() {
    document.querySelectorAll('button[data-ops-theme-mode]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-ops-theme-mode') === shared.state.preferences.themeMode));
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

export function applyUiState() {
    const body = document.body;
    if (!body) return;
    const effectiveTheme = getEffectiveTheme();
    const effectiveDisplay = getEffectiveDisplayMode();
    const skinActive = true;
    body.classList.toggle('ops-pilot-active', shared.state.eligible && !shared.state.provisional);
    body.classList.remove('premium-skin-v14');
    body.classList.add('ops-precision-pilot', 'ag-premium-skin', 'premium-skin-v16');
    body.classList.toggle('ops-grid-effective', skinActive && effectiveDisplay === 'grid');
    body.dataset.opsTheme = effectiveTheme;
    body.dataset.opsThemeMode = effectiveTheme;
    body.dataset.opsDisplayMode = shared.state.preferences.displayMode;
    body.dataset.opsEffectiveDisplay = effectiveDisplay;
    const bottomNav = document.getElementById('bottom-nav');
    if (bottomNav) {
      bottomNav.dataset.resolvedTheme = effectiveTheme;
      for (const property of ['background-color', 'background-image', 'border-color', 'color']) {
        bottomNav.style.removeProperty(property);
      }
    }
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
      themeColorMeta.setAttribute('content', effectiveTheme === 'dark' ? '#050806' : '#f4fbf7');
    }
    writeRememberedDeviceTheme(shared.state.preferences.themeMode);
    if (typeof window.syncGlobalHeaderChrome === 'function') {
      window.requestAnimationFrame(() => {
        window.syncGlobalHeaderChrome({ reason: 'ops-precision-state', force: true });
        if (typeof window.updateGlobalBackButton === 'function') window.updateGlobalBackButton();
      });
    }
    body.dataset.opsView = shared.state.activeView;
    const panel = document.getElementById('ops-pilot-settings');
    const themeGroup = document.getElementById('ops-theme-settings');
    const displayGroup = document.getElementById('ops-display-settings');
    if (panel) panel.classList.toggle('hidden', shared.state.provisional || !shared.state.eligible || (!shared.state.flags.preferences && !shared.state.flags.card_grid));
    if (themeGroup) themeGroup.classList.toggle('hidden', !shared.state.flags.preferences);
    if (displayGroup) displayGroup.classList.toggle('hidden', !shared.state.flags.card_grid);
    updateControlState();
    schedulePremiumDecorations();
    scheduleDecorateRecordCollections();
    updateMonitoringTags();
  }

export function premiumIconName(element) {
    return Array.from(element.classList || []).find((name) => name.startsWith('ph-') && !['ph-bold', 'ph-duotone', 'ph-fill', 'ph-light', 'ph-thin'].includes(name))?.slice(3) || '';
  }

export function replacePremiumIcon(element) {
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

export function selectPremiumTargets(root, selector) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    const targets = Array.from(root.querySelectorAll(selector));
    if (root instanceof Element && root.matches(selector)) targets.unshift(root);
    return targets;
  }

export function decoratePremiumComponents(root = document.getElementById('app-wrapper') || document) {
    selectPremiumTargets(root, PREMIUM_ICON_SELECTOR).forEach(replacePremiumIcon);
    selectPremiumTargets(root, ':is(input:not([type="checkbox"]):not([type="radio"]), select, textarea)').forEach((element) => element.classList.add('ui-field'));
    selectPremiumTargets(root, ':is(.freeze-panel, .sticky-search, .fixed-filter-rail, .task-controls-sticky, .drive-controls-sticky)').forEach((element) => element.classList.add('ui-panel'));
    selectPremiumTargets(root, ':is(.inv-card, .drill-item, .item-row, .task-card, .request-card, .dock-card, .manager-module-card, .communication-hub-card, .app-card-shell, .app-smart-card)').forEach((element) => element.classList.add('ui-card'));
    selectPremiumTargets(root, ':is(.task-tab, .detail-tab, [role="tab"])').forEach((element) => element.classList.add('ui-tab'));
    selectPremiumTargets(root, ':is(.animate-pulse, [data-loading="true"], [aria-busy="true"] .skeleton)').forEach((element) => element.classList.add('ui-skeleton'));
    selectPremiumTargets(root, ':is(button, [role="button"])').forEach((element) => {
      if (element.closest('#bottom-nav') || element.classList.contains('footer-nav-btn')) return;
      element.classList.add('ui-action');
    });
    selectPremiumTargets(root, '.rounded-full').forEach((element) => {
      if (!element.matches('input, textarea') && !element.classList.contains('android-icon-btn')) element.classList.add('ui-pill');
    });
  }

export function schedulePremiumDecorations(root = null) {
    const fullRoot = document.getElementById('app-wrapper') || document;
    if (!root || root === fullRoot || root === document) {
      premiumDecorationRoots.clear();
      premiumDecorationRoots.add(fullRoot);
    } else if (!premiumDecorationRoots.has(fullRoot)) {
      premiumDecorationRoots.add(root);
    }
    if (shared.premiumDecorateFrame) return;
    shared.premiumDecorateFrame = requestAnimationFrame(() => {
      shared.premiumDecorateFrame = 0;
      const roots = Array.from(premiumDecorationRoots).filter((candidate) => candidate && (candidate === document || candidate.isConnected !== false));
      premiumDecorationRoots.clear();
      if (roots.length > 24) {
        decoratePremiumComponents(fullRoot);
        return;
      }
      roots.forEach(decoratePremiumComponents);
    });
  }

