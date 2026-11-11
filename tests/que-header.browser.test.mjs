import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {chromium} from 'playwright';
import {createSuspendRoutingFixture,suspendRoutingFunctions,suspendRoutingSource} from './helpers/suspend-assigned-routing-contract.mjs';
import {extractGoldenFunction} from '../src/core/golden-function-extractor.mjs';

const site=process.env.GNC_QUE_SITE || '_site';
const read=file=>fs.readFileSync(path.join(site,file),'utf8');
const shell=read('index.html');
const base=createSuspendRoutingFixture();
const synthetic={defaults:[...base.state.itemcodeDefaultOwners].map(([itemcode_normalized,row])=>({itemcode_normalized,...row})),
    rows:base.rows.map(row=>({...row,suspend_eval_owner:base.context.resolveSuspendOwner(row),suspend_owner_zone_override:row.LOCATIONCODE==='C.06.001'}))};
synthetic.defaults.push({itemcode_normalized:'000450.030.1',assignedto:'dylan_collyge'});
synthetic.rows.push({unique_id:'andorra',itemcode:'000450.030.1',DOCK_SUSPEND_DC_REQUEST:true,suspend_eval_owner:'dylan_collyge'});
const live=process.env.GNC_QUE_LIVE_FIXTURE?JSON.parse(fs.readFileSync(process.env.GNC_QUE_LIVE_FIXTURE,'utf8')):synthetic;
const labels={pending:'REQUEST','suspend-tag':'SUSPEND',projects:'PROJECTS',moves:'LOCATION MOVES',recount:'RECOUNT',
    'shear-list':'SHEAR LIST','eval-work':'EVAL WORK','bunch-notes':'BUNCH NOTES','bunch-count-review':'COUNT REVIEW'};

function divTemplate(id) {
    const start=shell.indexOf('<div id="'+id+'"');
    let depth=0;
    for (const match of shell.slice(start).matchAll(/<\/?div\b[^>]*>/g)) {
        depth+=match[0].startsWith('</')?-1:1;
        if (!depth) return shell.slice(start,start+match.index+match[0].length);
    }
    throw Error('Missing '+id);
}

function fixtureDocument() {
    const styles=[...shell.matchAll(/<link\b[^>]*href="\.\/([^"?]+\.css)(?:\?[^\"]*)?"/g)]
        .map(match=>'<style>'+read(match[1])+'</style>').join('\n');
    return '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">'+styles
        +'</head><body class="current-view-request"><div id="app-wrapper">'+divTemplate('global-header-search-row')
        +'<main id="view-wrapper">'+divTemplate('view-request')+'</main></div></body></html>';
}

