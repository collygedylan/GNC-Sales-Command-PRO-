import {driveJson,listFiles,parseErpXlsxSheets,sourceWorkbookBytes} from './erp-sync.mjs';
import {parseSocHistoryReportTime,parseSocHistoryWorkbook,SOC_ORDER_HISTORY_PARSER_VERSION} from './soc-order-history.mjs';

const HISTORY_FOLDER='13hwbF-5wUDruKnjFujjtsyuyrPFgsqpo';
const ROW_BATCH=250;
const ROWS_PER_STEP=1000;
const hashHex=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const sourceRevision=file=>`${file.modifiedTime}|${SOC_ORDER_HISTORY_PARSER_VERSION}`;
const isHistoryFile=file=>! /^(?:TEMP_IMPORT_|TEMP_|~\$|TEMP_SOC_HISTORY_CONVERT_)/i.test(String(file.name||''));

async function historyFiles(fetcher,token){
  const files=await listFiles(fetcher,token,HISTORY_FOLDER,false);
  return files.filter(file=>isHistoryFile(file)&&String(file.mimeType||'')!=='application/vnd.google-apps.folder')
    .sort((a,b)=>String(a.id).localeCompare(String(b.id)));
}
async function parseHistoryFile(fetcher,token,file){
  const bytes=await sourceWorkbookBytes(fetcher,token,file);
  const sheets=await parseErpXlsxSheets(bytes);
  const parsed=parseSocHistoryWorkbook(sheets,String(file.name||''));
  const timing=parseSocHistoryReportTime(file);
  const hash=await hashHex(JSON.stringify({parser:SOC_ORDER_HISTORY_PARSER_VERSION,parsed,timing}));
  return {parsed,timing,hash,contentBytes:Number(file.size)||bytes.byteLength};
}
async function rpc(supabase,name,args){
  const {data,error}=await supabase.rpc(name,args);
  if(error)throw error;
  return data;
}

export async function runSocHistorySyncStep({supabase,fetcher,token,maxFilesPerSlice=1}){
  const files=await historyFiles(fetcher,token);
  if(!files.length)return {done:true,result:{key:'order_history',outcome:'UP_TO_DATE',filesProcessed:0,pendingFiles:0}};
  const manifest=files.map(file=>({drive_file_id:file.id,source_revision:sourceRevision(file)}));
  const started=await rpc(supabase,'begin_eval_item_low_stock_import_v1',{p_manifest:manifest});
  if(!started?.run_id)throw new Error('SOC_HISTORY_RUN_INVALID');
  if(started.complete&&started.active)return {done:true,result:{key:'order_history',outcome:'UP_TO_DATE',filesProcessed:0,pendingFiles:0,runId:started.run_id}};
  const pendingKeys=new Set((Array.isArray(started.pending_files)?started.pending_files:[]).map(file=>`${file.drive_file_id}|${file.source_revision}`));
  const pending=files.filter(file=>pendingKeys.has(`${file.id}|${sourceRevision(file)}`));
  let processed=0;
  const maximum=Math.max(1,Math.min(2,Math.floor(Number(maxFilesPerSlice)||1)));
  for(const file of pending.slice(0,maximum)){
    if(!file.id||!file.modifiedTime||!file.createdTime)throw new Error('SOC_HISTORY_FILE_METADATA_INVALID');
    if(sourceRevision(file)!==`${file.modifiedTime}|${SOC_ORDER_HISTORY_PARSER_VERSION}`)throw new Error('SOC_HISTORY_SOURCE_REVISION_INVALID');
    const {parsed,timing,hash,contentBytes}=await parseHistoryFile(fetcher,token,file);
    const latest=await driveJson(fetcher,token,`files/${encodeURIComponent(file.id)}`,{
      fields:'id,modifiedTime,createdTime,size',supportsAllDrives:true,
    });
    if(String(latest.modifiedTime||'')!==String(file.modifiedTime)||String(latest.createdTime||'')!==String(file.createdTime)){
      throw new Error('SOC_HISTORY_SOURCE_CHANGED');
    }
    const prepared=await rpc(supabase,'prepare_eval_item_low_stock_file_v1',{
      p_run_id:started.run_id,p_drive_file_id:file.id,p_source_revision:sourceRevision(file),p_file_name:file.name,
      p_source_report_date:timing.report_date,p_snapshot_at:timing.snapshot_at,p_source_date_method:timing.source_date_method,
      p_source_created_at:timing.source_created_at,p_content_sha256:hash,p_content_bytes:contentBytes,
      p_source_sheet_name:parsed.source_sheet_name||null,p_source_row_count:parsed.source_row_count,
      p_expected_row_count:parsed.rows.length,p_exclusion_counts:{schema:parsed.schema,row_ranges:parsed.exclusion_ranges,...parsed.exclusion_counts},
      p_disposition:/^DriveAroundMC-/i.test(file.name)?'excluded':'eligible',
      p_exclusion_reason:/^DriveAroundMC-/i.test(file.name)?'non_soc_drivearound_mc':null,
    });
    if(!prepared?.file_version_id)throw new Error('SOC_HISTORY_FILE_STATE_INVALID');
    if(prepared.status!=='complete'){
      const last=Number(prepared.last_staged_row_number)||0;
      const rows=parsed.rows.filter(row=>row.source_row_number>last);
      const stepRows=rows.slice(0,ROWS_PER_STEP);
      for(let index=0;index<stepRows.length;index+=ROW_BATCH){
        await rpc(supabase,'stage_eval_item_low_stock_rows_v1',{p_file_version_id:prepared.file_version_id,p_rows:stepRows.slice(index,index+ROW_BATCH)});
      }
      if(rows.length>stepRows.length)return {done:false,result:{key:'order_history',outcome:'CONTINUE',
        filesProcessed:processed,pendingFiles:pending.length,runId:started.run_id,rowsStaged:stepRows.length}};
      await rpc(supabase,'finalize_eval_item_low_stock_file_v1',{
        p_file_version_id:prepared.file_version_id,p_content_sha256:hash,p_expected_row_count:parsed.rows.length,
      });
    }
    processed+=1;
  }
  const latestFiles=await historyFiles(fetcher,token);
  const latestManifest=latestFiles.map(file=>({drive_file_id:file.id,source_revision:sourceRevision(file)}));
  const sameManifest=JSON.stringify(manifest)===JSON.stringify(latestManifest);
  const after=await rpc(supabase,'begin_eval_item_low_stock_import_v1',{p_manifest:manifest});
  if(after?.complete&&!after?.active&&sameManifest){
    const activated=await rpc(supabase,'activate_eval_item_low_stock_import_v1',{p_run_id:after.run_id});
    if(!activated||!['active','complete'].includes(String(activated.status||'')))throw new Error('SOC_HISTORY_ACTIVATION_UNCONFIRMED');
    return {done:true,result:{key:'order_history',outcome:'processed',filesProcessed:processed,pendingFiles:0,runId:after.run_id}};
  }
  return {done:false,result:{key:'order_history',outcome:'CONTINUE',filesProcessed:processed,
    pendingFiles:Array.isArray(after?.pending_files)?after.pending_files.length:pending.length,runId:after?.run_id||started.run_id}};
}

export {HISTORY_FOLDER as SOC_ORDER_HISTORY_FOLDER};
