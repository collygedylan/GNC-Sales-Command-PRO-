// Declaration-only runtime fragment. Shared router, Back and account ownership remain canonical.
function erpSyncProgressCards(status = {}, summaries = []) {
    return ['drive', 'cav', 'reserves', 'soc', 'hl_po'].map(key => buildErpSyncProgressCard(key, status, summaries));
}

function resolveErpProgressResult(results, key, fileName) {
    return (results || []).findLast(row => {
        if (row.key !== key) return false;
        if (!fileName || row.sourceFileName === fileName) return true;
        return !row.sourceFileName && ['UP_TO_DATE', 'failed'].includes(row.outcome);
    }) || {};
}

function erpProgressCardStage(progress, error, published, unchanged) {
    if (error) return 'failed';
    if (published) return 'published';
    if (unchanged) return 'up_to_date';
    return progress.stage === 'complete' ? 'published' : progress.stage || 'queued';
}

function buildErpSyncProgressCard(key, status, summaries) {
    const sourceKey = key === 'hl_po' ? 'hl_po_parsed' : key;
    const metadata = summaries.find(row => String(row.label || '').toLowerCase() === key) || {};
    const progress = status.sourceProgress?.[sourceKey] || status.sourceProgress?.[key] || {};
    const result = resolveErpProgressResult(status.stageResults, sourceKey, progress.fileName);
    const committed = progress.publicationConfirmed === true && progress.publishedFileName === progress.fileName && Number(progress.rowsPublished) > 0;
    const published = committed || ['processed', 'imported'].includes(result.outcome) && Number(result.rowCount || result.rowsPublished) > 0;
    const checked = progress.checked === true && progress.stage === 'complete' || result.outcome === 'UP_TO_DATE';
    const unchanged = result.outcome === 'UP_TO_DATE' || checked && progress.upToDate === true;
    const error = String(progress.error || result.error || '');
    let percent = Math.min(95, Number(progress.percent) || 0);
    if (!error) percent = published || unchanged || checked ? 100 : Math.max(0, percent);
    let rowsPublished = Number(progress.rowsPublished) || 0;
    if (published) rowsPublished = Number(result.rowCount || result.rowsPublished || progress.rowsPublished) || 0;
    else if (unchanged) rowsPublished = Number(progress.lastPublishedRows ?? progress.rowsPublished) || 0;
    const awaitingFile = status.active && !checked && !published && !result.sourceFileName && ['queued', 'checking'].includes(progress.stage || 'queued');
    const fileName = awaitingFile ? 'Awaiting current source' : String(progress.fileName || result.sourceFileName || metadata.files?.[0] || 'No published filename available');
    const defaultTotal = published || unchanged ? rowsPublished : null;
    return { key, label: key === 'hl_po' ? 'HL PO' : key.toUpperCase(), checked: checked && !error,
        fileName, percent, rowsParsed: Number(progress.rowsParsed) || 0, rowsPublished,
        rowsStaged: Number(progress.rowsStaged) || 0, rowsTotal: progress.rowsTotal == null ? defaultTotal : Number(progress.rowsTotal),
        stage: erpProgressCardStage(progress, error, published, unchanged), updatedAt: progress.updatedAt || metadata.iso || '', error };
}

function completeOperationalErpSyncStatus(status = {}, now = Date.now()) {
    const cards = erpSyncProgressCards(status);
    const percent = Math.floor(cards.reduce((sum, card) => sum + card.percent, 0) / (cards.length || 5));
    const complete = cards.every(card => card.percent === 100 && card.checked && !card.error);
    if (complete) return { ...status, active: false, status: 'complete', percent, currentStage: 'idle', currentStageLabel: 'Idle',
        stageIndex: cards.length, finishedAt: status.finishedAt || new Date(now).toISOString(), error: '', errorCode: '', message: 'Five operational sources completed.' };
    return { ...status, percent, ...(status.status === 'complete' ? { status: status.active ? 'running' : 'incomplete', finishedAt: '' } : {}) };
}

function driveManualErpSyncFromStatus(status = {}, resume = false) {
    if (manualSyncStartPending || !status.active || !status.runId || document.hidden || navigator.onLine === false || !canRunManualInventoryImport()) return false;
    const soc = status.currentStage === 'soc' && status.sourceProgress?.soc;
    const readyToPublish = soc && !soc.publicationConfirmed && Number(soc.rowsTotal)>0 && Number(soc.rowsStaged)>=Number(soc.rowsTotal);
    // The sequential foreground driver keeps advancing even while cloud status is running.
    const owner = getSupabaseReadIdentityScope(), current = window.erpSyncContinuationDriver;
    if (current?.owner === owner && current?.runId === status.runId) return false;
    const driver = { owner, runId: status.runId };
    window.erpSyncContinuationDriver = driver;
    driver.promise = Promise.resolve().then(() => owner === getSupabaseReadIdentityScope() && continueManualErpSync(status)).catch(() => {
        if (owner === getSupabaseReadIdentityScope()) scheduleManualSyncStatusPoll(1000);
    }).finally(() => { if (window.erpSyncContinuationDriver === driver) window.erpSyncContinuationDriver = null; });
    return true;
}

