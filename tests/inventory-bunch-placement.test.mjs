import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: bunch-notes,navigation
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readComposedAppSource();
const workspace = readFileSync(new URL('../assets/mobile-workspace.js', import.meta.url), 'utf8');
function section(start, end) {
  const from = html.indexOf(start), to = html.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from);
  return html.slice(from, to);
}

test('Inv Bunch Notes authors in Inventory and assigned work has a Que category', () => {
  const context = vm.createContext({});
  vm.runInContext(workspace, context);
  const module = context.GncMobileWorkspace.hubs['sales-inventory'].find(entry => entry.targetView === 'bunch-note');
  assert.equal(module.label, 'Inv Bunch Notes');
  assert.equal(module.action, "return switchView('bunch-note')");
  const headerContext = vm.createContext({});
  vm.runInContext(section('const AMAZON_HEADER_META =', 'function createAmazonInlineBackButton()') + '\nthis.headerMeta = AMAZON_HEADER_META;', headerContext);
  assert.equal(headerContext.headerMeta['bunch-note'].title, 'Inv Bunch Notes');
  assert.match(section('const REQUEST_TAB_LABELS', 'function getRequestTabQueueCounts'), /bunch-notes/);
  assert.match(section('function getAuthorizedRequestCategories', 'const requestCategoryToolbarMarkupByNode'), /bunch-notes/);
  assert.match(section('function normalizeRequestTabValue', 'function syncRequestTabButtons'), /bunch-notes/);
});

test('moving assigned work into Inventory preserves active-worker access without author rights or extra module access', () => {
  const context = vm.createContext({
    currentUser: 'worker', nativeAuthSessionActive: true,
    canonicalFeaturePermission: () => null,
    nativeAuthProfile: { id: 'worker-id', username: 'worker', must_change_password: false },
    window: { SalesWorkspace: { isView: () => false } },
    getRoleAccessState: () => ({ allowedViews: new Set() }),
    isEvalSensitiveDataRestricted: () => false,
    canUseHistoricalRequests: () => false, canUseHlOrder: () => false,
    isManagerViewDeniedUser: () => false, isStrictDylanCollygeUser: () => false,
    canViewCropRollHome: () => false, canUseMovesModule: () => false,
    getRequestCapabilities: () => ({ canViewQueue: false }), canSeeEvalWorkRequestTab: () => false,
    BunchNote: { author: () => false },
  });
  vm.runInContext(section('function canUseInvBunchNotes(', 'const REQUEST_TAB_LABELS'), context);
  vm.runInContext(section('function navigationPreferencesAllowed(', 'function isSalesShellAccess('), context);
  for (const view of ['sales-inventory', 'bunch-note', 'request']) assert.equal(context.canAccessView(view), true, view);
  for (const view of ['reports', 'tasks', 'moves', 'hl-order']) assert.equal(context.canAccessView(view), false, view);
  assert.equal(context.canAccessView('bunch-note', 'other-user'), false);
  context.window.GncNavigationPreferences = { allowed: () => false };
  assert.equal(context.canAccessView('bunch-note'), false);
  delete context.window.GncNavigationPreferences;
  for (const patch of [{ disabled_at: '2026-01-01' }, { must_change_password: true }, { locked_until: '2999-01-01' }]) {
    context.nativeAuthProfile = { id: 'worker-id', username: 'worker', must_change_password: false, ...patch };
    assert.equal(context.canAccessView('bunch-note'), false);
    assert.equal(context.canAccessView('sales-inventory'), false);
  }
});

test('navigation away from Inv Bunch Notes disposes picker surfaces, including entering Que', () => {
  assert.match(section('function switchView(viewId,', 'const viewSwitchStartedAt'), /if \(viewId !== 'bunch-note'\) window\.BunchNote\?\.disposeView\(\)/);
  assert.doesNotMatch(section('function goBackUniversal()', 'if (window.SalesWorkspace?.back())'), /activeReqTab/);
});

test('workers entering only the Inventory navigation shell do not fetch broad inventory datasets', () => {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(new URL('../assets/live-sync-registry.js', import.meta.url), 'utf8'), context);
  assert.deepEqual(Array.from(context.AgMetricLiveSyncRegistry.getViewAdapters('sales-inventory', {
    inventoryNavigationOnly: true, surfaces: [],
  })), []);
  assert.deepEqual(Array.from(context.AgMetricLiveSyncRegistry.getViewAdapters('bunch-note', { surfaces: [] })), ['side:bunchNotes']);
  assert.match(section('function getProductionLiveSyncSideContext()', 'function createProductionLiveSyncSideAdapters'), /inventoryNavigationOnly: view === 'sales-inventory' && !access\.allowedViews\.has\('sales-inventory'\)/);
});

test('Sales shell footer uses remaining Queue permissions and offers Inventory without stale Que Bunch helpers', () => {
  assert.doesNotMatch(html, /canSeeBunchNotesRequestTab/);
  const context = vm.createContext({ isSalesShellAccess: () => true, canAccessView: view => view === 'sales-inventory' });
  vm.runInContext(section('function canShowFooterViewButton(', 'function getAssignmentMatchKeys('), context);
  assert.equal(context.canShowFooterViewButton('sales', {}), true);
  assert.equal(context.canShowFooterViewButton('sales-inventory', {}), true);
  assert.equal(context.canShowFooterViewButton('request', {}), false);
  context.canAccessView = view => view === 'request';
  assert.equal(context.canShowFooterViewButton('request', {}), true);
});

test('Bunch-only Inventory navigation does not authorize existing 84 R.D or Not on Inventory workflows', () => {
  const context = vm.createContext({
    getRoleAccessState: () => ({ allowedViews: new Set(), isAdmin: false, isEval: false, isRepLike: false }),
    canAccessView: view => view === 'sales-inventory',
    inventory84DirectMode: false,
    switchView: () => { throw new Error('Unauthorized 84 R.D navigation'); },
  });
  vm.runInContext(section('function canUseFullInventoryView()', 'function scrollNotOnInventoryPanelIntoView()'), context);
  vm.runInContext(section('function open84RdInventoryView()', 'let communicationPhoneState'), context);
  assert.equal(context.canUseFullInventoryView(), false);
  assert.equal(context.canUseNotOnInventoryModule(), false);
  assert.equal(context.open84RdInventoryView(), false);
  assert.equal(context.inventory84DirectMode, false);
  assert.match(section('function renderProductionHub()', 'function renderSalesInventoryHub()'), /setHubButtonVisibility\('production-open-84rd', canUseFullInventoryView\(\)/);
  context.getRoleAccessState = () => ({ allowedViews: new Set(['sales-inventory']) });
  assert.equal(context.canUseFullInventoryView(), true);
  assert.equal(context.canUseNotOnInventoryModule(), true);
  context.canAccessView = () => false;
  assert.equal(context.canUseFullInventoryView(), false);
  context.getRoleAccessState = () => ({ allowedViews: new Set(), isEval: true });
  assert.equal(context.canUseNotOnInventoryModule(), true, 'Existing Eval entitlement remains intact');
});
