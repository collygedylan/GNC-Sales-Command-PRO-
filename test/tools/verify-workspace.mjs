import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
const base=process.argv[2]||'https://agmetricapp.com/test/index.html';
if(!new URL(base).pathname.startsWith('/test/'))throw Error('TEST_URL_REQUIRED');
const evidence='G:/My Drive/GNC/AgData/Release Evidence';
const results=[];
async function verify(name,engine,viewport,full=false){
 const browser=await engine.launch({headless:true}),context=await browser.newContext({viewport,acceptDownloads:true,serviceWorkers:'block'}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const at=Date.now();
 try{
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#home-tile-traffic',{state:'visible',timeout:45000});
  assert.equal(await page.locator('#home-dashboard-grid [data-home-module-view]').count(),14);
  assert.ok(await page.locator('#home-tile-wingding').isVisible());
  assert.ok(!(await page.locator('body').innerText()).includes('Sign in to AgData Test'));
  await page.locator('#home-tile-traffic').click();
  await page.waitForSelector('[data-check-in]',{timeout:30000});
  assert.ok(await page.locator('#global-header-inline-back').isVisible());
  assert.ok(await page.locator('#footer-menu-btn').isVisible());
  const selector=page.locator('[data-check-in="TEST-DEMO-34"]').first();
  assert.deepEqual(await selector.locator('option').evaluateAll(options=>options.map(o=>o.value)),['','Trailer','Live Driver']);
  if(full){
   const original=await selector.inputValue();await selector.selectOption('Live Driver');
   await page.waitForFunction(()=>document.querySelector('[data-load="TEST-DEMO-34"] .test-rush-label'));
   const durable=await page.evaluate(async()=>{const {data,error}=await getSupabaseBrowserClient().rpc('test_ops_snapshot');if(error)throw error;return data.lines.filter(l=>l.load_id==='TEST-DEMO-34').every(l=>l.is_rush_priority);});assert.ok(durable);
   await page.locator('[data-view="wingding"]').click();assert.ok(await page.locator('.test-item-card').first().getAttribute('class').then(c=>c.includes('test-rush')));
   await page.locator('[data-view="traffic"]').click();await page.locator('[data-check-in="TEST-DEMO-34"]').first().selectOption(original);
   await page.waitForFunction(()=>document.querySelector('.test-notice')?.textContent.includes('Saved'));
  }
  await page.locator('[data-view="docks"]').click();await page.locator('[data-action="open-dock"][data-id="34"]').click();
  assert.ok(await page.locator('[data-drill-level="2"]').isVisible());await page.locator('[data-action="open-drop"]').first().click();
  assert.ok(await page.locator('[data-drill-level="3"]').isVisible());assert.ok(await page.locator('.test-item-card').count()>0);
  assert.equal(await page.locator('.test-item-card').first().locator('.test-six-metrics .test-kpi').count(),6);
  assert.ok(!/Dock Dock|Dock T\d/.test(await page.locator('#test-operations').innerText()));
  await page.locator('#global-header-inline-back').click();assert.ok(await page.locator('[data-drill-level="2"]').isVisible());
  await page.locator('#global-header-inline-back').click();assert.ok(await page.locator('[data-drill-level="1"]').isVisible());
  if(full){await page.locator('[data-view="traffic"]').click();await page.locator('[data-action="traffic-tab"][data-id="completed"]').click();assert.ok((await page.locator('.test-shipped-table').innerText()).includes('8 / 10'));const download=page.waitForEvent('download');await page.locator('[data-action="manifest"]:not([disabled])').first().click();const file=await download;const target=path.join(evidence,'agdata-test-manifest.pdf');await file.saveAs(target);assert.equal((await fs.readFile(target)).subarray(0,5).toString(),'%PDF-');}
  const fresh=await browser.newContext({viewport,serviceWorkers:'block'}),deep=await fresh.newPage();deep.on('pageerror',e=>errors.push(e.message));await deep.goto(base+'#view-traffic',{waitUntil:'domcontentloaded'});await deep.waitForSelector('[data-check-in]',{state:'visible',timeout:45000});assert.ok(!(await deep.locator('body').innerText()).includes('Sign in to AgData Test'));
  assert.ok(await deep.locator('#global-header-inline-back').isVisible());assert.ok(await deep.locator('#footer-menu-btn').isVisible());
  assert.ok(await deep.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await deep.screenshot({path:path.join(evidence,'agdata-test-'+name+'.png')});assert.deepEqual(errors,[]);
  results.push({profile:name,passed:true,elapsedMs:Date.now()-at,pageErrors:errors.length});await fresh.close();
 }catch(error){results.push({profile:name,passed:false,error:error.message,elapsedMs:Date.now()-at});throw error;}finally{await browser.close();}
}
try{const profiles=[['desktop',chromium,{width:1280,height:900},true],['android',chromium,{width:390,height:844}],['iphone',webkit,{width:390,height:844}]];const checks=await Promise.allSettled(profiles.filter(p=>!process.argv[3]||p[0]===process.argv[3]).map(p=>verify(...p)));if(checks.some(r=>r.status==='rejected'))throw Error('WORKSPACE_BROWSER_CHECK_FAILED');console.log(JSON.stringify({passed:results.length,results}));}
catch(error){console.error(error.message);process.exitCode=1;}
finally{await fs.writeFile(path.join(evidence,'agdata-test-workspace-browser.json'),JSON.stringify({base,results},null,2));}
