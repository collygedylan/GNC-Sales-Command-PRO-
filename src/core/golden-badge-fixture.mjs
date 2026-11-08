import assert from 'node:assert/strict';

export function badgeConnectionContract(runFunctions,functionSource,read) {
  const badgeClasses = new Set(['hidden']);
  const buttonClasses = new Set();
  const badge = { innerText: '', classList: { add: name => badgeClasses.add(name), remove: name => badgeClasses.delete(name) } };
  const button = { classList: { toggle: (name, enabled) => enabled ? buttonClasses.add(name) : buttonClasses.delete(name) } };
  const badgeContext = runFunctions('assets/app-runtime.js', ['paintFooterRequestBadgeOnly'], {
    document: { getElementById: id => id === 'footer-request-btn' ? button : id === 'footer-request-badge' ? badge : null,querySelector:()=>null },
    canUseFooterRequestShortcut: () => true,getActiveAssignedQueueCounts:()=>({pending:7}),
    getRequestQueueAlertCount: counts => Number(counts.pending || 0),
  });
  assert.equal(badgeContext.paintFooterRequestBadgeOnly({ pending: 7 }), true);
  assert.equal(badge.textContent, '7');
  assert.equal(badgeClasses.has('hidden'), false);
  assert.doesNotMatch(functionSource('assets/app-runtime.js', 'paintFooterRequestBadgeOnly'), /innerText\s*=\s*['"]!['"]/);

  const connectionContext = runFunctions('assets/app-runtime.js', ['getDatasetRevisionConnectionLabel'], {
    datasetRevisionConnectionOwner: 'dylan',
    datasetRevisionConnectionStates: Array.from({ length: 4 }, (_, index) => ({ key: String(index), state: 'ready' })),
    getSupabaseReadIdentityScope: () => 'dylan',
    window: { GncUserAccessControl: { getSelfState: () => ({ denied: false }) } },
    hasActiveManualSync: () => false,
  });
  assert.match(connectionContext.getDatasetRevisionConnectionLabel(), /^Connected.*4 ready$/);
  assert.doesNotMatch(read('index.html'), /<details id="dashboard-sync-accordion"[^>]*\bopen\b/);
  assert.match(functionSource('assets/app-runtime.js', 'updateDashboardSyncSummary'), /\['DRIVE', 'CAV', 'RESERVES', 'SOC'\]/);
}
