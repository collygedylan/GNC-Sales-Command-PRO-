import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import pg from 'pg';
import { assertDeliveryOrderHealth } from './verify-request-delivery-order.mjs';

export function assertPinnedTableGeometry(before, after) {
  assert.ok(after.scrollTop >= 1000, 'real table rows must scroll at least 1,000 pixels');
  for (const key of ['selectorTop','toolbarTop','headerTop']) {
    assert.ok(Number.isFinite(after[key]) && after[key] >= 0, key+' remains in the viewport');
    assert.ok(Math.abs(after[key]-before[key]) <= 2, key+' remains pinned');
  }
  assert.ok(after.headerTop < after.viewportHeight, 'headers remain visible');
}


async function verifyBunchNotes(page,proof,evidence){
 const began=Date.now();
 const open=async()=>{await page.evaluate(()=>{switchView('managers');setHomeTab('dashboard');renderManagers();});await page.locator('[data-manager-module="table-management"]').click();await page.locator('[data-manager-table-card="bunch-notes-simulator"]').click();await page.waitForFunction(()=>document.querySelector('[data-nursery-status]')?.textContent==='Changes saved',null,{timeout:120000});await page.locator('[data-nursery-filter="location"]').selectOption('ALL_LOCATIONS');};
 await page.locator('[data-manager-table-card="bunch-notes-simulator"]').click();await page.waitForFunction(()=>document.querySelector('[data-nursery-status]')?.textContent==='Changes saved',null,{timeout:120000});await page.locator('[data-nursery-filter="location"]').selectOption('ALL_LOCATIONS');
 proof.bunch=await page.evaluate(async()=>{const refs={};for(const table of ['ph_dylan_decisions_store','ph_nursery_items_cpb']){let rows=[],offset=0;for(;;){const result=await supabaseRpc('nursery_command_v23127',{p_table:table,p_operation:'read',p_payload:{offset,limit:1000}});rows.push(...result.rows);if(result.rows.length<1000)break;offset+=1000;}refs[table]=rows;}const c=GncNurseryModel.buildBunchNoteContext(fullInventory,refs),rows=[...c.byUid.values()],read=(r,k)=>r[k]??r[k.toUpperCase()],missing=rows.filter(r=>['unique_id','locationcode','itemcode','lotcode','commonname','contsize'].some(k=>!String(read(r,k)||'').trim())),candidate=rows.find(r=>r.synthetic&&!c.decisions.has(GncNurseryModel.bunchPlanId(r)));return {totalIdentities:rows.length,historicalDefinitions:refs.ph_dylan_decisions_store.filter(r=>r.wf_type==='BUNCH NOTE EXCEPTION').length,historicalIdentities:c.historicalIdentities.length,blockOnly:missing.length,candidate:candidate?{uid:candidate.unique_id,name:candidate.commonname}:null};});
 assert.equal(proof.bunch.blockOnly,0);assert.equal(proof.bunch.historicalDefinitions,750);assert.ok(proof.bunch.historicalIdentities>=750);assert.ok(proof.bunch.candidate);
 await page.locator('[data-bunch-subview="issues"]').click();proof.bunch.cards=await page.locator('[data-bunch-card]').count();assert.ok(proof.bunch.cards>0);
 assert.equal(await page.locator('[data-bunch-card]').evaluateAll(cards=>cards.filter(c=>['bunchCard','bunchLocation','bunchItemcode','bunchLotcode'].some(k=>!c.dataset[k])).length),0);
 proof.bunch.columns=await page.locator('.bunch-issue-list').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);assert.equal(proof.bunch.columns,1);
 await page.locator('[data-nursery-search]').fill(proof.bunch.candidate.uid);await page.locator('[data-bunch-open='+JSON.stringify(proof.bunch.candidate.uid)+']').click();const modal=page.locator('#bunch-note-issue-modal');assert.equal(await modal.locator('[data-bunch-approve]').isEnabled(),true);proof.bunch.uid=proof.bunch.candidate.uid;proof.bunch.note=await modal.locator('textarea').inputValue();
 await page.screenshot({path:path.join(evidence,'bunch-note-approval.png')});
 proof.bunch.saveMilliseconds=await page.locator('[data-bunch-approve]').evaluate(button=>{const start=performance.now();button.click();if(document.querySelector('#bunch-note-issue-modal'))throw Error('Approval modal did not close synchronously');return performance.now()-start;});assert.ok(proof.bunch.saveMilliseconds<250);
 const plan='BN-'+encodeURIComponent(proof.bunch.uid);await page.waitForFunction(plan=>{const rows=JSON.parse(localStorage.getItem('gnc_bunch_decisions:'+getSupabaseReadIdentityScope())||'[]');return rows.some(r=>r.plan_id===plan&&!r._optimistic);},plan,{timeout:30000});
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof currentUser!=='undefined'&&currentUser==='dylan_collyge'&&nativeAuthSessionActive&&!initialAppLoadActive&&!nativeAuthProfileRestorePending,null,{timeout:120000});await open();
 await page.locator('[data-nursery-search]').fill(proof.bunch.uid);await page.waitForFunction(note=>document.querySelector('.nursery-scroll')?.textContent.includes(note),proof.bunch.note);assert.ok((await page.locator('.nursery-scroll').textContent()).includes('Approved Bunch Note Created'));assert.ok((await page.locator('.nursery-scroll').textContent()).includes(proof.bunch.note));proof.bunch.reloadPersisted=true;
 proof.bunch.driveNote=await page.evaluate(uid=>GncNurseryModel.approvedBunchNote({unique_id:uid},getSupabaseReadIdentityScope()),proof.bunch.uid);assert.equal(proof.bunch.driveNote,proof.bunch.note);
 await page.locator('[data-table-switch]').selectOption('approved-execution-plan');await page.locator('[data-nursery-filter="location"]').selectOption('ALL_LOCATIONS');await page.locator('[data-nursery-search]').fill(plan);await page.waitForFunction(note=>document.querySelector('.nursery-scroll')?.textContent.includes(note),proof.bunch.note);assert.ok((await page.locator('.nursery-scroll').textContent()).includes(proof.bunch.note));proof.bunch.executionPersisted=true;
 await page.locator('[data-table-switch]').selectOption('bunch-notes-simulator');await page.locator('[data-bunch-subview="rules"]').click();proof.bunch.rules=await page.locator('[data-bunch-rule]').count();assert.equal(proof.bunch.rules,13);
 await page.screenshot({path:path.join(evidence,'bunch-note-rules.png')});proof.bunch.seconds=(Date.now()-began)/1000;await page.locator('#global-header-inline-back').click();assert.equal(await page.locator('[data-manager-table-card]').count(),18);proof.bunch.back=true;
}

