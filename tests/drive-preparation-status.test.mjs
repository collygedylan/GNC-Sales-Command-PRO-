// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { parseExpressionAt } from 'acorn';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function source(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  const node = parseExpressionAt(html, start, { ecmaVersion: 'latest' });
  return html.slice(start, node.end);
}

function fixture() {
  const container = { state: 'loading' };
  const requestContainer = { state: 'loading' };
  const pending = {
    native: true, container, selection: 'selection', search: 'rose', filterKey: 'filter',
    user: 'dylan', role: 'ADMIN', token: 7, proof: 'proof', generation: 3
  };
  const ctx = {
    VIEW_LOAD_UI: { drive: { container: 'drive-content' }, request: { container: 'request-content' } },
    document: {
      hidden: false,
      getElementById: id => id === 'drive-content' ? container : id === 'request-content' ? requestContainer : id === 'drive-search' ? { value: 'rose' } : null
    },
    getContainerUiState: node => node.state,
    driveCommonNamePreparation: pending,
    getCurrentVisibleViewId: () => 'drive',
    activeDriveTab: 'name',
    getDriveDrillSelectionStateKey: () => 'selection',
    driveVisibleItemsStateCacheKey: 'filter', currentUser: 'dylan', currentRole: 'ADMIN',
    isChunkRenderCurrentForContainer: (node, key, token) => node === container && key === 'drive:name:list' && token === 7,
    canUseProductionLiveSync: () => true,
    productionVerifiedViewKey: () => 'proof',
    productionLiveSyncReadGeneration: 3
  };
  vm.createContext(ctx);
  vm.runInContext(`${source('isDriveCommonNamePreparationCurrent')}\n${source('isProductionDisplayWaitingForRender')}`, ctx);
  return { ctx, container, pending, waiting: view => ctx.isProductionDisplayWaitingForRender(view) };
}

test('verified status leaves an exact current native Drive preparation in charge of its loading display', () => {
  const f = fixture();
  assert.equal(f.waiting('drive'), false);
  assert.equal(f.ctx.driveCommonNamePreparation, f.pending, 'the preparation is neither cancelled nor replaced');
  assert.equal(f.waiting('request'), true, 'other loading views retain their recovery render');
  assert.equal(f.waiting('missing'), false);
  f.ctx.driveCommonNamePreparation = null;
  assert.equal(f.waiting('drive'), true, 'missing preparation still recovers a loading view');
  f.container.state = 'content';
  assert.equal(f.waiting('drive'), false);
});

test('stale, unauthorized, detached, and legacy preparations never suppress recovery', () => {
  const changes = [
    f => { f.pending.native = false; },
    f => { f.pending.container = { state: 'loading' }; },
    f => { f.pending.selection = 'old-selection'; },
    f => { f.pending.search = 'old-search'; },
    f => { f.pending.filterKey = 'old-filter'; },
    f => { f.pending.user = 'other-user'; },
    f => { f.pending.role = 'other-role'; },
    f => { f.pending.token = 6; },
    f => { f.pending.proof = 'old-proof'; },
    f => { f.pending.generation = 2; },
    f => { f.ctx.canUseProductionLiveSync = () => false; },
    f => { f.ctx.activeDriveTab = 'location'; },
    f => { f.ctx.getCurrentVisibleViewId = () => 'request'; },
    f => { f.ctx.document.hidden = true; }
  ];
  for (const change of changes) {
    const f = fixture();
    change(f);
    assert.equal(f.waiting('drive'), true, change.toString());
  }
});

test('status scheduling retains independent pending renders and preparation recovery', () => {
  const coordinator = source('getProductionLiveSyncCoordinator');
  assert.match(coordinator, /const waitingForDisplay = isProductionDisplayWaitingForRender\(getCurrentVisibleViewId\(\)\)/);
  assert.match(coordinator, /status\.state === 'Up to date' && \(waitingForDisplay \|\| driveCommonNameNeedsPreparation\(\)\s*\|\| \(productionLiveSyncRenderPending && !productionLiveSyncActiveRender && !hasProductionLiveSyncDraft\(\)\)\)/);
  assert.match(coordinator, /cancelScheduledUiRenderByPrefix\(`view-switch-render:\$\{getCurrentVisibleViewId\(\)\}`\);\s*scheduleProductionLiveSyncRender\(true\)/);
});
