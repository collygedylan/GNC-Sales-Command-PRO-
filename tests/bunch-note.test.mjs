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
 vm.runInContext(js,ctx); return ctx;
}
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
test('catalog covers every action group without assigning instruction labels',()=>{
 const templates=runtime().BunchNote.templates;
 assert.deepEqual([...new Set(templates.map(t=>t.group))],['sequence','grading','hauling','placement','identification','inventory']);
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
 let calls=0;const element={classList:{add(){}},innerHTML:''};
 const ctx=runtime({getCurrentVisibleViewId:()=> 'request',activeReqTab:'bunch-notes',document:{getElementById:()=>element},showToast(){},postAppFunctionJson:async()=>{calls++;throw new Error('offline');}});
 ctx.BunchNote.render();await new Promise(r=>setTimeout(r,0));assert.equal(calls,1);
 ctx.BunchNote.render();await new Promise(r=>setTimeout(r,0));assert.equal(calls,1);
 ctx.postAppFunctionJson=async()=>{calls++;return {ok:true,data:{jobs:[]}};};await ctx.BunchNote.refresh();assert.equal(calls,2);
});

test('a refresh staged before a command cannot overwrite the newer work state',async()=>{
 const element={classList:{add(){}},innerHTML:'unchanged'};
 const ctx=runtime({getCurrentVisibleViewId:()=> 'request',activeReqTab:'bunch-notes',document:{getElementById:()=>element}});
 const stale=await ctx.BunchNote.stage({});
 await ctx.BunchNote.api('claim',{job_id:'work'},1,'claim-id');
 ctx.BunchNote.commit(stale);
 assert.equal(element.innerHTML,'unchanged');
 ctx.BunchNote.commit(await ctx.BunchNote.stage({}));
 assert.ok(element.innerHTML.includes('Bunch Notes'));
});
test('PDF repeats headers, paginates, includes all required details, and escapes instructions',()=>{
 const ctx=vm.createContext({escapeEmailHtml_:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')});
 vm.runInContext(gas.slice(gas.indexOf('function buildBunchNotePdfHtml_'),gas.indexOf('function handleBunchNotePreview_')),ctx);
 const html=ctx.buildBunchNotePdfHtml_({note_number:'BN-1',instruction_revision:2,block:'FULL.BLOCK',location:'C.12.1',purposes:'Rain day',priority:'1',instructions:'<script>bad</script>',prerequisites:'Wait for hauling',source:[{unique_id:'row',itemcode:'I-1',commonname:'Plant',contsize:'#3',lotcode:'27.F1',stock:0,available:null,location_notes:'Keep aisles',flags:'Blue'}],actions:Array.from({length:200},(_,i)=>({id:String(i),scope:'rows',row_ids:['row'],instructions:'Work '+i,crew:'BOB',quantity:'5',stage:'Sheared',marking:'Pink'}))});
 for(const expected of ['table-header-group','counter(page)','counter(pages)','Revision 2','FULL.BLOCK','C.12.1','Stock 0','Available Unknown','Keep aisles','Work 199','BOB','Sheared','Pink'])assert.ok(html.includes(expected),expected);
 assert.ok(html.includes('&lt;script&gt;bad'));assert.ok(!html.includes('<script>bad'));
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
