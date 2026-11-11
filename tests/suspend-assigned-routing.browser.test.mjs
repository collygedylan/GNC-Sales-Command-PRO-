import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {chromium} from 'playwright';
import {createSuspendRoutingFixture,suspendRoutingFunctions,suspendRoutingSource} from './helpers/suspend-assigned-routing-contract.mjs';

function browserBindings(context,state,rows) {
    const bindings = Object.entries(context).filter(([key])=>key !== 'renderRequest' && !suspendRoutingFunctions.includes(key)).map(([key,value])=>{
        if (typeof value !== 'function') return `window[${JSON.stringify(key)}]=${JSON.stringify(value)};`;
        if (value === String) return `window[${JSON.stringify(key)}]=String;`;
        const body = value.toString();
        const expression = /^\w+\(/.test(body) ? 'function '+body : body;
        return `window[${JSON.stringify(key)}]=(${expression});`;
    });
    return `var defaults=new Map(${JSON.stringify([...state.itemcodeDefaultOwners])});
        var state={itemcodeDefaultOwners:defaults,defaultOwnersByCode:defaults};
        var fixtureRows=${JSON.stringify(rows)};${bindings.join('\n')}
        ${suspendRoutingSource()}
        function renderRequest(){
            document.querySelector('#filter').innerHTML=buildSuspendEvalUserFilter(fixtureRows);
            document.querySelector('#cards').innerHTML=applySuspendEvalUserFilter(fixtureRows)
                .map(row=>'<article data-uid="'+row.unique_id+'">'+resolveSuspendOwner(row)+'</article>').join('');
        }`;
}

async function verifyLiveOwners(page,rows,owners) {
    for(const owner of owners) {
        const expected=rows.filter(row=>row.suspend_eval_owner===owner).length;
        await page.evaluate(owner=>{currentUser=owner;currentRole='EVAL';renderRequest();},owner);
        assert.equal(await page.locator('article').count(),expected,owner);
        const denied=await page.evaluate(()=>fixtureRows.some(row=>resolveSuspendOwner(row)!==currentUser && canCurrentUserWorkRequestItem(row,'edit')));
        assert.equal(denied,false,owner);
    }
}

test('headless SUSPEND admin filtering, exact owner edits and natural source turnover',async()=>{
    const browser = await chromium.launch({headless:true});
    const page = await browser.newPage();
    try {
        const {context,state,rows} = createSuspendRoutingFixture();
        await page.setContent('<main><div id="filter"></div><div id="cards"></div></main>');
        await page.addScriptTag({content:browserBindings(context,state,rows)});
        await page.evaluate(()=>renderRequest());
        assert.equal(await page.locator('article').count(),90);
        assert.equal(await page.locator('select').inputValue(),'ALL');
        await page.locator('select').selectOption('worker_b');
        assert.equal(await page.locator('article').count(),45);
        assert.equal(await page.evaluate(()=>canCurrentUserWorkRequestItem(fixtureRows[0],'edit')),true);
        await page.evaluate(()=>{currentRole='EVAL';currentUser='worker_a';renderRequest();});
        assert.equal(await page.locator('article').count(),44);
        assert.equal(await page.locator('select').count(),0);
        assert.equal(await page.evaluate(()=>canCurrentUserWorkRequestItem(fixtureRows[0],'photo')),false);
        await page.evaluate(()=>{currentUser='zoe_green';renderRequest();});
        assert.equal(await page.locator('article').count(),1);
        await page.evaluate(()=>{fixtureRows=getLatestSocSuspendTagSourceRows(fixtureRows.slice(1));renderRequest();});
        assert.equal(await page.locator('article').count(),0);
        const proof={rows:90,adminFiltered:45,standardOwned:44,zoneOwned:1,removedAfterImport:true};
        if(process.env.GNC_SUSPEND_BROWSER_PROOF) fs.writeFileSync(process.env.GNC_SUSPEND_BROWSER_PROOF,JSON.stringify(proof)+'\n');
        process.stdout.write('SUSPEND BROWSER '+JSON.stringify(proof)+'\n');
    } finally {await browser.close();}
});

test('headless current SUSPEND snapshot matches every server-confirmed Assigned Items owner',
    {skip:!process.env.GNC_SUSPEND_LIVE_FIXTURE},async()=>{
    const live=JSON.parse(fs.readFileSync(process.env.GNC_SUSPEND_LIVE_FIXTURE,'utf8'));
    const base=JSON.parse(fs.readFileSync(process.env.GNC_SUSPEND_OWNER_FIXTURE,'utf8'));
    const fixture=createSuspendRoutingFixture();
    fixture.state.itemcodeDefaultOwners=new Map(base.defaults.map(row=>[row.itemcode_normalized,row]));
    fixture.state.defaultOwnersByCode=fixture.state.itemcodeDefaultOwners;
    fixture.context.getWarehouseAssignedRowForItem=()=>null;
    const browser=await chromium.launch({headless:true});
    try {
        const page=await browser.newPage();
        await page.setContent('<main><div id="filter"></div><div id="cards"></div></main>');
        await page.addScriptTag({content:browserBindings(fixture.context,fixture.state,live.rows)});
        await page.evaluate(()=>renderRequest());
        assert.equal(await page.locator('article').count(),live.rows.length);
        const owners=[...new Set(live.rows.map(row=>row.suspend_eval_owner).filter(Boolean))];
        await verifyLiveOwners(page,live.rows,owners);
        const proof={rows:live.rows.length,owners:owners.length,foreignEditsAllowed:0,watchdog:live.watchdog};
        fs.writeFileSync(process.env.GNC_SUSPEND_LIVE_PROOF,JSON.stringify(proof)+'\n');
    } finally {await browser.close();}
});
