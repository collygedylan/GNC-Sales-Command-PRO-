import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read = p => readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read(process.env.BUNCH_NOTE_COMPILED_SHELL ? '_site/assets/bunch-note.js' : 'assets/bunch-note.js'), gas=read('Code.gs'), migration=read('supabase/migrations/20260920060133_bunch_note_location_work_v1.sql');
const plain=value=>JSON.parse(JSON.stringify(value));
function runtime(extra={}) {
 const ctx=vm.createContext({console,Date,Map,Set,URL,Blob,Uint8Array,structuredClone,
  currentUser:'dylan_collyge',nativeAuthSessionActive:true,nativeAuthProfile:{id:'dylan',username:'dylan_collyge',must_change_password:false},
  APP_API_FUNCTION_URL:'https://fixture.invalid',postAppFunctionJson:async()=>({ok:true,data:{jobs:[]}}),...extra});
 vm.runInContext(read('assets/location-code.js'),ctx);vm.runInContext(js,ctx); return ctx;
}

test('base location cards preserve exact bays and nonstandard codes',()=>{
 const b=runtime().BunchNote;
 assert.deepEqual(plain([...b.locationGroups([' d.08.001 ','D.08.002','D.08.001','0.00.111','D.08','SPECIAL.LOC','D.08.001.EXTRA'])]),
  [['0.00',['0.00.111']],['D.08',['D.08','D.08.001','D.08.002']],['D.08.001.EXTRA',['D.08.001.EXTRA']],['SPECIAL.LOC',['SPECIAL.LOC']]]);
 assert.equal(b.baseLocation('D.08'),'D.08');assert.equal(b.baseLocation('SPECIAL.LOC'),'SPECIAL.LOC');
});

test('destination sales years use only the actual year and keep mixed groups separate',()=>{
 const b=runtime().BunchNote;
 assert.equal(b.salesYear('26'),'2026');assert.equal(b.salesYear(' 2026 '),'2026');
 for(const v of ['',null,'26.Y','unknown'])assert.equal(b.salesYear(v),'');
 const groups=b.sourceGroups([{itemcode:' A ',salesyear:'26',season:'27.Y'},{itemcode:'a',salesyear:'2026'},{itemcode:'A',salesyear:'27'},{itemcode:'A',season:'26.Y'}]);
 assert.deepEqual([...groups].map(([key,rows])=>[key,rows.length]),[['A|2026',2],['A|2027',1],['A|',1]]);
 assert.equal(b.templates.find(t=>t.label==='Grade and Save / Move To').kind,'move');
});

