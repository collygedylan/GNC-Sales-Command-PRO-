import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {browserWorkerUpgradeContract} from './pwa-shell-upgrade-contract.mjs';

function installUpdateFixture({from,target}) {
    window.__APP_SHELL_VERSION__ = from;
    let revision = 0;
    window.addEventListener('input', () => revision++);
    window.withBootDeadline = work => work;
    window.getAppUpdateBusyState = () => ({busy:window.captureActive === true});
    window.saveWorkStateBeforeAppUpdate = async () => ({ok:true, snapshotId:String(revision)});
    window.isAppUpdateSnapshotCurrent = receipt => receipt.snapshotId === String(revision);
    window.commitAppUpdateSnapshotForReload = window.isAppUpdateSnapshotCurrent;
    const events = new EventTarget();
    const waiting = {postMessage(message) {
        if (message.type === 'SKIP_WAITING') {
            sessionStorage.setItem('waiting-checkpoint',JSON.stringify(message));
            return;
        }
        if (message.type !== 'GNC_GET_SHELL_VERSION') return;
        const reply = new Event('message');
        Object.assign(reply, {source:waiting, data:{type:'GNC_SHELL_VERSION',build:'AgData v'+target}});
        events.dispatchEvent(reply);
    }};
    events.controller = null;
    events.register = async () => ({waiting});
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

async function verifySilentWorker(page, target, pill) {
    await page.evaluate(() => {
        window.captureActive = false;
        window.GncLiveAppUpdate.scheduleApply();
        const button = document.getElementById('agdata-live-update-pill');
        const labels = [];
        new MutationObserver(() => {
            labels.push(button.textContent);
            sessionStorage.setItem('update-labels',JSON.stringify(labels));
        }).observe(button,{childList:true,subtree:true,characterData:true});
    });
    const landed = page.waitForURL(url => url.searchParams.get('v') === target);
    await pill.click();
    await page.waitForFunction(v => document.getElementById('agdata-live-update-pill')?.textContent?.startsWith('Applying v'+v),target);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await landed;
    const applied = await page.evaluate(() => ({
        version:document.querySelector('meta[name="agdata-release"]').content,
        labels:JSON.parse(sessionStorage.getItem('update-labels')),
        message:JSON.parse(sessionStorage.getItem('waiting-checkpoint')),
    }));
    assert.equal(applied.version,target);
    assert.ok(applied.labels.length && applied.labels.every(text => text.startsWith('Applying v'+target)));
    assert.equal(applied.message.targetBuild,'AgData v'+target);
    assert.equal(applied.message.type,'SKIP_WAITING');
    assert.equal(new URL(page.url()).hash,'#view-av');
}

async function checkSilentWorker(browser, from, target) {
    const page = await browser.newPage();
    try {
        await page.route('https://update.test/**', route => {
            const url = new URL(route.request().url());
            const manifest = url.pathname.endsWith('version.json');
            const available = url.searchParams.get('verify') || url.searchParams.get('v') ? target : from;
            return route.fulfill({contentType:manifest ? 'application/json' : 'text/html',
                body:manifest ? JSON.stringify({version:target}) : '<meta name="agdata-release" content="'+available+'"><input aria-label="SPEC">'});
        });
        await page.addInitScript(installUpdateFixture,{from,target});
        await page.goto('https://update.test/#view-item-detail');
        await page.addScriptTag({path:fileURLToPath(new URL('../../assets/live-app-update.js',import.meta.url))});
        await page.evaluate(() => window.GncLiveAppUpdate.runtimeReady());
        const pill = page.locator('#agdata-live-update-pill');
        await pill.waitFor();
        assert.equal(await pill.innerText(),'Update v'+target+' ready — tap to apply');
        await checkEditingViews(page);
        await page.evaluate(() => { window.captureActive = true; });
        await pill.click();
        assert.equal(await page.evaluate(() => window.GncLiveAppUpdate.requestApply()),false);
        assert.ok(page.url().endsWith('#view-av'));
        await verifySilentWorker(page,target,pill);
    } finally { await page.close(); }
}

export async function bannerUpdateContract() {
    const target = JSON.parse(readFileSync(new URL('../../version.json',import.meta.url),'utf8')).version;
    const from = target.replace(/\d+$/,patch => String(Number(patch)-1));
    const systemChrome = '/usr/bin/google-chrome';
    const options = process.platform === 'linux' && existsSync(systemChrome) ? {executablePath:systemChrome} : {};
    const browser = await chromium.launch(options);
    try {
        await checkSilentWorker(browser,from,target);
        await browserWorkerUpgradeContract({browser});
        await browserWorkerUpgradeContract({browser,delayInstall:true});
    } finally { await browser.close(); }
}
