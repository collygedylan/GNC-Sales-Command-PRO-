import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { functionSource } from '../../tests/helpers/golden-test-environment.mjs';

function source(file) {
    return readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
}

async function installFunctions(page, names) {
    const content = names.map(name => functionSource('assets/app-runtime.js', name)).join('\n');
    await page.addScriptTag({ content });
}

function evalFixtureGlobals() {
    const rows = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').flatMap(block => [
        { UNIQUE_ID: block + 'y', ITEMCODE: block + 'Y', SEASON: 'Y', LOTCODE: '26.Y', SALEYEAR: 26,
            COMMONNAME: block + ' Audit', LOCATIONCODE: block + '.01.000', BLOCKALPHA: block, PTRONHAND: 3, LISTPRICE: 4 },
        { UNIQUE_ID: block + 'f', ITEMCODE: block + 'L', SEASON: 'F1', LOTCODE: '27.F1', SALEYEAR: 27, S_LTS: 1,
            COMMONNAME: block + ' Low', LOCATIONCODE: block + '.01.000', BLOCKALPHA: block, PTRONHAND: 2, LISTPRICE: 5 },
        { UNIQUE_ID: block + 's', ITEMCODE: block + 'L', SEASON: 'S1', LOTCODE: '27.S1', SALEYEAR: 27,
            COMMONNAME: block + ' Low', LOCATIONCODE: block + '.02.000', BLOCKALPHA: block, PTRONHAND: 7, LISTPRICE: 5 },
    ]);
    const audit = { modes: { eval: 'legacy', drive: 'legacy' }, rows: [], audits: {}, pending: {}, sort: 'locationcode', direction: 1 };
    Object.assign(window, {
        fullInventory: rows, getManagerEvalReports2Api: () => window.GncEvalReports,
        getManagerEvalReport2ItemCode: row => row.ITEMCODE, getManagerEvalReport2RowKey: row => row.UNIQUE_ID,
        resolveCanonicalInventoryRow: row => row, getSupabaseReadIdentityScope: () => 'account',
        appAccessSnapshotState: { snapshot: {} }, productionDisplayMasterReceipt: null, getDatasetState: () => ({}),
        getManagerAssignedColumnState: () => ({}), isDatasetLoaded: () => false, resolvedViewStateEpoch: 0,
        getManagerEvalReport2CacheKeyValue: () => 'snapshot', getConfiguredCurrentSeasonCode: () => 'F1',
        getConfiguredCurrentSalesYearCode: () => 27, getConfiguredNextSaleSeasonTarget: () => ({ season: 'S1', salesYear: 27 }),
        managerEvalReportSettings: { lowStockMaxSLts: 150 }, canViewManagerEvalReports2: () => true,
        ensureDatasetLoaded: () => new Promise(() => {}), getCurrentVisibleViewId: () => 'managers',
        activeHomeTab: 'eval2', MANAGER_EVAL_REPORTS_2_VIEW: 'eval2', escapeHtml: htmlEscape, escJsAttrValue: String,
        fieldAuditState: () => audit, getDriveBlockNumberLabel: String, getDriveBlockAlphaLabel: String,
        fieldAuditTable: reportRows => reportRows.map(row => '<button data-inventory-row>' + row.locationcode + '</button>').join(''),
        rememberManagerEvalReport2DrillScroll() {}, queueScrollMainAreaToTop() {}, updateGlobalBackButton() {},
        managerEvalReport2DetailItemKey: '', managerEvalReport2BrowseMode: 'location', managerEvalReport2DrillLevel: 0,
        setManagerEvalReport2Reports: () => true, clearManagerEvalReport2Filters() {}, setManagerEvalReport2BrowseMode() {},
        managerEvalReport2SelectedBlockAlpha: '', managerEvalReport2SelectedLocationCode: '',
        paintFieldAuditReport: () => repaintReport(), renderManagers: () => repaintReport(),
        refreshManagerEvalReport2BrowseRegion: () => repaintReport(),
    });
    function htmlEscape(value) {
        const node = document.createElement('span');
        node.textContent = value;
        return node.innerHTML;
    }
    function repaintReport() {
        const host = document.getElementById('fixture');
        if (window.isEvalAggregateDashboardVisible()) host.innerHTML = window.renderEvalAggregateDashboard();
        else if (audit.modes.eval === 'audit') {
            window.syncEvalOverviewAuditRows();
            host.innerHTML = window.fieldAuditBody();
        } else host.innerHTML = window.fixtureEvalBrowse();
    }
}

