import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import {chromium} from 'playwright';
import {installHlOrderFixture} from './fixtures/hl-order-state.mjs';

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
}

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
