import { driveJson, listFiles, moveProcessed, sourceBytes, shouldIgnoreErpFile, buildOperationalStageCheckpoint, compareErpFiles } from './erp-sync.mjs';
import { discoverSecondaryFolders } from '../../../src/core/erp-secondary-discovery.mjs';
import { processHlPdf, processSecondaryWorkbook, recordEmptySecondaryResult, hasPendingSecondaryFile, markSecondaryArchive } from '../../../src/core/erp-secondary-stage.mjs';

export const SECONDARY_ERP_STAGES = [
  {key:'transactions_keyed', folder:'1aP8zvY9SwOEV3ThcQf7t9oBBinEr3gMe', processed:'1glpzw3zr1Q2YyNj2OtD_O5fBBFpPe78Q'},
  {key:'stine_lumber', folder:'1R9NDclDdlLhyHDKlUyG-KuSwN2mrUNRt', processed:'1Ped8i4nyegI1Ikvv8O_BJUTLFGAq8AjN'},
  {key:'pikes', folder:'178W6cp2r9ZKfcKRg-4c06SRnwG9LgqmL', processed:'1zbwb0U31IOhOoLyNDXea3P_fqEB5EsWE', includeParent:true},
  {key:'hl_po_parsed', folder:'1UFh-9lgR11O8d_WKvVfdrHvIe-LITzyR', processed:'1kL4ueMj1AijDiXP3m6kXnPD87r5OWr8Q', includeParent:true},
];
const headerKey=value=>String(value??'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');
const text=value=>String(value??'').trim()||null;
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
  typeof value==='string'?new TextEncoder().encode(value):value))).map(n=>n.toString(16).padStart(2,'0')).join('');

// Same ordered source columns and types as Code.gs TRANSACTIONS_KEYED_COLUMNS.
export const TRANSACTION_COLUMNS = [
  {
    "header": "Transaction Date",
    "key": "transaction_datetime",
    "type": "datetime"
  },
  {
    "header": "Invoice Date",
    "key": "invoice_datetime",
    "type": "datetime"
  },
  {
    "header": "Commit Date",
    "key": "commit_datetime",
    "type": "datetime"
  },
  {
    "header": "Code - Item",
    "key": "code_item",
    "type": "text"
  },
  {
    "header": "Description 1 - Item",
    "key": "description_1_item",
    "type": "text"
  },
  {
    "header": "Code - Lot",
    "key": "code_lot",
    "type": "text"
  },
  {
    "header": "Code - Location",
    "key": "code_location",
    "type": "text"
  },
  {
    "header": "Source",
    "key": "source",
    "type": "text"
  },
  {
    "header": "Code 2 - Detail",
    "key": "code_2_detail",
    "type": "text"
  },
  {
    "header": "DesigItem",
    "key": "desig_item",
    "type": "text"
  },
  {
    "header": "Code 5 - Detail",
    "key": "code_5_detail",
    "type": "text"
  },
  {
    "header": "DesigCust",
    "key": "desig_cust",
    "type": "text"
  },
  {
    "header": "Code 3 - Detail",
    "key": "code_3_detail",
    "type": "text"
  },
  {
    "header": "DesigLoc",
    "key": "desig_loc",
    "type": "text"
  },
  {
    "header": "Code 4 - Detail",
    "key": "code_4_detail",
    "type": "text"
  },
  {
    "header": "Out Ordered - Transaction Location",
    "key": "out_ordered_transaction_location",
    "type": "number"
  },
  {
    "header": "Quantity",
    "key": "quantity",
    "type": "number"
  },
  {
    "header": "Code 1 - Detail",
    "key": "code_1_detail",
    "type": "text"
  },
  {
    "header": "Reference",
    "key": "reference",
    "type": "text"
  },
  {
    "header": "Status",
    "key": "transaction_status",
    "type": "text"
  },
  {
    "header": "Created By - Detail",
    "key": "created_by_detail",
    "type": "text"
  },
  {
    "header": "Transaction Number",
    "key": "transaction_number",
    "type": "text"
  },
  {
    "header": "Date 1 - Detail",
    "key": "date_1_detail",
    "type": "datetime"
  },
  {
    "header": "Reference 1 - Detail",
    "key": "reference_1_detail",
    "type": "text"
  },
  {
    "header": "Reference 2 - Detail",
    "key": "reference_2_detail",
    "type": "text"
  },
  {
    "header": "Program",
    "key": "program",
    "type": "text"
  },
  {
    "header": "Module",
    "key": "module",
    "type": "text"
  },
  {
    "header": "Transaction Type",
    "key": "transaction_type",
    "type": "text"
  },
  {
    "header": "Stage",
    "key": "stage",
    "type": "text"
  },
  {
    "header": "Shipping Date - OM Transaction Header",
    "key": "shipping_datetime_om_transaction_header",
    "type": "datetime"
  },
  {
    "header": "Ship To Name - OM Transaction Header",
    "key": "ship_to_name_om_transaction_header",
    "type": "text"
  },
  {
    "header": "FM PU Stop Number - OM Transaction Header",
    "key": "fm_pu_stop_number_om_transaction_header",
    "type": "text"
  },
  {
    "header": "FM Trip Number - OM Transaction Header",
    "key": "fm_trip_number_om_transaction_header",
    "type": "text"
  },
  {
    "header": "Ordered Quantity",
    "key": "ordered_quantity",
    "type": "number"
  },
  {
    "header": "Shipped Quantity - OM Transaction Detail",
    "key": "shipped_quantity_om_transaction_detail",
    "type": "number"
  },
  {
    "header": "Price",
    "key": "price",
    "type": "number"
  },
  {
    "header": "Amount",
    "key": "amount",
    "type": "number"
  },
  {
    "header": "Reference 1 - Lot",
    "key": "reference_1_lot",
    "type": "text"
  },
  {
    "header": "Reference 2 - Lot",
    "key": "reference_2_lot",
    "type": "text"
  },
  {
    "header": "Reference 4 - Lot",
    "key": "reference_4_lot",
    "type": "text"
  }
];

