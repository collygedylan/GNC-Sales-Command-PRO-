import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import {chromium} from 'playwright';
import {hlMaster, installHlOrderFixture} from './fixtures/hl-order-state.mjs';

async function fixtureServer() {
    const root=path.resolve(process.env.GNC_QUE_SITE || '_site');
    const server=http.createServer((req,res)=>{
        try {
            let file=path.join(root,decodeURIComponent(new URL(req.url,'http://localhost').pathname));
            if (fs.statSync(file).isDirectory()) file=path.join(file,'index.html');
            const types={'.js':'application/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.woff2':'font/woff2'};
            res.setHeader('content-type',types[path.extname(file)] || 'application/octet-stream');
            res.end(fs.readFileSync(file));
        } catch {res.writeHead(404).end();}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    return server;
}

async function verifyMountedHeader(page,width) {
    await page.setViewportSize({width,height:width===390?844:915});
    const geometry=await page.evaluate(()=>{
        const rect=id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,display:getComputedStyle(e).display};};
        return {width:innerWidth,back:rect('global-header-inline-back'),search:rect('request-search'),view:rect('que-view-select'),
            owner:rect('request-suspend-tag-assigned-filter'),export:rect('global-excel-export'),
            bloom:rect('footer-cart-btn'),overflow:document.documentElement.scrollWidth-innerWidth};
    });
    assert.equal(geometry.overflow,0,JSON.stringify(geometry));
    assert.equal(geometry.bloom.display,'none');
    assert.ok(geometry.search.x>=geometry.back.right && geometry.search.width>200,JSON.stringify(geometry));
    assert.ok(geometry.view.y>=geometry.search.bottom,JSON.stringify(geometry));
    assert.ok(Math.abs(geometry.view.y-geometry.owner.y)<=2 && Math.abs(geometry.view.y-geometry.export.y)<=2,JSON.stringify(geometry));
    assert.ok(geometry.owner.right<=geometry.export.x && geometry.export.right<=width,JSON.stringify(geometry));
    return geometry;
}

async function installQueueRoutes(page) {
    await page.route('**/functions/v1/app-api',route=>{
        const body=route.request().postDataJSON();
        let data;
        if (body.action==='projects_read') data={projects:[],rows:[]};
        if (body.action==='bunch_note_workflow' && ['list_discrepancies','queue'].includes(body.operation)) data={rows:[],reviews:[],total:0,has_more:false};
        if (!data) return route.fallback();
        return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({ok:true,data})});
    });
    await page.route('**/rest/v1/rpc/read_reviewed_watchdog_events_v3074', route => {
        if (route.request().method() !== 'POST') return route.fallback();
        const body = route.request().postDataJSON();
        if (typeof body?.p_include_resolved !== 'boolean' || !Number.isInteger(body?.p_offset)) return route.fallback();
        return route.fulfill({ json: { ok: true, data: [], hasMore: false }, headers: { 'access-control-allow-origin': '*' } });
    });
}

function pendingQueueRows() {
    return Array.from({ length: 10 }, (_, index) => ({
        ...hlMaster('fixture-master-' + index),
        unique_id: 'REQ-fixture-' + index, master_id: 'fixture-master-' + index,
        req_status: 'Pending', req_qty: '12', request_folder: 'Que restoration',
        requested_by: 'another_user', date_completed: null, completed: false
    }));
}

async function installPendingQueueRead(page, rows) {
    await page.route(url => ['/rest/v1/ph_requests_pending', '/rest/v1/ph_active_request'].includes(url.pathname), route => {
        if (route.request().method() !== 'GET') return route.fallback();
        const url = new URL(route.request().url());
        const data = Number(url.searchParams.get('offset')) > 0 ? [] : rows;
        return route.fulfill({ json: data, headers: {
            'access-control-allow-origin': '*', 'content-range': data.length ? '0-9/10' : '*/10'
        } });
    });
    await page.route('**/functions/v1/app-api', route => {
        if (route.request().method() !== 'POST') return route.fallback();
        const body = route.request().postDataJSON();
        if (body?.action !== 'dataset_read' || !['request_queue', 'active_request'].includes(body.dataset)) return route.fallback();
        const { offset = 0, limit = rows.length } = body.params || {};
        const data = { rows: body.requestDeliveryStatus ? [] : rows.slice(offset, offset + limit),
            total: body.requestDeliveryStatus ? 0 : rows.length, offset, limit, hasMore: false };
        return route.fulfill({ json: { ok: true, data }, headers: { 'access-control-allow-origin': '*' } });
    });
}

