// @test-group: drive
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = name => html.match(new RegExp('        function ' + name + '\\([^]*?^        }', 'm'))?.[0] || assert.fail(name);
function fixture(mode) {
  const driveSearchInput = { value: 'Maple', classList: { add() {} }, removeAttribute() {} };
  const context = vm.createContext({ Set, activeDriveMode: mode, activeDriveTab: 'name', driveViewLevel: 3,
    selectedDriveName: 'Maple', selectedDriveSize: '#3', selectedDriveSeason: 'F1', selectedDriveProgram: null,
    selectedDriveBlock: null, selectedDriveLoc: null, selectedDriveCommonNames: new Set(['Maple']),
    driveCommonNameSearchTerm: 'Maple', driveCommonNameFilterOpen: true,
    driveColumnFilters: { COMMONNAME: ['Maple'], LOCATIONCODE: ['A'] },
    getManagerAssignedColumnState: () => ({}), getCurrentVisibleViewId: () => 'drive',
    isDrawerOpen: () => false, getVisibleSecondaryBack: () => null, closeOpenInteractiveSurfaceForBack: () => false,
    window: {}, LocationCode: { back: () => false },
    cancelDriveSearchRenderWork() {}, getNavigationScrollPosition: () => 42, updateGlobalBackButton() {},
    runDirectTrackedNavigation: (_view, _key, apply) => { apply(); return false; },
    document: { getElementById: id => id === 'drive-search' ? driveSearchInput : ({ value: 'Maple', classList: { add() {} }, removeAttribute() {} }) },
    setDriveSearchManualSelectionLock() {}, restoreDriveStateAfterUniversalSearch() {}, syncDriveTabPills() {},
    scheduleDriveSearchRender() {},
  });
  for (const name of ['goBackUniversal', 'backToDriveSeasons', 'backToDriveSizes', 'backToDriveNames', 'resetDriveDrillSelectionState', 'clearDriveSearch', 'getDriveSearchTerm', 'hasActiveDriveSearchTerm']) vm.runInContext(source(name), context);
  return context;
}

function backHarness(view = 'drive') {
  const context = fixture('ok');
  context.document.getElementById('drive-search').value = '';
  const calls = [];
  Object.assign(context, {
    getCurrentVisibleViewId: () => view,
    viewHistoryStack: [],
    shouldResetIosPhoneMainScrollForView: () => false,
    fastBackToView: (target, options) => calls.push({ target, ...options }),
    fastBackHome: () => { calls.push({ target: 'home' }); return false; },
    syncGlobalModalBack: () => calls.push('modal-sync'),
    closeManagerAssignedColumnFilter: () => { calls.push('editor'); return false; },
    setMenuOpenState: () => calls.push('drawer'),
    activeAVTab: 'open', avOpenLevel: 3,
    selectedAvOpenName: 'Maple', selectedAvOpenSize: '#3',
    selectedAvOpenSeason: 'F1', selectedAvOpenLot: '27.F1',
    avResolvedBaseStateKey: 'cached', avResolvedBaseStateCache: { rows: ['cached'] },
    avResLevel: 2, selectedAvResRep: 'REP', selectedAvResDriveUid: 'UID',
    selectedAvResItemCode: 'ITEM', selectedAvResName: 'Maple', selectedAvResSize: '#3',
    clearSelectedAvReserveCustomerCardState: () => calls.push('clear-reserve-customer'),
    clearSelectedAvResRep: () => { context.selectedAvResRep = null; calls.push('clear-rep'); },
    scheduleAVRender: () => calls.push('render-av'),
  });
  vm.runInContext(source('restorePreviousViewFromHistory'), context);
  return { context, calls };
}

test('universal Back closes the modal before editors, drawers, wizards or inventory drill', () => {
  const { context: f, calls } = backHarness();
  f.getManagerAssignedColumnState = () => ({ editor: {} });
  f.isDrawerOpen = () => true;
  f.closeOpenInteractiveSurfaceForBack = () => { calls.push('wizard'); return true; };
  f.getVisibleSecondaryBack = modalOnly => modalOnly ? { click: () => calls.push('modal') } : { click: () => calls.push('delegated') };
  assert.equal(f.goBackUniversal(), false);
  assert.deepEqual(calls, ['modal', 'modal-sync']);
  assert.equal(f.driveViewLevel, 3);
});