function renderErpSyncProgressModal() {
    const modal = document.getElementById('erp-sync-progress-modal');
    if (!modal || modal.classList.contains('hidden')) return;
    if (!canViewDashboardSyncStatus() || modal.dataset.owner !== getSupabaseReadIdentityScope()) {
        closeErpSyncProgressModal();
        return;
    }
    const state = completeOperationalErpSyncStatus(manualSyncStatusState || {});
    const cards = erpSyncProgressCards(state, dashboardSyncMetadataSummaries || []);
    const overall = Math.floor(cards.reduce((sum, card) => sum + card.percent, 0) / (cards.length || 5));
    const started = Date.parse(state.startedAt || '');
    const elapsed = Number.isFinite(started) ? Math.max(0, Math.floor(((Date.parse(state.finishedAt || '') || Date.now()) - started) / 1000)) : 0;
    const error = cards.find(card => card.error)?.error || state.error;
    const recovering = isManualErpScanStalled(state);
    const badge = modal.querySelector('[data-sync-badge]');
    badge.textContent = erpSyncProgressLabel(state, error, recovering);
    badge.classList.toggle('sync-error', !!error);
    modal.querySelector('[data-sync-overall]').value = overall;
    const canStart = canRunManualInventoryImport() || (!nativeAuthProfile?.id && canViewDashboardSyncStatus());
    const lastProgress = Date.parse(state.sourceProgress?.[state.currentStage]?.updatedAt || state.updatedAt || state.startedAt || '');
    const publishing = state.sourceProgress?.[state.currentStage]?.stage === 'publishing';
    const waiting = state.active && publishing && (state.errorCode === 'ERP_PUBLICATION_RETRY' || Date.now() - lastProgress >= 45000);
    modal.querySelector('[data-sync-elapsed]').textContent = overall + '% · ' + elapsed + 's'
        + (waiting ? ' · Waiting for publication confirmation. Staged rows are saved.' : '');
    modal.querySelector('[data-sync-run]').disabled = !canStart || !recovering && (manualSyncStartPending || !!window.googleScriptRunInFlight);
    modal.querySelector('[data-sync-cards]').innerHTML = cards.map(renderErpSyncProgressCard).join('');
}

function erpSyncProgressLabel(state, error, recovering) {
    if (recovering) return 'RECOVERING SYNC CHECKPOINT';
    if (error) return error;
    if (!state.active) return state.status === 'incomplete' ? 'READY TO CONTINUE' : 'IDLE';
    if (['queued', 'scanning'].includes(state.currentStage)) return 'SCANNING GOOGLE DRIVE';
    const stage = Math.min(5, (Number(state.stageIndex) || 0) + 1);
    return `SYNCING STAGE ${stage} OF 5 · ${String(state.currentStageLabel || state.currentStage || '').toUpperCase()}`;
}

function renderErpSyncProgressCard(card) {
    const escape = escapeDashboardSyncText;
    const total = card.rowsTotal ?? 'counting';
    const waiting = 'Queued — waiting for previous stage...';
    const labels = { queued: waiting, idle: waiting, checking: 'Checking Google Drive drop folder...',
        downloading: `Downloading ${card.fileName} from Google Drive...`, parsing: `Parsing workbook (${card.rowsParsed} rows read)...`,
        staging: `Staging to Supabase (${card.rowsStaged} / ${total} rows)...`, publishing: `Publishing ${card.rowsStaged} rows live to App...`,
        published: `✓ Published Live in App (${card.rowsPublished} rows)`, up_to_date: `✓ Checked Drive — Up to date in App (${card.rowsPublished} rows · ${card.fileName})`,
        failed: 'Publication failed' };
    const counts = card.stage === 'up_to_date' ? `${card.rowsPublished} published rows · current drop folder checked`
        : `${card.rowsParsed} parsed · ${card.rowsStaged} / ${total} rows staged · ${card.rowsPublished} published`;
    const updated = card.updatedAt ? ` · ${escape(card.updatedAt)}` : '';
    const error = card.error ? `<p class="sync-error">${escape(card.error)}</p>` : '';
    return `<article class="erp-sync-file" data-sync-file="${card.key}"><strong>${card.label}</strong><div class="erp-sync-name">${escape(card.fileName)}</div><progress max="100" value="${card.percent}" aria-label="${card.label} progress"></progress><div>${card.percent}% · ${escape(labels[card.stage] || card.stage)}</div><small>${counts}${updated}</small>${error}</article>`;
}

