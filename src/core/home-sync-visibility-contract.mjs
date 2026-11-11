import assert from 'node:assert/strict';
import vm from 'node:vm';

export function assertHomeSyncVisibility(indexHtml, runtime, appHtml, sourceFunction) {
  assert.doesNotMatch(indexHtml, /<details id="dashboard-sync-accordion"[^>]*\bopen\b/);
  assert.doesNotMatch(runtime, /syncPanel\.open\s*=/);
  assert.match(indexHtml, /id="dashboard-sync-files"/);
  const context = vm.createContext({ currentUser:'dylan_collyge',
    canAccessView:view => view === 'drive', getProtectedUserTokens:() => new Set(),
    hasPrivilegedManagerAccess:() => false });
  vm.runInContext(sourceFunction(appHtml,'canViewDashboardSyncStatus','        '),context);
  assert.equal(context.canViewDashboardSyncStatus(),true);
  context.currentUser='regular_user';
  assert.equal(context.canViewDashboardSyncStatus(),false);
}
