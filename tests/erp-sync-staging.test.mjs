import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import test from 'node:test';
import { compactErpRowsPreservingNullColumnUnion, parseErpXlsxImportRows, parseErpXlsxPage, resolveErpRowsPerSlice, runErpSyncWorkerStep } from '../supabase/functions/_shared/erp-sync.mjs';

function mockDriveMetadata(url,init){
  if(!url.pathname.match(/\/files\/[^/]+$/)||!url.searchParams.has('fields')||init?.method==='PATCH')return null;
  const id=decodeURIComponent(url.pathname.split('/').at(-1));
  return Response.json({id,parents:id==='resume-xlsx'?['soc-folder']:id==='soc-bounded'?['soc-folder','shared-folder']:['soc-folder']});
}

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

test('SOC selected-cell prefilter preserves shared-string and sparse-column decoding',async()=>{
  const bytes=makeZip({
    'xl/workbook.xml':'<workbook xmlns:r="urn:r"><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml':'<sst><si><t>itemcode</t></si><si><t>dock</t></si><si><t>suspend</t></si><si><t>006</t></si><si><t>D6</t></si><si><t>ignored extra</t></si></sst>',
    'xl/worksheets/sheet1.xml':'<worksheet><sheetData>'+
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="inlineStr"><is><t>extra</t></is></c></row>'+
      '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="D2" t="s"><v>5</v></c></row>'+
      '<row r="3"><c r="A3" t="s"><v>3</v></c><c r="D3" t="s"><v>5</v></c></row>'+
      '</sheetData></worksheet>',
  });
  const page=await parseErpXlsxPage(bytes,0,10,{dataset:'soc'});
  assert.deepEqual(page.rows.map(row=>[row.itemcode,row.dock,row.extra]),[['006','D6','ignored extra']]);
});

test('cloud SOC XLSX caps each continuation at the requested retry slice and removes every actual Drive parent',async()=>{
  const xmlRows=[inlineRow(1,['itemcode','dock'])];
  for(let index=1;index<=1601;index+=1)xmlRows.push(inlineRow(index+1,[String(index),`D${index}`]));
  const bytes=makeZip({
    'xl/workbook.xml':'<workbook xmlns:r="urn:r"><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':`<worksheet><sheetData>${xmlRows.join('')}</sheetData></worksheet>`,
  });
  assert.equal(resolveErpRowsPerSlice('soc'),1500);
  assert.equal(resolveErpRowsPerSlice('drive_around'),2500);
  assert.equal(resolveErpRowsPerSlice('soc',600),600);
  const appended=[];let archived=false;
  const file={id:'soc-bounded',name:'SOC.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    modifiedTime:'2026-10-28T12:00:00Z',parents:['soc-folder','shared-folder']};
  const fetcher=async(input,init={})=>{
    const url=new URL(input);
    const metadata=mockDriveMetadata(url,init);if(metadata)return metadata;
    if(url.pathname.endsWith('/files')&&init.method!=='POST'){
      const folder=url.searchParams.get('q').match(/'([^']+)'/)[1];
      return Response.json({files:folder==='soc-folder'&&!archived?[file]:[]});
    }
    if(url.pathname.endsWith('/files/soc-bounded')&&url.searchParams.get('alt')==='media')return new Response(bytes);
    if(url.pathname.endsWith('/files/soc-bounded')&&init.method==='PATCH'){
      assert.equal(url.searchParams.get('removeParents'),'soc-folder,shared-folder');archived=true;return Response.json({id:file.id});
    }
    if(url.pathname.endsWith('/files/soc-bounded')&&url.searchParams.has('fields'))return Response.json({id:file.id,parents:file.parents});
    throw new Error(`unexpected Drive request ${init.method||'GET'} ${url}`);
  };
  const supabase={rpc:async(name,args)=>{
    if(name==='check_erp_file_sync_needed_v1')return {data:{skip:false}};
    if(name==='fast_erp_import_columns_v1')return {data:['unique_id','itemcode','dock']};
    if(name==='fast_begin_erp_stage_v1')return {data:{stage_id:'soc-bounded-stage',expected_rows:50000,staged_rows:0}};
    if(name==='fast_append_erp_stage_batch_v1'){
      appended.push(args.p_rows.length);return {data:{staged_rows:args.p_start_row+args.p_rows.length}};
    }
    if(name==='fast_seal_erp_stage_v1')return {data:{ok:true}};
    if(name==='fast_commit_erp_stage_swap_v1')return {data:{ok:true}};
    throw new Error(`unexpected RPC ${name}`);
  }};
  const env=key=>key==='ERP_SYNC_DROP_FOLDERS_JSON'?JSON.stringify({drive:'drive-folder',cav:'cav-folder',reserves:'reserves-folder',
    soc:'soc-folder',processed:{soc:'processed-folder'}}):'';
  const run=cursor=>runErpSyncWorkerStep({supabase,fetcher,env,status:async()=>{},accessToken:'fixture-token',maxRowsPerSlice:600,cursor});
  const first=await run();
  assert.equal(first.done,false);assert.equal(first.cursor.fileContinuation.state.processedRows,600);
  const second=await run(first.cursor);
  assert.equal(second.done,false);assert.equal(second.cursor.fileContinuation.state.processedRows,1200);
  let final=await run(second.cursor);
  for(let attempt=0;!final.done&&attempt<3;attempt+=1)final=await run(final.cursor);
  assert.equal(final.done,true);assert.deepEqual(appended,[600,600,401]);assert.equal(archived,true);
  assert.equal(final.cursor.stageResults.find(result=>result.key==='soc').rowCount,1601);
});

