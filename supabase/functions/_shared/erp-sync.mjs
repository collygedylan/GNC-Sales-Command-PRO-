const STAGES = [
  { key: 'drive', dataset: 'drive_around' },
  { key: 'cav', dataset: 'cav' },
  { key: 'reserves', dataset: 'reserves' },
  { key: 'soc', dataset: 'soc' },
  { key: 'hl_po_parsed', dataset: 'hl_po_parsed' },
];
const BATCH_SIZE = 1000;
const RAW_DRIVE_FIELDS = new Set(['locationnote','locationptn1','desigitem','desigcust','desigloc',
  'pullerresponsibility','oversellpercentage','salesnote','suspend']);

export function shouldIgnoreErpFile(name) {
  return /^(?:temp_|~\$)/i.test(String(name || ''));
}

export function isLegacyRunScriptAction(action) {
  return ['manual_run','manual_continue','manual_status'].includes(String(action || '').trim().toLowerCase());
}

export function normalizeErpHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function recordsToObjects(records) {
  const headerIndex = records.findIndex(row => row.some(value => normalizeErpHeader(value) === 'itemcode'));
  if (headerIndex < 0) throw new Error('ERP_SOURCE_HEADER_MISSING');
  const headers = records[headerIndex].map((value,index) => normalizeErpHeader(value) || `column${index+1}`);
  return records.slice(headerIndex+1).filter(row => row.some(value => String(value).trim() !== ''))
    .map(row => Object.fromEntries(headers.map((header,index) => [header,row[index] ?? ''])));
}

export function validateErpSyncCommand(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok:false, code:'ERP_SYNC_REQUEST_INVALID' };
  const operation = String(payload.operation || '').trim().toLowerCase();
  if (operation === 'status') {
    return Object.keys(payload).every(key => ['action','operation'].includes(key))
      ? { ok:true, operation } : { ok:false, code:'ERP_SYNC_REQUEST_INVALID' };
  }
  const commandId = String(payload.commandId || '').trim();
  const validKeys = Object.keys(payload).every(key => ['action','operation','commandId','force','maxAttemptsPerStage'].includes(key));
  const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(commandId);
  return operation === 'start' && validKeys && validId && payload.force === true && payload.maxAttemptsPerStage === 1
    ? { ok:true, operation, commandId }
    : { ok:false, code:'ERP_SYNC_REQUEST_INVALID' };
}

export function parseErpCsv(text) {
  const records = [];
  let row = [], value = '', quoted = false;
  const source = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { value += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(value); value = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(value); value = '';
      if (row.some(cell => String(cell).trim() !== '')) records.push(row);
      row = [];
    } else value += char;
  }
  if (quoted) throw new Error('ERP_CSV_QUOTE_UNCLOSED');
  row.push(value);
  if (row.some(cell => String(cell).trim() !== '')) records.push(row);
  if (records.length < 2) throw new Error('ERP_SOURCE_EMPTY');
  return recordsToObjects(records);
}