function evalFixtureBrowse() {
    const columns = ['unique_id', 'itemcode', 'locationcode', 'blockalpha', 'reportIds'];
    const metadata = { browseColumns: columns, browseRows: window.fullInventory
        .filter(row => row.SEASON === 'S1').map(row => [row.UNIQUE_ID, row.ITEMCODE, row.LOCATIONCODE, row.BLOCKALPHA, ['low-stock']]) };
    const level = window.managerEvalReport2DrillLevel;
    const groupBy = ['blockalpha', 'locationcode', 'itemcode'][level];
    const blockalpha = window.managerEvalReport2SelectedBlockAlpha;
    const filters = { reportIds: ['low-stock'], blockalpha, drillLocation: window.managerEvalReport2SelectedLocationCode, groupBy };
    const groups = window.GncEvalReports.buildBrowsePage(metadata, { surface: 'eval2', operation: 'groups', limit: 40, filters }, 'fixture').rows;
    const controls = level === 1 ? window.renderEvalReport2BlockRowsButton(blockalpha) : '';
    return controls + groups.map(group => level === 2 ? '<button data-inventory-row>' + group.locationcode + '</button>'
        : window.renderManagerEvalReport2DrillGroupCard({ ...group, kind: groupBy })).join('');
}

async function assertEvalDrill(page, reportId, location) {
    await page.locator(`[data-eval-aggregate-report="${reportId}"] button`).click();
    for (const [index, block] of Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ').entries()) {
        const card = page.locator(`[data-manager-eval2-drill-kind="blockalpha"][data-manager-eval2-drill-value="${block}"]`);
        if (index % 2) await card.press('Space');
        else await card.click();
        const target = block + location;
        await page.locator(`[data-manager-eval2-drill-value="${target}"]`).press('Enter');
        assert.equal(await page.locator('[data-inventory-row]').textContent(), target);
        await page.evaluate(() => window.fixtureBack());
        await page.getByRole('button', { name: 'View All Block Rows' }).click();
        assert.equal(await page.locator('[data-inventory-row]').textContent(), target);
        await page.evaluate(() => { window.fixtureBack(); window.fixtureBack(); });
    }
    await page.evaluate(() => window.fixtureBack());
}

async function assertBloomEmailHandoff(page) {
    await installFunctions(page, ['shareBloomPurposeEmail']);
    await page.evaluate(async () => {
        Object.assign(window, {
            buildBloomPurposeEmailSubject: () => 'Fixture', dedupeRequestEmailRecipients: values => values,
            isBloomEmailPurposeRecipientRequired: () => false, buildBloomPurposeEmailText: () => 'Fixture',
            copyTextWithFallback: async () => {}, handleMobileShare: async () => true,
        });
        await window.shareBloomPurposeEmail([window.fixtureCartRow]);
    });
    assert.deepEqual(await page.evaluate(() => Array.from(window.selectedItems)), ['fi_0']);
}

