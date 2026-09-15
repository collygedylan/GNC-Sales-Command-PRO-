import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseHlPoPdfPage,chicagoReportTime} from '../supabase/functions/_shared/hl-po-pdf.mjs';

const text=(str,x,y=506)=>({str,width:str.length*4,transform:[1,0,0,1,x,y]});
function page() {return [text('PO Order Report',351,563),text('1 of 1',680,586),text('9/11/2026 4:17:26 PM',680,575),
  text('10C00258',617,541),text('Vendor 823517:',120,524),
  ...[['Item Code',19],['Lot',77],['Size',105],['Common Name',127],['PO Ordered',220],['Genus',266],['Received',624],['Remaining',662],['Hand',589]].map(([s,x])=>text(s,x)),
  text('000310.030.1',19,450),text('27.F1',77,450),text('#3',105,450),text('Sea Green',127,450),text('Juniper',127,441),text('500',249,450),text('500',644,450),
  text('000310.030.1',19,425),text('27.F1',77,425),text('#3',105,425),text('Sea Green Juniper',127,425),text('300',249,425),text('300',687,425)];}
const parse=items=>parseHlPoPdfPage(items,{pageNumber:1,totalPages:1});
test('original PO columns preserve distinct lines, leading zeroes, multiline names and blank-as-zero',()=>{
  const {rows,metadata}=parse(page());
  assert.equal(rows.length,2); assert.equal(rows[0].common_name,'Sea Green Juniper');
  assert.equal(rows[0].item_code,'000310.030.1');
  assert.deepEqual(rows.map(r=>r.po_remain),[0,300]);
  assert.equal(rows.reduce((s,r)=>s+r.po_ordered,0),800);
  assert.equal(rows[0].source_values.blank_remaining,true);
  assert.equal(metadata.report_printed_at,'2026-09-11T21:17:26.000Z');
});
test('identical legitimate lines remain separate',()=>{
  const items=page().filter(c=>c.transform[5]>=450);
  const row=items.filter(c=>c.transform[5]===450);
  const {rows}=parse([...items,...row.map(c=>({...c,transform:[1,0,0,1,c.transform[4],425]}))]);
  assert.equal(rows.length,2); assert.notEqual(rows[0].row_index,rows[1].row_index);
});
test('missing columns, unreadable numbers, orphan lines and incomplete page sequence reject instead of producing zero',()=>{
  assert.throws(()=>parse(page().filter(c=>c.str!=='Remaining')),/MISSING_COLUMNS/);
  assert.throws(()=>parse([...page(),text('?',687,450)]),/INVALID_QUANTITY/);
  assert.throws(()=>parse(page().filter(c=>!(c.str==='000310.030.1' && c.transform[5]===450))),/ORPHAN_DETAIL/);
  assert.throws(()=>parseHlPoPdfPage(page(),{pageNumber:1,totalPages:2}),/PAGE_SEQUENCE/);
});
test('Chicago report time preserves calendar date and rejects invalid or ambiguous timestamps',()=>{
  assert.equal(chicagoReportTime('1/2/2027 4:00:00 PM').report_printed_at,'2027-01-02T22:00:00.000Z');
  assert.throws(()=>chicagoReportTime('2/30/2026 4:00:00 PM'),/AMBIGUOUS/);
  assert.throws(()=>chicagoReportTime('11/1/2026 1:30:00 AM'),/AMBIGUOUS/);
});

function importer({fail=false,moveFail=false}={}) {
  const properties=new Map(),events=[];
  const pdf={getId:()=> 'synthetic-file-123',getName:()=> 'PO HL.pdf',getMimeType:()=> 'application/pdf',getDateCreated:()=>new Date(0),getBlob:()=>({getBytes:()=>Array.from(Buffer.from('%PDF-test'))})};
  const sheet={...pdf,getId:()=> 'summary',getName:()=> 'Quantity Summary',getMimeType:()=> 'application/vnd.google-apps.spreadsheet'};
  const ctx=vm.createContext({console,PropertiesService:{getScriptProperties:()=>({getProperty:k=>properties.get(k),setProperty:(k,v)=>properties.set(k,v),deleteProperty:k=>properties.delete(k)})},
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,b)=>Array.from(createHash('sha256').update(Buffer.from(b)).digest()),base64Encode:b=>Buffer.from(b).toString('base64')},
    UrlFetchApp:{fetch:(url,opts)=>{const data=JSON.parse(opts.payload);events.push(['stage',data.start_page]);
      const result=fail?{ok:false,code:'HL_PO_PDF_MISSING_COLUMNS'}:data.start_page===1?{ok:true,next_page:11,status:'staging',run_id:'stable'}:{ok:true,next_page:null,status:'pending',run_id:'stable',total_rows:616};
      return {getResponseCode:()=>fail?422:200,getContentText:()=>JSON.stringify(result)};}}});
  new vm.Script(readFileSync(new URL('../Code.gs',import.meta.url),'utf8')).runInContext(ctx);
  ctx.getSupabaseHeaders_=()=>({});ctx.getDriveFolderByIdWithRetry_=id=>id;
  ctx.listDriveFilesWithRetry_=()=>{let n=0;return {hasNext:()=>n<2,next:()=>[pdf,sheet][n++]};};
  ctx.moveDriveFileToFolderWithRetry_=file=>{events.push(['move',file.getId()]);if(moveFail)throw new Error('move failed');};
  return {events,properties,run:()=>ctx.syncHlPoParsedFolder_('source','processed','ph_27f1_hl_po')};
}
test('scheduled importer accepts original PDF only, stages resumable pages and archives after final acknowledgement',()=>{
  const h=importer();const r=h.run();
  assert.deepEqual(h.events,[['stage',1],['stage',11],['move','synthetic-file-123']]);
  assert.equal(r.totalRows,616);assert.equal(r.unsupportedFiles,1);assert.equal(r.awaitingReconciliation,true);
  assert.equal(h.properties.size,0);
});
test('failed PDF remains in source and failed archive retries no database calls',()=>{
  const bad=importer({fail:true});assert.equal(bad.run().failedFiles,1);assert.equal(bad.events.some(e=>e[0]==='move'),false);
  const h=importer({moveFail:true});h.run();h.events.length=0;h.run();
  assert.deepEqual(h.events,[['move','synthetic-file-123']]);
});