async function assertPendingQueue(page, verified) {
    const request = page.getByRole('button', { name: 'Request (10)', exact: true });
    const suspend = page.getByRole('button', { name: /^Suspend \(\d+\)$/ });
    await request.waitFor({ state: 'visible', timeout: 5000 }).catch(async error => {
        const diagnostic = await page.evaluate(() => ({
            tab: activeReqTab, categories: getAuthorizedRequestCategories(), loaded: requestsInventory.length,
            counts: getActiveAssignedQueueCounts(), policy: queueAccessScope('pending'),
            visibleView: getCurrentVisibleViewId(), toolbar: document.getElementById('request-filter-toolbar').innerText,
            content: document.getElementById('request-content').innerText.slice(0, 200)
        }));
        throw new Error(JSON.stringify(diagnostic), { cause: error });
    });
    assert.ok(await suspend.isVisible());
    await page.waitForFunction(() => document.querySelectorAll('#request-content [data-request-uid]').length === 10);
    assert.equal(await request.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#que-view-select').inputValue(), 'pending');
    assert.equal(await page.locator('#request-eval-user-filter').inputValue(), 'ALL');
    assert.match(await page.locator('#request-eval-user-filter option:checked').innerText(), /^All Users\b/);
    assert.equal(await page.evaluate(() => resolveUserAccessMatrix()?.verified), verified);
    assert.doesNotMatch(await page.locator('#request-content').innerText(), /No pending requests/);
    const geometry = await page.evaluate(() => {
        const request = document.getElementById('tab-req-pending').getBoundingClientRect();
        const suspend = document.getElementById('tab-req-suspend-tag').getBoundingClientRect();
        return { sameRow: Math.abs(request.top - suspend.top) <= 1, adjacent: request.right <= suspend.left,
            fits: suspend.right <= innerWidth, watchdog: inspectWatchdogQueueControls(
                document.getElementById('request-filter-toolbar'), element => !!element.getClientRects().length) };
    });
    assert.deepEqual(geometry, { sameRow: true, adjacent: true, fits: true, watchdog: '' });
}

async function assertQuickCategorySwitch(page, tab) {
    const chip = page.locator('[data-request-category="' + tab + '"]');
    await chip.evaluate(node => {
        let start;
        const changes = new MutationObserver(() => {
            if (node.getAttribute('aria-pressed') !== 'true') return;
            changes.disconnect();
            document.documentElement.dataset.queueClickTime = String(performance.now() - start);
        });
        node.addEventListener('click', () => {
            start = performance.now();
            changes.observe(node, { attributes: true, attributeFilter: ['aria-pressed'] });
        }, { capture: true, once: true });
        document.documentElement.dataset.queueClickTime = '';
    });
    await chip.click();
    const elapsed = await page.evaluate(() => {
        const select = document.getElementById('que-view-select');
        const active = document.querySelector('[data-request-category][aria-pressed="true"]');
        return { tab: select.value, active: active?.dataset.requestCategory,
            ms: Number.parseFloat(document.documentElement.dataset.queueClickTime) };
    });
    assert.equal(elapsed.tab, tab);
    assert.equal(elapsed.active, tab);
    return elapsed.ms;
}

async function verifyColdPendingQueue(page, baseURL) {
    let verified = false;
    const rows = pendingQueueRows();
    const fixture = await installHlOrderFixture(page, baseURL, {
        role: 'super-admin', username: 'dylan_collyge', startupMode: 'cold',
        beforeNavigate: async () => {
            await installQueueRoutes(page);
            await installPendingQueueRead(page, rows);
            await page.route('**/rest/v1/user_access?**', route => route.fulfill({ json: verified ? [{
                username: 'dylan_collyge', role: 'super-admin', view_all_requests: 'Y', request_default_scope: 'OWN',
                view_permissions: { view_que_request: 'Y', view_que_suspend: 'Y' }
            }] : [], headers: { 'access-control-allow-origin': '*' } }));
        }
    });
    await page.evaluate(pendingRows => {
        processAndLoadData(buildDatasetPayload('requests', pendingRows));
        switchView('request');
    }, rows);
    await assertPendingQueue(page, false);
    verified = true;
    await page.evaluate(() => GncUserAccessControl.preloadAccessMatrix(true));
    await page.evaluate(() => renderRequest());
    await assertPendingQueue(page, true);
    const suspendMs = await assertQuickCategorySwitch(page, 'suspend-tag');
    const owner = page.locator('#request-suspend-tag-assigned-filter');
    await owner.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await owner.inputValue(), 'dylan_collyge');
    await owner.selectOption('ALL');
    assert.equal(await owner.inputValue(), 'ALL');
    const requestMs = await assertQuickCategorySwitch(page, 'pending');
    await assertPendingQueue(page, true);
    assert.deepEqual(fixture.blockedMutations, []);
    return { requestMs, suspendMs };
}

