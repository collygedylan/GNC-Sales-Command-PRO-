import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { countImportableErpXlsxRows, createBoundedByteStream, isLegacyRunScriptAction, normalizeErpRows, parseErpCsv, parseErpXlsx, parseErpXlsxPage, runErpSyncWorker, runErpSyncWorkerStep, shouldIgnoreErpFile, validateErpSyncCommand } from '../supabase/functions/_shared/erp-sync.mjs';

function makeZip(entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const filename = Buffer.from(name), raw = Buffer.from(content), compressed = deflateRawSync(raw);
    const local = Buffer.alloc(30 + filename.length);
    local.writeUInt32LE(0x04034b50,0); local.writeUInt16LE(20,4); local.writeUInt16LE(8,8);
    local.writeUInt32LE(compressed.length,18); local.writeUInt32LE(raw.length,22);
    local.writeUInt16LE(filename.length,26); filename.copy(local,30);
    locals.push(local,compressed);
    const record = Buffer.alloc(46 + filename.length);
    record.writeUInt32LE(0x02014b50,0); record.writeUInt16LE(20,4); record.writeUInt16LE(20,6);
    record.writeUInt16LE(8,10); record.writeUInt32LE(compressed.length,20); record.writeUInt32LE(raw.length,24);
    record.writeUInt16LE(filename.length,28); record.writeUInt32LE(offset,42); filename.copy(record,46);
    central.push(record); offset += local.length + compressed.length;
  }
  const centralData = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0); end.writeUInt16LE(Object.keys(entries).length,8);
  end.writeUInt16LE(Object.keys(entries).length,10); end.writeUInt32LE(centralData.length,12);
  end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,centralData,end]);
}

test('ERP source filtering ignores temp imports and Office lock files', () => {
  assert.equal(shouldIgnoreErpFile('TEMP_import.xlsx'), true);
  assert.equal(shouldIgnoreErpFile('~$Drive.xlsx'), true);
  assert.equal(shouldIgnoreErpFile('DriveAround.xlsx'), false);
});

test('ERP sync accepts one forced start attempt or a read-only status request', () => {
  const commandId = '0f39d01a-3cc7-4ae4-83c0-96a0d02b9f53';
  assert.deepEqual(validateErpSyncCommand({action:'erp_sync',operation:'start',commandId,force:true,forceRestart:true,maxAttemptsPerStage:1}),
    {ok:true,operation:'start',commandId});
  assert.deepEqual(validateErpSyncCommand({action:'erp_sync',operation:'status'}),{ok:true,operation:'status'});
  const runId='29f77c6e-9f1a-4f43-bf1a-46783d8a90bf';
  assert.deepEqual(validateErpSyncCommand({action:'erp_sync',operation:'continue',runId}),{ok:true,operation:'continue',runId});
  for (const payload of [
    {action:'erp_sync',operation:'start',commandId,force:true,forceRestart:true,maxAttemptsPerStage:2},
    {action:'erp_sync',operation:'start',commandId,force:true,maxAttemptsPerStage:1,actor:'megan_kelly'},
    {action:'erp_sync',operation:'status',force:true},
    {action:'erp_sync',operation:'continue',runId:'not-a-uuid'},
    {action:'erp_sync',operation:'manual_continue'},
  ]) assert.equal(validateErpSyncCommand(payload).ok,false);
});

test('legacy RUN SCRIPT actions are rejected while unrelated Apps Script actions remain available', () => {
  for (const action of ['manual_run','manual_continue','manual_status']) assert.equal(isLegacyRunScriptAction(action),true);
  for (const action of ['request_delivery_wake','eval_work_report']) assert.equal(isLegacyRunScriptAction(action),false);
});

