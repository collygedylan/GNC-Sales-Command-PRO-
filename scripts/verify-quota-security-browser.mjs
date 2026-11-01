import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import pg from 'pg';

// Explicit release-only, read-only operational proof. Never start sync or send test mail.
const root = process.cwd();
const evidence = process.env.RELEASE_EVIDENCE_DIR || 'G:/My Drive/GNC/AgData/Release Evidence';
const release = JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version;
const raw = await fs.readFile(path.join(root,'.env'),'utf8');
const dbUrl = new URL(raw.match(/^GNC_SUPABASE_DB_URL\s*=\s*(.+)$/m)?.[1]?.replace(/^['"]|['"]$/g,'') || '');
dbUrl.searchParams.delete('sslmode');
const db = new pg.Client({connectionString:dbUrl.toString(),ssl:{rejectUnauthorized:false}});
let browser;
let databaseOpen = false;
const proof = {release,profile:'dylan_collyge',views:[],errors:[],consoleErrors:[],httpErrors:[],transformedRequests:0,idleAppApiCalls:0};
try {
  await db.connect();
  databaseOpen = true;
  const key = (await db.query("select decrypted_secret from vault.decrypted_secrets where name='hr_calendar_service_role_key' limit 1")).rows[0]?.decrypted_secret;
  const profile = (await db.query("select p.id,u.email from public.profiles p join auth.users u on u.id=p.id where p.username='dylan_collyge'")).rows[0];
  const base='https://kzrnyjsosryejjejliii.supabase.co';
  async function authPost(route,body) {
    const response=await fetch(base+'/auth/v1/'+route,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('Native session exchange failed '+response.status);
    return response.json();
  }
  const link=await authPost('admin/generate_link',{type:'magiclink',email:profile.email});
  const session=await authPost('verify',{type:'magiclink',token_hash:link.hashed_token||link.properties?.hashed_token});
  if(session.user?.id!==profile.id||!session.access_token)throw Error('Native identity verification failed');
  await db.end();
  databaseOpen = false;
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addInitScript(value=>localStorage.setItem('gnc_supabase_auth_v1',JSON.stringify(value)),session);
  const page=await context.newPage();let idle=false;
  page.on('pageerror',error=>proof.errors.push(error.message.slice(0,160)));
  page.on('console',message=>{if(message.type()==='error')proof.consoleErrors.push(message.text().slice(0,160));});
  page.on('request',request=>{
    if(request.url().includes('/storage/v1/render/image/'))proof.transformedRequests++;
    if(idle&&request.method()==='POST'&&request.url().includes('/functions/v1/app-api'))proof.idleAppApiCalls++;
  });
  page.on('response',response=>{if(response.status()>=400)proof.httpErrors.push({path:new URL(response.url()).pathname,status:response.status()});});
  const started=Date.now();
  await page.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded',timeout:20000});
  await page.waitForFunction(()=>typeof currentUser!=='undefined'&&currentUser==='dylan_collyge'&&nativeAuthSessionActive===true,null,{timeout:20000});
  await page.waitForFunction(()=>typeof initialAppLoadActive!=='undefined'&&!initialAppLoadActive&&!nativeAuthProfileRestorePending,null,{timeout:20000});
  proof.authorization=await page.evaluate(()=>({role:nativeAuthProfile?.role,user:currentUser}));
  if(!/super[-_ ]?admin/i.test(proof.authorization.role||''))throw Error('Super-admin role not verified');
  for(const view of ['home','drive','av','request','smart-moves','managers']) {
    await page.evaluate(view=>{switchView(view);if(view==='request')setReqTab('suspend-tag');if(view==='managers')openManagerTableManagement();},view);
    await page.locator('#view-'+view).waitFor({state:'visible',timeout:5000});
    const hydrationStarted=Date.now();
    await page.waitForFunction(view=>{
      const node=document.getElementById('view-'+view),text=node?.innerText||'';
      return text.trim().length>40&&!/LOADING DATA|Hydrating live inventory|Loading inventory/i.test(text);
    },view,{timeout:120000});
    proof.coldHydrationSeconds ||= {};
    proof.coldHydrationSeconds[view]=(Date.now()-hydrationStarted)/1000;
    const result=await page.locator('#view-'+view).evaluate(node=>({text:node.innerText.trim().slice(0,180),visible:node.getBoundingClientRect().height>0}));
    if(!result.visible||!result.text||/Row Details Unavailable|Load Failed|Verifying updated access/.test(result.text))throw Error('View did not render: '+view);
    proof.views.push({view,...result});
  }
  await page.evaluate(()=>switchView('home'));
  await page.waitForTimeout(1500);
  idle=true;const idleStarted=Date.now();await page.waitForTimeout(8000);idle=false;
  proof.idleObservationSeconds=(Date.now()-idleStarted)/1000;
  proof.browserSeconds=(Date.now()-started)/1000;
  proof.pass=proof.views.length===6&&proof.transformedRequests===0&&proof.idleAppApiCalls===0&&!proof.errors.length&&!proof.consoleErrors.length&&!proof.httpErrors.length;
} catch(error) { proof.pass=false;proof.failure=String(error.message||error).slice(0,220); }
finally {
  if(browser)await browser.close();
  if(databaseOpen)await db.end().catch(()=>{});
  await fs.mkdir(evidence,{recursive:true});
  await fs.writeFile(path.join(evidence,'quota-security-browser-proof.json'),JSON.stringify(proof,null,2)+'\n');
}
console.log(JSON.stringify({pass:proof.pass,views:proof.views.length,seconds:proof.browserSeconds,transformedRequests:proof.transformedRequests,idleAppApiCalls:proof.idleAppApiCalls,errors:proof.errors.length+proof.consoleErrors.length+proof.httpErrors.length,failure:proof.failure}));
process.exit(proof.pass?0:1);
