import assert from 'node:assert/strict';
import vm from 'node:vm';

export function assertHomeImportFilenames(appHtml, sourceFunction) {
  const importedAt = '2026-10-20T18:12:53.303Z';
  const files = ['DriveAroundMC-10-12333420261020123334.xlsx', 'SOC-10 Open Orders-12251620261020122516.xlsx',
    'SOC-10 Reserves-12370820261020123708.xlsx', 'Dylan Wide Open 2026-10-19.xlsx'];
  const elements = Object.fromEntries(['accordion', 'stamp', 'summary', 'files'].map(key =>
    [`dashboard-sync-${key}`, { classList: { toggle() {} }, innerHTML: '', innerText: '' }]));
  const context = vm.createContext({ document: { getElementById: id => elements[id] },
    canViewDashboardSyncStatus: () => true, getSupabaseReadIdentityScope: () => 'brian',
    dashboardSyncMetadataOwner: 'brian', dashboardSyncMetadataFetchedAt: Date.now(),
    dashboardSyncMetadataInFlight: null, dashboardSyncMetadataRequestOwner: '', DASHBOARD_SYNC_METADATA_TTL_MS: 60000,
    dashboardSyncMetadataSummaries: files.map((file, index) => ({ label: ['Drive', 'SOC', 'Reserves', 'CAV'][index],
      files: [file], iso: importedAt, ms: Date.parse(importedAt), authoritative: true })),
    fullInventory: [], socInventory: [], reservesInventory: [], cavInventory: [],
    collectDashboardSyncSource: () => ({ iso: '', files: [] }), mergeDashboardSyncSummaries: rows => rows,
    formatDashboardSyncDateTime: iso => iso, escapeDashboardSyncText: text => text,
    syncRequestChromeMarkup: (element, markup) => { element.innerHTML = markup; }, homeMarkupByNode: new WeakMap(),
    localStorage: { setItem() {} }, dashboardSyncFilenameCacheKey: () => 'same-account-sync',
    manualSyncStatusState: null });
  installHomeImportRenderer(context, name => sourceFunction(appHtml, name));
  context.updateDashboardSyncSummary();
  for (const file of files) assert.ok(elements['dashboard-sync-files'].innerHTML.includes(file));
  assert.equal(elements['dashboard-sync-stamp'].innerText, importedAt);
  assert.equal((elements['dashboard-sync-files'].innerHTML.match(/2026-10-20T18:12:53.303Z/g) || []).length, 4);
}

export function installHomeImportRenderer(context, source) {
  context.manualSyncStatusState ??= null;
  context.localStorage ??= { setItem() {} };
  context.dashboardSyncFilenameCacheKey ??= () => 'fixture-home-sync';
  for (const name of ['restoreDashboardSyncFilenames','saveDashboardSyncFilenames','confirmedErpRunTime','latestErpHomeTimestamp','updateDashboardSyncSummary']) {
    vm.runInContext(source(name), context);
  }
}

export function assertPartialHomeImportFilenames(shellFunction) {
  const nodes = Object.fromEntries(['dashboard-sync-accordion', 'dashboard-sync-stamp', 'dashboard-sync-summary', 'dashboard-sync-files'].map(id => [id, { classList: { toggle() {} }, innerHTML: '', innerText: '' }]));
  const ctx = vm.createContext({ document: { getElementById: id => nodes[id] }, canViewDashboardSyncStatus: () => true,
    getSupabaseReadIdentityScope: () => 'owner', dashboardSyncMetadataOwner: 'owner',
    dashboardSyncMetadataSummaries: [], dashboardSyncMetadataFetchedAt: Date.now(), dashboardSyncMetadataInFlight: false,
    DASHBOARD_SYNC_METADATA_TTL_MS: 60000, fullInventory: [], socInventory: [], reservesInventory: [], cavInventory: [],
    collectDashboardSyncSource: (_rows, label) => ({ label, iso: label === 'Reserves' ? '2026-10-21T16:00:00Z' : '', ms: label === 'Reserves' ? 1 : 0, files: label === 'Reserves' ? ['Reserves.xlsx'] : [] }),
    mergeDashboardSyncSummaries: rows => rows, formatDashboardSyncDateTime: value => value || 'Awaiting import metadata',
    escapeDashboardSyncText: value => String(value) });
  vm.runInContext('const homeMarkupByNode = new WeakMap();' + shellFunction('syncRequestChromeMarkup'), ctx);
  installHomeImportRenderer(ctx, shellFunction);
  ctx.updateDashboardSyncSummary();
  for (const source of ['DRIVE', 'CAV', 'RESERVES', 'SOC']) assert.match(nodes['dashboard-sync-files'].innerHTML, new RegExp('data-sync-source="' + source + '"'));
  assert.match(nodes['dashboard-sync-files'].innerHTML, /Reserves.xlsx/);
}
