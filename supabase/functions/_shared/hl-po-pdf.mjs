// Parser for the original Greenleaf PO Order Report. Coordinates are normalized
// to the report's landscape template; blank numeric cells are not missing columns.
export const HL_PO_PDF_VERSION = 'greenleaf-po-pdf-v1';
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
function fail(code, page) { throw new Error(`HL_PO_PDF_${code}:page_${page}`); }
function amount(raw, page) {
  if (!raw) return 0;
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw)) fail('INVALID_QUANTITY', page);
  const value = Number(raw.replaceAll(',', ''));
  if (!Number.isFinite(value)) fail('INVALID_QUANTITY', page);
  return value;
}
export function chicagoReportTime(value) {
  const m = clean(value).match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/);
  if (!m) throw new Error('HL_PO_PDF_INVALID_PRINT_DATE');
  const [,mo,da,yr,hr,mi,se,ap] = m;
  const parts = [Number(yr),Number(mo),Number(da),(Number(hr)%12)+(ap==='PM'?12:0),Number(mi),Number(se)];
  if (+hr<1 || +hr>12 || +mo<1 || +mo>12 || +mi>59 || +se>59) throw new Error('HL_PO_PDF_INVALID_PRINT_DATE');
  const naive = Date.UTC(parts[0],parts[1]-1,parts[2],parts[3],parts[4],parts[5]);
  const formatter = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const candidates = [5,6].map(hours => new Date(naive+hours*3600000)).filter(date => {
    const p=Object.fromEntries(formatter.formatToParts(date).map(v=>[v.type,v.value]));
    return ['year','month','day','hour','minute','second'].every((key,i)=>Number(p[key])===parts[i]);
  });
  if (candidates.length!==1) throw new Error('HL_PO_PDF_AMBIGUOUS_PRINT_DATE');
  return {report_printed_at:candidates[0].toISOString(),report_date:`${yr}-${mo.padStart(2,'0')}-${da.padStart(2,'0')}`};
}
export function parseHlPoPdfPage(items, {pageNumber,totalPages,width=792,height=612}) {
  if (!Array.isArray(items) || Math.abs(width/height-792/612)>0.02) fail('UNSUPPORTED_LAYOUT',pageNumber);
  const cells=items.filter(i=>typeof i.str==='string' && clean(i.str)).map(i=>({
    text:clean(i.str),x:i.transform[4]*792/width,y:i.transform[5]*612/height,right:(i.transform[4]+i.width)*792/width
  }));
  const find=(text,x1,x2)=>cells.find(c=>c.text===text && c.x>=x1 && c.x<=x2 && c.y>480);
  for(const [name,x1,x2] of [['Item Code',15,25],['Lot',72,82],['Size',100,110],['Common Name',122,133],['PO Ordered',215,225],['Genus',261,271],['Received',619,629],['Remaining',657,668],['Hand',584,595]]) {
    if(!find(name,x1,x2)) fail('MISSING_COLUMNS',pageNumber);
  }
  if(!cells.some(c=>c.text==='PO Order Report' && c.y>550)) fail('WRONG_REPORT',pageNumber);
  const pageCell=cells.find(c=>/^\d+ of \d+$/.test(c.text) && c.y>575);
  if(!pageCell || pageCell.text!==`${pageNumber} of ${totalPages}`) fail('PAGE_SEQUENCE',pageNumber);
  const dateCell=cells.find(c=>/\d{1,2}\/\d{1,2}\/20\d{2}.*[AP]M$/.test(c.text) && c.y>560);
  if(!dateCell) fail('MISSING_PRINT_DATE',pageNumber);
  const metadata=chicagoReportTime(dateCell.text);
  const po=cells.find(c=>c.x>600 && c.y>535 && c.y<545 && /^[A-Z0-9-]+$/.test(c.text));
  const vendor=cells.find(c=>/^Vendor \d+:$/.test(c.text) && c.y>515);
  if(!po || !vendor) fail('MISSING_PO_HEADER',pageNumber);
  const body=cells.filter(c=>c.y<480);
  const anchors=body.filter(c=>c.x>=15 && c.x<72 && /^[A-Z0-9][A-Z0-9._/-]*\d[A-Z0-9._/-]*$/i.test(c.text)).sort((a,b)=>b.y-a.y);
  if(!anchors.length) fail('NO_DETAIL_ROWS',pageNumber);
  const cell=(y,left,right)=>body.filter(c=>Math.abs(c.y-y)<1.3 && c.x>=left && c.x<right).sort((a,b)=>a.x-b.x).map(c=>c.text).join(' ');
  const rows=anchors.map((a,index)=>{
    const lot=cell(a.y,72,102).toUpperCase(),size=cell(a.y,102,125);
    if(!/^\d{2,4}\.[A-Z][A-Z0-9]*$/.test(lot) || !size) fail('INVALID_IDENTITY',pageNumber);
    const bottom=anchors[index+1]?.y ?? 0;
    const common=body.filter(c=>c.y<=a.y+1.3 && c.y>bottom+1.3 && c.x>=125 && c.x<215).sort((a,b)=>b.y-a.y||a.x-b.x).map(c=>c.text).join(' ');
    const fields={po_ordered:cell(a.y,215,265),po_received:cell(a.y,610,660),po_remain:cell(a.y,660,705),lot_pend_rec:cell(a.y,490,522),seas_on_hand:cell(a.y,580,610)};
    const quantities=Object.fromEntries(Object.entries(fields).map(([key,v])=>[key,amount(v,pageNumber)]));
    const comments=body.filter(c=>c.y<a.y-1.3 && c.y>bottom+1.3 && c.x>=265 && c.x<490).sort((a,b)=>b.y-a.y||a.x-b.x).map(c=>c.text).join(' ');
    return {item_code:a.text,lot,size,common_name:common,genus:cell(a.y,265,308),po_comments:comments,...quantities,
      po_number:po.text,vendor:vendor.text.match(/\d+/)[0],page:pageNumber,line_index:index+1,row_index:pageNumber*10000+index+1,
      source_values:{...fields,blank_remaining:fields.po_remain===''},...metadata};
  });
  // A lot-bearing detail line without an item anchor is a damaged extraction.
  for(const c of body.filter(c=>c.x>=72 && c.x<102 && /^\d{2,4}\.[A-Z][A-Z0-9]*$/.test(c.text))) {
    if(!anchors.some(a=>Math.abs(a.y-c.y)<1.3)) fail('ORPHAN_DETAIL',pageNumber);
  }
  return {metadata,rows};
}
