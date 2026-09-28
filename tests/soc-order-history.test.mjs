import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { core, parseRows, parseReportTime, summarizeFiles } from '../scripts/soc-order-history.mjs';

const headers = ['WAREHOUSEID','TRANSACTIONNUMBER','CONSIGNEEIDENTITYID','ITEMCODE','QUANTITYORDERED','DOCK','INVOICEDATE'];
const row = (qty = 12, dock = '34', item = '001611.031.1') => ['10','order-1','customer-1',item,qty,dock,'2026-09-25'];
const clone = x => JSON.parse(JSON.stringify(x));
const file = (id, day, hour, rows) => ({ id, report_date: day, snapshot_at: `${day}T${hour}:00:00.000Z`, rows });

test('Dock eligibility retains invoiced lines and rejects blank/null/zero/invalid quantities', () => {
  const parsed = parseRows([headers,row(),row(5,''),row(5,'NULL'),row(5,'0'),row(0),row(-4),row('no'),row('1,000'),row(3,'A')], 'SOC.xlsx', 'Sheet1');
  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.rows[0].itemcode, '001611.031.1');
  assert.equal(parsed.rows[1].quantity_ordered,1000);
  assert.deepEqual(clone(parsed.exclusion_counts), {missing_dock:3,invalid_quantity:3});
  assert.deepEqual(clone(parsed.exclusion_ranges), [
    {reason:'missing_dock',from_row:3,through_row:5},
    {reason:'invalid_quantity',from_row:6,through_row:8}
  ]);
  assert.equal(parsed.source_row_count,9);
});
test('daily latest group removes repeated exports while preserving genuine occurrences and later days', () => {
  const first = parseRows([headers,row(8),row(12)],'SOC.xlsx','Sheet1').rows;
  const later = parseRows([headers,row(10),row(20)],'SOC.xlsx','Sheet1').rows;
  const result = summarizeFiles([file('a','2026-09-25','06',first),file('b','2026-09-25','10',first),file('c','2026-09-25','12',later),file('d','2026-09-25','16',later),file('e','2026-09-26','06',later)]);
  assert.equal(result[0].observation_count,4);
  assert.equal(result[0].average_order_qty,15);
  assert.equal(result[0].p75_order_qty,20);
  assert.equal(result[0].suggested_low_stock_qty,35);
  assert.equal(result[0].distinct_days,2);
});
test('groups absent from a later export retain their last qualifying daily appearance', () => {
  const first = parseRows([headers,row(12)],'SOC.xlsx','Sheet1').rows;
  const other = parseRows([headers,row(4,'34','009999.010.1')],'SOC.xlsx','Sheet1').rows;
  assert.equal(summarizeFiles([file('a','2026-09-25','06',first),file('b','2026-09-25','16',other)]).length,2);
});
test('unknown schema fails closed; legacy 81-column adapter validates independent positions', () => {
  assert.throws(()=>parseRows([['ITEMCODE','DOCK'],['x',3]],'SOC.xlsx','Sheet1'),/HEADER_INVALID/);
  const r=Array(81).fill('');
  r[0]=10;r[2]=false;r[7]='customer-1';r[9]='consignee-1';r[18]='order-1';r[31]='001611.031.1';r[37]=12;r[38]=12;r[63]=34;
  const source=[['Field\nWAREHOUSEID\nISRESERVE'],r];
  assert.equal(parseRows(source,'SOC 3-22-2026','Sheet1').schema,'soc_legacy_81_v1');
  assert.equal(parseRows(source,'SOC 3-22-2026','Sheet1').rows.length,1);
  const shifted=r.slice(1);assert.throws(()=>parseRows([source[0],shifted],'SOC 3-22','Sheet1'),/LEGACY_SCHEMA_INVALID/);
  assert.throws(()=>parseRows(source,'Unknown workbook','Sheet1'),/HEADER_MISSING/);
  assert.equal(core.SOC_HISTORY_LEGACY_COLUMNS.length,81);
});
test('filename report day and 24-hour clock beat Drive modification/receipt timestamps', () => {
  const p=parseReportTime({name:'SOC-10 Open Orders-16282820260925042828.xlsx',createdTime:'2026-09-28T00:00:00Z',modifiedTime:'2026-10-01T00:00:00Z'});
  assert.equal(p.report_date,'2026-09-25');assert.equal(p.snapshot_at,'2026-09-25T21:28:28.000Z');
  const seq=parseReportTime({name:'SOC 2026-02-20 2.xlsx',createdTime:'2026-02-22T00:00:00Z'});
  assert.equal(seq.snapshot_at,'2026-02-20T06:00:02.000Z');
  const fallback=parseReportTime({name:'SOC.xlsx',createdTime:'2026-03-09T05:52:00Z'});
  assert.equal(fallback.report_date,'2026-03-09'); // after spring-forward, Chicago is UTC-5
  assert.equal(fallback.source_date_method,'creation_time_fallback');
  assert.throws(()=>parseReportTime({name:'SOC 2026-02-31.xlsx',createdTime:'2026-03-01T00:00:00Z'}),/DATE_INVALID/);
});
test('empty history stays empty and nearest-rank P75 rounds the target up', () => {
  assert.deepEqual(clone(summarizeFiles([])),[]);
  const data=parseRows([headers,row(1),row(2),row(2)],'SOC.xlsx','Sheet1').rows;
  const result=summarizeFiles([file('a','2026-09-25','06',data)])[0];
  assert.equal(result.suggested_low_stock_qty,4);
});

