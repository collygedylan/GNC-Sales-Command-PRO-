import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseExpressionAt} from 'acorn';
import {erpFilenameTimestamp,compareErpFiles} from '../../supabase/functions/_shared/erp-sync.mjs';
const read=p=>fs.readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const extract=(s,n)=>{const at=s.indexOf('function '+n+'(');assert.ok(at>=0,n);const node=parseExpressionAt(s,at,{ecmaVersion:'latest'});return s.slice(node.start,node.end);};
export function assertErpFilenameAndWatchdogContract() {
 const today='DriveAroundMC-10-06383320261105063834.xlsx',yesterday='DriveAroundMC-10-14383320261104143833.xlsx';
  const c={};vm.runInNewContext(extract(read('assets/app-runtime.js'),'dashboardFilenameTimestamp'),c);
  for(const parse of [erpFilenameTimestamp,c.dashboardFilenameTimestamp]) {
   assert.equal(parse(today),'20261105063833');assert.ok(parse(today)>parse(yesterday));
   assert.equal(parse('x-20200020261105202001.xlsx'),'20261105202000');
   assert.equal(parse('unknown.xlsx','2026-11-05T13:04:30.000Z'),'20261105130430');
   assert.equal(parse('unknown.xlsx'),'');
  }
  const reports=[],state={filenameOrderValid:()=>false,recoverFilenameOrder:()=>{state.filenameRecovered=true;},recoverDocks:()=>{state.docksRecovered=true;}};
  const ctx={state,reportHandledRuntimeIssue:(...args)=>reports.push(args)};
  vm.runInNewContext(['erp_filename_date_order_guard','detail_auto_return_on_mark_done_guard','thumbnail_broken_image_auto_heal','docks_no_trip_number_guard'].map(n=>extract(read('assets/runtime-watchdog.js'),n)).join('\n'),ctx);
  ctx.erp_filename_date_order_guard();ctx.erp_filename_date_order_guard();assert.equal(reports.length,1);assert.ok(state.filenameRecovered);
  state.detailReturn=()=>true;ctx.detail_auto_return_on_mark_done_guard();assert.equal(state.detailReturn,null);assert.equal(state.recoveringDetail,false);
  const img={complete:true,naturalWidth:0,dataset:{localPreviewUrl:'blob:local'},src:'remote',getAttribute(){return this.src;}};
  ctx.thumbnail_broken_image_auto_heal({querySelectorAll:()=>[img]});assert.equal(img.src,'blob:local');
  img.naturalWidth=84;img.src='remote';ctx.thumbnail_broken_image_auto_heal({querySelectorAll:()=>[img]});assert.equal(img.src,'remote');
  ctx.docks_no_trip_number_guard({querySelectorAll:()=>[{textContent:'Dock T01027'}]},'docks');assert.ok(state.docksRecovered);
  assert.ok(read('assets/row-workflow-functions.js').includes('data-local-preview-url='));
 assert.equal(fs.existsSync(new URL('../../test/index.html',import.meta.url)),false,'retired app is not restored');
 const files=[{name:today,modifiedTime:'2026-11-05T10:00:00Z'},{name:yesterday,modifiedTime:'2026-11-06T10:00:00Z'}].sort(compareErpFiles);
 assert.equal(files[0].name,today);assert.equal(files[1].name,yesterday);
}