test('editor, drawer and wizard Back consume one action before inventory drill or delegation', () => {
  for (const surface of ['editor', 'drawer', 'wizard']) {
    const { context: f, calls } = backHarness();
    f.getVisibleSecondaryBack = modalOnly => modalOnly ? null : { click: () => calls.push('delegated') };
    f.getManagerAssignedColumnState = () => ({ editor: surface === 'editor' ? {} : null });
    f.isDrawerOpen = () => surface === 'drawer';
    f.closeOpenInteractiveSurfaceForBack = () => {
      if (surface !== 'wizard') return false;
      calls.push('wizard'); return true;
    };
    assert.equal(f.goBackUniversal(), false);
    assert.deepEqual(calls, [surface]);
    assert.equal(f.driveViewLevel, 3);
  }
});

test('Drive drill takes exactly one step before delegated Back and preserves view history', () => {
  const { context: f, calls } = backHarness();
  f.viewHistoryStack.push({ viewId: 'tasks', scrollTop: 81 });
  f.getVisibleSecondaryBack = modalOnly => modalOnly ? null : { click: () => calls.push('delegated') };
  for (const expectedLevel of [2, 1, 0]) {
    assert.equal(f.goBackUniversal(), false);
    assert.equal(f.driveViewLevel, expectedLevel);
    assert.deepEqual(calls, []);
    assert.equal(f.viewHistoryStack.length, 1);
  }
  f.driveCommonNameSearchTerm = '';
  f.goBackUniversal();
  assert.deepEqual(calls, ['delegated']);
  assert.equal(f.viewHistoryStack.length, 1);
});

test('AV open stock backs one drill level and invalidates its cache before delegation', () => {
  const { context: f, calls } = backHarness('av');
  f.viewHistoryStack.push({ viewId: 'tasks', scrollTop: 81 });
  f.getVisibleSecondaryBack = modalOnly => modalOnly ? null : { click: () => calls.push('delegated') };
  for (const expectedLevel of [2, 1, 0]) {
    f.avResolvedBaseStateKey = 'cached'; f.avResolvedBaseStateCache = { rows: ['cached'] };
    assert.equal(f.goBackUniversal(), false);
    assert.equal(f.avOpenLevel, expectedLevel);
    assert.equal(f.selectedAvOpenSeason, null);
    assert.equal(f.selectedAvOpenLot, null);
    assert.equal(f.selectedAvOpenSize, expectedLevel >= 2 ? '#3' : null);
    assert.equal(f.selectedAvOpenName, expectedLevel >= 1 ? 'Maple' : null);
    assert.equal(f.avResolvedBaseStateKey, '');
    assert.equal(f.avResolvedBaseStateCache, null);
    assert.equal(f.viewHistoryStack.length, 1);
    assert.deepEqual(calls.splice(0), ['render-av']);
  }
  f.goBackUniversal();
  assert.deepEqual(calls, ['delegated']);
});

test('AV reserves preserves its single-step drill and rep selection before root delegation', () => {
  const { context: f, calls } = backHarness('av');
  f.activeAVTab = 'reserves';
  f.getVisibleSecondaryBack = modalOnly => modalOnly ? null : { click: () => calls.push('delegated') };
  f.goBackUniversal();
  assert.equal(f.avResLevel, 1); assert.equal(f.selectedAvResDriveUid, null);
  assert.equal(f.selectedAvResItemCode, 'ITEM'); assert.equal(f.selectedAvResRep, 'REP');
  assert.deepEqual(calls.splice(0), ['clear-reserve-customer', 'render-av']);
  f.goBackUniversal();
  assert.equal(f.avResLevel, 0); assert.equal(f.selectedAvResItemCode, null);
  assert.equal(f.selectedAvResName, null); assert.equal(f.selectedAvResSize, null);
  assert.deepEqual(calls.splice(0), ['clear-reserve-customer', 'render-av']);
  f.goBackUniversal();
  assert.equal(f.selectedAvResRep, null);
  assert.deepEqual(calls.splice(0), ['clear-rep']);
  f.goBackUniversal();
  assert.deepEqual(calls, ['delegated']);
});

