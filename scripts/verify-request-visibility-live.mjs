// Authenticated read-only acceptance; toggle persistence is isolated before transport.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import {chromium} from 'playwright';
import {startCompanyMirror} from './serve-company-mirror.mjs';
const evidence=process.env.RELEASE_EVIDENCE_DIR||'G:/My Drive/GNC/AgData/Release Evidence';
const env=Object.fromEntries((await fs.readFile('.env','utf8')).split(/\r?\n/).filter(l=>/^\w+=/.test(l)).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,'')]}));
const url=new URL(env.GNC_SUPABASE_DB_URL);url.searchParams.delete('sslmode');
const db=new pg.Client({connectionString:url.toString(),ssl:{ca:await fs.readFile('scripts/certs/supabase-prod-ca-2021.crt','utf8')},statement_timeout:15000});
const report={release:JSON.parse(await fs.readFile('package.json','utf8')).version,pass:false,accounts:[],errors:[],productionToggleWrites:0,assignmentWrites:0,requestWrites:0};let browser,server;
try{
 await db.connect();
 const matrix=(await db.query('select username,role,view_all_requests from public.user_access order by username')).rows;
 for(const username of ['dylan_collyge','nelly_aguilar','jd_jones'])assert.equal(matrix.find(r=>r.username===username)?.view_all_requests,'Y');
 const evaluators=matrix.filter(r=>/^eval(?:uator)?$/i.test(r.role));assert.ok(evaluators.length);assert.ok(evaluators.every(r=>r.view_all_requests==='N'));report.evaluatorDefaults=evaluators;
 const names=['dylan_collyge','nelly_aguilar','jd_jones','jorge_colunga'];
 const credentials=(await db.query('select username,password from public.ph_app_users where username=any($1) and disabled_at is null',[names])).rows;
 const expectedRows=Number((await db.query('select count(*) as n from public.ph_master_inventory')).rows[0].n);
 server=await startCompanyMirror().catch(e=>{if(e.code!=='EADDRINUSE')throw e;return null});browser=await chromium.launch({headless:true});
 for(const username of names){
  const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&!/ERR_ABORTED|REQUEST_ABORTED|DATASET_READ_SCOPE_CHANGED/.test(m.text()))errors.push(m.text())});
  await page.route('**/functions/v1/app-api',async route=>{const body=route.request().postDataJSON()||{};if(body.action==='user_access'&&String(body.operation||'').startsWith('save'))throw Error('LIVE_PERMISSION_WRITE_BLOCKED');return route.continue()});
  const cold=Date.now();await page.goto('http://127.0.0.1:4173',{waitUntil:'domcontentloaded'});
  await page.locator('#username-input').fill(username);await page.locator('#pin-code').fill(credentials.find(r=>r.username===username).password);await page.locator('#login-button').click();
  await page.waitForFunction(name=>typeof currentUser!=='undefined'&&currentUser===name,username,{timeout:60000});
  await page.waitForFunction(n=>fullInventory.length>=n&&isDatasetLoaded('master','full'),expectedRows,{timeout:180000});
  await page.evaluate(()=>{switchView('request');activeReqTab='pending';renderRequest()});
  const pending=(await db.query('select unique_id,itemcode,submitted_by,request_created_by_username from public.ph_requests_pending where date_completed is null and move_batch_id is null')).rows;
  await page.waitForFunction(n=>requestsInventory.length>=n,pending.length,{timeout:60000});
  await page.waitForFunction(()=>warehouseAssignedItemsInventory.length>0,null,{timeout:60000});
  const actual=await page.evaluate(()=>{const start=performance.now();renderRequest();return {all:canViewAllRequests(),ids:getScopedRequestItems(requestsInventory,{includeDockSuspendMirrorRows:false}).filter(isRequestPendingVisible).map(r=>r.UNIQUE_ID),renderMs:performance.now()-start,master:fullInventory.length,assigned:warehouseAssignedItemsInventory.length}});
  if(username!=='jorge_colunga')assert.deepEqual(actual.ids.slice().sort(),pending.map(r=>r.unique_id).sort(),username);
  else{
   const owners=(await db.query("select distinct itemcode from public.ph_inventory_row_assignments where lower(replace(assignedto,' ','_'))=$1",[username])).rows;const codes=new Set(owners.map(r=>String(r.itemcode).trim().toUpperCase()));
   const profile=(await db.query('select id from public.profiles where username=$1',[username])).rows[0];
   const expected=pending.filter(r=>codes.has(String(r.itemcode).trim().toUpperCase())||[r.submitted_by,r.request_created_by_username].some(v=>[username,profile.id].includes(v)));
   assert.equal(actual.all,false);assert.deepEqual(actual.ids.slice().sort(),expected.map(r=>r.unique_id).sort(),'assigned items or personally submitted only');
   report.evaluatorToggle=await page.evaluate(()=>{const api=GncUserAccessControl,before=api.resolveUserAccessMatrix(currentUser,currentRole),start=performance.now();api.setAccessMatrixRows([{...before,view_all_requests:'Y'}]);const all=getScopedRequestItems(requestsInventory,{includeDockSuspendMirrorRows:false}).filter(isRequestPendingVisible).length;const ms=performance.now()-start;api.setAccessMatrixRows([before]);return {count:all,ms,restored:!canViewAllRequests()}});
   assert.equal(report.evaluatorToggle.count,pending.length);assert.equal(report.evaluatorToggle.restored,true);
  }
  if(username==='dylan_collyge'){
   await page.evaluate(()=>{switchView('managers');setHomeTab(MANAGER_ACCESS_CONTROL_VIEW)});
   await page.waitForSelector('[data-matrix-key="view_all_requests"]',{timeout:60000});
   for(const category of ['actions','all']){await page.locator('[data-access-category="'+category+'"]').click();assert.ok(await page.getByRole('columnheader',{name:'View All Requests',exact:true}).isVisible());}
   report.visibleDefaults=await page.locator('[data-matrix-key="view_all_requests"]').evaluateAll(nodes=>nodes.map(n=>({username:n.dataset.matrixUser,value:n.dataset.value})));
   for(const username of ['dylan_collyge','nelly_aguilar','jd_jones'])assert.equal(report.visibleDefaults.find(r=>r.username===username)?.value,'Y');
   for(const row of evaluators)assert.equal(report.visibleDefaults.find(r=>r.username===row.username)?.value,'N');
   report.optimistic=await page.evaluate(async()=>{const api=GncUserAccessControl;let finish;const calls=[];api.configure({transport:request=>{calls.push(request);return new Promise(resolve=>finish=()=>resolve({ok:true,matrixRows:api.state.userAccess.filter(r=>request.mode==='role'?api.normalizeRole(r.role)===request.target:r.username===request.target)}))}});const result=[];
    for(const [mode,target,value] of [['role','evaluator','Y'],['user','jorge_colunga','N']]){const start=performance.now(),promise=api.saveAccessPermission(mode,target,'view_all_requests',value);const ms=performance.now()-start;result.push({mode,ms,jorge:api.resolveUserAccessMatrix('jorge_colunga').view_all_requests,others:api.state.userAccess.filter(r=>api.normalizeRole(r.role)==='evaluator'&&r.username!=='jorge_colunga').map(r=>r.view_all_requests)});finish();await promise;}
    return {result,calls:calls.length};});
   assert.equal(report.optimistic.calls,2);assert.equal(report.optimistic.result[0].jorge,'Y');assert.ok(report.optimistic.result[0].others.every(v=>v==='Y'));assert.equal(report.optimistic.result[1].jorge,'N');assert.ok(report.optimistic.result[1].others.every(v=>v==='Y'));
   await page.screenshot({path:path.join(evidence,'request-visibility-editor.png')});
  }
  report.accounts.push({username,count:actual.ids.length,all:actual.all,renderMs:actual.renderMs,coldHydrationMs:Date.now()-cold});report.errors.push(...errors.map(error=>({username,error})));await context.close();
 }
 const after=(await db.query('select username,role,view_all_requests from public.user_access order by username')).rows;assert.deepEqual(after,matrix,'browser proof must not persist test toggles');assert.equal(report.errors.length,0,JSON.stringify(report.errors));report.pass=true;
}catch(error){report.failure=String(error.stack||error);console.error(String(error.message||error));}
finally{await fs.writeFile(path.join(evidence,'request-visibility-browser-proof.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();await db.end().catch(()=>{});await server?.close?.();console.log(JSON.stringify({pass:report.pass,accounts:report.accounts,errors:report.errors.length}));process.exit(report.pass?0:1);}