function xmlText(value) {
  return String(value || '').replace(/&#x([0-9a-f]+);/gi,(_match,code)=>String.fromCodePoint(parseInt(code,16)))
    .replace(/&#([0-9]+);/g,(_match,code)=>String.fromCodePoint(parseInt(code,10)))
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"')
    .replace(/&apos;/g,"'").replace(/&amp;/g,'&');
}

function zipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0) throw new Error('ERP_XLSX_DIRECTORY_MISSING');
  const count = view.getUint16(end + 10, true), directoryOffset = view.getUint32(end + 16, true);
  const entries = new Map();
  let cursor = directoryOffset;
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('ERP_XLSX_DIRECTORY_INVALID');
    const method = view.getUint16(cursor + 10, true), compressed = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true), extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true), localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    entries.set(name, { method, compressed, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return { entries, view, bytes };
}

async function zipText(zip, name) {
  const entry = zip.entries.get(name);
  if (!entry) return '';
  const view = zip.view, local = entry.localOffset;
  if (view.getUint32(local, true) !== 0x04034b50) throw new Error('ERP_XLSX_ENTRY_INVALID');
  const nameLength = view.getUint16(local + 26, true), extraLength = view.getUint16(local + 28, true);
  const start = local + 30 + nameLength + extraLength;
  const compressed = zip.bytes.subarray(start, start + entry.compressed);
  let payload;
  if (entry.method === 0) payload = compressed;
  else if (entry.method === 8) {
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    payload = new Uint8Array(await new Response(stream).arrayBuffer());
  } else throw new Error('ERP_XLSX_COMPRESSION_UNSUPPORTED');
  return new TextDecoder().decode(payload);
}

export async function parseErpXlsx(bytesLike) {
  const bytes = bytesLike instanceof Uint8Array ? bytesLike : new Uint8Array(bytesLike);
  const zip = zipEntries(bytes);
  const sharedXml = await zipText(zip, 'xl/sharedStrings.xml');
  const shared = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(match =>
    [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(part => xmlText(part[1])).join(''));
  const workbook = await zipText(zip, 'xl/workbook.xml');
  const rels = await zipText(zip, 'xl/_rels/workbook.xml.rels');
  const firstSheet = workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"/);
  if (!firstSheet) throw new Error('ERP_XLSX_SHEET_MISSING');
  const relationship = [...rels.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)].find(match =>
    new RegExp(`\\bId="${firstSheet[1].replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}"`).test(match[1]));
  const target = relationship?.[1].match(/\bTarget="([^"]+)"/)?.[1];
  if (!target) throw new Error('ERP_XLSX_SHEET_RELATIONSHIP_MISSING');
  const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//,'')}`;
  const sheet = await zipText(zip, sheetPath);
  const rows = [];
  for (const rowMatch of sheet.matchAll(/<row\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/row>)/g)) {
    const cells = [];
    const rowContent = rowMatch[2] || '';
    for (const cellMatch of rowContent.matchAll(/<c\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/c>)/g)) {
      const ref = cellMatch[1].match(/\br="([A-Z]+)\d+"/i)?.[1] || '';
      let column = 0;
      for (const char of ref.toUpperCase()) column = column * 26 + char.charCodeAt(0) - 64;
      const type = cellMatch[1].match(/\bt="([^"]+)"/)?.[1];
      const content = cellMatch[2] || '';
      const raw = content.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
      const inline = [...content.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(match => xmlText(match[1])).join('');
      let value = raw === undefined ? inline : xmlText(raw);
      if (type === 's') value = shared[Number(value)] ?? '';
      cells[column - 1] = value;
    }
    rows.push(cells.map(value => value ?? ''));
  }
  if (rows.length < 2) throw new Error('ERP_SOURCE_EMPTY');
  return recordsToObjects(rows);
}

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim().replaceAll("\\'", "'");
  return !text || text.toUpperCase() === 'NULL' ? null : text;
}
function first(row, ...names) {
  for (const name of names) {
    const value = clean(row[normalizeErpHeader(name)]);
    if (value !== null) return value;
  }
  return '';
}
async function identity(dataset, row, index) {
  const columns = dataset === 'soc'
    ? [['dock'],['transactionnumber'],['tagcode'],['stopnumber'],['itemcode'],['locationcode'],['lotcode'],['quantityshipped','quantityordered'],['consigneename'],['customername'],['contsize','printedcontainercode'],['source'],['priority'],['desigitem']]
    : dataset === 'reserves'
    ? [['transactionnumber'],['customername'],['consigneename'],['salesrepname'],['itemcode'],['contsize','printedcontainercode'],['locationcode'],['lotcode'],['source'],['priority'],['desigitem']]
    : dataset === 'cav' ? [['item','itemcode'],['productdescription','commonname'],['brandcode'],['size','contsize'],['season']]
    : [['warehouseid'],['itemcode'],['contsize','printedcontainercode'],['lotcode'],['locationcode'],['source'],['desigitem'],['desigcust'],['desigloc']];
  const values = columns.map(names => first(row,...names));
  if (dataset === 'drive_around') {
    const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(values)));
    return `drive-${[...new Uint8Array(digest)].slice(0,16).map(value=>value.toString(16).padStart(2,'0')).join('')}`;
  }
  return values.join('-').replace(/[^a-zA-Z0-9-]/g, '_') || `${dataset}-${index}`;
}
export async function normalizeErpRows(rawRows, dataset, columns) {
  const rows = [], counts = new Map();
  const columnsByNormalized = new Map(columns.map(column => [normalizeErpHeader(column),column]));
  for (const raw of rawRows) {
    if (!first(raw, 'itemcode', 'item')) continue;
    if (dataset === 'soc' && !(first(raw,'dock') || first(raw,'suspend').toUpperCase() === 'SUSPEND'
      && first(raw,'suspend-to','suspend_to','suspendto').toLowerCase() === 'dc')) continue;
    const row = {};
    for (const [key,value] of Object.entries(raw)) {
      const target = columnsByNormalized.get(key);
      if (target) row[target] = clean(value);
    }
    if (dataset === 'cav') {
      const aliases = { itemcode:['itemcode','item'], commonname:['commonname','productdescription'],
        contsize:['contsize','size'], ptravailable:['ptravailable','available'], brand:['brand','brandcode'],
        unitprice:['unitprice'], holdstopreason:['holdstopreason','holdreasonnotescomment','holdreasonnotescomments'],
        ordertotal:['ordertotal','extitemtotal'],product_description:['productdescription'],brand_code:['brandcode'],
        reserved_qty:['reservedqty'],order_qty:['orderqty'],unit_price:['unitprice'],hot_price:['hotprice'],
        hold_reason:['holdreasonnotescomment','holdreasonnotescomments'],ext_item_total:['extitemtotal'] };
      for (const [target,names] of Object.entries(aliases)) {
        const column = columns.includes(target) ? target : columnsByNormalized.get(normalizeErpHeader(target));
        if (column) row[column] = first(raw,...names) || null;
      }
    }
    const idColumn = columnsByNormalized.get('uniqueid');
    const base = first(raw,'unique_id','uniqueid') || await identity(dataset,raw,rows.length);
    const duplicate = counts.get(base) || 0;
    counts.set(base, duplicate + 1);
    if (idColumn) row[idColumn] = duplicate ? `${base}-${duplicate}` : base;
    if (dataset === 'drive_around') {
      rows.push({ values: row, rawFields: Object.keys(row).filter(key => RAW_DRIVE_FIELDS.has(normalizeErpHeader(key))) });
    } else rows.push(row);
  }
  if (!rows.length || rows.length > 50000) throw new Error('ERP_ROWS_INVALID');
  return rows;
}