test('top-level Back traverses item, bay and base while retaining planned destination and draft input',async()=>{
 const row={unique_id:'source',blockalpha:'D',locationcode:'D.08.001',itemcode:'PLANT',commonname:'Plant',salesyear:'26',contsize:'#3',lotcode:'LOT',stock:0,review:null,available:0};
 const element={classList:{add(){}},innerHTML:'',setAttribute(){},querySelectorAll:()=>[]};let saved,serial=0;
 const option={id:'move',category:'grading',label:'Grade and Save / Move To',kind:'move',active:true};
 const ctx=runtime({crypto:{randomUUID:()=>String(++serial)},document:{getElementById:()=>element},getCurrentVisibleViewId:()=> 'bunch-note',showToast(){},postAppFunctionJson:async(_url,body)=>{
  const data=body.operation==='blocks'?{blocks:['D']}:body.operation==='directory'?{users:[]}:body.operation==='drafts'?{drafts:[]}:body.operation==='catalog'?{options:[option],locations:['D.08.001','D.09.001']}:body.operation==='inventory'?{rows:[row]}:body.operation==='destination_lookup'?{itemcode:'PLANT',salesyear:'2026',locations:['D.08.001','D.09.001','OTHER'],matching:[{...row,locationcode:'D.09.001'}]}:body.operation==='save'?(saved=structuredClone(body.payload.body),{draft:{id:'batch',revision:1,body:saved}}):{};
  return {ok:true,data};
 }}),b=ctx.BunchNote;
 await b.open();await b.chooseBlock('D');assert.ok(element.innerHTML.includes('Open location D.08"'));
 assert.ok(!element.innerHTML.includes('Open location D.08.001"'));
 b.openBase('D.08');b.openLocation('D.08.001');b.edit(0,'purposes','Grade for shipping');assert.ok(element.innerHTML.includes('Next: Items'));assert.ok(!element.innerHTML.includes('Open item PLANT'));await b.nextItems();assert.equal(saved.locations[0].actions.length,0);b.openItem('D.08.001|PLANT');
 const key='item:0:D.08.001|PLANT';b.startAction(key,'move');b.startAction(key,'move');b.actionField('quantity','4');assert.ok(element.innerHTML.includes('Choose location'));
 await b.chooseActionDestination();assert.ok(element.innerHTML.includes('Locations with this item'));assert.ok(element.innerHTML.includes('All other locations'));
 b.destinationBase('D.09');b.pickDestination('D.09.001');await b.finishAction();assert.equal(saved.locations[0].actions.length,1);
 assert.equal(saved.locations[0].actions[0].destination,'D.09.001');assert.equal(saved.locations[0].actions[0].destination_mode,'matching');
 assert.equal(saved.locations[0].source_all[0].locationcode,'D.08.001');
 assert.equal(b.back(),true);assert.ok(element.innerHTML.includes('Open item PLANT'));assert.ok(!element.innerHTML.includes('Choose destination'));
 assert.equal(b.back(),true);assert.ok(element.innerHTML.includes('Next: Items'));
 assert.equal(b.back(),true);assert.ok(element.innerHTML.includes('Open location D.08.001"'));
 assert.equal(b.back(),true);assert.ok(element.innerHTML.includes('Open location D.08"'));
 assert.doesNotMatch(element.innerHTML,/>Back(?: to)?[ <]/);
});
test('complete normalized block/location grouping keeps all seasons and deduplicates identity',()=>{
 const b=runtime().BunchNote;
 const r={unique_id:'1',blockalpha:' c.12.full ',locationcode:' c.12.0001 ',season:'26.F1'};
 const g=b.groupInventory([r,{...r}, {...r,unique_id:'2',season:'27.F1'}, {...r,unique_id:'3',blockalpha:'C.12.OTHER'}, {...r,unique_id:'4',locationcode:''}]);
 assert.deepEqual([...g.keys()],['C.12.FULL','C.12.OTHER']);
 assert.equal(g.get('C.12.FULL').get('C.12.0001').length,2);
 assert.equal(g.get('C.12.FULL').get('C.12.0001')[0].blockalpha,' c.12.full ');
});
test('stock zero, unknown and invalid values remain distinct',()=>{
 const q=runtime().BunchNote.quantity;
 for(const value of [null,undefined,'','  ','N/A',false,{},'Infinity']) assert.equal(q(value),null);
 assert.equal(q('0'),0);assert.equal(q(' 12.5 '),12.5);assert.equal(q('-2'),-2);
});
test('item cards combine sizes and lots, deduplicate only source identity, and keep incomplete totals unknown',()=>{
 const b=runtime().BunchNote,r={unique_id:'1',locationcode:' a.1 ',itemcode:' plant ',contsize:'#3',lotcode:'one',stock:'10',review:'0',available:'8'};
 const groups=b.groupItems([r,{...r},{...r,unique_id:'2',itemcode:'PLANT',contsize:'#5',lotcode:'two',stock:'20',review:null,available:'0'},{...r,unique_id:'3',locationcode:'A.2'},{...r,unique_id:'4',itemcode:''},{...r,unique_id:'5',itemcode:''}]);
 assert.equal(groups.length,4);assert.equal(groups[0].rows.length,2);assert.equal(groups[0].stock,30);assert.equal(groups[0].review,null);assert.equal(groups[0].available,8);
 assert.equal(groups[1].review,0);
});
test('Shift/Hauling accepts either season condition OR designation and never Open Stock',()=>{
 const eligible=runtime().BunchNote.shiftEligible;
 for(const r of [{season:'27.y'},{season:'U3A'},{season:'F1',desigitem:'pre-shft'},{season:null,desigitem:'SHFT'}])assert.equal(eligible(r),true);
 for(const r of [{season:'F1',desigitem:''},{season:null,desigitem:null},{season:'',s_lts:'Y'}])assert.equal(eligible(r),false);
});
test('catalog covers every action group without assigning instruction labels',()=>{
 const templates=runtime().BunchNote.templates;
 assert.deepEqual([...new Set(templates.map(t=>t.group))],['sequence','grading','hauling','placement','inventory']);
 for(const label of ['Early protection','Rain-day preparation','Shear before bunching','Wait for hauling before bunching','Center house','Countable rows','Variety mixes','Obsolete-location review']) assert.ok(templates.some(t=>t.label===label));
 assert.ok(templates.every(t=>!t.owner_id&&!t.recipient_ids));
});
test('recipients require Dylan, deduplicate addresses, and never add crew labels or Sharon implicitly',()=>{
 const b=runtime().BunchNote, directory=[{id:'d',username:'dylan_collyge',email:'dylan@example.test'},{id:'w',username:'worker',email:'worker@example.test'},{id:'alias',username:'alias',email:'WORKER@example.test'},{id:'s',username:'sharon_combs',email:'sharon@example.test'}];
 assert.deepEqual(plain(b.recipientEmails(directory,['w','alias','w'])),['worker@example.test','dylan@example.test']);
 assert.throws(()=>b.recipientEmails(directory,['attacker@example.test']),/active users/);
 assert.throws(()=>b.recipientEmails(directory.filter(u=>u.id!=='d'),[]),/Dylan/);
});
test('creator uses exact active native profile, excluding privileged manager aliases',()=>{
 const ctx=runtime();assert.equal(ctx.BunchNote.author(),true);
 for(const username of ['jd_jones','megan_kelly','worker']) {ctx.nativeAuthProfile.username=username;assert.equal(ctx.BunchNote.author(),false);}
 ctx.nativeAuthProfile.username='dylan_collyge';ctx.nativeAuthProfile.disabled_at='2026-01-01';assert.equal(ctx.BunchNote.author(),false);
 ctx.nativeAuthProfile.disabled_at=null;ctx.nativeAuthProfile.locked_until='2999-01-01';assert.equal(ctx.BunchNote.author(),false);
});
test('uncertain command retains its id and same-user reauthentication rejects old responses',async()=>{
 const requests=[]; let fails=true;
 const ctx=runtime({postAppFunctionJson:async(_url,body)=>{requests.push(body);if(fails)throw new Error('lost');return {ok:true,data:{saved:true}};}});
 await assert.rejects(ctx.BunchNote.api('save',{a:1},1,'first'),/lost/);fails=false;
 await ctx.BunchNote.api('save',{a:1},1,'second');assert.equal(requests[1].commandId,'first');
 let resolve;ctx.postAppFunctionJson=()=>new Promise(r=>resolve=r);
 const pending=ctx.BunchNote.api('list');ctx.BunchNote.reset();resolve({ok:true,data:{jobs:[{private:true}]}});
 await assert.rejects(pending,/session changed/);
});
test('failed initial Queue read does not auto-loop; explicit refresh can recover',async()=>{
 let calls=0;const element={classList:{add(){}},innerHTML:'',setAttribute(){},querySelectorAll:()=>[]};
 const ctx=runtime({getCurrentVisibleViewId:()=> 'request',activeReqTab:'bunch-notes',document:{getElementById:()=>element},showToast(){},postAppFunctionJson:async()=>{calls++;throw new Error('offline');}});
 ctx.BunchNote.render();await new Promise(r=>setTimeout(r,0));assert.equal(calls,1);
 ctx.BunchNote.render();await new Promise(r=>setTimeout(r,0));assert.equal(calls,1);
 ctx.postAppFunctionJson=async()=>{calls++;return {ok:true,data:{jobs:[]}};};await ctx.BunchNote.refresh();assert.equal(calls,2);
});