test('delegated subqueue Back precedes history, then history precedes Home fallback', () => {
  const { context: f, calls } = backHarness('request');
  f.activeReqTab = 'suspend-tag';
  f.viewHistoryStack.push({ viewId: 'tasks', scrollTop: 81 }, { viewId: 'request', scrollTop: 9 });
  let delegate = true;
  f.getVisibleSecondaryBack = modalOnly => !modalOnly && delegate ? { click: () => calls.push('subqueue') } : null;
  f.goBackUniversal();
  assert.deepEqual(calls.splice(0), ['subqueue']);
  assert.equal(f.viewHistoryStack.length, 2);
  delegate = false;
  f.goBackUniversal();
  assert.deepEqual(calls.splice(0), [{ target: 'tasks', fromHistory: true, targetScrollTop: 81 }]);
  assert.equal(f.viewHistoryStack.length, 0);
  f.goBackUniversal();
  assert.deepEqual(calls, [{ target: 'home' }]);
});

test('non-Home root with no history always has a Home fallback', () => {
  for (const view of ['drive', 'av', 'request', 'historical-requests']) {
    const { context: f, calls } = backHarness(view);
    f.driveViewLevel = 0; f.driveCommonNameSearchTerm = ''; f.selectedDriveName = null;
    f.avOpenLevel = 0; f.activeReqTab = 'suspend-tag';
    assert.equal(f.goBackUniversal(), false);
    assert.deepEqual(calls, [{ target: 'home' }], view);
  }
});