test('app-api connects strict validation to ERP actions and keeps status read-only', async () => {
  const source = await readFile(new URL('../supabase/functions/app-api/index.ts', import.meta.url),'utf8');
  const handler = source.slice(source.indexOf('async function handleErpSyncAction'),source.indexOf('if (import.meta.main) serve'));
  const appsScriptHandler = source.slice(source.indexOf('async function handleAppsScriptAction'),source.indexOf('function dispatchAuthenticatedDeliveryWake'));
  assert.match(handler,/const command = validateErpSyncCommand\(payload\)/);
  assert.match(handler,/operation === "status"[^]*get_erp_sync_status_v1/);
  assert.match(handler,/claim_erp_sync_job_v2[^]*p_force_restart: true[^]*return jsonResponse\(\{ ok: true, status:"CONTINUE", data: initial \}\)/);
  assert.match(handler,/operation === "continue"[^]*claim_erp_sync_request_step_v1[^]*processCloudErpSyncStep[^]*releaseCloudErpSyncStep/);
  assert.match(handler,/for \(const privateField of \["workerId","worker_id","claimed"[^]*delete status\[privateField\]/);
  assert.doesNotMatch(handler,/runErpSyncWorker|EdgeRuntime\.waitUntil/);
  assert.ok(handler.indexOf('operation === "status"') < handler.indexOf('claim_erp_sync_job_v2'));
  const worker = source.slice(source.indexOf('const ERP_SYNC_WORKER_OPERATIONS'),source.indexOf('if (import.meta.main) serve'));
  assert.match(worker,/authorization !== `Bearer \$\{ERP_SYNC_LOCAL_WORKER_KEY\}`/);
  assert.match(worker,/claim_erp_sync_worker_v1/);
  assert.match(worker,/assert_erp_sync_worker_v1/);
  assert.match(worker,/fast_commit_erp_stage_swap_v1/);
  assert.match(source,/action === "erp_sync_worker"\) \{\s*return errorResponse\("The local ERP worker is disabled\.", 410/);
  assert.match(handler,/dispatchCloudErpSync\(initial\)/);
  assert.match(source,/handleErpSyncAction\(session, payload, activeProfileForRequest\)/);
  assert.match(source,/runtime\.waitUntil\(task\)/);
  assert.match(source,/claim_erp_sync_request_step_v1[^]*p_actor: String\(status.requestedBy/);
  assert.match(source,/action === "erp_sync_continue"[^]*handleErpSyncContinuation/);
  assert.match(source,/action: "mint_drive_token"[^]*actor: \{ system: "erp-sync-cloud-worker" \}/);
  assert.match(source,/data\.accessToken \|\| data\.access_token/);
  assert.doesNotMatch(source,/ERP_SYNC_GOOGLE_OAUTH_JSON|GNC_GOOGLE_REFRESH_TOKEN/);
  assert.match(appsScriptHandler,/isLegacyRunScriptAction\(action\)[^]*LEGACY_RUN_SCRIPT_DISABLED[^]*PRODUCTION_SCHEDULE_APPS_SCRIPT_URL/);
});

test('CSV parser preserves quoted commas, escaped quotes, and embedded newlines', () => {
  assert.deepEqual(parseErpCsv('itemcode,commonname,note\r\n001,"Red, Maple","line 1\nline ""2"""\r\n'), [
    {itemcode:'001',commonname:'Red, Maple',note:'line 1\nline "2"'},
  ]);
});

test('XLSX parser reads first worksheet shared strings and sparse columns in memory', async () => {
  const bytes = makeZip({
    'xl/workbook.xml':'<workbook xmlns:r="urn:r"><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml':'<sst><si><t>itemcode</t></si><si><t>commonname</t></si><si><t>note</t></si><si><t>001</t></si><si><t>Red &amp; Maple</t></si></sst>',
    'xl/worksheets/sheet1.xml':'<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" s="2" /><c r="C2" t="s"><v>4</v></c></row></sheetData></worksheet>',
  });
  assert.deepEqual(await parseErpXlsx(bytes), [{itemcode:'001',commonname:'',note:'Red & Maple'}]);
  const page=await parseErpXlsxPage(bytes,0,1);
  assert.deepEqual(page.rows,[{itemcode:'001',commonname:'',note:'Red & Maple'}]);
  assert.equal(page.nextOffset,1);
  assert.equal(page.done,true);
  assert.equal(await countImportableErpXlsxRows(bytes,'drive_around'),1);
});

test('ZIP compressed input is fed to DecompressionStream in bounded backpressured chunks', async () => {
  const bytes=Uint8Array.from({length:100_003},(_,index)=>index%251);
  const reader=createBoundedByteStream(bytes).getReader();
  let count=0,maxChunk=0;
  while(true){const {value,done}=await reader.read();if(done)break;count+=value.length;maxChunk=Math.max(maxChunk,value.length);}
  assert.equal(count,bytes.length);
  assert.ok(maxChunk<=16*1024);
});

test('streaming XLSX pages stop at bounded worksheet rows and resume with absolute offsets', async () => {
  const sheetRows=['<row r="1"><c r="A1" t="inlineStr"><is><t>itemcode</t></is></c><c r="B1" t="inlineStr"><is><t>dock</t></is></c></row>'];
  for(let index=1;index<=5200;index+=1)sheetRows.push(`<row r="${index+1}"><c r="A${index+1}"><v>${index}</v></c><c r="B${index+1}"><v>D${index}</v></c></row>`);
  const bytes=makeZip({
    'xl/workbook.xml':'<workbook xmlns:r="urn:r"><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':`<worksheet><sheetData>${sheetRows.join('')}</sheetData></worksheet>`,
  });
  const first=await parseErpXlsxPage(bytes,0,5000), second=await parseErpXlsxPage(bytes,first.nextOffset,5000);
  assert.equal(first.rows.length,5000);
  assert.equal(first.rows[0].itemcode,'1');
  assert.equal(first.nextOffset,5000);
  assert.equal(first.done,false);
  assert.equal(second.rows.length,200);
  assert.equal(second.rows.at(-1).itemcode,'5200');
  assert.equal(second.nextOffset,5200);
  assert.equal(second.done,true);
});

test('streaming XLSX pages discover itemcode headers after report titles and preserve blank-row offsets', async () => {
  const sheet='<worksheet><sheetData>'+
    '<row r="1"><c r="A1" t="inlineStr"><is><t>DriveAround Monthly Report</t></is></c></row>'+
    '<row r="2"></row>'+
    '<row r="3"><c r="A3" t="inlineStr"><is><t>itemcode</t></is></c><c r="B3" t="inlineStr"><is><t>commonname</t></is></c></row>'+
    '<row r="4"><c r="A4" t="inlineStr"><is><t>001</t></is></c><c r="B4" t="inlineStr"><is><t>Blue Grass</t></is></c></row>'+
    '<row r="5"></row>'+
    '<row r="6"><c r="A6" t="inlineStr"><is><t>002</t></is></c><c r="B6" t="inlineStr"><is><t>Red Grass</t></is></c></row>'+
    '</sheetData></worksheet>';
  const bytes=makeZip({
    'xl/workbook.xml':'<workbook xmlns:r="urn:r"><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':sheet,
  });
  const first=await parseErpXlsxPage(bytes,0,1), blank=await parseErpXlsxPage(bytes,first.nextOffset,1), last=await parseErpXlsxPage(bytes,blank.nextOffset,1);
  assert.equal(first.rows[0].itemcode,'001');
  assert.equal(first.done,false);
  assert.equal(blank.rows[0].itemcode,'');
  assert.equal(blank.nextOffset,2);
  assert.equal(last.rows[0].itemcode,'002');
  assert.equal(last.done,true);
  assert.equal(await countImportableErpXlsxRows(bytes,'drive_around'),2);
});

test('cloud XLSX stages its exact row count in one invocation and commits once', async () => {
  const bytes=makeZip({
    'xl/workbook.xml':'<workbook xmlns:r="urn:r"><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':'<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>itemcode</t></is></c><c r="B1" t="inlineStr"><is><t>commonname</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>001</t></is></c><c r="B2" t="inlineStr"><is><t>Blue Grass</t></is></c></row></sheetData></worksheet>',
  });
  let archived=false,appendCalls=0,sealCalls=0,commitCalls=0;
  const fakeFetch=async(input,init={})=>{
    const url=new URL(input);
    if(url.pathname.endsWith('/files')){
      const folder=url.searchParams.get('q').match(/'([^']+)'/)[1];
      return Response.json({files:folder==='drive-folder'&&!archived?[{id:'xlsx-1',name:'Drive.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',modifiedTime:'2026-10-28T12:00:00Z',parents:['drive-folder']}]:[]});
    }
    if(url.pathname.endsWith('/files/xlsx-1')){
      if(init.method==='PATCH'){archived=true;return Response.json({id:'xlsx-1'});}
      return new Response(bytes);
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const supabase={rpc:async(name,args)=>{
    if(name==='check_erp_file_sync_needed_v1')return {data:{skip:false}};
    if(name==='fast_erp_import_columns_v1')return {data:['unique_id','itemcode','commonname']};
    if(name==='fast_begin_erp_stage_v1'){
      assert.equal(args.p_expected_rows,50000);
      assert.equal(args.p_file_meta.expected_rows_pending,true);
      return {data:{stage_id:'xlsx-stage',expected_rows:50000,staged_rows:0}};
    }
    if(name==='fast_append_erp_stage_batch_v1'){appendCalls+=1;return {data:{staged_rows:args.p_start_row+args.p_rows.length}};}
    if(name==='fast_seal_erp_stage_v1'){sealCalls+=1;assert.equal(args.p_expected_rows,1);return {data:{ok:true}};}
    if(name==='fast_commit_erp_stage_swap_v1'){commitCalls+=1;return {data:{ok:true}};}
    throw new Error(`unexpected RPC ${name}`);
  }};
  const folders={drive:'drive-folder',cav:'cav-folder',reserves:'reserves-folder',soc:'soc-folder',hl_po_parsed:'hl-folder',processed:{drive:'drive-processed'}};
  const env=key=>key==='ERP_SYNC_DROP_FOLDERS_JSON'?JSON.stringify(folders):'';
  const result=await runErpSyncWorkerStep({supabase,fetcher:fakeFetch,status:async()=>{},env,accessToken:'fixture-token'});
  assert.equal(appendCalls,1);
  assert.equal(sealCalls,1);
  assert.equal(commitCalls,1);
  assert.equal(archived,true);
  assert.equal(result.cursor.stageResults[0].rowCount,1);
  assert.equal(result.cursor.fileContinuation,undefined);
});

test('SOC XLSX pages filter itemcode/dock/Suspend rows before full cell decoding and preserve raw offsets', async () => {
  const headers=['itemcode','dock','suspend','suspend-to','commonname'];
  const row=(n,values)=>`<row r="${n}">${values.map((value,index)=>`<c r="${String.fromCharCode(65+index)}${n}" t="inlineStr"><is><t>${value}</t></is></c>`).join('')}</row>`;
  const sheet=`<worksheet><sheetData>${row(1,headers)}${row(2,['001','D1','','','Plant 1'])}${row(3,['002','','','','Excluded'])}${row(4,['003','','SUSPEND','','Plant 3'])}</sheetData></worksheet>`;
  const bytes=makeZip({
    'xl/workbook.xml':'<workbook xmlns:r="urn:r"><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':sheet,
  });
  const first=await parseErpXlsxPage(bytes,0,2,{dataset:'soc'}),second=await parseErpXlsxPage(bytes,first.nextOffset,2,
    {dataset:'soc',headerRowIndex:first.headerRowIndex,header:first.header});
  assert.deepEqual(first.rows.map(item=>item.itemcode),['001']);
  assert.equal(first.nextOffset,2);
  assert.equal(first.done,false);
  assert.deepEqual(second.rows.map(item=>item.itemcode),['003']);
  assert.equal(second.nextOffset,3);
  assert.equal(second.done,true);
  assert.equal(await countImportableErpXlsxRows(bytes,'soc'),2);
});

test('SOC XLSX and normalization preserve every active dock row across ERP dock/drop header aliases', async () => {
  const headers=['itemcode','docknumber','tripnumber','drop','suspend','suspend-to'];
  const row=(n,values)=>`<row r="${n}">${values.map((value,index)=>`<c r="${String.fromCharCode(65+index)}${n}" t="inlineStr"><is><t>${value}</t></is></c>`).join('')}</row>`;
  const bytes=makeZip({
    'xl/workbook.xml':'<workbook xmlns:r="urn:r"><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':`<worksheet><sheetData>${row(1,headers)}${row(2,['101','38.0','','40.0','',''])}${row(3,['102','','39.0','30.0','',''])}${row(4,['103','0','','','',''])}${row(5,['104','','','','SUSPEND','DC'])}</sheetData></worksheet>`,
  });
  const page=await parseErpXlsxPage(bytes,0,10,{dataset:'soc'});
  assert.deepEqual(page.rows.map(item=>item.itemcode),['101','102','104']);
  const normalized=await normalizeErpRows(page.rows,'soc',['unique_id','itemcode','dock','tripnumber','stopnumber']);
  assert.deepEqual(normalized.map(item=>[item.dock??null,item.tripnumber??null,item.stopnumber??null]),[['38.0',null,'40.0'],['39.0','39.0','30.0'],[null,null,null]]);
  assert.equal(await countImportableErpXlsxRows(bytes,'soc'),3);
});

test('live row mapping preserves canonical physical identities and CAV aliases', async () => {
  const driveInput = {warehouseid:'W1',itemcode:'004103.010.1',contsize:'#1',lotcode:'27.F1',locationcode:'C.15.000',source:'DriveAround',
    holdstopcode:'',holdstartdate:'2026-10-27',holdreasonnotescomments:'stale text',locnote:'pull full',locnotedate:'2026-10-27',ptn1:'A.09.000'};
  const driveId = `drive-${createHash('sha256').update(JSON.stringify(['W1','004103.010.1','#1','27.F1','C.15.000','DriveAround','','',''])).digest('hex').slice(0,32)}`;
  const drive = await normalizeErpRows([driveInput],'drive_around',['unique_id','itemcode','contsize','lotcode','locationcode','source',
    'holdstopcode','holdstopbegindate','holdstopreason','locationnote','locationnotedate','locationptn1']);
  assert.equal(drive[0].values.unique_id,driveId);
  assert.deepEqual([drive[0].values.holdstopcode,drive[0].values.holdstopbegindate,drive[0].values.holdstopreason,
    drive[0].values.locationnote,drive[0].values.locationnotedate,drive[0].values.locationptn1],
    [null,'2026-10-27','stale text','pull full','2026-10-27','A.09.000']);
  const soc = await normalizeErpRows([{dock:'D1',itemcode:'001',transactionnumber:'T1',quantityordered:'2'}],
    'soc',['unique_id','itemcode']);
  assert.equal(soc[0].unique_id,['D1','T1','','','001','','','2','','','','','',''].join('-'));
  const cav = await normalizeErpRows([{item:'001',productdescription:'Blue Grass',brandcode:'B',size:'#1',season:'F1',
    reservedqty:'7',orderqty:'8',unitprice:'9',hotprice:'10',holdreasonnotescomments:'hold',extitemtotal:'11'}],
    'cav',['unique_id','itemcode','commonname','contsize','brand_code','reserved_qty','order_qty','unit_price','hot_price','hold_reason','ext_item_total']);
  assert.equal(cav[0].itemcode,'001');
  assert.equal(cav[0].commonname,'Blue Grass');
  assert.deepEqual([cav[0].brand_code,cav[0].reserved_qty,cav[0].order_qty,cav[0].unit_price,cav[0].hot_price,cav[0].hold_reason,cav[0].ext_item_total],
    ['B','7','8','9','10','hold','11']);
});

test('worker commits each staged batch before archiving and completes the empty HL folder', async () => {
  const calls = [], status = [];
  let sourceListed = true;
  const fakeFetch = async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/files')) {
      if (init.method === 'POST') return Response.json({id:'processed-folder'});
      const folder = url.searchParams.get('q').match(/'([^']+)'/)[1];
      return Response.json({files: folder === 'drive-folder' && sourceListed
        ? [{id:'file-1',name:'DriveAround.csv',modifiedTime:'2026-10-27T00:00:00Z',parents:['drive-folder']}]
        : folder === 'drive-folder' ? [{id:'processed-folder',name:'Processed',mimeType:'application/vnd.google-apps.folder'}] : []});
    }
    if (url.pathname.endsWith('/files/file-1') && url.searchParams.get('alt') === 'media') {
      return new Response('itemcode,commonname,ptravailable\n001,Red Maple,5');
    }
    if (url.pathname.endsWith('/files/file-1')) { calls.push('archive'); sourceListed = false; return Response.json({id:'file-1'}); }
    throw new Error(`unexpected fetch ${url}`);
  };
  const supabase = { rpc: async (name,args) => {
    calls.push(name);
    if (name === 'check_erp_file_sync_needed_v1') return {data:{skip:false}};
    if (name === 'fast_erp_import_columns_v1') return {data:['unique_id','itemcode','commonname','ptravailable']};
    if (name === 'fast_begin_erp_stage_v1') return {data:{stage_id:'stage-1',expected_rows:1,staged_rows:0}};
    if (name === 'fast_append_erp_stage_batch_v1') return {data:{staged_rows:args.p_start_row+args.p_rows.length}};
    if (name === 'fast_commit_erp_stage_swap_v1') return {data:{ok:true}};
    throw new Error(`unexpected RPC ${name}`);
  }};
  const folders = {drive:'drive-folder',cav:'cav-folder',reserves:'reserves-folder',soc:'soc-folder',hl_po_parsed:'hl-folder'};
  const result = await runErpSyncWorker({supabase,fetcher:fakeFetch,status:async patch=>status.push(patch),accessToken:'fixture-token',
    env:key=>key==='ERP_SYNC_DROP_FOLDERS_JSON'?JSON.stringify(folders):''});
  assert.equal(result.ok,true);
  assert.equal(result.stageResults.find(row=>row.key==='drive').outcome,'processed');
  assert.equal(result.stageResults.find(row=>row.key==='hl_po_parsed').outcome,'UP_TO_DATE');
  assert.ok(calls.indexOf('fast_commit_erp_stage_swap_v1') < calls.indexOf('archive'));
  assert.equal(calls.filter(name=>name==='fast_begin_erp_stage_v1').length,1);
  assert.deepEqual(status.filter(patch=>patch.currentStage).map(patch=>patch.currentStage),
    ['drive','drive','drive','drive','cav','reserves','soc','hl_po_parsed','idle']);
  assert.equal(result.stageResults.length,5);
});

test('unchanged file is archived without download or duplicate stage writes', async () => {
  const calls=[];
  const fakeFetch=async(input,init={})=>{
    const url=new URL(input);
    if(url.pathname.endsWith('/files')){
      const query=url.searchParams.get('q');
      assert.doesNotMatch(query,/name contains/);
      assert.match(query,/application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
      assert.match(query,/text\/csv/);
      assert.match(query,/application\/octet-stream/);
      const folder=url.searchParams.get('q').match(/'([^']+)'/)[1];
      return Response.json({files:folder==='drive-folder'
        ? [{id:'file-1',name:'Drive.csv',modifiedTime:'2026-10-27T00:00:00Z',parents:['drive-folder']}]
        : folder==='drive-processed' ? [] : []});
    }
    if(url.pathname.endsWith('/files/file-1')){calls.push('archive');return Response.json({id:'file-1'});}
    throw new Error('unchanged source must not be downloaded');
  };
  const supabase={rpc:async(name)=>{
    calls.push(name);
    if(name==='check_erp_file_sync_needed_v1')return {data:{skip:true}};
    throw new Error(`unexpected RPC ${name}`);
  }};
  const folders={drive:'drive-folder',cav:'cav-folder',reserves:'reserves-folder',soc:'soc-folder',hl_po_parsed:'hl-folder',
    processed:{drive:'drive-processed'}};
  const result=await runErpSyncWorker({supabase,fetcher:fakeFetch,status:async()=>{},accessToken:'fixture-token',env:key=>key==='ERP_SYNC_DROP_FOLDERS_JSON'?JSON.stringify(folders):''});
  assert.equal(result.ok,true);
  assert.equal(result.stageResults.find(row=>row.key==='drive').outcome,'UP_TO_DATE');
  assert.equal(calls.filter(name=>name==='check_erp_file_sync_needed_v1').length,1);
  assert.equal(calls.includes('fast_begin_erp_stage_v1'),false);
  assert.ok(calls.includes('archive'));
});

test('stage read failure continues sequentially and ends IDLE with a visible error', async () => {
  const statuses=[];
  const fakeFetch=async(input)=>{
    const url=new URL(input);
    const folder=url.searchParams.get('q').match(/'([^']+)'/)[1];
    if(folder==='drive-folder')return Response.json({error:'fixture'}, {status:503});
    return Response.json({files:[]});
  };
  const folders={drive:'drive-folder',cav:'cav-folder',reserves:'reserves-folder',soc:'soc-folder',hl_po_parsed:'hl-folder'};
  const result=await runErpSyncWorker({supabase:{rpc:async()=>{throw new Error('no source means no SQL RPC');}},fetcher:fakeFetch,
    status:async patch=>statuses.push(patch),accessToken:'fixture-token',env:key=>key==='ERP_SYNC_DROP_FOLDERS_JSON'?JSON.stringify(folders):''});
  const final=statuses.at(-1);
  assert.equal(result.ok,false);
  assert.deepEqual(statuses.filter(patch=>patch.currentStage).map(patch=>patch.currentStage),
    ['drive','cav','reserves','soc','hl_po_parsed','idle']);
  assert.equal(final.active,false);
  assert.equal(final.status,'failed');
  assert.equal(final.currentStage,'idle');
  assert.equal(final.errorCode,'ERP_SYNC_STAGE_FAILED');
  assert.equal(final.stageResults.length,5);
});

test('cloud continuation processes at most one source file per invocation and resumes without re-import', async () => {
  const files=[
    {id:'file-1',name:'Drive 1.csv',modifiedTime:'2026-10-27T00:00:00Z',parents:['drive-folder']},
    {id:'file-2',name:'Drive 2.csv',modifiedTime:'2026-10-27T00:01:00Z',parents:['drive-folder']},
  ];
  const archived=[], begins=[],listed=[];
  const fakeFetch=async(input,init={})=>{
    const url=new URL(input);
    if(url.pathname.endsWith('/files')){
      const folder=url.searchParams.get('q').match(/'([^']+)'/)[1];
      listed.push(folder);
      return Response.json({files:folder==='drive-folder'?files.filter(file=>!archived.includes(file.id))
        :folder==='processed-folder'?files.filter(file=>archived.includes(file.id)):[]});
    }
    if(url.pathname.endsWith('/files/file-1')||url.pathname.endsWith('/files/file-2')){
      const id=url.pathname.split('/').at(-1);
      if(init.method==='PATCH'){archived.push(id);return Response.json({id,parents:['processed-folder']});}
      return new Response('itemcode,commonname,ptravailable\n004380.010.1,Blue Dart Grass,1\n');
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const supabase={rpc:async(name,args)=>{
    if(name==='check_erp_file_sync_needed_v1')return {data:{skip:false}};
    if(name==='fast_erp_import_columns_v1')return {data:['unique_id','itemcode','commonname','ptravailable']};
    if(name==='fast_begin_erp_stage_v1'){begins.push(args.p_file_meta.file_id);return {data:{stage_id:`stage-${args.p_file_meta.file_id}`,expected_rows:1,staged_rows:0}};}
    if(name==='fast_append_erp_stage_batch_v1')return {data:{staged_rows:args.p_start_row+args.p_rows.length}};
    if(name==='fast_commit_erp_stage_swap_v1')return {data:{ok:true}};
    throw new Error(`unexpected RPC ${name}`);
  }};
  const folders={drive:'drive-folder',cav:'cav-folder',reserves:'reserves-folder',soc:'soc-folder',hl_po_parsed:'hl-folder',
    processed:{drive:'processed-folder'}};
  const env=key=>key==='ERP_SYNC_DROP_FOLDERS_JSON'?JSON.stringify(folders):'';
  const first=await runErpSyncWorkerStep({supabase,fetcher:fakeFetch,status:async()=>{},env,accessToken:'fixture-token'});
  assert.equal(first.done,false);
  assert.deepEqual(archived,['file-1']);
  const second=await runErpSyncWorkerStep({supabase,fetcher:fakeFetch,status:async()=>{},env,accessToken:'fixture-token',cursor:first.cursor});
  assert.equal(second.done,false);
  assert.deepEqual(archived,['file-1','file-2']);
  const final=await runErpSyncWorkerStep({supabase,fetcher:fakeFetch,status:async()=>{},env,accessToken:'fixture-token',cursor:second.cursor});
  assert.equal(final.done,true);
  assert.deepEqual(begins,['file-1','file-2']);
  assert.equal(final.cursor.stageResults.filter(row=>row.outcome==='processed').length,2);
  const emptyHl=final.cursor.stageResults.find(row=>row.key==='hl_po_parsed');
  assert.equal(emptyHl.outcome,'UP_TO_DATE');
  assert.ok(Number.isFinite(emptyHl.durationMs)&&emptyHl.durationMs>=0);
  assert.ok(Number.isFinite(emptyHl.listDurationMs)&&emptyHl.listDurationMs>=0);
  assert.deepEqual([...new Set(listed)].sort(),['cav-folder','drive-folder','hl-folder','reserves-folder','soc-folder'].sort());
  assert.equal(listed.length,5);
});

test('cloud CSV import stages all 5,200 rows before retrying a failed Processed move without recommit', async () => {
  const rows=Array.from({length:5200},(_,index)=>`item-${index},Plant ${index},1`).join('\n');
  const csv=`itemcode,commonname,ptravailable\n${rows}\n`;
  let committed=0, appended=0, moveAttempts=0, archived=false;
  const fakeFetch=async(input,init={})=>{
    const url=new URL(input);
    if(url.pathname.endsWith('/files')) {
      const folder=url.searchParams.get('q').match(/'([^']+)'/)[1];
      return Response.json({files:folder==='drive-folder'&&!archived?[{id:'large-file',name:'Drive Large.csv',modifiedTime:'2026-10-28T12:00:00Z',parents:['drive-folder']}]:[]});
    }
    if(url.pathname.endsWith('/files/large-file')) {
      if(init.method==='PATCH') {
        moveAttempts+=1;
        assert.equal(url.searchParams.get('addParents'),'processed-folder');
        assert.equal(url.searchParams.get('removeParents'),'drive-folder');
        assert.equal(url.searchParams.get('supportsAllDrives'),'true');
        if(moveAttempts===1)return Response.json({error:'temporary'}, {status:503});
        archived=true;return Response.json({id:'large-file',parents:['processed-folder']});
      }
      return new Response(csv);
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const supabase={rpc:async(name,args)=>{
    if(name==='check_erp_file_sync_needed_v1')return {data:{skip:false}};
    if(name==='fast_erp_import_columns_v1')return {data:['unique_id','itemcode','commonname','ptravailable']};
    if(name==='fast_begin_erp_stage_v1')return {data:{stage_id:'large-stage',expected_rows:5200,staged_rows:0}};
    if(name==='fast_append_erp_stage_batch_v1'){assert.ok(args.p_rows.length<=5000);appended+=args.p_rows.length;return {data:{staged_rows:args.p_start_row+args.p_rows.length}};}
    if(name==='fast_commit_erp_stage_swap_v1'){committed+=1;return {data:{ok:true}};}
    throw new Error(`unexpected RPC ${name}`);
  }};
  const folders={drive:'drive-folder',cav:'cav-folder',reserves:'reserves-folder',soc:'soc-folder',hl_po_parsed:'hl-folder',processed:{drive:'processed-folder'}};
  const env=key=>key==='ERP_SYNC_DROP_FOLDERS_JSON'?JSON.stringify(folders):'';
  const run=cursor=>runErpSyncWorkerStep({supabase,fetcher:fakeFetch,status:async()=>{},env,accessToken:'fixture-token',cursor});
  const first=await run();
  assert.equal(first.cursor.fileContinuation.state.phase,'move');
  assert.equal(appended,5200);
  const second=await run(first.cursor);
  assert.equal(committed,1);
  assert.equal(moveAttempts,2);
  assert.equal(archived,true);
  assert.equal(second.cursor.stageResults[0].rowCount,5200);
});

test('a failed source is attempted once, then the next continuation advances to the next stage', async () => {
  const archived=[],listed=[];
  const fakeFetch=async(input,init={})=>{
    const url=new URL(input);
    if(url.pathname.endsWith('/files')){
      const folder=url.searchParams.get('q').match(/'([^']+)'/)[1];listed.push(folder);
      const files=folder==='drive-folder'&&!archived.includes('bad-drive')
        ?[{id:'bad-drive',name:'broken.csv',modifiedTime:'2026-10-28T12:00:00Z',parents:['drive-folder']}]
        :folder==='cav-folder'&&!archived.includes('good-cav')
        ?[{id:'good-cav',name:'valid.csv',modifiedTime:'2026-10-28T12:01:00Z',parents:['cav-folder']}]:[];
      return Response.json({files});
    }
    if(url.pathname.endsWith('/files/good-cav')){
      if(init.method==='PATCH'){archived.push('good-cav');return Response.json({id:'good-cav'});}
      return new Response('itemcode,commonname,brandcode\n001,Blue Grass,B1\n');
    }
    throw new Error(`unexpected Drive call ${url}`);
  };
  const begins=[];
  const supabase={rpc:async(name,args)=>{
    if(name==='check_erp_file_sync_needed_v1'){
      if(args.p_file_id==='bad-drive')throw new Error('ERP_DRIVE_TEMPORARY_503');
      return {data:{skip:false}};
    }
    if(name==='fast_erp_import_columns_v1')return {data:['unique_id','itemcode','commonname','brand_code']};
    if(name==='fast_begin_erp_stage_v1'){begins.push(args.p_file_meta.file_id);return {data:{stage_id:'cav-stage',expected_rows:1,staged_rows:0}};}
    if(name==='fast_append_erp_stage_batch_v1')return {data:{staged_rows:args.p_start_row+args.p_rows.length}};
    if(name==='fast_commit_erp_stage_swap_v1')return {data:{ok:true}};
    throw new Error(`unexpected RPC ${name}`);
  }};
  const folders={drive:'drive-folder',cav:'cav-folder',reserves:'reserves-folder',soc:'soc-folder',hl_po_parsed:'hl-folder',
    processed:{drive:'drive-processed',cav:'cav-processed'}};
  const env=key=>key==='ERP_SYNC_DROP_FOLDERS_JSON'?JSON.stringify(folders):'';
  const run=cursor=>runErpSyncWorkerStep({supabase,fetcher:fakeFetch,status:async()=>{},env,accessToken:'fixture-token',cursor});
  const first=await run();
  assert.equal(first.cursor.stageResults[0].outcome,'failed');
  assert.deepEqual(first.cursor.attemptedByStage.drive,['bad-drive']);
  const second=await run(first.cursor);
  assert.deepEqual(begins,['good-cav']);
  assert.deepEqual(archived,['good-cav']);
  assert.ok(listed.includes('cav-folder'));
  assert.equal(second.cursor.stageIndex,1);
  assert.equal(second.cursor.stageResults.filter(result=>result.sourceFileName==='broken.csv').length,1);
});

test('continuation cursor advances before stage I/O so expired-lease retries cannot regress stage index', async () => {
  const statuses=[];
  const fakeFetch=async(input)=>Response.json({files:[]});
  const folders={drive:'drive-folder',cav:'cav-folder',reserves:'reserves-folder',soc:'soc-folder',hl_po_parsed:'hl-folder'};
  const env=key=>key==='ERP_SYNC_DROP_FOLDERS_JSON'?JSON.stringify(folders):'';
  const cursor={stageIndex:3,stageResults:[{key:'drive',outcome:'UP_TO_DATE'},{key:'cav',outcome:'UP_TO_DATE'},
    {key:'reserves',outcome:'UP_TO_DATE'}],attemptedByStage:{drive:[],cav:[],reserves:[]}};
  const result=await runErpSyncWorkerStep({supabase:{rpc:async()=>{throw new Error('empty stages must not write SQL');}},
    fetcher:fakeFetch,status:async patch=>statuses.push(patch),env,accessToken:'fixture-token',cursor});
  const resumedSoc=statuses.find(patch=>patch.currentStage==='soc');
  assert.equal(resumedSoc.stageIndex,3);
  assert.equal(resumedSoc.continuationCursor.stageIndex,3);
  assert.equal(result.done,true);
  assert.equal(result.cursor.stageResults.find(row=>row.key==='soc').outcome,'UP_TO_DATE');
});

test('folder snapshot persistence preserves an in-flight row offset before resumed file I/O', async () => {
  const statuses=[];
  const folderSnapshot=Object.fromEntries(['drive','cav','reserves','soc','hl_po_parsed'].map(key=>[key,{files:[],listDurationMs:0}]));
  const file={id:'resume-file',name:'Resume.xlsx',modifiedTime:'2026-10-28T12:00:00Z',parents:['drive-folder']};
  const cursor={stageIndex:0,stageResults:[],attemptedByStage:{},folderSnapshot,fileContinuation:{stageIndex:0,file,
    state:{stageId:'stage-resume',expectedRows:50000,expectedRowsPending:true,nextOffset:12000,processedRows:8000,
      identityCounts:{},headerRowIndex:1,header:['itemcode']}}};
  const folders={drive:'drive-folder',cav:'cav-folder',reserves:'reserves-folder',soc:'soc-folder',hl_po_parsed:'hl-folder'};
  const env=key=>key==='ERP_SYNC_DROP_FOLDERS_JSON'?JSON.stringify(folders):'';
  const supabase={rpc:async name=>name==='check_erp_file_sync_needed_v1'?{data:{skip:false}}:{data:null}};
  await assert.rejects(runErpSyncWorkerStep({supabase,fetcher:async()=>{throw new Error('fixture download fault');},
    status:async patch=>statuses.push(patch),env,accessToken:'fixture-token',cursor}),/fixture download fault/);
  const first=JSON.parse(JSON.stringify(statuses[0].continuationCursor));
  assert.equal(first.stageIndex,0);
  assert.equal(first.fileContinuation.state.nextOffset,12000);
  assert.equal(first.fileContinuation.state.processedRows,8000);
});

test('cloud waitUntil self-chaining completes every stage after the browser leaves and shares the request lease', async () => {
  const { verifyCloudErpChaining } = await import('./helpers/erp-cloud-chain.mjs');
  await verifyCloudErpChaining(await readFile(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8'));
});

test('release semver orders three-digit patches numerically and ignores older remote releases', async () => {
  const vm = await import('node:vm');
  const source = await readFile(new URL('../assets/app-lifecycle.js', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('    const normalizeAgDataVersion ='), source.indexOf('    const isAuthTransitionActive ='));
  const context = vm.createContext({ root: {} });
  vm.runInContext(code, context);
  const compare = context.root.compareAgDataVersions;
  assert.equal(compare('AgData v2.3.100', '2.3.99'), 1);
  assert.equal(compare('2.3.99', '2.3.100'), -1);
  assert.equal(compare('2.3.100', 'v2.3.100'), 0);
  assert.equal(compare('2.10.0', '2.9.999'), 1);
  assert.match(source, /compareAgDataVersions\(target, current\) <= 0/);
});

// These focused suites execute the download-count and deferred-hydration behaviors
// as part of the requested ERP integration target too.
await import('./erp-sync-staging.test.mjs');
await import('./erp-sync-ui-completion.test.mjs');

test('cloud continuation retries a failed lease release and recovers after a busy lease expires', async () => {
  const { verifyCloudErpChaining } = await import('./helpers/erp-cloud-chain.mjs');
  const source = await readFile(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
  assert.equal((await verifyCloudErpChaining(source, { releaseFailures: 1 })).waits, 0);
  assert.equal((await verifyCloudErpChaining(source, { releaseFailures: 2 })).waits, 1);
});
