const STAGES = [
  { key: 'drive', dataset: 'drive_around' },
  { key: 'cav', dataset: 'cav' },
  { key: 'reserves', dataset: 'reserves' },
  { key: 'soc', dataset: 'soc' },
];

export function isOperationalErpSyncComplete(status = {}) {
  return ['drive','cav','reserves','soc','hl_po_parsed'].every(key => {
    const progress = status.sourceProgress?.[key === 'hl_po_parsed' ? 'hl_po_parsed' : key] || {};
    const result = (status.stageResults || []).filter(row => row.key === key && (!progress.fileName || !row.sourceFileName || row.sourceFileName === progress.fileName)).at(-1);
    return !progress.error && result?.outcome !== 'failed' && (Number(progress.percent) === 100 || ['UP_TO_DATE','processed','imported'].includes(result?.outcome));
  });
}
const BATCH_SIZE = 5000;
const ERP_ROWS_PER_CONTINUATION = 5000;
const ERP_SLICE_BUDGET_MS = 700;
const ERP_SLICE_ROWS_DEFAULT = Object.freeze({drive_around:1500,cav:1500,reserves:1500,soc:1500});
const RAW_DRIVE_FIELDS = new Set(['locationnote','locationptn1','desigitem','desigcust','desigloc',
  'pullerresponsibility','oversellpercentage','salesnote','suspend']);

export function shouldIgnoreErpFile(name) {
  return /^(?:temp_|~\$)/i.test(String(name || ''));
}

export function resolveErpRowsPerSlice(dataset, requestedRows) {
  const maximum = ERP_SLICE_ROWS_DEFAULT[String(dataset || '').trim().toLowerCase()] || 1500;
  const numeric = Number(requestedRows);
  if (!Number.isFinite(numeric) || numeric <= 0) return maximum;
  return Math.max(600, Math.min(maximum, Math.floor(numeric)));
}

export function isLegacyRunScriptAction(action) {
  return ['manual_run','manual_continue','manual_status'].includes(String(action || '').trim().toLowerCase());
}

export function normalizeErpHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function validSocDock(value) {
  const dock=String(value||'').trim();
  return Boolean(dock)&&!['nan','null','none','0'].includes(dock.toLowerCase());
}
function firstSocDock(row) {
  for(const name of ['dock','docknumber','tripnumber']){const value=first(row,name);if(validSocDock(value))return value;}
  return '';
}
function hasImportableSocDock(row) {
  return validSocDock(firstSocDock(row));
}
function isImportableSocRow(row) {
  return Boolean(first(row,'itemcode','item'))&&(hasImportableSocDock(row)
    ||first(row,'suspend').toUpperCase()==='SUSPEND');
}

function recordsToObjects(records, keepEmpty = false, dataset = '') {
  const headerIndex = records.findIndex(row => {
    const names=row.map(normalizeErpHeader);
    return names.includes('itemcode') || (dataset==='cav' && names.includes('item')
      && ['productdescription','brandcode','size','season','available'].every(name=>names.includes(name)));
  });
  if (headerIndex < 0) throw new Error('ERP_SOURCE_HEADER_MISSING');
  const headers = records[headerIndex].map((value,index) => normalizeErpHeader(value) || `column${index+1}`);
  return records.slice(headerIndex+1).filter(row => keepEmpty || row.some(value => String(value).trim() !== ''))
    .map(row => Object.fromEntries(headers.map((header,index) => [header,row[index] ?? ''])));
}

export function validateErpSyncCommand(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok:false, code:'ERP_SYNC_REQUEST_INVALID' };
  const operation = String(payload.operation || '').trim().toLowerCase();
  const validSliceSize=payload.maxRowsPerSlice===undefined
    || (Number.isSafeInteger(payload.maxRowsPerSlice)&&payload.maxRowsPerSlice>=600&&payload.maxRowsPerSlice<=2500);
  if (operation === 'status') {
    return (payload.autoRelay === undefined || typeof payload.autoRelay === 'boolean')
      && Object.keys(payload).every(key => ['action','operation','autoRelay'].includes(key))
      ? { ok:true, operation } : { ok:false, code:'ERP_SYNC_REQUEST_INVALID' };
  }
  if (operation === 'continue') {
    const runId=String(payload.runId||'').trim();
    return validSliceSize&&Object.keys(payload).every(key=>['action','operation','runId','maxRowsPerSlice'].includes(key))
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)
      ? {ok:true,operation,runId,...(payload.maxRowsPerSlice===undefined?{}:{maxRowsPerSlice:payload.maxRowsPerSlice})} : {ok:false,code:'ERP_SYNC_REQUEST_INVALID'};
  }
  const commandId = String(payload.commandId || '').trim();
  const validKeys = validSliceSize&&Object.keys(payload).every(key => ['action','operation','commandId','force','forceRestart','maxAttemptsPerStage','maxRowsPerSlice'].includes(key));
  const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(commandId);
  return operation === 'start' && validKeys && validId && payload.force === true && payload.forceRestart === true && payload.maxAttemptsPerStage === 1
    ? { ok:true, operation, commandId,...(payload.maxRowsPerSlice===undefined?{}:{maxRowsPerSlice:payload.maxRowsPerSlice}) }
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
  const text=String(value||'');
  if(!text.includes('&'))return text;
  return text.replace(/&#x([0-9a-f]+);/gi,(_match,code)=>String.fromCodePoint(parseInt(code,16)))
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

export function createBoundedByteStream(bytesLike, chunkSize=16*1024) {
  const bytes=bytesLike instanceof Uint8Array?bytesLike:new Uint8Array(bytesLike);
  const size=Math.max(1024,Math.min(64*1024,Math.floor(Number(chunkSize)||16*1024)));
  let offset=0;
  return new ReadableStream({pull(controller){
    if(offset>=bytes.length){controller.close();return;}
    const end=Math.min(bytes.length,offset+size);
    controller.enqueue(bytes.subarray(offset,end));
    offset=end;
  }});
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
    const stream = createBoundedByteStream(compressed).pipeThrough(new DecompressionStream('deflate-raw'));
    payload = new Uint8Array(await new Response(stream).arrayBuffer());
  } else throw new Error('ERP_XLSX_COMPRESSION_UNSUPPORTED');
  return new TextDecoder().decode(payload).replace(/<(\/?)[A-Za-z_][\w.-]*:/g,'<$1');
}

async function parseXlsxSheetRows(zip, sheetPath, shared) {
  const sheet = await zipText(zip, sheetPath), rows = [];
  for (const rowMatch of sheet.matchAll(/<row\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/row>)/g)) {
    const cells = [], rowContent = rowMatch[2] || '';
    for (const cellMatch of rowContent.matchAll(/<c\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/c>)/g)) {
      const ref = cellMatch[1].match(/\br="([A-Z]+)\d+"/i)?.[1] || '';
      let column = 0;
      for (const char of ref.toUpperCase()) column = column * 26 + char.charCodeAt(0) - 64;
      const type = cellMatch[1].match(/\bt="([^"]+)"/)?.[1], content = cellMatch[2] || '';
      const raw = content.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
      const inline = [...content.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(match => xmlText(match[1])).join('');
      let value = raw === undefined ? inline : xmlText(raw);
      if (type === 's') value = shared[Number(value)] ?? '';
      cells[column - 1] = value;
    }
    rows.push(cells.map(value => value ?? ''));
  }
  return rows;
}

