import { hlMaster, installHlOrderFixture } from '../tests/fixtures/hl-order-state.mjs';
import { installPerformanceCoordinatorObserver } from './performance-coordinator-observer.mjs';
import { installPerformanceLoginValidationObserver } from './performance-login-validation-observer.mjs';
import { installPerformanceShellObserver } from './performance-shell-observer.mjs';
import { isPerformancePollWindowReady } from './performance-dom-observer.mjs';

export const inventoryRows = Array.from({ length: 1000 }, (_, index) => hlMaster(`perf-${String(index).padStart(5, '0')}`, {
  itemcode: `00${Math.floor(index / 4)}`, commonname: `Performance plant ${String(Math.floor(index / 4)).padStart(3, '0')}`,
  locationcode: `C.06.${String(index % 22).padStart(3, '0')}`, ptravailable: '25', ptronhand: '40', priority: '1'
}));
const queueRows = inventoryRows.slice(0, 200).map(row => ({ ...row, unique_id: `request-${row.unique_id}`,
  req_status: 'Pending', req_archived: false, req_qty: '5', req_match: '100', request_folder: 'performance-folder',
  req_customer: 'Synthetic Customer', salesrepname: 'Fixture Rep', requested_by: 'performance_admin' }));

// After route readiness, wait through a short asynchronous-settlement window
// (about four 60 Hz frames). Longer live polling remains measured and is
// reported in its route or between-phase partition; this never cancels reads.
export const PERFORMANCE_API_QUIET_MS = 75;

export const PERFORMANCE_HOME_READY_TIMEOUT_MS = 15_000;
export const PERFORMANCE_VIEW_READY_TIMEOUT_MS = 15_000;
export const PERFORMANCE_COLD_STARTUP_TIMEOUT_MS = 15_000;
export const PERFORMANCE_POLL_HEADROOM_MS = 12_000;
export const PERFORMANCE_POLL_WINDOW_TIMEOUT_MS = 45_000;

const performanceControlsByPage = new WeakMap();

export function isPerformanceColdStartupReady(state = {}) {
  if (state.documentReadyState !== 'complete' || state.runtimeBootState !== 'ready' || state.appSessionStartupStarted !== true) return false;
  const attempts = Array.isArray(state.loginAttempts) ? state.loginAttempts : [];
  const lastRestore = attempts.filter(attempt => attempt && attempt.kind === 'restore').at(-1);
  return !!lastRestore && lastRestore.outcome === 'failed';
}

export function buildPerformanceColdStartupReadyExpression() {
  return `(${isPerformanceColdStartupReady.toString()})( {
    documentReadyState: document.readyState,
    runtimeBootState: window.__gncRuntimeBootTiming?.state,
    appSessionStartupStarted: window.eval('typeof appSessionStartupStarted !== "undefined" && appSessionStartupStarted === true'),
    loginAttempts: window.GncLoginTrace?.snapshot?.().attempts
  })`;
}

export async function waitForPerformanceColdStartupReady(page, { timeoutMs = PERFORMANCE_COLD_STARTUP_TIMEOUT_MS } = {}) {
  if (!page || typeof page.waitForFunction !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('PERFORMANCE_COLD_STARTUP_OPTIONS_INVALID');
  }
  const expression = buildPerformanceColdStartupReadyExpression();
  const handle = await page.waitForFunction(value => window.eval(value), expression, { polling: 'raf', timeout: timeoutMs });
  await handle.dispose();
  return { method: 'load-runtime-startup-restore-failed', timeoutMs };
}

export function buildPerformancePollWindowExpression(headroomMs = PERFORMANCE_POLL_HEADROOM_MS) {
  if (!Number.isFinite(headroomMs) || headroomMs < 0) throw new Error('PERFORMANCE_POLL_HEADROOM_INVALID');
  return `(${isPerformancePollWindowReady.toString()})(window.__phase6CoordinatorObserver?.getPendingActivity?.(), ${headroomMs})`;
}

export async function waitForPerformancePollWindow(page, { headroomMs = PERFORMANCE_POLL_HEADROOM_MS,
  timeoutMs = PERFORMANCE_POLL_WINDOW_TIMEOUT_MS } = {}) {
  if (!page || typeof page.waitForFunction !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('PERFORMANCE_POLL_WINDOW_OPTIONS_INVALID');
  }
  const expression = buildPerformancePollWindowExpression(headroomMs);
  const handle = await page.waitForFunction(value => window.eval(value), expression, { polling: 'raf', timeout: timeoutMs });
  await handle.dispose();
  return { method: 'unmodified-coordinator-poll-headroom', headroomMs, timeoutMs };
}

