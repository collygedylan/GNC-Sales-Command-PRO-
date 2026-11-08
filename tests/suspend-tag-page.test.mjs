// @test-group: @views-workflows,@release-validation
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSuspendTagPage } from '../src/views/suspend-tag-page.js';
import { shouldAuditRetainedChunkPage } from '../src/ui/chunk-render-pacing.js';

function createContainer(hasCard = false) {
  return {
    isConnected: true,
    querySelector: selector => selector === '[data-request-uid]' && hasCard ? {} : null,
  };
}

function createRuntime(options = {}) {
  const events = [];
  const stableViewDom = { apply: (destination, source) => events.push(['apply', destination, source]) };
  const runtime = {
    events,
    complete: null,
    isCurrentNavigationTransition: () => options.navigationCurrent !== false,
    paintFooterRequestBadgeOnly: () => events.push(['badge']),
    rememberOperationalExport: (view, rows) => events.push(['export', view, rows.length]),
    hydrateSuspendTagItemOptions: rows => events.push(['hydrate', rows.length]),
    getQueueCardInventoryState: row => events.push(['inventory', row.id]),
    syncRequestBrowseFooter: (_container, html) => events.push(['footer', html]),
    getContainerRenderSignature: () => options.publishedSignature || '',
    createSuspendTagPageRenderRow: () => row => `<article>${row.id}</article>`,
    generateCard: row => `<article>${row.id}</article>`,
    renderMarkupChunkedByKey: (_key, target, _crumb, rows, _crumbText, renderRow, renderOptions) => {
      events.push(['render', target, rows.map(renderRow)]);
      runtime.complete = renderOptions.onComplete;
      return true;
    },
    getPendingRequestChunkRenderOptions: value => value,
    preserveInventoryScrollPosition: callback => callback(),
    setContainerRenderSignature: (_container, signature) => events.push(['signature', signature]),
    scheduleDeferredCardPhotoHydration: () => events.push(['photos']),
    shouldAuditRetainedChunkPage,
    repairVisibleDockSuspendDcPlanstartCardTones: () => events.push(['audit']),
    isIOSDevice: () => options.ios === true,
    closeAllRequestSwipes: () => events.push(['close-swipes']),
    releaseRequestSwipeMoveListener: () => events.push(['release-swipe']),
    decorateRequestRows: () => events.push(['decorate']),
    getRequestToken: () => 7,
    getStableViewDom: () => stableViewDom,
    createElement: () => ({ isConnected: false, staged: true }),
  };
  return runtime;
}

function createInput(cardContainer) {
  return {
    cardContainer,
    footerContainer: {},
    rootContainer: { isConnected: true },
    crumb: {},
    crumbText: 'Suspend Tag',
    navigationSeq: 4,
    mirrorsPending: false,
    hasFilters: false,
    plan: {
      items: [{ id: 'a' }, { id: 'b' }],
      rows: [{ id: 'a' }, { id: 'b' }],
      renderSignature: 'sig-1',
      footerMarkup: '<footer>2</footer>',
    },
  };
}

test('fresh Suspend pages publish once without a retained-DOM audit', () => {
  const cardContainer = createContainer(false);
  const runtime = createRuntime();
  assert.equal(renderSuspendTagPage(createInput(cardContainer), runtime), true);
  runtime.complete();
  assert.equal(runtime.events.filter(([name]) => name === 'render').length, 1);
  assert.equal(runtime.events.filter(([name]) => name === 'audit').length, 0);
  assert.equal(runtime.events.filter(([name]) => name === 'decorate').length, 1);
  assert.equal(runtime.events.filter(([name]) => name === 'footer').length, 2);
});

test('retained Suspend pages atomically publish the fenced stage and audit it', () => {
  const cardContainer = createContainer(true);
  const runtime = createRuntime({ publishedSignature: 'old' });
  assert.equal(renderSuspendTagPage(createInput(cardContainer), runtime), true);
  assert.equal(cardContainer.__suspendPageStage.token, 7);
  runtime.complete();
  assert.equal(runtime.events.filter(([name]) => name === 'apply').length, 1);
  assert.equal(runtime.events.filter(([name]) => name === 'photos').length, 1);
  assert.equal(runtime.events.filter(([name]) => name === 'audit').length, 1);
  assert.equal(cardContainer.__suspendPageStage, null);
  assert.equal(cardContainer.__suspendPagePublicationReceipt.renderSignature, 'sig-1');
});

test('a stale navigation completion cannot publish its retained Suspend stage', () => {
  const cardContainer = createContainer(true);
  let navigationChecks = 0;
  const runtime = createRuntime({ publishedSignature: 'old' });
  runtime.isCurrentNavigationTransition = () => ++navigationChecks === 1;
  assert.equal(renderSuspendTagPage(createInput(cardContainer), runtime), true);
  runtime.complete();
  assert.equal(runtime.events.filter(([name]) => name === 'apply').length, 0);
  assert.equal(runtime.events.filter(([name]) => name === 'photos').length, 0);
  assert.equal(runtime.events.filter(([name]) => name === 'audit').length, 0);
  assert.equal(cardContainer.__suspendPageStage.signature, 'sig-1');
});