async function verify() {
  const root=process.cwd(),evidence=process.env.RELEASE_EVIDENCE_DIR||'G:/My Drive/GNC/AgData/Release Evidence';
  const release=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version;
  const raw=await fs.readFile(path.join(root,'.env'),'utf8');
  const url=new URL(raw.match(/^GNC_SUPABASE_DB_URL\s*=\s*(.+)$/m)[1].replace(/^['"]|['"]$/g,''));url.searchParams.delete('sslmode');
  const db=new pg.Client({connectionString:url.toString(),ssl:{rejectUnauthorized:false}});
  const proof={release,user:'dylan_collyge',switches:[],scroll:[],errors:[],consoleErrors:[],httpErrors:[]};
  let browser,page,databaseOpen=false;
  try {
    await db.connect();databaseOpen=true;
    const key=(await db.query("select decrypted_secret from vault.decrypted_secrets where name='hr_calendar_service_role_key' limit 1")).rows[0].decrypted_secret;
    const profile=(await db.query("select p.id,u.email from public.profiles p join auth.users u on u.id=p.id where p.username='dylan_collyge'")).rows[0];
    async function authPost(route,body){const response=await fetch('https://kzrnyjsosryejjejliii.supabase.co/auth/v1/'+route,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Native session exchange failed '+response.status);return response.json();}
    const link=await authPost('admin/generate_link',{type:'magiclink',email:profile.email});
    const session=await authPost('verify',{type:'magiclink',token_hash:link.hashed_token||link.properties?.hashed_token});
    assert.equal(session.user?.id,profile.id);await db.end();databaseOpen=false;
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    const healthResponse=await fetch('https://kzrnyjsosryejjejliii.supabase.co/rest/v1/rpc/get_eval_request_delivery_health_snapshot_v2',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:'{}'});
    assert.equal(healthResponse.status,200);proof.deliveryHealth=await healthResponse.json();assertDeliveryOrderHealth(proof.deliveryHealth);
    await context.addInitScript(value=>localStorage.setItem('gnc_supabase_auth_v1',JSON.stringify(value)),session);
    page=await context.newPage();const started=Date.now();
    page.on('pageerror',error=>proof.errors.push(error.message.slice(0,180)));
    page.on('console',message=>{if(message.type()==='error')proof.consoleErrors.push(message.text().slice(0,180));});
    page.on('response',async response=>{if(response.status()<400)return;const entry={path:new URL(response.url()).pathname,status:response.status()};proof.httpErrors.push(entry);try{const body=response.request().postDataJSON();entry.action=body?.action;entry.operation=body?.operation;entry.table=body?.table;const result=await response.json();entry.code=String(result.code||result.error||'').slice(0,120);}catch{}});
    await page.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded',timeout:20000});
    await page.waitForFunction(()=>typeof currentUser!=='undefined'&&currentUser==='dylan_collyge'&&nativeAuthSessionActive&&!initialAppLoadActive&&!nativeAuthProfileRestorePending,null,{timeout:120000});
    proof.role=await page.evaluate(()=>nativeAuthProfile.role);assert.match(proof.role,/super[-_ ]?admin/i);
    await page.evaluate(()=>{switchView('managers');setHomeTab('dashboard');renderManagers();});
    await page.locator('[data-manager-module="table-management"]').waitFor({state:'visible',timeout:10000});
    proof.duplicateCards=await page.evaluate(()=>[...document.querySelectorAll('#managers-content [data-manager-module]')].map(node=>node.dataset.managerModule).filter(id=>['company-directory','item-inquiry-coverage','assigned-items-export','customer-rep-map','access-control','production-schedule','av-blanks-photo-bypass','season-settings','season-priority','crop-roll'].includes(id)));
    assert.deepEqual(proof.duplicateCards,[]);
    await page.locator('[data-manager-module="table-management"]').click();
    await page.locator('#view-table-management').waitFor({state:'visible'});
    if(process.env.BUNCH_NOTES_PROOF==='1'){await verifyBunchNotes(page,proof,evidence);}else{
    const directory=page.locator('[data-table-directory]');
    const directoryProof=await directory.evaluate(root=>({count:root.querySelectorAll('[data-manager-table-card]').length,columns:getComputedStyle(root).gridTemplateColumns.split(' ').length,names:[...root.querySelectorAll('[data-manager-table-card]')].map(c=>c.textContent.trim()),clipped:[...root.querySelectorAll('.manager-module-title')].filter(n=>n.scrollWidth>n.clientWidth+1||n.scrollHeight>n.clientHeight+1).length}));
    proof.directory=directoryProof;assert.equal(directoryProof.count,18);assert.equal(directoryProof.columns,2);assert.equal(directoryProof.clipped,0);assert.equal(directoryProof.names.filter(n=>/SCHEDULE/i.test(n)).length,1);assert.equal(await page.locator('.table-management-pills').count(),0);
    await page.locator('#managers-search').fill('president');assert.equal(await page.locator('[data-manager-table-card]:visible').count(),1);await page.locator('#managers-search').fill('');
    await page.screenshot({path:path.join(evidence,'table-management-directory.png')});
    for(const [key,scrollSelector,toolbarSelector] of [['company-directory','.tm-scroll','.tm-toolbar'],['assigned-items','.ai-desktop-scroll','.assigned-items-toolbar'],['user-role-access','.agdata-access-matrix','.agdata-access-controls'],['president-command-center','.nursery-scroll','.nursery-toolbar']]){
      const result=await page.locator('[data-manager-table-card="'+key+'"]').evaluate(button=>{const key=button.dataset.managerTableCard,start=performance.now();button.click();const root=document.getElementById('view-table-management');return {key,milliseconds:performance.now()-start,selected:root?.dataset.selectedTable,directory:!!root?.querySelector('[data-table-directory]'),barHeight:root?.querySelector('[data-table-selector]')?.getBoundingClientRect().height};});
      proof.switches.push(result);assert.equal(result.selected,key);assert.equal(result.directory,false);assert.equal(result.barHeight,44);assert.ok(result.milliseconds<=2000);assert.equal(await page.locator('#view-managers .manager-module-freeze').isVisible(),false);
      await page.locator('[data-table-all]').waitFor({state:'visible'});await page.locator('[data-table-switch]').waitFor({state:'visible'});
      if(key==='user-role-access'){await page.getByRole('button',{name:/Change By User/i}).click();}
      await page.locator(scrollSelector+' tbody tr').nth(1).waitFor({state:'visible',timeout:120000});
      if(key==='president-command-center')await page.locator('[data-nursery-filter="location"]').selectOption('ALL_LOCATIONS');
      const measure=()=>page.evaluate(({scrollSelector,toolbarSelector})=>{const root=document.getElementById('view-table-management'),scroll=root.querySelector(scrollSelector);return {selectorTop:root.querySelector('[data-table-selector]').getBoundingClientRect().top,toolbarTop:root.querySelector(toolbarSelector).getBoundingClientRect().top,headerTop:scroll.querySelector('thead th').getBoundingClientRect().top,scrollTop:scroll.scrollTop,viewportHeight:innerHeight};},{scrollSelector,toolbarSelector});
      const before=await measure();await page.locator(scrollSelector).evaluate(node=>{node.scrollTop=1000;});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const after=await measure();proof.pendingScroll={key,before,after};assertPinnedTableGeometry(before,after);
      const whiteBoxes=await page.locator('#view-table-management').evaluate(root=>[...root.querySelectorAll('section,div,header,footer,form,table,th,td,input,select,button')].filter(n=>{const r=n.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(n).backgroundColor==='rgb(255, 255, 255)';}).length);assert.equal(whiteBoxes,0);proof.scroll.push({key,before,after,whiteBoxes});await page.screenshot({path:path.join(evidence,'table-management-'+key+'.png')});
      const back=await page.evaluate(()=>{const start=performance.now();document.querySelector('[data-table-all]').click();return {milliseconds:performance.now()-start,count:document.querySelectorAll('[data-manager-table-card]').length};});assert.equal(back.count,18);result.backMilliseconds=back.milliseconds;
      await page.locator('[data-manager-table-card="'+key+'"]').click();await page.locator('[data-table-switch]').selectOption('company-directory');assert.equal(await page.locator('#view-table-management').getAttribute('data-selected-table'),'company-directory');
      const headerBack=await page.evaluate(()=>{const start=performance.now();document.getElementById('global-header-inline-back').click();return {milliseconds:performance.now()-start,count:document.querySelectorAll('[data-manager-table-card]').length};});assert.equal(headerBack.count,18);result.headerBackMilliseconds=headerBack.milliseconds;
    }
    await page.locator('#global-header-inline-back').click();await page.locator('[data-manager-module="table-management"]').waitFor({state:'visible'});proof.backToModules=true;
    }
    proof.browserSeconds=(Date.now()-started)/1000;
    assert.deepEqual(proof.errors,[]);assert.deepEqual(proof.consoleErrors,[]);assert.deepEqual(proof.httpErrors,[]);
    proof.pass=true;
  } catch(error){proof.pass=false;proof.failure=String(error.message||error).slice(0,700);if(page)await page.screenshot({path:path.join(evidence,'table-management-failure.png'),timeout:5000}).catch(()=>{});}
  finally {if(browser)await browser.close();if(databaseOpen)await db.end().catch(()=>{});await fs.mkdir(evidence,{recursive:true});await fs.writeFile(path.join(evidence,'table-management-browser-proof.json'),JSON.stringify(proof,null,2)+'\n');}
  console.log(JSON.stringify({pass:proof.pass,tables:proof.switches.length,scrollProofs:proof.scroll.length,seconds:proof.browserSeconds,maxSwitchMs:Math.max(0,...proof.switches.map(x=>x.milliseconds)),errors:proof.errors.length+proof.consoleErrors.length+proof.httpErrors.length,bunch:proof.bunch?{cards:proof.bunch.cards,rules:proof.bunch.rules,saveMilliseconds:proof.bunch.saveMilliseconds}:undefined,failure:proof.failure}));
  process.exit(proof.pass?0:1);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await verify();
