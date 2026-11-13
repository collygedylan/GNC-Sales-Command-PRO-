import assert from 'node:assert/strict';
import {makeZip} from '../../src/core/golden-soc-xlsx.mjs';
import {runErpSyncWorkerStep} from '../../supabase/functions/_shared/erp-sync.mjs';
import {fixtureErpReceipt, withArchiveProof} from '../../src/core/erp-runtime-fetch-fixtures.mjs';

const fileName = 'DriveAroundMC-10-12000020261105120000.xlsx';

function workbook() {
  return makeZip({
    'xl/workbook.xml':'<workbook xmlns:r="urn:r"><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':'<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>itemcode</t></is></c><c r="B1" t="inlineStr"><is><t>commonname</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>001</t></is></c><c r="B2" t="inlineStr"><is><t>Blue Grass</t></is></c></row></sheetData></worksheet>',
  });
}
function createDriveFixture(state, bytes) {
  return async (input,init={})=>{
    const url=new URL(input);
    if(url.pathname.endsWith('/files')) {
      const isDrive=url.searchParams.get('q')?.includes("'drive-folder'");
      return Response.json({files:isDrive&&!state.moved?[{id:'drive-file-102',name:fileName,
        mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',modifiedTime:'2026-11-05T12:00:00Z',parents:['drive-folder']}]:[]});
    }
    if(url.pathname.endsWith('/files/drive-file-102')&&init.method==='PATCH') {
      assert.equal(url.searchParams.get('addParents'),'drive-processed');
      assert.equal(url.searchParams.get('removeParents'),'drive-folder');
      state.events.push('move');state.moved=true;return Response.json({id:'drive-file-102'});
    }
    if(url.pathname.endsWith('/files/drive-file-102')&&url.searchParams.get('fields')==='id,parents')return Response.json({parents:['drive-folder']});
    if(url.pathname.endsWith('/files/drive-file-102'))return new Response(bytes);
    if(url.pathname.endsWith('/files/drive-folder'))return Response.json({parents:[]});
    throw new Error('Unexpected Drive request '+url);
  };
}
function createDatabaseFixture(state) {
  return {rpc:async(name,args)=>{
    state.events.push(name);
    if(name==='check_erp_file_sync_needed_v1')return {data:{skip:false}};
    if(name==='fast_erp_import_columns_v1')return {data:['unique_id','itemcode','commonname']};
    if(name==='begin_pending_erp_stage_v3070'){
      assert.equal(args.p_expected_rows,50000);assert.equal(args.p_file_meta.expected_rows_pending,true);
      assert.match(args.p_file_meta.content_hash,/^[a-f0-9]{64}$/);
      return {data:{stage_id:'stage-102',expected_rows:50000,staged_rows:0}};
    }
    if(name==='fast_append_erp_stage_batch_v1')return {data:{staged_rows:args.p_start_row+args.p_rows.length}};
    if(name==='fast_seal_erp_stage_v1'){
      assert.equal(args.p_stage_id,'stage-102');assert.equal(args.p_expected_rows,1);
      return {data:{ok:true,staged_rows:1,expected_rows:1}};
    }
    if(name==='fast_commit_erp_stage_swap_v1') {
      assert.deepEqual(args,{p_stage_id:'stage-102',p_async:true});
      return {data:fixtureErpReceipt('ph_master_inventory',fileName,1)};
    }
    throw new Error('Unexpected ERP RPC '+name);
  }};
}
export async function erpXlsxCommitContract() {
  const state={events:[],moved:false},bytes=workbook();
  const fetcher=withArchiveProof(createDriveFixture(state,bytes),bytes,['drive-folder']);
  const supabase=createDatabaseFixture(state);
  const folders={drive:'drive-folder',cav:'cav-folder',reserves:'reserves-folder',soc:'soc-folder',hl_po_parsed:'hl-folder',processed:{drive:'drive-processed'}};
  const env=key=>key==='ERP_SYNC_DROP_FOLDERS_JSON'?JSON.stringify(folders):'';
  const status=async value=>state.events.push(value.active===false?'idle':'status');
  let cursor={stageIndex:0,stageResults:[],attemptedByStage:{}},result;
  for(let request=0;request<8;request++) {
    result=await runErpSyncWorkerStep({supabase,fetcher,status,env,accessToken:'fixture-token',cursor});
    cursor=result.cursor;if(result.done)break;
  }
  assert.equal(result.done,true);assert.equal(result.ok,true,JSON.stringify(cursor.stageResults));assert.equal(state.moved,true);
  const sequence=['begin_pending_erp_stage_v3070','fast_append_erp_stage_batch_v1','fast_seal_erp_stage_v1','fast_commit_erp_stage_swap_v1','move'].map(name=>state.events.indexOf(name));
  assert.ok(sequence[0]>=0&&sequence.every((position,index)=>index===0||position>sequence[index-1]));
  assert.equal(cursor.stageResults[0].rowCount,1);
}