function driveUrl(path, params) {
  const url = new URL(`https://www.googleapis.com/drive/v3/${path}`);
  for (const [key,value] of Object.entries(params)) url.searchParams.set(key,String(value));
  return url;
}
async function driveJson(fetcher, token, path, params = {}, method = 'GET', body) {
  const response = await fetcher(driveUrl(path,params), {method,
    headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
    ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(30000)});
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`ERP_DRIVE_API_${response.status}`);
  return result;
}
async function listFiles(fetcher, token, folderId) {
  const files = [];
  let pageToken = '';
  const seenTokens = new Set();
  for (let page = 0; page < 100; page += 1) {
    const result = await driveJson(fetcher,token,'files',{q:`'${folderId}' in parents and trashed=false`,
      fields:'nextPageToken,files(id,name,mimeType,modifiedTime,size,parents)',pageSize:1000,
      supportsAllDrives:true,includeItemsFromAllDrives:true,...(pageToken ? {pageToken} : {})});
    files.push(...(Array.isArray(result.files) ? result.files : []));
    pageToken = String(result.nextPageToken || '');
    if (!pageToken) return files;
    if (seenTokens.has(pageToken)) throw new Error('ERP_DRIVE_PAGINATION_REPEATED');
    seenTokens.add(pageToken);
  }
  if (pageToken) throw new Error('ERP_DRIVE_PAGINATION_LIMIT');
  return files;
}
async function processedFolder(fetcher, token, parentId, configuredId = '') {
  if (configuredId) return configuredId;
  const children = await listFiles(fetcher,token,parentId);
  const existing = children.find(file => file.mimeType === 'application/vnd.google-apps.folder'
    && String(file.name || '').trim().toLowerCase() === 'processed');
  if (existing) return existing.id;
  const created = await driveJson(fetcher,token,'files',{fields:'id'},'POST',{
    name:'Processed',mimeType:'application/vnd.google-apps.folder',parents:[parentId],
  });
  return created.id;
}
async function moveProcessed(fetcher, token, file, parentId, configuredId = '') {
  const destination = await processedFolder(fetcher,token,parentId,configuredId);
  await driveJson(fetcher,token,`files/${encodeURIComponent(file.id)}`,{
    addParents:destination,removeParents:(file.parents || [parentId]).join(','),fields:'id,parents',supportsAllDrives:true,
  },'PATCH');
}

