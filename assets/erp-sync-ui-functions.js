// Declaration-only runtime fragment. Shared router, Back and account ownership remain canonical.
function erpSyncProgressCards(status = {}, summaries = []) {
    const aliases = { hl_po: 'hl_po_parsed' };
    return ['drive', 'cav', 'reserves', 'soc', 'hl_po', 'order_history'].map(key => {
        const metadata = summaries.find(row => String(row.label || '').toLowerCase() === key) || {};
        const progress = status.sourceProgress?.[aliases[key]] || status.sourceProgress?.[key] || {};
        const result = (status.stageResults || []).filter(row => row.key === (aliases[key] || key)
            && (!progress.fileName || row.sourceFileName === progress.fileName || (!row.sourceFileName && ['UP_TO_DATE', 'failed'].includes(row.outcome)))).at(-1) || {};
        const published = ['processed', 'imported'].includes(result.outcome) && Number(result.rowCount || result.rowsPublished) > 0;
        const unchanged = result.outcome === 'UP_TO_DATE';
        const error = String(progress.error || result.error || '');
        const percent = error ? Math.min(95, Number(progress.percent) || 0) : published || unchanged ? 100 : Math.min(95, Math.max(0, Number(progress.percent) || 0));
        return { key, label: key === 'hl_po' ? 'HL PO' : key.replace('_', ' ').toUpperCase(),
            fileName: String(progress.fileName || result.sourceFileName || metadata.files?.[0] || 'No published filename available'),
            percent, rowsParsed: Number(progress.rowsParsed) || 0,
            rowsPublished: published ? Number(result.rowCount || result.rowsPublished) : Number(progress.rowsPublished) || 0,
            rowsStaged: Number(progress.rowsStaged) || 0,
            rowsTotal: progress.rowsTotal == null ? (published ? Number(result.rowCount || result.rowsPublished) : null) : Number(progress.rowsTotal),
            stage: error ? 'failed' : published ? 'published' : unchanged ? 'up_to_date' : progress.stage || 'idle',
            updatedAt: progress.updatedAt || metadata.iso || '', error };
    });
}

function renderErpSyncProgressModal() {
    const modal = document.getElementById('erp-sync-progress-modal');
    if (!modal || modal.classList.contains('hidden')) return;
    if (!canViewDashboardSyncStatus() || modal.dataset.owner !== getSupabaseReadIdentityScope()) {
        closeErpSyncProgressModal();
        return;
    }
    const state = manualSyncStatusState || {};
    const cards = erpSyncProgressCards(state, dashboardSyncMetadataSummaries || []);
    const escape = escapeDashboardSyncText;
    const overall = Math.round(cards.reduce((sum, card) => sum + card.percent, 0) / cards.length);
    const started = Date.parse(state.startedAt || '');
    const elapsed = Number.isFinite(started) ? Math.max(0, Math.floor(((Date.parse(state.finishedAt || '') || Date.now()) - started) / 1000)) : 0;
    const error = cards.find(card => card.error)?.error || state.error;
    const label = error ? error : state.active ? state.currentStage === 'queued' ? 'SCANNING GOOGLE DRIVE' : 'SYNCING STAGE ' + Math.min(5, (Number(state.stageIndex) || 0) + 1) + ' OF 5 · ' + String(state.currentStageLabel || state.currentStage || '').toUpperCase() : state.status === 'complete' ? 'COMPLETED' : 'IDLE';
    const badge = modal.querySelector('[data-sync-badge]');
    badge.textContent = label;
    badge.classList.toggle('sync-error', !!error);
    modal.querySelector('[data-sync-overall]').value = overall;
    modal.querySelector('[data-sync-elapsed]').textContent = overall + '% · ' + elapsed + 's';
    modal.querySelector('[data-sync-run]').disabled = !canRunManualInventoryImport() || !!state.active || !!isRunScriptActive;
    modal.querySelector('[data-sync-cards]').innerHTML = cards.map(card => {
        const stage = ({ idle: 'Last published source · awaiting a new Drive check', downloading: 'Downloading from Google Drive…', parsing: 'Parsing workbook', staging: 'Staging & publishing to Supabase', published: '✓ Published Live in App', up_to_date: '✓ Last published version is up to date', failed: 'Publication failed' })[card.stage] || card.stage;
        const counts = card.stage === 'up_to_date' && card.rowsTotal == null ? 'Source unchanged · no rows restaged' : card.rowsParsed + ' parsed · ' + card.rowsStaged + ' / ' + (card.rowsTotal == null ? 'counting' : card.rowsTotal) + ' rows staged · ' + card.rowsPublished + ' published';
        return '<article class="erp-sync-file" data-sync-file="' + card.key + '"><strong>' + card.label + '</strong><div class="erp-sync-name">' + escape(card.fileName) + '</div><progress max="100" value="' + card.percent + '" aria-label="' + card.label + ' progress"></progress><div>' + card.percent + '% · ' + escape(stage) + '</div><small>' + counts + (card.updatedAt ? ' · ' + escape(card.updatedAt) : '') + '</small>' + (card.error ? '<p class="sync-error">' + escape(card.error) + '</p>' : '') + '</article>';
    }).join('');
}

function openErpSyncProgressModal() {
    if (!canViewDashboardSyncStatus()) return false;
    const modal = document.getElementById('erp-sync-progress-modal');
    if (!modal) return false;
    modal.dataset.owner = getSupabaseReadIdentityScope();
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    renderErpSyncProgressModal();
    if (!window.erpSyncModalTimer) window.erpSyncModalTimer = setInterval(() => {
        if (modal.classList.contains('hidden') || modal.style.display === 'none') { closeErpSyncProgressModal(); return; }
        if (document.hidden) return;
        renderErpSyncProgressModal();
        void refreshManualSyncStatus(true).catch(() => {});
    }, 800);
    void refreshManualSyncStatus(true).catch(() => {});
    modal.querySelector('[data-sync-close]')?.focus();
    updateGlobalBackButton();
    return false;
}

function closeErpSyncProgressModal() {
    const modal = document.getElementById('erp-sync-progress-modal');
    modal?.classList.add('hidden');
    if (modal) modal.style.display = 'none';
    clearInterval(window.erpSyncModalTimer);
    window.erpSyncModalTimer = null;
    updateGlobalBackButton();
    document.querySelector('#dashboard-sync-accordion summary')?.focus();
    return false;
}
