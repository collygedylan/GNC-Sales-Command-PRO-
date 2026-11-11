import assert from 'node:assert/strict';
import test from 'node:test';
import {openAssignedBrowser} from './helpers/assigned-items-first-open-browser.mjs';
import {assertActiveExcelDownload} from './helpers/excel-download-browser.mjs';

function installFixture() {
    resetProductionLiveSync();
    currentUser = 'dylan_collyge';
    currentUserDisplay = 'Dylan Collyge';
    currentRole = 'Manager';
    activeHomeTab = 'dashboard';
    canAccessView = () => true;
    getCurrentVisibleViewId = () => 'managers';
    isViewVisible = view => view === 'managers';
    window.GncMobileWorkspace.syncHub = () => {};
    getManagersToolAccess = () => ({canViewTableManagement:true});
    const records = Array.from({length:32}, (_, index) => ({
        id:32 - index, commonname:index % 2 ? 'Baby Gem Boxwood' : 'Holly', contsize:'3DP',
        locationcode:'D.28.000', lotcode:'26.U1', action_type:'Move Up', status:'open',
        source_file_name:'DylanDriveAround.xlsx', created_at:'2026-11-11T12:49:45Z',
        app_update_action:{summary:'Move Up 50 to 27.F1'}, app_update_row:{available:50},
        report_update_row:{available:49}, discrepancy_diff:[{field:'available',delta:-1}],
        learned_rule:{sample_count:1, auto_apply_enabled:false}
    }));
    postAppFunctionJson = async (_url, query) => {
        if (query.table !== 'action-discrepancy') return {ok:true, data:{}};
        if (query.operation === 'read') return {ok:true,data:{rows:structuredClone(records),next_before_id:null}};
        const row = records.find(entry => entry.id === query.payload.id);
        row.status = query.operation === 'teach' ? 'learned' : 'reviewed';
        return {ok:true,data:{row:structuredClone(row)}};
    };
    document.querySelectorAll('#view-wrapper > [id^="view-"]').forEach(view => view.classList.toggle('hidden', view.id !== 'view-managers'));
    document.getElementById('view-login').style.display = 'none';
    document.getElementById('app-wrapper').classList.remove('hidden');
    document.getElementById('app-wrapper').style.display = 'flex';
    renderManagers();
}

async function measureOpen(page, selector) {
    return page.evaluate(async selector => {
        const start = performance.now();
        document.querySelector(selector).click();
        await new Promise(resolve => {
            const observeRows = () => document.querySelector('tr[data-id]') && resolve();
            const observer = new MutationObserver(observeRows);
            observer.observe(document.getElementById('managers-content'), {childList:true, subtree:true});
            observeRows();
            window.fixtureRowObserver = observer;
        });
        window.fixtureRowObserver.disconnect();
        return performance.now() - start;
    }, selector);
}

test('both Manager entries show discrepancies and export the entire filtered Excel table', {timeout:45000}, async t => {
    const fixture = await openAssignedBrowser();
    const {page} = fixture;
    try {
        await page.evaluate(code => window.eval('(' + code + ')()'), installFixture.toString());
        const direct = await measureOpen(page, '[data-manager-module="action-discrepancy"]');
        await page.locator('[data-table-all]').click();
        const directory = await measureOpen(page, '[data-manager-table-card="action-discrepancy"]');
        t.diagnostic('First populated row, fixture transport: Manager ' + direct.toFixed(1) + ' ms, directory ' + directory.toFixed(1) + ' ms');
        assert.ok(Math.max(direct, directory) < 100);
        assert.equal(await page.locator('tr[data-id]').count(), 25);
        const complete = await assertActiveExcelDownload(page, 32, 'Date / Report File');
        assert.ok(complete.every(row => row.includes('DylanDriveAround.xlsx')));
        await page.locator('[data-query]').fill('Baby Gem');
        const filtered = await assertActiveExcelDownload(page, 16, 'Date / Report File');
        assert.ok(filtered.every(row => row.includes('Boxwood')));
        await page.locator('[data-command="teach"]').first().click();
        await page.locator('[data-status]').selectOption('learned');
        await page.locator('tr[data-id]').first().waitFor({state:'visible',timeout:3000});
        assert.equal(await page.locator('tr[data-id]').count(), 1, await page.locator('[data-message]').textContent());
    } finally { await fixture.close(); }
});