async function sourceBytes(fetcher, token, file) {
  const response = await fetcher(driveUrl(`files/${encodeURIComponent(file.id)}`,{alt:'media',supportsAllDrives:true}),{
    headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(60000)});
  if (!response.ok) throw new Error(`ERP_DRIVE_DOWNLOAD_${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
function hashHex(bytes) {
  return crypto.subtle.digest('SHA-256',bytes).then(hash => [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join(''));
}

async function stageFile({supabase,fetcher,token,file,dataset,stageKey,parentId,processedId,status}) {
  const meta = {file_id:file.id,file_name:file.name,modified_at:file.modifiedTime || new Date().toISOString()};
  const {data:check,error:checkError} = await supabase.rpc('check_erp_file_sync_needed_v1',{
    p_dataset_key:dataset,p_file_id:file.id,p_file_name:file.name,p_modified_at:meta.modified_at,p_content_hash:file.md5Checksum || null,
  });
  if (checkError) throw checkError;
  if (check?.skip === true) {
    await moveProcessed(fetcher,token,file,parentId,processedId);
    return {key:dataset,outcome:'UP_TO_DATE',sourceFileName:file.name,processedFiles:1};
  }
  const bytes = await sourceBytes(fetcher,token,file);
  meta.content_hash = await hashHex(bytes);
  const raw = /\.csv$/i.test(file.name) ? parseErpCsv(new TextDecoder('utf-8').decode(bytes)) : await parseErpXlsx(bytes);
  const table = ({drive_around:'ph_master_inventory',cav:'ph_cav_import',reserves:'ph_reserves',soc:'ph_soc_master'})[dataset];
  if (!table) throw new Error(dataset === 'hl_po_parsed' ? 'HL_PO_ORIGINAL_PDF_REQUIRED' : 'ERP_DATASET_INVALID');
  const {data:columns,error:columnsError} = await supabase.rpc('fast_erp_import_columns_v1',{p_dataset_key:dataset});
  if (columnsError || !Array.isArray(columns) || !columns.length) throw columnsError || new Error('ERP_COLUMNS_UNAVAILABLE');
  const rows = await normalizeErpRows(raw,dataset,columns);
  const {data:begin,error:beginError} = await supabase.rpc('fast_begin_erp_stage_v1',{
    p_dataset_key:dataset,p_file_meta:meta,p_expected_rows:rows.length,
  });
  if (beginError) throw beginError;
  if (begin?.skipped === true) {
    await moveProcessed(fetcher,token,file,parentId,processedId);
    return {key:dataset,outcome:'UP_TO_DATE',sourceFileName:file.name,processedFiles:1};
  }
  const stageId = String(begin?.stage_id || '');
  if (!stageId || Number(begin.expected_rows) !== rows.length) throw new Error('ERP_STAGE_BEGIN_UNCONFIRMED');
  for (let offset = Number(begin.staged_rows) || 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset,offset+BATCH_SIZE);
    const {data,error} = await supabase.rpc('fast_append_erp_stage_batch_v1',{
      p_stage_id:stageId,p_start_row:offset,p_rows:batch,
    });
    if (error || Number(data?.staged_rows) !== offset+batch.length) throw error || new Error('ERP_STAGE_BATCH_UNCONFIRMED');
    await status({currentStage:stageKey,stageIndex:STAGES.findIndex(stage=>stage.key===stageKey),
      stageResultsDelta:{key:stageKey,stagedRows:offset+batch.length,expectedRows:rows.length}});
  }
  const {data:committed,error:commitError} = await supabase.rpc('fast_commit_erp_stage_swap_v1',{p_stage_id:stageId});
  if (commitError || committed?.ok !== true) throw commitError || new Error('ERP_STAGE_COMMIT_UNCONFIRMED');
  await moveProcessed(fetcher,token,file,parentId,processedId);
  return {key:dataset,outcome:'processed',sourceFileName:file.name,processedFiles:1,rowCount:rows.length};
}

export async function runErpSyncWorker({supabase,env,fetcher=fetch,status,accessToken}) {
  const foldersRaw = env('ERP_SYNC_DROP_FOLDERS_JSON');
  if (!foldersRaw || !accessToken) throw new Error('ERP_SYNC_CREDENTIALS_NOT_CONFIGURED');
  const folders = JSON.parse(foldersRaw);
  const token = String(accessToken);
  const stageResults = [];
  for (let index=0; index<STAGES.length; index+=1) {
    const stage = STAGES[index];
    const folderId = String(folders[stage.key] || '').trim();
    const processedId = String(folders.processed?.[stage.key] || folders[`${stage.key}_processed`] || '').trim();
    if (!folderId) {
      stageResults.push({key:stage.key,outcome:'failed',sourceFileName:'',processedFiles:0,error:'ERP_DROP_FOLDER_ID_MISSING'});
      continue;
    }
    await status({currentStage:stage.key,stageIndex:index});
    let files;
    try {
      files = (await listFiles(fetcher,token,folderId)).filter(file =>
        file.mimeType !== 'application/vnd.google-apps.folder' && !shouldIgnoreErpFile(file.name)
        && /\.(?:xlsx|csv)$/i.test(file.name)).sort((a,b)=>String(a.modifiedTime||'').localeCompare(String(b.modifiedTime||'')));
    } catch (error) {
      stageResults.push({key:stage.key,outcome:'failed',sourceFileName:'',processedFiles:0,
        error:String(error?.message || 'ERP_DROP_FOLDER_READ_FAILED').slice(0,200)});
      continue;
    }
    if (stage.dataset === 'hl_po_parsed' && files.length) {
      stageResults.push({key:stage.key,outcome:'requires_template',sourceFileName:files[0].name,processedFiles:0,
        error:'HL_PO_WORKBOOK_CONTRACT_UNCONFIRMED'});
      continue;
    }
    for (const file of files) {
      try {
        const result = await stageFile({supabase,fetcher,token,file,dataset:stage.dataset,stageKey:stage.key,parentId:folderId,processedId,status});
        stageResults.push({...result,key:stage.key,dataset:stage.dataset});
        await status({stageResults:stageResults.slice(),lastCompletedFile:file.name});
      } catch (error) {
        stageResults.push({key:stage.key,dataset:stage.dataset,outcome:'failed',sourceFileName:file.name,
          processedFiles:0,error:String(error?.message || 'ERP_FILE_IMPORT_FAILED').slice(0,200)});
        await status({stageResults:stageResults.slice(),failedFile:file.name});
      }
    }
    if (!files.length) stageResults.push({key:stage.key,outcome:'UP_TO_DATE',sourceFileName:'',processedFiles:0});
  }
  const blocked = stageResults.some(result=>result.outcome==='requires_template');
  const failed = stageResults.some(result=>result.outcome==='failed');
  await status({active:false,status:blocked?'blocked':failed?'failed':'complete',currentStage:'idle',currentStageLabel:'Idle',
    stageIndex:STAGES.length,stageResults,finishedAt:new Date().toISOString(),
    message:blocked?'HL ORDER workbook contract requires confirmation.':failed?'One or more ERP files could not be imported.':'ERP sync completed.',
    error:blocked?'HL ORDER workbook contract requires confirmation.':failed?'One or more ERP files could not be imported.':'',
    errorCode:blocked?'ERP_SYNC_REQUIRES_TEMPLATE':failed?'ERP_SYNC_STAGE_FAILED':''});
  return {ok:!blocked && !failed,stageResults};
}

export async function runErpSyncWorkerStep({supabase,env,fetcher=fetch,status,cursor={},accessToken}) {
  const foldersRaw = env('ERP_SYNC_DROP_FOLDERS_JSON');
  if (!foldersRaw || !accessToken) throw new Error('ERP_SYNC_CREDENTIALS_NOT_CONFIGURED');
  const folders = JSON.parse(foldersRaw), token = String(accessToken);
  const stageResults = Array.isArray(cursor.stageResults) ? cursor.stageResults.slice() : [];
  const attemptedByStage = cursor.attemptedByStage && typeof cursor.attemptedByStage === 'object' ? {...cursor.attemptedByStage} : {};
  let stageIndex = Math.max(0,Math.min(STAGES.length,Number(cursor.stageIndex)||0));
  while (stageIndex < STAGES.length) {
    const stage = STAGES[stageIndex], folderId = String(folders[stage.key]||'').trim();
    const processedId = String(folders.processed?.[stage.key]||folders[`${stage.key}_processed`]||'').trim();
    if (!folderId) {
      stageResults.push({key:stage.key,outcome:'failed',sourceFileName:'',processedFiles:0,error:'ERP_DROP_FOLDER_ID_MISSING'});
      stageIndex += 1; continue;
    }
    await status({currentStage:stage.key,stageIndex});
    let files;
    try {
      files = (await listFiles(fetcher,token,folderId)).filter(file => file.mimeType !== 'application/vnd.google-apps.folder'
        && !shouldIgnoreErpFile(file.name) && /\.(?:xlsx|csv)$/i.test(file.name))
        .sort((a,b)=>String(a.modifiedTime||'').localeCompare(String(b.modifiedTime||'')));
    } catch (error) {
      stageResults.push({key:stage.key,outcome:'failed',sourceFileName:'',processedFiles:0,
        error:String(error?.message||'ERP_DROP_FOLDER_READ_FAILED').slice(0,200)});
      stageIndex += 1; continue;
    }
    if (stage.dataset === 'hl_po_parsed' && files.length) {
      stageResults.push({key:stage.key,outcome:'requires_template',sourceFileName:files[0].name,processedFiles:0,
        error:'HL_PO_WORKBOOK_CONTRACT_UNCONFIRMED'});
      stageIndex += 1; continue;
    }
    const attempted = new Set(Array.isArray(attemptedByStage[stage.key]) ? attemptedByStage[stage.key] : []);
    const file = files.find(candidate => !attempted.has(String(candidate.id||'')));
    if (!file) {
      if (!stageResults.some(result=>result.key===stage.key)) stageResults.push({key:stage.key,outcome:'UP_TO_DATE',sourceFileName:'',processedFiles:0});
      stageIndex += 1; continue;
    }
    attempted.add(String(file.id||'')); attemptedByStage[stage.key] = [...attempted];
    try {
      const result = await stageFile({supabase,fetcher,token,file,dataset:stage.dataset,stageKey:stage.key,parentId:folderId,processedId,status});
      stageResults.push({...result,key:stage.key,dataset:stage.dataset});
    } catch (error) {
      stageResults.push({key:stage.key,dataset:stage.dataset,outcome:'failed',sourceFileName:file.name,processedFiles:0,
        error:String(error?.message||'ERP_FILE_IMPORT_FAILED').slice(0,200)});
    }
    const nextCursor = {stageIndex,stageResults,attemptedByStage};
    await status({currentStage:stage.key,stageIndex,stageResults:stageResults.slice(),continuationCursor:nextCursor,lastCompletedFile:file.name});
    return {done:false,cursor:nextCursor};
  }
  const blocked = stageResults.some(result=>result.outcome==='requires_template'), failed = stageResults.some(result=>result.outcome==='failed');
  await status({active:false,status:blocked?'blocked':failed?'failed':'complete',currentStage:'idle',currentStageLabel:'Idle',
    stageIndex:STAGES.length,stageResults,continuationCursor:{stageIndex:STAGES.length,stageResults,attemptedByStage},
    finishedAt:new Date().toISOString(),message:blocked?'HL ORDER workbook contract requires confirmation.':failed?'One or more ERP files could not be imported.':'ERP sync completed.',
    error:blocked?'HL ORDER workbook contract requires confirmation.':failed?'One or more ERP files could not be imported.':'',
    errorCode:blocked?'ERP_SYNC_REQUIRES_TEMPLATE':failed?'ERP_SYNC_STAGE_FAILED':''});
  return {done:true,ok:!blocked&&!failed,cursor:{stageIndex:STAGES.length,stageResults,attemptedByStage}};
}

export { STAGES as ERP_SYNC_STAGES };
