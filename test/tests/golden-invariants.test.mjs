import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const evidence='G:/My Drive/GNC/AgData/Release Evidence';
const config=JSON.parse(await fs.readFile(path.join(root,'.gnc-local/test-clone-credentials.json'),'utf8'));
if(!config.user.includes('apztnscvagayslumnalr'))throw Error('SANDBOX_REQUIRED');
const db=new pg.Client({...config,statement_timeout:30000});await db.connect();
const results=[];const started=Date.now();
const bootstrap=await fetch('https://apztnscvagayslumnalr.supabase.co/functions/v1/test-session-bootstrap',{method:'POST',headers:{Origin:'https://agmetricapp.com','Content-Type':'application/json'},body:JSON.stringify({environment:'agdata-test',path:'/test/index.html'})});
const nativeSession=await bootstrap.json();if(!nativeSession.session?.access_token)throw Error('TEST_NATIVE_SESSION_REQUIRED');
const nativeClaims=JSON.parse(Buffer.from(nativeSession.session.access_token.split('.')[1],'base64url').toString('utf8'));
const scalar=async(sql,values=[])=>Object.values((await db.query(sql,values)).rows[0])[0];
const call=async(command,id=crypto.randomUUID())=>scalar('SELECT public.test_ops_command($1,$2)',[id,command]);
async function rejects(command,pattern){await db.query('SAVEPOINT expected_rejection');let error;try{await call(command);}catch(e){error=e;}await db.query('ROLLBACK TO SAVEPOINT expected_rejection');assert.ok(error,'Expected command rejection');assert.match(error.message,pattern);}
async function check(name,fn){const at=Date.now();await fn();results.push({name,passed:true,elapsedMs:Date.now()-at});}
try{
 await db.query('BEGIN');
 if(process.argv.includes('--workspace-patch'))for(const name of ['workspace-recovery.sql','workspace-demo.sql'])await db.query((await fs.readFile(path.join(root,'test/database',name),'utf8')).replace(/^BEGIN;/,'').replace(/COMMIT;\s*$/,''));
 await db.query("UPDATE public.test_ph_wingding_units SET max_unit_capacity=600 WHERE wingding_id='200'");
 const actor=(await db.query("SELECT * FROM public.test_profiles WHERE username='dylan_collyge'")).rows[0];
 assert.ok(actor?.id);
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claims',$2,true)",[actor.id,JSON.stringify(nativeClaims)]);
 const original=(await db.query('SELECT * FROM public.test_ph_soc_master ORDER BY unique_id LIMIT 1')).rows[0];
 async function line(patch={}){const id=crypto.randomUUID();return scalar('SELECT to_jsonb(test_private.ops_clone_soc($1::public.test_ph_soc_master,$2))',[await scalar('SELECT t::text FROM public.test_ph_soc_master t WHERE soc_id=$1',[original.soc_id]),{unique_id:'TEST-VALIDATION-'+id,soc_id:id,load_id:'TEST-LOAD-'+id,drop_number:1,itemcode:'TEST-VALIDATION',locationcode:'A.2.001',season:'F1',lotcode:'27.F1',quantityordered:'100',ordered_qty:100,quantityshipped:'0',shipped_qty:0,pulled_qty:0,verified_qty:0,mistake_qty:0,assigned_qty:0,assigned_wingding_id:null,is_pink_tape:false,line_status:'PENDING_PULL',tag_quality:'BLANK',...patch}]);}
 async function master(location,lot='27.F1',qty=1000){
   const original=(await db.query('SELECT to_jsonb(t) value FROM public.test_ph_master_inventory t ORDER BY unique_id LIMIT 1')).rows[0].value;
   const fields=(await db.query("SELECT string_agg(quote_ident(attname),',' ORDER BY attnum) fields FROM pg_attribute WHERE attrelid='public.test_ph_master_inventory'::regclass AND attnum>0 AND NOT attisdropped AND attgenerated=''")).rows[0].fields;
   const fixture={...original,unique_id:'TEST-VALIDATION-'+crypto.randomUUID(),itemcode:'TEST-VALIDATION',locationcode:location,lotcode:lot,season:lot.split('.').at(-1),ptravailable:String(qty),ptronhand:String(qty)};
   return (await db.query(`INSERT INTO public.test_ph_master_inventory(${fields}) SELECT ${fields} FROM jsonb_populate_record(NULL::public.test_ph_master_inventory,$1) RETURNING *`,[fixture])).rows[0];
 }
 let team,l1,l2;
 await check('Invariant 1 — quality matching, distinct check-in and idempotent receipts',async()=>{
   await call({action:'puller_update',puller_id:'001',quality:'ESP',name:'Validation ESP'});
   const id=crypto.randomUUID(),command={action:'team_checkin',driver:'001',helper:'002',unit:'200'};
   const receipt=await call(command,id);assert.deepEqual(await call(command,id),receipt);team=receipt.result;assert.equal(team.team_quality,'ESP');
   await rejects({action:'team_checkin',driver:'001',helper:'003',unit:'201'},/ALREADY_ASSIGNED/);
   await rejects({action:'team_checkin',driver:'003',helper:'003',unit:'201'},/DISTINCT_ACTIVE/);
 });
 await check('Invariant 2 — capacity clamps at 600 and authorized breakdown preserves the crew',async()=>{
   l1=await line({ordered_qty:400,quantityordered:'400',tag_quality:'ESP'});l2=await line({ordered_qty:400,quantityordered:'400',locationcode:'A.11.001'});
   await call({action:'assign_pull',team_id:team.team_id,soc_ids:[l2.soc_id,l1.soc_id]});
   assert.equal(Number(await scalar("SELECT sum(assigned_qty) FROM public.test_ph_soc_master WHERE assigned_wingding_id='200'")),600);
   await call({action:'breakdown_swap',team_id:team.team_id,replacement:'238'});
   assert.equal(await scalar('SELECT wingding_id FROM public.test_ph_order_pulling_teams WHERE team_id=$1',[team.team_id]),'238');
   assert.equal(await scalar("SELECT status FROM public.test_ph_wingding_units WHERE wingding_id='200'"),'MAINTENANCE');
   const other=(await db.query("SELECT id FROM public.test_profiles WHERE lower(role)='admin' AND username NOT IN ('dylan_collyge','tanner','jack','tyler') AND disabled_at IS NULL LIMIT 1")).rows[0];assert.ok(other);
   await db.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[other.id,JSON.stringify({sub:other.id,role:'authenticated'})]);
   await rejects({action:'breakdown_swap',team_id:team.team_id,replacement:'239'},/BREAKDOWN_OVERRIDE_DENIED/);
   await db.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[actor.id,JSON.stringify(nativeClaims)]);
   await call({action:'arrive_at_dock',team_id:team.team_id});
   assert.equal(await scalar('SELECT line_status FROM public.test_ph_soc_master WHERE soc_id=$1',[l1.soc_id]),'STAGED_AT_DOCK');
 });
 await check('Invariant 3 — live drivers elevate existing and newly inserted load lines',async()=>{
   await db.query('INSERT INTO public.test_ph_dock_drop_status(load_id,drop_number,total_items) VALUES($1,1,400) ON CONFLICT(load_id,drop_number) DO NOTHING',[l1.load_id]);
   await call({action:'traffic_checkin',load_id:l1.load_id,driver_name:'Validation Driver',is_live_driver:true,dock:'38',seal:'TEST-SEAL'});
   assert.equal(await scalar('SELECT is_rush_priority FROM public.test_ph_soc_master WHERE soc_id=$1',[l1.soc_id]),true);
   const next=await line({load_id:l1.load_id});assert.equal(next.is_rush_priority,true);
 });
 await check('Invariant 4 — rejection evidence, pink tape, 10% handoff, 95% loading and signed dispatch',async()=>{
   const item=await line({pulled_qty:100,line_status:'STAGED_AT_DOCK'});
   await db.query('INSERT INTO public.test_ph_dock_drop_status(load_id,drop_number,total_items) VALUES($1,1,100) ON CONFLICT(load_id,drop_number) DO NOTHING',[item.load_id]);
   const drop=await scalar('SELECT drop_id FROM public.test_ph_dock_drop_status WHERE load_id=$1',[item.load_id]);
   const photo='https://apztnscvagayslumnalr.supabase.co/storage/v1/object/public/farm-operations-staging/'+actor.id+'/validation/';
   await rejects({action:'flag_mistake',soc_id:item.soc_id,type:'R-[N]',quantity:5,bad_photo:photo+'bad.jpg'},/TWO_PHOTOS/);
   await rejects({action:'flag_mistake',soc_id:item.soc_id,type:'R-[N]',quantity:5,bad_photo:photo+'bad.jpg',good_photo:photo+'bad.jpg'},/TWO_PHOTOS/);
   const rejected=await call({action:'flag_mistake',soc_id:item.soc_id,type:'R-[N]',quantity:5,bad_photo:photo+'bad.jpg',good_photo:photo+'good.jpg'});
   assert.equal(await scalar('SELECT ordered_qty FROM public.test_ph_soc_master WHERE soc_id=$1',[item.soc_id]),95);
   await call({action:'dock_stage',drop_id:drop,stage:'DOCK_STAGING'});await call({action:'dock_stage',drop_id:drop,stage:'TAGGING'});await call({action:'tagging_complete',drop_id:drop});
   await call({action:'verify_line',drop_id:drop,soc_id:item.soc_id,quantity:10});assert.equal(await scalar('SELECT inspection_ready FROM public.test_ph_dock_drop_status WHERE drop_id=$1',[drop]),true);
   await rejects({action:'verify_line',drop_id:drop,soc_id:rejected.result.soc_id,quantity:1},/PINK_TAPE/);
   await rejects({action:'load_drop',drop_id:drop},/PALLETIZATION_NOT_READY/);
   await call({action:'verify_line',drop_id:drop,soc_id:item.soc_id,quantity:95});assert.equal(await scalar('SELECT palletization_alert_sent FROM public.test_ph_dock_drop_status WHERE drop_id=$1',[drop]),true);
   await call({action:'load_drop',drop_id:drop});assert.equal(await scalar('SELECT shipped_qty FROM public.test_ph_soc_master WHERE soc_id=$1',[rejected.result.soc_id]),0);
   await call({action:'inspector_signoff',drop_id:drop,signature:'Validation Inspector'});await rejects({action:'dispatch',drop_id:drop,seal:'TEST'},/DRIVER/);
   await call({action:'dispatch',drop_id:drop,seal:'TEST',driver_signature:'Validation Driver'});
   assert.equal(await scalar('SELECT loading_status FROM public.test_ph_dock_drop_status WHERE drop_id=$1',[drop]),'DISPATCHED');
 });
 await check('Invariant 5 — multi-bay replacement is atomic, season-limited and never overdrafts',async()=>{
   const a=await master('D.20.000','27.F1',60),b=await master('D.21.000','27.S1',60),bad=await master('D.22.000','27.Y',200),item=await line();
   await rejects({action:'replace_location',soc_id:item.soc_id,allocations:[{row_uid:bad.unique_id,qty:100}]},/SEASON_CODE_INELIGIBLE/);
   await rejects({action:'replace_location',soc_id:item.soc_id,allocations:[{row_uid:a.unique_id,qty:100}]},/INSUFFICIENT_LOCATION_BALANCE/);
   assert.equal(await scalar('SELECT line_status FROM public.test_ph_soc_master WHERE soc_id=$1',[item.soc_id]),'PENDING_PULL');
   const receipt=await call({action:'replace_location',soc_id:item.soc_id,allocations:[{row_uid:a.unique_id,qty:60},{row_uid:b.unique_id,qty:40}]});assert.equal(receipt.result.length,2);
   assert.equal(await scalar('SELECT ptravailable FROM public.test_ph_master_inventory WHERE unique_id=$1',[a.unique_id]),'0');
   assert.equal(await scalar('SELECT ptravailable FROM public.test_ph_master_inventory WHERE unique_id=$1',[b.unique_id]),'20');
   assert.equal(Number(await scalar('SELECT count(*) FROM public.test_ph_docks WHERE soc_id=ANY($1::uuid[])',[receipt.result.map(r=>r.soc_id)])),2);
 });
 await check('Invariant 6 — C.12.000 accepts 11 bays and rejects a twelfth without stock loss',async()=>{
   const row=await master('F.23.000','27.F1',500);let first;
   for(let bay=1;bay<=11;bay++){const receipt=await call({action:'hl_stage',row_uid:row.unique_id,quantity:1,bay,deviation:bay===1,notes:'Validation deviation'});first??=receipt.result;}
   assert.equal(await scalar('SELECT ptravailable FROM public.test_ph_master_inventory WHERE unique_id=$1',[row.unique_id]),'489');
   await rejects({action:'hl_stage',row_uid:row.unique_id,quantity:1,bay:12},/HL_STAGING_BAY_EXHAUSTION/);
   assert.equal(await scalar('SELECT ptravailable FROM public.test_ph_master_inventory WHERE unique_id=$1',[row.unique_id]),'489');
   await call({action:'hl_release',staging_id:first.staging_id});await call({action:'hl_stage',row_uid:row.unique_id,quantity:1,bay:12});
 });
 await check('Invariant 7 — signed legacy stock remains readable while mutation quantities stay strict',async()=>{assert.equal(await scalar("SELECT test_private.ops_read_qty('-6')::text"),'-6');await db.query('SAVEPOINT quantity_check');await assert.rejects(db.query("SELECT test_private.ops_qty('-6')"),/INVALID_QUANTITY/);await db.query('ROLLBACK TO SAVEPOINT quantity_check');});
 await check('Invariant 8 — email trap rewrites nested To, CC and BCC and copied events stay inert',async()=>{
   const trapped=await scalar("SELECT test_private.trap_email_json($1)",[{to:['someone@example.com'],nested:{cc:'other@example.com',bcc:['third@example.com']}}]);
   assert.deepEqual(trapped,{to:['dylan_collyge@greenleafnursery.com'],nested:{cc:'dylan_collyge@greenleafnursery.com',bcc:['dylan_collyge@greenleafnursery.com']}});
   assert.equal(Number(await scalar('SELECT count(*) FROM public.test_ph_request_delivery_outbox WHERE test_mail_eligible')),0);
 });
 await check('Invariant 9 — canonical exact-row save preserves full notes, sibling rows and replay receipts',async()=>{
   const row=(await db.query('SELECT * FROM public.test_ph_master_inventory WHERE date_completed IS NULL AND itemcode IS NOT NULL AND locationcode IS NOT NULL ORDER BY unique_id LIMIT 1')).rows[0];assert.ok(row);
   const siblings=await scalar("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY unique_id),'[]'::jsonb) FROM public.test_ph_master_inventory t WHERE itemcode=$1 AND locationcode=$2 AND unique_id<>$3",[row.itemcode,row.locationcode,row.unique_id]);
   const key=crypto.randomUUID(),note='Retain this entire manually entered test note, including its second sentence.';
   const args=[row.unique_id,row.itemcode,row.locationcode,row.lotcode||'','',{}, {av_note:note,spec:'Test spec',caliper:'2',pick_note:'Test pick',comments:'Test comment'},false,'notes',key];
   const result=await scalar('SELECT public.test_save_drive_evidence_v3($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',args);assert.equal(result.ok,true);assert.equal(await scalar('SELECT av_note FROM public.test_ph_master_inventory WHERE unique_id=$1',[row.unique_id]),note);
   const again=await scalar('SELECT public.test_save_drive_evidence_v3($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',args);assert.equal(again.recovered,true);
   const after=await scalar("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY unique_id),'[]'::jsonb) FROM public.test_ph_master_inventory t WHERE itemcode=$1 AND locationcode=$2 AND unique_id<>$3",[row.itemcode,row.locationcode,row.unique_id]);assert.deepEqual(after,siblings);
 });
 await check('Invariant 10 — blank, trailer and live driver states propagate to every line with real dock numbers',async()=>{
  const a=await line({dock:'34'});await line({load_id:a.load_id,dock:'34'});
  for(const status of ['Live Driver','Trailer','']){await call({action:'traffic_checkin',load_id:a.load_id,check_in_status:status,dock:'Dock 34'});const rows=(await db.query('SELECT is_live_driver,is_rush_priority,dock FROM public.test_ph_soc_master WHERE load_id=$1',[a.load_id])).rows;assert.equal(rows.length,2);for(const row of rows){assert.equal(row.is_live_driver,status==='Live Driver');assert.equal(row.is_rush_priority,status==='Live Driver');assert.equal(row.dock,'34');}}
  await rejects({action:'traffic_checkin',load_id:a.load_id,check_in_status:'Other',dock:'34'},/INVALID_CHECK_IN_STATUS/);await rejects({action:'traffic_checkin',load_id:a.load_id,check_in_status:'Trailer',dock:'T12832'},/INVALID_DOCK_NUMBER/);
 });
 await check('Invariant 11 — Mark Done retains the tag after canonical evidence and Complete Tag alone clears it',async()=>{
  const row=await master('F.23.000'),tag=await line({locationcode:row.locationcode,itemcode:row.itemcode,lotcode:row.lotcode,dock:'38'}),key=crypto.randomUUID();
  const payload={action:'mark_done',soc_id:tag.soc_id,master_uid:row.unique_id,evidence:{spec:'24 inches',caliper:'2',match:'75',loc_match_qty:'750',av_note:'Full entered AV Note, retained exactly.',pick_note:'Pick this row',comments:'Exact test tag'}};
  const receipt=await call(payload,key);assert.equal(receipt.result.row.unique_id,row.unique_id);assert.equal(await scalar('SELECT line_status FROM public.test_ph_soc_master WHERE soc_id=$1',[tag.soc_id]),'PENDING_SUPERVISOR_CLEAR');assert.equal((await call(payload,key)).command_id,key);
  await call({action:'complete_tag',soc_id:tag.soc_id});assert.equal(await scalar('SELECT line_status FROM public.test_ph_docks WHERE soc_id=$1',[tag.soc_id]),'COMPLETE_TAG');
 });
 await check('Invariant 12 — demo hydration is idempotent and completed samples have signed shipment receipts',async()=>{
  assert.equal((await scalar('SELECT public.test_ops_seed_demos()')).ok,true);assert.equal((await scalar('SELECT public.test_ops_seed_demos()')).seeded,false);
  assert.equal(Number(await scalar('SELECT count(*) FROM public.test_ph_pullers')),80);assert.equal(Number(await scalar('SELECT count(*) FROM public.test_ph_wingding_units')),41);
  const sample=await scalar("SELECT to_jsonb(t) FROM public.test_ph_soc_master t WHERE unique_id='TEST-DEMO-SOC-7'");assert.equal(sample.shipped_qty,8);assert.equal(sample.ordered_qty,10);assert.equal(sample.line_status,'SHIPPED');assert.equal(await scalar("SELECT public.test_ops_dock_number('Dock 34')"),'34');assert.equal(await scalar("SELECT public.test_ops_dock_number('T12832')"),'');
 });
 await check('Invariant 13 — trailing-dot HL POs use the unambiguous physical inventory family',async()=>{const overview=await scalar("SELECT public.test_ops_hl_overview('003085')");const rows=overview.orders.filter(r=>r.commonname==='Demo · Autumn Fern');assert.equal(rows.length,2);assert.equal(rows[0].canonical_code,'003085.030.1');assert.equal(rows[0].inventory_available,rows[1].inventory_available);assert.ok(rows[0].inventory_available>0);assert.equal(rows[0].customer_reserved,rows[1].customer_reserved);});
 await check('Invariant 14 — ambiguous inventory matches cannot silently select a write target',async()=>{const a=await master('Z.1.001'),b=await master('Z.1.001'),tag=await line({locationcode:'Z.1.001',itemcode:a.itemcode,lotcode:a.lotcode});const before=await scalar('SELECT public.test_ops_snapshot()');assert.equal(before.lines.find(r=>r.soc_id===tag.soc_id).master_uid,undefined);await db.query('UPDATE public.test_ph_soc_master SET inventory_master_uid=$1 WHERE soc_id=$2',[b.unique_id,tag.soc_id]);const after=await scalar('SELECT public.test_ops_snapshot()');assert.equal(after.lines.find(r=>r.soc_id===tag.soc_id).master_uid,b.unique_id);});
 await check('Invariant 15 — operational refresh retains live navigation nodes and horizontal scroll',async()=>{const {execFile}=await import('node:child_process');await new Promise((resolve,reject)=>execFile('node',['--experimental-vm-modules','--test','test/tests/console-dom.test.mjs'],{cwd:root,windowsHide:true},(error)=>error?reject(error):resolve()));});
 await db.query('ROLLBACK');
 await fs.writeFile(path.join(evidence,'agdata-test-database-tests.json'),JSON.stringify({passed:true,rolledBack:true,elapsedMs:Date.now()-started,results},null,2));
 console.log(JSON.stringify({passed:results.length,failed:0,rolledBack:true,elapsedMs:Date.now()-started}));
}catch(error){await db.query('ROLLBACK').catch(()=>{});await fs.writeFile(path.join(evidence,'agdata-test-database-tests.json'),JSON.stringify({passed:false,results,error:{message:error.message,code:error.code,where:error.where}},null,2));console.error(error);process.exitCode=1;}finally{await db.end();}
