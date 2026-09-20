import {test,expect} from '@playwright/test';
import {installHlOrderFixture,hlUserId} from './fixtures/hl-order-state.mjs';

const plant=(id:string,location:string)=>({unique_id:id,blockalpha:'FULL.BLOCK',locationcode:location,itemcode:'BN-I',commonname:'Bunch Plant',contsize:'#3',lotcode:'27.F1',season:'27.F1',stock:'0',available:null,flags:'Blue',location_notes:'Wide aisles'});
async function fixture(page:any,baseURL:string,worker=false) {
 const control=await installHlOrderFixture(page,baseURL,{username:worker?'bn_worker':'dylan_collyge',role:worker?'EVAL':'ADMIN'});
 const rows=[plant('a','C.12.001'),plant('b','C.12.002')],commands:any[]=[],drafts:any[]=[];
 const jobs:any[]=worker?[{id:'work',note_number:'BN-1',block:'FULL.BLOCK',location:'C.12.001',status:'open',owner_id:null,revision:1,instruction_revision:1,progress:{},body:{purposes:'Rain day',instructions:'Keep aisles',actions:[{id:'a',group:'placement',scope:'location',instructions:'Center house'}],source:[rows[0]]},delivery_status:'not_sent'}]:[];
 const pdf={job_id:'work',filename:'BN-1_R1.pdf',base64:Buffer.from('%PDF-1.4\n'+ 'fixture '.repeat(40)).toString('base64')};
 await page.route('**/functions/v1/app-api',async(route:any)=>{
  const body=route.request().postDataJSON(); if(body.action!=='bunch_note')return route.fallback();
  const p=body.payload||{};commands.push(body);let data:any={};
  if(body.operation==='blocks')data={blocks:['FULL.BLOCK']};
  else if(body.operation==='inventory')data={rows};
  else if(body.operation==='directory')data={users:[{id:hlUserId,username:'dylan_collyge',display:'Dylan',email:'dylan_collyge@greenleafnursery.com'}]};
  else if(body.operation==='drafts')data={drafts};
  else if(body.operation==='save'){const draft={id:'draft',revision:(drafts[0]?.revision||0)+1,block:p.body.block,body:structuredClone(p.body),updated_at:new Date().toISOString()};draft.body.locations.forEach((l:any)=>{l.source=rows.filter(r=>l.row_ids.includes(r.unique_id));});drafts[0]=draft;data={draft};}
  else if(body.operation==='preview')data={preview:{id:'preview',reports:drafts[0].body.locations,recipients:[{email:'dylan_collyge@greenleafnursery.com'}]}};
  else if(body.operation==='publish'){drafts[0].body.locations.forEach((l:any,i:number)=>jobs.push({id:'job'+i,block:'FULL.BLOCK',location:l.location,body:l,status:'open',owner_id:null,revision:1,instruction_revision:1,progress:{},note_number:'BN-'+i,delivery_status:'queued'}));data={published:true};}
  else if(body.operation==='list')data={jobs};
  else if(body.operation==='get')data={job:jobs.find(j=>j.id===p.job_id),versions:[],audit:[]};
  else if(body.operation==='claim'){jobs[0].owner_id=hlUserId;jobs[0].revision++;data={job:jobs[0]};}
  else if(body.operation==='progress'){jobs[0].progress[p.action_id]={status:p.status,reason:p.reason};jobs[0].revision++;data={job:jobs[0]};}
  else if(body.operation==='complete'){jobs[0].status='complete';jobs[0].revision++;data={job:jobs[0]};}
  else throw new Error('Unexpected Bunch command '+body.operation);
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,data})});
 });
 await page.route('https://script.google.com/**',async(route:any)=>{
  let body:any;try{body=route.request().postDataJSON();}catch{return route.fallback();}
  if(body?.type!=='bunch_note_preview')return route.fallback();
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,pdfs:drafts[0].body.locations.map((l:any,i:number)=>({...pdf,job_id:'job'+i,filename:'BN-'+i+'.pdf'}))})});
 });
 return {control,commands,jobs};
}
test('creator selects full block and multiple locations, persists draft and reviews PDFs before publish',async({page,baseURL})=>{
 const f=await fixture(page,baseURL!);
 await page.locator('#home-tile-bunch-note').click();
 await page.getByLabel('Block',{exact:true}).selectOption('FULL.BLOCK');
 await page.getByLabel('C.12.001',{exact:true}).check();await page.getByLabel('C.12.002',{exact:true}).check();
 await expect(page.locator('#bunch-note-content')).toContainText('Available Unknown');
 for(const [i,card] of (await page.locator('#bunch-note-content section.bn-card').all()).entries()) {
  await card.getByLabel('Purposes',{exact:true}).fill('Rain day '+i);
  await card.getByRole('button',{name:'Add for whole location',exact:true}).click();
 }
 await page.getByRole('button',{name:'Save draft',exact:true}).click();
 await expect.poll(()=>f.commands.filter(c=>c.operation==='save').length).toBe(1);
 await page.getByRole('button',{name:'Preview PDFs and recipients',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Review Bunch Notes PDFs'})).toBeVisible();
 await expect(page.locator('#bunch-note-content iframe')).toHaveCount(2);
 await expect(page.locator('#bunch-note-content')).toContainText('dylan_collyge@greenleafnursery.com');
 await expect.poll(async()=>{const r=await page.locator('#bunch-note-content').boundingBox();return !!r&&r.x+r.width<=page.viewportSize()!.width+1;}).toBe(true);
 await page.getByRole('button',{name:'Publish and email reviewed PDFs',exact:true}).click();
 await expect.poll(()=>f.jobs.length).toBe(2);
 expect(f.commands.find(c=>c.operation==='publish').payload.send_email).toBe(true);
 expect(f.control.blockedMutations).toEqual([]);
});
test('worker without Request permission sees Bunch-only Queue, claims and completes without email',async({page,baseURL})=>{
 const f=await fixture(page,baseURL!,true);
 await page.evaluate(()=>window.eval(`getRequestCapabilities = () => ({canViewQueue:false}); canSeeEvalWorkRequestTab = () => false; switchView('request');`));
 await expect(page.locator('#home-tile-bunch-note')).toBeHidden();
 await expect(page.locator('[data-request-category="bunch-notes"]')).toBeVisible();
 await expect(page.locator('[data-request-category="pending"]')).toHaveCount(0);
 await page.getByRole('button',{name:'Open',exact:true}).click();
 await page.getByRole('button',{name:'Claim work',exact:true}).click();
 await page.getByRole('button',{name:'My Work',exact:true}).click();
 await page.getByRole('button',{name:'Open',exact:true}).click();
 await expect(page.getByRole('button',{name:'Complete location',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await page.getByRole('button',{name:'Complete location',exact:true}).click();
 await page.getByRole('button',{name:'Completed',exact:true}).click();
 await expect(page.locator('#request-content')).toContainText('BN-1');
 expect(f.commands.some(c=>['send','publish','preview','retry'].includes(c.operation))).toBe(false);
});