export function attachPerformanceApiIdleTracker(page, { quietMs = PERFORMANCE_API_QUIET_MS } = {}) {
  if (!page || typeof page.on !== 'function' || !Number.isFinite(quietMs) || quietMs < 1) {
    throw new Error('PERFORMANCE_API_IDLE_TRACKER_OPTIONS_INVALID');
  }
  const pending = new Set();
  let activity = 0;
  const isApiRequest = request => request.method() !== 'OPTIONS'
    && /\/(?:rest|functions)\/v1\//.test(new URL(request.url()).pathname);
  page.on('request', request => {
    if (!isApiRequest(request)) return;
    pending.add(request);
    activity++;
  });
  const settle = request => {
    if (!isApiRequest(request)) return;
    pending.delete(request);
    activity++;
  };
  page.on('requestfinished', settle);
  page.on('requestfailed', settle);

  return {
    quietMs,
    async waitForApiIdle({ timeoutMs = 15_000 } = {}) {
      if (!Number.isFinite(timeoutMs) || timeoutMs <= quietMs) throw new Error('PERFORMANCE_API_IDLE_TIMEOUT_INVALID');
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (pending.size) {
          await new Promise(resolve => setTimeout(resolve, Math.min(10, Math.max(1, deadline - Date.now()))));
          continue;
        }
        const observedActivity = activity;
        const quietUntil = Date.now() + quietMs;
        while (Date.now() < quietUntil && Date.now() < deadline && pending.size === 0 && activity === observedActivity) {
          await new Promise(resolve => setTimeout(resolve, Math.min(10, Math.max(1, Math.min(quietUntil, deadline) - Date.now()))));
        }
        if (Date.now() >= deadline) throw new Error('PERFORMANCE_API_IDLE_TIMEOUT');
        if (pending.size === 0 && activity === observedActivity && Date.now() >= quietUntil) {
          return { quietMs, activityCount: activity };
        }
      }
      throw new Error('PERFORMANCE_API_IDLE_TIMEOUT');
    }
  };
}

export async function waitForPerformanceHomeReadiness({ waitForRuntimeReady, isRuntimeReady, waitForApiIdle,
  timeoutMs = PERFORMANCE_HOME_READY_TIMEOUT_MS, quietMs = PERFORMANCE_API_QUIET_MS } = {}) {
  if (typeof waitForRuntimeReady !== 'function' || typeof isRuntimeReady !== 'function'
    || typeof waitForApiIdle !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0
    || !Number.isFinite(quietMs) || quietMs < 1) {
    throw new Error('PERFORMANCE_HOME_READINESS_OPTIONS_INVALID');
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    await waitForRuntimeReady(remaining);
    await waitForApiIdle({ timeoutMs: Math.max(1, deadline - Date.now()) });
    const ready = await isRuntimeReady();
    if (Date.now() >= deadline) throw new Error('PERFORMANCE_HOME_READINESS_TIMEOUT');
    if (ready) return { method: 'home-loader-queues-and-api-idle', quietMs };
  }
  throw new Error('PERFORMANCE_HOME_READINESS_TIMEOUT');
}

export function isPerformanceHomeRuntimeReady(state = {}) {
  return isPerformanceViewRuntimeReady(state, 'home');
}

