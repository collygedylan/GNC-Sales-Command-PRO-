import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { readComposedAppSource } from '../../scripts/composed-app-source.mjs';

const reclassTransport = readFileSync(new URL('../../supabase/functions/app-api/reclass-inquiry-transport.ts', import.meta.url), 'utf8');
const reclassHandler = readFileSync(new URL('../../supabase/functions/app-api/reclass-inquiry-handler.ts', import.meta.url), 'utf8');

export async function assertReclassReceiptRecovery() {
  const html=readComposedAppSource();
  assert.match(html,/const receipt = await driveReclassApi\('status'/);
  const reopen=html.match(/        async function reopenReclassDeliveryJob\([^]*?^        }/m)[0];
  assert.match(reopen,/requestInventoryRead\('master_page'/);
  assert.doesNotMatch(reopen,/The source row is not loaded/);
  assert.match(html,/Dismiss inquiry notification/);
  assert.match(reclassHandler,/await recoverReclassInquiryReceipt\(d\.db, result, actorUsername/);
  const source = reclassTransport.slice(reclassTransport.indexOf('export async function recoverReclassInquiryReceipt')).replace(/^export /,'');
  const executable = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const ctx = vm.createContext({jsonObject:value=>value && typeof value==='object' ? value : {}});
  vm.runInContext(executable,ctx);
  const edit = {unique_id:'exact-source',priority:'1'};
  const data = {payload:{reclassPayload:{actor:{username:'actor'},protectedDelivery:{liveEdits:[edit],inventoryRevision:'42'}}}};
  const reads = [];
  const chain = {select(){return this;},eq(...args){reads.push(args);return this;},async maybeSingle(){return {data,error:null};}};
  const db = {from(table){assert.equal(table,'ph_request_delivery_outbox');return chain;}};
  const own = await ctx.recoverReclassInquiryReceipt(db,{job_id:'exact-job',status:'failed'},'actor',String);
  assert.deepEqual(reads,[['event_id','exact-job'],['event_type','reclass_inquiry']]);
  assert.deepEqual(own.liveEdits,[edit]);
  assert.equal(own.inventoryRevision,'42');
  assert.equal(own.status,'failed');
  const foreign = await ctx.recoverReclassInquiryReceipt(db,{jobId:'exact-job'},'other-actor',String);
  assert.equal(foreign.liveEdits,undefined);
}

export async function assertPriorityReceiptSurvivesDeliveryFailure() {
  const html=readComposedAppSource();let rollback=0,applied=0;
  const receipt={ok:false,status:'conflict',liveEdits:[{unique_id:'006489.021.1/G.24.000/27.F1',priority:'1'}]};
  const ctx=vm.createContext({getInventoryStatusSync:()=>({begin:()=> 'pending',confirm:async()=>{},rollback:async()=>{rollback++;},revalidate:()=>{}}),
    buildInventoryStatusPatches:()=>[{unique_id:'row',priority:'1'}],getArgosReclassLiveEditIdentityKey:()=> 'actor',getSupabaseReadIdentityScope:()=> 'actor',
    inventoryStatusPendingSaves:new Map(),clearTimeout,document:{getElementById:()=>null},applyConfirmedArgosReclassLiveEdits:()=>{applied++;},
    window:{GncDatabase:{confirmedReclassLiveEditsFromResult:()=>({liveEdits:[]})}}});
  vm.runInContext(html.match(/        async function runInventoryStatusMutation\([^]*?^        }/m)[0],ctx);
  const result=await ctx.runInventoryStatusMutation({idempotencyToken:'same-command'},async()=>receipt);
  assert.equal(result,receipt);assert.equal(applied,1);assert.equal(rollback,0);assert.equal(ctx.inventoryStatusPendingSaves.size,0);
}