test('bounded worker resumes, reconciles coverage, and activates only a complete manifest', () => {
  const data = Array.from({length:4}, (_,i)=>({id:'source-'+i,title:'SOC 2026-09-25 '+(i+1),values:[headers,row(i+1)]}));
  const properties = new Map(), completed = new Set(), staged = new Map(), events=[];
  let triggers=[], active=false, reads=0;
  const files=data.map(f=>({getId:()=>f.id,getName:()=>f.title,getDateCreated:()=>new Date('2026-09-25T20:00:00Z'),
    getLastUpdated:()=>new Date('2026-09-25T21:00:00Z'),getSize:()=>10,getMimeType:()=> 'application/vnd.google-apps.spreadsheet'}));
  const context=vm.createContext({console:{log(){},warn(){},error(){}},Intl,Date,
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>properties.get(k)||'',setProperty:(k,v)=>properties.set(k,v)})},
    LockService:{getUserLock:()=>({tryLock:()=>true,releaseLock(){}})},
    Utilities:{newBlob:s=>({getBytes:()=>Array.from(Buffer.from(s))}),DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,b)=>Array.from(createHash('sha256').update(Buffer.from(b)).digest())},
    DriveApp:{getFolderById:()=>({getFiles:()=>{let i=0;return {hasNext:()=>i<files.length,next:()=>files[i++]};}})},
    SpreadsheetApp:{openById:id=>{const f=data.find(x=>x.id===id);reads++;return{getSheets:()=>[{getName:()=> 'Orders',getLastRow:()=>f.values.length,getLastColumn:()=>headers.length,
      getRange:(r,c,n,w)=>({getDisplayValues:()=>f.values.slice(r-1,r-1+n).map(row=>row.slice(c-1,c-1+w))})}]};}},
    ScriptApp:{getProjectTriggers:()=>triggers,deleteTrigger:t=>{triggers=triggers.filter(x=>x!==t);},newTrigger:name=>({timeBased(){return this;},after(){return this;},create(){triggers.push({getHandlerFunction:()=>name});}})}
  });
  vm.runInContext(fs.readFileSync(new URL('../Code.gs',import.meta.url),'utf8'),context);
  context.callSupabaseRpc_=(name,p)=>{
    if(name==='begin_eval_item_low_stock_import_v1')return{run_id:'run-1',active,complete:completed.size===files.length,pending_files:p.p_manifest.filter(f=>!completed.has(f.drive_file_id))};
    if(name==='prepare_eval_item_low_stock_file_v1'){assert.equal(p.p_source_sheet_name,'Orders');assert.match(p.p_content_sha256,/^[a-f0-9]{64}$/);return{file_version_id:p.p_drive_file_id,status:'staging',last_staged_row_number:staged.get(p.p_drive_file_id)?.at(-1)?.source_row_number || 0};}
    if(name==='stage_eval_item_low_stock_rows_v1'){staged.set(p.p_file_version_id,[...(staged.get(p.p_file_version_id)||[]),...p.p_rows]);return{};}
    if(name==='finalize_eval_item_low_stock_file_v1'){assert.equal(staged.get(p.p_file_version_id).length,p.p_expected_row_count);completed.add(p.p_file_version_id);return{};}
    if(name==='activate_eval_item_low_stock_import_v1'){assert.equal(completed.size,4);active=true;return{};}
    throw Error('Unexpected RPC '+name);
  };
  context.emitTableSyncLiveEvent_=(name)=>events.push(name);
  const first=vm.runInContext('runSocOrderHistoryBackfillChunk_()',context);
  assert.equal(first.files_processed,3);assert.equal(first.pending,1);assert.equal(active,false);
  const second=vm.runInContext('runSocOrderHistoryBackfillChunk_()',context);
  assert.equal(second.files_processed,1);assert.equal(active,true);assert.equal(reads,4);
  assert.deepEqual(events,['ph_eval_item_low_stock_targets']);
  vm.runInContext('runSocOrderHistoryBackfillChunk_()',context);
  assert.equal(reads,4,'a repeated complete scan does not reread finalized sheets');

  // A single large source also resumes inside its row upload, without
  // duplicating observations or marking a partially staged file complete.
  completed.clear();staged.clear();properties.clear();active=false;
  data[0].values=[headers,...Array.from({length:501},()=>row(3))];
  for (let i=1;i<4;i++) completed.add('source-'+i);
  let clock=0, slowOnce=true;
  context.Date=class extends Date { static now(){return clock;} };
  const rpc=context.callSupabaseRpc_;
  context.callSupabaseRpc_=(name,p)=>{
    const result=rpc(name,p);
    if(name==='stage_eval_item_low_stock_rows_v1' && slowOnce){clock=281000;slowOnce=false;}
    return result;
  };
  const partial=vm.runInContext('runSocOrderHistoryBackfillChunk_()',context);
  assert.equal(partial.pending,1);assert.equal(active,false);
  assert.equal(staged.get('source-0').length,250);
  const resumed=vm.runInContext('runSocOrderHistoryBackfillChunk_()',context);
  assert.equal(resumed.pending,0);assert.equal(active,true);
  assert.equal(staged.get('source-0').length,501);
  assert.equal(new Set(staged.get('source-0').map(r=>r.source_row_number)).size,501);
});
