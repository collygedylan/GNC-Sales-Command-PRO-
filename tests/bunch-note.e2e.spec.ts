import {test,expect} from '@playwright/test';

import {installHlOrderFixture,hlUserId} from './fixtures/hl-order-state.mjs';
// @test-group: @bunch-note,bunch-notes


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
async function fixture(page:any,baseURL:string,worker=false,directoryUsers:any[]=[{id:hlUserId,username:'dylan_collyge',display:'Dylan',email:'dylan_collyge@greenleafnursery.com'}]) {
 const control=await installHlOrderFixture(page,baseURL,{username:worker?'bn_worker':'dylan_collyge',role:worker?'EVAL':'ADMIN',beforeLogin:async()=>{
  // This fixture grants Bunch Notes access only. Return an explicit capability
  // denial for the unrelated voice module instead of an invalid generic payload.
  await page.route('**/functions/v1/aura-llm-router',async(route)=>route.fulfill({status:403,headers:{'access-control-allow-origin':new URL(baseURL).origin},contentType:'application/json',body:JSON.stringify({ok:false,code:'AURA_FORBIDDEN',message:'Voice access is not part of this fixture.'})}));
 }});
 const headers={'access-control-allow-origin':new URL(baseURL).origin,'access-control-allow-credentials':'true'};
 const rows=[plant('a','C.12.001'),{...plant('a2','C.12.001'),contsize:'#5',lotcode:'LOT2',season:'27.F1',stock:'20',review:null},plant('b','C.12.002')],commands:any[]=[],drafts:any[]=[],inventoryReads:any[]=[];
 const options:any[]=[['sequence','Early protection','instruction'],['grading','Shear before bunching','instruction'],['grading','Grade and Save / Move To','move'],['placement','Center house','instruction'],['placement','Variety mixes','instruction'],['inventory','TA / culls follow-up','ta'],['inventory','Move','move'],['hauling','Grade shift','hauling']].map(([category,label,kind],i)=>({id:'option'+i,category,label,kind,active:true,revision:1}));
 let lastPreview:any=null;
 let actualReply:Promise<void>|null=null; let saveFailures=0;
 const jobs:any[]=worker?[{id:'work',note_number:'BN-1',block:'FULL.BLOCK',location:'C.12.001',status:'open',owner_id:null,revision:1,instruction_revision:1,progress:{},body:{purposes:'Rain day',instructions:'Keep aisles',actions:[{id:'a',group:'placement',scope:'location',instructions:'Center house'},{id:'ta',group:'inventory',kind:'ta',label:'TA / culls follow-up',scope:'rows',row_ids:['a'],instructions:'TA / culls follow-up',quantity:'5'},{id:'move',group:'inventory',kind:'move',label:'Move',scope:'rows',row_ids:['a'],instructions:'Move',quantity:'4'}],source:[rows[0],rows[1]]},actuals:[],worker_actions:[],delivery_status:'not_sent'}]:[];
 const pdf={job_id:'work',filename:'BN-1_R1.pdf',base64:fixturePdf()};
 await page.route('**/functions/v1/app-api',async(route:any)=>{
  if(route.request().method()!=='POST')return route.fallback();
  const body=route.request().postDataJSON();
  if(body?.action==='bunch_note_workflow'){
   commands.push(body);
   if(body.operation!=='queue')throw new Error('Unexpected Bunch queue operation '+body.operation);
   const cards=jobs.map((job:any,index:number)=>{
    const location=job.body?.location||job.location||'C.12.001';
    const sourceRows=job.body?.source||job.body?.source_all||rows.filter((row:any)=>row.locationcode===location);
    const sources=(sourceRows||[]).map((row:any,i:number)=>({row_id:row.unique_id||`queue-source-${index}-${i}`,location,lot:row.lotcode||'LOT-A',ptravailable:Number(row.available||row.stock||10),actual_qty:null}));
    return {stablecard_id:`${job.id}:card-1`,job_id:job.id,card_id:'card-1',revision:job.revision||1,job_revision:job.revision||1,status:'open',can_complete:true,itemcode:'BN-I',variety:'Bunch Plant',contsize:'#3',source_location:location,lot:'',ptravailable:sources.reduce((sum:any,row:any)=>sum+(row.ptravailable||0),0),action:'Work',destination:'',notes:'Published Bunch Note',assignees:[],sources};
   });
   const data={cards,total:cards.length,active_count:cards.length,review_count:0,can_review:false,counters:[]};
   await route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify({ok:true,data})});return;
  }
  if(body?.action!=='bunch_note')return route.fallback();
  const p=body.payload||{};commands.push(body);let data:any;
  if(body.operation==='save'&&saveFailures-->0){await route.fulfill({status:503,headers,contentType:'application/json',body:JSON.stringify({ok:false,message:'Save unavailable. Your draft is retained.'})});return;}
  if(body.operation==='catalog')data={options,locations:['C.12.001','C.12.002','D.05.000','D.08.001']};
  else if(body.operation==='option_add'){if(worker){expect(p.job_id).toBe(jobs[0].id);expect(body.expectedRevision).toBe(jobs[0].revision);}const option={id:'custom'+options.length,category:p.category,label:p.label,kind:p.kind,active:true,revision:1};options.push(option);data={option};}
  else if(body.operation==='destination_lookup')data={itemcode:'BN-I',salesyear:'2027',locations:['C.12.001','C.12.002','D.05.000','D.08.001'],matching:[rows[2]]};
  else if(body.operation==='destinations')data={locations:['C.12.001','C.12.002','D.05.000','D.08.001']};
  else if(body.operation==='destination_detail')data={location:p.location,locations:['C.12.001','C.12.002','D.05.000','D.08.001'],jobs:jobs.filter(j=>j.location===p.location),incoming:jobs.flatMap(j=>(j.body.actions||[]).filter((a:any)=>a.destination===p.location).map((action:any)=>({job_id:j.id,note_number:j.note_number,source_location:j.location,status:j.status,action,source:j.body.source||[],planned_here:true,actuals:[]})))};
  else if(body.operation==='blocks')data={blocks:['FULL.BLOCK']};
  else if(body.operation==='inventory'){inventoryReads.push({block:p.block,locations:[...new Set(rows.map((row:any)=>row.locationcode))]});data={rows};}
  else if(body.operation==='directory')data={users:directoryUsers};
  else if(body.operation==='drafts')data={drafts};
  else if(body.operation==='save'){const draft={id:'draft',revision:(drafts[0]?.revision||0)+1,block:p.body.block,body:structuredClone(p.body),updated_at:new Date().toISOString()};draft.body.locations.forEach((l:any)=>{l.source=rows.filter(r=>l.row_ids.includes(r.unique_id));});drafts[0]=draft;data={draft};}
  else if(body.operation==='preview'){lastPreview={id:'preview',reports:drafts[0].body.locations,recipients:[{email:'dylan_collyge@greenleafnursery.com'}]};data={preview:lastPreview};}
  else if(body.operation==='pdf_preview')data={pdfs:(lastPreview?.reports||[]).map((report:any,i:number)=>({...pdf,job_id:`job${i}`,filename:`BN-${i}.pdf`}))};
  else if(body.operation==='work_preview'){lastPreview={id:'work-preview',report_kind:'completed_work',job_revision:jobs[0].revision,reports:[jobs[0].body],recipients:[{email:'dylan_collyge@greenleafnursery.com'}]};data={preview:lastPreview};}
  else if(body.operation==='work_publish')data={published:true};
  else if(body.operation==='publish'){drafts[0].body.locations.forEach((l:any,i:number)=>jobs.push({id:'job'+i,block:'FULL.BLOCK',location:l.location,body:l,status:'open',owner_id:null,revision:1,instruction_revision:1,progress:{},note_number:'BN-'+i,delivery_status:'queued'}));data={published:true};}
  else if(body.operation==='list')data={jobs};
  else if(body.operation==='get')data={job:jobs.find(j=>j.id===p.job_id),versions:[],work_reports:[],audit:[]};
  else if(body.operation==='claim'){jobs[0].owner_id=hlUserId;jobs[0].revision++;data={job:jobs[0]};}
   else if(body.operation==='claim_card'||body.operation==='complete_card'){
    const card=jobs[0].cards.find((item:any)=>item.id===p.card_id);
    if(!card)throw new Error('Unknown card '+p.card_id);
    expect(body.expectedRevision).toBe(card.revision);
    if(body.operation==='claim_card'){expect(card.owner_id).toBeNull();card.owner_id=hlUserId;}
    else {expect(card.owner_id).toBe(hlUserId);card.status='complete';}
    card.revision++;jobs[0].revision++;data={job:jobs[0]};
   }
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
 return {control,commands,jobs,rows,drafts,options,inventoryReads,get lastPreview(){return lastPreview;},failNextSave:()=>{saveFailures=1;},holdActualReply:()=>{let release!:()=>void;actualReply=new Promise<void>(resolve=>{release=resolve;});return release;}};
}
async function openBunchNotesFromInventory(page:any) {
 await expect(page.locator('#home-tile-bunch-note')).toHaveCount(0);
 await expect(page.locator('#home-tile-sales-inventory')).toBeVisible();
 const press=test.info().project.use.isMobile?'tap':'click';
 await page.locator('#home-tile-sales-inventory')[press]();
 await expect(page.locator('#hub-extra-sales-inventory-bunch-note')).toBeVisible();
 await expect(page.locator('#hub-extra-sales-inventory-bunch-note')).toContainText('Inv Bunch Notes');
 await page.locator('#hub-extra-sales-inventory-bunch-note')[press]();
 await expect(page.locator('#view-bunch-note')).toBeVisible();
 await expect(page.locator('#view-bunch-note')).toContainText('Inv Bunch Notes');
 await expect(page.locator('#global-header-view-title')).toHaveText('Inv Bunch Notes');
 await expect(page.locator('#global-header-inline-title')).toHaveText('Inv Bunch Notes');
}
async function openBunchNotesAfterCheckingQueueRemoval(page:any) {
 const press=test.info().project.use.isMobile?'tap':'click';
 await page.locator('#footer-home-btn')[press]();
 await openBunchNotesFromInventory(page);
}
async function openAssignedBunchWorkFromInventory(page:any) {
 await openBunchNotesFromInventory(page);
 const assigned=page.locator('#bn-assigned-work-mode');
 const press=test.info().project.use.isMobile?'tap':'click';
 if(await assigned.count()) {
  await expect(assigned).toBeVisible();
  await assigned[press]();
  await expect(assigned).toHaveAttribute('aria-pressed','true');
 } else {
  // Non-author workers enter the assigned queue directly; they must not gain
  // creator controls just to reach work assigned to them.
  await expect(page.locator('#bn-create-note-mode')).toHaveCount(0);
 }
}
async function wizardLocationButton(page:any, location:string, displayLocation=location.replace(/\.\d{3}$/, '.')) {
 const handler=`BunchNote.openLocation(${JSON.stringify(location)})`;
 const button=page.locator(`.bn-location-list .bn-drill-card[onclick=${JSON.stringify(handler)}]`);
 await expect(button).toHaveAccessibleName(`Open location ${displayLocation}`);
 return button;
}
async function openAuthorLocation(page:any, location:string, displayLocation=location.replace(/\.\d{3}$/, '.')) {
 const press=test.info().project.use.isMobile?'tap':'click';
 const section=page.locator('.bn-card-board__location').filter({has:page.locator('h3',{hasText:location})});
 const wizard=await wizardLocationButton(page,location,displayLocation);
 const legacy=section.getByRole('button',{name:'Location instructions',exact:true}).first();
 await expect(wizard.or(legacy)).toBeVisible();
 if(await wizard.count())await wizard[press]();
 else await legacy[press]();
}
async function advanceWizardToItems(page:any, workType?:string) {
 const input=page.getByLabel('Work type',{exact:true});
 if(await input.count()) {
  if(workType!==undefined)await input.fill(workType);
  await page.getByRole('button',{name:'Next',exact:true}).click();
 }
}
async function openAdvancedInventoryControls(page:any) {
 const details=page.locator('.bn-wizard-items > details.bn-options').first();
 await expect(details).toBeVisible();
 if(await details.getAttribute('open')===null)await details.locator('summary').click();
}