test('streaming XLSX parser releases each bounded raw batch to its consumer', async()=>{
  const xmlRows=[inlineRow(1,['itemcode','dock'])];
  for(let index=1;index<=11;index+=1)xmlRows.push(inlineRow(index+1,[String(index),`D${index}`]));
  const bytes=makeZip({
    'xl/workbook.xml':'<workbook xmlns:r="urn:r"><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':`<worksheet><sheetData>${xmlRows.join('')}</sheetData></worksheet>`,
  });
  const batchSizes=[];
  const result=await parseErpXlsxImportRows(bytes,'reserves',{batchSize:5,onBatch:async batch=>batchSizes.push(batch.length)});
  assert.deepEqual(batchSizes,[5,5,1]);
  assert.equal(result.rowCount,11);
  assert.equal('rows' in result,false,'streaming callers receive only the final count, not an accumulated workbook array');
});

test('streaming parser emits 10,001 XLSX rows as bounded 5,000-row callbacks',async()=>{
  const xmlRows=[inlineRow(1,['itemcode','dock'])];
  for(let index=1;index<=10001;index+=1)xmlRows.push(inlineRow(index+1,[String(index),`D${index}`]));
  const bytes=makeZip({
    'xl/workbook.xml':'<workbook xmlns:r="urn:r"><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':`<worksheet><sheetData>${xmlRows.join('')}</sheetData></worksheet>`,
  });
  const batchSizes=[];
  const result=await parseErpXlsxImportRows(bytes,'reserves',{batchSize:5000,onBatch:async batch=>batchSizes.push(batch.length)});
  assert.deepEqual(batchSizes,[5000,5000,1]);
  assert.equal(result.rowCount,10001);
  assert.equal('rows' in result,false);
});

test('non-Drive null compaction preserves the full SQL source-column union and row values',()=>{
  const original=[
    {unique_id:'r1',itemcode:'001',blank_first:null,late_value:null},
    {unique_id:'r2',itemcode:'002',blank_first:null,late_value:'present',sparse:null},
    {unique_id:'r3',itemcode:'003',blank_first:'filled later',late_value:null,sparse:null},
  ];
  const expected=structuredClone(original),compacted=structuredClone(original),seen=new Set();
  compactErpRowsPreservingNullColumnUnion(compacted,seen);
  const union=rowSet=>new Set(rowSet.flatMap(row=>Object.keys(row)));
  const keys=[...union(expected)].sort();
  assert.deepEqual([...union(compacted)].sort(),keys);
  const expand=rowSet=>rowSet.map(row=>Object.fromEntries(keys.map(key=>[key,row[key]??null])));
  assert.deepEqual(expand(compacted),expand(expected));
  assert.ok(JSON.stringify(compacted).length<JSON.stringify(expected).length);
});