function localTimestamp(value) {
  if(value===null||value===undefined||String(value).trim()==='')return null;
  if(typeof value==='number')return new Date(Date.UTC(1899,11,30)+value*86400000).toISOString().slice(0,19);
  const s=String(value).trim();
  if(/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/.test(s))return s.replace(' ','T');
  const m=/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i.exec(s);
  if(!m)throw new Error('TRANSACTIONS_KEYED_DATE_INVALID');
  let hour=Number(m[4]||0);if(m[7])hour=hour%12+(m[7].toUpperCase()==='PM'?12:0);
  const year=Number(m[3])<100?2000+Number(m[3]):Number(m[3]);
  return `${year}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}T${String(hour).padStart(2,'0')}:${m[5]||'00'}:${m[6]||'00'}`;
}
function numeric(value) {
  if(value===null||value===undefined||String(value).trim()==='')return null;
  const s=String(value).trim().replace(/[$,]/g,'').replace(/^\((.*)\)$/,'-$1');
  const n=Number(s);if(!Number.isFinite(n))throw new Error('TRANSACTIONS_KEYED_NUMBER_INVALID');return n;
}
export function readSecondarySheet(workbook, sourceKey) {
  const expected=sourceKey==='transactions_keyed'?TRANSACTION_COLUMNS.map(c=>headerKey(c.header)):['item','ordertot','picknotes'];
  for(const sheet of workbook)for(let index=0;index<Math.min(sheet.rows.length,80);index++) {
    const headers=sheet.rows[index].map(headerKey);
    if(!expected.every(key=>headers.includes(key)))continue;
    if(expected.some(key=>headers.filter(h=>h===key).length!==1))throw new Error('SECONDARY_DUPLICATE_HEADER');
    return {name:sheet.name,header:index,rows:sheet.rows,totalRows:sheet.totalRows||sheet.rows.length,indexes:Object.fromEntries(expected.map(key=>[key,headers.indexOf(key)]))};
  }
  throw new Error('SECONDARY_SOURCE_HEADER_MISSING');
}
export async function buildSecondaryRows(sheet, stage, file, state, limit=1000, now=()=>performance.now()) {
  const started=now(),rows=[];let offset=Number(state.nextOffset??sheet.header+1);
  for(;offset<sheet.rows.length;offset++) {
    if(offset>Number(state.nextOffset??sheet.header+1)&&now()-started>=700)break;
    const source=sheet.rows[offset];let row;
    if(stage.key==='transactions_keyed') {
      if(!TRANSACTION_COLUMNS.some(c=>text(source[sheet.indexes[headerKey(c.header)]])))continue;
      row={drive_file_id:file.id,content_sha256:state.digest,source_sheet_name:sheet.name,
        source_row_number:offset+1,import_batch_id:state.batchId};
      const values=TRANSACTION_COLUMNS.map(c=>{const v=source[sheet.indexes[headerKey(c.header)]];
        return row[c.key]=c.type==='number'?numeric(v):c.type==='datetime'?localTimestamp(v):text(v);});
      row.source_row_hash=await hash(JSON.stringify(values));row.row_state_hash=row.source_row_hash;
    } else {
      const item=text(source[sheet.indexes.item]);if(!item)continue;
      row={batch_id:state.batchId,source_row_number:offset+1,itemcode:item,itemcode_normalized:item.toUpperCase(),
        order_tot:text(source[sheet.indexes.ordertot]),pick_notes:text(source[sheet.indexes.picknotes])};
      row.row_state_hash=await hash(JSON.stringify([row.itemcode,row.order_tot,row.pick_notes]));
    }
    rows.push(row);
    if(rows.length>=limit||now()-started>=700){offset++;break;}
  }
  return {rows,nextOffset:offset,done:offset>=(sheet.totalRows||sheet.rows.length)};
}
async function rpc(db,name,args) {const r=await db.rpc(name,args);if(r.error)throw new Error(r.error.message||name);return r.data||{};}
async function defaultParseWorkbook(bytes, rowLimit=1081) {
  const XLSX=await import('npm:xlsx@0.18.5');
  const book=XLSX.read(bytes,{type:'array',cellDates:false,sheetRows:rowLimit});
  return book.SheetNames.map(name=>({name,totalRows:XLSX.utils.decode_range(book.Sheets[name]['!fullref']||book.Sheets[name]['!ref']||'A1').e.r+1,
    rows:XLSX.utils.sheet_to_json(book.Sheets[name],{header:1,defval:'',raw:false})}));
}
export async function prefetchSecondaryFolders(fetcher,token,stages=SECONDARY_ERP_STAGES,options={}) {
  return discoverSecondaryFolders(fetcher,token,stages,{
    listFiles,driveJson,shouldIgnore:shouldIgnoreErpFile,compare:compareErpFiles
  },options.pendingOnly===true);
}
export async function runSecondaryErpSyncStep({supabase,fetcher=fetch,accessToken,env,status,cursor={},parseWorkbook=defaultParseWorkbook,operationalOnly=false}) {
  const stages=operationalOnly?SECONDARY_ERP_STAGES.filter(stage=>stage.key==='hl_po_parsed'):SECONDARY_ERP_STAGES;
  const snapshot=cursor.secondaryFolders||await prefetchSecondaryFolders(fetcher,accessToken,stages,{pendingOnly:operationalOnly});
  const results=Array.isArray(cursor.stageResults)?cursor.stageResults.slice():[];
  let index=Number(cursor.secondaryIndex)||0,state=cursor.secondaryFile||null;
  const base={...cursor,coreComplete:true,secondaryFolders:snapshot};
  while(index<stages.length) {
    const stage=stages[index],folder=snapshot[stage.key],files=folder.files;
    const attempted=new Set(cursor.secondaryAttempted?.[stage.key]||[]);
    const file=state?.file||files.find(f=>!attempted.has(f.id));
    if(!file){recordEmptySecondaryResult(results,stage,folder);index++;state=null;continue;}
    const allowed=stage.key==='hl_po_parsed'?/\.pdf$/i:/\.(xlsx|xls|csv)$/i;
    if(!allowed.test(file.name))throw new Error(`SECONDARY_UNSUPPORTED_FILE:${stage.key}:${file.name}`);
    if(operationalOnly)await status({sourceProgressDelta:{key:stage.key,fileName:file.name,stage:'downloading',percent:25,updatedAt:new Date().toISOString()}});
    const bytes=await sourceBytes(fetcher,accessToken,file),digest=await hash(bytes);
    if(state&&state.digest!==digest)throw new Error('SECONDARY_SOURCE_CHANGED_DURING_IMPORT');
    state=state||{file,digest,batchId:crypto.randomUUID(),nextOffset:0,rowCount:0};
    const context={stage,file,bytes,state,digest,supabase,fetcher,env,status,operationalOnly,parseWorkbook,
      api:{rpc,readSheet:readSecondarySheet,buildRows:buildSecondaryRows}};
    const complete=stage.key==='hl_po_parsed'
      ? await processHlPdf(context) : await processSecondaryWorkbook(context);
    if(complete) {
      await moveProcessed(fetcher,accessToken,{...file,publishedContentHash:digest},stage.folder,stage.processed);
      await markSecondaryArchive(supabase,stage,file,digest,rpc);
      attempted.add(file.id);base.secondaryAttempted={...(cursor.secondaryAttempted||{}),[stage.key]:Array.from(attempted)};
      results.push({key:stage.key,outcome:'imported',sourceFileName:file.name,processedFiles:1,rowCount:state.rowCount,listDurationMs:folder.listDurationMs});state=null;
      if(operationalOnly&&!hasPendingSecondaryFile(files,attempted))index++;
    }
    if(operationalOnly&&index>=stages.length)break;
    const next={...base,secondaryIndex:index,secondaryFile:state,stageResults:results};
    await status({active:true,status:'CONTINUE',currentStage:stage.key,...(operationalOnly?{stageIndex:4,currentStageLabel:'HL PO'}:{}),stageResults:results,continuationCursor:next,nextOffset:state?.nextOffset??null});
    return {done:false,cursor:next};
  }
  const failed=results.some(r=>r.outcome==='failed'),completedAt=new Date().toISOString();
  await status({active:false,status:failed?'failed':'complete',currentStage:'idle',stageResults:results,
    ...(operationalOnly?{sourceProgressDelta:buildOperationalStageCheckpoint('hl_po_parsed',results)}:{}),
    sliceFailures:0,error:failed?'One or more ERP files could not be imported.':'',errorCode:failed?'ERP_SYNC_STAGE_FAILED':'',
    message:failed?'One or more ERP files could not be imported.':'ERP sync completed.',
    continuationCursor:{...base,secondaryIndex:index,stageResults:results},completedAt,finishedAt:completedAt});
  return {done:true,cursor:{...base,secondaryIndex:index,stageResults:results}};
}
