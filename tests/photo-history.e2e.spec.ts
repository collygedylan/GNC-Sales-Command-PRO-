import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
const moduleCode = readFileSync('assets/photo-history-v2026090401.js','utf8');

async function setup(page: any, mobile = false) {
  if(mobile)await page.setViewportSize({width:390,height:844});
  await page.route('**/history-fixture', (route:any)=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><button id="open">Open Photo History</button></body></html>'}));
  await page.route('**/fixtures/**',(route:any)=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="green"/></svg>'}));
  await page.goto('/history-fixture');
  await page.addScriptTag({content:moduleCode});
  await page.evaluate(()=>{
    const w=window as any;w.calls=[];w.allow=true;w.failSend=false;w.status='pending';w.shares=[];
    w.bridge={actorKey:'dylan_collyge',allowed:()=>w.allow,request:async(operation:string,input:any)=>{
      w.calls.push({operation,input:JSON.parse(JSON.stringify(input))});
      if(operation==='search'){
        const offset=input.cursor?Number(input.cursor.id)+1:0;
        const rows=Array.from({length:120},(_,i)=>({id:String(i),commonname:input.q?'Lemon Grass':'Plant '+i,itemcode:'004740.013.1',contsize:'1GP',filename:'lemon-'+i+'.jpg',photo_at:'2026-06-04T12:00:00Z',locationcode:'D.07.032',lotcode:'26.S1',thumbnailUrl:'/fixtures/thumb-'+i+'.svg',storage_available:true}));
        return {ok:true,photos:rows.slice(offset,offset+36),hasMore:offset+36<120,asOf:'2026-09-04T00:00:00Z',indexedAt:'2026-09-04T00:00:00Z'};
      }
      if(operation==='recipients')return{ok:true,recipients:[{id:'rep1',name:'Test Sales Rep'}]};
      if(operation==='asset')return{ok:true,url:'/fixtures/original-'+input.id+'.svg'};
      if(operation==='send'){
        if(w.failSend){w.failSend=false;throw new Error('Network interrupted');}
        w.shares=[{id:'share1',photo_count:input.ids.length,recipient_name:'Test Sales Rep',status:w.status,delivered:w.status==='delivered'}];
        return{ok:true,id:'share1'};
      }
      if(operation==='dismiss')w.shares=[];
      if(operation==='retry')w.shares=w.shares.map((s:any)=>({...s,status:'pending',delivered:false}));
      return {ok:true,shares:w.shares};
    }};
    document.querySelector('#open')!.addEventListener('click',()=>w.GncPhotoHistory.open(w.bridge));
  });
  await page.getByRole('button',{name:'Open Photo History',exact:true}).click();
  await expect(page.locator('.phg-card').first()).toBeVisible();
}

test('mobile gallery auto-loads without Load More, bounds DOM and never downloads originals while scrolling',async({page})=>{
  const originals:string[]=[];page.on('request',r=>{if(r.url().includes('/original-'))originals.push(r.url());});
  await setup(page,true);
  await expect(page.getByRole('button',{name:/Load More/i})).toHaveCount(0);
  for(let i=0;i<5;i++){
    await page.locator('#phg-scroll').evaluate(e=>{e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event('scroll'));});
    await page.waitForTimeout(150);
  }
  await expect(page.locator('#phg-count')).toContainText('120 matching photos');
  expect(await page.locator('.phg-card').count()).toBeLessThan(25);
  expect(originals).toEqual([]);
});

test('selection survives searches, native input keeps focus and explicit open fetches one original',async({page})=>{
  const originals:string[]=[];page.on('request',r=>{if(r.url().includes('/original-'))originals.push(r.url());});
  await setup(page,true);
  await page.getByRole('checkbox').first().check();
  const search=page.getByRole('searchbox');await search.fill('Lemon Grass');await page.waitForTimeout(400);
  await expect(search).toBeFocused();await expect(search).toHaveValue('Lemon Grass');
  await expect(page.locator('#phg-selection-count')).toContainText('1 photos selected');
  await page.getByRole('button',{name:'Open photo',exact:true}).first().click();
  await expect(page.locator('.phg-viewer img')).toBeVisible();expect(originals).toHaveLength(1);
  await page.getByRole('button',{name:'Back to gallery'}).click();
  await expect(search).toHaveValue('Lemon Grass');await expect(page.getByRole('checkbox').first()).toBeChecked();
});

test('single email submission uses IDs only and an interrupted retry keeps the same token',async({page})=>{
  await setup(page);
  await expect(page.locator('.phg-tray')).toContainText('Dylan and JD are included automatically with the selected sales rep');
  await page.getByRole('checkbox').nth(0).check();await page.getByRole('checkbox').nth(1).check();
  await page.locator('#phg-recipientId').selectOption('rep1');await page.locator('#phg-message-input').fill('Historical choices');
  await page.evaluate(()=>{(window as any).failSend=true;});
  await page.getByRole('button',{name:'Send One Email'}).click();
  await expect(page.getByRole('button',{name:'Retry Same Send'})).toBeVisible();
  await page.getByRole('button',{name:'Retry Same Send'}).click();
  const calls=await page.evaluate(()=>(window as any).calls.filter((c:any)=>c.operation==='send'));
  expect(calls).toHaveLength(2);expect(calls[0].input).toEqual(calls[1].input);expect(calls[0].input.ids).toHaveLength(2);
  expect(Object.keys(calls[0].input).sort()).toEqual(['idempotencyKey','ids','message','recipientId']);
  await expect(page.locator('#phg-selection-count')).toContainText('0 photos selected');
  await expect(page.locator('#phg-notices')).toBeEmpty();
});

test('terminal notices survive close/reopen, delivered sends have no retry and dismiss is persistent',async({page})=>{
  await setup(page);await page.evaluate(()=>{(window as any).status='delivered';});
  await page.getByRole('checkbox').first().check();await page.locator('#phg-recipientId').selectOption('rep1');
  await page.getByRole('button',{name:'Send One Email'}).click();await expect(page.locator('#phg-notices')).toContainText('Email Sent');
  await page.getByRole('button',{name:'Close Photo History'}).click();await page.getByRole('button',{name:'Open Photo History',exact:true}).click();
  await expect(page.locator('#phg-notices')).toContainText('Email Sent');await expect(page.locator('#phg-notices').getByRole('button',{name:'Retry'})).toHaveCount(0);
  await page.getByRole('button',{name:'Dismiss',exact:true}).click();await expect(page.locator('#phg-notices')).toBeEmpty();
});

test('thumbnail failure shows retry without original fallback and revoked access cannot reopen',async({page})=>{
  await setup(page,true);
  await page.route('**/fixtures/thumb-0.svg',r=>r.abort());
  await page.getByRole('searchbox').fill('failure');await page.waitForTimeout(350);
  await page.locator('.phg-card').first().locator('img').evaluate(img=>img.dispatchEvent(new Event('error')));
  await expect(page.getByRole('button',{name:'Retry thumbnail'}).first()).toBeVisible();
  expect(await page.evaluate(()=>(window as any).calls.filter((c:any)=>c.operation==='asset'&&c.input.open).length)).toBe(0);
  await page.getByRole('button',{name:'Close Photo History'}).click();await page.evaluate(()=>{(window as any).allow=false;});
  await page.getByRole('button',{name:'Open Photo History',exact:true}).click();await expect(page.locator('#photo-history-dialog')).not.toBeVisible();
});

test('different approved accounts keep separate gallery selections and messages on the same device',async({page})=>{
  await setup(page);
  await page.getByRole('checkbox').first().check();
  await page.locator('#phg-message-input').fill('Dylan draft');
  await page.getByRole('button',{name:'Close Photo History'}).click();
  await page.evaluate(()=>{const w=window as any;w.GncPhotoHistory.open({...w.bridge,actorKey:'madison_austin'});});
  await expect(page.locator('#phg-selection-count')).toContainText('0 photos selected');
  await expect(page.locator('#phg-message-input')).toHaveValue('');
  await page.getByRole('checkbox').nth(1).check();
  await page.locator('#phg-message-input').fill('Madison draft');
  await page.getByRole('button',{name:'Close Photo History'}).click();
  await page.evaluate(()=>{const w=window as any;w.GncPhotoHistory.open({...w.bridge,actorKey:'madelyn_gray'});});
  await expect(page.locator('#phg-selection-count')).toContainText('0 photos selected');
  await expect(page.locator('#phg-message-input')).toHaveValue('');
  await page.getByRole('button',{name:'Close Photo History'}).click();
  await page.evaluate(()=>{const w=window as any;w.GncPhotoHistory.open(w.bridge);});
  await expect(page.locator('#phg-selection-count')).toContainText('1 photos selected');
  await expect(page.locator('#phg-message-input')).toHaveValue('Dylan draft');
  await expect(page.getByRole('checkbox').first()).toBeChecked();
});

for(const username of ['dylan_collyge','madison_austin','madelyn_gray'])test(`${username} can open real Sales Photo History with native input focus; other managers cannot`,async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.route('**/functions/v1/app-api',route=>{
    const body=route.request().postDataJSON();
    const data=body.operation==='search'?{ok:true,photos:[],hasMore:false,asOf:'2026-09-04',indexedAt:'2026-09-04'}:
      body.operation==='recipients'?{ok:true,recipients:[]}:{ok:true,shares:[]};
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto('/?e2e=photo-history-sales&post_deploy_access_canary=photo-history',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof (window as any).openDylanPhotoHistory==='function' && !!(window as any).GncPhotoHistory);
  const opened = await page.evaluate((username)=>{
    const w=window as any;
    w.installMutationBlockedAccessCanaryIdentity(username,username,'ADMIN');
    w.renderSalesHub();
    w.openDylanPhotoHistory();
    return !!document.querySelector('#photo-history-dialog');
  },username);
  expect(opened).toBe(true);
  await expect(page.locator('#photo-history-dialog')).toBeVisible();
  await page.getByRole('searchbox',{name:'Search Common Name, ITEMCODE or filename'}).fill('Lemon Grass');
  await page.waitForTimeout(500);
  await expect(page.locator('#phg-q')).toBeFocused();await expect(page.locator('#phg-q')).toHaveValue('Lemon Grass');
  const overflow=await page.locator('#photo-history-dialog').evaluate(e=>e.scrollWidth>e.clientWidth+1);expect(overflow).toBe(false);
  await page.getByRole('button',{name:'Close Photo History'}).click();
  await page.evaluate(()=>{const w=window as any;w.installMutationBlockedAccessCanaryIdentity('megan_kelly','Megan','ADMIN');w.renderSalesHub();w.openDylanPhotoHistory();});
  await expect(page.locator('#photo-history-dialog')).not.toBeVisible();
  await expect(page.locator('#sales-open-photo-history')).toBeHidden();
});