test('XLSX stage resumes the identical persisted prefix before appending its remaining rows',async()=>{
  const xmlRows=[inlineRow(1,['itemcode','dock'])];
  for(let index=1;index<=5;index+=1)xmlRows.push(inlineRow(index+1,[String(index),`D${index}`]));
  const bytes=makeZip({
    'xl/workbook.xml':'<workbook xmlns:r="urn:r"><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':`<worksheet><sheetData>${xmlRows.join('')}</sheetData></worksheet>`,
  });
  const appends=[];let downloads=0;
  const file={id:'resume-xlsx',name:'SOC.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    modifiedTime:'2026-10-28T12:00:00Z',parents:['soc-folder']};
  const fetcher=async(input,init={})=>{
    const url=new URL(input);
    const metadata=mockDriveMetadata(url,init);if(metadata)return metadata;
    if(url.pathname.endsWith('/files/resume-xlsx')&&url.searchParams.get('alt')==='media'){downloads+=1;return new Response(bytes);}
    if(url.pathname.endsWith('/files/resume-xlsx')&&init.method==='PATCH')return Response.json({id:file.id});
    throw new Error(`Unexpected Drive request: ${init.method||'GET'} ${url.pathname}`);
  };
  const supabase={rpc:async(name,args)=>{
    if(name==='check_erp_file_sync_needed_v1')return {data:{skip:false},error:null};
    if(name==='fast_erp_import_columns_v1')return {data:['unique_id','itemcode','dock'],error:null};
    if(name==='fast_begin_erp_stage_v1')return {data:{stage_id:'resume-stage',expected_rows:50000,staged_rows:2},error:null};
    if(name==='fast_append_erp_stage_batch_v1'){
      appends.push({start:args.p_start_row,count:args.p_rows.length});
      return {data:{staged_rows:args.p_start_row+args.p_rows.length},error:null};
    }
    if(name==='fast_seal_erp_stage_v1')return {data:{ok:true},error:null};
    if(name==='fast_commit_erp_stage_swap_v1')return {data:{ok:true},error:null};
    throw new Error(`Unexpected RPC ${name}`);
  }};
  const result=await runErpSyncWorkerStep({supabase,fetcher,accessToken:'fixture-token',
    env:key=>key==='ERP_SYNC_DROP_FOLDERS_JSON'?JSON.stringify({drive:'drive-folder',cav:'cav-folder',reserves:'reserves-folder',soc:'soc-folder',hl_po_parsed:'hl-folder',processed:{soc:'processed-folder'}}):'',
    status:async()=>{},cursor:{stageIndex:3,stageResults:[],attemptedByStage:{},folderSnapshot:{drive:{files:[]},cav:{files:[]},reserves:{files:[]},soc:{files:[file]}}}});
  assert.equal(downloads,1);
  assert.deepEqual(appends,[{start:2,count:3}], 'the committed prefix is trusted by the content-fingerprinted stage and is not retransmitted');
  assert.equal(result.cursor.fileContinuation,undefined);
});

test('new SOC XLSX stage appends at most 1,500 rows per continuation and publishes once', async()=>{
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
    const metadata=mockDriveMetadata(url,init);if(metadata)return metadata;
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
  const env=name=>({
    ERP_SYNC_DROP_FOLDERS_JSON:JSON.stringify({drive:'drive-folder',cav:'cav-folder',reserves:'reserves-folder',soc:'soc-folder',hl_po_parsed:'hl-folder',processed:{soc:'processed-folder'}}),
  })[name];
  const run=cursor=>runErpSyncWorkerStep({supabase,fetcher,accessToken:'fixture-token',env,status:async update=>status.push(update),cursor});
  let result=await run({stageIndex:3,stageResults:[],attemptedByStage:{},folderSnapshot:{
    drive:{files:[]},cav:{files:[]},reserves:{files:[]},soc:{files:[file]},
  }});
  while(!result.done&&result.cursor.fileContinuation)result=await run(result.cursor);
  assert.ok(downloads>1,'each bounded page revalidates the source file');
  assert.equal(archived,true);
  const appendCalls=calls.filter(call=>call.name==='fast_append_erp_stage_batch_v1');
  assert.equal(appendCalls.reduce((sum,call)=>sum+call.args.p_rows.length,0),10001);
  assert.ok(appendCalls.every(call=>call.args.p_rows.length<=1500));
  assert.ok(appendCalls.length>3);
  assert.equal(calls.filter(call=>call.name==='fast_seal_erp_stage_v1').length,1);
  assert.equal(calls.filter(call=>call.name==='fast_commit_erp_stage_swap_v1').length,1);
  assert.equal(result.cursor.fileContinuation,undefined,'a completed file needs no browser-driven page continuation');
  assert.ok(status.filter(update=>update.stageResultsDelta?.key==='soc').length>=2,'progress is persisted after every batch');
});