test('Inventory launches Bunch Note authoring while Que exposes the assigned-work queue', {tag:['@bunch-note']}, async ({page,baseURL}) => {
 await fixture(page,baseURL!);
 const press=test.info().project.use.isMobile?'tap':'click';
 await page.locator('#footer-request-btn')[press]();
 await expect(page.locator('[data-request-category="bunch-notes"]')).toBeVisible();
 // This author fixture is not entitled to discrepancy review; separate queue
 // E2E coverage verifies the Count Review category for an authorized reviewer.
 await expect(page.locator('[data-request-category="bunch-count-review"]')).toHaveCount(0);
 await page.locator('#footer-home-btn')[press]();
 await openBunchNotesFromInventory(page);
 await expect(page.locator('#bn-create-note-mode')).toBeVisible();
 await expect(page.locator('#bn-create-note-mode')).toHaveAttribute('aria-pressed','true');
});

test('Inventory step shortens D.05.000 for display but retains the full location code in the saved query and draft', {tag:['@bunch-note']}, async ({page,baseURL}) => {
 const f=await fixture(page,baseURL!);
 const press=test.info().project.use.isMobile?'tap':'click';
 const source={...plant('d05-source','D.05.000'),itemcode:'BN-D05',commonname:'D.05.000 source'};
 f.rows.push(source);
 await openBunchNotesFromInventory(page);
 await page.getByRole('button',{name:'Open block FULL.BLOCK',exact:true}).click();
 const locationButton=await wizardLocationButton(page,'D.05.000','D.05.');
 await expect(locationButton).toBeVisible();
 await expect(locationButton).toContainText('D.05.');
 await expect(locationButton).not.toContainText('D.05.000');
 await locationButton[press]();
 await page.getByLabel('Work type',{exact:true}).fill('Prepare D.05.000');
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await page.getByRole('button',{name:'＋ Add inventory card',exact:true})[press]();
 await page.getByRole('textbox',{name:'Search inventory',exact:true}).fill('BN-D05');
 const result=page.locator('.bn-picker-result').filter({hasText:'BN-D05'});
 await expect(result).toHaveCount(1);
 await result[press]();
 await page.getByRole('button',{name:'Continue to card details',exact:true})[press]();
 await expect(page.getByLabel('Select lot #3 27.F1 d05-source',{exact:true})).toBeChecked();
 await page.getByLabel('Assign to Dylan',{exact:true}).check();
 await page.getByLabel('Required card action',{exact:true}).selectOption('ta');
 await page.getByRole('button',{name:'＋ Add selected card(s) and continue',exact:true})[press]();

  // Wait for the serialized save and next-picker transition before Escape;
  // the modal intentionally ignores dismissal while a save is in flight.
  const content=page.locator('#bunch-note-content');
  await expect(content).toHaveAttribute('aria-busy','false');
  const savedCard=content.locator('.bn-sequence-card[data-sequence-id]').filter({hasText:'BN-D05'});
  await expect(savedCard).toContainText('BN-D05');
  await expect(savedCard).not.toContainText('d05-source');
  await expect(page.getByRole('textbox',{name:'Search inventory',exact:true})).toBeVisible();
  // The add-and-continue action intentionally opens the next picker. Close it
  // before using the header Back stack to validate the saved full location.
 await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog')).toHaveCount(0);

 const inventoryRead=f.commands.find(command=>command.operation==='inventory');
 expect(inventoryRead?.payload).toMatchObject({block:'FULL.BLOCK'});
 expect(f.inventoryReads).toContainEqual({block:'FULL.BLOCK',locations:['C.12.001','C.12.002','D.05.000']});
 const saved=f.commands.filter(command=>command.operation==='save').at(-1)?.payload.body.locations[0];
 expect(saved).toMatchObject({location:'D.05.000',row_ids:['d05-source']});
 expect(saved.cards[0]).toMatchObject({owner_ids:[hlUserId],workflow_action:'ta'});
 expect(saved.source_all).toEqual(expect.arrayContaining([expect.objectContaining({unique_id:'d05-source',locationcode:'D.05.000'})]));
 expect(saved.cards).toEqual(expect.arrayContaining([expect.objectContaining({row_ids:['d05-source']})]));

 await page.locator('#global-header-inline-back').click();
 await page.locator('#global-header-inline-back').click();
 await page.locator('#global-header-inline-back').click();
 await page.getByRole('button',{name:/Open batch FULL\.BLOCK/}).click();
 await openAuthorLocation(page,'D.05.000','D.05.');
 await expect(page.getByLabel('Work type',{exact:true})).toHaveValue('Prepare D.05.000');
 expect(f.drafts[0].body.locations[0].location).toBe('D.05.000');
});

test('Next and Save draft stay in normal flow below setup controls while scrolling', {tag:['@bunch-note']}, async ({page,baseURL}) => {
 await fixture(page,baseURL!);
 const press=test.info().project.use.isMobile?'tap':'click';
 await openBunchNotesFromInventory(page);
 await page.getByRole('button',{name:'Open block FULL.BLOCK',exact:true})[press]();
 const location=await wizardLocationButton(page,'C.12.001');
 await location[press]();

 const main=page.locator('#main-scroll-area');
 const setup=page.getByRole('region',{name:'Location setup'});
 const actions=setup.locator('xpath=following-sibling::*[1]');
 await expect(actions).toHaveClass(/bn-step-actions/);
 const advanced=setup.locator('details.bn-options').filter({hasText:'Advanced location controls'}).first();
 await expect(actions).toBeVisible();
 await expect(advanced).toBeVisible();
 await advanced.locator('summary').click();
 await expect(page.getByLabel('Purpose / Sequence Thread',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Direction',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Default House Plan',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Schedule / Prerequisite Alert',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Priority / work order',{exact:true})).toBeVisible();

 const layout=await actions.evaluate((element,scrollElement)=>{
  const style=getComputedStyle(element), box=element.getBoundingClientRect();
  const setupBox=(element.previousElementSibling as HTMLElement).getBoundingClientRect();
  const scrollBox=(scrollElement as HTMLElement).getBoundingClientRect();
  return {position:style.position,top:box.top,bottom:box.bottom,setupBottom:setupBox.bottom,scrollTop:(scrollElement as HTMLElement).scrollTop,scrollHeight:(scrollElement as HTMLElement).scrollHeight,clientHeight:(scrollElement as HTMLElement).clientHeight,viewportBottom:scrollBox.bottom};
 },await main.elementHandle());
 expect(layout.position).toBe('static');
 expect(layout.top).toBeGreaterThanOrEqual(layout.setupBottom-1);
 expect(layout.scrollHeight).toBeGreaterThan(layout.clientHeight);

 await main.evaluate(element=>{(element as HTMLElement).scrollTop=(element as HTMLElement).scrollHeight;});
 await expect.poll(()=>main.evaluate(element=>Math.round((element as HTMLElement).scrollTop))).toBeGreaterThan(0);
 const bottomPosition=await actions.evaluate(element=>({position:getComputedStyle(element).position,top:element.getBoundingClientRect().top,bottom:element.getBoundingClientRect().bottom}));
 expect(bottomPosition.position).toBe('static');
 const overlapsAtBottom=await actions.evaluate(element=>[...document.querySelectorAll('.bn-location-editor [data-bn-field]')].filter(field=>field.checkVisibility()&&(()=>{
  const actionBox=element.getBoundingClientRect(),fieldBox=field.getBoundingClientRect();
  return actionBox.left<fieldBox.right&&actionBox.right>fieldBox.left&&actionBox.top<fieldBox.bottom&&actionBox.bottom>fieldBox.top;
 })()).map(field=>(field as HTMLElement).dataset.bnField));
 expect(overlapsAtBottom).toEqual([]);

 await main.evaluate(element=>{(element as HTMLElement).scrollTop=0;});
 await expect.poll(()=>main.evaluate(element=>Math.round((element as HTMLElement).scrollTop))).toBe(0);
 const topPosition=await actions.evaluate(element=>({position:getComputedStyle(element).position,top:element.getBoundingClientRect().top,bottom:element.getBoundingClientRect().bottom}));
 expect(topPosition.position).toBe('static');
 expect(topPosition.bottom).toBeGreaterThan(0);
 expect(topPosition.top).toBeGreaterThanOrEqual(0);
 expect(topPosition.top).toBeGreaterThanOrEqual(await setup.evaluate(element=>element.getBoundingClientRect().top));
 const overlapsAtTop=await actions.evaluate(element=>[...document.querySelectorAll('.bn-location-editor [data-bn-field]')].filter(field=>field.checkVisibility()&&(()=>{
  const actionBox=element.getBoundingClientRect(),fieldBox=field.getBoundingClientRect();
  return actionBox.left<fieldBox.right&&actionBox.right>fieldBox.left&&actionBox.top<fieldBox.bottom&&actionBox.bottom>fieldBox.top;
 })()).map(field=>(field as HTMLElement).dataset.bnField));
 expect(overlapsAtTop).toEqual([]);
});

