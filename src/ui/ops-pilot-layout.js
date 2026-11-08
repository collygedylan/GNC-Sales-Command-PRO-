import { applyUiState, getEffectiveTheme, getRememberedDevicePreferences, normalizePreferenceUserKey, normalizePreferences, readCachedPreferences, readRememberedDeviceTheme } from './ops-pilot-appearance.js';
import { captureHealth, recordPerformance } from './ops-pilot-monitoring.js';
import { DEFAULT_FLAGS, createSessionId, shared } from './ops-pilot-state.js';

export function measureRuntimeViewport() {
    const root = document.documentElement;
    const body = document.body;
    if (!root || !body) return;
    const viewport = window.visualViewport;
    const visibleHeight = Math.max(1, Number(viewport && viewport.height || window.innerHeight || root.clientHeight || 1));
    const visibleOffsetTop = Math.max(0, Number(viewport && viewport.offsetTop || 0));
    const nav = document.getElementById('bottom-nav');
    const navVisible = !!(nav && getComputedStyle(nav).display !== 'none');
    const navHeight = navVisible ? Math.max(0, Number(nav.getBoundingClientRect().height || 0)) : 0;
    const mainArea = document.getElementById('main-scroll-area');
    const mainTop = mainArea ? Math.max(0, Number(mainArea.getBoundingClientRect().top || 0) - visibleOffsetTop) : 0;
    // Read geometry together, then write only changed values. Repeated health
    // checks should not invalidate layout between each measurement while typing.
    const measurements = {
      '--ops-visible-height': visibleHeight,
      '--ops-visible-offset-top': visibleOffsetTop,
      '--footer-nav-reserve': navHeight,
      '--ops-main-top': mainTop,
      '--ops-content-available-height': Math.max(180, visibleHeight - mainTop - navHeight)
    };
    Object.entries(measurements).forEach(([property, value]) => {
      const next = `${value}px`;
      if (root.style.getPropertyValue(property) !== next) root.style.setProperty(property, next);
    });
    const theme = getEffectiveTheme();
    if (nav && nav.dataset.resolvedTheme !== theme) nav.dataset.resolvedTheme = theme;
  }

export function captureHomeLayoutHealth(nav) {
    if (shared.state.activeView !== 'home') return;

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

export function captureChatLayoutHealth(nav) {
    if (shared.state.activeView !== 'chat') return;

      const composer = document.querySelector('#view-chat .chat-thread-composer');
      const navRect = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect() : null;
      const visualBottom = Number(window.visualViewport && (window.visualViewport.offsetTop + window.visualViewport.height) || window.innerHeight || 0);
      const boundary = navRect ? Math.min(visualBottom, navRect.top) : visualBottom;
      const rect = composer ? composer.getBoundingClientRect() : null;
      const visible = !!(composer && rect && getComputedStyle(composer).display !== 'none' && rect.height >= 40 && rect.top < boundary && rect.bottom <= boundary + 3);
      captureHealth('chat_composer', visible, { composer_height: rect ? rect.height : 0, overlap_px: rect ? Math.max(0, rect.bottom - boundary) : boundary });
    
  }

function pilotInteractionActive() {
    return ['isUserActivelyTyping', 'isUserActivelyTouching', 'isUserActivelyScrolling']
        .some(name => typeof window[name] === 'function' && window[name]());
}

async function waitForPilotIdle() {
    if (shared.healthRetryInFlight) return;
    shared.healthRetryInFlight = true;
    try {
        for (let attempt = 0; attempt < 40; attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 250));
            if (!pilotInteractionActive()) { runLayoutHealthAssertions(); return; }
        }
    } finally { shared.healthRetryInFlight = false; }
}