test('refresh commits preserve active controls and cannot overwrite newer commands',async()=>{
 const element={classList:{add(){}},innerHTML:'unchanged',setAttribute(){},querySelectorAll:()=>[]};
 const ctx=runtime({getCurrentVisibleViewId:()=> 'request',activeReqTab:'bunch-notes',document:{getElementById:()=>element}});
 const stale=await ctx.BunchNote.stage({});
 await ctx.BunchNote.api('claim',{job_id:'work'},1,'claim-id');
 ctx.BunchNote.commit(stale);
 assert.equal(element.innerHTML,'unchanged');
 ctx.BunchNote.commit(await ctx.BunchNote.stage({}));
 assert.equal(element.innerHTML,'unchanged');
 ctx.BunchNote.render();
 assert.ok(element.innerHTML.includes('Bunch Notes'));
});
test('pending actual saves lock controls, retain newer input, and preserve failed entries',async()=>{
 const controls=Array.from({length:4},()=>({disabled:false})),attributes={},requests=[];
 const element={classList:{add(){}},set innerHTML(value){this.html=value;controls.forEach(c=>{c.disabled=false;});},get innerHTML(){return this.html;},setAttribute(k,v){attributes[k]=v;},querySelectorAll:()=>controls};
 const job={id:'work',owner_id:'dylan',status:'open',revision:1,instruction_revision:1,progress:{},body:{actions:[{id:'ta',kind:'ta',group:'inventory',scope:'location',instructions:'TA'}],source:[]},actuals:[]};
 let release,fail=false,command=0;
 const ctx=runtime({crypto:{randomUUID:()=>String(++command)},getCurrentVisibleViewId:()=> 'request',activeReqTab:'bunch-notes',document:{getElementById:()=>element},showToast(){},postAppFunctionJson:async(_url,body)=>{
  if(body.operation==='get')return {ok:true,data:{job,versions:[],audit:[]}};
  if(body.operation==='catalog')return {ok:true,data:{options:[],locations:[]}};
  if(body.operation==='directory')return {ok:true,data:{users:[]}};
  if(body.operation==='list')return {ok:true,data:{jobs:[job]}};
  requests.push(body);if(fail)throw new Error('offline');
  if(requests.length===1)await new Promise(resolve=>{release=resolve;});
  return {ok:true,data:{job}};
 }});
 await ctx.BunchNote.refresh();
 await ctx.BunchNote.detail('work');
 ctx.BunchNote.workField('work:ta','source_id','lot');ctx.BunchNote.workField('work:ta','quantity','2');
 const pending=ctx.BunchNote.recordActual('ta');
 assert.equal(attributes['aria-busy'],'true');assert.ok(controls.every(c=>c.disabled));
 // A queued event or another caller must not have its newer draft erased by an old response.
 ctx.BunchNote.workField('work:ta','quantity','3');release();await pending;
 assert.equal(attributes['aria-busy'],'false');assert.ok(controls.every(c=>!c.disabled));
 await ctx.BunchNote.recordActual('ta');assert.deepEqual(requests.map(r=>r.payload.quantity),['2','3']);
 ctx.BunchNote.workField('work:ta','quantity','4');fail=true;await ctx.BunchNote.recordActual('ta');
 fail=false;await ctx.BunchNote.recordActual('ta');
 assert.deepEqual(requests.slice(-2).map(r=>r.payload.quantity),['4','4']);
 assert.equal(requests.at(-1).commandId,requests.at(-2).commandId);
});
test('PDF repeats headers, paginates, includes all required details, and escapes instructions',()=>{
 const ctx=vm.createContext({escapeEmailHtml_:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')});
 vm.runInContext(gas.slice(gas.indexOf('function buildBunchNotePdfHtml_'),gas.indexOf('function handleBunchNotePreview_')),ctx);
 const html=ctx.buildBunchNotePdfHtml_({note_number:'BN-1',instruction_revision:2,block:'FULL.BLOCK',location:'C.12.1',purposes:'Rain day',priority:'1',instructions:'<script>bad</script>',prerequisites:'Wait for hauling',source:[{unique_id:'row',itemcode:'I-1',commonname:'Plant',contsize:'#3',lotcode:'27.F1',stock:0,available:null,location_notes:'Keep aisles',flags:'Blue'}],actions:Array.from({length:200},(_,i)=>({id:String(i),scope:'rows',row_ids:['row'],instructions:'Work '+i,crew:'BOB',quantity:'5',stage:'Sheared',marking:'Pink'}))});
 for(const expected of ['table-header-group','counter(page)','counter(pages)','Revision 2','FULL.BLOCK','C.12.1','On Hand 0','Review Unknown','Available Unknown','Keep aisles','Work 199','BOB','Sheared','Pink'])assert.ok(html.includes(expected),expected);
 assert.ok(html.includes('&lt;script&gt;bad'));assert.ok(!html.includes('<script>bad'));
});
test('completed-work PDF separates planned/actual types and excludes superseded corrections from totals',()=>{
 const ctx=vm.createContext({escapeEmailHtml_:v=>String(v??'').replaceAll('<','&lt;')});
 vm.runInContext(gas.slice(gas.indexOf('function buildBunchNotePdfHtml_'),gas.indexOf('function handleBunchNotePreview_')),ctx);
 const source={unique_id:'lot',itemcode:'plant',contsize:'#3',lotcode:'Y1',stock:0,review:null,available:0},ta={id:'ta',label:'TA',kind:'ta',quantity:4},move={id:'move',label:'Move',kind:'move',worker_added:true};
 const actual=(action,quantity,extra={})=>({action_id:action.id,action_snapshot:action,source_snapshot:source,quantity,review_flags:[],...extra});
 const html=ctx.buildBunchNotePdfHtml_({note_number:'BN-1',instruction_revision:1,report_kind:'completed_work',work_revision:8,source:[source],actions:[ta,move],progress:{},actuals:[actual(ta,9,{superseded:true}),actual(ta,4,{replaces_id:'old'}),actual(move,3,{destination:'NEW.LOC',explanation:'<review>',review_flags:['exceeds_saved_stock']})]});
 for(const expected of ['Completed work 8','TA: 4','MOVE: 3','Planned 4','Actual 4','NEW.LOC','Correction; current','Replaced; excluded from totals','Worker added','REVIEW:','&lt;review>','LOC Review Unknown'])assert.ok(html.includes(expected),expected);
 assert.ok(!html.includes('TA: 13'));
});
function deliveryRuntime({prior='pending',loseAck=false,recovered=false}={}) {
 const calls=[];const saved={event_id:'e',event_key:'key',event_type:'bunch_note_submission',delivery_status:prior,recipients:[{email:'dylan@example.test'},{email:'worker@example.test'}],pdfs:[{base64:'pdf',filename:'BN-1.pdf'}],reports:[{block:'C.12',purposes:'Rain day',note_number:'BN-1',instruction_revision:1,location:'C.12.1'}]};
 const ctx=vm.createContext({escapeEmailHtml_:String,LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},Utilities:{computeDigest:()=>[1,2],DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1},base64Decode:v=>v,newBlob:(bytes,mime,name)=>({bytes,mime,name})},MimeType:{PDF:'application/pdf'},normalizeEmailAddress_:v=>String(v).trim().toLowerCase(),resolveRequestRecipientEmail_:()=> 'dylan@example.test',isLikelyEmailAddress_:v=>v.includes('@'),getRequestDeliveryReceipt_:()=>recovered?{gmailMessageId:'saved'}:null,findSentRequestDeliveryByMessageId_:()=>null,isGmailAdvancedServiceAvailable_:()=>true,resolveAutomatedEmailSenderAddress_:()=> 'from@example.test',saveRequestDeliveryReceipt_(){},requestDeliveryRest_:(path,method,query,body)=>{calls.push({path,body});return path.includes('lookup')?saved:{allow_send:true};},sendGmailApiMessage_:payload=>{calls.push({send:payload});if(loseAck)throw new Error('response lost');return {ok:true,gmailMessageId:'gmail-1'};}});
 vm.runInContext(gas.slice(gas.indexOf('function bunchNoteDeliveryRecord_'),gas.indexOf('function handleSignedRequestDeliveryEvent_')),ctx);
 return {calls,send:()=>ctx.handleSignedBunchNoteDelivery_({eventId:'e',eventKey:'key',eventType:'bunch_note_submission',messageIdHeader:'<gnc-0102@request-delivery.agdatasolutions.local>',leaseToken:'lease'})};
}
test('delivery uses frozen PDFs and exact recipients, records intent before sending',()=>{
 const d=deliveryRuntime(), result=d.send();assert.equal(result.ok,true);
 const sent=d.calls.find(c=>c.send).send;assert.deepEqual(plain(sent.toArray),['dylan@example.test','worker@example.test']);
 assert.equal(sent.subject,'BUNCH NOTES — C.12 — Rain day');assert.equal(sent.attachments.length,1);
 assert.ok(d.calls.findIndex(c=>c.body?.p_status==='sending')<d.calls.findIndex(c=>c.send));
 assert.ok(d.calls.some(c=>c.body?.p_status==='sent'));
});
test('uncertain delivery never blind-resends and receipt recovery does not send',()=>{
 const lost=deliveryRuntime({loseAck:true});assert.equal(lost.send().deliveryUncertain,true);assert.ok(lost.calls.some(c=>c.body?.p_status==='unknown'));
 const unknown=deliveryRuntime({prior:'unknown'});assert.equal(unknown.send().deliveryUncertain,true);assert.ok(!unknown.calls.some(c=>c.send));
 const recovered=deliveryRuntime({prior:'unknown',recovered:true});assert.equal(recovered.send().ok,true);assert.ok(!recovered.calls.some(c=>c.send));
});
test('migration confines writes and enforces durable ownership/revision/command boundaries',()=>{
 assert.doesNotMatch(migration,/(?:insert into|update|delete from)\s+public\.ph_master_inventory/i);
 assert.match(migration,/unique index bunch_note_one_open_location/);
 assert.match(migration,/for update;[\s\S]*BUNCH_NOTE_ALREADY_CLAIMED/);
 assert.match(migration,/pg_advisory_xact_lock/);assert.match(migration,/BUNCH_NOTE_COMMAND_CONFLICT/);
 assert.match(migration,/BUNCH_NOTE_UNRESOLVED_ACTIONS/);assert.match(migration,/BUNCH_NOTE_REASON_REQUIRED/);
 assert.match(migration,/bunch_note_private\.can_read\(actor,job\)/);
 assert.match(migration,/BUNCH_NOTE_BATCH_TOO_LARGE_SELECT_FEWER_LOCATIONS/);
 assert.match(migration,/revoke all on schema bunch_note_private from public, anon, authenticated/);
 const worker=read('supabase/functions/request-delivery-worker/index.ts');
 assert.match(worker,/saved\?\.delivery_status === "sent"[\s\S]*finishEvent/);
 new vm.Script(js);new vm.Script(gas);
});