function ownerBindings() {
    const {context}=createSuspendRoutingFixture();
    const bindings=Object.entries(context).filter(([key])=>!suspendRoutingFunctions.includes(key)).map(([key,value])=>{
        if (typeof value!=='function') return 'window['+JSON.stringify(key)+']='+JSON.stringify(value)+';';
        if (value===String) return 'window['+JSON.stringify(key)+']=String;';
        const body=value.toString();
        return 'window['+JSON.stringify(key)+']=('+(/^\w+\(/.test(body)?'function '+body:body)+');';
    });
    return 'var defaults=new Map('+JSON.stringify(live.defaults.map(row=>[row.itemcode_normalized,row]))+');'
        +'var state={itemcodeDefaultOwners:defaults,defaultOwnersByCode:defaults};'+bindings.join('\n')
        +suspendRoutingSource()+'\ngetWarehouseAssignedRowForItem=()=>null;';
}

function headerBindings() {
    const ownerRenderer=extractGoldenFunction(read('assets/row-workflow-functions.js'),'renderQueueOwnerFilterPanel');
    return `var REQUEST_TAB_LABELS=${JSON.stringify(labels)}, fixtureRows=${JSON.stringify(live.rows)}, lastRequestHeaderSearchMode='';
        var requestSuspendTagCommonNameSearchTerm='',requestViewLevel=0,requestCategoryToolbarMarkupByNode=new WeakMap();
        var getAuthorizedRequestCategories=()=>Object.keys(REQUEST_TAB_LABELS),getCurrentVisibleViewId=()=> 'request';
        var getRequestTabQueueCounts=()=>Object.fromEntries(Object.keys(REQUEST_TAB_LABELS).map(key=>[key,key==='suspend-tag'?fixtureRows.length:7]));
        var formatRequestTabCount=String, syncRequestChromeMarkup=(panel,html)=>{panel.innerHTML=html;};
        var syncGlobalHeaderChrome=()=>{
            document.querySelector('#global-header-search-slot').appendChild(document.querySelector('#request-search-container'));
        };
        function setReqTab(tab){activeReqTab=tab;renderFixture();return false;}
        function renderFixture(){
            renderRequestCategoryToolbar();syncRequestHeaderSearchChrome();
            renderQueueOwnerFilterPanel(activeReqTab,fixtureRows);
            document.querySelector('#request-content').innerHTML=activeReqTab==='suspend-tag'
                ? applySuspendEvalUserFilter(fixtureRows).map(row=>'<article data-uid="'+row.unique_id+'">EVAL: '+resolveSuspendOwner(row)+'</article>').join('') : '<article>'+REQUEST_TAB_LABELS[activeReqTab]+'</article>';
        }
        renderRequest=renderFixture;
        ${ownerRenderer}
        ${read('assets/que-header.js')}
        document.querySelector('#view-request').classList.remove('hidden');
        for(const id of ['global-header-search-row','global-header-search-slot','global-header-inline-back','footer-cart-btn']) document.getElementById(id).classList.remove('hidden');
        document.querySelector('#global-excel-export').hidden=false;
        activeReqTab='suspend-tag';renderFixture();`;
}

async function measureHeader(page,width) {
    await page.setViewportSize({width,height:width===390?844:915});
    const boxes=await page.evaluate(()=>{
        const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width};};
        return {back:rect('global-header-inline-back'),search:rect('request-search'),view:rect('que-view-select'),
            owner:rect('request-suspend-tag-assigned-filter'),export:rect('global-excel-export'),
            overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};
    });
    assert.equal(boxes.overflow,0,JSON.stringify(boxes));
    assert.ok(boxes.search.x>=boxes.back.right && boxes.search.width>200,JSON.stringify(boxes));
    assert.ok(boxes.view.y>=boxes.search.bottom,JSON.stringify(boxes));
    assert.ok(Math.abs(boxes.view.y-boxes.owner.y)<=2 && Math.abs(boxes.view.y-boxes.export.y)<=2,JSON.stringify(boxes));
    assert.ok(boxes.view.right<=boxes.owner.x && boxes.owner.right<=boxes.export.x && boxes.export.right<=width,JSON.stringify(boxes));
    assert.equal(await page.locator('#request-suspend-tag-assigned-filter').isVisible(),true);
    const hit=await page.evaluate(()=>{const s=document.querySelector('#request-suspend-tag-assigned-filter'),r=s.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML;});
    assert.ok(hit?.includes('request-suspend-tag-assigned-filter'),hit);
    assert.equal(await page.locator('#footer-cart-btn').isVisible(),false);
    assert.equal(await page.locator('#request-search').getAttribute('placeholder'),'Search Que...');
    return {width,...boxes};
}

async function verifyCategories(page) {
    assert.equal(await page.locator('#que-view-select option').count(),9);
    for (const [value,label] of Object.entries(labels)) {
        await page.locator('#que-view-select').selectOption(value);
        assert.equal(await page.evaluate(()=>activeReqTab),value);
        assert.equal(await page.locator('#request-search').isVisible(),true,label);
        assert.equal(await page.locator('#que-view-select').isVisible(),true,label);
        assert.equal(await page.locator('#global-excel-export').isVisible(),true,label);
    }
    await page.locator('#que-view-select').selectOption('suspend-tag');
}

test('v3.0.71 Que mobile header shows two rows and every current Suspend owner',async()=>{
    const browser=await chromium.launch({headless:true});
    try {
        const page=await browser.newPage();
        const errors=[];page.on('pageerror',error=>errors.push(error.message));
        await page.route('**/*',route=>route.abort());
        await page.setContent(fixtureDocument());
        await page.addScriptTag({content:ownerBindings()+headerBindings()});
        const measurements=[];
        for (const width of [390,412]) {
            measurements.push(await measureHeader(page,width));
            await verifyCategories(page);
        }
        assert.equal(await page.locator('#request-content article').count(),live.rows.length);
        assert.equal(await page.locator('#request-content').getByText('EVAL: Unassigned',{exact:true}).count(),0);
        const andorra=live.rows.find(row=>row.itemcode==='000450.030.1');
        assert.ok(andorra);
        assert.equal(await page.locator('[data-uid="'+andorra.unique_id+'"]').textContent(),'EVAL: dylan_collyge');
        measurements.push(await measureHeader(page,412));
        const resolved=await page.evaluate(()=>fixtureRows.map(row=>resolveSuspendOwner(row)));
        assert.deepEqual(resolved,live.rows.map(row=>row.suspend_eval_owner));
        assert.deepEqual(errors,[]);
        if (process.env.GNC_QUE_PROOF_DIRECTORY) {
            await page.screenshot({path:path.join(process.env.GNC_QUE_PROOF_DIRECTORY,'v3.0.71-que-mobile.png')});
            fs.writeFileSync(path.join(process.env.GNC_QUE_PROOF_DIRECTORY,'v3.0.71-que-header.json'),JSON.stringify({
                version:'3.0.71',componentFixture:true,rows:live.rows.length,unassigned:0,measurements,errors},null,2));
        }
    } finally {await browser.close();}
});
