import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { core, parseRows, parseReportTime, summarizeFiles } from '../scripts/soc-order-history.mjs';
import { parseSocHistoryReportTime as parseCloudHistoryTime, parseSocHistoryWorkbook } from '../supabase/functions/_shared/soc-order-history.mjs';

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

test('cloud history parser preserves the canonical SOC source row contract', () => {
  const source = [headers, row(12,'34','001611.031.1'), row(0,'34','001611.031.1')];
  const parsed = parseSocHistoryWorkbook([{name:'Orders',rows:source}], 'SOC 2026-09-25.xlsx');
  const legacy = parseRows(source,'SOC 2026-09-25.xlsx','Orders');
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), JSON.parse(JSON.stringify(legacy)));
  assert.deepEqual(JSON.parse(JSON.stringify(parseCloudHistoryTime({name:'SOC-14301220260925140000.xlsx',createdTime:'2026-09-25T19:00:00Z'}))),
    JSON.parse(JSON.stringify(parseReportTime({title:'SOC-14301220260925140000.xlsx',created_at:'2026-09-25T19:00:00Z'}))));
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

test('Apps Script history worker is retired and removes any stale trigger without file or SQL access', () => {
  const source = fs.readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
  const schedule = source.match(/function scheduleSocOrderHistoryTrigger_\([^]*?^}/m)?.[0];
  const worker = source.match(/function runSocOrderHistoryBackfillChunk_\(\) \{[^]*?^}/m)?.[0];
  assert.ok(schedule && worker);
  let triggers = [{ getHandlerFunction: () => 'runSocOrderHistoryBackfillChunk_' }];
  let reads = 0;
  const context = vm.createContext({
    SOC_ORDER_HISTORY_TRIGGER: 'runSocOrderHistoryBackfillChunk_',
    ScriptApp: {
      getProjectTriggers: () => triggers,
      deleteTrigger: trigger => { triggers = triggers.filter(value => value !== trigger); },
      newTrigger: () => { throw new Error('history importer must not schedule'); },
    },
  });
  vm.runInContext(`${schedule}\n${worker}\nthis.result = runSocOrderHistoryBackfillChunk_();`, context);
  assert.equal(context.result.status, 'cloud_owned');
  assert.equal(context.result.files_processed, 0);
  assert.equal(triggers.length, 0);
  assert.equal(reads, 0);
  assert.doesNotMatch(worker, /DriveApp|callSupabaseRpc_|scheduleSocOrderHistoryTrigger_\(/);
});
