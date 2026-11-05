import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const script=await fs.readFile(new URL('../assets/test/isolation.js',import.meta.url),'utf8');
function storage(){const values=new Map([['live-login','keep']]);return {get length(){return values.size},key:i=>[...values.keys()][i],getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k),values};}
function fixture(options={}){
  const localStorage=storage(),sessionStorage=storage(),calls=[];
  const window={WebSocket:options.WebSocket,localStorage,sessionStorage,AGDATA_TEST_CONFIG:{project:'apztnscvagayslumnalr',anonKey:'test-anon',names:{ph_master_inventory:'test_ph_master_inventory',save_drive_evidence_v3:'test_save_drive_evidence_v3'}},fetch:async(url,init)=>{calls.push({url:String(url),init});return new Response('{}')},addEventListener(){}};
  const context={window,location:new URL('https://agmetricapp.com/test/index.html'),navigator:{},indexedDB:{open:name=>name,deleteDatabase:name=>name},URL,Request,Response,Headers,MessageEvent,console};
  vm.runInNewContext(script,context);return {window,context,calls,localStorage,sessionStorage};
}
test('all browser REST/RPC and Edge routes resolve into test objects only',async()=>{
  const {window,calls}=fixture();
  await window.fetch('https://apztnscvagayslumnalr.supabase.co/rest/v1/ph_master_inventory?select=unique_id');
  await window.fetch('https://apztnscvagayslumnalr.supabase.co/rest/v1/rpc/save_drive_evidence_v3',{method:'POST',body:'{}'});
  await window.fetch('https://apztnscvagayslumnalr.supabase.co/functions/v1/app-api',{method:'POST',body:'{}'});
  assert.match(calls[0].url,/\/test_ph_master_inventory\?/);assert.match(calls[1].url,/rpc\/test_save_drive_evidence_v3$/);assert.match(calls[2].url,/test-app-api$/);
  await assert.rejects(window.fetch('https://kzrnyjsosryejjejliii.supabase.co/rest/v1/ph_master_inventory'),/PRODUCTION_NETWORK_BLOCKED/);
  await assert.rejects(window.fetch('https://apztnscvagayslumnalr.supabase.co/rest/v1/unmapped_table'),/UNMAPPED/);
  await assert.rejects(window.fetch('https://script.google.com/macros/s/live/exec',{method:'POST'}),/OUTBOUND_MUTATION/);
});
test('clearing test storage cannot erase a live session',()=>{
  const {window,localStorage,context}=fixture();window.localStorage.setItem('login','test');
  assert.equal(localStorage.getItem('agdata-test:login'),'test');assert.equal(window.localStorage.getItem('live-login'),null);
  window.localStorage.clear();assert.equal(localStorage.getItem('live-login'),'keep');
  assert.equal(context.indexedDB.open('inventory'),'agdata-test:inventory');
});
test('native Auth aliases and uploads are restricted to the test destination',async()=>{
  const {window,calls}=fixture();await window.fetch('https://apztnscvagayslumnalr.supabase.co/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email:'dylan_collyge@greenleafnursery.com',password:'fixture'})});
  assert.equal(JSON.parse(calls[0].init.body).email,'dylan_collyge@agdata-test.invalid');
  await window.fetch('https://apztnscvagayslumnalr.supabase.co/storage/v1/object/photos/row.jpg',{method:'POST',body:'fixture'});
  assert.match(calls[1].url,/farm-operations-staging\/photos\/row.jpg$/);
  await assert.rejects(window.fetch('https://apztnscvagayslumnalr.supabase.co/auth/v1/recover',{method:'POST'}),/IDENTITY_DELIVERY_DISABLED/);
});
test('late UMD initialization still scopes Realtime tables and channels',()=>{
  const {window}=fixture();const sdk={};window.supabase=sdk;const seen=[];
  sdk.createClient=()=>({channel(name){seen.push(name);return {on(type,filter){seen.push(filter);return this;}}}});
  window.supabase.createClient().channel('inventory').on('postgres_changes',{schema:'public',table:'ph_master_inventory'},()=>{});
  assert.equal(seen[0],'agdata-test:inventory');assert.equal(seen[1].table,'test_ph_master_inventory');
});

test('nested logical table selectors and revision keys map without changing evidence text',async()=>{
 const {window,calls}=fixture();await window.fetch('https://apztnscvagayslumnalr.supabase.co/rest/v1/rpc/save_drive_evidence_v3',{method:'POST',body:JSON.stringify({p_table:'ph_master_inventory',p_payload:{source_table:'ph_master_inventory',av_note:'ph_master_inventory'}})});
 const payload=JSON.parse(calls[0].init.body);assert.equal(payload.p_table,'test_ph_master_inventory');assert.equal(payload.p_payload.source_table,'test_ph_master_inventory');assert.equal(payload.p_payload.av_note,'ph_master_inventory');
 await window.fetch('https://apztnscvagayslumnalr.supabase.co/rest/v1/ph_master_inventory?key=in.(ph_master_inventory)&select=ph_master_inventory(*)');const url=new URL(calls[1].url);assert.equal(url.searchParams.get('key'),'in.(test_ph_master_inventory)');assert.equal(url.searchParams.get('select'),'ph_master_inventory:test_ph_master_inventory(*)');
});
test('Storage listing, signing, removal and moves keep the original bucket as a test prefix',async()=>{
 const {window,calls}=fixture(),base='https://apztnscvagayslumnalr.supabase.co/storage/v1/object/';
 await window.fetch(base+'list/photos',{method:'POST',body:JSON.stringify({prefix:'drive'})});assert.match(calls[0].url,/object\/list\/farm-operations-staging$/);assert.equal(JSON.parse(calls[0].init.body).prefix,'photos/drive');
 await window.fetch(base+'photos',{method:'DELETE',body:JSON.stringify({prefixes:['row.jpg']})});assert.match(calls[1].url,/object\/farm-operations-staging$/);assert.deepEqual(JSON.parse(calls[1].init.body).prefixes,['photos/row.jpg']);
 await window.fetch(base+'move',{method:'POST',body:JSON.stringify({bucketId:'photos',sourceKey:'a.jpg',destinationKey:'b.jpg'})});assert.equal(JSON.parse(calls[2].init.body).bucketId,'farm-operations-staging');assert.equal(JSON.parse(calls[2].init.body).destinationKey,'photos/b.jpg');
 await window.fetch(base+'sign/photos',{method:'POST',body:JSON.stringify({paths:['a.jpg'],expiresIn:60})});assert.match(calls[3].url,/object\/sign\/farm-operations-staging$/);assert.deepEqual(JSON.parse(calls[3].init.body).paths,['photos/a.jpg']);
});

test('nested bundled clients cannot subscribe to production Realtime tables or broadcasts',()=>{class FakeSocket extends EventTarget{constructor(url){super();this.url=url;}send(data){this.sent=JSON.parse(data);}}const {window}=fixture({WebSocket:FakeSocket});const socket=new window.WebSocket('wss://apztnscvagayslumnalr.supabase.co/realtime/v1/websocket?apikey=donor');socket.send(JSON.stringify({topic:'realtime:inventory',event:'phx_join',payload:{config:{postgres_changes:[{schema:'public',table:'ph_master_inventory'}]}}}));assert.equal(socket.sent.payload.config.postgres_changes[0].table,'test_ph_master_inventory');assert.equal(socket.sent.topic,'realtime:agdata-test:inventory');let received;socket.addEventListener('message',event=>{received=JSON.parse(event.data);});socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({topic:'realtime:agdata-test:inventory',payload:{new:{source_table:'test_ph_master_inventory'}}})}));assert.equal(received.topic,'realtime:inventory');assert.equal(received.payload.new.source_table,'ph_master_inventory');assert.throws(()=>new window.WebSocket('wss://kzrnyjsosryejjejliii.supabase.co/realtime/v1/websocket'),/PRODUCTION_NETWORK_BLOCKED/);});