export function isPerformanceViewRuntimeReady(state = {}, expectedViewId = '', requireLoginValidation = false) {
  const expectedView = String(expectedViewId || '').trim();
  if (!expectedView || state.viewId !== expectedView) return false;
  if (requireLoginValidation) {
    const activity = state.loginValidationActivity;
    if (!activity) throw new Error('PERFORMANCE_LOGIN_VALIDATION_OBSERVER_MISSING');
    if (activity.contractValid !== true) throw new Error('PERFORMANCE_LOGIN_VALIDATION_CONTRACT_INVALID');
    if (!Number.isInteger(activity.calls) || activity.calls < 1 || activity.pending !== false) return false;
  }
  if (state.coordinatorActivity?.pending !== false || state.shellActivity?.pending !== false) return false;
  if (state.nativeRoleRefreshPromise || Object.keys(state.runAfterTouchInteractionTasks || {}).length > 0) return false;
  const datasetStates = state.datasetLoadState && typeof state.datasetLoadState === 'object' ? Object.values(state.datasetLoadState) : [];
  if (datasetStates.some(dataset => dataset && (dataset.initialPromise || dataset.fullPromise))) return false;
  if (Object.keys(state.datasetQueueTimers || {}).length > 0 || state.backgroundRefreshInFlight
    || state.productionLiveSyncRendering || state.productionLiveSyncRenderPending || state.productionLiveSyncRenderTimer
    || state.productionLiveSyncViewLoadPending || Number(state.activeChunkRenderCount) > 0
    || Object.keys(state.chunkRenderActivityByKey || {}).length > 0
    || Object.values(state.chunkRenderTimersByKey || {}).some(timers => Array.isArray(timers) && timers.length > 0)) return false;
  const renderKeys = [...Object.keys(state.uiRenderTimers || {}), ...Object.keys(state.uiRenderFrames || {})];
  // scheduleUiRender can retain a cleared timer's map entry when a zero-delay
  // frame replaces it. Its token is removed after completion/cancellation.
  // Without token evidence, conservatively consider every queued key active.
  const tokensKnown = state.uiRenderTokens && typeof state.uiRenderTokens === 'object' && !Array.isArray(state.uiRenderTokens);
  return !renderKeys.some(key => !tokensKnown || Object.hasOwn(state.uiRenderTokens, key));
}

export function buildPerformanceViewRuntimeReadyExpression(viewId, { requireLoginValidation = false } = {}) {
  const safeViewId = String(viewId || '').trim();
  if (!safeViewId) throw new Error('PERFORMANCE_VIEW_ID_REQUIRED');
  return `(${isPerformanceViewRuntimeReady.toString()})({
    viewId: typeof getCurrentVisibleViewId === 'function' ? getCurrentVisibleViewId() : '',
    datasetLoadState, datasetQueueTimers, backgroundRefreshInFlight, productionLiveSyncRendering,
    productionLiveSyncRenderPending, productionLiveSyncRenderTimer: !!productionLiveSyncRenderTimer,
    productionLiveSyncViewLoadPending: !!productionLiveSyncViewLoad?.pending, uiRenderTimers, uiRenderFrames, uiRenderTokens,
    activeChunkRenderCount, chunkRenderActivityByKey, chunkRenderTimersByKey,
    nativeRoleRefreshPromise, runAfterTouchInteractionTasks,
    coordinatorActivity: globalThis.__phase6CoordinatorObserver?.getPendingActivity(),
    shellActivity: globalThis.__phase6ShellObserver?.getPendingActivity(),
    loginValidationActivity: globalThis.__phase6LoginValidationObserver?.getPendingActivity()
  }, ${JSON.stringify(safeViewId)}, ${requireLoginValidation === true})`;
}

export async function waitForPerformanceViewReadiness({ waitForRuntimeReady, isRuntimeReady, waitForApiIdle,
  viewId, timeoutMs = PERFORMANCE_VIEW_READY_TIMEOUT_MS, quietMs = PERFORMANCE_API_QUIET_MS } = {}) {
  const safeViewId = String(viewId || '').trim();
  if (!safeViewId || typeof waitForRuntimeReady !== 'function' || typeof isRuntimeReady !== 'function'
    || typeof waitForApiIdle !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0
    || !Number.isFinite(quietMs) || quietMs < 1) {
    throw new Error('PERFORMANCE_VIEW_READINESS_OPTIONS_INVALID');
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    await waitForRuntimeReady(remaining);
    const idleTimeout = deadline - Date.now();
    if (idleTimeout <= quietMs) throw new Error('PERFORMANCE_VIEW_READINESS_TIMEOUT');
    await waitForApiIdle({ timeoutMs: idleTimeout });
    const ready = await isRuntimeReady();
    if (Date.now() >= deadline) throw new Error('PERFORMANCE_VIEW_READINESS_TIMEOUT');
    if (ready) return { method: 'live-view-work-and-api-idle', viewId: safeViewId, quietMs };
  }
  throw new Error('PERFORMANCE_VIEW_READINESS_TIMEOUT');
}