export async function parseErpXlsxSheets(bytesLike) {
  const bytes = bytesLike instanceof Uint8Array ? bytesLike : new Uint8Array(bytesLike);
  const zip = zipEntries(bytes);
  const sharedXml = await zipText(zip, 'xl/sharedStrings.xml');
  const shared = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(match =>
    [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(part => xmlText(part[1])).join(''));
  const workbook = await zipText(zip, 'xl/workbook.xml');
  const rels = await zipText(zip, 'xl/_rels/workbook.xml.rels');
  const relations = new Map([...rels.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)].map(match => {
    const id = match[1].match(/\bId="([^"]+)"/)?.[1], target = match[1].match(/\bTarget="([^"]+)"/)?.[1];
    return [id, target];
  }));
  const sheets = [];
  for (const match of workbook.matchAll(/<sheet\b([^>]*)\/?\s*>/g)) {
    const name = match[1].match(/\bname="([^"]+)"/)?.[1] || 'Sheet1';
    const id = match[1].match(/\br:id="([^"]+)"/)?.[1], target = relations.get(id);
    if (!target) throw new Error('ERP_XLSX_SHEET_RELATIONSHIP_MISSING');
    const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//,'')}`;
    sheets.push({name, rows: await parseXlsxSheetRows(zip, sheetPath, shared)});
  }
  if (!sheets.length) throw new Error('ERP_XLSX_SHEET_MISSING');
  return sheets;
}

export async function parseErpXlsx(bytesLike) {
  const sheets = await parseErpXlsxSheets(bytesLike), rows = sheets[0]?.rows || [];
  if (rows.length < 2) throw new Error('ERP_SOURCE_EMPTY');
  return recordsToObjects(rows);
}

function sharedValue(shared,index) {
  return shared instanceof Map?shared.get(index)??'':shared[index]??'';
}

const selectedCellPatternCache=new WeakMap();
function xlsxColumnLetters(value){
  let index=Number(value),letters='';
  while(index>0){const remainder=(index-1)%26;letters=String.fromCharCode(65+remainder)+letters;index=Math.floor((index-1)/26);}
  return letters;
}
function selectedCellPattern(wantedColumns){
  let pattern=selectedCellPatternCache.get(wantedColumns);
  if(pattern)return pattern;
  const columns=[...wantedColumns].map(xlsxColumnLetters).filter(Boolean).sort((left,right)=>right.length-left.length||left.localeCompare(right));
  const refs=columns.map(value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
  pattern=refs?new RegExp(`<c\\b(?=[^>]*?\\br="(?:${refs})\\d+"[^>]*>)([^>]*?)(?:/\\s*>|>([\\s\\S]*?)<\\/c>)`,'gi'):/\b(?!)/g;
  selectedCellPatternCache.set(wantedColumns,pattern);
  return pattern;
}

function parseXlsxRowXml(rowXml, shared) {
  const opening=rowXml.match(/^<row\b([^>]*)>/)?.[1]||'';
  const rowNumber=Number(opening.match(/\br="(\d+)"/)?.[1]||0);
  const cells=[];
  const content=rowXml.slice(rowXml.indexOf('>')+1).replace(/<\/row>\s*$/,'');
  for (const cellMatch of content.matchAll(/<c\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/c>)/g)) {
    const ref=cellMatch[1].match(/\br="([A-Z]+)\d+"/i)?.[1]||'';
    let column=0; for(const char of ref.toUpperCase())column=column*26+char.charCodeAt(0)-64;
    if(!column)continue;
    const type=cellMatch[1].match(/\bt="([^"]+)"/)?.[1], cellContent=cellMatch[2]||'';
    const raw=cellContent.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
    let value;
    if(raw!==undefined){const decoded=xmlText(raw);value=type==='s'?sharedValue(shared,Number(decoded)):decoded;}
    else value=[...cellContent.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(match=>xmlText(match[1])).join('');
    cells[column-1]=value;
  }
  return {rowNumber,cells:cells.map(value=>value??'')};
}

function parseXlsxSelectedCells(rowXml,shared,wantedColumns) {
  const result=new Map();
  const content=rowXml.slice(rowXml.indexOf('>')+1).replace(/<\/row>\s*$/,'');
  for(const cellMatch of content.matchAll(selectedCellPattern(wantedColumns))){
    const ref=cellMatch[1].match(/\br="([A-Z]+)\d+"/i)?.[1]||'';let column=0;
    for(const char of ref.toUpperCase())column=column*26+char.charCodeAt(0)-64;
    if(!wantedColumns.has(column))continue;
    const type=cellMatch[1].match(/\bt="([^"]+)"/)?.[1],cellContent=cellMatch[2]||'';
    const raw=cellContent.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
    let value;
    if(raw!==undefined){const decoded=xmlText(raw);value=type==='s'?sharedValue(shared,Number(decoded)):decoded;}
    else value=[...cellContent.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(match=>xmlText(match[1])).join('');
    result.set(column,value);
  }
  return result;
}

async function xlsxSheetContext(bytesLike) {
  const bytes=bytesLike instanceof Uint8Array?bytesLike:new Uint8Array(bytesLike), zip=zipEntries(bytes);
  const workbook=await zipText(zip,'xl/workbook.xml'), rels=await zipText(zip,'xl/_rels/workbook.xml.rels');
  const firstSheet=workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"/);
  if(!firstSheet)throw new Error('ERP_XLSX_SHEET_MISSING');
  const relationship=[...rels.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)].find(match=>
    new RegExp(`\\bId="${firstSheet[1].replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}"`).test(match[1]));
  const target=relationship?.[1].match(/\bTarget="([^"]+)"/)?.[1];
  if(!target)throw new Error('ERP_XLSX_SHEET_RELATIONSHIP_MISSING');
  return {zip,sheetPath:target.startsWith('/')?target.slice(1):`xl/${target.replace(/^\.\//,'')}`};
}

async function visitXlsxRows(zip,sheetPath,visit,element='row',options={}) {
  const entry=zip.entries.get(sheetPath); if(!entry)throw new Error('ERP_XLSX_SHEET_MISSING');
  const view=zip.view, local=entry.localOffset;
  if(view.getUint32(local,true)!==0x04034b50)throw new Error('ERP_XLSX_ENTRY_INVALID');
  const nameLength=view.getUint16(local+26,true),extraLength=view.getUint16(local+28,true),start=local+30+nameLength+extraLength;
  const compressed=zip.bytes.subarray(start,start+entry.compressed);
  const source=createBoundedByteStream(compressed);
  const stream=entry.method===0?source:entry.method===8?source.pipeThrough(new DecompressionStream('deflate-raw')):null;
  if(!stream)throw new Error('ERP_XLSX_COMPRESSION_UNSUPPORTED');
  const reader=stream.getReader(),decoder=new TextDecoder(); let buffer='',index=0,stopped=false;
  const elementOpen=new RegExp('<((?:[A-Za-z_][\\w.-]*:)?'+element+')(?=[\\s/>])');
  const consume=async(final=false)=>{
    while(true){
      const opening=elementOpen.exec(buffer),token=opening?.[0]||'',closeToken=opening?`</${opening[1]}>`:'';
      const begin=opening?.index??-1;
      if(begin<0){const tail=buffer.lastIndexOf('<');buffer=final||tail<0?'':buffer.slice(tail);return;}
      if(begin>0)buffer=buffer.slice(begin);
      if(buffer.length>token.length&&!/[\s/>]/.test(buffer[token.length])){buffer=buffer.slice(token.length);continue;}
      const openEnd=buffer.indexOf('>'); if(openEnd<0)return;
      const open=buffer.slice(0,openEnd+1);
      let end;
      if(/\/\s*>$/.test(open))end=openEnd+1;
      else {const close=buffer.indexOf(closeToken,openEnd+1);if(close<0)return;end=close+closeToken.length;}
      const rowIndex=index++,rowEnd=end,range=options.range,onlyIndexes=options.onlyIndexes;
      if(range&&rowIndex<range.start){buffer=buffer.slice(rowEnd);continue;}
      if(range&&rowIndex>=range.end){stopped=true;return;}
      if(onlyIndexes&&!onlyIndexes.has(rowIndex)){buffer=buffer.slice(rowEnd);continue;}
      const rowXml=buffer.slice(0,rowEnd).replace(/<(\/?)[A-Za-z_][\w.-]*:/g,'<$1'); buffer=buffer.slice(rowEnd);
      if(await visit(rowXml,rowIndex)){stopped=true;return;}
    }
  };
  try {
    while(!stopped){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});await consume();}
    if(!stopped){buffer+=decoder.decode();await consume(true);}
  } finally {if(stopped)await reader.cancel().catch(()=>{});reader.releaseLock();}
  return index;
}