test('picker repaint keeps result and editor focus/scroll while selecting a canonical Move destination', {tag:['@bunch-note']}, async ({page,baseURL}) => {
 const pickerUsers=[{id:hlUserId,username:'dylan_collyge',display:'Dylan',email:'dylan_collyge@greenleafnursery.com'},...Array.from({length:14},(_,i)=>({id:`picker-worker-${i}`,username:`picker_worker_${i}`,display:`Picker Worker ${i}`,email:`picker${i}@example.invalid`}))];
 const f=await fixture(page,baseURL!,false,pickerUsers);
 for(let i=0;i<130;i++)f.rows.push({...plant(`scroll-${String(i).padStart(3,'0')}`,'C.12.001'),itemcode:`SCROLL-${String(i).padStart(3,'0')}`,commonname:`Scroll candidate ${i}`});
 await openBunchNotesFromInventory(page);
 await page.getByRole('button',{name:'Open block FULL.BLOCK',exact:true}).click();
 await openAuthorLocation(page,'C.12.001');
 await page.getByLabel('Work type',{exact:true}).fill('Prepare shipment');
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await page.getByRole('button',{name:'＋ Add inventory card',exact:true}).click();
 const dialog=page.locator('section.bn-card-picker[role="dialog"][data-bn-scroll-key="card-picker"]');
 await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('heading',{name:'Search inventory',exact:true})).toBeVisible();
 await page.getByRole('textbox',{name:'Search inventory',exact:true}).fill('Scroll candidate');
 await expect(page.locator('.bn-picker-result')).toHaveCount(100);
 await dialog.evaluate(element=>{element.scrollTop=240;});
 const dialogScrollBefore=await dialog.evaluate(element=>element.scrollTop);
 expect(dialogScrollBefore).toBeGreaterThan(0);
 const candidateIndex=await page.locator('.bn-picker-result').evaluateAll((rows,selector)=>{
  const scroller=document.querySelector(selector as string);if(!scroller)return -1;
  const outer=scroller.getBoundingClientRect();
  return rows.findIndex(row=>{const control=row.querySelector('input[type="checkbox"]');if(!control)return false;const rect=control.getBoundingClientRect();return rect.top>=Math.max(outer.top,0)&&rect.bottom<=Math.min(outer.bottom,innerHeight)&&document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2)===control;});
 },'.bn-card-picker');
 expect(candidateIndex).toBeGreaterThanOrEqual(0);
 const visibleCandidate=page.locator('.bn-picker-result').nth(candidateIndex);
 const selected=visibleCandidate.getByRole('checkbox');
 const originalDialog=await dialog.elementHandle();
 const originalCheckbox=await selected.elementHandle();
 const originalWorkspaceChild=await page.locator('#bunch-note-content > :first-child').elementHandle();
  const selectedItemcode=(await visibleCandidate.locator('strong').innerText()).split(' · ')[0];
 await expect.poll(()=>selected.evaluate(element=>{const box=element.getBoundingClientRect(),scroller=element.closest('.bn-card-picker');if(!scroller)return false;const outer=scroller.getBoundingClientRect();return box.top>=Math.max(outer.top,0)&&box.bottom<=Math.min(outer.bottom,innerHeight);})).toBe(true);
  await selected.evaluate(element=>(element as HTMLElement).focus({preventScroll:true}));
 // Locator.check() scrolls the control before pointer-down. Tap its already-visible
 // hit target directly so this assertion measures the application's native change.
 const selectedPoint=await selected.evaluate(element=>{const box=element.getBoundingClientRect();const x=box.left+box.width/2,y=box.top+box.height/2;return {x,y,hit:document.elementFromPoint(x,y)===element};});
 expect(selectedPoint.hit).toBe(true);
 if(test.info().project.use.hasTouch)await page.touchscreen.tap(selectedPoint.x,selectedPoint.y);
 else await page.mouse.click(selectedPoint.x,selectedPoint.y);
 await expect(selected).toBeChecked();
 expect(await originalDialog!.evaluate(element=>element.isConnected)).toBe(true);
 expect(await originalCheckbox!.evaluate(element=>element.isConnected)).toBe(true);
 expect(await originalWorkspaceChild!.evaluate(element=>element.isConnected)).toBe(true);
 await expect.poll(()=>dialog.evaluate(element=>element.scrollTop)).toBe(dialogScrollBefore);
 await expect(visibleCandidate.getByRole('checkbox')).toBeFocused();
 await expect(dialog.getByRole('heading',{name:'Card routing and notes',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Continue to card details',exact:true}).click();
 const action=page.getByLabel('Required card action',{exact:true});
 const originalAction=await action.elementHandle();
 const detailsDialog=await dialog.elementHandle();
 await dialog.evaluate(element=>{element.scrollTop=Math.min(340,element.scrollHeight-element.clientHeight);});
  await action.evaluate(element=>(element as HTMLElement).focus({preventScroll:true}));
 const actionScrollBefore=await dialog.evaluate(element=>element.scrollTop);
 expect(actionScrollBefore).toBeGreaterThan(0);
 await action.selectOption('move');
 expect(await originalAction!.evaluate(element=>element.isConnected)).toBe(true);
 expect(await detailsDialog!.evaluate(element=>element.isConnected)).toBe(true);
 await expect(action).toBeFocused();
 await expect.poll(()=>dialog.evaluate(element=>element.scrollTop)).toBe(actionScrollBefore);
 const destination=page.getByLabel('Move destination',{exact:true});
 const originalDestination=await destination.elementHandle();
  await destination.evaluate(element=>(element as HTMLElement).focus({preventScroll:true}));
 const destinationScrollBefore=await dialog.evaluate(element=>element.scrollTop);
 await destination.fill('D.05.');
 await expect.poll(()=>dialog.evaluate(element=>element.scrollTop)).toBe(destinationScrollBefore);
 await destination.evaluate(element=>element.dispatchEvent(new Event('change',{bubbles:true})));
 expect(await originalDestination!.evaluate(element=>element.isConnected)).toBe(true);
 await expect(destination).toBeFocused();
 await expect.poll(()=>dialog.evaluate(element=>element.scrollTop)).toBe(destinationScrollBefore);
 const owner=dialog.getByLabel('Assign to Picker Worker 10',{exact:true});
 await owner.scrollIntoViewIfNeeded();
 await owner.evaluate(element=>(element as HTMLElement).focus({preventScroll:true}));
 const ownerScrollBefore=await dialog.evaluate(element=>element.scrollTop);
 const originalOwner=await owner.elementHandle();
 const ownerPoint=await owner.evaluate(element=>{const box=element.getBoundingClientRect();const x=box.left+box.width/2,y=box.top+box.height/2;return {x,y,hit:document.elementFromPoint(x,y)===element};});
 expect(ownerPoint.hit).toBe(true);
 if(test.info().project.use.hasTouch)await page.touchscreen.tap(ownerPoint.x,ownerPoint.y);
 else await page.mouse.click(ownerPoint.x,ownerPoint.y);
 await expect(owner).toBeChecked();
 expect(await originalOwner!.evaluate(element=>element.isConnected)).toBe(true);
 expect(await detailsDialog!.evaluate(element=>element.isConnected)).toBe(true);
 await expect(owner).toBeFocused();
 await expect.poll(()=>dialog.evaluate(element=>element.scrollTop)).toBe(ownerScrollBefore);
 await dialog.getByRole('textbox',{name:'Card notes',exact:true}).fill('Keep this row with the destination crew');
 await page.getByRole('button',{name:'＋ Add selected card(s) and continue',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Search inventory'})).toBeVisible();
 const saved=f.commands.filter(command=>command.operation==='save').at(-1)?.payload.body.locations[0];
  expect(saved.cards[0]).toMatchObject({itemcode:selectedItemcode,workflow_action:'move',destination_location:'D.05.000',notes:'Keep this row with the destination crew'});
 expect(saved.cards[0].owner_ids).toContain('picker-worker-10');
 expect(saved.cards[0]).not.toHaveProperty('uid');
 expect(f.control.blockedMutations).toEqual([]);
});

test('header-only recipient choices survive main-page scrolling and PDF preview with zero inventory cards', {tag:['@bunch-note']}, async ({page,baseURL}) => {
 const users=[{id:hlUserId,username:'dylan_collyge',display:'Dylan',email:'dylan_collyge@greenleafnursery.com'},...Array.from({length:24},(_,i)=>({id:`recipient-${i}`,username:`recipient_${i}`,display:`Recipient ${String(i).padStart(2,'0')}`,email:`recipient${i}@example.invalid`}))];
 const f=await fixture(page,baseURL!,false,users);
 await openBunchNotesFromInventory(page);
 await page.getByRole('button',{name:'Open block FULL.BLOCK',exact:true}).click();
 await openAuthorLocation(page,'C.12.001');
 await page.getByLabel('Work type',{exact:true}).fill('C.12. Bunch Notes');
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await page.getByRole('button',{name:'＋ Divider / instruction row',exact:true}).click();
 await page.getByLabel('Divider / instruction row').fill('Crew change: North House first');
 await page.getByRole('button',{name:'Save draft',exact:true}).click();
 await expect(page.locator('#bunch-note-content')).toHaveAttribute('aria-busy','false');
 await page.locator('#global-header-inline-back').click();
 await expect(page.getByLabel('Work type',{exact:true})).toBeVisible();
 await page.locator('#global-header-inline-back').click();
 const recipients=page.locator('details.bn-options').filter({has:page.locator('summary').filter({hasText:'Email recipients'})});
 await expect(recipients).toHaveCount(1);
 await recipients.locator('summary').click();
 const recipient=recipients.getByRole('checkbox',{name:/Recipient 20/});
 await recipient.scrollIntoViewIfNeeded();
 const originalRecipient=await recipient.elementHandle();
 const originalRecipientPanel=await recipients.elementHandle();
 await recipient.check();
 expect(await originalRecipient!.evaluate(element=>element.isConnected)).toBe(true);
 expect(await originalRecipientPanel!.evaluate(element=>element.isConnected)).toBe(true);
 const main=page.locator('#main-scroll-area');
 const mainScrollBefore=await main.evaluate(element=>element.scrollTop);
 expect(mainScrollBefore).toBeGreaterThan(0);
 await page.evaluate(()=>{(window as any).BunchNote.render();});
 await expect.poll(()=>main.evaluate(element=>element.scrollTop)).toBe(mainScrollBefore);
 await expect(recipients.getByRole('checkbox',{name:/Recipient 20/})).toBeChecked();
 await page.getByRole('button',{name:'Save draft',exact:true}).click();
 await expect(page.locator('#bunch-note-content')).toHaveAttribute('aria-busy','false');
 let saved=f.commands.filter(command=>command.operation==='save').at(-1)?.payload.body;
 expect(saved.recipient_ids).toContain('recipient-20');
 expect(saved.locations[0].cards).toEqual([expect.objectContaining({kind:'divider',text:'Crew change: North House first'})]);
 expect(saved.locations[0].row_ids).toEqual([]);
 await page.getByRole('button',{name:'Preview PDFs and recipients',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Review Inv Bunch Notes PDFs'})).toBeVisible();
 expect(f.lastPreview.reports[0].cards).toEqual(saved.locations[0].cards);
 expect(f.lastPreview.recipients.map((item:any)=>item.email)).toContain('dylan_collyge@greenleafnursery.com');
 expect(f.control.blockedMutations).toEqual([]);
});

test('a copied action remains editable after the cached option catalog advances', {tag:['@bunch-note']}, async ({page,baseURL}) => {
 const f=await fixture(page,baseURL!);
 await openBunchNotesFromInventory(page);
 await page.getByRole('button',{name:'Open block FULL.BLOCK',exact:true}).click();
 await openAuthorLocation(page,'C.12.001');
 await page.getByLabel('Work type',{exact:true}).fill('Prepare shipment');
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await openAdvancedInventoryControls(page);
 await page.getByRole('checkbox',{name:'Select item BN-I',exact:true}).check();
 await page.getByRole('button',{name:'Open item BN-I',exact:true}).click();
 const placement=page.locator('.bn-action-choices details').filter({has:page.locator('summary').filter({hasText:/^Placement/})});
 await placement.locator('summary').click();
 await placement.getByRole('button',{name:'Center house',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Instruction',exact:true})).toHaveValue('Center house');
 // Simulate the shared catalogue receiving a newer label/revision while the
 // user is editing the already copied action. This is not a job revision.
 const option=f.options.find((item:any)=>item.id==='option3');
 option.label='Center house — revised instruction';
 option.revision++;
 await page.evaluate(async()=>{await (window as any).BunchNote.open({refresh:true});});
 await expect(page.getByRole('textbox',{name:'Instruction',exact:true})).toHaveValue('Center house');
 await expect(page.locator('#bunch-note-content [role=alert]')).toHaveCount(0);
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await expect(page.locator('#bunch-note-content')).toHaveAttribute('aria-busy','false');
 const saved=f.commands.filter(command=>command.operation==='save').at(-1)?.payload.body.locations[0];
 expect(saved.actions).toEqual(expect.arrayContaining([expect.objectContaining({label:'Center house',instructions:'Center house',option_id:'option3'})]));
 expect(f.commands.filter(command=>command.operation==='save').at(-1).expectedRevision).toBe(1);
 expect(f.control.blockedMutations).toEqual([]);
});

test('sequential divider ordering and bulk routing persist after editor rerenders', {tag:['@bunch-note']}, async ({page,baseURL}) => {
 const f=await fixture(page,baseURL!);
 await openBunchNotesFromInventory(page);
 await page.getByRole('button',{name:'Open block FULL.BLOCK',exact:true}).click();
 await openAuthorLocation(page,'C.12.001');
 await page.getByLabel('Work type',{exact:true}).fill('C.12. Bunch Notes');
 await page.getByRole('button',{name:'Next',exact:true}).click();
 const list=page.locator('.bn-wizard-items');
 await page.getByRole('button',{name:'＋ Divider / instruction row',exact:true}).click();
 await page.getByLabel('Divider / instruction row').fill('Crew change: North House first');
 await page.getByRole('button',{name:'＋ Add inventory card',exact:true}).click();
 await page.getByRole('textbox',{name:'Search inventory',exact:true}).fill('Bunch Plant');
 await page.locator('.bn-picker-result').filter({hasText:'#3'}).getByRole('checkbox').check();
 await page.getByRole('button',{name:'Continue to card details',exact:true}).click();
 await page.getByLabel('Required card action',{exact:true}).selectOption('ta');
 await page.getByRole('button',{name:'＋ Add selected card(s) and continue',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Search inventory'})).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await list.getByRole('checkbox',{name:'Select BN-I for bulk edit'}).check();
 await page.getByLabel('Bulk card action',{exact:true}).selectOption('bunch');
 await page.getByLabel('Bulk Bunch house',{exact:true}).selectOption('North House');
 await page.getByLabel('Append bulk card notes',{exact:true}).fill('Keep North House lots together');
 await page.getByRole('button',{name:'Apply to selected cards',exact:true}).click();
 await page.evaluate(()=>{(window as any).BunchNote.render();});
 await expect(list.locator('.bn-sequence-divider').getByLabel('Divider / instruction row')).toHaveValue('Crew change: North House first');
 await page.getByRole('button',{name:'Save draft',exact:true}).click();
 await expect(page.locator('#bunch-note-content')).toHaveAttribute('aria-busy','false');
 const saved=f.commands.filter(command=>command.operation==='save').at(-1)?.payload.body;
 expect(saved.locations[0].cards.map((card:any)=>card.kind||'inventory')).toEqual(['divider','inventory']);
 expect(saved.locations[0].cards[1]).toMatchObject({workflow_action:'bunch',destination_house:'North House',notes:'Keep North House lots together'});
 expect(f.control.blockedMutations).toEqual([]);
});

test('wizard persists exact card notes through reload and preview while picker navigation stays local', {tag:['@bunch-note']}, async ({page,baseURL},testInfo) => {
 const f=await fixture(page,baseURL!);
 const press=test.info().project.use.isMobile?'tap':'click';
 // Add a second lot in the same verified card group so the picker must retain
 // both exact source identities rather than broadening by item code.
 f.rows.push({...plant('a3','C.12.001'),lotcode:'LOT3'});
 // Keep the chosen location at representative volume: the first two source
 // cards form two groups, then these rows provide 998 distinct candidates.
 // Search covers the full cache while the picker pages its visible results.
 for(let i=0;i<998;i++)f.rows.push({...plant(`bulk-${String(i).padStart(4,'0')}`,'C.12.001'),
  itemcode:`BN-BULK-${String(i).padStart(4,'0')}`,commonname:`Bunch Candidate ${String(i).padStart(4,'0')}`});
 const candidates=f.rows.filter(row=>row.locationcode==='C.12.001');
 expect(candidates).toHaveLength(1001);
 await openBunchNotesAfterCheckingQueueRemoval(page);
 await page.getByRole('button',{name:'Open block FULL.BLOCK',exact:true}).click();
 await openAuthorLocation(page,'C.12.001');
 await page.getByLabel('Work type',{exact:true}).fill('Prepare shipment');
 await page.getByLabel('Direction',{exact:true}).selectOption('West → East');
 await page.getByLabel('Extra notes',{exact:true}).fill('Call the crew lead');
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await expect(page.locator('#bunch-note-content')).toContainText('Prepare shipment');
 await expect(page.getByLabel('Work type',{exact:true})).toHaveCount(0);
 await expect(page.getByLabel('Direction',{exact:true})).toHaveCount(0);

 const commandCount=f.commands.length;
 // Start the timer inside the real click event and stop after two animation
 // frames; this excludes Playwright's cross-process command round trip.
 await page.evaluate(()=>{
  (window as any).__bunchPickerPaintMs=null;
  const capture=(event:Event)=>{
   if(!(event.target instanceof Element)||!event.target.closest('button[onclick="BunchNote.openCardPicker()"]'))return;
   document.removeEventListener('click',capture,true);
   const started=performance.now();
   requestAnimationFrame(()=>requestAnimationFrame(()=>{(window as any).__bunchPickerPaintMs=performance.now()-started;}));
  };
  document.addEventListener('click',capture,true);
 });
 await page.getByRole('button',{name:'＋ Add inventory card',exact:true})[press]();
 await expect(page.getByRole('dialog',{name:'Search inventory'})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>(window as any).__bunchPickerPaintMs)).not.toBeNull();
 const pickerMs=await page.evaluate(()=>(window as any).__bunchPickerPaintMs as number);
 const pickerGroups=page.locator('.bn-picker-result');
 await expect(pickerGroups).toHaveCount(100);
 expect(f.commands).toHaveLength(commandCount);
 await testInfo.attach('bunch-note-wizard-warm-picker.json',{body:JSON.stringify({project:testInfo.project.name,userAgent:testInfo.project.use.userAgent||null,viewport:testInfo.project.use.viewport||null,touch:testInfo.project.use.hasTouch||false,operation:'warm cached inventory card picker click-to-paint',elapsedMs:pickerMs,limitMs:1500,locationRows:candidates.length,cachedCardCandidates:1000,renderedCardCandidates:100,cache:'warm local source_all; no inventory RPC during picker open'}),contentType:'application/json'});
 expect(pickerMs).toBeLessThanOrEqual(1500);

 await page.context().setOffline(true);
 await page.getByRole('textbox',{name:'Search inventory',exact:true}).fill('Bunch Candidate 0997');
 await expect(pickerGroups).toHaveCount(1);
 await expect(pickerGroups).toContainText('Bunch Candidate 0997');
 await page.getByRole('textbox',{name:'Search inventory',exact:true}).fill('Bunch Plant');
 await page.evaluate(()=>{(window as any).BunchNote.render();});
 await expect(page.getByRole('textbox',{name:'Search inventory',exact:true})).toHaveValue('Bunch Plant');
 await page.locator('.bn-picker-result').filter({hasText:'#3'})[press]();
 await page.getByRole('button',{name:'Continue to card details',exact:true})[press]();
 await expect(page.getByLabel('Select lot #3 27.F1 a',{exact:true})).toBeChecked();
 await expect(page.getByLabel('Select lot #3 LOT3 a3',{exact:true})).toBeChecked();
 await expect(page.getByRole('dialog',{name:'Card routing and notes'})).toBeVisible();
 await page.getByLabel('Required card action',{exact:true}).selectOption('move');
 const ambiguousDestination=page.getByLabel('Move destination',{exact:true});
 await ambiguousDestination.fill('C.12.');
 await ambiguousDestination.press('Tab');
 await expect(page.getByLabel('Full destination location',{exact:true})).toBeVisible();
 await page.getByLabel('Full destination location',{exact:true}).selectOption('C.12.002');
 await page.locator('section.bn-card-picker[role="dialog"][data-bn-scroll-key="card-picker"]').getByRole('textbox',{name:'Card notes',exact:true}).fill('Keep these lots separate');
 expect(f.commands).toHaveLength(commandCount); // search, selection and field edits are local
 await page.context().setOffline(false);
 await page.getByRole('button',{name:'＋ Add selected card(s) and continue',exact:true})[press]();
 await expect(page.getByRole('dialog',{name:'Search inventory'})).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Search inventory',exact:true})).toHaveValue('');

 // Adding another card immediately reopens the picker for rapid iteration.
 await page.getByRole('textbox',{name:'Search inventory',exact:true}).fill('Bunch Plant');
 await page.locator('.bn-picker-result').filter({hasText:'#5'})[press]();
 await page.getByRole('button',{name:'Continue to card details',exact:true})[press]();
 await expect(page.getByLabel('Select lot #5 LOT2 a2',{exact:true})).toBeChecked();
 await page.getByLabel('Required card action',{exact:true}).selectOption('bunch');
 const houseOptions=await page.getByLabel('Bunch destination house').locator('option').allTextContents();
 expect(houseOptions.slice(1)).toEqual(['South House','North House','Center House','South & Center House','North & Center House','East House','West House','East & Center House','West & Center House']);
 await page.getByLabel('Bunch destination house',{exact:true}).selectOption('South House');
 await page.getByRole('button',{name:'＋ Add selected card(s) and continue',exact:true})[press]();
 await expect(page.getByRole('textbox',{name:'Search inventory',exact:true})).toBeVisible();
 const committed=f.commands.filter(command=>command.operation==='save').at(-1).payload.body.locations[0];
 expect(committed.cards.map((card:any)=>card.row_ids)).toEqual([['a','a3'],['a2']]);
 expect(committed.cards.map((card:any)=>card.workflow_action)).toEqual(['move','bunch']);
 expect(committed.cards[0]).toMatchObject({destination_location:'C.12.002',notes:'Keep these lots separate'});
 expect(committed.cards[1]).toMatchObject({destination_house:'South House'});

 await page.locator('#footer-request-btn').focus(); // capture Escape even after focus leaves the modal
 await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('button',{name:'＋ Add inventory card',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Search inventory'})).toBeVisible();
 await page.mouse.click(3,3); // outside the panel, including the persistent header
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.locator('.bn-sequence-card[data-sequence-id]')).toHaveCount(2);
 await expect(page.locator('.bn-sequence-card[data-sequence-id]').first()).toContainText('Keep these lots separate');
 await page.locator('#global-header-inline-back').click(); // item step -> editable header
 await page.locator('#global-header-inline-back').click(); // header -> block locations
 await page.locator('#global-header-inline-back').click(); // save/return to saved batches
 await expect(page.getByRole('button',{name:/Open batch FULL\.BLOCK/})).toBeVisible();
 await page.getByRole('button',{name:/Open batch FULL\.BLOCK/}).click();
 await openAuthorLocation(page,'C.12.001');
 await expect(page.getByLabel('Work type',{exact:true})).toHaveValue('Prepare shipment');
 await expect(page.getByRole('textbox',{name:'Extra notes',exact:true})).toHaveValue('Call the crew lead');
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await expect(page.locator('.bn-sequence-card[data-sequence-id]').first()).toContainText('Keep these lots separate');
 await page.locator('#global-header-inline-back').click();
 await page.locator('#global-header-inline-back').click();
 await expect(page.getByRole('button',{name:'Preview PDFs and recipients',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Preview PDFs and recipients',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Review Inv Bunch Notes PDFs'})).toBeVisible();
  expect(f.lastPreview.reports[0].cards).toEqual(expect.arrayContaining([expect.objectContaining({id:committed.cards[0].id,notes:'Keep these lots separate'})]));
  expect(f.lastPreview.reports[0].actions).not.toEqual(expect.arrayContaining([expect.objectContaining({label:'Card notes',card_id:committed.cards[0].id})]));
 await expect(page.locator('#bunch-note-content iframe')).toHaveCount(1);
 expect(f.control.blockedMutations).toEqual([]);
});

test('multi-card routing assigns both workers, requires a destination and safely retries one save', {tag:['@bunch-note']},async({page,baseURL},testInfo)=>{
 const secondId='dd000000-0000-4000-8000-000000000002';
 const f=await fixture(page,baseURL!,false,[{id:hlUserId,username:'dylan_collyge',display:'Dylan',email:'dylan_collyge@greenleafnursery.com'},{id:secondId,username:'worker_two',display:'Second Worker',email:'worker_two@example.invalid'}]);
 for(let i=0;i<998;i++)f.rows.push({...plant(`multi-${i}`,'C.12.001'),itemcode:`MULTI-${i}`,commonname:`Multi candidate ${i}`});
 await openBunchNotesFromInventory(page);
 await page.getByRole('button',{name:'Open block FULL.BLOCK',exact:true}).click();
 await openAuthorLocation(page,'C.12.001');
 await expect(page.getByLabel('Work type',{exact:true})).toHaveValue('C.12. Bunch Notes');
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await page.getByRole('button',{name:'＋ Add inventory card',exact:true}).click();
 const pickerDialog=page.locator('section.bn-card-picker[role="dialog"][data-bn-scroll-key="card-picker"]');
 const commandCount=f.commands.length;
 await page.context().setOffline(true);
 await page.getByRole('textbox',{name:'Search inventory',exact:true}).fill('Bunch Plant');
 const results=page.locator('.bn-picker-result');
 await expect(results).toHaveCount(2);
 await results.filter({hasText:'#3'}).getByRole('checkbox').check();
 await results.filter({hasText:'#5'}).getByRole('checkbox').check();
 await page.evaluate(()=>{document.addEventListener('click',function capture(e){if(!(e.target instanceof Element)||!e.target.closest('button[onclick="BunchNote.showPickerDetails()"]'))return;document.removeEventListener('click',capture,true);const start=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>{(window as any).__multiDetailsMs=performance.now()-start;}));},true);});
 await page.getByRole('button',{name:'Continue to card details',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).__multiDetailsMs)).toBeGreaterThan(0);
 const elapsedMs=await page.evaluate(()=>(window as any).__multiDetailsMs);
 expect(elapsedMs).toBeLessThanOrEqual(1500);
 await testInfo.attach('multi-card-details-timing',{body:JSON.stringify({elapsedMs,limitMs:1500,groups:1000,selectedCards:2,cache:'warm local; offline; OS cache uncontrolled'}),contentType:'application/json'});
 await page.getByLabel('Assign to Dylan',{exact:true}).check();
 await page.getByLabel('Assign to Second Worker',{exact:true}).check();
 const submit=page.getByRole('button',{name:'＋ Add selected card(s) and continue',exact:true});
 await expect(submit).toBeEnabled(); // blank action follows the saved header default
 await page.getByLabel('Required card action',{exact:true}).selectOption('move');
 await expect(submit).toBeDisabled();
 await expect(page.getByLabel('Bunch destination house')).toHaveCount(0);
 await expect(page.locator('#bn-picker-destinations option[value="D.05."]')).toHaveCount(1);
 const moveDestination=page.getByLabel('Move destination',{exact:true});
 await moveDestination.fill('D.05.');
 await moveDestination.press('Tab');
 await expect(submit).toBeEnabled();
 await page.getByLabel('Required card action',{exact:true}).selectOption('bunch');
 await expect(page.getByLabel('Move destination')).toHaveCount(0);
 await expect(submit).toBeDisabled();
 expect((await page.getByLabel('Bunch destination house').locator('option').allTextContents()).slice(1)).toEqual(['South House','North House','Center House','South & Center House','North & Center House','East House','West House','East & Center House','West & Center House']);
 await page.getByLabel('Bunch destination house').selectOption('West & Center House');
 await expect(submit).toBeEnabled();
 await page.getByLabel('Required card action',{exact:true}).selectOption('ta');
 await expect(page.getByLabel('Move destination')).toHaveCount(0);
 await expect(page.getByLabel('Bunch destination house')).toHaveCount(0);
 await expect(submit).toBeEnabled();
 await page.getByLabel('Required card action',{exact:true}).selectOption('move');
 const retryDestination=page.getByLabel('Move destination',{exact:true});
 await retryDestination.fill('D.05.');
 await retryDestination.press('Tab');
 await pickerDialog.getByRole('textbox',{name:'Card notes',exact:true}).fill('Keep the two sizes separate');
 expect(f.commands).toHaveLength(commandCount);
 await testInfo.attach('advanced-bunch-multi-assignment',{body:await page.screenshot(),contentType:'image/png'});
 await page.context().setOffline(false);
 f.failNextSave();
 await submit.click();
 await expect(page.locator('#bunch-note-content [role=alert]')).toContainText('Save unavailable');
 await expect(page.getByLabel('Required card action',{exact:true})).toBeDisabled();
 await expect(page.getByLabel('Assign to Second Worker',{exact:true})).toBeDisabled();
 await expect(pickerDialog.getByRole('textbox',{name:'Card notes',exact:true})).toBeDisabled();
 const failed=f.commands.filter(c=>c.operation==='save').at(-1);
 await page.getByRole('button',{name:'Save cards and continue',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Search inventory'})).toBeVisible();
 await expect(page.locator('#bunch-note-content')).toHaveAttribute('aria-busy','false');
 const saved=f.commands.filter(c=>c.operation==='save').at(-1);
 expect(saved.commandId).toBe(failed.commandId);
 expect(saved.payload).toEqual(failed.payload);
 const location=saved.payload.body.locations[0];
 expect(location.location).toBe('C.12.001');
 expect(location.cards).toHaveLength(2);
 expect(new Set(location.cards.map((c:any)=>c.id)).size).toBe(2);
 for(const card of location.cards)expect(card).toMatchObject({owner_ids:[hlUserId,secondId],owner_id:hlUserId,workflow_action:'move',destination_location:'D.05.000',destination_house:null,notes:'Keep the two sizes separate'});
 expect(location.cards.map((c:any)=>c.row_ids).flat().sort()).toEqual(['a','a2']);
 await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.locator('.bn-sequence-card[data-sequence-id]')).toHaveCount(2);
 expect(f.control.blockedMutations).toEqual([]);
});

test('structured worksheet saves ordered houses, custom crew tags and freeform routing without losing failed edits', {"tag":["@bunch-note"]},async({page,baseURL})=>{
 const f=await fixture(page,baseURL!);
 await openBunchNotesFromInventory(page);
 await page.getByRole('button',{name:'Open block FULL.BLOCK',exact:true}).click();
 await openAuthorLocation(page,'C.12.001');
 await page.getByLabel('Work type',{exact:true}).fill('Bunch for shipping');
 await page.getByLabel('Extra notes',{exact:true}).fill('Leave aisles at risers, remove drape. Red flags');
 await page.getByLabel('Direction',{exact:true}).selectOption('West → East');
 await page.getByText('Advanced location controls',{exact:true}).click();
 await page.getByLabel('Target houses',{exact:true}).fill('South house only');
 await page.getByRole('button',{name:'Add house section',exact:true}).click();
 await page.getByLabel('House name',{exact:true}).fill('North House');
 await page.getByLabel('House direction override',{exact:true}).fill('East to West');
 await page.getByRole('button',{name:'Add freeform task to North House',exact:true}).click();
 const north=page.getByRole('region',{name:'North House',exact:true});
 await north.getByLabel('Crew tag',{exact:true}).fill('BOB');
 await north.getByLabel('Quantity constraint',{exact:true}).fill('< 30');
 await north.getByLabel('Action / routing instruction',{exact:true}).fill('Haul to G15 S-HS. Blue flags');
 await page.getByRole('button',{name:'Add house section',exact:true}).click();
 await page.getByLabel('House name',{exact:true}).last().fill('Center House');
 await page.getByRole('button',{name:'Add freeform task to Center House',exact:true}).click();
 const center=page.getByRole('region',{name:'Center House',exact:true});
 await center.getByLabel('Crew tag',{exact:true}).fill('NIGHT CREW');
 await center.getByLabel('Item size',{exact:true}).fill('3DP');
 await center.getByLabel('Quantity constraint',{exact:true}).fill('all');
 await center.getByLabel('Action / routing instruction',{exact:true}).fill('Stop and pickup from E.23.000. Pink Ribbon');
 await page.getByRole('button',{name:'Move Center House up',exact:true}).click();
 f.failNextSave();await page.getByRole('button',{name:'Save draft',exact:true}).click();
 await expect(page.locator('#bunch-note-content').getByRole('alert')).toContainText('Save unavailable');
 await page.getByText('Advanced location controls',{exact:true}).click();
 await expect(center.getByRole('textbox',{name:'Quantity constraint',exact:true})).toHaveValue('all');
  await expect(north.getByRole('textbox',{name:'Action / routing instruction',exact:true})).toHaveValue('Haul to G15 S-HS. Blue flags');
 await page.getByRole('button',{name:'Save draft',exact:true}).click();
 await expect(page.locator('#bunch-note-content')).toHaveAttribute('aria-busy','false');
 const saved=f.commands.filter(c=>c.operation==='save').at(-1).payload.body.locations[0];
 expect(saved.direction).toBe('West → East');expect(saved.target_houses).toBe('South house only');
 expect(saved.house_sections.map((s:any)=>s.name)).toEqual(['Center House','North House']);
 expect(saved.actions.map((a:any)=>[a.sequence_order,a.margin_tag,a.quantity_constraint])).toEqual([[1,'NIGHT CREW','all'],[2,'BOB','< 30']]);
 expect(saved.actions.every((a:any)=>a.freeform&&a.row_ids.length===0)).toBe(true);
 await page.evaluate(()=>{(window as any).BunchNote.editSetup();});
  await expect(page.getByRole('combobox',{name:'Direction',exact:true})).toHaveValue('West → East');
 await page.getByText('Advanced location controls',{exact:true}).click();
 await expect(center.locator('mark')).toHaveText('Pink Ribbon');
 await page.screenshot({path:test.info().outputPath('structured-worksheet.png'),fullPage:true});
 expect(f.control.blockedMutations).toEqual([]);
});

test('author includes one location card explicitly, assigns it, and limits planned Move to its lot rows', {"tag":["@bunch-note"]},async({page,baseURL})=>{
 const f=await fixture(page,baseURL!);
 await openBunchNotesFromInventory(page);
 await page.getByRole('button',{name:'Open block FULL.BLOCK',exact:true}).click();
 await openAuthorLocation(page,'C.12.001');
 await page.getByLabel('Work type',{exact:true}).fill('Assign one card');
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await openAdvancedInventoryControls(page);
 const firstLocation=page.locator('.bn-card-board__location').filter({has:page.locator('h3', {hasText:'C.12.001'})});
 await expect(firstLocation).toBeVisible();
 const inventoryCards=firstLocation.locator('.bn-board-card');
 await expect(inventoryCards).toHaveCount(2);
 await expect(inventoryCards.nth(0).getByRole('region',{name:'Lot details'})).toBeVisible();
 await expect(inventoryCards.nth(0).getByText('Lot',{exact:true})).toBeVisible();
 await expect(inventoryCards.nth(0).getByText('Warehouse',{exact:true})).toBeVisible();
 await expect(inventoryCards.nth(0).locator('details.bn-board-lots')).toHaveCount(0);
 await expect(inventoryCards.nth(0).getByText(/Expand all lot details/)).toHaveCount(0);
 await expect(inventoryCards.nth(0)).toContainText('Not included');
 await inventoryCards.nth(0).getByRole('checkbox',{name:'Include in this Bunch Note'}).check();
 await inventoryCards.nth(0).getByRole('button',{name:'Assign Worker Name',exact:true}).click();
 await inventoryCards.nth(0).getByLabel('Assign worker',{exact:true}).selectOption(hlUserId);
 await inventoryCards.nth(0).getByRole('button',{name:'House to work in',exact:true}).click();
 await inventoryCards.nth(0).getByRole('combobox',{name:'House to work in',exact:true}).selectOption('Custom');
 await inventoryCards.nth(0).getByLabel('Custom house to work in',{exact:true}).fill('North House');
 await inventoryCards.nth(0).getByRole('button',{name:'Direction',exact:true}).click();
 await inventoryCards.nth(0).getByRole('combobox',{name:'Direction',exact:true}).selectOption('East to West');
 await inventoryCards.nth(0).getByRole('button',{name:'Save card',exact:true}).click();
 await expect(page.locator('#bunch-note-content')).toHaveAttribute('aria-busy','false');
 const saved=f.commands.filter(c=>c.operation==='save').at(-1).payload.body.locations[0];
 expect(saved.cards).toHaveLength(1);
 expect(saved.cards[0]).toMatchObject({kind:'inventory',row_ids:['a'],owner_id:hlUserId,house:'North House',direction:'East to West'});
 expect(saved.row_ids).toEqual(['a']);
 expect(saved.actions).toEqual([]);
 await inventoryCards.nth(0).getByRole('button',{name:'Move',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Move',exact:true})).toBeVisible();
 await expect(page.getByText('Source lots (1)',{exact:true})).toBeVisible();
 await page.getByText('Source lots (1)',{exact:true}).click();
 await expect(page.getByLabel('Action lot #3 27.F1 a',{exact:true})).toBeChecked();
 await expect(page.getByLabel('Action lot #5 LOT2 a2',{exact:true})).toHaveCount(0);
 expect(f.control.blockedMutations).toEqual([]);
});

test('assigned work shows house directions and survives refresh before opening linked work', {"tag":["@bunch-note"]},async({page,baseURL})=>{
 const f=await fixture(page,baseURL!,true),j=f.jobs[0];
 j.body.direction='West to East';j.body.target_houses='South house only';
 j.body.house_sections=[{id:'north',name:'North House',direction:'East to West'}];
 Object.assign(j.body.actions[1],{section_id:'north',margin_tag:'QC',quantity_constraint:'all',instructions:'TA all. Red flags and Yellow Ribbon'});
 await openAssignedBunchWorkFromInventory(page);
 await page.evaluate(()=>window.eval('setMainAreaScrollTop(600)'));
 await page.evaluate(()=>window.eval('setMainAreaScrollTop(0)'));
 for(const name of ['Open location C.12','Open location C.12.001','Open'])await page.getByRole('button',{name,exact:true}).click();
 const worksheet=page.locator('[data-bn-structured="read"]');
 await expect(worksheet).toContainText('North House · East to West');
 await expect(worksheet).toContainText('South house only');
 await expect(worksheet.locator('.bn-crew-badge')).toHaveText('QC');
 await expect(worksheet.locator('mark')).toHaveText(['Red flags','Yellow Ribbon']);
 await page.evaluate(()=>{(window as any).BunchNote.render();});
 await expect(worksheet.locator('.bn-task-line')).toHaveCount(3);
 await worksheet.locator('[data-action-id="ta"]').getByRole('button',{name:'Open work details'}).click();
 await expect(page.locator('[data-bn-work-action="ta"]')).toBeVisible();
 expect(f.control.blockedMutations).toEqual([]);
});

test('creator actions drill through themed block and location cards', {"tag":["@bunch-note"]},async({page,baseURL},testInfo)=>{
 const f=await fixture(page,baseURL!);
 await openBunchNotesFromInventory(page);
 await page.evaluate(project=>{
  document.body.classList.add('ops-precision-pilot');
  document.body.dataset.opsTheme=project==='cache-android'?'dark':'light';
  document.documentElement.classList.toggle('outdoor-mode',project==='cache-iphone');
 },testInfo.project.name);
 const block=page.getByRole('button',{name:'Open block FULL.BLOCK',exact:true});
 await expect(block).toBeVisible();
 await expect.poll(()=>block.evaluate(el=>{const probe=document.createElement('span');probe.style.color='var(--ops-surface)';el.append(probe);const same=getComputedStyle(el).backgroundColor===getComputedStyle(probe).color;probe.remove();return same;})).toBe(true);
 await block.click();
 for(const [i,location] of ['C.12.001'].entries()) {
   await openAuthorLocation(page,location);
  await page.getByLabel('Work type',{exact:true}).fill('Rain day '+i);
  await page.getByRole('button',{name:'Next',exact:true}).click();
  await expect(page.locator('.bn-plant')).toHaveCount(0);
  await openAdvancedInventoryControls(page);
  await expect(page.getByLabel('Work type',{exact:true})).toHaveCount(0);
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
  }
  await expect.poll(()=>page.locator('#bunch-note-content').evaluate(el=>[el,...el.querySelectorAll('button,summary,input,select,textarea,.bn-card')].every(node=>{const box=node.getBoundingClientRect();return !box.width||(box.left>=-1&&box.right<=innerWidth+1);}))).toBe(true);
  await expect.poll(()=>page.locator('#bunch-note-content button:visible, #bunch-note-content summary:visible').evaluateAll(nodes=>nodes.every(n=>n.getBoundingClientRect().height>=44))).toBe(true);
  await page.locator('#global-header-inline-back').click();
  await page.locator('#global-header-inline-back').click();
 }
 const created=f.commands.filter(c=>c.operation==='save').at(-1).payload.body.locations[0];
 expect(created.row_ids).toEqual(['a','a2']);
 expect(created.actions[0].row_ids).toEqual(['a','a2']);
 expect(created.actions.find((a:any)=>a.group==='hauling').row_ids).toEqual(['a']);
 expect(created.actions.filter((a:any)=>['ta','move'].includes(a.kind))).toHaveLength(2);
 const savedFirstLocation=await wizardLocationButton(page,'C.12.001','C.12.');
 const savedSecondLocation=await wizardLocationButton(page,'C.12.002','C.12.');
 await expect(savedFirstLocation).toBeVisible();
 await expect(savedSecondLocation).toBeVisible();
 expect(await savedFirstLocation.getAttribute('onclick')).not.toBe(await savedSecondLocation.getAttribute('onclick'));
 expect(f.control.blockedMutations).toEqual([]);
});

test('creator adds a whole-location action on the second location card', {"tag":["@bunch-note"]},async({page,baseURL})=>{
 const f=await fixture(page,baseURL!);f.options.push({id:'custom-walkway',category:'sequence',label:'Check walkway',kind:'instruction',active:true,revision:1});
 await openBunchNotesFromInventory(page);
 await page.getByRole('button',{name:'Open block FULL.BLOCK',exact:true}).click();
 await openAuthorLocation(page,'C.12.002');
 await page.getByLabel('Work type',{exact:true}).fill('Rain day 1');
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await expect(page.locator('.bn-plant')).toHaveCount(0);
 await openAdvancedInventoryControls(page);
 await expect(page.getByLabel('Work type',{exact:true})).toHaveCount(0);
 await expect(page.locator('.bn-plant')).toHaveCount(1);
 await expect(page.locator('.bn-plant')).toContainText('LOC Available Unknown');
 await expect(page.locator('.bn-plant')).toContainText('LOC On Hand 10');
 await page.getByRole('checkbox',{name:'Select item BN-I',exact:true}).uncheck();
 await page.getByRole('checkbox',{name:'Select item BN-I',exact:true}).check();
 const checklist=page.locator('.bn-wizard-items > details.bn-options .bn-options-body > details.bn-options').filter({has:page.locator('summary').filter({hasText:'Whole-location actions'})});
 await checklist.locator('summary').first().click();
 await checklist.getByText('Sequence',{exact:true}).click();
 await checklist.getByRole('button',{name:'Check walkway',exact:true}).click();
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await expect(page.locator('#bunch-note-content')).toHaveAttribute('aria-busy','false');
 const created=f.commands.filter(c=>c.operation==='save').at(-1).payload.body.locations[0];
 expect(created.location).toBe('C.12.002');
 expect(created.actions[0].scope).toBe('location');
 await expect.poll(()=>page.locator('#bunch-note-content').evaluate(el=>[el,...el.querySelectorAll('button,summary,input,select,textarea,.bn-card')].every(node=>{const box=node.getBoundingClientRect();return !box.width||(box.left>=-1&&box.right<=innerWidth+1);}))).toBe(true);
 await expect.poll(()=>page.locator('#bunch-note-content button:visible, #bunch-note-content summary:visible').evaluateAll(nodes=>nodes.every(n=>n.getBoundingClientRect().height>=44))).toBe(true);
 expect(f.control.blockedMutations).toEqual([]);
});

function savedMultiLocationDraft(rows:any[]) {
 const action=(id:string,group:string,label:string,row_ids:string[],scope='rows',kind='instruction')=>({id,group,label,kind,instructions:label,scope,row_ids,quantity:['move','hauling'].includes(kind)?'4':'',percentage:'',crew:'',stage:'',destination:['move','hauling'].includes(kind)?'C.12.002':'',destination_mode:'matching',marking:''});
 return {id:'draft',revision:1,block:'FULL.BLOCK',updated_at:new Date().toISOString(),body:{block:'FULL.BLOCK',recipient_ids:[],locations:[
  {location:'C.12.001',purposes:'Rain day 0',priority:'',instructions:'',prerequisites:'',owner_id:'',row_ids:['a','a2'],source_all:[rows[0],rows[1]],source:[rows[0],rows[1]],actions:[action('center','placement','Center house',['a','a2']),action('ta','inventory','TA / culls follow-up',['a'],'rows','ta'),action('move','inventory','Move',['a'],'rows','move'),action('haul','hauling','Grade shift',['a'],'rows','hauling')]},
  {location:'C.12.002',purposes:'Rain day 1',priority:'',instructions:'',prerequisites:'',owner_id:'',row_ids:['b'],source_all:[rows[2]],source:[rows[2]],actions:[action('custom','sequence','Check walkway',['b'],'location')]}
 ]}};
}

test('saved multi-location batch preserves actions through Bunch and completed-work PDFs', {"tag":["@bunch-note"]},async({page,baseURL})=>{
 const f=await fixture(page,baseURL!);f.drafts.push(savedMultiLocationDraft(f.rows));
 await openBunchNotesFromInventory(page);
 await expect(page.getByRole('button',{name:'Open batch FULL.BLOCK',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Open batch FULL.BLOCK',exact:true}).click();
 await openAuthorLocation(page,'C.12.001');
 await expect(page.getByLabel('Work type',{exact:true})).toHaveValue('Rain day 0');
 await advanceWizardToItems(page);
 await openAdvancedInventoryControls(page);
 await expect(page.getByLabel('Work type',{exact:true})).toHaveCount(0);
 await expect(page.locator('#bunch-note-content')).toContainText('Rain day 0');
 await page.getByRole('button',{name:'Open item BN-I',exact:true}).click();
 await page.getByRole('button',{name:'Edit Center house',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Instruction',exact:true})).toHaveValue('Center house');
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await expect(page.locator('#bunch-note-content')).toHaveAttribute('aria-busy','false');
 await page.locator('#global-header-inline-back').click();
 await expect.poll(()=>f.commands.filter(c=>c.operation==='save').length).toBeGreaterThan(0);
 const saved=f.commands.filter(c=>c.operation==='save').at(-1).payload.body;
 expect(saved.locations.map((l:any)=>l.location)).toEqual(['C.12.001','C.12.002']);
 expect(saved.locations[0].actions[0].row_ids).toEqual(['a','a2']);
 expect(saved.locations[0].actions.find((a:any)=>a.group==='hauling').row_ids).toEqual(['a']);
 expect(saved.locations[0].actions.filter((a:any)=>['ta','move'].includes(a.kind))).toHaveLength(2);
 expect(saved.locations[1].actions[0].scope).toBe('location');
 await page.getByRole('button',{name:'Preview PDFs and recipients',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Review Inv Bunch Notes PDFs'})).toBeVisible();
 await expect(page.locator('#bunch-note-content iframe')).toHaveCount(2);
 await expect(page.locator('#bunch-note-content')).toContainText('dylan_collyge@greenleafnursery.com');
 await expect.poll(async()=>{const r=await page.locator('#bunch-note-content').boundingBox();return !!r&&r.x+r.width<=page.viewportSize()!.width+1;}).toBe(true);
 await page.evaluate(()=>{(window as any).__bunchPublishedEvents=0;window.addEventListener('gnc:bunch-published',()=>{(window as any).__bunchPublishedEvents++;});});
 await page.getByRole('button',{name:'Publish and email reviewed PDFs',exact:true}).click();
 await expect.poll(()=>f.jobs.length).toBe(2);
 await expect.poll(()=>page.evaluate(()=>(window as any).__bunchPublishedEvents)).toBe(1);
 expect(f.commands.find(c=>c.operation==='publish').payload.send_email).toBe(true);
 f.jobs[0].status='complete';f.jobs[0].actuals=[];f.jobs[0].worker_actions=[];
 await page.locator('#bn-assigned-work-mode').click();
 await expect(page.locator('#bn-assigned-work-mode')).toHaveAttribute('aria-pressed','true');
 const queue=page.locator('#bunch-note-content');
 const press=test.info().project.use.isMobile?'tap':'click';
 await expect(queue).toHaveAttribute('aria-busy','false');
 await queue.getByRole('button',{name:'Completed',exact:true})[press]();
 await expect(queue.getByRole('button',{name:'Completed',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(queue).toHaveAttribute('aria-busy','false');
 // Use the real touch input on phones. The prior trace showed a successful
 // mouse click with no parent-to-child transition during the mobile repaint.
 const parent=queue.getByRole('button',{name:'Open location C.12',exact:true});
 await expect(parent).toBeVisible();
 await parent[press]();
 const location=queue.getByRole('button',{name:'Open location C.12.001',exact:true});
 await expect(location).toBeVisible();
 await location[press]();
 await page.getByRole('button',{name:'Open',exact:true}).click();
 await page.getByText('Completed-work PDF and recipients',{exact:true}).click();
 await page.getByRole('button',{name:'Preview completed-work PDF',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Review Completed Work PDFs',exact:true})).toBeVisible();
 await expect(page.locator('#bunch-note-content iframe')).toHaveCount(1);
 await page.getByRole('button',{name:'Save and email reviewed PDF',exact:true}).click();
 await expect.poll(()=>f.commands.filter(c=>c.operation==='work_publish').length).toBe(1);
 // The mocked API publish emits the event consumed by the Que shell; opening
 // the queue must show both newly published jobs without a manual refresh.
 const queuePress=test.info().project.use.isMobile?'tap':'click';
 await page.locator('#footer-request-btn')[queuePress]();
 await page.locator('[data-request-category="bunch-notes"]')[queuePress]();
 await expect(page.locator('[data-bunch-card]')).toHaveCount(2);
 await expect(page.locator('[data-bunch-card]').first()).toContainText('Published Bunch Note');
 expect(f.control.blockedMutations).toEqual([]);
});

test('shell repaint during Back retains creator state without reloading metadata', {"tag":["@bunch-note"]},async({page,baseURL})=>{
 const f=await fixture(page,baseURL!);
 await openBunchNotesFromInventory(page);
 await page.getByRole('button',{name:'Open block FULL.BLOCK',exact:true}).click();
 await openAuthorLocation(page,'C.12.001');
 await page.getByLabel('Work type',{exact:true}).fill('Rain day');
 await advanceWizardToItems(page);
 await openAdvancedInventoryControls(page);
 await expect(page.getByRole('button',{name:'Open item BN-I',exact:true})).toBeEnabled();
 await expect(page.locator('#bunch-note-content')).toHaveAttribute('aria-busy','false');
 const metadataCount=()=>f.commands.filter(c=>['blocks','directory','drafts','catalog'].includes(c.operation)).length;
 const before=metadataCount();
 await page.evaluate(()=>document.getElementById('global-header-inline-back')!.addEventListener('pointerdown',()=>window.eval(`renderViewContent('bunch-note',false,true)`),{capture:true,once:true}));
 await page.locator('#global-header-inline-back').click();
 await expect(page.getByLabel('Work type',{exact:true})).toBeVisible();
 expect(metadataCount()).toBe(before);
 await page.locator('#global-header-inline-back').click();
 await expect(await wizardLocationButton(page,'C.12.002','C.12.')).toBeVisible();
});

test('combined move keeps its full destination and opens destination instructions', {"tag":["@bunch-note"]},async({page,baseURL})=>{
 const f=await fixture(page,baseURL!);
 await openBunchNotesFromInventory(page);
 await page.getByRole('button',{name:'Open block FULL.BLOCK',exact:true}).click();
 await openAuthorLocation(page,'C.12.001');
 await page.getByLabel('Work type',{exact:true}).fill('Grade and move');
 await advanceWizardToItems(page);
 await openAdvancedInventoryControls(page);
 await page.getByRole('checkbox',{name:'Select item BN-I',exact:true}).check();
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
test('worker without Request permission sees assigned Bunch work in Inventory, claims and completes without email', {"tag":["@bunch-note"]},async({page,baseURL})=>{
 const f=await fixture(page,baseURL!,true);
 await openBunchNotesFromInventory(page);
 await expect(page.locator('#home-tile-bunch-note')).toHaveCount(0);
 await expect(page.locator('[data-request-category="bunch-notes"]')).toHaveCount(0);
 await expect(page.locator('#bn-create-note-mode')).toHaveCount(0);
 // Reproduce a verified update through the entire shell while the parent
 // press is in flight, not only the Bunch module's own render entry point.
 // The real navigation handler must run exactly once without retrying the press.
 await page.evaluate(async()=>{
  const note=(window as any).BunchNote,update=await note.stage({});
  const openBase=note.queueBase;
  (window as any).__bunchParentActivations=0;
  note.queueBase=(value:string)=>{(window as any).__bunchParentActivations++;return openBase(value);};
  document.getElementById('request-content')!.addEventListener('pointerdown',()=>{
   note.commit(update);window.eval("renderViewContent('request',false,true)");
  },{capture:true,once:true});
 });
 await page.getByRole('button',{name:'Open location C.12',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).__bunchParentActivations)).toBe(1);
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
 const action=(label:string)=>page.locator('#bunch-note-content article.bn-card').filter({has:page.getByRole('heading',{name:label,exact:true})});
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
 await expect.poll(()=>page.locator('#bunch-note-content').evaluate(el=>[el,...el.querySelectorAll('button,summary,input,select,textarea,.bn-card')].every(node=>{const box=node.getBoundingClientRect();return !box.width||(box.left>=-1&&box.right<=innerWidth+1);}))).toBe(true);
 await page.getByRole('button',{name:'Complete location',exact:true}).click();
 await page.getByRole('button',{name:'Completed',exact:true}).click();
 await page.getByRole('button',{name:'Open location C.12',exact:true}).click();
 await page.getByRole('button',{name:'Open location C.12.001',exact:true}).click();
 await expect(page.locator('#bunch-note-content')).toContainText('BN-1');
 expect(f.commands.some(c=>['send','publish','preview','retry'].includes(c.operation))).toBe(false);
});

test('worker claims and completes only the selected published inventory card', {"tag":["@bunch-note"]},async({page,baseURL})=>{
 const f=await fixture(page,baseURL!,true),job=f.jobs[0];
 job.cards=[
  {id:'card-a',kind:'inventory',itemcode:'BN-I',commonname:'Bunch Plant',contsize:'#3',row_ids:['a'],owner_id:null,owner_name:null,house:'North House',direction:'West to East',status:'open',revision:4},
  {id:'card-b',kind:'inventory',itemcode:'BN-I',commonname:'Bunch Plant',contsize:'#5',row_ids:['a2'],owner_id:hlUserId,owner_name:'Dylan',house:'South House',direction:'East to West',status:'open',revision:7}
 ];
 job.body.actions=[
  {id:'card-action-a',card_id:'card-a',group:'placement',scope:'rows',row_ids:['a'],label:'North House task',instructions:'North House task'},
  {id:'card-action-b',card_id:'card-b',group:'placement',scope:'rows',row_ids:['a2'],label:'South House task',instructions:'South House task'}
 ];
 job.progress={'card-action-a':{status:'done',reason:'Already handled'}};
 await openAssignedBunchWorkFromInventory(page);
 await page.getByRole('button',{name:'Open location C.12',exact:true}).click();
 await page.getByRole('button',{name:'Open location C.12.001',exact:true}).click();
 await page.getByRole('button',{name:'Open',exact:true}).click();
 await expect(page.getByRole('button',{name:'Open card',exact:true})).toHaveCount(2);
 const cardA=page.locator('.bn-card').filter({hasText:'North House'});
 await expect(cardA).toContainText('Unassigned');
 await cardA.getByRole('button',{name:'Claim card',exact:true}).click();
 expect(f.commands.filter(c=>c.operation==='claim_card').at(-1)).toMatchObject({expectedRevision:4,payload:{card_id:'card-a'}});
 await cardA.getByRole('button',{name:'Open card',exact:true}).click();
 await expect(page.locator('#bunch-note-content')).toContainText('North House task');
 await expect(page.locator('#bunch-note-content')).not.toContainText('South House task');
 await expect(page.locator('#bunch-note-content')).toContainText('27.F1');
 await expect(page.locator('#bunch-note-content')).not.toContainText('LOT2');
 await page.getByRole('button',{name:'Complete card',exact:true}).click();
 expect(f.commands.filter(c=>c.operation==='complete_card').at(-1)).toMatchObject({expectedRevision:5,payload:{card_id:'card-a'}});
 expect(f.control.blockedMutations).toEqual([]);
});


test('phone steps retain failed saves and make mixed-year and unknown-year destinations reachable', {"tag":["@bunch-note"]},async({page,baseURL})=>{
 const f=await fixture(page,baseURL!);f.rows[1].salesyear='';
 await openBunchNotesFromInventory(page);
 await page.getByRole('button',{name:'Open block FULL.BLOCK',exact:true}).click();
 await openAuthorLocation(page,'C.12.001');
 await page.getByLabel('Work type',{exact:true}).fill('Move safely');f.failNextSave();
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await expect(page.locator('#bunch-note-content [role=alert]')).toContainText('Save unavailable');
 await expect(page.getByLabel('Work type',{exact:true})).toHaveValue('Move safely');
 // Retry the retained header save once after the transient failure.
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await openAdvancedInventoryControls(page);
 await expect(page.getByRole('button',{name:'Open item BN-I',exact:true})).toBeVisible();
 expect(f.commands.filter(c=>c.operation==='save')).toHaveLength(2);
 await page.getByRole('checkbox',{name:'Select item BN-I',exact:true}).check();
 await page.getByRole('button',{name:'Open item BN-I',exact:true}).click();
 await page.locator('.bn-action-choices').getByText('Inventory',{exact:true}).click();
 await page.getByRole('button',{name:'Move',exact:true}).click();
 await expect(page.getByRole('button',{name:'Choose location',exact:true})).toBeInViewport();
 await page.getByLabel('Planned quantity',{exact:true}).fill('3');
 await page.getByRole('combobox',{name:'Source item and sales year',exact:true}).selectOption('BN-I|2027');
 await page.getByRole('button',{name:'Choose location',exact:true}).click();
 await page.getByRole('button',{name:'Open location C.12',exact:true}).click();
 await page.getByRole('button',{name:'Open location C.12.002',exact:true}).click();
 await page.getByRole('combobox',{name:'Source item and sales year',exact:true}).selectOption('BN-I|');
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
 // The click finishes before the retried save/render promise. Back while busy
 // is intentionally consumed, so first establish the saved item view.
 await expect(page.locator('#bunch-note-content')).toHaveAttribute('aria-busy','false');
 await expect(page.getByLabel('Planned quantity',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Edit Move',exact:true})).toBeVisible();
 await page.goBack();
 await expect(page.getByRole('button',{name:'Open item BN-I',exact:true})).toBeVisible();
 const saved=f.commands.filter(c=>c.operation==='save').at(-1).payload.body.locations[0];
 expect(saved.actions).toHaveLength(1);expect(saved.actions[0]).toMatchObject({destination:'D.08.001',row_ids:['a2'],quantity:'3'});expect(saved.source_all).toHaveLength(2);
 expect(f.control.blockedMutations).toEqual([]);
});
