import {test,expect} from '@playwright/test';
import {installHlOrderFixture,hlUserId} from './fixtures/hl-order-state.mjs';

const plant=(id:string,location:string)=>({unique_id:id,blockalpha:'FULL.BLOCK',locationcode:location,itemcode:'BN-I',commonname:'Bunch Plant',contsize:'#3',lotcode:'27.F1',salesyear:'27',season:'27.Y',desigitem:'',stock:'10',review:'0',available:null,flags:'Blue',location_notes:'Wide aisles'});
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
 const rows=[plant('a','C.12.001'),{...plant('a2','C.12.001'),contsize:'#5',lotcode:'LOT2',season:'27.F1',stock:'20',review:null},plant('b','C.12.002')],commands:any[]=[],drafts:any[]=[];
 const options:any[]=[['sequence','Early protection','instruction'],['grading','Shear before bunching','instruction'],['grading','Grade and Save / Move To','move'],['placement','Center house','instruction'],['placement','Variety mixes','instruction'],['inventory','TA / culls follow-up','ta'],['inventory','Move','move'],['hauling','Grade shift','hauling']].map(([category,label,kind],i)=>({id:'option'+i,category,label,kind,active:true,revision:1}));
 let lastPreview:any=null;
 let actualReply:Promise<void>|null=null; let saveFailures=0;
 const jobs:any[]=worker?[{id:'work',note_number:'BN-1',block:'FULL.BLOCK',location:'C.12.001',status:'open',owner_id:null,revision:1,instruction_revision:1,progress:{},body:{purposes:'Rain day',instructions:'Keep aisles',actions:[{id:'a',group:'placement',scope:'location',instructions:'Center house'},{id:'ta',group:'inventory',kind:'ta',label:'TA / culls follow-up',scope:'rows',row_ids:['a'],instructions:'TA / culls follow-up',quantity:'5'},{id:'move',group:'inventory',kind:'move',label:'Move',scope:'rows',row_ids:['a'],instructions:'Move',quantity:'4'}],source:[rows[0],rows[1]]},actuals:[],worker_actions:[],delivery_status:'not_sent'}]:[];
 const pdf={job_id:'work',filename:'BN-1_R1.pdf',base64:fixturePdf()};
 await page.route('**/functions/v1/app-api',async(route:any)=>{
  if(route.request().method()!=='POST')return route.fallback();
  const body=route.request().postDataJSON(); if(body?.action!=='bunch_note')return route.fallback();
  const p=body.payload||{};commands.push(body);let data:any={};
  if(body.operation==='save'&&saveFailures-->0){await route.fulfill({status:503,headers,contentType:'application/json',body:JSON.stringify({ok:false,message:'Save unavailable. Your draft is retained.'})});return;}
  if(body.operation==='catalog')data={options,locations:['C.12.001','C.12.002','D.08.001']};
  else if(body.operation==='option_add'){if(worker){expect(p.job_id).toBe(jobs[0].id);expect(body.expectedRevision).toBe(jobs[0].revision);}const option={id:'custom'+options.length,category:p.category,label:p.label,kind:p.kind,active:true,revision:1};options.push(option);data={option};}
  else if(body.operation==='destination_lookup')data={itemcode:'BN-I',salesyear:'2027',locations:['C.12.001','C.12.002','D.08.001'],matching:[rows[2]]};
  else if(body.operation==='destinations')data={locations:['C.12.001','C.12.002','D.08.001']};
  else if(body.operation==='destination_detail')data={location:p.location,locations:['C.12.001','C.12.002','D.08.001'],jobs:jobs.filter(j=>j.location===p.location),incoming:jobs.flatMap(j=>(j.body.actions||[]).filter((a:any)=>a.destination===p.location).map((action:any)=>({job_id:j.id,note_number:j.note_number,source_location:j.location,status:j.status,action,source:j.body.source||[],planned_here:true,actuals:[]})))};
  else if(body.operation==='blocks')data={blocks:['FULL.BLOCK']};
  else if(body.operation==='inventory')data={rows};
  else if(body.operation==='directory')data={users:[{id:hlUserId,username:'dylan_collyge',display:'Dylan',email:'dylan_collyge@greenleafnursery.com'}]};
  else if(body.operation==='drafts')data={drafts};
  else if(body.operation==='save'){const draft={id:'draft',revision:(drafts[0]?.revision||0)+1,block:p.body.block,body:structuredClone(p.body),updated_at:new Date().toISOString()};draft.body.locations.forEach((l:any)=>{l.source=rows.filter(r=>l.row_ids.includes(r.unique_id));});drafts[0]=draft;data={draft};}
  else if(body.operation==='preview'){lastPreview={id:'preview',reports:drafts[0].body.locations,recipients:[{email:'dylan_collyge@greenleafnursery.com'}]};data={preview:lastPreview};}
  else if(body.operation==='work_preview'){lastPreview={id:'work-preview',report_kind:'completed_work',job_revision:jobs[0].revision,reports:[jobs[0].body],recipients:[{email:'dylan_collyge@greenleafnursery.com'}]};data={preview:lastPreview};}
  else if(body.operation==='work_publish')data={published:true};
  else if(body.operation==='publish'){drafts[0].body.locations.forEach((l:any,i:number)=>jobs.push({id:'job'+i,block:'FULL.BLOCK',location:l.location,body:l,status:'open',owner_id:null,revision:1,instruction_revision:1,progress:{},note_number:'BN-'+i,delivery_status:'queued'}));data={published:true};}
  else if(body.operation==='list')data={jobs};
  else if(body.operation==='get')data={job:jobs.find(j=>j.id===p.job_id),versions:[],work_reports:[],audit:[]};
  else if(body.operation==='claim'){jobs[0].owner_id=hlUserId;jobs[0].revision++;data={job:jobs[0]};}
  else if(body.operation==='add_action'){jobs[0].worker_actions.push({...p.action,worker_added:true});jobs[0].revision++;data={job:jobs[0]};}
  else if(body.operation==='actual'){if(actualReply){await actualReply;actualReply=null;}if(!/^[1-9][0-9]*$/.test(String(p.quantity))&&!p.replaces_id)throw new Error('Invalid actual quantity submitted');const j=jobs[0],action=[...j.body.actions,...j.worker_actions].find((a:any)=>a.id===p.action_id),source=j.body.source.find((r:any)=>r.unique_id===p.source_id);if(p.replaces_id)j.actuals.find((a:any)=>a.id===p.replaces_id).superseded=true;j.actuals.push({id:'actual'+j.actuals.length,action_id:action.id,action_snapshot:action,source_snapshot:source,quantity:Number(p.quantity),destination:p.destination,explanation:p.explanation,replaces_id:p.replaces_id,review_flags:[],created_at:new Date().toISOString()});delete j.progress[action.id];j.revision++;data={job:j};}
  else if(body.operation==='progress'){jobs[0].progress[p.action_id]={status:p.status,reason:p.reason};jobs[0].revision++;data={job:jobs[0]};}
  else if(body.operation==='complete'){jobs[0].status='complete';jobs[0].revision++;data={job:jobs[0]};}
  else throw new Error('Unexpected Bunch command '+body.operation);
  await route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify({ok:true,data})});
 });
 await page.route('https://script.google.com/**',async(route:any)=>{
  if(route.request().method()!=='POST')return route.fallback();
  let body:any;try{body=route.request().postDataJSON();}catch{return route.fallback();}
  if(body?.type!=='bunch_note_preview')return route.fallback();
  await route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify({ok:true,pdfs:lastPreview.reports.map((l:any,i:number)=>({...pdf,job_id:'job'+i,filename:'BN-'+i+'.pdf'}))})});
 });
 return {control,commands,jobs,rows,failNextSave:()=>{saveFailures=1;},holdActualReply:()=>{let release!:()=>void;actualReply=new Promise<void>(resolve=>{release=resolve;});return release;}};
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
 await page.getByRole('button',{name:'Open location C.12',exact:true}).click();
 for(const [i,location] of ['C.12.001','C.12.002'].entries()) {
  await page.getByRole('button',{name:'Open location '+location,exact:true}).click();
  await page.getByLabel('Purposes',{exact:true}).fill('Rain day '+i);
  await expect(page.locator('.bn-plant')).toHaveCount(0);
  await page.getByRole('button',{name:'Next: Items',exact:true}).click();
  await expect(page.getByLabel('Purposes',{exact:true})).toHaveCount(0);
  await expect(page.locator('.bn-plant')).toHaveCount(1);
  await expect(page.locator('.bn-plant')).toContainText('LOC Available Unknown');
  await expect(page.locator('.bn-plant')).toContainText(i===0?'LOC On Hand 30':'LOC On Hand 10');
  await page.getByRole('checkbox',{name:'Select item BN-I',exact:true}).uncheck();
  await page.getByRole('checkbox',{name:'Select item BN-I',exact:true}).check();
  if(i===0){
   await page.getByRole('button',{name:'Open item BN-I',exact:true}).click();
   const choices=page.locator('.bn-plant .bn-action-choices');
   for(const [category,label] of [['Placement','Center house'],['Inventory','TA / culls follow-up'],['Inventory','Move'],['Shift/Hauling','Grade shift']]){
    const group=choices.locator('details').filter({has:page.locator('summary').filter({hasText:new RegExp('^'+category.replace('/','\\/')+'$')})});
    if(await group.getAttribute('open')===null)await group.locator('summary').click();
    await group.getByRole('button',{name:label,exact:true}).click();
    await expect(page.getByRole('textbox',{name:'Instruction',exact:true})).toHaveValue(label);
    if(['Move','Grade shift'].includes(label)){
     await page.getByLabel('Planned quantity',{exact:true}).fill('4');
     await page.getByRole('button',{name:'Choose location',exact:true}).click();
     await page.getByRole('button',{name:'Open location C.12',exact:true}).click();
     await page.getByRole('button',{name:'Open location C.12.002',exact:true}).click();
     await expect(page.locator('.bn-destination')).toContainText('Move to: C.12.002');
    }
    await page.getByRole('button',{name:'Done',exact:true}).click();
   }
   await choices.getByText('Sequence',{exact:true}).click();
   await choices.getByRole('button',{name:'Add custom Sequence option',exact:true}).click();
   await page.getByLabel('Option name',{exact:true}).fill('Check walkway');
   await expect(page.getByLabel('Option name')).toHaveCSS('font-size','16px');
   await expect.poll(()=>page.getByLabel('Option name').evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThan(150);
   await page.getByRole('button',{name:'Save custom option and continue',exact:true}).click();
   await page.getByRole('button',{name:'Done',exact:true}).click();
   await page.locator('#global-header-inline-back').click();
  } else {
   const checklist=page.locator('.bn-location-editor > details').filter({has:page.locator('summary').filter({hasText:'Whole-location actions'})});
   await checklist.locator('summary').first().click();
   await checklist.getByText('Sequence',{exact:true}).click();
   await checklist.getByRole('button',{name:'Check walkway',exact:true}).click();
   await page.getByRole('button',{name:'Done',exact:true}).click();
  }
  await expect.poll(()=>page.locator('#bunch-note-content').evaluate(el=>[el,...el.querySelectorAll('button,summary,input,select,textarea,.bn-card')].every(node=>{const box=node.getBoundingClientRect();return !box.width||(box.left>=-1&&box.right<=innerWidth+1);}))).toBe(true);
  await expect.poll(()=>page.locator('#bunch-note-content button:visible, #bunch-note-content summary:visible').evaluateAll(nodes=>nodes.every(n=>n.getBoundingClientRect().height>=44))).toBe(true);
  await page.locator('#global-header-inline-back').click();
  await page.locator('#global-header-inline-back').click();
 }
 await page.locator('#global-header-inline-back').click();
 await page.locator('#global-header-inline-back').click();
 await expect(page.getByRole('button',{name:'Open batch FULL.BLOCK',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Open batch FULL.BLOCK',exact:true}).click();
 await page.getByRole('button',{name:'Open location C.12',exact:true}).click();
 await page.getByRole('button',{name:'Open location C.12.001',exact:true}).click();
 await expect(page.getByLabel('Purposes',{exact:true})).toHaveCount(0);
 await expect(page.locator('#bunch-note-content')).toContainText('Rain day 0');
 await page.getByRole('button',{name:'Open item BN-I',exact:true}).click();
 await page.getByRole('button',{name:'Edit Center house',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Instruction',exact:true})).toHaveValue('Center house');
 await page.locator('#global-header-inline-back').click();
 await page.locator('#global-header-inline-back').click();
 const saved=f.commands.filter(c=>c.operation==='save').at(-1).payload.body;
 expect(saved.locations.map((l:any)=>l.location)).toEqual(['C.12.001','C.12.002']);
 expect(saved.locations[0].actions[0].row_ids).toEqual(['a','a2']);
 expect(saved.locations[0].actions.find((a:any)=>a.group==='hauling').row_ids).toEqual(['a']);
 expect(saved.locations[0].actions.filter((a:any)=>['ta','move'].includes(a.kind))).toHaveLength(2);
 expect(saved.locations[1].actions[0].scope).toBe('location');
 await page.getByRole('button',{name:'Preview PDFs and recipients',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Review Bunch Notes PDFs'})).toBeVisible();
 await expect(page.locator('#bunch-note-content iframe')).toHaveCount(2);
 await expect(page.locator('#bunch-note-content')).toContainText('dylan_collyge@greenleafnursery.com');
 await expect.poll(async()=>{const r=await page.locator('#bunch-note-content').boundingBox();return !!r&&r.x+r.width<=page.viewportSize()!.width+1;}).toBe(true);
 await page.getByRole('button',{name:'Publish and email reviewed PDFs',exact:true}).click();
 await expect.poll(()=>f.jobs.length).toBe(2);
 expect(f.commands.find(c=>c.operation==='publish').payload.send_email).toBe(true);
 f.jobs[0].status='complete';f.jobs[0].actuals=[];f.jobs[0].worker_actions=[];
 await page.evaluate(()=>window.eval(`switchView('request'); setReqTab('bunch-notes');`));
 await page.getByRole('button',{name:'Completed',exact:true}).click();
 await page.getByRole('button',{name:'Open location C.12',exact:true}).click();
 await page.getByRole('button',{name:'Open location C.12.001',exact:true}).click();
 await page.getByRole('button',{name:'Open',exact:true}).click();
 await page.getByText('Completed-work PDF and recipients',{exact:true}).click();
 await page.getByRole('button',{name:'Preview completed-work PDF',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Review Completed Work PDFs',exact:true})).toBeVisible();
 await expect(page.locator('#bunch-note-content iframe')).toHaveCount(1);
 await page.getByRole('button',{name:'Save and email reviewed PDF',exact:true}).click();
 await expect.poll(()=>f.commands.filter(c=>c.operation==='work_publish').length).toBe(1);
 expect(f.control.blockedMutations).toEqual([]);
});

test('combined move keeps its full destination and opens destination instructions',async({page,baseURL})=>{
 const f=await fixture(page,baseURL!);
 await page.locator('#home-tile-bunch-note').click();
 for(const name of ['Open block FULL.BLOCK','Open location C.12','Open location C.12.001'])await page.getByRole('button',{name,exact:true}).click();
 await page.getByLabel('Purposes',{exact:true}).fill('Grade and move');
 await page.getByRole('button',{name:'Next: Items',exact:true}).click();
 await page.getByRole('button',{name:'Open item BN-I',exact:true}).click();
 const grading=page.locator('.bn-plant .bn-action-choices details').filter({has:page.locator('summary').filter({hasText:/^Grading$/})});
 await grading.locator('summary').click();
 await grading.getByRole('button',{name:'Grade and Save / Move To',exact:true}).click();
 await page.getByLabel('Planned quantity',{exact:true}).fill('4');
 await page.getByRole('button',{name:/^(Choose location|Change location)$/,exact:true}).click();
 await page.getByRole('button',{name:'All other locations',exact:true}).click();
 await expect(page.getByRole('button',{name:'Open location D.08',exact:true})).toBeVisible();
 await page.getByLabel('New full destination',{exact:true}).fill('NEW.PAD');
 await page.getByRole('button',{name:'Use typed destination',exact:true}).click();
 await expect(page.locator('.bn-destination')).toContainText('Move to: NEW.PAD');
 await page.getByRole('button',{name:/^(Choose location|Change location)$/,exact:true}).click();
 await page.getByRole('button',{name:'Open location C.12',exact:true}).click();
 await expect(page.locator('#bunch-note-content')).toContainText('Available Unknown');
 await page.getByRole('button',{name:'Open location C.12.002',exact:true}).click();
 await expect(page.locator('.bn-destination')).toContainText('Move to: C.12.002');
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await page.locator('#global-header-inline-back').click();
 const body=f.commands.filter(c=>c.operation==='save').at(-1).payload.body;
 expect(body.locations[0].actions[0]).toMatchObject({quantity:'4',destination:'C.12.002',destination_mode:'matching'});
 f.jobs.push({id:'source',note_number:'BN-1',status:'open',location:'C.12.001',body:body.locations[0]},
  {id:'destination',note_number:'BN-2',status:'open',location:'C.12.002',body:{purposes:'Leave wide aisles',actions:[]}});
 await page.getByRole('button',{name:'By Destination',exact:true}).click();
 await page.getByRole('button',{name:'Open location C.12',exact:true}).click();
 await page.getByRole('button',{name:'Open location C.12.002',exact:true}).click();
 await expect(page.locator('#bunch-note-content')).toContainText('Leave wide aisles');
 await expect(page.locator('#bunch-note-content')).toContainText('Planned here: 4');
 await expect(page.locator('#bunch-note-content')).toContainText('Recorded here: Not recorded');
 await page.locator('#global-header-inline-back').click();
 await expect(page.getByRole('button',{name:'Open location C.12.001',exact:true})).toBeVisible();
 expect(f.control.blockedMutations).toEqual([]);
});
test('worker without Request permission sees Bunch-only Queue, claims and completes without email',async({page,baseURL})=>{
 const f=await fixture(page,baseURL!,true);
 await page.evaluate(()=>window.eval(`getRequestCapabilities = () => ({canViewQueue:false}); canSeeEvalWorkRequestTab = () => false; switchView('request');`));
 await expect(page.locator('#home-tile-bunch-note')).toBeHidden();
 await expect(page.locator('[data-request-category="bunch-notes"]')).toBeVisible();
 await expect(page.locator('[data-request-category="pending"]')).toHaveCount(0);
 await page.getByRole('button',{name:'Open location C.12',exact:true}).click();
 await page.getByRole('button',{name:'Open location C.12.001',exact:true}).click();
 await page.getByRole('button',{name:'Open',exact:true}).click();
 await page.getByRole('button',{name:'Claim work',exact:true}).click();
 await page.getByRole('button',{name:'My Work',exact:true}).click();
 await expect(page.getByRole('button',{name:'My Work',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Open location C.12',exact:true}).click();
 await page.getByRole('button',{name:'Open location C.12.001',exact:true}).click();
 await page.getByRole('button',{name:'Open',exact:true}).click();
 await expect(page.getByRole('button',{name:'Complete location',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Open item BN-I',exact:true}).click();
 const action=(label:string)=>page.locator('#request-content article.bn-card').filter({has:page.getByRole('heading',{name:label,exact:true})});
 const ta=action('TA / culls follow-up'),move=action('Move');
 await ta.getByText('Record TA / partial work',{exact:true}).click();
 await ta.getByRole('combobox',{name:'Container size and lot',exact:true}).selectOption('a');
 await ta.getByLabel('Actual quantity',{exact:true}).fill('2');
 const releaseActual=f.holdActualReply();
 await ta.getByRole('button',{name:'Record entry',exact:true}).click();
 await expect(ta.getByLabel('Actual quantity',{exact:true})).toBeDisabled();
 await expect(ta.getByRole('combobox',{name:'Container size and lot',exact:true})).toBeDisabled();
 await expect(ta.getByRole('button',{name:'Record entry',exact:true})).toBeDisabled();
 releaseActual();
 await ta.getByLabel('Actual quantity',{exact:true}).fill('3');
 // A verified refresh arriving between pointerdown and click must not replace the button.
 await page.evaluate(async()=>{
  const note=(window as any).BunchNote,update=await note.stage({});
  document.getElementById('request-content')!.addEventListener('pointerdown',()=>note.commit(update),{capture:true,once:true});
 });
 await expect(ta.getByLabel('Actual quantity',{exact:true})).toHaveValue('3');
 await ta.getByRole('button',{name:'Record entry',exact:true}).click();
 await expect(ta).toContainText('Recorded 5 TA');
 const answers=['1','Corrected count'];const amend=(dialog:any)=>dialog.accept(answers.shift()!);
 page.on('dialog',amend);
 await ta.getByRole('button',{name:'Correct entry',exact:true}).first().click();
 await expect(ta).toContainText('Recorded 4 TA');
 page.off('dialog',amend);
 await ta.getByRole('textbox',{name:'Completion / variance reason',exact:true}).fill('Corrected count below plan');
 await ta.getByRole('button',{name:'Done',exact:true}).click();
 await move.getByText('Record MOVE / partial work',{exact:true}).click();
 for(const destination of ['C.12.002','NEW.LOC']){
  await move.getByRole('combobox',{name:'Container size and lot',exact:true}).selectOption('a');
  await move.getByLabel('Actual quantity',{exact:true}).fill('2');
  await move.getByLabel('Moved to',{exact:true}).fill(destination);
  await move.getByRole('button',{name:'Record entry',exact:true}).click();
 }
 await expect(move).toContainText('Recorded 4 MOVE');
 await expect(move).toContainText('NEW.LOC');
 await move.getByRole('button',{name:'Done',exact:true}).click();

 const inventory=page.locator('.bn-plant .bn-action-choices details').filter({has:page.locator('summary').filter({hasText:/^Inventory$/})});
 await inventory.locator('summary').click();
 await inventory.getByRole('button',{name:'Add custom Inventory option',exact:true}).click();
 await page.getByLabel('Option name',{exact:true}).fill('Inspect empty spaces');
 await page.getByRole('button',{name:'Save custom option and continue',exact:true}).click();
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await expect(action('Inspect empty spaces · Added by worker')).toBeVisible();
 await action('Inspect empty spaces · Added by worker').getByRole('button',{name:'Done',exact:true}).click();
 await page.locator('#global-header-inline-back').click();
 await action('placement').getByRole('button',{name:'Done',exact:true}).click();
 await expect.poll(()=>page.locator('#request-content').evaluate(el=>[el,...el.querySelectorAll('button,summary,input,select,textarea,.bn-card')].every(node=>{const box=node.getBoundingClientRect();return !box.width||(box.left>=-1&&box.right<=innerWidth+1);}))).toBe(true);
 await page.getByRole('button',{name:'Complete location',exact:true}).click();
 await page.getByRole('button',{name:'Completed',exact:true}).click();
 await page.getByRole('button',{name:'Open location C.12',exact:true}).click();
 await page.getByRole('button',{name:'Open location C.12.001',exact:true}).click();
 await expect(page.locator('#request-content')).toContainText('BN-1');
 expect(f.commands.some(c=>['send','publish','preview','retry'].includes(c.operation))).toBe(false);
});


test('phone steps retain failed saves and make mixed-year and unknown-year destinations reachable',async({page,baseURL})=>{
 const f=await fixture(page,baseURL!);f.rows[1].salesyear='';
 await page.locator('#home-tile-bunch-note').click();
 for(const name of ['Open block FULL.BLOCK','Open location C.12','Open location C.12.001'])await page.getByRole('button',{name,exact:true}).click();
 await page.getByLabel('Purposes',{exact:true}).fill('Move safely');f.failNextSave();
 await page.getByRole('button',{name:'Next: Items',exact:true}).click();
 await expect(page.locator('#bunch-note-content [role=alert]')).toContainText('Save unavailable');
 await expect(page.getByLabel('Purposes',{exact:true})).toHaveValue('Move safely');
 await page.getByRole('button',{name:'Next: Items',exact:true}).evaluate((el:HTMLButtonElement)=>{el.click();el.click();});
 await expect(page.getByRole('button',{name:'Open item BN-I',exact:true})).toBeVisible();
 expect(f.commands.filter(c=>c.operation==='save')).toHaveLength(2);
 await page.getByRole('button',{name:'Open item BN-I',exact:true}).click();
 await page.locator('.bn-action-choices').getByText('Inventory',{exact:true}).click();
 await page.getByRole('button',{name:'Move',exact:true}).click();
 await expect(page.getByRole('button',{name:'Choose location',exact:true})).toBeInViewport();
 await page.getByLabel('Planned quantity',{exact:true}).fill('3');
 await page.getByLabel('Source item and sales year',{exact:true}).selectOption('BN-I|2027');
 await page.getByRole('button',{name:'Choose location',exact:true}).click();
 await page.getByRole('button',{name:'Open location C.12',exact:true}).click();
 await page.getByRole('button',{name:'Open location C.12.002',exact:true}).click();
 await page.getByLabel('Source item and sales year',{exact:true}).selectOption('BN-I|');
 await expect(page.locator('.bn-destination')).not.toContainText('C.12.002');
 await page.getByRole('button',{name:'Choose location',exact:true}).click();
 await expect(page.getByRole('button',{name:'Locations with this item',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Open location D.08',exact:true}).click();
 await page.getByRole('button',{name:'Open location D.08.001',exact:true}).click();
 await expect(page.locator('.bn-destination')).toContainText('Move to: D.08.001');
 f.failNextSave();await page.getByRole('button',{name:'Done',exact:true}).click();
 await expect(page.getByLabel('Planned quantity',{exact:true})).toHaveValue('3');
 await expect(page.locator('.bn-destination')).toContainText('D.08.001');
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await page.goBack();
 await expect(page.getByRole('button',{name:'Open item BN-I',exact:true})).toBeVisible();
 const saved=f.commands.filter(c=>c.operation==='save').at(-1).payload.body.locations[0];
 expect(saved.actions).toHaveLength(1);expect(saved.actions[0]).toMatchObject({destination:'D.08.001',row_ids:['a2'],quantity:'3'});expect(saved.source_all).toHaveLength(2);
 expect(f.control.blockedMutations).toEqual([]);
});