async function readXlsxRowsSlice(zip,sheetPath,start,count) {
  const rows=[];
  await visitXlsxRows(zip,sheetPath,async(rowXml)=>{rows.push(rowXml);return false;},'row',
    {range:{start:Math.max(0,start),end:Math.max(0,start)+Math.max(1,count)}});
  return rows;
}

function sharedStringIndexes(rowXmls,wantedColumns=null) {
  const indexes=new Set();
  for(const rowXml of rowXmls)for(const cell of rowXml.matchAll(/<c\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/c>)/g)){
    const ref=cell[1].match(/\br="([A-Z]+)\d+"/i)?.[1]||'';let column=0;
    for(const char of ref.toUpperCase())column=column*26+char.charCodeAt(0)-64;
    if(wantedColumns&&!wantedColumns.has(column))continue;
    if(cell[1].match(/\bt="([^"]+)"/)?.[1]!=='s')continue;
    const index=Number(cell[2]?.match(/<v\b[^>]*>(\d+)<\/v>/)?.[1]);
    if(Number.isSafeInteger(index)&&index>=0)indexes.add(index);
  }
  return indexes;
}

async function resolveSharedStrings(zip,indexes) {
  const result=new Map();
  if(!indexes.size||!zip.entries.has('xl/sharedStrings.xml'))return result;
  await visitXlsxRows(zip,'xl/sharedStrings.xml',async(siXml,index)=>{
    result.set(index,[...siXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(part=>xmlText(part[1])).join(''));
    return result.size===indexes.size;
  },'si',{onlyIndexes:indexes,range:{start:0,end:Math.max(...indexes)+1}});
  return result;
}

async function discoverXlsxHeader(zip,sheetPath,dataset='') {
  for(let base=0;base<50000;base+=256){
    const preamble=await readXlsxRowsSlice(zip,sheetPath,base,256);
    if(!preamble.length)break;
    const shared=await resolveSharedStrings(zip,sharedStringIndexes(preamble));
    for(let index=0;index<preamble.length;index+=1){
      const cells=parseXlsxRowXml(preamble[index],shared).cells;
      const names=cells.map(normalizeErpHeader);
      if(names.includes('itemcode') || (dataset==='cav' && names.includes('item')
        && ['productdescription','brandcode','size','season','available'].every(name=>names.includes(name)))) return {rowIndex:base+index,header:cells};
    }
    if(preamble.length<256)break;
  }
  throw new Error('ERP_SOURCE_HEADER_MISSING');
}

export async function parseErpXlsxPage(bytesLike,start=0,limit=ERP_ROWS_PER_CONTINUATION,checkpoint={}) {
  const {zip,sheetPath}=await xlsxSheetContext(bytesLike);
  const wantedStart=Math.max(0,Number(start)||0),pageSize=Math.max(1,Number(limit)||ERP_ROWS_PER_CONTINUATION);
  const headerRowIndex=Number.isSafeInteger(checkpoint.headerRowIndex)?checkpoint.headerRowIndex:null;
  const found=checkpoint.header&&Array.isArray(checkpoint.header)&&headerRowIndex!==null
    ?{rowIndex:headerRowIndex,header:checkpoint.header}:await discoverXlsxHeader(zip,sheetPath,String(checkpoint.dataset||''));
  const worksheetStart=found.rowIndex+1+wantedStart;
  const rawRows=await readXlsxRowsSlice(zip,sheetPath,worksheetStart,pageSize+1);
  const pageXml=rawRows.slice(0,pageSize),hasMore=rawRows.length>pageSize;
  let rows;
  if(checkpoint.dataset==='soc'){
    const headers=new Map(found.header.map((value,index)=>[normalizeErpHeader(value),index+1]));
    const wantedColumns=new Set(['itemcode','item','dock','docknumber','tripnumber','suspend','suspendto'].map(name=>headers.get(name)).filter(Boolean));
    const predicateShared=await resolveSharedStrings(zip,sharedStringIndexes(pageXml,wantedColumns));
    const get=(values,...names)=>{for(const name of names){const value=clean(values.get(headers.get(name))||'');if(value!==null)return value;}return '';};
    const eligible=pageXml.filter(rowXml=>{
      const values=parseXlsxSelectedCells(rowXml,predicateShared,wantedColumns);
      const dock=['dock','docknumber','tripnumber'].map(name=>get(values,name)).find(validSocDock)||'';
      return Boolean(get(values,'itemcode','item'))&&(validSocDock(dock)
        ||get(values,'suspend').toUpperCase()==='SUSPEND');
    });
    const shared=await resolveSharedStrings(zip,sharedStringIndexes(eligible));
    rows=eligible.map(rowXml=>parseXlsxRowXml(rowXml,shared).cells);
  } else {
    const shared=await resolveSharedStrings(zip,sharedStringIndexes(pageXml));
    rows=pageXml.map(rowXml=>parseXlsxRowXml(rowXml,shared).cells);
  }
  const objects=recordsToObjects([found.header,...rows],true,String(checkpoint.dataset||''));
  if(!objects.length&&wantedStart===0)throw new Error('ERP_SOURCE_EMPTY');
  return {rows:objects,nextOffset:wantedStart+pageXml.length,done:!hasMore,totalRows:!hasMore?wantedStart+pageXml.length:null,
    headerRowIndex:found.rowIndex,header:found.header};
}

export async function countImportableErpXlsxRows(bytesLike,dataset) {
  let offset=0,count=0,checkpoint={};
  while(true){
    const page=await parseErpXlsxPage(bytesLike,offset,ERP_ROWS_PER_CONTINUATION,checkpoint);
    count+=countImportableRows(page.rows,dataset);
    offset=page.nextOffset;checkpoint={headerRowIndex:page.headerRowIndex,header:page.header};
    if(page.done)break;
  }
  if(!count||count>50000)throw new Error('ERP_ROWS_INVALID');
  return count;
}

export async function parseErpXlsxImportRows(bytesLike,dataset,options={}) {
  const {zip,sheetPath}=await xlsxSheetContext(bytesLike);
  const sharedXml=await zipText(zip,'xl/sharedStrings.xml');
  const shared=[...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(match=>
    [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(part=>xmlText(part[1])).join(''));
  const onBatch=typeof options.onBatch==='function'?options.onBatch:null;
  const batchSize=Math.max(1,Math.min(10000,Math.floor(Number(options.batchSize)||BATCH_SIZE)));
  let headers=null,headerIndexes=null;
  const rows=[];let rawBatch=[],parsedRowCount=0;
  let wantedSocColumns=null;
  const flushBatch=async()=>{
    if(!rawBatch.length)return;
    const batch=rawBatch;rawBatch=[];
    await onBatch(batch,{parsedRows:parsedRowCount});
  };
  await visitXlsxRows(zip,sheetPath,async(rowXml)=>{
    if(!headers){
      const cells=parseXlsxRowXml(rowXml,shared).cells;
      const names=cells.map(normalizeErpHeader);
      if(names.includes('itemcode') || (dataset==='cav' && names.includes('item')
        && ['productdescription','brandcode','size','season','available'].every(name=>names.includes(name)))){
        headers=cells.map((value,index)=>normalizeErpHeader(value)||`column${index+1}`);
        headerIndexes=new Map(headers.map((header,index)=>[header,index+1]));
        if(dataset==='soc')wantedSocColumns=new Set(['itemcode','item','dock','docknumber','tripnumber','suspend','suspendto']
          .map(name=>headerIndexes.get(name)).filter(Boolean));
      }
      return false;
    }
    if(dataset==='soc'){
      const selected=parseXlsxSelectedCells(rowXml,shared,wantedSocColumns);
      const value=(...names)=>names.map(name=>clean(selected.get(headerIndexes.get(name)))).find(item=>item!==null)??'';
      const dock=['dock','docknumber','tripnumber'].map(name=>value(name)).find(validSocDock)||'';
      if(!value('itemcode','item')||(!validSocDock(dock)&&value('suspend').toUpperCase()!=='SUSPEND'))return false;
    }
    const cells=parseXlsxRowXml(rowXml,shared).cells;
    if(!cells.some(value=>String(value??'').trim()))return false;
    const raw=Object.fromEntries(headers.map((header,index)=>[header,cells[index]??'']));
    if(onBatch){
      rawBatch.push(raw);parsedRowCount+=1;
      if(parsedRowCount>50000)throw new Error('ERP_ROWS_INVALID');
      if(rawBatch.length>=batchSize)await flushBatch();
    }else{
      rows.push(raw);
      if(rows.length>50000)throw new Error('ERP_ROWS_INVALID');
    }
    return false;
  });
  if(!headers)throw new Error('ERP_SOURCE_HEADER_MISSING');
  if(onBatch){
    await flushBatch();
    if(!parsedRowCount)throw new Error('ERP_SOURCE_EMPTY');
    return {rowCount:parsedRowCount};
  }
  if(!rows.length)throw new Error('ERP_SOURCE_EMPTY');
  return rows;
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
export async function normalizeErpRowsChunk(rawRows, dataset, columns, options = {}) {
  const rows = [], counts = new Map(Object.entries(options.identityCounts || {}).map(([key,value]) => [key,Number(value)||0]));
  const columnsByNormalized = new Map(columns.map(column => [normalizeErpHeader(column),column]));
  const assignAlias=(row,raw,target,names)=>{
    const column=columnsByNormalized.get(normalizeErpHeader(target));
    if(column&&row[column]==null){const value=first(raw,...names);if(value)row[column]=value;}
  };
  const start = Math.max(0,Number(options.start)||0);
  const end = Math.min(rawRows.length,start+Math.max(1,Number(options.limit)||rawRows.length));
  let rowCount = Math.max(0,Number(options.priorRowCount)||0);
  for (let rawIndex=start; rawIndex<end; rawIndex+=1) {
    const raw = rawRows[rawIndex];
    if (!first(raw, 'itemcode', 'item')) continue;
    if (dataset==='cav' && Object.hasOwn(raw,'item') && Object.hasOwn(raw,'productdescription') && !first(raw,'productdescription')) continue;
    if (dataset === 'soc' && !isImportableSocRow(raw)) continue;
    const row = {};
    for (const [key,value] of Object.entries(raw)) {
      const target = columnsByNormalized.get(key);
      if (target) row[target] = clean(value);
    }
    if(dataset==='soc'){
      assignAlias(row,raw,'dock',['dock','docknumber','tripnumber']);
      assignAlias(row,raw,'dock_num',['dock_num','docknumber','dock','tripnumber']);
      assignAlias(row,raw,'stopnumber',['stopnumber','drop','stop']);
    }
    if(dataset==='drive_around'){
      assignAlias(row,raw,'holdstopcode',['holdstopcode','holdstop','stopcode']);
      assignAlias(row,raw,'holdstopbegindate',['holdstopbegindate','holdstopstartdate','holdstartdate','stopbegindate','holdbegindate']);
      assignAlias(row,raw,'holdstopreason',['holdstopreason','holdreason','holdreasonnotescomment','holdreasonnotescomments','stopreason']);
      assignAlias(row,raw,'locationnote',['locationnote','locnote','locationnotes']);
      assignAlias(row,raw,'locationnotedate',['locationnotedate','locnotedate','loc_note_date','locationnotedatetime']);
      assignAlias(row,raw,'locationptn1',['locationptn1','locptn1','ptn1']);
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
    const base = first(raw,'unique_id','uniqueid') || await identity(dataset,raw,rowCount);
    const duplicate = counts.get(base) || 0;
    counts.set(base, duplicate + 1);
    if (idColumn) row[idColumn] = duplicate ? `${base}-${duplicate}` : base;
    if (dataset === 'drive_around') {
      rows.push({ values: row, rawFields: Object.keys(row).filter(key => RAW_DRIVE_FIELDS.has(normalizeErpHeader(key))) });
    } else rows.push(row);
    rowCount += 1;
  }
  if (rowCount > 50000) throw new Error('ERP_ROWS_INVALID');
  return {rows,nextRawOffset:end,rowCount,identityCounts:Object.fromEntries(counts)};
}
export async function normalizeErpRows(rawRows, dataset, columns) {
  const result = await normalizeErpRowsChunk(rawRows,dataset,columns,{start:0,limit:rawRows.length});
  if (!result.rows.length || result.rows.length > 50000) throw new Error('ERP_ROWS_INVALID');
  return result.rows;
}

export function compactErpRowsPreservingNullColumnUnion(rows,seenColumns=new Set()) {
  if(!Array.isArray(rows)||!(seenColumns instanceof Set))throw new Error('ERP_ROW_COMPACTION_INPUT_INVALID');
  for(const row of rows){
    if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('ERP_ROW_COMPACTION_INPUT_INVALID');
    for(const [column,value] of Object.entries(row)){
      if(value===null&&seenColumns.has(column))delete row[column];
      else seenColumns.add(column);
    }
  }
  return rows;
}

function countImportableRows(rawRows,dataset) {
  return rawRows.reduce((count,row) => count + (Boolean(first(row,'itemcode','item'))
    && (dataset !== 'soc' || isImportableSocRow(row)) ? 1 : 0),0);
}

export function driveUrl(path, params) {
  const url = new URL(`https://www.googleapis.com/drive/v3/${path}`);
  for (const [key,value] of Object.entries(params)) url.searchParams.set(key,String(value));
  return url;
}
export async function driveJson(fetcher, token, path, params = {}, method = 'GET', body) {
  const response = await fetcher(driveUrl(path,params), {method,
    headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
    ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(30000)});
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`ERP_DRIVE_API_${response.status}`);
  return result;
}
export async function listFiles(fetcher, token, folderId, importableOnly = false) {
  const files = [];
  let pageToken = '';
  const seenTokens = new Set();
  for (let page = 0; page < 100; page += 1) {
    const filter = importableOnly ? " and (mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or mimeType='text/csv' or mimeType='application/csv' or mimeType='application/vnd.ms-excel' or mimeType='application/octet-stream')" : '';
    const result = await driveJson(fetcher,token,'files',{q:`'${folderId}' in parents and trashed=false${filter}`,
      fields:'nextPageToken,files(id,name,mimeType,modifiedTime,createdTime,size,md5Checksum,parents)',pageSize:1000,
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
export async function prefetchErpFolders(fetcher,token,folders,existing={}) {
  const snapshot={...existing};
  const pending=STAGES.filter(stage=>!snapshot[stage.key]);
  await Promise.all(pending.map(async stage=>{
    const folderId=String(folders[stage.key]||'').trim(),started=performance.now();
    if(!folderId){snapshot[stage.key]={files:[],listDurationMs:Math.max(0,Math.round(performance.now()-started)),error:'ERP_DROP_FOLDER_ID_MISSING'};return;}
    try {
      const files=await listFiles(fetcher,token,folderId,true);
      snapshot[stage.key]={files,listDurationMs:Math.max(0,Math.round(performance.now()-started)),fetchedAt:new Date().toISOString()};
    } catch(error) {
      snapshot[stage.key]={files:[],listDurationMs:Math.max(0,Math.round(performance.now()-started)),
        error:String(error?.message||'ERP_DROP_FOLDER_READ_FAILED').slice(0,200),fetchedAt:new Date().toISOString()};
    }
  }));
  return snapshot;
}
export async function processedFolder(fetcher, token, parentId, configuredId = '') {
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
export async function moveProcessed(fetcher, token, file, parentId, configuredId = '') {
  const destination = await processedFolder(fetcher,token,parentId,configuredId);
  const current = await driveJson(fetcher,token,`files/${encodeURIComponent(file.id)}`,{
    fields:'id,parents',supportsAllDrives:true,
  });
  const actualParents = Array.isArray(current?.parents) ? current.parents.map(value=>String(value||'').trim()).filter(Boolean) : [];
  if (!actualParents.length) throw new Error('ERP_DRIVE_SOURCE_PARENTS_UNAVAILABLE');
  await driveJson(fetcher,token,`files/${encodeURIComponent(file.id)}`,{
    addParents:destination,removeParents:actualParents.join(','),fields:'id,parents',supportsAllDrives:true,
  },'PATCH');
}

export async function sourceBytes(fetcher, token, file) {
  const response = await fetcher(driveUrl(`files/${encodeURIComponent(file.id)}`,{alt:'media',supportsAllDrives:true}),{
    headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(60000)});
  if (!response.ok) throw new Error(`ERP_DRIVE_DOWNLOAD_${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
export async function sourceWorkbookBytes(fetcher, token, file) {
  const nativeSheet=String(file?.mimeType||'')==='application/vnd.google-apps.spreadsheet';
  const url=nativeSheet
    ?driveUrl(`files/${encodeURIComponent(file.id)}/export`,{mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
    :driveUrl(`files/${encodeURIComponent(file.id)}`,{alt:'media',supportsAllDrives:true});
  const response=await fetcher(url,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw new Error(`ERP_HISTORY_DOWNLOAD_${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
function hashHex(bytes) {
  return crypto.subtle.digest('SHA-256',bytes).then(hash => [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join(''));
}

async function stageFile({supabase,fetcher,token,file,dataset,stageKey,parentId,processedId,status,continuation=false}) {
  const meta = {file_id:file.id,file_name:file.name,modified_at:file.modifiedTime || new Date().toISOString()};
  const {data:check,error:checkError} = await supabase.rpc('check_erp_file_sync_needed_v1',{
    p_dataset_key:dataset,p_file_id:file.id,p_file_name:file.name,p_modified_at:meta.modified_at,p_content_hash:null,
  });
  if (checkError) throw checkError;
  if (check?.skip === true) {
    try { await moveProcessed(fetcher,token,file,parentId,processedId); }
    catch (error) {
      if (continuation) return {done:false,state:{phase:'move',moveOutcome:'UP_TO_DATE',expectedRows:0,nextOffset:0,processedRows:0,identityCounts:{},moveAttempts:1}};
      throw error;
    }
    const result={key:dataset,outcome:'UP_TO_DATE',sourceFileName:file.name,processedFiles:1};
    return continuation?{done:true,result}:result;
  }
  const bytes = await sourceBytes(fetcher,token,file);
  meta.content_hash = await hashHex(bytes);
  const isXlsx=/\.xlsx$/i.test(file.name);
  const table = ({drive_around:'ph_master_inventory',cav:'ph_cav_import',reserves:'ph_reserves',soc:'ph_soc_master'})[dataset];
  if (!table) throw new Error(dataset === 'hl_po_parsed' ? 'HL_PO_ORIGINAL_PDF_REQUIRED' : 'ERP_DATASET_INVALID');
  const {data:columns,error:columnsError} = await supabase.rpc('fast_erp_import_columns_v1',{p_dataset_key:dataset});
  if (columnsError || !Array.isArray(columns) || !columns.length) throw columnsError || new Error('ERP_COLUMNS_UNAVAILABLE');
  let expectedRows=0,processedRows=0,identityCounts={},stageId='',alreadyStaged=0,stagedRows=0;
  const stageColumnsSeen=new Set();
  const beginStage=async(pExpectedRows,pending)=>{
    const {data,error}=await supabase.rpc('fast_begin_erp_stage_v1',{
      p_dataset_key:dataset,p_file_meta:{...meta,...(pending?{expected_rows_pending:true}:{})},p_expected_rows:pExpectedRows,
    });
    if(error)throw error;
    if(data?.skipped===true)return {skipped:true};
    const id=String(data?.stage_id||''),staged=Number(data?.staged_rows)||0;
    if(!id||Number(data?.expected_rows)!==pExpectedRows||staged>pExpectedRows)throw new Error('ERP_STAGE_BEGIN_UNCONFIRMED');
    return {stageId:id,stagedRows:staged};
  };
  let rows=null;
  if(!isXlsx){
    const raw=parseErpCsv(new TextDecoder('utf-8').decode(bytes));
    rows=await normalizeErpRows(raw,dataset,columns);
    expectedRows=rows.length;
  }
  const begin=await beginStage(isXlsx?50000:expectedRows,isXlsx);
  if(begin.skipped===true){
    try{await moveProcessed(fetcher,token,file,parentId,processedId);}
    catch(error){if(continuation)return {done:false,state:{phase:'move',moveOutcome:'UP_TO_DATE',expectedRows,nextOffset:0,processedRows:0,identityCounts:{},moveAttempts:1}};throw error;}
    const result={key:dataset,outcome:'UP_TO_DATE',sourceFileName:file.name,processedFiles:1};
    return continuation?{done:true,result}:result;
  }
  stageId=begin.stageId;alreadyStaged=begin.stagedRows;stagedRows=alreadyStaged;
  const appendNormalizedRows=async(batchRows,startRow)=>{
    let index=Math.min(batchRows.length,Math.max(0,alreadyStaged-startRow));
    while(index<batchRows.length){
      const absoluteStart=startRow+index;
      const length=Math.min(BATCH_SIZE,batchRows.length-index);
      const batch=batchRows.slice(index,index+length),endRow=absoluteStart+length;
      await status({currentStage:stageKey,stageIndex:STAGES.findIndex(stage=>stage.key===stageKey),
        stageResultsDelta:{key:stageKey,stagedRows,expectedRows:isXlsx?50000:expectedRows}});
      const {data,error}=await supabase.rpc('fast_append_erp_stage_batch_v1',{
        p_stage_id:stageId,p_start_row:absoluteStart,p_rows:batch,
      });
      const confirmed=Number(data?.staged_rows);
      if(error||confirmed!==endRow)throw error||new Error('ERP_STAGE_BATCH_UNCONFIRMED');
      stagedRows=Math.max(stagedRows,confirmed);
      await status({currentStage:stageKey,stageIndex:STAGES.findIndex(stage=>stage.key===stageKey),
        stageResultsDelta:{key:stageKey,stagedRows,expectedRows:isXlsx?50000:expectedRows}});
      index+=length;
    }
  };
  if(isXlsx){
    await parseErpXlsxImportRows(bytes,dataset,{batchSize:BATCH_SIZE,onBatch:async rawBatch=>{
      const startRow=processedRows;
      const chunk=await normalizeErpRowsChunk(rawBatch,dataset,columns,{start:0,limit:rawBatch.length,
        priorRowCount:processedRows,identityCounts});
      rawBatch.length=0;
      processedRows=chunk.rowCount;identityCounts=chunk.identityCounts;
      if(dataset!=='drive_around')compactErpRowsPreservingNullColumnUnion(chunk.rows,stageColumnsSeen);
      if(chunk.rows.length)await appendNormalizedRows(chunk.rows,startRow);
    }});
    expectedRows=processedRows;
  }else{
    await appendNormalizedRows(rows,0);
    processedRows=rows.length;
  }
  if(!expectedRows||expectedRows>50000||alreadyStaged>expectedRows||stagedRows!==expectedRows)throw new Error('ERP_STAGE_ROW_COUNT_MISMATCH');
  if(isXlsx){
    const {data:sealed,error:sealError}=await supabase.rpc('fast_seal_erp_stage_v1',{p_stage_id:stageId,p_expected_rows:expectedRows});
    if(sealError||sealed?.ok!==true)throw sealError||new Error('ERP_STAGE_SEAL_UNCONFIRMED');
  }
  await status({currentStage:stageKey,stageIndex:STAGES.findIndex(stage=>stage.key===stageKey),
    stageResultsDelta:{key:stageKey,stagedRows:expectedRows,expectedRows}});
  const {data:committed,error:commitError} = await supabase.rpc('fast_commit_erp_stage_swap_v1',{p_stage_id:stageId});
  if (commitError || committed?.ok !== true) throw commitError || new Error('ERP_STAGE_COMMIT_UNCONFIRMED');
  const result={key:dataset,outcome:'processed',sourceFileName:file.name,processedFiles:1,rowCount:expectedRows};
  try { await moveProcessed(fetcher,token,file,parentId,processedId); }
  catch (error) {
    if (continuation) return {done:false,state:{phase:'move',moveOutcome:'processed',expectedRows,nextOffset:expectedRows,
      processedRows:expectedRows,identityCounts:{},moveAttempts:1}};
    throw error;
  }
  return continuation?{done:true,result}:result;
}

async function finishStageContinuation({supabase,fetcher,token,file,dataset,parentId,processedId,next}) {
  let finalized=next;
  if (finalized.expectedRowsPending) {
    if(finalized.processedRows<1||finalized.processedRows>50000)throw new Error('ERP_ROWS_INVALID');
    const {data:sealed,error:sealError}=await supabase.rpc('fast_seal_erp_stage_v1',{
      p_stage_id:finalized.stageId,p_expected_rows:finalized.processedRows,
    });
    if(sealError||sealed?.ok!==true)throw sealError||new Error('ERP_STAGE_SEAL_UNCONFIRMED');
    finalized={...finalized,expectedRows:finalized.processedRows,expectedRowsPending:false};
  }
  if(finalized.processedRows!==finalized.expectedRows)throw new Error('ERP_STAGE_ROW_COUNT_MISMATCH');
  const {data:committed,error:commitError}=await supabase.rpc('fast_commit_erp_stage_swap_v1',{p_stage_id:finalized.stageId});
  if(commitError||committed?.ok!==true||finalized.expectedRows<1)throw commitError||new Error('ERP_STAGE_COMMIT_UNCONFIRMED');
  try {
    await moveProcessed(fetcher,token,file,parentId,processedId);
    return {done:true,result:{key:dataset,outcome:'processed',sourceFileName:file.name,processedFiles:1,rowCount:finalized.expectedRows}};
  } catch (_) { return {done:false,state:{...finalized,phase:'move',moveAttempts:1}}; }
}

export async function stageFileContinuation({supabase,fetcher,token,file,dataset,stageKey,parentId,processedId,status,state,
  maxRowsPerSlice=ERP_SLICE_ROWS_DEFAULT[dataset]||2500,sliceStartMs=performance.now()}) {
  if (state?.phase === 'move') {
    try {
      await moveProcessed(fetcher,token,file,parentId,processedId);
      return {done:true,result:{key:dataset,outcome:state.moveOutcome||'processed',sourceFileName:file.name,processedFiles:1,
        ...(state.expectedRows?{rowCount:state.expectedRows}:{})}};
    } catch (error) {
      const attempts = (Number(state.moveAttempts)||0)+1;
      if (attempts >= 3) throw error;
      return {done:false,state:{...state,moveAttempts:attempts,lastMoveError:String(error?.message||'ERP_DRIVE_MOVE_FAILED').slice(0,120)}};
    }
  }
  if (state?.phase === 'finalize') {
    return finishStageContinuation({supabase,fetcher,token,file,dataset,parentId,processedId,next:state});
  }
  const meta = {file_id:file.id,file_name:file.name,modified_at:file.modifiedTime || new Date().toISOString()};
  const {data:check,error:checkError} = await supabase.rpc('check_erp_file_sync_needed_v1',{
    p_dataset_key:dataset,p_file_id:file.id,p_file_name:file.name,p_modified_at:meta.modified_at,p_content_hash:null,
  });
  if (checkError) throw checkError;
  if (check?.skip === true) {
    try { await moveProcessed(fetcher,token,file,parentId,processedId); }
    catch (error) { return {done:false,state:{phase:'move',moveOutcome:'UP_TO_DATE',expectedRows:0,nextOffset:0,processedRows:0,identityCounts:{},moveAttempts:1}}; }
    return {done:true,result:{key:dataset,outcome:'UP_TO_DATE',sourceFileName:file.name,processedFiles:1}};
  }
  let bytes = await sourceBytes(fetcher,token,file);
  if (state?.modifiedAt && state.modifiedAt !== meta.modified_at) throw new Error('ERP_SOURCE_CHANGED_DURING_IMPORT');
  const isCsv=/\.csv$/i.test(file.name);
  const contentHash=state?null:await hashHex(bytes);
  await status({sourceProgressDelta:{key:stageKey,fileName:file.name,stage:'parsing',percent:40,updatedAt:new Date().toISOString(),error:''}});
  let allCsvRows=isCsv?parseErpCsv(new TextDecoder('utf-8').decode(bytes)):null;
  const expectedRowsForNew=state?null:isCsv?countImportableRows(allCsvRows,dataset):50000;
  const pageSize=resolveErpRowsPerSlice(dataset,maxRowsPerSlice);
  const page=isCsv?null:await parseErpXlsxPage(bytes,state?.nextOffset||0,pageSize,
    {...(state?{headerRowIndex:state.headerRowIndex,header:state.header}:{}),dataset});
  const pageRows=isCsv?allCsvRows.slice(state?.nextOffset||0,(state?.nextOffset||0)+pageSize):page.rows;
  const nextRawOffset=isCsv?Math.min(allCsvRows.length,(state?.nextOffset||0)+pageRows.length):page.nextOffset;
  const pageDone=isCsv?nextRawOffset>=allCsvRows.length:page.done;
  bytes=null;
  allCsvRows=null;
  const table = ({drive_around:'ph_master_inventory',cav:'ph_cav_import',reserves:'ph_reserves',soc:'ph_soc_master'})[dataset];
  if (!table) throw new Error('HL_PO_ORIGINAL_PDF_REQUIRED');
  const {data:columns,error:columnsError} = await supabase.rpc('fast_erp_import_columns_v1',{p_dataset_key:dataset});
  if (columnsError || !Array.isArray(columns) || !columns.length) throw columnsError || new Error('ERP_COLUMNS_UNAVAILABLE');
  let next = state;
  if (!next) {
    const expectedRows = expectedRowsForNew;
    if (!expectedRows || expectedRows > 50000) throw new Error('ERP_ROWS_INVALID');
    const {data:begin,error:beginError} = await supabase.rpc('fast_begin_erp_stage_v1',{
      p_dataset_key:dataset,p_file_meta:{...meta,content_hash:contentHash,...(isCsv?{}:{expected_rows_pending:true})},p_expected_rows:expectedRows,
    });
    if (beginError) throw beginError;
    if (begin?.skipped === true) {
      try { await moveProcessed(fetcher,token,file,parentId,processedId); }
      catch (_) { return {done:false,state:{phase:'move',moveOutcome:'UP_TO_DATE',expectedRows,nextOffset:0,processedRows:expectedRows,identityCounts:{},moveAttempts:1}}; }
      return {done:true,result:{key:dataset,outcome:'UP_TO_DATE',sourceFileName:file.name,processedFiles:1}};
    }
    const stageId = String(begin?.stage_id||'');
    const stagedExpected=Number(begin?.expected_rows);
    if (!stageId || !Number.isSafeInteger(stagedExpected) || stagedExpected<1 || stagedExpected>50000
      || (isCsv&&stagedExpected!==expectedRows)) throw new Error('ERP_STAGE_BEGIN_UNCONFIRMED');
    const stagedRows=Math.max(0,Number(begin?.staged_rows)||0);
    if(stagedRows>stagedExpected)throw new Error('ERP_STAGE_BEGIN_UNCONFIRMED');
    next = {stageId,expectedRows:stagedExpected,expectedRowsPending:!isCsv,nextOffset:0,
      processedRows:stagedRows,stagedPrefixRows:stagedRows,identityCounts:{},modifiedAt:meta.modified_at,
      ...(isCsv?{}:{headerRowIndex:page.headerRowIndex,header:page.header})};
  }
  const chunk = await normalizeErpRowsChunk(pageRows,dataset,columns,{start:0,limit:pageRows.length||1,
    priorRowCount:next.processedRows,identityCounts:next.identityCounts});
  const stagedPrefixRows=Math.max(0,Number(next.stagedPrefixRows)||0);
  const skipPersisted=Math.min(stagedPrefixRows,chunk.rows.length);
  const rowsToAppend=skipPersisted?chunk.rows.slice(skipPersisted):chunk.rows;
  if (rowsToAppend.length) {
    const {data,error} = await supabase.rpc('fast_append_erp_stage_batch_v1',{
      p_stage_id:next.stageId,p_start_row:next.processedRows,p_rows:rowsToAppend,
    });
    const stagedRows=Number(data?.staged_rows),expectedStaged=next.processedRows+rowsToAppend.length;
    if (error || (stagedRows!==expectedStaged&&!(data?.replayed===true&&stagedRows>=expectedStaged))) {
      throw error||new Error('ERP_STAGE_BATCH_UNCONFIRMED');
    }
  }
  next = {...next,nextOffset:nextRawOffset,processedRows:next.processedRows+rowsToAppend.length,
    stagedPrefixRows:stagedPrefixRows-skipPersisted,identityCounts:chunk.identityCounts,
    maxRowsPerSlice:pageSize};
  await status({currentStage:stageKey,stageIndex:STAGES.findIndex(stage=>stage.key===stageKey),
    sourceProgressDelta:{key:stageKey,fileName:file.name,stage:'staging',percent:pageDone?95:70,rowsParsed:nextRawOffset,rowsStaged:next.processedRows,rowsPublished:0,rowsTotal:pageDone?next.processedRows:null,updatedAt:new Date().toISOString(),error:''},
    stageResultsDelta:{key:stageKey,sourceFileName:file.name,stagedRows:next.processedRows,expectedRows:next.expectedRows}});
  if (!pageDone) return {done:false,state:next};
  if(next.stagedPrefixRows)throw new Error('ERP_STAGE_ROW_COUNT_MISMATCH');
  if (performance.now()-sliceStartMs >= ERP_SLICE_BUDGET_MS) return {done:false,state:{...next,phase:'finalize'}};
  return finishStageContinuation({supabase,fetcher,token,file,dataset,parentId,processedId,next});
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
      files = (await listFiles(fetcher,token,folderId,true)).filter(file =>
        file.mimeType !== 'application/vnd.google-apps.folder' && !shouldIgnoreErpFile(file.name)
        && /\.(?:xlsx|csv)$/i.test(file.name)).sort((a,b)=>String(a.modifiedTime||'').localeCompare(String(b.modifiedTime||'')));
    } catch (error) {
      stageResults.push({key:stage.key,outcome:'failed',sourceFileName:'',processedFiles:0,
        error:String(error?.message || 'ERP_DROP_FOLDER_READ_FAILED').slice(0,200)});
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

export async function runErpSyncWorkerStep({supabase,env,fetcher=fetch,status,cursor={},accessToken,maxRowsPerSlice}) {
  const sliceStartMs=performance.now();
  const foldersRaw = env('ERP_SYNC_DROP_FOLDERS_JSON');
  if (!foldersRaw || !accessToken) throw new Error('ERP_SYNC_CREDENTIALS_NOT_CONFIGURED');
  const folders = JSON.parse(foldersRaw), token = String(accessToken);
  const stageResults = Array.isArray(cursor.stageResults) ? cursor.stageResults.slice() : [];
  const attemptedByStage = cursor.attemptedByStage && typeof cursor.attemptedByStage === 'object' ? {...cursor.attemptedByStage} : {};
  let stageIndex = Math.max(0,Math.min(STAGES.length,Number(cursor.stageIndex)||0));
  const initialStageIndex = stageIndex;
  let folderSnapshot=cursor.folderSnapshot&&typeof cursor.folderSnapshot==='object'&&!Array.isArray(cursor.folderSnapshot)?{...cursor.folderSnapshot}:{};
  folderSnapshot=await prefetchErpFolders(fetcher,token,folders,folderSnapshot);
  const resume = cursor.fileContinuation && typeof cursor.fileContinuation === 'object' ? cursor.fileContinuation : null;
  const activeStage=STAGES[resume?Number(resume.stageIndex):stageIndex];
  const effectiveMaxRowsPerSlice=resolveErpRowsPerSlice(activeStage?.dataset,
    maxRowsPerSlice??resume?.state?.maxRowsPerSlice??cursor.maxRowsPerSlice);
  const snapshotCursor={stageIndex,stageResults:stageResults.slice(),attemptedByStage,folderSnapshot,
    maxRowsPerSlice:effectiveMaxRowsPerSlice,
    ...(resume?{fileContinuation:resume}:{})};
  await status({status:'CONTINUE',stageIndex,currentStage:STAGES[stageIndex]?.key||'idle',continuationCursor:snapshotCursor,
    sourceProgressDelta:{key:activeStage?.key||'drive',stage:resume?'downloading':'checking',percent:resume?15:0,
      ...(resume?{fileName:resume.file?.name,rowsParsed:resume.state?.nextOffset||0}:{}),updatedAt:new Date().toISOString(),error:''}});
  if (resume) {
    const stage = STAGES[Number(resume.stageIndex)];
    const file = resume.file;
    if (!stage || !file?.id) throw new Error('ERP_CONTINUATION_INVALID');
    const folderId = String(folders[stage.key]||'').trim();
    const processedId = String(folders.processed?.[stage.key]||folders[`${stage.key}_processed`]||'').trim();
    const sliceStarted=performance.now();
    const step = await stageFileContinuation({supabase,fetcher,token,file,dataset:stage.dataset,stageKey:stage.key,
      parentId:folderId,processedId,status,state:resume.state||null,maxRowsPerSlice:effectiveMaxRowsPerSlice,sliceStartMs});
    const hasPriorElapsed=resume.state?.elapsedMs!==undefined&&Number.isFinite(Number(resume.state.elapsedMs));
    const listDurationMs=Math.max(0,Number(resume.state?.listDurationMs??folderSnapshot[stage.key]?.listDurationMs)||0);
    const elapsedMs=(hasPriorElapsed?Number(resume.state.elapsedMs):listDurationMs)+Math.max(0,Math.round(performance.now()-sliceStarted));
    let nextCursor;
    if (step.done) {
      stageResults.push({...step.result,key:stage.key,dataset:stage.dataset,
        listDurationMs,durationMs:elapsedMs});
      const attempted = new Set(Array.isArray(attemptedByStage[stage.key])?attemptedByStage[stage.key]:[]);
      attempted.add(String(file.id)); attemptedByStage[stage.key]=[...attempted];
      nextCursor={stageIndex:Number(resume.stageIndex),stageResults,attemptedByStage,folderSnapshot};
    } else nextCursor={stageIndex:Number(resume.stageIndex),stageResults,attemptedByStage,maxRowsPerSlice:effectiveMaxRowsPerSlice,
      fileContinuation:{...resume,state:step.state?{...step.state,elapsedMs,maxRowsPerSlice:effectiveMaxRowsPerSlice}:null},folderSnapshot};
    await status({status:'CONTINUE',currentStage:stage.key,stageIndex:Number(resume.stageIndex),
      continuationCursor:nextCursor,stageResults:stageResults.slice(),fileId:file.id,
      nextOffset:step.state?.nextOffset??null,lastCompletedFile:step.done?file.name:undefined});
    return {done:false,cursor:nextCursor};
  }
  while (stageIndex < STAGES.length) {
    if(stageIndex>initialStageIndex && performance.now()-sliceStartMs>=ERP_SLICE_BUDGET_MS){
      const nextStage=STAGES[stageIndex];
      const nextRowsPerSlice=resolveErpRowsPerSlice(nextStage?.dataset,maxRowsPerSlice??cursor.maxRowsPerSlice);
      const nextCursor={stageIndex,stageResults,attemptedByStage,folderSnapshot,maxRowsPerSlice:nextRowsPerSlice};
      await status({status:'CONTINUE',currentStage:nextStage?.key||'idle',stageIndex,continuationCursor:nextCursor,
        stageResults:stageResults.slice()});
      return {done:false,cursor:nextCursor};
    }
    const stageStarted=performance.now();
    const stage = STAGES[stageIndex], folderId = String(folders[stage.key]||'').trim();
    const stageRowsPerSlice=resolveErpRowsPerSlice(stage.dataset,maxRowsPerSlice??cursor.maxRowsPerSlice);
    const processedId = String(folders.processed?.[stage.key]||folders[`${stage.key}_processed`]||'').trim();
    const snapshot=folderSnapshot[stage.key]&&typeof folderSnapshot[stage.key]==='object'?folderSnapshot[stage.key]:{};
    const listDurationMs=Math.max(0,Number(snapshot.listDurationMs)||0);
    if (!folderId) {
      stageResults.push({key:stage.key,outcome:'failed',sourceFileName:'',processedFiles:0,error:'ERP_DROP_FOLDER_ID_MISSING',
        listDurationMs,durationMs:listDurationMs+Math.max(0,Math.round(performance.now()-stageStarted))});
      stageIndex += 1; continue;
    }
    const stageCursor={stageIndex,stageResults:stageResults.slice(),attemptedByStage,folderSnapshot};
    await status({currentStage:stage.key,currentStageLabel:stage.key==='hl_po_parsed'?'HL ORDER':stage.key.toUpperCase(),
      message:`Processing ${stage.key==='hl_po_parsed'?'HL ORDER':stage.key.toUpperCase()} in the cloud.`,
      stageIndex,continuationCursor:stageCursor});
    if(stageIndex>initialStageIndex && performance.now()-sliceStartMs>=ERP_SLICE_BUDGET_MS){
      const nextCursor={...stageCursor,maxRowsPerSlice:effectiveMaxRowsPerSlice};
      await status({status:'CONTINUE',currentStage:stage.key,stageIndex,continuationCursor:nextCursor,
        stageResults:stageResults.slice()});
      return {done:false,cursor:nextCursor};
    }
    let files;
    try {
      if(snapshot.error)throw new Error(String(snapshot.error));
      files = (Array.isArray(snapshot.files)?snapshot.files:[]).filter(file => file.mimeType !== 'application/vnd.google-apps.folder'
        && !shouldIgnoreErpFile(file.name) && /\.(?:xlsx|csv)$/i.test(file.name))
        .sort((a,b)=>String(a.modifiedTime||'').localeCompare(String(b.modifiedTime||'')));
    } catch (error) {
      stageResults.push({key:stage.key,outcome:'failed',sourceFileName:'',processedFiles:0,
        listDurationMs,durationMs:listDurationMs+Math.max(0,Math.round(performance.now()-stageStarted)),
        error:String(error?.message||'ERP_DROP_FOLDER_READ_FAILED').slice(0,200)});
      stageIndex += 1; continue;
    }
    const attempted = new Set(Array.isArray(attemptedByStage[stage.key]) ? attemptedByStage[stage.key] : []);
    const file = files.find(candidate => !attempted.has(String(candidate.id||'')));
    if (!file) {
      if (!stageResults.some(result=>result.key===stage.key)) stageResults.push({key:stage.key,outcome:'UP_TO_DATE',sourceFileName:'',processedFiles:0,
        listDurationMs,durationMs:listDurationMs+Math.max(0,Math.round(performance.now()-stageStarted))});
      stageIndex += 1; continue;
    }
    try {
      const step = await stageFileContinuation({supabase,fetcher,token,file,dataset:stage.dataset,stageKey:stage.key,parentId:folderId,
        processedId,status,state:null,maxRowsPerSlice:stageRowsPerSlice,sliceStartMs});
      const elapsedMs=listDurationMs+Math.max(0,Math.round(performance.now()-sliceStartMs));
      if (step.done) {
        attempted.add(String(file.id||'')); attemptedByStage[stage.key]=[...attempted];
        stageResults.push({...step.result,key:stage.key,dataset:stage.dataset,listDurationMs,durationMs:elapsedMs});
      } else {
        const nextCursor={stageIndex,stageResults,attemptedByStage,maxRowsPerSlice:stageRowsPerSlice,
          fileContinuation:{stageIndex,file,state:step.state?{...step.state,elapsedMs,maxRowsPerSlice:stageRowsPerSlice,
            listDurationMs}:null},folderSnapshot};
        await status({status:'CONTINUE',currentStage:stage.key,stageIndex,continuationCursor:nextCursor,
          stageResults:stageResults.slice(),fileId:file.id,nextOffset:step.state?.nextOffset??null});
        return {done:false,cursor:nextCursor};
      }
    } catch (error) {
      attempted.add(String(file.id||'')); attemptedByStage[stage.key]=[...attempted];
      stageResults.push({key:stage.key,dataset:stage.dataset,outcome:'failed',sourceFileName:file.name,processedFiles:0,
        listDurationMs,durationMs:listDurationMs+Math.max(0,Math.round(performance.now()-stageStarted)),
        error:String(error?.message||'ERP_FILE_IMPORT_FAILED').slice(0,200)});
    }
    const nextCursor = {stageIndex,stageResults,attemptedByStage,folderSnapshot};
    await status({currentStage:stage.key,stageIndex,stageResults:stageResults.slice(),continuationCursor:nextCursor,lastCompletedFile:file.name});
    return {done:false,cursor:nextCursor};
  }
  const blocked = stageResults.some(result=>result.outcome==='requires_template'), failed = stageResults.some(result=>result.outcome==='failed');
  await status({active:false,status:blocked?'blocked':failed?'failed':'complete',currentStage:'idle',currentStageLabel:'Idle',
    stageIndex:STAGES.length,stageResults,continuationCursor:{stageIndex:STAGES.length,stageResults,attemptedByStage,folderSnapshot},
    finishedAt:new Date().toISOString(),message:blocked?'HL ORDER workbook contract requires confirmation.':failed?'One or more ERP files could not be imported.':'ERP sync completed.',
    error:blocked?'HL ORDER workbook contract requires confirmation.':failed?'One or more ERP files could not be imported.':'',
    errorCode:blocked?'ERP_SYNC_REQUIRES_TEMPLATE':failed?'ERP_SYNC_STAGE_FAILED':''});
  return {done:true,ok:!blocked&&!failed,cursor:{stageIndex:STAGES.length,stageResults,attemptedByStage,folderSnapshot}};
}

export { STAGES as ERP_SYNC_STAGES };
