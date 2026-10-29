import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {SECONDARY_ERP_STAGES,TRANSACTION_COLUMNS,readSecondarySheet,buildSecondaryRows,runSecondaryErpSyncStep} from '../supabase/functions/_shared/erp-secondary-sync.mjs';

test('secondary folders match canonical Apps Script source and processed identities',()=>{
  const code=fs.readFileSync(new URL('../Code.gs',import.meta.url),'utf8');
  assert.equal(SECONDARY_ERP_STAGES.length,4);
  for(const stage of SECONDARY_ERP_STAGES){assert.ok(code.includes(stage.folder));assert.ok(code.includes(stage.processed));}
  assert.equal(SECONDARY_ERP_STAGES.find(s=>s.key==='pikes').includeParent,true);
  assert.equal(TRANSACTION_COLUMNS.length,40);
});
test('secondary source parsing keeps exact row IDs, stable state hashes, and continuation offsets',async()=>{
  const sheet=readSecondarySheet([{name:'Order',rows:[['Report'],['Item','Order Tot','Pick Notes'],['A','3','North'],['B','4','South']]}],'pikes');
  const stage=SECONDARY_ERP_STAGES.find(s=>s.key==='pikes'),state={batchId:'fixed',nextOffset:2};
  const first=await buildSecondaryRows(sheet,stage,{id:'file'},state,1);
  assert.equal(first.done,false);assert.equal(first.nextOffset,3);assert.equal(first.rows[0].source_row_number,3);
  const retry=await buildSecondaryRows(sheet,stage,{id:'file'},state,1);
  assert.equal(first.rows[0].row_state_hash,retry.rows[0].row_state_hash);
  const rest=await buildSecondaryRows(sheet,stage,{id:'file'},{...state,nextOffset:first.nextOffset},1);
  assert.equal(rest.done,true);assert.equal(rest.rows[0].itemcode,'B');
});
test('empty secondary snapshots finish without download, database import, or Processed access',async()=>{
  const patches=[];
  const folders=Object.fromEntries(SECONDARY_ERP_STAGES.map(s=>[s.key,{files:[],listDurationMs:0}]));
  const result=await runSecondaryErpSyncStep({supabase:{rpc(){throw Error('unexpected import');}},
    fetcher(){throw Error('unexpected Drive call');},accessToken:'test',env:()=>'',status:async p=>patches.push(p),cursor:{secondaryFolders:folders}});
  assert.equal(result.done,true);assert.equal(patches.at(-1).stageResults.length,4);
  assert.ok(patches.at(-1).stageResults.every(r=>r.outcome==='UP_TO_DATE'));
});
test('secondary delta RPC updates only changed hashes and remains service-role-only',()=>{
  const sql=fs.readFileSync(new URL('../supabase/migrations/20261029132500_agdata_v23103_secondary_delta_imports.sql',import.meta.url),'utf8');
  assert.match(sql,/where target\.row_state_hash is distinct from excluded\.row_state_hash/i);
  assert.match(sql,/from public,anon,authenticated/);
  assert.match(sql,/grant execute[^;]+to service_role/);
  assert.match(sql,/po_import_rows\.row_state_hash is distinct from excluded\.row_state_hash/);
});
