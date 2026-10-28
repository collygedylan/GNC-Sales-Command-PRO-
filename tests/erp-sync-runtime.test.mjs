import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { isLegacyRunScriptAction, normalizeErpRows, parseErpCsv, parseErpXlsx, runErpSyncWorker, runErpSyncWorkerStep, shouldIgnoreErpFile, validateErpSyncCommand } from '../supabase/functions/_shared/erp-sync.mjs';

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
  assert.deepEqual(validateErpSyncCommand({action:'erp_sync',operation:'start',commandId,force:true,maxAttemptsPerStage:1}),
    {ok:true,operation:'start',commandId});
  assert.deepEqual(validateErpSyncCommand({action:'erp_sync',operation:'status'}),{ok:true,operation:'status'});
  for (const payload of [
    {action:'erp_sync',operation:'start',commandId,force:true,maxAttemptsPerStage:2},
    {action:'erp_sync',operation:'start',commandId,force:true,maxAttemptsPerStage:1,actor:'megan_kelly'},
    {action:'erp_sync',operation:'status',force:true},
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
  assert.match(handler,/claim_erp_sync_job_v1[^]*return jsonResponse\(\{ ok: true, data: initial \}\)/);
  assert.doesNotMatch(handler,/runErpSyncWorker|EdgeRuntime\.waitUntil/);
  assert.ok(handler.indexOf('operation === "status"') < handler.indexOf('claim_erp_sync_job_v1'));
  const worker = source.slice(source.indexOf('const ERP_SYNC_WORKER_OPERATIONS'),source.indexOf('if (import.meta.main) serve'));
  assert.match(worker,/authorization !== `Bearer \$\{ERP_SYNC_LOCAL_WORKER_KEY\}`/);
  assert.match(worker,/claim_erp_sync_worker_v1/);
  assert.match(worker,/assert_erp_sync_worker_v1/);
  assert.match(worker,/fast_commit_erp_stage_swap_v1/);
  assert.match(source,/action === "erp_sync_worker"\) \{\s*return errorResponse\("The local ERP worker is disabled\.", 410/);
  assert.match(handler,/queueCloudWorker\?\.\(initial\)/);
  assert.match(source,/handleErpSyncAction\(session, payload, activeProfileForRequest, dispatchCloudErpSync\)/);
  assert.match(source,/runtime\.waitUntil\(task\)/);
  assert.match(source,/claim_erp_sync_worker_step_v1[^]*p_step: step/);
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
});

test('live row mapping preserves canonical physical identities and CAV aliases', async () => {
  const driveInput = {warehouseid:'W1',itemcode:'004103.010.1',contsize:'#1',lotcode:'27.F1',locationcode:'C.15.000',source:'DriveAround'};
  const driveId = `drive-${createHash('sha256').update(JSON.stringify(['W1','004103.010.1','#1','27.F1','C.15.000','DriveAround','','',''])).digest('hex').slice(0,32)}`;
  const drive = await normalizeErpRows([driveInput],'drive_around',['unique_id','itemcode','contsize','lotcode','locationcode','source']);
  assert.equal(drive[0].values.unique_id,driveId);
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
    ['drive','drive','cav','reserves','soc','hl_po_parsed','idle']);
  assert.equal(result.stageResults.length,5);
});

test('unchanged file is archived without download or duplicate stage writes', async () => {
  const calls=[];
  const fakeFetch=async(input,init={})=>{
    const url=new URL(input);
    if(url.pathname.endsWith('/files')){
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
  const archived=[], begins=[];
  const fakeFetch=async(input,init={})=>{
    const url=new URL(input);
    if(url.pathname.endsWith('/files')){
      const folder=url.searchParams.get('q').match(/'([^']+)'/)[1];
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
});
