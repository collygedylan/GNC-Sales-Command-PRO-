import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { startReleaseTestServer } from '../../scripts/serve-release-tests.mjs';
import { installHlOrderFixture } from '../../tests/fixtures/hl-order-state.mjs';

async function openRequestFixture(page) {
    await page.evaluate(() => {
        const row = { ...fullInventory[0], UNIQUE_ID: 'request-ui-fixture', DOM_ID: 'request-ui-fixture',
            SOURCE_TABLE: ACTIVE_REQUEST_TABLE, REQ_STATUS: 'Pending', REQ_QTY: '12', REQ_RESERVE: 'YES',
            REQ_CUSTOMER: 'Fixture Customer', REQUESTED_BY: 'dylan_collyge', REQ_DESIRED_SPEC: '24–30 inches',
            REQ_DESIRED_CALIPER: '2 inches', REQ_COMMENTS: 'Keep together', REQUEST_FOLDER: 'UI fixture' };
        requestsInventory = [row];
        activeReqTab = 'pending';
        switchView('request');
        document.getElementById('request-content').innerHTML = generateCard(row, 'request');
    });
    await page.locator('#request-content [data-request-uid="request-ui-fixture"]').click({ timeout: 5000 });
    await page.locator('#request-summary-dialog[open]').waitFor();
}

async function verifyRequest(page, evidence, width) {
    await openRequestFixture(page);
    const dialog = page.locator('#request-summary-dialog');
    for (const label of ['Sales Rep', 'Customer / Consignee', 'Required Spec', 'Required Caliper', 'Request Folder', 'Open Stock']) {
        assert.ok((await dialog.textContent()).includes(label), `Missing ${label}`);
    }
    await page.screenshot({ timeout: 5000, animations: 'disabled', path: path.join(evidence, `v3.0.50-request-popup-${width}.png`) });
    await dialog.getByRole('button', { name: 'Got It / Start Evaluation' }).click();
    await page.locator('#req-spec').waitFor({ state: 'visible' });
    await page.locator('#req-spec').focus();
    await page.evaluate(() => renderRequestDetailInfo(activeItem, 'request'));
    assert.equal(await dialog.evaluate(node => node.open), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'req-spec');
    const measures = await page.evaluate(() => {
        const scroll = document.getElementById('main-scroll-area');
        scroll.scrollTop = scroll.scrollHeight;
        const bar = document.getElementById('request-detail-info');
        return { top: bar.getBoundingClientRect().top, scrollTop: scroll.scrollTop,
            viewportTop: scroll.getBoundingClientRect().top, scrollBorder: scroll.clientTop, padding: getComputedStyle(scroll).paddingTop,  position: getComputedStyle(bar).position, stickyTop: getComputedStyle(bar).top, margin: getComputedStyle(bar).margin, scroller: scroll.getAttribute('style'),
            height: bar.getBoundingClientRect().height, ancestors: [bar.parentElement, bar.parentElement.parentElement, bar.parentElement.parentElement.parentElement].map(n => ({id:n.id, height:n.getBoundingClientRect().height, overflow:getComputedStyle(n).overflow, display:getComputedStyle(n).display, position:getComputedStyle(n).position,top:n.getBoundingClientRect().top,padding:getComputedStyle(n).padding,transform:getComputedStyle(n).transform,contain:getComputedStyle(n).contain})) };
    });
    assert.equal(measures.position, 'sticky');
    assert.ok(measures.scrollTop > 50, JSON.stringify(measures));
    assert.ok(Math.abs(measures.top - measures.viewportTop) <= 2, JSON.stringify(measures));
    await page.screenshot({ timeout: 5000, animations: 'disabled', path: path.join(evidence, `v3.0.50-request-sticky-${width}.png`) });
    await page.getByRole('button', { name: 'ℹ️ Full Info', exact: true }).click();
    assert.equal(await dialog.evaluate(node => node.open), true);
    await page.evaluate(() => renderRequestDetailInfo(activeItem, 'request'));
    assert.equal(await dialog.evaluate(node => node.open), true);
    await page.keyboard.press('Escape');
    assert.equal(await dialog.evaluate(node => node.open), false);
    await page.getByRole('button', { name: 'ℹ️ Full Info', exact: true }).click();
    await page.evaluate(() => handleNativeAppBack(new PopStateEvent('popstate')));
    await page.waitForFunction(() => !document.getElementById('request-summary-dialog').open);
    assert.equal(await page.evaluate(() => getCurrentVisibleViewId()), 'detail');
    await page.getByRole('button', { name: 'ℹ️ Full Info', exact: true }).click();
    await page.evaluate(() => showOnlyPrimaryView('request'));
    assert.equal(await dialog.evaluate(node => node.open), false);
    return measures;
}

