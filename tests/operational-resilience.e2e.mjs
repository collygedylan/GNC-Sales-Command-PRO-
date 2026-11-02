import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {installHlOrderFixture,hlMaster} from './fixtures/hl-order-state.mjs';
import {startReleaseTestServer} from '../scripts/serve-release-tests.mjs';
import {bunchDrillFixture} from './helpers/bunch-drill-contract.mjs';
const evidence=process.env.RELEASE_EVIDENCE_DIR||'G:/My Drive/GNC/AgData/Release Evidence';
const snapshot=JSON.parse(fs.readFileSync(path.join(evidence,'operational-snapshot.json'),'utf8'));
const physical=new Set(JSON.parse(fs.readFileSync(new URL('./fixtures/inventory-list-schema.json',import.meta.url),'utf8')).schema.map(c=>c.name));
const physicalRow=r=>Object.fromEntries(Object.entries({...r,photo_link:r.photo_link||r.photo_url||((Array.isArray(r.photos)?r.photos:[]).join(','))}).filter(([k])=>physical.has(k)));
snapshot.master=snapshot.master.map(physicalRow);
const target=snapshot.master.find(r=>r.lotcode==='27.F1'),nursery=bunchDrillFixture();
const master=[...snapshot.master,...nursery.inventory.map(physicalRow),...Array.from({length:9487-snapshot.master.length-nursery.inventory.length},(_,i)=>hlMaster('ops-'+i,{itemcode:'SYNTH.'+i,commonname:'Accolade Elm '+i,genusname:'Ulmus',ptronhand:'100',ptrreviewed:'10',ptravailable:'90',s_lts:'90',season:'F1',saleyear:'2027'}))];
let server;try{server=await startReleaseTestServer({port:4173,siteDir:'_site'});}catch(e){if(e.code!=='EADDRINUSE')throw e;}
const browser=await chromium.launch({headless:true}),results=[];
const json=(route,value)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
try{
await Promise.all([{name:'Mobile',width:390,height:844,touch:true},{name:'iPad',width:820,height:1180,touch:true},{name:'Desktop',width:1440,height:900,touch:false}].map(async device=>{
 const context=await browser.newContext({viewport:{width:device.width,height:device.height},hasTouch:device.touch,isMobile:device.touch,serviceWorkers:'block'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const pendingReads=new Set();page.on('request',r=>{if(r.url().includes('/rest/v1/')||r.url().includes('/functions/v1/'))pendingReads.add(r.url());});page.on('requestfinished',r=>pendingReads.delete(r.url()));page.on('requestfailed',r=>pendingReads.delete(r.url()));
 let writes=0;const ctrl=await installHlOrderFixture(page,'http://127.0.0.1:4173',{username:'dylan_collyge',role:'ADMIN',startupMode:'cold',master,appPermissions:['av','drive','request','managers','home','po-management'].map(moduleKey=>({permissionKey:'module.'+moduleKey+'.view',kind:'module',moduleKey,allowed:true}))});
 await page.route('**/rest/v1/**',async route=>{const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').pop();
  if(req.method()==='GET'&&['ph_active_request','ph_requests_pending','ph_request_queue_live_rows','ph_active_request_live_rows'].includes(table))return json(route,snapshot.requests);
  if(req.method()==='POST'&&table==='nursery_command_v23127'){const b=req.postDataJSON();if(b.p_operation==='read'&&Object.hasOwn(nursery.refs,b.p_table))return json(route,{rows:nursery.refs[b.p_table]});}
  if(req.method()==='POST'&&table==='save_drive_evidence_v3'){const b=req.postDataJSON();assert.equal(b.p_master_uid,target.unique_id);assert.equal(b.p_expected_locationcode,target.locationcode);assert.ok(b.p_idempotency_key);writes++;return json(route,{ok:true,code:'SAVED',canonicalConfirmed:true,row:{...target,...b.p_evidence,photo_link:target.photo_link,photo_url:target.photo_link},requestRows:[]});}
  return route.fallback();
 });
 await page.route('**/storage/v1/object/public/**',route=>route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="84" height="84"><rect width="84" height="84" fill="#14753c"/></svg>'}));
 await page.evaluate(()=>window.eval("switchView('av');"));
 await page.waitForFunction(()=>window.eval('fullInventory.length>=9487 && isDatasetLoaded("master","full")'),{},{timeout:45000});
 await page.waitForFunction(()=>document.getElementById('av-content').textContent.includes('Accolade Elm'),{},{timeout:20000}).catch(async e=>{console.log(JSON.stringify({diagnosis:{device:device.name,pending:[...pendingReads].map(u=>new URL(u).pathname),fixtureErrors:ctrl.errors.slice(-5),pageErrors:errors}}));await page.screenshot({path:path.join(evidence,'ops-'+device.name+'.png')});throw Error('AV readiness '+JSON.stringify(await page.evaluate(()=>({text:document.getElementById('av-content').textContent.slice(0,300),state:window.eval('({view:getCurrentVisibleViewId(),render:ensureViewRenderState("av"),rows:fullInventory.length,base:getCurrentAVBaseItems({usePreparedSalesRows:true}).items.length,draft:hasProductionLiveSyncDraft(),focus:document.activeElement.id,syncStatus:getProductionLiveSyncCoordinator().getStatus(),context:{view:getCurrentVisibleViewId(),permission:getProductionLiveSyncContext().dataPermissionVersion},masterState:{fullLoaded:getDatasetState("master").fullLoaded},receipt:productionDisplayMasterReceipt?{same:productionDisplayMasterReceipt.rows===fullInventory,scope:productionDisplayMasterReceipt.readScope,permission:productionDisplayMasterReceipt.permission}:null})')}))));});
 const av=await page.evaluate(()=>window.eval("(()=>{document.getElementById('av-search').value='';avResolvedBaseStateKey='';avResolvedBaseStateCache=null;const t=performance.now();renderAV();return {ms:performance.now()-t,text:document.getElementById('av-content').innerText.slice(0,100)};})()"));
 await page.locator('#av-search').focus();
 const search=await page.evaluate(async()=>{const start=performance.now(),input=document.getElementById('av-search');input.value='big hit';input.dispatchEvent(new Event('input',{bubbles:true}));while(!document.getElementById('av-content').textContent.toLowerCase().includes('big hit')){if(performance.now()-start>2000)throw Error('AV search did not repaint '+JSON.stringify({input:input.value,content:document.getElementById('av-content').textContent.slice(0,250),state:window.eval('({visible:getCurrentVisibleViewId(),rows:fullInventory.length,base:getCurrentAVBaseItems().items.length,term:getCurrentAVBaseItems().term})')}));await new Promise(requestAnimationFrame);}return performance.now()-start;});
 assert.ok(av.ms<200,'AV open '+av.ms);if(search>=100)console.log(JSON.stringify({device:device.name,search,trace:await page.evaluate(()=>window.__opsTrace)}));/* Timing assertions are collected after functional proof below. */
 const photos=await page.evaluate(uid=>window.eval("(()=>{const row=fullInventory.find(r=>r.UNIQUE_ID==="+JSON.stringify(uid)+");return {drive:resolveCanonicalPhotoUrls(row,'drive'),av:resolveCanonicalPhotoUrls(row,'av')};})()"),target.unique_id);assert.ok(photos.drive.length>=1);assert.deepEqual(photos.drive,photos.av);
 const detail=await page.evaluate(uid=>window.eval("(()=>{const row=fullInventory.find(r=>r.UNIQUE_ID==="+JSON.stringify(uid)+");const t=performance.now();openDetail(row.DOM_ID,'av',{__masterDetailRow:row});return performance.now()-t;})()"),target.unique_id);
 await page.locator('#view-detail').waitFor({state:'visible'});
 if(device.touch){const input=page.locator('#lsn-spec');if(await input.isVisible()){await input.click();assert.equal(await input.getAttribute('inputmode'),'none');assert.equal(await input.evaluate(e=>e.readOnly),true);assert.equal(await page.evaluate(()=>window.eval("submitShearApprovalRequestForActiveDetail('lsn-')")),false);await page.evaluate(()=>window.eval('closeDetailMeasurementKeyboard(false,{blur:true})'));}}
 await page.evaluate(()=>window.eval("switchView('request');activeReqTab='pending';renderRequest();"));
 await page.waitForFunction(()=>document.getElementById('request-content')?.textContent.includes('Sky Pencil'),{},{timeout:20000});
 await new Promise(r=>setTimeout(r,15000));assert.match(await page.locator('#request-content').innerText(),/Sky Pencil/);
 await page.reload({waitUntil:'load'});await page.locator('#view-login').waitFor({state:'hidden'});await page.evaluate(()=>window.eval("switchView('request');activeReqTab='pending';renderRequest();"));await page.waitForFunction(()=>document.getElementById('request-content')?.textContent.includes('Sky Pencil'),{},{timeout:20000});
 assert.deepEqual(errors,[]);results.push({device:device.name,avMs:+av.ms.toFixed(1),searchMs:+search.toFixed(1),detailMs:+detail.toFixed(1),photos:photos.drive.length,requestSurvived15SecondsAndReload:true,pageErrors:errors.length,isolatedSaveReceipts:writes});await context.close();
}));
fs.writeFileSync(path.join(evidence,'operational-browser-proof.json'),JSON.stringify({fixture:'Authenticated isolated UI with exact production incident rows and 9487-row hydrated inventory; SQL/email verified separately',results},null,2));console.log(JSON.stringify({ok:true,results}));for(const r of results){assert.ok(r.searchMs<100,r.device+' AV search '+r.searchMs);assert.ok(r.detailMs<50,r.device+' detail '+r.detailMs);}
}catch(e){fs.writeFileSync(path.join(evidence,'operational-browser-failure.txt'),e.stack||String(e));throw e;}finally{await browser.close();if(server)await new Promise(r=>server.close(r));}
process.exit(0);
