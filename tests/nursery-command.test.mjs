import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {deflateRawSync} from 'node:zlib';
import {readFileSync} from 'node:fs';
import {mapProductionScheduleRecords,runProductionScheduleSyncStep,isOperationalErpSyncComplete} from '../supabase/functions/_shared/erp-sync.mjs';
const context=vm.createContext({});vm.runInContext(readFileSync(new URL('../assets/nursery-command-model.js',import.meta.url),'utf8'),context);
const model=context.GncNurseryModel;
const location=(code,beds=10)=>({location_code:code,total_beds:beds,permanent_shade:'N',house_orientation:'East-West'});
const references={ph_nursery_locations:[location('G.10.000'),location('G.11.000')],ph_nursery_items_cpb:[{itemcode:'001000.030.1',cpb:100}],ph_nursery_water_rating:[{common_name:'Plant',hydro_zone:'Zone 2'}]};
const stock=(locationcode,ptronhand,changes={})=>({warehousei:'10',itemcode:'001000.030.1',locationcode,ptronhand,commonname:'Plant',source:'LD',saleyear:'2027',season:'F1',lotcode:'27.F1',...changes});
test('nursery uses native inventory aliases and reserves planting capacity before moving whole groups',()=>{
 const rows=[stock('G.10.020',100),stock('G.11.030',900)];
 let compiled=model.compile(rows,references,{location:'ALL_LOCATIONS'});
 assert.equal(compiled.groups.length,2);assert.equal(compiled.kpis['Occupied Beds'],10);
 assert.equal(compiled.visible.filter(p=>p.score===100).length,1);assert.equal(compiled.execution.length,1);
 compiled=model.compile(rows,{...references,ph_prod_schedule_active:[{id:1,line_id:'.27.1',itemcode:'001000.030.1',commonname:'Plant',source:'LD',planned_qty:100,cutoff_qty:100,target_loc:'G.11.000',plant_date:'11/15/2026',tier_label:'Tier 2'}]},{location:'ALL_LOCATIONS'});
 assert.equal(compiled.plans.filter(p=>p.workflow.includes('PLANTING')).length,1);
 assert.equal(compiled.plans.find(p=>p.from==='G.10.000').score<100,true);
 assert.equal(model.year('4/25/2027'),2027);
});
test('warehouse exclusion, Y stock and unknown hydro profiles cannot create automatic move approvals',()=>{
 const rows=[stock('G.10.020',100,{season:'Y'}),stock('G.11.030',200),stock('G.10.050',500,{warehousei:'20'})];
 const result=model.compile(rows,references,{location:'ALL_LOCATIONS'});
 assert.equal(result.groups.length,2);assert.equal(result.execution.length,0);
 assert.equal(model.compile([stock('G.10.020',100),stock('G.11.030',200)],{...references,ph_nursery_water_rating:[]},{location:'ALL_LOCATIONS'}).execution.length,0);
});
test('physical AX is authoritative across a twelve-row header band',()=>{
 const rows=Array.from({length:12},()=>Array(250).fill(''));rows[3][49]='WH';rows[3][62]='ITEM NO.';
 for(const wh of ['10','WH 10','20']){const row=Array(250).fill('');Object.assign(row,{49:wh,50:'.27.1',59:'#3',61:'LD',62:'001000.030.1',68:'Plant',76:'100',54:'500',200:'10'});rows.push(row);}
 const result=mapProductionScheduleRecords(rows);assert.equal(result.rows.length,2);assert.equal(result.rows[0].planned_qty,500);assert.equal(result.headers[49].col_letter,'AX');assert.equal(result.headers[49].raw_header_text,'WH');
});
test('empty production folder completes with one Drive list and no import writes',async()=>{
 let fetches=0,writes=0;const patches=[];
 const result=await runProductionScheduleSyncStep({supabase:{rpc(){writes++;throw Error('Unexpected write');}},env:()=>'',accessToken:'test-token',cursor:{coreComplete:true},status:async patch=>patches.push(patch),fetcher:async()=>{fetches++;return new Response(JSON.stringify({files:[]}),{status:200,headers:{'Content-Type':'application/json'}});}});
 assert.equal(result.done,true);assert.equal(fetches,1);assert.equal(writes,0);assert.equal(result.cursor.productionScheduleComplete,true);assert.equal(patches.at(-1).sourceProgressDelta.checked,true);
});
test('six-source jobs never complete while Production Schedule is queued; legacy five-source jobs still complete',()=>{
 const sourceProgress=Object.fromEntries(['drive','cav','reserves','soc','hl_po_parsed'].map(key=>[key,{stage:'complete',checked:true,percent:100}]));
 assert.equal(isOperationalErpSyncComplete({sourceProgress}),true);
 sourceProgress.prod_schedule={stage:'queued',checked:false,percent:0};assert.equal(isOperationalErpSyncComplete({sourceProgress}),false);
 sourceProgress.prod_schedule={stage:'complete',checked:true,percent:100};assert.equal(isOperationalErpSyncComplete({sourceProgress}),true);
});
test('nursery permission requires a persisted grant, with explicit denial authoritative',()=>{
 const accessContext=vm.createContext({});vm.runInContext(readFileSync(new URL('../assets/user-access-control.js',import.meta.url),'utf8'),accessContext);
 const access=accessContext.GncUserAccessControl;
 assert.equal(access.resolveUserAccessMatrix('dylan_collyge').view_nursery_command_tables,'N');
 access.setAccessMatrixRows([{username:'dylan_collyge',view_permissions:{view_nursery_command_tables:'Y'}}]);
 assert.equal(access.resolveUserAccessMatrix('dylan_collyge').view_nursery_command_tables,'Y');
 assert.equal(access.resolveUserAccessMatrix('megan_kelly','ADMIN').view_nursery_command_tables,'N');
 access.setAccessMatrixRows([{username:'dylan_collyge',view_permissions:{view_nursery_command_tables:'N'}}]);
 assert.equal(access.resolveUserAccessMatrix('dylan_collyge').view_nursery_command_tables,'N');
 access.setAccessMatrixRows([{username:'other_user',view_permissions:{view_nursery_command_tables:'Y'}}]);
 assert.equal(access.resolveUserAccessMatrix('other_user').view_nursery_command_tables,'Y');
});