async function verifyAv(page) {
    await page.evaluate(() => {
        switchView('av');
        const row = fullInventory[0];
        document.getElementById('av-content').innerHTML = generateCard(row, 'av');
    });
    await page.locator('#av-content .app-av-catalog-card').first().click();
    await page.locator('#view-detail.detail-av-readonly').waitFor();
    const result = await page.evaluate(() => ({
        tab: activeDetailTab, edit: canEditRowDetails('lsn-'), remove: canRemoveProtectedPhoto('lsn-'),
        tabs: getVisibleMobileDetailTabs().map(tab => tab.tab),
        mutations: [...document.querySelectorAll('#view-detail input[type=file], #view-detail [id$="-btn-save-complete"], #view-detail #lsn-spec, #view-detail #lsn-match, #view-detail #lsn-av-note, #view-detail #detail-shared-panels')]
            .filter(node => node.getClientRects().length && getComputedStyle(node).display !== 'none').map(node => node.id)
    }));
    assert.equal(result.tab, 'overview');
    assert.equal(result.edit, false);
    assert.equal(result.remove, false);
    assert.equal(await page.evaluate(() => saveData(true, 'lsn-')), false);
    assert.equal(await page.evaluate(() => canEditRowDetails('lsn-', fullInventory[0])), true);
    assert.deepEqual(result.tabs.sort(), ['gallery', 'overview']);
    assert.deepEqual(result.mutations, []);
    await page.evaluate(() => switchDetailTab('gallery'));
    assert.equal(await page.evaluate(() => activeDetailTab), 'gallery');
    await page.evaluate(() => { switchView('drive'); openDetail(fullInventory[0].UNIQUE_ID, 'drive'); });
    assert.equal(await page.evaluate(() => canEditRowDetails('lsn-')), true);
    assert.equal(await page.locator('#view-detail').evaluate(node => node.classList.contains('detail-av-readonly')), false);
    return result;
}

async function run() {
    const evidence = 'G:/My Drive/GNC/AgData/Release Evidence';
    const siteDir = path.resolve(process.argv[2] || '.');
    const server = await startReleaseTestServer({ siteDir, port: 0 });
    const origin = `http://127.0.0.1:${server.address().port}`;
    process.stdout.write('Starting Edge fixture\n');
    const browser = await chromium.launch({ channel: 'msedge', headless: true, timeout: 15000 });
    const results = [];
    try {
        for (const width of [390, 1280]) {
            const page = await browser.newPage({ viewport: { width, height: 850 }, serviceWorkers: 'block' });
            process.stdout.write(`Checking ${width}px\n`);
            await installHlOrderFixture(page, origin, { role: 'SUPER ADMIN', appPermissions: ['drive', 'av', 'request'].map(moduleKey => ({ permissionKey: `module.${moduleKey}.view`, kind: 'module', moduleKey, allowed: true })) });
            await page.waitForFunction(() => typeof fullInventory !== 'undefined' && fullInventory.length > 0);
            results.push({ width, request: await verifyRequest(page, evidence, width), av: await verifyAv(page) });
            await page.close();
        }
        await fs.writeFile(path.join(evidence, 'v3.0.50-request-av-edge.json'), JSON.stringify({ browser: browser.version(), siteDir, results }, null, 2));
        process.stdout.write(JSON.stringify({ pass: true, browser: 'Microsoft Edge', results }));
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

await run();