test('move readiness requires destination while checklist and TA preserve optional planned quantities',()=>{
 const b=runtime().BunchNote,base={instructions:'Do work',scope:'rows',row_ids:['a']};
 for(const kind of ['move','hauling'])assert.equal(b.actionProblem({...base,kind}),'Choose a move destination');
 assert.equal(b.actionProblem({...base,kind:'move',destination:'D.08.001'}),'');
 assert.equal(b.actionProblem({...base,kind:'ta'}),'');
 assert.equal(b.actionProblem({...base,kind:'instruction'}),'');
 assert.equal(b.actionProblem({...base,kind:'move',label:'Grade and Save / Move To',destination:'D.08.001'}),'Enter the planned quantity');
 assert.match(b.actionProblem({...base,quantity:'-1'}),/positive whole/);
 assert.match(b.actionProblem({...base,quantity:'2',percentage:'50'}),/quantity or percentage/);
});

test('setup and action saves retain values on failure; source changes preserve choices and invalidate matching destination',async()=>{
 const rows=[{unique_id:'a',blockalpha:'D',locationcode:'D.08.001',itemcode:'PLANT',salesyear:'26',contsize:'#3',lotcode:'A'},
 {unique_id:'b',blockalpha:'D',locationcode:'D.08.001',itemcode:'PLANT',salesyear:null,contsize:'#5',lotcode:'B'}];
 const option={id:'move',category:'inventory',label:'Move',kind:'move',active:true};
 const element={classList:{add(){}},innerHTML:'',setAttribute(){},querySelectorAll:()=>[]};let serial=0,saved,fail=true,lookups=0;
 const ctx=runtime({crypto:{randomUUID:()=>String(++serial)},document:{getElementById:()=>element},getCurrentVisibleViewId:()=> 'bunch-note',showToast(){},postAppFunctionJson:async(_url,body)=>{
  if(body.operation==='save'&&fail)return {ok:false,message:'Save unavailable'};
  if(body.operation==='destination_lookup')lookups++;
  const data=body.operation==='blocks'?{blocks:['D']}:body.operation==='directory'?{users:[]}:body.operation==='drafts'?{drafts:[]}:body.operation==='catalog'?{options:[option],locations:['D.09.001','OTHER']}:body.operation==='inventory'?{rows}:body.operation==='destination_lookup'?{itemcode:'PLANT',salesyear:'2026',locations:['D.09.001','OTHER'],matching:[{...rows[0],locationcode:'D.09.001'}]}:body.operation==='save'?(saved=structuredClone(body.payload.body),{draft:{id:'batch',revision:1,body:saved}}):{};
  return {ok:true,data};
 }}),b=ctx.BunchNote;
 await b.open();await b.chooseBlock('D');b.openBase('D.08');b.openLocation('D.08.001');b.edit(0,'purposes','Move stock');await b.nextItems();
 assert.match(element.innerHTML,/Save unavailable/);assert.match(element.innerHTML,/value="Move stock"/);assert.match(element.innerHTML,/Next: Items/);
 fail=false;await b.nextItems();b.openItem('D.08.001|PLANT');b.startAction('item:0:D.08.001|PLANT','move');b.actionField('quantity','3');
 b.actionSource('PLANT|2026');await b.chooseActionDestination();b.destinationBase('D.09');b.pickDestination('D.09.001');
 b.actionSource('PLANT|');assert.match(element.innerHTML,/Choose location/);assert.ok(!element.innerHTML.includes('Move to: D.09.001'));assert.match(element.innerHTML,/value="PLANT\|2026"/);
 await b.chooseActionDestination();assert.match(element.innerHTML,/Same-item matching needs one known sales year/);assert.equal(lookups,1);b.pickDestination('OTHER','other');
 fail=true;await b.finishAction();assert.match(element.innerHTML,/Save unavailable/);assert.match(element.innerHTML,/Move to: OTHER/);assert.match(element.innerHTML,/value="3"/);
 fail=false;await b.finishAction();assert.equal(saved.locations[0].actions[0].destination,'OTHER');assert.deepEqual(plain(saved.locations[0].actions[0].row_ids),['b']);assert.equal(saved.locations[0].source_all.length,2);
});
