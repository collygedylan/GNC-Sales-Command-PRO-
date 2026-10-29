import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import test from 'node:test';
import { parseErpXlsxPage, runErpSyncWorkerStep } from '../supabase/functions/_shared/erp-sync.mjs';

function makeZip(entries) {
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

function inlineRow(number,values){
  return `<row r="${number}">${values.map((value,index)=>`<c r="${String.fromCharCode(65+index)}${number}" t="inlineStr"><is><t>${value}</t></is></c>`).join('')}</row>`;
}

test('SOC fast prefilter retains Suspend rows regardless of Suspend-To while rejecting invalid inactive rows', async()=>{
  const bytes=makeZip({
    'xl/workbook.xml':'<workbook xmlns:r="urn:r"><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':`<worksheet><sheetData>${[
      inlineRow(1,['itemcode','dock','suspend','suspend-to']),
      inlineRow(2,['001','38','','']),
      inlineRow(3,['002','','SUSPEND','']),
      inlineRow(4,['003','','SUSPEND','DC']),
      inlineRow(5,['004','0','','']),
      inlineRow(6,['005','','','DC']),
    ].join('')}</sheetData></worksheet>`,
  });
  const page=await parseErpXlsxPage(bytes,0,20,{dataset:'soc'});
  assert.deepEqual(page.rows.map(row=>row.itemcode),['001','002','003']);
});

test('new XLSX stage downloads and unzips once, appending 5,000-row batches before continuation', async()=>{
  const xmlRows=[inlineRow(1,['itemcode','dock'])];
  for(let index=1;index<=10001;index+=1)xmlRows.push(inlineRow(index+1,[String(index),`D${index}`]));
  const bytes=makeZip({
    'xl/workbook.xml':'<workbook xmlns:r="urn:r"><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':`<worksheet><sheetData>${xmlRows.join('')}</sheetData></worksheet>`,
  });
  const calls=[],status=[];let downloads=0,archived=false;
  const file={id:'soc-xlsx-1',name:'SOC.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    modifiedTime:'2026-10-28T12:00:00Z',parents:['soc-folder']};
  const fetcher=async(input,init={})=>{
    const url=new URL(input);
    if(url.pathname.endsWith('/files/soc-xlsx-1')&&url.searchParams.get('alt')==='media'){downloads+=1;return new Response(bytes);}
    if(url.pathname.endsWith('/files/soc-xlsx-1')&&init.method==='PATCH'){archived=true;return Response.json({id:file.id});}
    throw new Error(`Unexpected Drive request: ${init.method||'GET'} ${url.pathname}`);
  };
  const supabase={rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='check_erp_file_sync_needed_v1')return {data:{skip:false},error:null};
    if(name==='fast_erp_import_columns_v1')return {data:['unique_id','itemcode','dock'],error:null};
    if(name==='fast_begin_erp_stage_v1'){
      assert.equal(args.p_expected_rows,50000);
      assert.equal(args.p_file_meta.expected_rows_pending,true);
      return {data:{stage_id:'stage-1',expected_rows:50000,staged_rows:0},error:null};
    }
    if(name==='fast_append_erp_stage_batch_v1')return {data:{staged_rows:args.p_start_row+args.p_rows.length},error:null};
    if(name==='fast_seal_erp_stage_v1'){assert.equal(args.p_expected_rows,10001);return {data:{ok:true},error:null};}
    if(name==='fast_commit_erp_stage_swap_v1')return {data:{ok:true},error:null};
    throw new Error(`Unexpected RPC ${name}`);
  }};
  const result=await runErpSyncWorkerStep({supabase,fetcher,accessToken:'fixture-token',env:name=>({
    ERP_SYNC_DROP_FOLDERS_JSON:JSON.stringify({drive:'drive-folder',cav:'cav-folder',reserves:'reserves-folder',soc:'soc-folder',hl_po_parsed:'hl-folder',processed:{soc:'processed-folder'}}),
  })[name],status:async update=>status.push(update),cursor:{stageIndex:3,stageResults:[],attemptedByStage:{},folderSnapshot:{
    drive:{files:[]},cav:{files:[]},reserves:{files:[]},soc:{files:[file]},
  }}});
  assert.equal(downloads,1,'the source workbook is downloaded once for the complete new stage');
  assert.equal(archived,true);
  assert.equal(calls.filter(call=>call.name==='fast_append_erp_stage_batch_v1').length,3);
  assert.deepEqual(calls.filter(call=>call.name==='fast_append_erp_stage_batch_v1').map(call=>call.args.p_rows.length),[5000,5000,1]);
  assert.equal(calls.filter(call=>call.name==='fast_seal_erp_stage_v1').length,1);
  assert.equal(calls.filter(call=>call.name==='fast_commit_erp_stage_swap_v1').length,1);
  assert.equal(result.cursor.fileContinuation,undefined,'a completed file needs no browser-driven page continuation');
  assert.ok(status.filter(update=>update.stageResultsDelta?.key==='soc').length>=2,'progress is persisted after every batch');
});
