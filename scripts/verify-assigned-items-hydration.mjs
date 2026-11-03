// Read-only production metadata and Chromium acceptance proof; never saves an owner.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';
pg.types.setTypeParser(20,value=>{const n=Number(value);if(!Number.isSafeInteger(n))throw Error('UNSAFE_BIGINT_SNAPSHOT');return n;});
pg.types.setTypeParser(1700,Number);
import {chromium} from 'playwright';
import {startCompanyMirror} from './serve-company-mirror.mjs';
const evidence='G:/My Drive/GNC/AgData/Release Evidence';
const env=Object.fromEntries((await fs.readFile('.env','utf8')).split(/\r?\n/).filter(l=>/^\w+=/.test(l)).map(l=>{const n=l.indexOf('=');return[l.slice(0,n),l.slice(n+1).replace(/^['"]|['"]$/g,'')]}));
const url=new URL(env.GNC_SUPABASE_DB_URL);url.searchParams.delete('sslmode');
const db=new pg.Client({connectionString:url.toString(),ssl:{ca:await fs.readFile('scripts/certs/supabase-prod-ca-2021.crt','utf8')},statement_timeout:15000});
const report={completed:false,dataSource:'authorized live SQL snapshot through asynchronous PostgREST pages',snapshotPages:0,errors:[],cancelledReads:[],mutations:0};let browser,server;
try{
 await db.connect();
 const password=(await db.query("select password from public.ph_app_users where username='dylan_collyge' and disabled_at is null")).rows[0]?.password;assert.ok(password,'native proof credential');
 const expected=Number((await db.query('select count(*) n from public.ph_inventory_row_assignments where present_in_drive')).rows[0].n);
 const assignmentRows=(await db.query('select * from public.ph_inventory_row_assignments where present_in_drive order by master_unique_id')).rows;
 const evalUsers=(await db.query("select username from public.user_access where upper(role) in ('EVAL','EVALUATOR') order by username")).rows.map(r=>r.username);
 server=await startCompanyMirror().catch(e=>{if(e.code!=='EADDRINUSE')throw e;return null;});
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'}),page=await context.newPage();
 page.on('pageerror',e=>report.errors.push(e.message));page.on('requestfailed',r=>{if(/ERR_ABORTED/.test(r.failure()?.errorText||''))report.cancelledReads.push(new URL(r.url()).pathname)});
 await page.route('**/rest/v1/ph_inventory_row_assignments?*',async route=>{
  assert.equal(route.request().method(),'GET');assert.ok(route.request().headers().authorization,'authenticated snapshot read');
  const query=new URL(route.request().url()).searchParams,range=route.request().headers().range?.match(/(\d+)-(\d+)/);
  const offset=Number(query.get('offset')||range?.[1]||0),limit=Number(query.get('limit')||(range?Number(range[2])-offset+1:1000));
  const rows=assignmentRows.slice(offset,offset+limit);report.snapshotPages++;
  await route.fulfill({status:200,contentType:'application/json',headers:{'content-range':offset+'-'+(offset+rows.length-1)+'/'+assignmentRows.length,'access-control-expose-headers':'Content-Range'},body:JSON.stringify(rows)});
 });
 await page.route('**/rest/v1/rpc/set_itemcode_default_owners_v1',route=>{report.mutations++;return route.abort();});
 await page.goto('http://127.0.0.1:4173',{waitUntil:'domcontentloaded'});await page.locator('#username-input').fill('dylan_collyge');await page.locator('#pin-code').fill(password);await page.locator('#login-button').click();
 await page.waitForFunction(()=>typeof currentUser!=='undefined'&&currentUser==='dylan_collyge',null,{timeout:45000});
 await page.locator('#view-login').waitFor({state:'hidden',timeout:45000});
 const hydration=Date.now();
 await page.evaluate(()=>{switchView('managers');setHomeTab(MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW);void ensureDatasetLoaded('warehouseAssignedItems','full',{bypassLiveSyncCoordinator:true,retryOnCancellation:true,preserveRequestedMode:true}).catch(()=>{});});
 await page.waitForFunction(n=>warehouseAssignedItemsInventory.length===n&&getDatasetState('warehouseAssignedItems').fullLoaded,expected,{timeout:300000});
 console.log(JSON.stringify({stage:'snapshot-loaded',rows:expected}));
 await page.evaluate(()=>{switchView('managers');setHomeTab(MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW)});
 await page.waitForFunction(users=>users.every(user=>getManagerAssignableOwnerUsers().includes(user)),evalUsers,{timeout:30000});
 await page.evaluate(()=>scheduleManagersRender(true));
 console.log(JSON.stringify({stage:'roster-ready'}));
 await page.waitForSelector('[data-manager-assigned-item-row]',{timeout:30000});
 report.hydrationMs=Date.now()-hydration;
 report.rows=await page.evaluate(()=>({physical:warehouseAssignedItemsInventory.length,unique:new Set(getManagerAssignedItemsDisplayRows().map(r=>r.ITEMCODE)).size,populated:getManagerAssignedItemsDisplayRows().filter(r=>r.PLANTGROUPCODE).length,display:getManagerAssignedItemsDisplayRows().length}));
 assert.ok(report.snapshotPages>0);assert.equal(report.rows.physical,expected);assert.equal(report.rows.display,expected);assert.equal(report.rows.populated,report.rows.display);
 const groupSelect=page.locator('[data-assigned-plant-group-filter]');report.groups=await groupSelect.locator('option').evaluateAll(options=>options.filter(o=>o.value).map(o=>({value:o.value,label:o.textContent})));
 assert.ok(report.groups.some(g=>g.value==='130_SHRUB'));assert.ok(report.groups.some(g=>g.value==='330_TREES'));
 await page.locator('[data-assigned-filter-trigger="PLANTGROUPCODE"]').first().click();
 const panel=page.locator('#manager-assigned-filter-panel');assert.ok((await panel.innerText()).includes('130_SHRUB'));assert.ok((await panel.innerText()).includes('330_TREES'));assert.ok(!(await panel.innerText()).includes('(Blanks)'));
 await page.evaluate(()=>{selectManagerAssignedColumnValues(false);toggleManagerAssignedColumnValue('130_shrub',true);window.__groupApplyMs=null;const original=applyManagerAssignedColumnFilter;window.applyManagerAssignedColumnFilter=function(){const t=performance.now();const result=original();const handlerEnd=performance.now();getFilteredManagerAssignedItemsExportRows();window.__groupApplyParts={handlerMs:handlerEnd-t,filterMs:performance.now()-handlerEnd};window.__groupApplyMs=performance.now()-t;return result;};});
 await panel.locator('.assigned-filter-apply').click();report.applyMs=await page.evaluate(()=>window.__groupApplyMs);report.applyParts=await page.evaluate(()=>window.__groupApplyParts);assert.ok(report.applyMs<30,'Apply filter <30ms');
 await page.waitForFunction(()=>getFilteredManagerAssignedItemsExportRows().every(r=>r.PLANTGROUPCODE==='130_SHRUB'));
 await groupSelect.selectOption('330_TREES');await page.waitForFunction(()=>getFilteredManagerAssignedItemsExportRows().length>0&&getFilteredManagerAssignedItemsExportRows().every(r=>r.PLANTGROUPCODE==='330_TREES'));
 report.treeRows=await page.evaluate(()=>getFilteredManagerAssignedItemsExportRows().length);
 await page.evaluate(()=>clearAllManagerAssignedColumnFilters());await page.waitForSelector('select[aria-label^="Itemcode Default Owner "]');
 const selectors=['[data-assigned-user-filter]','#manager-eval-bulk-assignee','select[aria-label^="Itemcode Default Owner "]'];const lists=[];
 for(const selector of selectors)lists.push(await page.locator(selector).first().locator('option').evaluateAll(options=>options.map(o=>o.value).filter(v=>v&&v!=='all'&&v!=='unassigned').sort()));
 assert.deepEqual(lists[0],lists[1]);assert.deepEqual(lists[1],lists[2]);
 const required=[...evalUsers,'dylan_collyge','zoe_green','megan_kelly','mitch_kaiser','nelly_aguilar','morgan_anderson','jd_jones'];for(const user of required)assert.ok(lists[0].includes(user),user);
 for(const field of ['ASSIGNEDTO','DEFAULT_ASSIGNEDTO']){await page.locator('[data-assigned-filter-trigger="'+field+'"]').first().click();const values=await page.evaluate(f=>getManagerAssignedColumnOptions(f).map(v=>v.value).filter(Boolean).sort(),field);for(const user of required)assert.ok(values.includes(user),field+':'+user);await page.locator('#manager-assigned-filter-panel').getByRole('button',{name:'Cancel',exact:true}).click();}
 report.ownerOptions=lists[0];report.evalUsers=evalUsers;assert.equal(report.errors.length,0);assert.equal(report.mutations,0);report.completed=true;
 await page.screenshot({path:evidence+'/assigned-items-hydration.png',fullPage:false,timeout:10000});
}catch(error){report.failure=error.message;throw error;}
finally{await fs.writeFile(evidence+'/assigned-items-hydration-proof.json',JSON.stringify(report,null,2));await browser?.close();await db.end();if(server)await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({completed:report.completed,rows:report.rows,groups:report.groups.length,applyMs:report.applyMs,owners:report.ownerOptions.length,errors:report.errors.length,mutations:report.mutations}));
process.exit(0);