async function waitForLiveHomeReadiness(page, apiIdleTracker, requireLoginValidation = false) {
  const runtimeReadyExpression = buildPerformanceViewRuntimeReadyExpression('home', { requireLoginValidation });
  const waitForRuntimeReady = async timeout => {
    const handle = await page.waitForFunction(expression => window.eval(expression), runtimeReadyExpression,
      { polling: 'raf', timeout });
    await handle.dispose();
  };
  const isRuntimeReady = () => page.evaluate(expression => window.eval(expression), runtimeReadyExpression);
  return waitForPerformanceHomeReadiness({ waitForRuntimeReady, isRuntimeReady,
    waitForApiIdle: apiIdleTracker.waitForApiIdle.bind(apiIdleTracker), quietMs: apiIdleTracker.quietMs });
}

export async function waitForPerformanceViewSettlement(page, app, view, { timeoutMs = PERFORMANCE_VIEW_READY_TIMEOUT_MS } = {}) {
  if (app === 'v2') return { method: 'view-ready-already-measured', viewId: view };
  const apiIdleTracker = performanceControlsByPage.get(page);
  if (!apiIdleTracker || typeof apiIdleTracker.waitForApiIdle !== 'function') {
    throw new Error('PERFORMANCE_VIEW_FIXTURE_CONTROL_MISSING');
  }
  const safeViewId = String(view || '').trim();
  const runtimeReadyExpression = buildPerformanceViewRuntimeReadyExpression(safeViewId, { requireLoginValidation: app === 'live' });
  const waitForRuntimeReady = async timeout => {
    const handle = await page.waitForFunction(expression => window.eval(expression), runtimeReadyExpression,
      { polling: 'raf', timeout });
    await handle.dispose();
  };
  const isRuntimeReady = () => page.evaluate(expression => window.eval(expression), runtimeReadyExpression);
  return waitForPerformanceViewReadiness({ waitForRuntimeReady, isRuntimeReady,
    waitForApiIdle: apiIdleTracker.waitForApiIdle.bind(apiIdleTracker), viewId: safeViewId,
    timeoutMs, quietMs: apiIdleTracker.quietMs });
}

export async function installPerformanceFixture(page, origin, app) {
  const apiIdleTracker = attachPerformanceApiIdleTracker(page);
  if (app === 'live') {
    await page.addInitScript({ content: `(${installPerformanceCoordinatorObserver.toString()})(globalThis);` });
    const control = await installHlOrderFixture(page, origin, { username: 'performance_admin', role: 'ADMIN', master: inventoryRows,
      startupMode: 'cold', beforeLogin: async () => {
        await page.locator('#login-button').waitFor({ state: 'visible' });
        await waitForPerformanceColdStartupReady(page);
        await page.evaluate(() => {
          const reporter = window.eval('reportPerformanceHealthEvent');
          if (typeof reporter !== 'function' || reporter !== window.reportPerformanceHealthEvent
              || window.__phase6RandomFixture?.healthReporterContract !== 'first-random-is-10-percent-gate-v1') {
            throw new Error('PERFORMANCE_HEALTH_REPORTER_BINDING_INVALID');
          }
          window.eval('reportPerformanceHealthEvent = __phase6RandomFixture.wrapHealthReporter(reportPerformanceHealthEvent); window.reportPerformanceHealthEvent = reportPerformanceHealthEvent;');
          if (window.eval('reportPerformanceHealthEvent === window.reportPerformanceHealthEvent') !== true) {
            throw new Error('PERFORMANCE_HEALTH_REPORTER_INSTALL_FAILED');
          }
        });
        await page.evaluate((installerSource) => {
          const original = window.eval('scheduleBackgroundLoginValidation');
          const installer = window.eval(`(${installerSource})`);
          const observer = installer(window, original);
          const wrapped = observer.wrap(original);
          Object.defineProperty(window, '__phase6LoginValidationSchedule', { configurable: false, enumerable: false, value: wrapped });
          window.eval('scheduleBackgroundLoginValidation = window.__phase6LoginValidationSchedule');
          if (window.eval('scheduleBackgroundLoginValidation') !== wrapped) {
            throw new Error('PERFORMANCE_LOGIN_VALIDATION_INSTALL_FAILED');
          }
        }, installPerformanceLoginValidationObserver.toString());
        await page.evaluate(`(${installPerformanceShellObserver.toString()})(globalThis)`);
      },
      beforeNavigate: async () => {
        await page.route('**/functions/v1/app-api', async route => {
          const body = route.request().postDataJSON();
          if (body?.action !== 'dataset_read' || body.dataset !== 'request_queue') return route.fallback();
          const { limit, offset } = body.params;
          const rows = queueRows.slice(offset, offset + limit);
          return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': origin },
            body: JSON.stringify({ ok: true, data: { rows, total: queueRows.length, offset, limit, hasMore: offset + rows.length < queueRows.length } }) });
        });
      } });
    const fixtureControl = Object.assign(control, apiIdleTracker);
    performanceControlsByPage.set(page, fixtureControl);
    await waitForLiveHomeReadiness(page, fixtureControl, true);
    return fixtureControl;
  }
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith('/runtime-config.json')) return route.fulfill({ json: {
      environment: 'sandbox', testData: true, projectRef: 'performance', productionProjectRef: 'production-blocked',
      supabaseUrl: 'https://performance.supabase.co', publishableKey: 'sb_publishable_synthetic_fixture' } });
    if (url.hostname === 'performance.supabase.co' && url.pathname === '/rest/v1/ph_master_inventory') {
      const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 100);
      const selected = (url.searchParams.get('select') || '').split(',');
      if (!selected.length || selected.includes('*') || limit > 250) throw new Error('PERFORMANCE_V2_PROJECTION_INVALID');
      const rows = inventoryRows.slice(offset, offset + limit).map(row => Object.fromEntries(selected.map(key => [key, row[key]])));
      return route.fulfill({ json: rows, headers: { 'access-control-allow-origin': origin, 'access-control-expose-headers': 'content-range',
        'content-range': `${offset}-${offset + rows.length - 1}/${inventoryRows.length}` } });
    }
    if (url.origin === origin) return route.continue();
    return route.abort('blockedbyclient');
  });
  await page.goto('/v2/#home');
  await page.locator('.home-dashboard').waitFor();
  const fixtureControl = apiIdleTracker;
  performanceControlsByPage.set(page, fixtureControl);
  return fixtureControl;
}