test('bottom-nav Drive keeps global Back visible through drill, modal cleanup and return Home', () => {
  const chromeCssStart = html.indexOf('        #global-header-search-row{');
  const chromeCssEnd = html.indexOf('        .drive-card-filter-grid{', chromeCssStart);
  assert.ok(chromeCssStart >= 0 && chromeCssEnd > chromeCssStart);
  const backCss = html.match(/\.amazon-inline-back\{[^}]+\}/)?.[0];
  assert.ok(backCss);
  const openPopoverCss = html.match(/#global-header-inline-back:popover-open\{[^}]+\}/)?.[0];
  assert.ok(openPopoverCss);
  const footerButton = html.match(/<button\b[^>]*data-footer-view="drive"[^>]*>[^]*?<\/button>/)?.[0];
  const backButton = html.match(/<button\b[^>]*id="global-header-inline-back"[^>]*>[^]*?<\/button>/)?.[0];
  assert.ok(footerButton && backButton);
  // JSDOM's UA stylesheet hides closed popovers, but its selector engine does
  // not observe our showPopover stub. Map only the actual open-popover rule to
  // a fixture state attribute so computed display models that native state.
  const modeledOpenPopoverCss = openPopoverCss.replace(':popover-open', '[data-fixture-popover-open]');
  const dom = new JSDOM(`<!doctype html><style>.hidden{display:none}${html.slice(chromeCssStart, chromeCssEnd)}${backCss}${modeledOpenPopoverCss}</style>
    <body class="current-view-home" data-current-view="home">
      <div id="global-header-search-row" class="hidden" hidden>${backButton}</div>
      <section id="view-home"></section><section id="view-drive" class="hidden"><input id="drive-search"></section>
      <nav id="bottom-nav">${footerButton}</nav>
      <div id="test-modal" class="hidden" role="dialog"><button data-secondary-back>Close</button></div>
    </body>`, { pretendToBeVisual: true });
  try {
    const { window } = dom;
    const { document } = window;
    const f = fixture('ok');
    const noop = () => {};
    Object.assign(f, {
      window, document, getComputedStyle: window.getComputedStyle.bind(window),
      currentPrimaryViewId: 'home', TRACKED_VIEW_IDS: ['drive'], viewHistoryStack: [],
      driveViewLevel: 0, selectedDriveName: null, selectedDriveSize: null, selectedDriveSeason: null,
      driveCommonNameSearchTerm: '', selectedDriveCommonNames: new Set(),
      searchRenderLastTerm: {}, driveQuickFiltersModalOpen: false, inventoryFieldCountingMode: false,
      selectedProductivityUser: '', requestSalesRepsManagerMode: false,
      lastGuardedViewSwitchKey: '', lastGuardedViewSwitchAt: 0, VIEW_SWITCH_DUPLICATE_GUARD_MS: 300,
      cartPanelOpen: false, bloomShareMenuOpen: false, bloomCropUpdateModalOpen: false,
      getPrimaryViewIds: () => ['home', 'drive'], getViewElementById: id => document.getElementById(`view-${id}`),
      isViewVisible: id => !!document.getElementById(`view-${id}`) && !document.getElementById(`view-${id}`).classList.contains('hidden'),
      canAccessView: () => true, canUseProductionLiveSync: () => false,
      shouldShowHomeProductivityBackButton: () => false, shouldResetIosPhoneMainScrollForView: () => false,
      getMainAreaScrollTop: () => 0, prepareManagerAssignedNavigation: (_from, _to, top) => top,
      ensureViewRenderState: () => ({ initialized: true, dirty: false }),
      shouldRunImmediateViewActivation: () => false, isTouchConstrainedDevice: () => false,
      beginInternalPerfMeasure: () => 0, getAdaptivePerfElapsedMs: () => 0,
      syncGlobalHeaderChrome: () => f.updateGlobalBackButton(),
      fastBackToView: id => { f.showOnlyPrimaryView(id); return false; },
      fastBackHome: () => { f.showOnlyPrimaryView('home'); return false; },
      bindFastPressTarget: (element, _kind, name, args) => { element.onclick = () => f[name](...args); },
    });
    for (const name of ['syncHomeDashboardBodyMode', 'syncRequestDetailScrollMode', 'repairAppShellScrollState',
      'cancelManagerSeasonPriorityRead', 'persistAppFilterStateNow', 'closeTaskDropdowns', 'beginDirectNavigationActivity',
      'destroyHistoricalRequestsIsland', 'cancelScheduledViewRenderWork', 'cancelChunkRenderWorkForView',
      'cancelScheduledUiRenderByPrefix', 'ensureNativeBackGuard', 'updateFooterNavState', 'scheduleStickyRailOffsetSync',
      'queueScrollMainAreaToTop', 'schedulePrimaryViewChromeRefresh', 'scheduleWarmViewFollowup',
      'recordGncPerfStat', 'reportPerformanceHealthEvent', 'recordInternalPerfDuration', 'scheduleHomeDashboardFitSettle']) f[name] = noop;
    window.AgMetricLifecycle = { enterView: noop };
    for (const name of ['getCurrentVisibleViewId', 'syncCurrentViewBodyClass', 'showOnlyPrimaryView',
      'getGlobalBackState', 'applyGlobalBackState', 'updateGlobalBackButton', 'getVisibleSecondaryBack',
      'syncGlobalModalBack', 'getDriveSearchTerm', 'hasActiveDriveSearchTerm', 'pruneViewHistoryStack',
      'pushViewHistoryEntry', 'restorePreviousViewFromHistory', 'switchView']) vm.runInContext(source(name), f);
    const footerBinding = html.match(/document\.querySelectorAll\('#bottom-nav \[data-footer-view\]'\)\.forEach\(\(element\) => \{[^]*?\n            \}\);/)?.[0];
    assert.ok(footerBinding, 'actual bottom-nav switchView binding');
    vm.runInContext(footerBinding, f);
    const button = document.getElementById('global-header-inline-back');
    const row = document.getElementById('global-header-search-row');
    const modal = document.getElementById('test-modal');
    let popoverOpen = false;
    const nativeMatches = button.matches.bind(button);
    button.matches = selector => selector === ':popover-open' ? popoverOpen : nativeMatches(selector);
    button.showPopover = () => { popoverOpen = true; button.setAttribute('data-fixture-popover-open', ''); };
    button.hidePopover = () => { popoverOpen = false; button.removeAttribute('data-fixture-popover-open'); };
    button.onclick = () => f.goBackUniversal();
    modal.querySelector('button').onclick = () => modal.classList.add('hidden');
    const assertBackVisible = stage => {
      assert.equal(f.getCurrentVisibleViewId(), 'drive', stage);
      assert.equal(f.currentPrimaryViewId, 'drive', stage);
      assert.equal(document.body.dataset.currentView, 'drive', stage);
      for (const element of [row, button]) {
        assert.notEqual(window.getComputedStyle(element).display, 'none', `${stage}: ${element.id} computed display`);
        assert.equal(element.hidden, false, `${stage}: ${element.id} hidden property`);
        assert.equal(element.classList.contains('hidden'), false, `${stage}: ${element.id} hidden class`);
      }
      assert.equal(button.disabled, false, stage);
      assert.ok(!button.hasAttribute('popover') || button.matches(':popover-open'), `${stage}: no closed popover`);
    };
    // Start with a stale closed promotion, as can remain after modal teardown.
    button.setAttribute('popover', 'manual');
    document.querySelector('#bottom-nav [data-footer-view="drive"]').click();
    assertBackVisible('Drive root');
    assert.equal(button.hasAttribute('popover'), false);
    // Forward transitions are controlled fixture state; Back executes the real drill helpers.
    for (const [level, stage] of [[1, 'Common Name'], [2, 'Container Size'], [3, 'Season']]) {
      f.driveViewLevel = level; f.selectedDriveName = 'ACCOLADE® ELM';
      f.selectedDriveSize = level >= 2 ? '#3' : null;
      f.selectedDriveSeason = level >= 3 ? 'U2' : null;
      f.updateGlobalBackButton();
      assertBackVisible(stage);
    }
    modal.classList.remove('hidden');
    f.syncGlobalModalBack();
    assertBackVisible('modal open');
    assert.equal(button.matches(':popover-open'), true);
    button.click();
    assert.equal(modal.classList.contains('hidden'), true);
    assert.equal(f.driveViewLevel, 3, 'closing the modal must not consume a drill step');
    assertBackVisible('modal closed');
    assert.equal(button.hasAttribute('popover'), false, 'normal Back must leave popover mode');
    assert.equal(button.hasAttribute('data-fixture-popover-open'), false, 'modal display model must not affect normal Back');
    for (const level of [2, 1, 0]) {
      button.click();
      assert.equal(f.driveViewLevel, level);
      assert.equal(f.selectedDriveSeason, null);
      assert.equal(f.selectedDriveSize, level >= 2 ? '#3' : null);
      assert.equal(f.selectedDriveName, level >= 1 ? 'ACCOLADE® ELM' : null);
      assertBackVisible(`Back to level ${level}`);
    }
    button.click();
    assert.equal(f.getCurrentVisibleViewId(), 'home');
    assert.equal(f.currentPrimaryViewId, 'home');
    assert.equal(document.body.dataset.currentView, 'home');
    assert.equal(button.hidden, true);
    assert.equal(row.hidden, true);
  } finally {
    dom.window.close();
  }
});
test('shared inventory navigation backs through Season, Container Size and Common Name in order', () => {
  for (const mode of ['ok']) {
    const f = fixture(mode);
    f.goBackUniversal(); assert.equal(f.driveViewLevel, 2); assert.equal(f.selectedDriveSeason, null); assert.equal(f.selectedDriveSize, '#3');
    f.goBackUniversal(); assert.equal(f.driveViewLevel, 1); assert.equal(f.selectedDriveSize, null); assert.equal(f.selectedDriveName, 'Maple');
    f.goBackUniversal(); assert.equal(f.driveViewLevel, 0); assert.equal(f.selectedDriveName, null);
  }
});
test('clear search exits common-name filters immediately and preserves other column filters', () => {
  for (const mode of ['ok']) {
    const f = fixture(mode); f.activeDriveTab = 'loc'; f.clearDriveSearch();
    assert.equal(f.driveViewLevel, 0); assert.equal(f.activeDriveTab, 'name'); assert.equal(f.selectedDriveName, null);
    assert.equal(f.selectedDriveCommonNames.size, 0); assert.equal(f.driveCommonNameSearchTerm, '');
    assert.equal(f.driveCommonNameFilterOpen, false); assert.equal(f.driveColumnFilters.COMMONNAME, undefined);
    assert.deepEqual(f.driveColumnFilters.LOCATIONCODE, ['A']);
  }
});

test('AV search clear resets stored item drill and common-name column filters', () => {
  const f = vm.createContext({ avOpenLevel: 3, selectedAvOpenName: 'Maple', selectedAvOpenSize: '#3',
    selectedAvOpenSeason: 'F1', selectedAvOpenLot: '27.F1', avColumnFilters: { COMMONNAME: ['Maple'], CONTSIZE: ['#3'] },
    avResolvedBaseStateKey: 'old', avResolvedBaseStateCache: {},
    document: { getElementById: () => ({ value: 'Maple', classList: { add() {} } }) },
    resetAvSearchDrilldownState: () => { f.avOpenLevel = 0; },
    scheduleTrackedSearchViewRender() {}, isTouchConstrainedDevice: () => false });
  vm.runInContext(source('clearAVSearch'), f); f.clearAVSearch();
  assert.equal(f.avOpenLevel, 0); assert.equal(f.selectedAvOpenName, null); assert.equal(f.selectedAvOpenSeason, null);
  assert.equal(f.avColumnFilters.COMMONNAME, undefined); assert.deepEqual(f.avColumnFilters.CONTSIZE, ['#3']);
  assert.equal(f.avResolvedBaseStateCache, null);
});
