// Read-only production acceptance. Owner writes are intercepted before transport.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { chromium } from 'playwright';
import { startCompanyMirror } from './serve-company-mirror.mjs';

const evidence = process.env.RELEASE_EVIDENCE_DIR || 'G:/My Drive/GNC/AgData/Release Evidence';
const env = Object.fromEntries((await fs.readFile('.env', 'utf8')).split(/\r?\n/).filter(l => /^\w+=/.test(l)).map(l => {
  const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')];
}));
const dbUrl = new URL(env.GNC_SUPABASE_DB_URL); dbUrl.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: dbUrl.toString(), ssl: { ca: await fs.readFile('scripts/certs/supabase-prod-ca-2021.crt', 'utf8') }, statement_timeout: 15000 });
const report = { release: '2.3.161', pass: false, productionOwnerWrites: 0, accounts: [], timings: {}, errors: [] };
let browser, server, currentPage;
try {
  await db.connect();
  const roster = (await db.query('select username,role from public.ph_app_users order by username')).rows;
  const matrix = (await db.query('select username,role,userrole from public.user_access order by username')).rows;
  assert.equal(matrix.length, roster.length);
  for (const user of roster) assert.ok(matrix.some(r => r.username === user.username && r.role === user.role && r.userrole === user.role), user.username);
  report.roster = { users: roster.length, matrix: matrix.length, mismatches: 0, evaluators: roster.filter(r => r.role === 'EVAL').map(r => r.username) };
  const pending = (await db.query("select unique_id,itemcode,req_status from public.ph_requests_pending where date_completed is null and move_batch_id is null")).rows;
  assert.ok(pending.some(r => r.unique_id === 'REQ-mvzcij3w1lxpl9ybe93'));
  report.pending = pending.length;
  const inventoryCounts=(await db.query('select count(*) as rows,count(distinct itemcode) as items from public.ph_master_inventory')).rows[0];
  const expectedItems=Number(inventoryCounts.items),expectedRows=Number(inventoryCounts.rows);
  server = await startCompanyMirror().catch(e => { if (e.code !== 'EADDRINUSE') throw e; return null; });
  browser = await chromium.launch({ headless: true });
  const credentials = (await db.query("select username,password from public.ph_app_users where username=any($1) and disabled_at is null", [['dylan_collyge','nelly_aguilar','jd_jones']])).rows;
  for (const username of ['dylan_collyge','nelly_aguilar','jd_jones']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage(), errors = []; currentPage=page;
    page.on('pageerror', e => errors.push(e.message));
    page.on('response',r=>{if(r.status()>=400)(report.networkErrors ||= []).push({username,status:r.status(),path:new URL(r.url()).pathname});});
    page.on('console', m => { if (m.type() === 'error' && !/ERR_ABORTED|REQUEST_ABORTED|DATASET_READ_SCOPE_CHANGED/.test(m.text())) errors.push(m.text()); });
    await page.goto('http://127.0.0.1:4173', { waitUntil: 'domcontentloaded' });
    await page.locator('#username-input').fill(username);
    await page.locator('#pin-code').fill(credentials.find(r => r.username === username).password);
    await page.locator('#login-button').click();
    await page.waitForFunction(name => typeof currentUser !== 'undefined' && currentUser === name, username, { timeout: 60000 });
    await page.waitForFunction(count => fullInventory.length >= count && isDatasetLoaded('master','full'), expectedRows, { timeout: 180000 });
    report.hydration=await page.evaluate(()=>({rows:fullInventory.length,expected:getDatasetState('master').expectedRowCount,receipt:!!productionDisplayMasterReceipt}));
    await page.evaluate(() => { switchView('request'); activeReqTab = 'pending'; renderRequest(); });
    await page.waitForFunction(() => requestsInventory.some(r => r.UNIQUE_ID === 'REQ-mvzcij3w1lxpl9ybe93'), null, { timeout: 45000 });
    const queue = await page.evaluate(() => {
      renderRequest(); const rows = getScopedRequestItems(requestsInventory, { includeDockSuspendMirrorRows:false });
      return { scope:getRequestCapabilities()?.scope, count:rows.filter(r => isRequestPendingVisible(r)).length,
        target:rows.some(r => r.UNIQUE_ID === 'REQ-mvzcij3w1lxpl9ybe93'), empty:document.getElementById('request-content').textContent.includes('No pending requests.') };
    });
    assert.equal(queue.scope,'global'); assert.equal(queue.target,true); assert.equal(queue.empty,false); assert.equal(queue.count,pending.length);
    report.accounts.push({ username,...queue }); console.log(JSON.stringify({ account:username,queue:queue.count }));
    if (username === 'dylan_collyge') {
      await page.evaluate(()=>{window.__avProofTimes={};for(const name of ['renderAV','getCurrentAVBaseItems','getAvSalesRowsForBucket','renderAvTopControls','buildAVExportContext','generateCard','ensureViewDataForRender','createAvSalesRowsDerivation','getAvSalesDerivationIdentity','buildAvSharedFilterState','getAvRawTabItems','filterBySearch','renderAVOpenCardsChunked','getProductionLiveSyncContext','getAvSalesInventorySourceRows']){const original=window[name];if(typeof original!=='function')continue;window[name]=function(...args){const start=performance.now();try{return original.apply(this,args);}finally{const previous=window.__avProofTimes[name]||{count:0,ms:0};previous.count++;previous.ms+=performance.now()-start;window.__avProofTimes[name]=previous;}}}});
      report.timings.avOpenMs = await page.evaluate(async () => {
        const start = performance.now(); switchView('av');
        while (!document.getElementById('av-content').textContent.includes('Location')) { if (performance.now()-start > 2000) throw Error('AV_FIRST_PAINT'); await new Promise(requestAnimationFrame); }
        return performance.now()-start;
      });
      report.timings.avSearchMs = await page.evaluate(async () => {
        const input=document.getElementById('av-search'),start=performance.now(); input.value='big hit'; input.dispatchEvent(new Event('input',{bubbles:true}));
        while (!/Big Hit/i.test(document.getElementById('av-content').textContent) || !/Search Results/.test(document.getElementById('av-crumb').textContent)) { if(performance.now()-start>2000)throw Error('AV_SEARCH');await new Promise(requestAnimationFrame); }
        return performance.now()-start;
      });
      report.avProfile=await page.evaluate(()=>window.__avProofTimes);
      const av = await page.evaluate(() => {
        const rows=getCurrentAVBaseItems({usePreparedSalesRows:true}).items;
        const white=[...document.querySelectorAll('#view-av .av-top-controls-row button,#view-av .av-top-controls-row select,.av-note-dropdown-panel')].filter(e=>e.getBoundingClientRect().width && getComputedStyle(e).backgroundColor==='rgb(255, 255, 255)').length;
        const row=rows.find(r=>/big hit/i.test(r.COMMONNAME)); if(!row)throw Error('BIG_HIT_MISSING');
        handleCardClick(row.DOM_ID,row.UNIQUE_ID,'av');
        return {white,detail:getCurrentVisibleViewId(),spec:document.getElementById('lsn-spec')?.getAttribute('inputmode')};
      });
      assert.equal(av.white,0); assert.equal(av.detail,'detail'); report.av=av;
      await page.evaluate(() => { switchView('managers');setHomeTab(MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW); });
      await page.waitForFunction(() => getManagerAssignedColumnState().defaultOwnersByCode?.size>0, null, {timeout:45000});
      await page.locator('#manager-assigned-items-root').scrollIntoViewIfNeeded();
      await page.waitForSelector('[data-manager-assigned-item-row]',{timeout:15000});
      const assigned = await page.evaluate(() => {
        const all=getFilteredManagerAssignedItemsExportRows(getManagerAssignedItemsDisplayRows());
        setManagerAssignedItemsAssigneeFilter('dylan_collyge');setManagerAssignedPlantGroupFilter('140 GRASS');
        const spaced=getManagerAssignedSelectionSnapshot().rows.map(r=>r.ITEMCODE);setManagerAssignedPlantGroupFilter('140_GRASS');
        const underscored=getManagerAssignedSelectionSnapshot().rows.map(r=>r.ITEMCODE);
        return {count:all.length,filtered:underscored.length,aliasesEqual:JSON.stringify(spaced)===JSON.stringify(underscored),ready:isManagerAssignedSnapshotCurrent(),loadError:document.getElementById('manager-assigned-items-root').textContent.includes('could not load')};
      });
      assert.equal(assigned.count,expectedItems); assert.equal(assigned.aliasesEqual,true);assert.equal(assigned.ready,true);assert.equal(assigned.loadError,false);report.assigned=assigned;
      // Exercise all four real controller callbacks with a deferred, intercepted RPC.
      report.assignmentControls = await page.evaluate(async () => {
        setManagerAssignedItemsAssigneeFilter('all');setManagerAssignedPlantGroupFilter('');
        const state=getManagerAssignedColumnState(),rows=getFilteredManagerAssignedItemsExportRows(getManagerAssignedItemsDisplayRows()).slice(0,3),codes=rows.map(r=>buildManagerEvalAssignmentKey(r.ITEMCODE));
        const originalRpc=supabaseRpc,originalReceipt=applyAcknowledgedEvalAssignmentResults,calls=[];
        supabaseRpc=async(name,body,...rest)=>{if(name!=='set_itemcode_default_owners_v1')return originalRpc(name,body,...rest);calls.push(body);return {ok:true};};
        applyAcknowledgedEvalAssignmentResults=()=>{};
        const timings=[];
        try {
          for(const mode of ['all','selected','checked-dropdown','single']) {
            state.filters.ITEMCODE=codes.map(c=>c.toLowerCase());getManagerAssignedSelectionSnapshot();managerEvalAssignmentSelection.clear();
            const start=performance.now();let operation;
            if(mode==='all')operation=assignEvalItemcodes(getManagerAssignedSelectionSnapshot().rows.map(r=>r.ITEMCODE),'jd_jones');
            if(mode==='selected'){codes.forEach(c=>managerEvalAssignmentSelection.add(c));operation=assignEvalItemcodes(getManagerAssignedSelectionSnapshot().selectedRows.map(r=>r.ITEMCODE),'jd_jones');}
            if(mode==='checked-dropdown'){codes.slice(0,2).forEach(c=>managerEvalAssignmentSelection.add(c));operation=assignManagerCheckedItemcodes(codes[0],'jd_jones');}
            if(mode==='single')operation=assignManagerCheckedItemcodes(codes[2],'jd_jones');
            const optimisticMs=performance.now()-start;await operation;timings.push({mode,optimisticMs,count:calls.at(-1)?.p_itemcodes.length});
          }
        } finally {supabaseRpc=originalRpc;applyAcknowledgedEvalAssignmentResults=originalReceipt;}
        return {intercepted:calls.length,timings};
      });
      assert.equal(report.assignmentControls.intercepted,4);assert.deepEqual(report.assignmentControls.timings.map(r=>r.count),[3,3,2,1]);
      await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof currentUser!=='undefined'&&currentUser==='dylan_collyge');
      await page.evaluate(()=>{switchView('managers');setHomeTab(MANAGER_ACCESS_CONTROL_VIEW);});
      await page.waitForFunction(count=>document.querySelector('[data-user-role-filter]')&&document.querySelectorAll('[data-user-select] option[value]:not([value=""])').length>=count,roster.length,{timeout:45000});
      await page.locator('[data-user-role-filter]').selectOption('evaluator');
      report.roleFilter = await page.locator('[data-user-select] option').evaluateAll(options=>options.filter(o=>o.value).map(o=>o.value));
      report.roleDiagnostic=await page.evaluate(()=>({selector:document.querySelector('[data-user-role-filter]')?.value,search:document.querySelector('[data-user-search]')?.value,status:document.querySelector('#manager-access-control')?.textContent?.slice(0,600),rows:GncUserAccessControl.state.userAccess.filter(r=>/eval/i.test(r.role)),options:[...document.querySelectorAll('[data-user-select] option')].map(o=>({value:o.value,text:o.textContent}))}));
      assert.deepEqual([...report.roleFilter].sort(),[...report.roster.evaluators].sort());
      await page.screenshot({path:path.join(evidence,'v23138-role-roster.png'),fullPage:false});
    }
    report.errors.push(...errors.map(error=>({username,error}))); await context.close();
  }
  assert.equal(report.errors.length,0,JSON.stringify(report.errors));
  assert.ok(report.timings.avOpenMs<200,JSON.stringify(report.timings));
  assert.ok(report.timings.avSearchMs<100,JSON.stringify(report.timings));
  assert.ok(report.assignmentControls.timings.every(r=>r.optimisticMs<100),JSON.stringify(report.assignmentControls));
  report.pass=true;
 } catch(error) {report.failure=String(error.stack||error);report.diagnostic=await currentPage?.evaluate(()=>({times:window.__avProofTimes,master:{rows:fullInventory.length,expected:getDatasetState('master').expectedRowCount,complete:isDatasetLoaded('master','full')},filters:{season:getAvConfiguredCurrentSeasonCode(),year:getAvConfiguredCurrentSalesYearCode(),selected:[...selectedAvSeasons],partial:isAvLiveCatalogIncomplete()},big:fullInventory.filter(r=>/big.*hit/i.test(r.COMMONNAME)).map(r=>({name:r.COMMONNAME,year:r.SALEYEAR,season:r.SEASON,match:itemMatchesAvCurrentSeasonBucket(r)})),receipt:!!productionDisplayMasterReceipt,receiptOwned:productionDisplayMasterReceipt?.readScope===getSupabaseReadIdentityScope(),text:document.getElementById('av-content')?.textContent.slice(0,500),crumb:document.getElementById('av-crumb')?.textContent,search:document.getElementById('av-search')?.value,base:typeof getCurrentAVBaseItems==='function'?getCurrentAVBaseItems({usePreparedSalesRows:true}).items.length:null,view:getCurrentVisibleViewId(),state:typeof ensureViewRenderState==='function'?ensureViewRenderState('av'):null})).catch(()=>null);console.error(String(error.message||error));}
finally {
  await fs.writeFile(path.join(evidence,'table-management-browser-proof.json'),JSON.stringify(report,null,2)+'\n');
  await browser?.close();await db.end().catch(()=>{});await server?.close?.();
  console.log(JSON.stringify({pass:report.pass,accounts:report.accounts.length,timings:report.timings,roster:report.roster?.users,errors:report.errors.length}));
  process.exit(report.pass?0:1);
}