export async function openPerformanceView(page, app, view) {
  if (app === 'v2') {
    await page.evaluate(next => { location.hash = next; }, view);
    await waitForPerformanceVisibleElement(page, view === 'drive' ? '.drive-item-card' : '.request-card, .request-list > article, .request-list > button');
    return;
  }
  await page.locator(view === 'drive' ? '#footer-drive-btn' : '#footer-request-btn').click();
  await page.locator(`#view-${view}`).waitFor({ state: 'visible' });
  await page.waitForFunction(viewId => window.eval(`productionLiveSyncVerifiedView === productionVerifiedViewKey()
    && getCurrentVisibleViewId() === ${JSON.stringify(viewId)}`), view);
  const content = page.locator(view === 'drive' ? '#drive-content' : '#request-content');
  await content.waitFor({ state: 'visible' });
  await page.waitForFunction(selector => {
    const node = document.querySelector(selector);
    return node && !node.querySelector('.skeleton') && node.textContent.includes('Performance plant');
  }, view === 'drive' ? '#drive-content' : '#request-content');
}

export async function waitForPerformanceVisibleElement(page, selector) {
  const handle = await page.waitForFunction(value => {
    const element = document.querySelector(value);
    if (!element || element.getClientRects().length === 0) return false;
    const visibility = getComputedStyle(element).visibility;
    if (visibility === 'hidden' || visibility === 'collapse') return false;
    const { width, height } = element.getBoundingClientRect();
    return width > 0 && height > 0 ? { width, height } : false;
  }, selector, { polling: 'raf' });
  try { return await handle.jsonValue(); }
  finally { await handle.dispose(); }
}

export async function returnPerformanceHome(page, app) {
  if (app === 'v2') {
    await page.evaluate(() => { location.hash = 'home'; });
    await waitForPerformanceVisibleElement(page, '.home-dashboard');
  } else {
    await page.locator('#global-header-inline-back').click();
    await page.locator('#view-home').waitFor({ state: 'visible' });
    const fixtureControl = performanceControlsByPage.get(page);
    if (!fixtureControl) throw new Error('PERFORMANCE_HOME_FIXTURE_CONTROL_MISSING');
    await waitForLiveHomeReadiness(page, fixtureControl);
  }
}
