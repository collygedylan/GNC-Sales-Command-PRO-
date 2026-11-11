import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

function appAsset(name) {
    return readFileSync(new URL(`../assets/${name}.js`, import.meta.url), 'utf8');
}

function browseCheckpointFixture() {
    const dom = new JSDOM(`<div id="global-header-search-slot"><div id="drive-search-container">
        <input id="drive-search" value="blue point"><select id="drive-filter"><option value="all">All</option><option selected value="F1">F1</option></select>
        </div></div><div id="view-drive"></div><div id="drive-column-filter-window" role="dialog"><input value="F1"></div>`,
    { url: 'https://agmetricapp.com', runScripts: 'outside-only' });
    const context = dom.getInternalVMContext();
    vm.runInContext(`
        const currentUser = 'dylan_collyge', nativeAuthProfile = { id: 'subject' };
        const nativeAuthSessionActive = true, nativeAuthSessionUserId = 'subject';
        const GLOBAL_HEADER_SEARCH_CONFIG = { drive: 'drive-search-container' };
        const pendingPhotoUploads = new Map(), selectedItems = new Set(), driveQuickRequestItems = new Set();
        const activeItem = null, activeHomeTab = '', activeDetailTab = '', cartPanelOpen = false, navTransitionSeq = 1;
        const viewHistoryStack = [];
        const getCurrentVisibleViewId = () => 'drive';
        const getMainAreaScrollTop = () => 0;
        const captureAppFilterState = () => ({ drive: { selectedDriveLocationCodes: ['L.05.000'] } });
    `, context);
    vm.runInContext(appAsset('app-update-state'), context);
    vm.runInContext(appAsset('app-update-restore'), context);
    vm.runInContext('captureAppUpdateReportState = () => ({})', context);
    return { dom, context, document: dom.window.document };
}

test('the mounted Drive header search and filter checkpoint without a browse draft blocker', async () => {
    const { dom, context, document } = browseCheckpointFixture();
    try {
        assert.equal(context.getAppUpdateBusyState().busy, false);
        const receipt = await context.saveWorkStateBeforeAppUpdate({ targetVersion: '3.0.72' });
        assert.equal(receipt.ok, true, receipt.reason);
        assert.equal(context.commitAppUpdateSnapshotForReload(receipt), true);
        const snapshot = JSON.parse(context.localStorage.getItem('agdata_update_restore_v1'));
        assert.deepEqual(snapshot.work.filters.drive.selectedDriveLocationCodes, ['L.05.000']);
        assert.deepEqual(snapshot.work.roots.find(root => root.id === 'drive-search-container').controls.map(control => control.value), ['blue point', 'F1']);
        const search = document.getElementById('drive-search');
        search.value = '';
        document.getElementById('view-drive').appendChild(document.getElementById('drive-search-container'));
        context.restoreAppUpdateHeaderSearch(snapshot.work);
        assert.equal(search.value, 'blue point');
        search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        assert.equal(context.isAppUpdateSnapshotCurrent(receipt), false);
    } finally { dom.window.close(); }
});

test('a photo upload and an unsupported editing dialog still block checkpointing', async () => {
    const { dom, context, document } = browseCheckpointFixture();
    try {
        vm.runInContext("pendingPhotoUploads.set('photo', true)", context);
        assert.equal((await context.saveWorkStateBeforeAppUpdate()).reason, 'photo-upload');
        vm.runInContext('pendingPhotoUploads.clear()', context);
        document.body.insertAdjacentHTML('beforeend', '<div id="new-write-modal" role="dialog"><textarea>Unsaved note</textarea></div>');
        assert.equal((await context.saveWorkStateBeforeAppUpdate()).reason, 'unsupported-modal-draft');
    } finally { dom.window.close(); }
});

test('sync-status POSTs permit checkpointing while relay and ERP writes remain busy', () => {
    const dom = new JSDOM('', { url: 'https://agmetricapp.com', runScripts: 'outside-only' });
    try {
        const root = dom.window;
        root.fetch = () => new Promise(() => {});
        vm.runInContext(appAsset('app-lifecycle'), dom.getInternalVMContext());
        const post = payload => root.fetch('https://kzrnyjsosryejjejliii.supabase.co/functions/v1/app-api',
            { method: 'POST', body: JSON.stringify(payload) });
        void post({ action: 'manual_sync_status' });
        void post({ action: 'erp_sync', operation: 'status', autoRelay: false });
        assert.equal(root.GncLiveUpdateNetwork.pendingWrites, 0);
        void post({ action: 'erp_sync', operation: 'status' });
        void post({ action: 'erp_sync', operation: 'continue', autoRelay: false });
        assert.equal(root.GncLiveUpdateNetwork.pendingWrites, 2);
    } finally { dom.window.close(); }
});