export async function verifyEvalBrowser(page) {
    await page.setContent('<main id="fixture"></main>');
    await page.evaluate(evalFixtureGlobals);
    await page.addScriptTag({ content: 'window.fixtureEvalBrowse = ' + evalFixtureBrowse.toString() });
    await page.addScriptTag({ content: source('assets/eval-reports-engine.js') });
    await page.addScriptTag({ content: source('assets/eval-report2-controls.js') });
    await page.addScriptTag({ content: source('assets/eval-report2-overview.js') });
    await installFunctions(page, ['fieldAuditNumber', 'fieldAuditYear', 'fieldAuditNormalizeRow', 'fieldAuditMatchingRows',
        'fieldAuditMetrics', 'fieldAuditMoney', 'fieldAuditProgress', 'fieldAuditRows', 'fieldAuditDrill', 'fieldAuditBack', 'fieldAuditBody',
        'renderFieldAuditReportDrillGroup']);
    const timings = await page.evaluate(() => {
        window.bindEvalReport2DrillCommands(document.querySelector('main'));
        window.fixtureBack = () => {
            if (window.backEvalAggregateDashboard()) return;
            window.managerEvalReport2DrillLevel--;
            window.managerEvalReport2SelectedLocationCode = '';
            if (!window.managerEvalReport2DrillLevel) window.managerEvalReport2SelectedBlockAlpha = '';
            window.renderManagers();
        };
        const start = performance.now();
        window.renderManagers();
        const elapsed = performance.now() - start;
        const card = document.querySelector('[data-eval-aggregate-report="field-audit"]');
        const units = card.querySelector('[data-eval-aggregate-units]').textContent;
        window.fullInventory.push({ ...window.fullInventory[0], UNIQUE_ID: 'new', PTRONHAND: 4 });
        window.renderManagers();
        return { elapsed, units, total: document.querySelector('[data-eval-aggregate-report="field-audit"] [data-eval-aggregate-units]').textContent };
    });
    assert.equal(timings.units, '78');
    assert.equal(timings.total, '82');
    assert.equal(await page.locator('[data-eval-aggregate-report]').count(), 12);
    assert.equal(await page.locator('[data-eval-aggregate-report="field-audit"] [data-eval-aggregate-value]').textContent(), '$328.00');
    assert.equal(await page.locator('[data-eval-aggregate-report="low-stock"] [data-eval-aggregate-value]').textContent(), '$910.00');
    await assertEvalDrill(page, 'low-stock', '.02.000');
    await page.evaluate(() => { window.fullInventory.pop(); window.renderManagers(); });
    await assertEvalDrill(page, 'field-audit', '.01.000');
    return timings.elapsed;
}

function installCartGlobals() {
    const row = { DOM_ID: 'fi_0', UNIQUE_ID: 'plant-id' };
    Object.assign(window, {
        currentUser: 'alice', nativeAuthProfile: { id: 'alice' }, canAccessView: () => true,
        hasAuthenticatedOperationalReadIdentity: () => true, getSupabaseReadIdentityScope: () => window.currentUser,
        masterInventoryById: new Map([[row.UNIQUE_ID, row]]), selectedItems: new Set(), selectedItemSources: new Map(),
        requestSelectionTokens: new Map(), findItemByDomId: id => id === row.DOM_ID ? row : null,
        findItemByUniqueId: id => id === row.UNIQUE_ID ? row : null, getItemUniqueId: item => item?.UNIQUE_ID || '',
        canUseCartInventoryActions: ([item]) => !!item, canAddItemToBloomPicker: item => !!item,
        createStableClientBatchId: () => 'batch', scheduleCartUiRefresh() {}, refreshCartButtons() {},
        updateGlobalActionBar() {}, syncDriveReturnedSelectionToolbar() {}, showToast() {},
        isMultiSelectMode: false, cartPanelOpen: true, bloomPickerActionsOpen: false, bloomShareMenuOpen: false,
        isCurrentDriveCardOptionsContext: () => false, getRoleAccessState: () => ({}),
        cartUiObserver: null, fixtureCartRow: row,
    });
}

async function installCartFixture(page) {
    await page.evaluate(installCartGlobals);
    await page.addScriptTag({ content: source('assets/bloom-cart-persistence.js') });
    await page.addScriptTag({ content: source('assets/bloom-cart-actions.js') });
    await page.evaluate(() => window.initializeCartUi());
}