export function runLayoutHealthAssertions() {
    shared.layoutHealthTimer = 0;
    measureRuntimeViewport();
    if (pilotInteractionActive()) {
      void waitForPilotIdle();
      return;
    }
    const nav = document.getElementById('bottom-nav');
    if (nav && getComputedStyle(nav).display !== 'none') {
      const background = String(getComputedStyle(nav).backgroundColor || '').toLowerCase();
      const hasSurface = background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)';
      captureHealth('nav_theme', hasSurface && nav.dataset.resolvedTheme === getEffectiveTheme(), { has_surface: hasSurface });
    }
    captureHomeLayoutHealth(nav);
    captureChatLayoutHealth(nav);
    document.querySelectorAll('#request-filter-toolbar, #docks-filter-controls .docks-filter-row, #view-tasks .task-workflow-rail, #view-tasks #task-tabs-container').forEach((rail) => {
      if (!(rail instanceof HTMLElement) || rail.offsetParent === null) return;
      const children = Array.from(rail.children).filter((child) => child instanceof HTMLElement && child.offsetParent !== null);
      if (children.length < 2) return;
      const top = children[0].getBoundingClientRect().top;
      const singleRow = children.every((child) => Math.abs(child.getBoundingClientRect().top - top) <= 4);
      captureHealth('toolbar_row', singleRow, { control_count: children.length, scroll_width: rail.scrollWidth, client_width: rail.clientWidth });
    });
    if (shared.state.activeView === 'drive' && window.innerWidth >= 840) {
      const mains = Array.from(document.querySelectorAll('#drive-content[data-drive-detailed-records="true"] .app-drive-card-main'))
        .map((element) => element.querySelector('.app-drive-card-details') || element)
        .filter((element) => element instanceof HTMLElement && element.offsetParent !== null);
      if (mains.length) {
        const minimum = Math.min(...mains.slice(0, 12).map((element) => element.getBoundingClientRect().width));
        captureHealth('drive_card_width', minimum >= 180, { minimum_width: minimum, sampled_cards: Math.min(12, mains.length) });
      }
    }
  }

export function scheduleLayoutHealthCheck() {
    if (shared.layoutHealthTimer) clearTimeout(shared.layoutHealthTimer);
    shared.layoutHealthTimer = setTimeout(runLayoutHealthAssertions, 120);
  }

function observeLayoutShift() {
    let clsValue = 0;
    const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) clsValue += Number(entry.value || 0);
        recordPerformance('webVitals', { metricType: 'cls', durationMs: clsValue * 1000 });
    });
    observer.observe({ type: 'layout-shift', buffered: true });
}

function observeLargestPaint() {
    const observer = new PerformanceObserver(list => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) recordPerformance('webVitals', { metricType: 'lcp', durationMs: Number(last.startTime || 0) });
    });
    observer.observe({ type: 'largest-contentful-paint', buffered: true });
}

function observeInteractionLatency() {
    const observer = new PerformanceObserver(list => {
        const longest = Math.max(0, ...list.getEntries().map(entry => Number(entry.duration || 0)));
        if (longest) recordPerformance('webVitals', { metricType: 'inp', durationMs: longest });
    });
    observer.observe({ type: 'event', buffered: true, durationThreshold: 40 });
}

export function installWebVitalObservers() {
    if (!window.PerformanceObserver || document.documentElement.dataset.opsVitalObservers === 'true') return;
    document.documentElement.dataset.opsVitalObservers = 'true';
    for (const observe of [observeLayoutShift, observeLargestPaint, observeInteractionLatency]) {
        try { observe(); } catch {}
    }
}

export function installRuntimeHealthMonitoring() {
    measureRuntimeViewport();
    installWebVitalObservers();
    if (window.visualViewport && !window.visualViewport.__opsHealthBound) {
      window.visualViewport.__opsHealthBound = true;
      window.visualViewport.addEventListener('resize', scheduleLayoutHealthCheck, { passive: true });
      window.visualViewport.addEventListener('scroll', scheduleLayoutHealthCheck, { passive: true });
    }
    if (!shared.viewportResizeObserver && window.ResizeObserver) {
      shared.viewportResizeObserver = new ResizeObserver(scheduleLayoutHealthCheck);
      [document.getElementById('bottom-nav'), document.getElementById('app-top-chrome'), document.getElementById('chat-content'), document.getElementById('home-dashboard-grid')].filter(Boolean).forEach((element) => shared.viewportResizeObserver.observe(element));
    }
    scheduleLayoutHealthCheck('install');
  }

export function setActiveView(viewId) {
    shared.state.activeView = String(viewId || 'home').trim().toLowerCase() || 'home';
    applyUiState();
    scheduleLayoutHealthCheck('view');
  }

export function deactivate() {
    const sessionId = shared.state.sessionId || createSessionId();
    shared.state = {
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

export function primeCachedAppearance(options = {}) {
    const safeOptions = options && typeof options === 'object' ? options : {};
    const userKey = normalizePreferenceUserKey(safeOptions.userKey);
    if (!userKey) return false;
    const cached = readCachedPreferences(userKey);
    const rememberedTheme = readRememberedDeviceTheme();
    shared.state = {
      eligible: false,
      userKey,
      monitoringEligible: false,
      flags: { ...DEFAULT_FLAGS },
      preferences: normalizePreferences({ ...(cached || getRememberedDevicePreferences()), themeMode: rememberedTheme }),
      sessionId: shared.state.sessionId || createSessionId(),
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

