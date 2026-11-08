import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { shouldAuditRetainedChunkPage } from '../../src/ui/chunk-render-pacing.js';
import { renderSuspendTagPage } from '../../src/views/suspend-tag-page.js';

export function installSuspendRenderer(ctx, source) {
  ctx.shouldAuditRetainedChunkPage = shouldAuditRetainedChunkPage;
  ctx.renderSuspendTagPage = renderSuspendTagPage;
  ctx.hydrateSuspendTagItemOptions = () => {};
  ctx.rememberOperationalExport ??= () => {};
  ctx.getMainAreaScrollTarget ??= () => null;
  const workflow = readFileSync(new URL('../../assets/row-workflow-functions.js', import.meta.url), 'utf8');
  const preserve = workflow.match(/function preserveInventoryScrollPosition\(paint\) \{[\s\S]*?\n\}/)[0];
  ctx.preserveInventoryScrollPosition = vm.runInContext(`(${preserve})`, ctx);
  ctx.getSuspendTagPageRuntime = () => ({
    isCurrentNavigationTransition: ctx.isCurrentNavigationTransition,
    paintFooterRequestBadgeOnly: ctx.paintFooterRequestBadgeOnly || (() => {}),
    rememberOperationalExport: ctx.rememberOperationalExport,
    hydrateSuspendTagItemOptions: ctx.hydrateSuspendTagItemOptions,
    getQueueCardInventoryState: ctx.getQueueCardInventoryState,
    syncRequestBrowseFooter: ctx.syncRequestBrowseFooter || (() => {}),
    getContainerRenderSignature: ctx.getContainerRenderSignature || (() => ''),
    createSuspendTagPageRenderRow: ctx.createSuspendTagPageRenderRow,
    generateCard: ctx.generateCard || (() => ''),
    renderMarkupChunkedByKey: ctx.renderMarkupChunkedByKey,
    getPendingRequestChunkRenderOptions: ctx.getPendingRequestChunkRenderOptions || (value => value),
    preserveInventoryScrollPosition: ctx.preserveInventoryScrollPosition,
    setContainerRenderSignature: ctx.setContainerRenderSignature || (() => {}),
    scheduleDeferredCardPhotoHydration: ctx.scheduleDeferredCardPhotoHydration || (() => {}),
    shouldAuditRetainedChunkPage,
    repairVisibleDockSuspendDcPlanstartCardTones: ctx.repairVisibleDockSuspendDcPlanstartCardTones || (() => {}),
    isIOSDevice: ctx.isIOSDevice || (() => false),
    closeAllRequestSwipes: ctx.closeAllRequestSwipes || (() => {}),
    releaseRequestSwipeMoveListener: ctx.releaseRequestSwipeMoveListener || (() => {}),
    decorateRequestRows: ctx.decorateRequestRows || (() => {}),
    getRequestToken: () => Number(ctx.chunkRenderTokensByKey?.['request-main'] || 0),
    getStableViewDom: () => ctx.window?.AgMetricStableViewDom,
    createElement: tagName => ctx.document?.createElement?.(tagName) || {},
  });
  vm.runInContext(source('renderSuspendTagPagedCards'), ctx);
}