export async function verifyBloomCartBrowser(page) {
    await page.route('https://bloom-fixture.test/**', route => route.fulfill({ contentType: 'text/html', body: '<main></main>' }));
    await page.goto('https://bloom-fixture.test/');
    await installCartFixture(page);
    await page.evaluate(() => window.toggleGlobalItem('fi_0', true, 'av'));
    await assertBloomEmailHandoff(page);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('agdata.bloom-cart.v1:alice') === localStorage.getItem('agdata.bloom-cart.v1:alice')), true);
    await page.reload();
    await installCartFixture(page);
    const resumed = await page.evaluate(() => {
        window.clearSelection();
        window.fixtureCartRow.DOM_ID = 'fi_27';
        document.dispatchEvent(new Event('visibilitychange'));
        return Array.from(window.selectedItems);
    });
    assert.deepEqual(resumed, ['fi_27']);
    await page.evaluate(() => window.toggleGlobalItem('fi_27', false));
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('agdata.bloom-cart.v1:alice')).rows.length), 0);
    await page.evaluate(() => window.toggleGlobalItem('fi_27', true, 'av'));
    const accountSwitch = await page.evaluate(() => {
        window.currentUser = 'bob';
        window.nativeAuthProfile.id = 'bob';
        window.restoreBloomCartSelection();
        return Array.from(window.selectedItems);
    });
    assert.deepEqual(accountSwitch, []);
    await page.evaluate(() => {
        window.currentUser = 'alice';
        window.nativeAuthProfile.id = 'alice';
        window.restoreBloomCartSelection();
        window.clearBloomPickerSelection();
        window.restoreBloomCartSelection();
    });
    assert.deepEqual(await page.evaluate(() => Array.from(window.selectedItems)), []);
}

function projectFixtureGlobals() {
    Object.assign(window, { bloomInventoryProjectDraft: null, getSupabaseReadIdentityScope: () => 'account',
        fullInventory: [], masterInventory: [], queueInventoryProjectsLoad: null, isRepReadOnlyUser: () => false,
        ensureQueueInventoryProjectsScope() {}, buildBloomProjectSummary: () => '<p>Fixture row</p>', esc: String,
        renderBloomProjectSavedVariables() {}, setBloomProjectPickerOptions() {}, getAllRequestModalRepOptions: () => [],
        getAssignableAppUserOptions: () => [], ensureRequestRepUserOptionsReady: async () => [], ensureAssignableAppUsers: async () => [],
        ensureQueueInventoryProjectsData() {}, submitBloomInventoryProject: () => { window.submitted = true; },
    });
}

export async function verifyBloomProjectBrowser(page) {
    await page.route('https://project-fixture.test/**', route => route.fulfill({ contentType: 'text/html', body: '<main></main>' }));
    await page.goto('https://project-fixture.test/');
    await page.setViewportSize({ width: 390, height: 650 });
    await page.evaluate(projectFixtureGlobals);
    await page.addStyleTag({ content: source('assets/app-shell-style-16.css') });
    await page.addScriptTag({ content: source('assets/bloom-inventory-project.js') });
    await page.evaluate(() => window.openBloomInventoryProject([{ COMMONNAME: 'Fixture Tree', LOCATIONCODE: 'A.01.000', PTRONHAND: 14 }], () => {}));
    const modal = page.locator('#bloom-inventory-project-modal');
    const footer = modal.locator('footer');
    for (const preset of ['discard', 'hauling', 'maintenance', 'custom', 'grading']) {
        await modal.locator('[name=projectName]').fill('');
        await modal.locator(`[data-project-preset="${preset}"]`).press('Enter');
        assert.equal(await modal.locator('[data-project-preset][aria-pressed=true]').count(), 1);
        assert.ok(await modal.locator('[name=projectName]').inputValue());
        if (preset !== 'custom') assert.equal(await modal.locator(`[data-project-question="${preset}"]`).isVisible(), true);
    }
    await modal.locator('[name=projectName]').fill('User-entered name');
    await modal.locator('[data-project-preset=discard]').click();
    assert.equal(await modal.locator('[name=projectName]').inputValue(), 'User-entered name');
    assert.equal(await modal.locator('[name=task-grade-count]').isDisabled(), true);
    const position = await footer.evaluate(node => getComputedStyle(node).position);
    assert.equal(position, 'sticky');
    const before = await footer.boundingBox();
    await modal.locator('.project-builder-body').evaluate(node => { node.scrollTop = node.scrollHeight; });
    assert.deepEqual(await footer.boundingBox(), before);
    assert.ok(before.y + before.height <= 650);
    await modal.getByRole('button', { name: 'Create Project' }).click();
    assert.equal(await page.evaluate(() => window.submitted), true);
}

export async function verifyEvalBloomProjectBrowser() {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(4500);
        const elapsed = await verifyEvalBrowser(page);
        await verifyBloomCartBrowser(page);
        await verifyBloomProjectBrowser(page);
        return elapsed;
    } finally {
        await browser.close();
    }
}
