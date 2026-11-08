function prepareSuspendTagPageRows(plan, runtime) {
  const rows = plan.rows || [];
  runtime.rememberOperationalExport('request', plan.items || []);
  runtime.hydrateSuspendTagItemOptions(rows);
  if (typeof runtime.getQueueCardInventoryState !== 'function') return;
  rows.forEach(item => runtime.getQueueCardInventoryState(item, 'request'));
}

function prepareSuspendTagPageStage(input, runtime, renderSignature) {
  const { cardContainer, rootContainer } = input;
  const retainCards = !!(input.plan.rows?.length && cardContainer?.querySelector?.('[data-request-uid]')
    && runtime.getStableViewDom());
  const pendingStage = cardContainer?.__suspendPageStage;
  const pendingStageIsCurrent = !!(pendingStage && renderSignature
    && pendingStage.signature === renderSignature
    && Number(pendingStage.token) === runtime.getRequestToken()
    && cardContainer?.isConnected
    && !(rootContainer && rootContainer.isConnected === false));
  if (retainCards && pendingStageIsCurrent) return { reused: true, retainCards };
  if (pendingStage && cardContainer.__suspendPageStage === pendingStage) cardContainer.__suspendPageStage = null;
  const alreadyPublished = retainCards && runtime.getContainerRenderSignature(cardContainer) === renderSignature;
  const renderTarget = retainCards && !alreadyPublished ? runtime.createElement('div') : cardContainer;
  const generation = (Number(cardContainer?.__suspendPageGeneration) || 0) + 1;
  if (cardContainer) cardContainer.__suspendPageGeneration = generation;
  const stage = retainCards && !alreadyPublished
    ? { signature: renderSignature, generation, target: renderTarget, startedAt: Date.now() } : null;
  if (cardContainer) cardContainer.__suspendPageStage = stage;
  if (stage) cardContainer.__suspendPagePublicationReceipt = null;
  return { reused: false, retainCards, renderTarget, generation, stage };
}

function resolveSuspendTagPageRowRenderer(state, cardContainer, plan, runtime) {
  if (state.render) return state.render;
  if (typeof runtime.createSuspendTagPageRenderRow === 'function') {
    state.render = runtime.createSuspendTagPageRenderRow(cardContainer, plan);
  } else state.render = row => runtime.generateCard(row, 'request', 'status-red');
  return state.render;
}

function createSuspendTagPageRowRenderer(cardContainer, plan, runtime) {
  const state = { render: null };
  return (item, index) => resolveSuspendTagPageRowRenderer(state, cardContainer, plan, runtime)(item, index);
}

function publishRetainedSuspendTagPage(context, runtime) {
  if (!context.retainCards) return true;
  const { cardContainer, rootContainer, stage, generation, renderTarget, renderSignature } = context;
  const invalid = !cardContainer.isConnected || (rootContainer && rootContainer.isConnected === false)
    || cardContainer.__suspendPageGeneration !== generation
    || (stage && cardContainer.__suspendPageStage !== stage);
  if (invalid) {
    if (cardContainer.__suspendPageStage === stage) cardContainer.__suspendPageStage = null;
    return false;
  }
  if (stage) {
    runtime.preserveInventoryScrollPosition(() => runtime.getStableViewDom().apply(cardContainer, renderTarget));
    runtime.setContainerRenderSignature(cardContainer, renderSignature);
    cardContainer.__suspendPagePublicationReceipt = {
      generation, renderSignature, durationMs: Math.max(0, Date.now() - stage.startedAt),
    };
    cardContainer.__suspendPageStage = null;
  }
  runtime.scheduleDeferredCardPhotoHydration(cardContainer);
  return true;
}

function completeSuspendTagPage(context, runtime) {
  if (!runtime.isCurrentNavigationTransition(context.navigationSeq, 'request')) return;
  if (!publishRetainedSuspendTagPage(context, runtime)) return;
  if (runtime.shouldAuditRetainedChunkPage(context.retainCards)) {
    runtime.repairVisibleDockSuspendDcPlanstartCardTones(context.rootContainer);
  }
  if (runtime.isIOSDevice()) {
    runtime.closeAllRequestSwipes();
    runtime.releaseRequestSwipeMoveListener();
  } else runtime.decorateRequestRows();
  runtime.syncRequestBrowseFooter(context.footerContainer, context.plan.footerMarkup);
}

function buildSuspendTagPageOptions(context, runtime) {
  const emptyMessage = context.mirrorsPending ? 'Loading Suspend Tag rows…'
    : (context.hasFilters ? 'No suspend tag rows match these filters.' : 'No suspend tag rows.');
  return runtime.getPendingRequestChunkRenderOptions({
    _backgroundStage: !!context.retainCards,
    initialRows: Math.min(40, Math.max(1, context.plan.rows?.length || 0)),
    renderSignature: context.renderSignature,
    emptyHtml: `<div class="p-8 text-center text-gray-400">${emptyMessage}</div>`,
    onComplete: () => completeSuspendTagPage(context, runtime),
    onCompleteAfterInteractive: !context.retainCards,
    completionDeadlineMs: context.retainCards ? (runtime.isIOSDevice() ? 1 : 250) : 100,
    completionDeadlineDrainAll: true,
    onCompleteDelayMs: 140,
  });
}

export function renderSuspendTagPage(input = {}, runtime = {}) {
  if (!runtime.isCurrentNavigationTransition(input.navigationSeq, 'request')) {
    runtime.paintFooterRequestBadgeOnly();
    return false;
  }
  const plan = input.plan && typeof input.plan === 'object' ? input.plan : {};
  prepareSuspendTagPageRows(plan, runtime);
  const renderSignature = String(plan.renderSignature || '');
  const stageContext = prepareSuspendTagPageStage({ ...input, plan }, runtime, renderSignature);
  if (stageContext.reused) {
    runtime.syncRequestBrowseFooter(input.footerContainer, plan.footerMarkup);
    return true;
  }
  const context = { ...input, ...stageContext, plan, renderSignature };
  const renderRow = createSuspendTagPageRowRenderer(input.cardContainer, plan, runtime);
  const options = buildSuspendTagPageOptions(context, runtime);
  const didSchedule = runtime.renderMarkupChunkedByKey('request-main', context.renderTarget,
    input.crumb, plan.rows, input.crumbText, renderRow, options);
  if (context.stage && input.cardContainer.__suspendPageStage === context.stage) {
    context.stage.token = runtime.getRequestToken();
  }
  runtime.syncRequestBrowseFooter(input.footerContainer, plan.footerMarkup);
  return didSchedule;
}
