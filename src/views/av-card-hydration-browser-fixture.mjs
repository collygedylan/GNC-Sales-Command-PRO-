import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { startReleaseTestServer } from '../../scripts/serve-release-tests.mjs';
import { installHlOrderFixture } from '../../tests/fixtures/hl-order-state.mjs';

const evidence = 'G:/My Drive/GNC/AgData/Release Evidence';
const pixel = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="green"/></svg>';

function physicalFixtureRow(row, schema) {
    const values = Object.fromEntries(Object.entries(row).map(([key,value]) => [key.toLowerCase(),value]));
    return Object.fromEntries(schema.filter(column => values[column.name] != null).map(({name,type}) => {
        const value = values[name];
        return [name, type === 'numeric' ? Number(value) : typeof value === 'object' ? JSON.stringify(value) : String(value)];
    }));
}

async function seedAvSearch(page, rows) {
    const result = await page.evaluate(rows => {
        fullInventory = rows;
        avOpenInventory = rows;
        rememberWarmAvInventoryRows(fullInventory);
        rememberWarmAvInventoryRows(avOpenInventory);
        rebuildMasterInventoryIndexes();
        appSeasonSettingsCache = { seasonCode:'F1', salesYear:27 };
        activeAVTab = 'open';
        activeAvSalesBucket = 'current';
        activeAvPhotoMode = 'all';
        selectedAvSeasons.clear();
        selectedAvSeasons.add('F1');
        document.getElementById('av-search').value = 'Dragon Baby';
        invalidateResolvedViewStateCaches();
        markViewDirty('av');
        const startingView = getCurrentVisibleViewId();
        switchView('av', { force:true });
        const host = document.getElementById('av-content');
        return { startingView, warm:canRenderWarmAvInventory(), ready:!!host.querySelector('.app-av-catalog-card'),
            loading:!!host.querySelector('.skeleton') || /Loading (data|latest AV|AV inventory)/i.test(host.innerText),
            view:getCurrentVisibleViewId() };
    }, rows);
    assert.notEqual(result.startingView, 'av');
    assert.deepEqual({ ...result, startingView:undefined }, { startingView:undefined, warm:true, ready:true, loading:false, view:'av' });
}

async function verifyAvSearch(page) {
    const card = page.locator('#av-content .app-av-catalog-card').filter({ hasText:'Location E.07.000 · 27.F1' });
    await card.first().waitFor({ timeout: 6000 });
    assert.equal(await card.count(), 1);
    const result = await page.evaluate(() => {
        const rows = getCurrentAVBaseItems().items.filter(row => row.ITEMCODE === '010620.021.1'
            && row.LOCATIONCODE === 'E.07.000' && row.LOTCODE === '27.F1');
        return { count:rows.length, onHand:rows[0]?.PTRONHAND, match:getDisplayLocMatchQtyValue(rows[0], 'av'),
            photos:getAvRowPhotoUrls(rows[0]).length, spec:rows[0]?.SPEC, avNote:rows[0]?.AV_NOTE };
    });
    assert.deepEqual(result, { count:1, onHand:48, match:'31', photos:2, spec:'20-22" H', avNote:'SPEC - 20-22" H' });
    assert.match(await card.textContent(), /On Hand\s*48/i);
    assert.match(await card.textContent(), /Loc Photo Match\s*31/i);
    assert.match(await card.textContent(), /1\/2/);
    assert.match(await card.textContent(), /Spec\s*20-22" H/i);
    assert.match(await card.textContent(), /AV Note\s*SPEC - 20-22" H/i);
    const hero = card.locator('.app-av-photo-slide img');
    await hero.waitFor({ timeout: 6000 });
    assert.equal(await hero.getAttribute('loading'), 'lazy');
    assert.equal(await hero.getAttribute('decoding'), 'async');
    await hero.evaluate(image => image.decode());
    assert.equal(await hero.evaluate(image => image.naturalWidth), 4);
    return result;
}

async function verifyAvKiosk(page) {
    const card = page.locator('#av-content .app-av-catalog-card').filter({ hasText:'Dragon Baby' }).first();
    const toggle = page.getByRole('button', { name:/kiosk mode/i });
    await toggle.click({ timeout:3000 });
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    await card.and(page.locator('[aria-label="Open card photos"]')).waitFor({ timeout:3000 });
    assert.equal(await card.locator('.app-av-catalog-meta, .card-checkbox, .app-av-primary-action, .app-av-catalog-hold-data').count(), 0);
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    await card.locator('.app-av-catalog-meta').waitFor({ state:'attached', timeout:3000 });
}

async function run() {
    const siteDir = path.resolve(process.argv[2] || '_site');
    const rows = JSON.parse(await fs.readFile(path.join(evidence, 'v3.0.52-live-row-baseline.json'), 'utf8'));
    const {schema} = JSON.parse(await fs.readFile(new URL('../../tests/fixtures/inventory-list-schema.json', import.meta.url), 'utf8'));
    const server = await startReleaseTestServer({ siteDir, port: 0 });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ channel:'msedge', headless:true, timeout:15000 });
    try {
        const page = await browser.newPage({ viewport:{ width:390,height:850 }, serviceWorkers:'block' });
        const reads = rows.map(row => physicalFixtureRow(row, schema));
        await installHlOrderFixture(page, origin, { role:'SUPER ADMIN', master:reads,
            appPermissions:['drive','av'].map(moduleKey => ({permissionKey:`module.${moduleKey}.view`,kind:'module',moduleKey,allowed:true})) });
        const photos = new Set(rows.flatMap(row => String(row.PHOTO_LINK || '').split(',').filter(Boolean))
            .map(value => new URL(value.trim()).pathname));
        await page.route('**/storage/v1/object/public/**', route => {
            const request = route.request();
            const pathname = new URL(request.url()).pathname;
            if (pathname.includes('/_thumbs/')) return route.fulfill({status:404});
            if (request.method() !== 'GET' || !photos.has(pathname)) return route.fallback();
            return route.fulfill({contentType:'image/svg+xml',body:pixel});
        });
        await seedAvSearch(page, rows);
        const result = await verifyAvSearch(page);
        await verifyAvKiosk(page);
        await fs.writeFile(path.join(evidence, 'v3.0.52-av-canonical-edge.json'), JSON.stringify({ browser:browser.version(), result }, null, 2));
        process.stdout.write(JSON.stringify({ pass:true, result }) + '\n');
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

await run();
