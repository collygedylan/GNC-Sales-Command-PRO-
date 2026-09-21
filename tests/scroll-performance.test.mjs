import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const html = read('index.html');
const pilot = read('assets/ops-precision-pilot.js');
const playwrightConfig = read('playwright.config.ts');

test('the shared scroll path has no universal restyle or synchronous sticky geometry scan', () => {
  const guardrailStyles = html.slice(
    html.indexOf('<style id="app-performance-guardrails">'),
    html.indexOf('</style>', html.indexOf('<style id="app-performance-guardrails">'))
  );
  assert.doesNotMatch(
    guardrailStyles,
    /body\.(?:performance-scroll-active|mobile-text-entry-active|mobile-filter-entry-active|gnc-perf-adaptive-hard)\s+\*/
  );

  const stickyInitializer = html.slice(
    html.indexOf('function initializeStickyRailOffsetSync'),
    html.indexOf('let horizontalViewportClampInitialized')
  );
  const mainScrollHandler = stickyInitializer.slice(
    stickyInitializer.indexOf("mainScrollArea.addEventListener('scroll'"),
    stickyInitializer.indexOf("if (window.visualViewport")
  );
  assert.match(mainScrollHandler, /if \(!keyboardSensitive\) return;/);
  assert.match(mainScrollHandler, /scheduleDeferredChromeSyncTask\('sticky-rail-main-scroll-settled'/);
  assert.doesNotMatch(mainScrollHandler, /scheduleStickyRailOffsetSync\('main-scroll', false\)/);
  assert.doesNotMatch(mainScrollHandler, /syncIosFixedTopChromeMetrics\('main-scroll'\);/);
});

test('the hosted browser suite measures scrolling and realtime decorations stay subtree-scoped', () => {
  assert.match(playwrightConfig, /scroll-performance\\\.e2e/);
  assert.match(pilot, /new MutationObserver\(\(records\) =>/);
  assert.match(pilot, /record\.addedNodes/);
  assert.match(pilot, /schedulePremiumDecorations\(node\)/);
  assert.match(pilot, /requestIdleCallback\(decorateRecordCollections, \{ timeout: 220 \}\)/);
  assert.doesNotMatch(pilot, /new MutationObserver\(\(\) => \{\s*schedulePremiumDecorations\(\);/);
});


test('Common Name preparation rejects changed ownership, permissions, navigation, and source proof', () => {
  const start = html.indexOf('        function cancelDriveCommonNamePreparation()');
  const end = html.indexOf('        function driveCommonNameNeedsPreparation()', start);
  const source = html.slice(start, end);
  function fixture() {
    const context = vm.createContext({
      document: { hidden: false, getElementById: () => ({ value: '' }) },
      currentUser: 'alice', currentRole: 'ADMIN', activeDriveTab: 'name',
      driveVisibleItemsStateCacheKey: 'filters', productionLiveSyncVerifiedView: 'proof', productionLiveSyncReadGeneration: 3,
      getCurrentVisibleViewId: () => 'drive', getDriveDrillSelectionStateKey: () => 'names',
      isChunkRenderCurrentForContainer: () => true, canUseProductionLiveSync: () => true,
      productionVerifiedViewKey: () => 'proof', cancelAnimationFrame: () => {},
      driveCommonNamePreparation: { container: { dataset: { driveCommonnameState: 'preparing' } }, frame: 1, fragment: {},
        native: true, proof: 'proof', generation: 3, selection: 'names', search: '', filterKey: 'filters', user: 'alice', role: 'ADMIN' }
    });
    vm.runInContext(source, context);
    return context;
  }
  const changes = [
    c => { c.currentUser = 'bob'; }, c => { c.currentUser = ''; }, c => { c.currentRole = 'REP'; },
    c => { c.canUseProductionLiveSync = () => false; }, c => { c.getCurrentVisibleViewId = () => 'home'; },
    c => { c.productionVerifiedViewKey = () => 'another-navigation'; }, c => { c.productionLiveSyncReadGeneration++; },
    c => { c.driveVisibleItemsStateCacheKey = 'other filters'; }, c => { c.document.hidden = true; },
    c => { c.document.getElementById = () => ({ value: 'new search' }); }
  ];
  for (const change of changes) {
    const context = fixture();
    assert.equal(vm.runInContext('isDriveCommonNamePreparationCurrent(driveCommonNamePreparation)', context), true);
    const pending = context.driveCommonNamePreparation;
    change(context);
    assert.equal(vm.runInContext('isDriveCommonNamePreparationCurrent(driveCommonNamePreparation)', context), false);
    vm.runInContext('cancelDriveCommonNamePreparation()', context);
    assert.equal(context.driveCommonNamePreparation, null);
    assert.equal(pending.fragment, null);
    assert.equal(pending.container.dataset.driveCommonnameState, 'cancelled');
  }
});

test('passive native chat uses shared revision refresh without forcing unrelated view reloads', async () => {
  const source = html.slice(html.indexOf('        function clearChatBackgroundPoll()'),
    html.indexOf('        function maybeShowForegroundChatNotification('));
  const calls = [];
  const context = vm.createContext({
    currentUser: 'alice', document: { hidden: false }, navigator: { onLine: true },
    chatBackgroundPollTimer: 7, chatBackgroundPollAttempt: 0,
    CHAT_BACKGROUND_POLL_MS: 5000, REALTIME_FALLBACK_BASE_MS: 1000, REALTIME_FALLBACK_MAX_MS: 30000,
    canUseProductionLiveSync: () => true, hasHealthyBackgroundChatRealtime: () => false,
    clearTimeout: id => calls.push(['clear', id]), setTimeout: () => { calls.push(['timer']); return 8; },
    signalProductionLiveSync: (reason, delay) => calls.push(['signal', reason, delay]),
    fetchChatData: async force => { calls.push(['fetch', force]); return true; },
    syncDepartmentCalendarBadgeData: async force => { calls.push(['calendar', force]); },
    updateFooterChatBadge: () => calls.push(['badge']), isViewVisible: () => true,
    renderChat: () => calls.push(['render'])
  });
  vm.runInContext(source, context);
  context.scheduleChatBackgroundPoll();
  context.ensureChatBackgroundSync('resume', 0);
  assert.equal(await context.runChatBackgroundPoll(), true);
  assert.deepEqual(calls, [['clear', 7], ['signal', 'chat-background:resume', 0], ['signal', 'chat-background', 0]]);
  assert.equal(context.chatBackgroundPollTimer, null);
  calls.length = 0;
  context.document.hidden = true;
  assert.equal(await context.runChatBackgroundPoll(), false);
  assert.deepEqual(calls, []);
  context.document.hidden = false;
  context.canUseProductionLiveSync = () => false;
  assert.equal(await context.runChatBackgroundPoll(), true);
  assert.deepEqual(calls, [['fetch', true], ['calendar', false], ['badge'], ['render'], ['timer']]);
});
