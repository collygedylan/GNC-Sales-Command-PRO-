export const SOC_ORDER_HISTORY_PARSER_VERSION = 'soc-history-v1';
const LEGACY_COLUMNS = Object.freeze(["WAREHOUSEID","WAREHOUSENAME","ISRESERVE","SALESREPID","SALESREPNAME","NATIONALACCOUNT","IDGROUP","CUSTOMERIDENTITYID","CUSTOMERNAME","CONSIGNEEIDENTITYID","CONSIGNEENAME","CONSIGNEECITY","CONSIGNEESTATE","CONSIGNEEZIP","TRIPNUMBER","STOPNUMBER","ZONECODE","TAGCODE","TRANSACTIONNUMBER","PURCHASEORDERNUMBER","EXTUNITPRICE","ORDERTOTAL","REQUESTDATE","STAGENAME","STEP","CUSTOMERSKU","FORMATTEDUPC","PRINTEDCONTAINERCODE","LOTCODE","LOCATIONCODE","DESCRIPTORCODE","ITEMCODE","PLANTGROUPCODE","SORTNAMEVARIETY","CONTAINERSORT","QUALITYCODE","COMMONNAME","QUANTITYORDERED","QUANTITYSHIPPED","LISTPRICE","UNITPRICE","HANDLINGCHARGEPERITEM","TAGGINGCHARGEPERITEM","COMBINEDPRICE","FREIGHTRATEPERITEM","LANDED","RETAILPRICE","HOLDSTOPCODE","HOLDSTOPREASON","SALESNOTE","FNSALESNOTE","PICKNOTE","PLANSTART","GENERALLOADINSTR","INVOICEDATE","CONSIGNEEADDRESS_1","CONSIGNEEADDRESS_2","ALTSHIPCOMMENT","SHIPTOTELEPHONE_1","OKLOADINSTRUCTIONS","TXLOADINSTRUCTIONS","NCLOADINSTRUCTIONS","HLLOADINSTRUCTIONS","DOCK","EQUIV_UNIT","EQUIV_UOM","WINGDINGUNITS","DROPWEIGHT","INTERNALINVNOTE","HARDINESSZONE","BRAND","TAGDEPTNOTE","Ext Unit Merch Shipped","Ext Eunit Shipped","Avg Price/Eunit Shipped","REQUESTDATEWEEK","Carrier","Suspend","Suspend-To","QA Code","GROWER"]);

