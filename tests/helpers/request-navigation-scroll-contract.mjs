import { readComposedAppSource } from '../../scripts/composed-app-source.mjs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const html = readComposedAppSource();
export function navigationScrollContract() {
  const start = html.indexOf('function switchView(viewId, options = {})');
  const switchSource = html.slice(start, html.indexOf('lastViewSwitchAt = Date.now();', start));
  const capture = switchSource.indexOf('const rememberCurrentView =');
  const teardown = switchSource.indexOf("if (currentViewId === 'managers' && nextViewId !== 'managers') { cancelManagerModuleReads(); destroyManagerAssignedItemsView(); }");
  assert.ok(capture > switchSource.indexOf('lastGuardedViewSwitchAt = switchNow;'));
  assert.ok(capture > switchSource.indexOf('repairAppShellScrollState('));
  assert.ok(capture > switchSource.indexOf("clearIosPhoneRequestFlowState('request-switch-start'"));
  assert.ok(capture < teardown && capture < switchSource.indexOf('showOnlyPrimaryView(nextViewId)'));
  assert.match(switchSource.slice(teardown), /if \(rememberCurrentView\)\s*\{\s*pushViewHistoryEntry\(currentViewId, historyScroll, nextViewId\)/);
  assert.doesNotMatch(switchSource.slice(teardown), /getMainAreaScrollTop\(\)/);

  const captureSource = switchSource.slice(capture, teardown);
  for (const [currentViewId, nextViewId, fromHistory, activeHomeTab, expected, mainReads, managerReads] of [
    ['drive', 'request', false, '', 123, 1, 0],
    ['managers', 'reports', false, 'assigned-items', 456, 0, 1],
    ['managers', 'reports', false, 'dashboard', 123, 1, 0],
    ['request', 'request', false, '', null, 0, 0],
    ['detail', 'request', false, '', null, 0, 0],
    ['drive', 'request', true, '', null, 0, 0]
  ]) {
    let mainCount = 0, managerCount = 0;
    const context = { currentViewId, nextViewId, fromHistory, activeHomeTab,
      MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW: 'assigned-items',
      getMainAreaScrollTop: () => { mainCount++; return 123; },
      getManagerAssignedColumnState: () => { managerCount++; return { scroll: 456 }; }
    };
    vm.createContext(context);
    assert.equal(vm.runInContext(`${captureSource}\nhistoryScroll`, context), expected);
    assert.equal(mainCount, mainReads);
    assert.equal(managerCount, managerReads);
  }
}
