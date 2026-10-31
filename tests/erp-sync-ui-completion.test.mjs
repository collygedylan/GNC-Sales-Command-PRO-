import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readComposedAppSource } from '../scripts/composed-app-source.mjs';

const html = readComposedAppSource();

function functionSource(name, nextMarker) {
  const startMarker = `        function ${name}(`;
  const start = html.indexOf(startMarker);
  const end = html.indexOf(nextMarker, start);
  assert.ok(start >= 0 && end > start, `${name} / ${nextMarker}`);
  return html.slice(start, end);
}

test('manual sync completion paints idle and file receipt before hydration, with Home metadata first', async () => {
  const scheduleSource = functionSource('scheduleManualSyncCompletionRefresh', '        function applyManualSyncStatus(');
  const applySource = functionSource('applyManualSyncStatus', '        async function refreshManualSyncStatus(');
  const events = [];
  let completionTimer = null;
  let releaseMetadata;
  const context = vm.createContext({
    manualSyncPostRefreshInFlight: false,
    manualSyncStatusState: { active: true, runId: 'run-1', stageIndex: 4, stageResults: [] },
    currentUser: 'dylan_collyge',
    navigator: { onLine: true },
    liveSyncMode: 'idle',
    MANUAL_SYNC_COMPLETION_REFRESH_DELAY_MS: 300,
    MANUAL_SYNC_COMPLETION_CATCHUP_DELAY_MS: 18000,
    normalizeManualSyncStatusPayload: value => value || {},
    isManualSyncStatusClientStale: () => false,
    syncGoogleScriptButton: () => events.push('button-idle'),
    shouldPauseManualSyncViewRefresh: () => false,
    updateSyncDiagnostics: mode => events.push(`diagnostics-${mode}`),
    scheduleManualSyncStatusPoll() {},
    clearManualSyncStatusPoll() {},
    refreshRealtimeSubscriptionsForCurrentView: () => events.push('realtime-refresh'),
    scheduleManualSyncCompletionRefresh(delay = 300) { events.push('completion-refresh-scheduled'); context.scheduleActual(delay); },
    manualSyncTerminalErrorRunId: '',
    showToast: title => events.push(`toast-${title}`),
    dismissToast() {},
    toastLastFingerprint: '',
    dashboardSyncMetadataFetchedAt: 0,
    refreshDashboardSyncMetadata: () => {
      events.push('metadata-start');
      return new Promise(resolve => { releaseMetadata = () => { events.push('metadata-finished'); resolve(true); }; });
    },
    forceRefreshViewDatasets: () => { events.push('row-hydration'); return Promise.resolve(false); },
    getManualSyncCompletionViewId: () => 'home',
    queueVisibleDatasetCatchup() {},
    isTouchConstrainedDevice: () => false,
    setTimeout(callback) { completionTimer = callback; return 1; },
    clearTimeout() {},
  });
  vm.runInContext(`${scheduleSource}\n${applySource}\nthis.applyStatus = applyManualSyncStatus; this.scheduleActual = scheduleManualSyncCompletionRefresh;`, context);

  context.applyStatus({ active: false, runId: 'run-1', stageIndex: 5, currentStage: 'idle', stageResults: [
    { key: 'drive', outcome: 'processed', processedFiles: 1, sourceFileName: 'Drive.xlsx' },
  ] });
  assert.ok(events.indexOf('button-idle') < events.indexOf('diagnostics-idle'), 'the sync controls clear at the terminal status');
  assert.ok(events.indexOf('diagnostics-idle') < events.indexOf('toast-File Processed'), 'the idle state is immediate and the file receipt is shown before hydration');
  assert.ok(events.indexOf('toast-File Processed') < events.indexOf('realtime-refresh'));
  assert.ok(completionTimer, 'terminal completion schedules its refresh');

  completionTimer();
  await Promise.resolve();
  assert.ok(events.includes('metadata-start'));
  assert.ok(!events.includes('row-hydration'), 'full row hydration waits for the small metadata refresh');
  releaseMetadata();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(events.indexOf('metadata-finished') < events.indexOf('row-hydration'));
});

test('foreground restoration immediately reuses authenticated sync status and Home metadata refreshes', () => {
  const source = functionSource('refreshManualSyncOnForeground', '        function canRunManualInventoryImport(');
  const calls = [];
  const context = vm.createContext({
    currentUser: 'dylan_collyge', document: { hidden: false }, navigator: { onLine: true },
    lastManualSyncStatusCheckedAt: 900,
    getProductionLiveSyncCoordinator: () => ({ check: () => { calls.push(['revision', true]); return Promise.resolve(); } }),
    refreshManualSyncStatus: force => { calls.push(['status', force]); return Promise.resolve(); },
    refreshDashboardSyncMetadata: force => { calls.push(['metadata', force]); return Promise.resolve(); },
  });
  vm.runInContext(`${source}\nthis.refreshOnForeground = refreshManualSyncOnForeground;`, context);
  assert.equal(context.refreshOnForeground(), true);
  assert.equal(context.lastManualSyncStatusCheckedAt, 0, 'resume bypasses the status freshness throttle');
  assert.deepEqual(calls, [['status', true], ['metadata', true], ['revision', true]]);
  context.document.hidden = true;
  assert.equal(context.refreshOnForeground(), false, 'hidden restoration events do not start reads');
  assert.equal(calls.length, 3);
});