function bindErpHomeStatusPanel(panel) {
    const summary = panel.querySelector('summary');
    if (summary && summary.dataset.viewportChoiceBound !== 'true') {
        summary.addEventListener('click', event => {
            event.preventDefault?.();
            openErpSyncProgressModal();
            if (event.isTrusted) panel.dataset.viewportUserControlled = 'true';
        });
        summary.dataset.viewportChoiceBound = 'true';
    }
    const band = window.innerWidth >= 768 ? 'desktop' : 'mobile';
    if (panel.dataset.viewportUserControlled !== 'true' && panel.dataset.viewportDefaultBand !== band) panel.open = true;
    panel.dataset.viewportDefaultBand = band;
    panel.dataset.viewportDefaultApplied = 'true';
    panel.classList.toggle('hidden', !canViewDashboardSyncStatus());
}

function erpHomeRunScriptLabel(manualSyncActive, progress) {
    if (window.googleScriptRunInFlight) return 'Starting...';
    if (manualSyncActive && isAutoManualSyncStatus()) return progress.text ? `Auto ${progress.text}` : 'Auto Sync';
    if (isRunScriptActive || manualSyncActive) return progress.text ? `Sync ${progress.text}` : 'Syncing...';
    return 'Run Script';
}

function syncGoogleScriptButton() {
    const button = document.getElementById('run-google-script-btn');
    if (!button) return;
    const label = button.querySelector('[data-run-script-label]');
    const isVisible = canRunManualInventoryImport() || (!nativeAuthProfile?.id && canViewDashboardSyncStatus());
    const panel = document.getElementById('dashboard-sync-accordion');
    if (panel) bindErpHomeStatusPanel(panel);
    const localRunInFlight = !!isRunScriptActive || !!window.googleScriptRunInFlight;
    const recovering = isManualErpScanStalled(manualSyncStatusState || {});
    button.classList.toggle('hidden', !isVisible);
    button.disabled = !recovering && (manualSyncStartPending || !!window.googleScriptRunInFlight);
    button.classList.toggle('opacity-60', localRunInFlight);
    button.classList.toggle('cursor-wait', localRunInFlight);
    if (label) label.innerText = erpHomeRunScriptLabel(hasActiveManualSync(), getManualSyncProgressInfo());
}

function openErpSyncProgressModal() {
    if (!canViewDashboardSyncStatus()) return false;
    const modal = document.getElementById('erp-sync-progress-modal');
    if (!modal) return false;
    modal.dataset.owner = getSupabaseReadIdentityScope();
    const backdrop = modal.closest('.erp-sync-progress-backdrop');
    if (backdrop) {
        if (backdrop.parentNode !== document.body) document.body.appendChild(backdrop);
        backdrop.hidden = false;
    }
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    renderErpSyncProgressModal();
    if (manualSyncStatusState?.active) driveManualErpSyncFromStatus(manualSyncStatusState, true);
    if (!window.erpSyncModalTimer) window.erpSyncModalTimer = setInterval(() => {
        if (modal.classList.contains('hidden') || modal.style.display === 'none') { closeErpSyncProgressModal(); return; }
        if (document.hidden) return;
        renderErpSyncProgressModal();
        void refreshManualSyncStatus(true).catch(() => {});
    }, 5000);
    void refreshManualSyncStatus(true).catch(() => {});
    modal.querySelector('[data-sync-close]')?.focus();
    updateGlobalBackButton();
    return false;
}

function closeErpSyncProgressModal() {
    const modal = document.getElementById('erp-sync-progress-modal');
    modal?.classList.add('hidden');
    if (modal) {
        modal.style.display = 'none';
        const backdrop = modal.closest('.erp-sync-progress-backdrop');
        if (backdrop) backdrop.hidden = true;
    }
    clearInterval(window.erpSyncModalTimer);
    window.erpSyncModalTimer = null;
    if (typeof clearManualSyncStatusPoll === 'function') clearManualSyncStatusPoll();
    if (typeof clearReclassDeliveryPollTimer === 'function') clearReclassDeliveryPollTimer();
    updateGlobalBackButton();
    document.querySelector('#dashboard-sync-accordion summary')?.focus();
    return false;
}
