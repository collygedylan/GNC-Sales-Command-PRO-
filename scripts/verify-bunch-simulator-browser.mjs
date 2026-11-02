import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import pg from 'pg';

// Explicit release proof. --send is an opt-in real approval and Dylan-only email.
const root=process.cwd(),evidence=process.env.RELEASE_EVIDENCE_DIR||'G:/My Drive/GNC/AgData/Release Evidence';
const send=process.argv.includes('--send'),started=Date.now();
const raw=await fs.readFile(path.join(root,'.env'),'utf8');
const url=new URL(raw.match(/^GNC_SUPABASE_DB_URL\s*=\s*(.+)$/m)?.[1]?.replace(/^['"]|['"]$/g,'')||'');url.searchParams.delete('sslmode');
const db=new pg.Client({connectionString:url.toString(),ssl:{rejectUnauthorized:false}});
let browser,exit=0;
const proof={release:JSON.parse(await fs.readFile('package.json','utf8')).version,send,profiles:[],errors:[]};
try{
 await db.connect();
 const key=(await db.query("select decrypted_secret from vault.decrypted_secrets where name='hr_calendar_service_role_key' limit 1")).rows[0]?.decrypted_secret;
 const profile=(await db.query("select p.id,u.email from public.profiles p join auth.users u on u.id=p.id where p.username='dylan_collyge'")).rows[0];
 const authPost=async(route,body)=>{const r=await fetch('https://kzrnyjsosryejjejliii.supabase.co/auth/v1/'+route,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('NATIVE_AUTH_'+r.status);return r.json();};
 const link=await authPost('admin/generate_link',{type:'magiclink',email:profile.email}),session=await authPost('verify',{type:'magiclink',token_hash:link.hashed_token||link.properties?.hashed_token});
 assert.equal(session.user.id,profile.id);
 browser=await chromium.launch({headless:true});
 const results=await Promise.allSettled([{name:'mobile',width:390,height:844},{name:'desktop',width:1440,height:1000}].map(async viewport=>{
  const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},acceptDownloads:true,serviceWorkers:'block'});
  await context.addInitScript(value=>localStorage.setItem('gnc_supabase_auth_v1',JSON.stringify(value)),session);
  const page=await context.newPage(),entry={name:viewport.name,locations:[],pageErrors:[],consoleErrors:[],events:[]};proof.profiles.push(entry);
  page.on('pageerror',e=>entry.pageErrors.push(e.message.slice(0,200)));page.on('console',m=>{if(m.type()==='error')entry.consoleErrors.push(m.text().slice(0,200));});
  page.on('response',async response=>{if(response.status()>=400){entry.httpErrors||=[];entry.httpErrors.push({path:new URL(response.url()).pathname,status:response.status()});}if(response.url().includes('/functions/v1/app-api')&&response.request().postDataJSON()?.operation==='nursery_pdf'){const json=await response.json();entry.events.push(json?.data||json);}});
  try{
   await page.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded',timeout:20000});
   await page.waitForFunction(()=>typeof currentUser!=='undefined'&&currentUser==='dylan_collyge'&&nativeAuthSessionActive===true,null,{timeout:30000});
   await page.waitForFunction(()=>typeof initialAppLoadActive!=='undefined'&&!initialAppLoadActive&&!nativeAuthProfileRestorePending,null,{timeout:180000});
   entry.authorization=await page.evaluate(()=>({username:currentUser,role:nativeAuthProfile?.role}));assert.match(entry.authorization.role,/super[-_ ]?admin/i);
   await page.evaluate(()=>{switchView('managers');openManagerTableManagement('bunch-notes-simulator');});
   await page.waitForFunction(()=>getDatasetState('master').rowCompleteness==='complete'&&document.querySelectorAll('[data-bunch-alpha]').length===12,null,{timeout:180000});
   await page.waitForFunction(()=>document.querySelector('[data-bunch-ready="true"]'),null,{timeout:180000});
   assert.equal(await page.locator('[data-bunch-alpha]').count(),12);
   for(const location of ['F.05.000','G.10.000']){
    await page.evaluate(()=>document.querySelector('[data-toast-dismiss]')?.click());
    await page.locator('[data-bunch-alpha="'+location[0]+'"]').click();
    await page.locator('[data-bunch-location-open="'+location+'"]').click();
    await page.waitForFunction(()=>{const r=document.querySelector('[data-bunch-card]')?.getBoundingClientRect();return r&&r.height>60&&r.top<innerHeight;},null,{timeout:5000});
    const geometry=await page.locator('.bunch-drill-shell').evaluate(shell=>{const card=shell.querySelector('[data-bunch-card]'),scroll=shell.querySelector('.bunch-drill-scroll'),r=card?.getBoundingClientRect();return {cardCount:shell.querySelectorAll('[data-bunch-card]').length,eligibleCount:shell.querySelectorAll('[data-bunch-approval-ready="true"]').length,top:r?.top,height:r?.height,headerHeight:shell.querySelector('.bunch-drill-top').getBoundingClientRect().height,scrollHeight:scroll.getBoundingClientRect().height,contentHeight:scroll.scrollHeight,viewport:innerHeight};});
    assert.ok(geometry.cardCount>0);assert.ok(geometry.top<viewport.height&&geometry.height>60);assert.ok(geometry.headerHeight<=92);assert.ok(geometry.scrollHeight>=viewport.height*.75);
    await page.locator('.bunch-drill-scroll').evaluate(el=>{el.scrollTop=200;});assert.ok(await page.locator('.bunch-drill-scroll').evaluate(el=>el.scrollHeight<=el.clientHeight||el.scrollTop>0));await page.locator('.bunch-drill-scroll').evaluate(el=>{el.scrollTop=0;});
    await page.screenshot({path:path.join(evidence,'bunch-'+viewport.name+'-'+location+'.png')});
    const record={location,...geometry};entry.locations.push(record);
    if(viewport.name==='mobile'){
     const [download]=await Promise.all([page.waitForEvent('download',{timeout:20000}),page.locator('[data-bunch-pdf]').click()]);const pdfPath=path.join(evidence,download.suggestedFilename());await download.saveAs(pdfPath);assert.equal((await fs.readFile(pdfPath)).subarray(0,8).toString(),'%PDF-1.4');record.pdf=pdfPath;
     if(send){record.excludedForReview=await page.locator('[data-bunch-card]').evaluateAll(cards=>{let excluded=0;for(const card of cards){const checkbox=card.querySelector('[data-bunch-select]');if(card.dataset.bunchApprovalReady!=='true'){excluded++;checkbox.checked=false;checkbox.dispatchEvent(new Event('change',{bubbles:true}));}}return excluded;});assert.ok(record.excludedForReview<record.cardCount);record.approvalMs=await page.locator('[data-bunch-send]').evaluate(button=>{const start=performance.now();button.click();return performance.now()-start;});assert.ok(record.approvalMs<100);await page.waitForFunction(()=>/queued PDF email|sent PDF email/.test(document.querySelector('[data-nursery-status]')?.textContent||''),null,{timeout:180000});record.confirmation=await page.locator('[data-nursery-status]').innerText();}
    }
    await page.evaluate(()=>goBackUniversal());assert.equal(await page.locator('[data-bunch-drill-level]').getAttribute('data-bunch-drill-level'),'location');await page.evaluate(()=>goBackUniversal());assert.equal(await page.locator('[data-bunch-drill-level]').getAttribute('data-bunch-drill-level'),'alpha');
   }
   assert.deepEqual(entry.pageErrors,[]);assert.deepEqual(entry.consoleErrors,[]);
  }catch(error){entry.failure=await page.evaluate(()=>{const el=document.querySelector('[data-bunch-alpha]'),root=document.getElementById('view-table-management');return {body:document.body.innerText.slice(0,400),status:document.querySelector('[data-nursery-status]')?.textContent,view:document.body.dataset.currentView,chrome:{style:document.getElementById('app-top-chrome')?.getAttribute('style'),computed:getComputedStyle(document.getElementById('app-top-chrome')).clipPath,bodyMatch:document.body.matches('body[data-current-view="managers"]:has(.bunch-drill-shell)')},cover:document.elementsFromPoint(200,20).slice(0,5).map(el=>({id:el.id,class:el.className})),pdfResources:performance.getEntriesByType('resource').filter(e=>e.name.includes('bunch-note-pdf')).map(e=>e.name),base:document.baseURI,root:root?{rect:root.getBoundingClientRect().toJSON(),display:getComputedStyle(root).display}:null,alpha:el?{rect:el.getBoundingClientRect().toJSON(),display:getComputedStyle(el).display}:null};});await page.screenshot({path:path.join(evidence,'bunch-'+viewport.name+'-failure.png')});throw error;}finally{await context.close();}
 }));
 for(const result of results)if(result.status==='rejected')throw result.reason;
 if(send){const events=proof.profiles.flatMap(p=>p.events).map(e=>e.eventId).filter(Boolean);assert.equal(events.length,2);proof.outbox=(await db.query('select event_id,status,email_delivered_at,gmail_message_id from public.ph_request_delivery_outbox where event_id=any($1::uuid[])',[events])).rows;assert.equal(proof.outbox.length,2);}
 proof.pass=true;
}catch(error){exit=1;proof.pass=false;proof.errors.push(error.message);}
finally{proof.seconds=(Date.now()-started)/1000;await fs.mkdir(evidence,{recursive:true});await fs.writeFile(path.join(evidence,'bunch-simulator-browser-proof'+(send?'-send':'')+'.json'),JSON.stringify(proof,null,2)+'\n');await db.end();if(browser)await browser.close();console.log(JSON.stringify({pass:proof.pass,seconds:proof.seconds,errors:proof.errors,profiles:proof.profiles.map(p=>({name:p.name,locations:p.locations}))}));if(exit)process.exit(exit);process.exit(0);}
