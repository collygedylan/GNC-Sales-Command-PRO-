import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const row=(id,size='#3')=>({unique_id:id,blockalpha:'E',locationcode:'E.15.000',itemcode:'RED',commonname:'Royal Red',contsize:size,lotcode:id,salesyear:'27',stock:0,available:0});
test('card-safe SQL qualifies action aliases without conflicting local variables',()=>{
 const sql=read('supabase/migrations/20261006111244_bunch_note_card_commands.sql');
 const body=sql.slice(sql.indexOf('create function bunch_note_private.card_safe_job'),sql.indexOf('create function bunch_note_private.guard_card_job_write'));
 const declarations=body.slice(body.indexOf('declare'),body.indexOf('\nbegin'));
 assert.doesNotMatch(declarations,/\ba\s+jsonb\b|\bcurrent_owner\b|\bshared_id\b/);
 assert.equal((body.match(/jsonb_agg\(q\.a order by q\.ord\)/g)||[]).length,2);
 assert.match(body,/q where author or q\.a->>'card_id'/);
 assert.match(body,/q where not coalesce\(\(q\.a->>'worker_added'\)/);
 assert.match(body,/array_agg\(action_items\.value->>'id'\)/);
 assert.match(body,/jsonb_array_elements\(all_actions\) as action_items\(value\)/);
});
test('card cancellation increments the card revision explicitly across its header join',()=>{
 const sql=read('supabase/migrations/20261006111244_bunch_note_card_commands.sql');
 assert.match(sql,/update bunch_note_private\.bunch_note_work_cards wc set status='retired',active=false,revision=wc\.revision\+1,updated_at=now\(\)\s+from bunch_note_private\.bunch_notes n/);
});
function harness(extra={}) {
 const element={classList:{add(){}},innerHTML:'',childNodes:[],setAttribute(){},querySelectorAll:()=>[]};
 const ctx=vm.createContext({console,Date,Map,Set,URL,Blob,Uint8Array,structuredClone,crypto:globalThis.crypto,
  currentUser:'dylan_collyge',nativeAuthSessionActive:true,nativeAuthProfile:{id:'dylan',username:'dylan_collyge',must_change_password:false},
  document:{getElementById:()=>element},getCurrentVisibleViewId:()=> 'bunch-note',showToast(){},
  APP_API_FUNCTION_URL:'https://fixture.invalid',postAppFunctionJson:async()=>({ok:true,data:{jobs:[]}}),...extra});
 vm.runInContext(read('assets/location-code.js'),ctx);vm.runInContext(read('assets/bunch-note.js'),ctx);
 return {b:ctx.BunchNote,ctx,element};
}
test('legacy adaptation preserves actions, defaults and shared work without changing sibling assignments',()=>{
 const {b}=harness(),location={location:'E.15.000',row_ids:['a','b'],source_all:[row('a'),row('a'),row('b','#7')],owner_id:'worker',direction:'West to East',target_houses:'South house',actions:[
  {id:'one',scope:'rows',row_ids:['a']},{id:'cross',scope:'rows',row_ids:['a','b']},{id:'free',scope:'location',row_ids:[],freeform:true}]};
 b.prepareCards(location,true);
 assert.equal(location.cards.length,3);assert.equal(location.cards.filter(c=>c.kind==='inventory').length,2);
 assert.deepEqual(plain(location.cards[0].row_ids),['a']);assert.equal(location.cards[0].owner_id,'worker');
 assert.equal(location.cards[0].house,'South house');assert.equal(location.cards[0].direction,'West to East');
 assert.equal(location.actions[1].card_id,location.actions[2].card_id);
 assert.notEqual(location.actions[0].card_id,location.actions[1].card_id);
 const stable=plain(location);b.prepareCards(location);assert.deepEqual(plain(location),stable);
 location.cards[0].house='North house';location.cards[0].direction='';location.cards[0].owner_id=null;
 b.prepareCards(location);assert.equal(location.cards[1].house,'South house');assert.equal(location.cards[0].direction,'');
});
test('card edits explicitly include only selected inventory and survive failed persistence',async()=>{
 const commands=[];let saved,fail=false;
 const {b,element}=harness({postAppFunctionJson:async(_url,command)=>{
  commands.push(command);const {operation,payload}=command;
  if(operation==='save'){if(fail)return {ok:false,message:'REVISION_CONFLICT'};saved=structuredClone(payload.body);return {ok:true,data:{draft:{id:'batch',revision:2,body:saved}}};}
  return {ok:true,data:operation==='inventory'?{rows:[row('a'),row('b','#7')]}:{blocks:['E'],users:[],drafts:[],options:[],locations:[]}};
 }});
 await b.open();await b.chooseBlock('E');
 b.openLocation('E.15.000');b.wizardField('workType','Inspect');await b.nextItems();b.advancedInventoryPanel('E.15.000',true);
 assert.match(element.innerHTML,/data-bn-cards/);
 const id=crypto.randomUUID();b.changeCard('E.15.000',{id,included:true,...row('a'),row_ids:['a'],owner_id:'worker',house:'North',direction:'W → E'});
 fail=true;
 await b.save();assert.match(element.innerHTML,/edits are still here/);
 fail=false;await b.save();assert.equal(saved.format_version,5);assert.equal(saved.locations[0].cards.length,1);
 assert.equal(saved.locations[0].cards[0].id,id);assert.equal(saved.locations[0].cards[0].house,'North');
 assert.deepEqual(saved.locations[0].row_ids,['a']);assert.equal(saved.locations[0].actions.length,0);
 assert.ok(commands.every(c=>c.action==='bunch_note'));assert.ok(!commands.some(c=>/inventory.*(update|move)/.test(c.operation)));
});
test('explicit source refresh includes newly matching lots without changing card assignments',async()=>{
 const rows=[row('a')];let saved;
 const {b}=harness({postAppFunctionJson:async(_url,{operation,payload})=>({ok:true,data:operation==='inventory'?{rows}:operation==='save'?
  {draft:{id:'batch',revision:1,body:(saved=structuredClone(payload.body))}}:{blocks:['E'],users:[],drafts:[],options:[],locations:[]}})});
 await b.open();await b.chooseBlock('E');
 const id=crypto.randomUUID();b.changeCard('E.15.000',{id,included:true,...row('a'),row_ids:['a'],owner_id:'worker',house:'North',direction:'East to West'});
 rows.push(row('new-lot'));await b.refreshSource();await b.save();
 assert.deepEqual(saved.locations[0].cards[0].row_ids,['a','new-lot']);
 assert.equal(saved.locations[0].cards[0].owner_id,'worker');assert.equal(saved.locations[0].cards[0].house,'North');
 assert.equal(saved.locations[0].cards[0].id,id);
});

test('published secondary assignees can see card routing and act under their own card scope',async()=>{
 const commands=[],card={id:'card-a',kind:'inventory',itemcode:'RED',commonname:'Royal Red',contsize:'#3',row_ids:['a'],owner_id:'primary-worker',owner_ids:['primary-worker','worker'],workflow_action:'bunch',destination_house:'South & Center House',notes:'Keep roots moist',revision:7,status:'open'};
 const job={id:'job',location:'E.15.000',block:'E',note_number:'BN-1',revision:40,instruction_revision:1,status:'open',owner_id:null,cards:[card,{...card,id:'card-b',row_ids:['b'],owner_id:null}],
  body:{purposes:'Shipping',source:[row('a'),row('b','#7')],actions:[{id:'move',kind:'move',scope:'rows',row_ids:['a'],card_id:'card-a',instructions:'Move',quantity:1},{id:'other',card_id:'card-b',scope:'rows',row_ids:['b'],instructions:'Other'}]},progress:{},actuals:[],worker_actions:[]};
 const {b,element}=harness({currentUser:'worker',nativeAuthProfile:{id:'worker',username:'worker',must_change_password:false},getCurrentVisibleViewId:()=> 'bunch-note',postAppFunctionJson:async(_url,c)=>{
  commands.push(c);return {ok:true,data:c.operation==='list'?{jobs:[job]}:c.operation==='catalog'?{options:[],locations:[]}:c.operation==='get'?{job}:{}};
 }});
 await b.refresh();await b.detail('job');assert.match(element.innerHTML,/Action:<\/b> Bunch · South &amp; Center House/);assert.match(element.innerHTML,/Assigned: primary-worker, worker/);assert.match(element.innerHTML,/Card notes:<\/b> Keep roots moist/);b.openWorkCard('card-a');const scoped=b.workJob();assert.deepEqual(plain(scoped.body.source.map(r=>r.unique_id)),['a']);assert.equal(scoped.body.actions.length,1);assert.equal(scoped.owner_id,'worker');assert.deepEqual(plain(scoped.owner_ids),['primary-worker','worker']);
 b.workField('job:move','source_id','a');b.workField('job:move','quantity','1');b.workField('job:move','destination','E.16.000');await b.recordActual('move');
 const actual=commands.find(c=>c.operation==='actual');assert.equal(actual.expectedRevision,7);assert.equal(actual.payload.card_id,'card-a');
 await b.cardCommand('complete_card','card-a');const complete=commands.find(c=>c.operation==='complete_card');assert.equal(complete.expectedRevision,7);assert.equal(complete.payload.card_id,'card-a');
});
test('unassigned open cards retain Claim while unrelated assignments stay hidden',async()=>{
 const cards=[{id:'available',kind:'inventory',itemcode:'AVAILABLE',commonname:'Available card',row_ids:['a'],owner_id:null,owner_ids:[],revision:1,status:'open'},
  {id:'private',kind:'inventory',itemcode:'PRIVATE',row_ids:['b'],owner_id:'other',owner_ids:['other'],revision:1,status:'open'}];
 const job={id:'job',location:'E.15.000',status:'open',cards,body:{purposes:'Inspect',source:[row('a'),row('b')],actions:[]},progress:{},actuals:[],worker_actions:[]};
 const {b,element}=harness({currentUser:'worker',nativeAuthProfile:{id:'worker',username:'worker',must_change_password:false},postAppFunctionJson:async(_url,c)=>({ok:true,data:c.operation==='list'?{jobs:[job]}:c.operation==='get'?{job}:{}})});
 await b.refresh();await b.detail('job');assert.match(element.innerHTML,/Available card/);assert.match(element.innerHTML,/Claim card/);assert.doesNotMatch(element.innerHTML,/PRIVATE/);
});

test('legacy primary ownership remains visible with an empty assignment array',async()=>{
 const card={id:'legacy',kind:'inventory',itemcode:'LEGACY',commonname:'Legacy assigned card',row_ids:['a'],owner_id:'worker',owner_name:'Legacy Worker',owner_ids:[],revision:1,status:'open'};
 const job={id:'job',location:'E.15.000',status:'open',cards:[card],body:{purposes:'Inspect',source:[row('a')],actions:[]},progress:{},actuals:[],worker_actions:[]};
 const {b,element}=harness({currentUser:'worker',nativeAuthProfile:{id:'worker',username:'worker',must_change_password:false},postAppFunctionJson:async(_url,c)=>({ok:true,data:c.operation==='list'?{jobs:[job]}:c.operation==='get'?{job}:{}})});
 await b.refresh();await b.detail('job');assert.match(element.innerHTML,/Legacy assigned card/);assert.match(element.innerHTML,/Assigned: Legacy Worker/);assert.match(element.innerHTML,/Release card/);assert.doesNotMatch(element.innerHTML,/Claim card/);
});

test('legacy editors preserve unchanged multiple owners and synchronize explicit inventory/shared reassignment',async()=>{
 const inventory={id:crypto.randomUUID(),kind:'inventory',location_code:'E.15.000',itemcode:'RED',commonname:'Royal Red',contsize:'#3',row_ids:['a'],owner_id:'first',owner_ids:['first','second'],house:'',direction:''};
 const shared={id:crypto.randomUUID(),kind:'shared',location_code:'E.15.000',row_ids:[],owner_id:'first',owner_ids:['first','second'],house:'',direction:''};
 const draft={id:'batch',block:'E',revision:1,body:{format_version:5,block:'E',recipient_ids:[],locations:[{location:'E.15.000',purposes:'Inspect',row_ids:['a'],cards:[inventory,shared],source:[row('a')],actions:[]}]}};
 let saved;
 const {b}=harness({postAppFunctionJson:async(_url,{operation,payload})=>({ok:true,data:operation==='inventory'?{rows:[row('a')]}:operation==='save'?{draft:{...draft,body:(saved=structuredClone(payload.body))}}:operation==='drafts'?{drafts:[draft]}:{blocks:['E'],users:[],options:[],locations:[]}})});
 await b.open();await b.openDraft('batch');
 b.changeCard('E.15.000',{...inventory,included:true,direction:'North'});await b.save();
 assert.deepEqual(saved.locations[0].cards.find(c=>c.id===inventory.id).owner_ids,['first','second']);
 b.changeCard('E.15.000',{...inventory,included:true,owner_id:'third'});b.sharedOwner(0,'third');await b.save();
 for(const card of saved.locations[0].cards){assert.equal(card.owner_id,'third');assert.deepEqual(card.owner_ids,['third']);}
 b.sharedOwner(0,'');await b.save();const cleared=saved.locations[0].cards.find(c=>c.id===shared.id);assert.equal(cleared.owner_id,null);assert.deepEqual(cleared.owner_ids,[]);
});

test('release acknowledgement refreshes the list without refetching work no longer authorized',async()=>{
 const commands=[],card={id:'card',kind:'inventory',row_ids:['a'],owner_id:'other',owner_ids:['other','worker'],revision:7,status:'open'};
 const job={id:'job',location:'E.15.000',status:'open',cards:[card],body:{purposes:'Inspect',source:[row('a')],actions:[]},progress:{},actuals:[],worker_actions:[]};
 let released=false;
 const {b,element}=harness({currentUser:'worker',nativeAuthProfile:{id:'worker',username:'worker',must_change_password:false},postAppFunctionJson:async(_url,c)=>{
  commands.push(c);if(c.operation==='release_card'){released=true;return {ok:true,data:{released:true,job_id:'job',card_id:'card'}};}
  if(c.operation==='get'&&released)throw new Error('Must not fetch unauthorized work');
  return {ok:true,data:c.operation==='list'?{jobs:released?[]:[job]}:c.operation==='get'?{job}:{}};
 }});
 await b.refresh();await b.detail('job');await b.cardCommand('release_card','card');
 assert.equal(commands.filter(c=>c.operation==='get').length,1);assert.equal(commands.at(-1).operation,'list');assert.doesNotMatch(element.innerHTML,/Must not fetch unauthorized/);
});

test('location PDF orders assignments and shared work before saved inventory and escapes card text',()=>{
 const gas=read('Code.gs'),ctx=vm.createContext({escapeEmailHtml_:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')});
 vm.runInContext(gas.slice(gas.indexOf('function buildBunchNotePdfHtml_'),gas.indexOf('function handleBunchNotePreview_')),ctx);
 const html=ctx.buildBunchNotePdfHtml_({location:'E.15.000',purposes:'Shipping',cards:[{id:'a',kind:'inventory',itemcode:'RED',commonname:'Royal Red',contsize:'#3',row_ids:['a','a'],owner_name:'Worker <A>',owner_names:['Worker <A>','Second Worker'],workflow_action:'bunch',destination_house:'North & Center House',notes:'Keep grouped',house:'North',direction:'W → E'},{id:'shared',kind:'shared',row_ids:[],owner_name:'Dylan'}],source:[row('a'),row('a')],actions:[{id:'move',card_id:'a',scope:'rows',row_ids:['a'],instructions:'Move to D15. Blue flags',destination:'D.15.000',quantity:0},{id:'general',card_id:'shared',scope:'location',instructions:'Remove drape. Pink Ribbon'}]});
 for(const text of ['Worker &lt;A&gt;','Second Worker','Plan: Bunch to North &amp; Center House','Notes: Keep grouped','House: North','Direction: W → E','Location Total (On Hand): 0','Available: 0','General / Shared Work','Blue flags','Pink Ribbon'])assert.ok(html.includes(text),text);
 assert.ok(html.indexOf('General instructions')<html.indexOf('House: North'));
 assert.ok(html.indexOf('House: North')<html.indexOf('General / Shared Work'));
 assert.ok(html.indexOf('General / Shared Work')<html.indexOf('Plant details'));
 assert.ok(!html.includes('Worker <A>'));
});