const text=value=>String(value??'').replace(/\u00a0/g,' ').trim().replace(/^(?:null|nan|undefined)$/i,'');
const number=value=>{const raw=text(value).replace(/,/g,'');return raw&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)?Number(raw):null;};
function localParts(value){
  const date=new Date(value);if(!Number.isFinite(date.getTime()))throw new Error('SOC_HISTORY_DATE_INVALID');
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).map(part=>[part.type,part.value]));
}
function chicagoInstant(day,clock){
  const desired=Date.parse(`${day}T${clock}Z`);let candidate=desired;
  for(let attempt=0;attempt<3;attempt+=1){const part=localParts(candidate);const local=Date.parse(`${part.year}-${part.month}-${part.day}T${part.hour}:${part.minute}:${part.second}Z`);const diff=desired-local;candidate+=diff;if(!diff)break;}
  return new Date(candidate).toISOString();
}
export function parseSocHistoryReportTime(file){
  const name=String(file?.name||file?.title||'');const created=localParts(file?.createdTime||file?.created_at||file?.modifiedTime);let day='',clock='',method='',match;
  match=name.match(/-(\d{2})(\d{2})(\d{2})(20\d{2})(\d{2})(\d{2})\d{6}/);
  if(match){day=`${match[4]}-${match[5]}-${match[6]}`;clock=`${match[1]}:${match[2]}:${match[3]}`;method='filename_timestamp';}
  else if((match=name.match(/\b(20\d{2})[-_](\d{1,2})[-_](\d{1,2})(?:\s+(\d{1,2}))?/))){day=`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;clock=`00:00:${String(match[4]||'0').padStart(2,'0')}`;method=match[4]?'filename_date_sequence':'filename_date';}
  else if((match=name.match(/(?:SOC[ _]*)(\d{1,2})-(\d{1,2})(?:-(20\d{2}))?/i))){day=`${match[3]||created.year}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`;clock='00:00:00';method=match[3]?'filename_date':'filename_date_inferred_year';}
  else{day=`${created.year}-${created.month}-${created.day}`;clock=`${created.hour}:${created.minute}:${created.second}`;method='creation_time_fallback';}
  const checked=new Date(`${day}T${clock}Z`);if(!Number.isFinite(checked.getTime())||checked.toISOString().slice(0,10)!==day)throw new Error('SOC_HISTORY_DATE_INVALID');
  return {report_date:day,snapshot_at:chicagoInstant(day,clock),source_date_method:method,source_created_at:new Date(file.createdTime||file.created_at||file.modifiedTime).toISOString()};
}
function inspectSheet(values,fileName){
  const norm=value=>text(value).toUpperCase().replace(/[^A-Z0-9]/g,'');
  const required=['WAREHOUSEID','TRANSACTIONNUMBER','ITEMCODE','QUANTITYORDERED','DOCK'];
  for(let i=0;i<Math.min(20,values.length);i+=1){const cells=(values[i]||[]).map(norm);if(!cells.includes('ITEMCODE')||!cells.includes('DOCK'))continue;
    if(required.some(key=>cells.indexOf(key)<0||cells.indexOf(key)!==cells.lastIndexOf(key)))throw new Error('SOC_HISTORY_HEADER_INVALID');
    return {start_row:i+1,index:Object.fromEntries(cells.map((key,index)=>[key,index])),schema:'headered',header_row:i+1};}
  const preamble=text((values[0]||[])[0]);if(!/soc/i.test(fileName)||!/WAREHOUSE|ISRESERVE|REQUESTDATE/i.test(preamble))throw new Error('SOC_HISTORY_HEADER_MISSING');
  const rows=values.slice(1).filter(row=>row.some(cell=>text(cell)));if(!rows.length)throw new Error('SOC_HISTORY_LEGACY_SCHEMA_INVALID');
  if(!rows.slice(0,25).every(row=>row.length<=81&&/^\d+$/.test(text(row[0]))&&/^(?:true|false|0|1)?$/i.test(text(row[2]))&&/^\d{6}\.\d{3}\.\d+$/.test(text(row[31]))&&number(row[37])!==null&&number(row[38])!==null&&!!text(row[18])))throw new Error('SOC_HISTORY_LEGACY_SCHEMA_INVALID');
  return {start_row:1,index:Object.fromEntries(LEGACY_COLUMNS.map((key,index)=>[norm(key),index])),schema:'soc_legacy_81_v1',header_row:null};
}
function parseRows(values,fileName,sheetName,layout){
  const out={rows:[],source_row_count:0,exclusion_counts:{},exclusion_ranges:[],schema:layout.schema,header_row:layout.header_row,source_sheet_name:String(sheetName||'Sheet1')};let rowNumber=0;
  const exclude=reason=>{out.exclusion_counts[reason]=(out.exclusion_counts[reason]||0)+1;const prior=out.exclusion_ranges.at(-1);if(prior&&prior.reason===reason&&prior.through_row===rowNumber-1)prior.through_row=rowNumber;else out.exclusion_ranges.push({reason,from_row:rowNumber,through_row:rowNumber});};
  for(let i=layout.start_row;i<values.length;i+=1){const row=values[i]||[];if(!row.some(value=>text(value)))continue;rowNumber=i+1;out.source_row_count+=1;const cell=key=>text(row[layout.index[key]]);const itemcode=cell('ITEMCODE').toUpperCase();
    if(!itemcode){exclude('missing_itemcode');continue;}const dock=cell('DOCK');if(!dock||number(dock)===0){exclude('missing_dock');continue;}
    const qty=number(cell('QUANTITYORDERED'));if(qty===null||!Number.isFinite(qty)||qty<=0){exclude('invalid_quantity');continue;}
    const warehouse=cell('WAREHOUSEID').toUpperCase(),transaction=cell('TRANSACTIONNUMBER').toUpperCase();const consignee=cell('CONSIGNEEIDENTITYID')||cell('CUSTOMERIDENTITYID')||cell('CONSIGNEENAME')||cell('CUSTOMERNAME');
    if(!warehouse||!transaction||!consignee){exclude('missing_identity');continue;}
    out.rows.push({group_key:JSON.stringify([warehouse,transaction,consignee.toUpperCase(),itemcode]),itemcode,quantity_ordered:qty,dock,source_row_number:rowNumber,source_sheet_name:out.source_sheet_name});
  }
  return out;
}
export function parseSocHistoryWorkbook(sheets,fileName){
  if(!Array.isArray(sheets)||!sheets.length)throw new Error('SOC_HISTORY_ARCHIVE_EMPTY');
  const matches=[];
  for(const sheet of sheets){const values=sheet?.rows||[];if(/^DriveAroundMC-/i.test(fileName)){const idx=values.findIndex(row=>row.some(cell=>['ITEMCODE','LOCATIONCODE','PTRONHAND','SLTS'].every(key=>row.map(value=>text(value).toUpperCase().replace(/[^A-Z0-9]/g,'')).includes(key))));if(idx>=0){const count=Math.max(0,values.length-idx-1);matches.push({rows:[],source_row_count:count,exclusion_counts:{non_order_report:count},exclusion_ranges:count?[{reason:'non_order_report',from_row:idx+2,through_row:values.length}]:[],schema:'drivearound_inventory',source_sheet_name:sheet.name});}continue;}
    try{const layout=inspectSheet(values,fileName);matches.push(parseRows(values,fileName,sheet.name,layout));}catch(error){if(error?.message!=='SOC_HISTORY_HEADER_MISSING')throw error;}}
  if(matches.length!==1)throw new Error(matches.length?'SOC_HISTORY_MULTIPLE_SHEETS':'SOC_HISTORY_HEADER_MISSING');
  return matches[0];
}
