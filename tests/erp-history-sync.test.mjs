import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runSocHistorySyncStep} from '../supabase/functions/_shared/erp-history-sync.mjs';

test('history migration reuses the protected stats publication and incremental itemcode cache',()=>{
  const sql=fs.readFileSync(new URL('../supabase/migrations/20261029173000_agdata_v23105_cloud_history_refresh.sql',import.meta.url),'utf8');
  assert.match(sql,/begin;\s*set local lock_timeout='2s';\s*set local statement_timeout='30s';/i);
  assert.match(sql,/create or replace function public\.activate_eval_item_low_stock_import_v1\(p_run_id uuid\)/i);
  assert.match(sql,/changed_files[\s\S]*affected_codes/);
  assert.match(sql,/insert into private\.ph_eval_item_low_stock_target_stats[\s\S]*where run_id=current_state\.active_run_id/);
  assert.match(sql,/execute replace\(compact_definition,compact_gate,''\)/i);
  assert.match(sql,/execute replace\(drive_definition,drive_gate,''\)/i);
  assert.match(sql,/revoke all on function public\.activate_eval_item_low_stock_import_v1\(uuid\) from public,anon,authenticated/i);
  assert.match(sql,/grant execute on function public\.activate_eval_item_low_stock_import_v1\(uuid\) to service_role/i);
});

test('cloud SOC history stage skips unchanged finalized manifest files',async()=>{
  const rpcCalls=[];let driveDownloads=0;
  const fetcher=async url=>{
    if(String(url).includes('/files?'))return {ok:true,json:async()=>({files:[
      {id:'old',name:'SOC 2026-09-25.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',modifiedTime:'2026-09-26T00:00:00Z',createdTime:'2026-09-25T23:00:00Z',size:'123'},
      {id:'temp',name:'TEMP_IMPORT_old.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',modifiedTime:'2026-09-26T00:00:00Z'},
    ]})};
    driveDownloads+=1;throw new Error('unchanged file must not download');
  };
  const supabase={rpc:async(name,args)=>{rpcCalls.push({name,args});return {data:{run_id:'run-1',complete:true,active:true},error:null};}};
  const result=await runSocHistorySyncStep({supabase,fetcher,token:'token'});
  assert.equal(result.done,true);
  assert.equal(result.result.outcome,'UP_TO_DATE');
  assert.deepEqual(rpcCalls.map(call=>call.name),['begin_eval_item_low_stock_import_v1']);
  assert.deepEqual(rpcCalls[0].args.p_manifest,[{drive_file_id:'old',source_revision:'2026-09-26T00:00:00Z|soc-history-v1'}]);
  assert.equal(driveDownloads,0);
});

test('cloud SOC history activates only a fully covered stable Drive manifest',async()=>{
  let lists=0;const rpcCalls=[];
  const fetcher=async url=>({ok:true,json:async()=>{lists+=1;return {files:[
    {id:'file-a',name:'SOC 2026-09-25.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      modifiedTime:'2026-09-26T00:00:00Z',createdTime:'2026-09-25T23:00:00Z',size:'123'},
  ]};}});
  const supabase={rpc:async(name,args)=>{
    rpcCalls.push({name,args});
    if(name==='begin_eval_item_low_stock_import_v1')return {data:{run_id:'run-2',complete:true,active:false,pending_files:[]},error:null};
    if(name==='activate_eval_item_low_stock_import_v1')return {data:{status:'active',run_id:'run-2'},error:null};
    throw new Error(`unexpected RPC ${name}`);
  }};
  const result=await runSocHistorySyncStep({supabase,fetcher,token:'token'});
  assert.equal(result.done,true);
  assert.equal(lists,2,'the source manifest is rechecked before publication');
  assert.deepEqual(rpcCalls.map(call=>call.name),[
    'begin_eval_item_low_stock_import_v1','begin_eval_item_low_stock_import_v1','activate_eval_item_low_stock_import_v1',
  ]);
});