test('unresolved plantings never reserve beds in an unnamed block',()=>{
 const data=model.compile([], {...references,ph_prod_schedule_active:[{id:1,line_id:'.27.1',itemcode:'001000.030.1',commonname:'Plant',planned_qty:100,plant_date:'4/25/2027',target_loc:''}]},{location:'ALL_LOCATIONS'});
 assert.equal(data.kpis['Reserved Planting Beds'],0);assert.equal(data.execution.length,0);
});

test('Excel serial planting dates retain their calendar date',()=>{
 const row=Array(250).fill('');row[49]='10';row[62]='001000.030.1';row[47]=String(Date.parse('2027-04-25')/86400000+25569);row[87]='2027-06-10';row[54]='100';
 const result=mapProductionScheduleRecords([row]).rows[0];assert.equal(result.plant_date,'2027-04-25');assert.equal(result.can_fill_date,'2027-06-10');
});

function nurseryZip(entries) {
  const locals=[],central=[];let offset=0;
  for(const [name,content] of Object.entries(entries)){
    const filename=Buffer.from(name),raw=Buffer.from(content),compressed=deflateRawSync(raw);
    const local=Buffer.alloc(30+filename.length);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);
    local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(filename.length,26);filename.copy(local,30);
    locals.push(local,compressed);
    const record=Buffer.alloc(46+filename.length);record.writeUInt32LE(0x02014b50,0);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);
    record.writeUInt16LE(8,10);record.writeUInt32LE(compressed.length,20);record.writeUInt32LE(raw.length,24);
    record.writeUInt16LE(filename.length,28);record.writeUInt32LE(offset,42);filename.copy(record,46);
    central.push(record);offset+=local.length+compressed.length;
  }
  const centralData=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);
  end.writeUInt16LE(Object.keys(entries).length,8);end.writeUInt16LE(Object.keys(entries).length,10);
  end.writeUInt32LE(centralData.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,centralData,end]);
}

test('bounded XLSX pages preserve AX filtering and the original header band',async()=>{
 const {parseProductionSchedulePage}=await import('../supabase/functions/_shared/erp-sync.mjs');
 const letter=i=>{let s='';for(let n=i+1;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
 const header=[];header[49]='WH';header[62]='ITEM NO.';
 const makeRow=wh=>{const r=[];r[49]=wh;r[50]='.27.1';r[62]='001000.030.1';r[76]='100';r[54]='200';r[47]=String(Date.parse('2027-04-25')/86400000+25569);return r;};
 const rows=[header,...Array.from({length:11},()=>[]),makeRow('10'),makeRow('20'),makeRow('10')];
 const xml=rows.map((row,i)=>'<row r="'+(i+1)+'">'+row.map((value,j)=>'<c r="'+letter(j)+(i+1)+'" t="inlineStr"><is><t>'+value+'</t></is></c>').join('')+'</row>').join('');
 const bytes=nurseryZip({'xl/workbook.xml':'<workbook xmlns:r="urn:r"><sheets><sheet name="Production" r:id="rId1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>','xl/worksheets/sheet1.xml':'<worksheet><sheetData>'+xml+'</sheetData></worksheet>'});
 const first=await parseProductionSchedulePage(bytes,0,14),last=await parseProductionSchedulePage(bytes,first.nextOffset,14);
 assert.equal(first.rows.length,1);assert.equal(first.done,false);assert.equal(last.rows.length,1);assert.equal(last.done,true);assert.equal(first.rows[0].plant_date,'2027-04-25');assert.equal(last.headers[49].raw_header_text,'WH');
});
