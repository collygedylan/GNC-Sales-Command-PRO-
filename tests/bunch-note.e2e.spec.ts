import {test,expect} from '@playwright/test';
import {installHlOrderFixture,hlUserId} from './fixtures/hl-order-state.mjs';

const plant=(id:string,location:string)=>({unique_id:id,blockalpha:'FULL.BLOCK',locationcode:location,itemcode:'BN-I',commonname:'Bunch Plant',contsize:'#3',lotcode:'27.F1',season:'27.F1',stock:'0',available:null,flags:'Blue',location_notes:'Wide aisles'});
function fixturePdf() {
 const stream='BT /F1 12 Tf 30 70 Td (Bunch Note preview fixture) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
 let pdf='%PDF-1.4\n';const offsets=[0];
 objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});
 const start=Buffer.byteLength(pdf);
 pdf+=`xref\n0 ${offsets.length}\n0000000000 65535 f \n`+offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
 return Buffer.from(pdf).toString('base64');
}
async function fixture(page:any,baseURL:string,worker=false) {
 const control=await installHlOrderFixture(page,baseURL,{username:worker?'bn_worker':'dylan_collyge',role:worker?'EVAL':'ADMIN'});
 const headers={'access-control-allow-origin':new URL(baseURL).origin,'access-control-allow-credentials':'true'};
 const rows=[plant('a','C.12.001'),plant('b','C.12.002')],commands:any[]=[],drafts:any[]=[];
 const jobs:any[]=worker?[{id:'work',note_number:'BN-1',block:'FULL.BLOCK',location:'C.12.001',status:'open',owner_id:null,revision:1,instruction_revision:1,progress:{},body:{purposes:'Rain day',instructions:'Keep aisles',actions:[{id:'a',group:'placement',scope:'location',instructions:'Center house'}],source:[rows[0]]},delivery_status:'not_sent'}]:[];
 const pdf={job_id:'work',filename:'BN-1_R1.pdf',base64:fixturePdf()};
 await page.route('**/functions/v1/app-api',async(route:any)=>{
  if(route.request().method()!=='POST')return route.fallback();
  const body=route.request().postDataJSON(); if(body?.action!=='bunch_note')return route.fallback();
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
  await route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify({ok:true,data})});
 });
 await page.route('https://script.google.com/**',async(route:any)=>{
  if(route.request().method()!=='POST')return route.fallback();
  let body:any;try{body=route.request().postDataJSON();}catch{return route.fallback();}
  if(body?.type!=='bunch_note_preview')return route.fallback();
  await route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify({ok:true,pdfs:drafts[0].body.locations.map((l:any,i:number)=>({...pdf,job_id:'job'+i,filename:'BN-'+i+'.pdf'}))})});
 });
 return {control,commands,jobs};
}
test('creator drills through themed block/location cards and preserves multiple locations through PDF review',async({page,baseURL},testInfo)=>{
 const f=await fixture(page,baseURL!);
 await page.locator('#home-tile-bunch-note').click();
 await page.evaluate(project=>{
  document.body.classList.add('ops-precision-pilot');
  document.body.dataset.opsTheme=project==='cache-android'?'dark':'light';
  document.documentElement.classList.toggle('outdoor-mode',project==='cache-iphone');
 },testInfo.project.name);
 const block=page.getByRole('button',{name:'Open block FULL.BLOCK',exact:true});
 await expect(block).toBeVisible();
 await expect.poll(()=>block.evaluate(el=>{const probe=document.createElement('span');probe.style.color='var(--ops-surface)';el.append(probe);const same=getComputedStyle(el).backgroundColor===getComputedStyle(probe).color;probe.remove();return same;})).toBe(true);
 await block.click();
 for(const [i,location] of ['C.12.001','C.12.002'].entries()) {
  await page.getByRole('button',{name:'Open location '+location,exact:true}).click();
  await page.getByLabel('Purposes',{exact:true}).fill('Rain day '+i);
  await expect(page.locator('.bn-plant')).toContainText('Available Unknown');
  const selection=page.locator('.bn-plant input[type="checkbox"]');
  const sharedAction=page.getByRole('button',{name:'Add for selected plant rows',exact:true});
  await selection.uncheck();
  await expect(sharedAction).toBeDisabled();
  await selection.check();
  await expect(sharedAction).toBeEnabled();
  if(i===0){
   await page.locator('.bn-plant summary').click();
   await page.getByRole('combobox',{name:'Action for this plant',exact:true}).selectOption({label:'placement — Center house'});
   await page.getByRole('button',{name:'Add instruction for this plant',exact:true}).click();
   await expect(page.getByRole('textbox',{name:'Instruction',exact:true})).toHaveValue('Center house');
  } else await page.getByRole('button',{name:'Add for whole location',exact:true}).click();
  await expect.poll(()=>page.locator('#bunch-note-content').evaluate(el=>[el,...el.querySelectorAll('button,summary,input,select,textarea,.bn-card')].every(node=>{const box=node.getBoundingClientRect();return !box.width||(box.left>=-1&&box.right<=innerWidth+1);}))).toBe(true);
  await expect.poll(()=>page.locator('#bunch-note-content button:visible, #bunch-note-content summary:visible').evaluateAll(nodes=>nodes.every(n=>n.getBoundingClientRect().height>=44))).toBe(true);
  await page.getByRole('button',{name:'Back to locations',exact:true}).click();
 }
 await page.getByRole('button',{name:'Save & back to blocks',exact:true}).click();
 await expect.poll(()=>f.commands.filter(c=>c.operation==='save').length).toBe(1);
 await page.getByRole('button',{name:'Open batch FULL.BLOCK',exact:true}).click();
 await page.getByRole('button',{name:'Open location C.12.001',exact:true}).click();
 await expect(page.getByLabel('Purposes',{exact:true})).toHaveValue('Rain day 0');
 await expect(page.getByRole('textbox',{name:'Instruction',exact:true})).toHaveValue('Center house');
 await page.getByRole('button',{name:'Back to locations',exact:true}).click();
 const saved=f.commands.find(c=>c.operation==='save').payload.body;
 expect(saved.locations.map((l:any)=>l.location)).toEqual(['C.12.001','C.12.002']);
 expect(saved.locations[0].actions[0].row_ids).toEqual(['a']);
 expect(saved.locations[1].actions[0].scope).toBe('location');
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
 await expect(page.getByRole('button',{name:'My Work',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Open',exact:true}).click();
 await expect(page.getByRole('button',{name:'Complete location',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await page.getByRole('button',{name:'Complete location',exact:true}).click();
 await page.getByRole('button',{name:'Completed',exact:true}).click();
 await expect(page.locator('#request-content')).toContainText('BN-1');
 expect(f.commands.some(c=>['send','publish','preview','retry'].includes(c.operation))).toBe(false);
});