test('Dylan sees ten pending Requests and two one-tap categories before and after access verification', async t => {
    const server = await fixtureServer();
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const timings = await verifyColdPendingQueue(page, 'http://127.0.0.1:' + server.address().port);
        for (const ms of Object.values(timings)) assert.ok(Number.isFinite(ms) && ms < 50, JSON.stringify(timings));
        t.diagnostic(JSON.stringify(timings));
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});

test('full compiled Que mounts the shared search and all nine view commands without overflow',async t=>{
    const server=await fixtureServer(),browser=await chromium.launch({headless:true});
    try {
        const page=await browser.newPage({viewport:{width:390,height:844}});
        const errors=[];page.on('pageerror',error=>errors.push(error.message));
        const fixture=await installHlOrderFixture(page,'http://127.0.0.1:'+server.address().port,{role:'ADMIN',username:'dylan_collyge',
            appPermissions:['request','home','po-management'].map(moduleKey=>({permissionKey:'module.'+moduleKey+'.view',kind:'module',moduleKey,allowed:true})),
            beforeNavigate:async()=>{
                await installQueueRoutes(page);
                await page.route('**/rest/v1/user_access?**',route=>route.fulfill({status:200,contentType:'application/json',
                    headers:{'access-control-allow-origin':'*'},body:JSON.stringify([{username:'dylan_collyge',role:'Admin',
                        view_all_requests:'Y',view_all_suspend:'Y',view_permissions:{view_que_request:'Y',view_que_suspend:'Y'}}])}));
            }});
        await page.evaluate(()=>window.eval("switchView('request');setReqTab('suspend-tag')"));
        await page.locator('#request-suspend-tag-assigned-filter').waitFor({state:'visible',timeout:3000});
        const measurements=[];
        for (const width of [390,412]) measurements.push(await verifyMountedHeader(page,width));
        for (const tab of ['pending','suspend-tag','projects','moves','recount','shear-list','eval-work','bunch-notes','bunch-count-review']) {
            await page.locator('#que-view-select').selectOption(tab);
            assert.equal(await page.evaluate(()=>window.eval('activeReqTab')),tab);
            assert.equal(await page.locator('#request-search').isVisible(),true,tab);
        }
        await page.locator('#que-view-select').selectOption('suspend-tag');
        await page.locator('#request-suspend-tag-assigned-filter').waitFor({state:'visible'});
        measurements.push(await verifyMountedHeader(page,412));
        assert.deepEqual(errors,[]);
        assert.deepEqual(fixture.blockedMutations,[]);
        if (process.env.GNC_QUE_PROOF_DIRECTORY) {
            await page.screenshot({path:path.join(process.env.GNC_QUE_PROOF_DIRECTORY,'v3.0.74-que-full-fixture.png')});
            fs.writeFileSync(path.join(process.env.GNC_QUE_PROOF_DIRECTORY,'v3.0.74-que-full-header.json'),JSON.stringify({measurements,errors,blockedMutations:fixture.blockedMutations},null,2));
        }
        t.diagnostic('Both mobile widths and all nine actual setReqTab transitions passed.');
    } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
});
