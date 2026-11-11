import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

function installUpdateFixture() {
    window.__APP_SHELL_VERSION__ = '1.2.3';
    let revision = 0;
    window.addEventListener('input', () => revision++);
    window.withBootDeadline = work => work;
    window.getAppUpdateBusyState = () => ({busy:window.captureActive === true});
    window.saveWorkStateBeforeAppUpdate = async () => ({ok:true, snapshotId:String(revision)});
    window.isAppUpdateSnapshotCurrent = receipt => receipt.snapshotId === String(revision);
    window.commitAppUpdateSnapshotForReload = window.isAppUpdateSnapshotCurrent;
    const events = new EventTarget();
    const controller = {postMessage(message) {
        if (message.type !== 'GNC_GET_SHELL_VERSION') return;
        const reply = new Event('message');
        Object.assign(reply, {source:controller, data:{type:'GNC_SHELL_VERSION',build:'AgData v1.2.4'}});
        events.dispatchEvent(reply);
    }};
    events.controller = controller;
    events.register = async () => ({active:controller});
    Object.defineProperty(navigator, 'serviceWorker', {value:events});
}

async function checkEditingViews(page) {
    const checks = await page.evaluate(async () => {
        const routes = ['view-item-detail','view-request','view-suspend','view-drive','view-av'];
        const results = [];
        for (const route of routes) {
            location.hash = route;
            document.querySelector('input').value = route;
            document.querySelector('input').dispatchEvent(new Event('input', {bubbles:true}));
            navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
            window.dispatchEvent(new Event('agdata:update-work-settled'));
            window.dispatchEvent(new Event('online'));
            document.getElementById('agdata-live-update-pill').click();
            results.push(await window.GncLiveAppUpdate.requestApply('update-pill'));
        }
        return results;
    });
    assert.deepEqual(checks, [false,false,false,false,false]);
    assert.ok(page.url().endsWith('#view-av'));
}

export async function bannerUpdateContract() {
    const browser = await chromium.launch();
    try {
        const page = await browser.newPage();
        await page.route('https://update.test/**', route => {
            const manifest = route.request().url().includes('version.json');
            return route.fulfill({contentType:manifest ? 'application/json' : 'text/html',
                body:manifest ? '{"version":"1.2.4"}' : '<meta name="agdata-release" content="1.2.4"><input aria-label="SPEC">'});
        });
        await page.addInitScript(installUpdateFixture);
        await page.goto('https://update.test/#view-item-detail');
        await page.addScriptTag({path:fileURLToPath(new URL('../../assets/live-app-update.js',import.meta.url))});
        await page.evaluate(() => window.GncLiveAppUpdate.runtimeReady());
        const pill = page.getByRole('button',{name:'Update ready — tap to apply'});
        await pill.waitFor();
        await checkEditingViews(page);
        await page.evaluate(() => { window.captureActive = true; });
        await pill.click();
        assert.equal(await page.evaluate(() => window.GncLiveAppUpdate.requestApply()),false);
        assert.ok(page.url().endsWith('#view-av'));
        await page.evaluate(() => { window.captureActive = false; });
        await Promise.all([page.waitForURL(url => url.searchParams.get('v') === '1.2.4'),pill.click()]);
        assert.equal(new URL(page.url()).hash,'#view-av');
    } finally { await browser.close(); }
}
