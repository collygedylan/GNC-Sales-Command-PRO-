import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { countImportableErpXlsxRows, normalizeErpRows, parseErpXlsxPage } from '../../supabase/functions/_shared/erp-sync.mjs';

export function makeZip(entries) {
  const local=[],central=[];let offset=0;
  for (const [name,content] of Object.entries(entries)) {
    const filename=Buffer.from(name),raw=Buffer.from(content),compressed=deflateRawSync(raw);
    const header=Buffer.alloc(30+filename.length);
    header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(8,8);
    header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(raw.length,22);header.writeUInt16LE(filename.length,26);filename.copy(header,30);
    local.push(header,compressed);
    const record=Buffer.alloc(46+filename.length);
    record.writeUInt32LE(0x02014b50,0);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(8,10);
    record.writeUInt32LE(compressed.length,20);record.writeUInt32LE(raw.length,24);record.writeUInt16LE(filename.length,28);
    record.writeUInt32LE(offset,42);filename.copy(record,46);central.push(record);offset+=header.length+compressed.length;
  }
  const data=Buffer.concat(central),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(central.length,8);end.writeUInt16LE(central.length,10);
  end.writeUInt32LE(data.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,data,end]);
}
function worksheetRow(index, values) {
  const cells=values.map((value,column)=>`<c r="${String.fromCharCode(65+column)}${index}" t="inlineStr"><is><t>${value}</t></is></c>`);
  return `<row r="${index}">${cells.join('')}</row>`;
}
export async function socXlsxContract() {
  const rows=[['itemcode','docknumber','tripnumber','drop','suspend','suspend-to','warehouseid','planstart'],
    ['101','38','','40','','','10','2026-11-04'],['102','39','','30','SUSPEND','AV','10','2026-11-05'],
    ['103','0','','','','','10','2026-11-05'],['104','','39','','SUSPEND','DC','10','2026-11-05'],
    ['105','null','','','','','10','2026-11-05'],['106','nan','','','','','10','2026-11-05'],
    ['107','none','','','','','10','2026-11-05'],['108','8','','','','','9','2026-11-05']];
  const entries={
    'xl/workbook.xml':'<workbook xmlns:r="urn:r"><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':'<worksheet><sheetData>'+rows.map((row,index)=>worksheetRow(index+1,row)).join('')+'</sheetData></worksheet>',
  };
  const bytes=makeZip(entries),page=await parseErpXlsxPage(bytes,0,20,{dataset:'soc'});
  assert.deepEqual(page.rows.map(row=>row.itemcode),['101','102']);
  assert.equal(await countImportableErpXlsxRows(bytes,'soc'),2);
  const normalized=await normalizeErpRows(page.rows,'soc',['unique_id','itemcode','dock','stopnumber']);
  assert.deepEqual(normalized.map(row=>[row.dock,row.stopnumber]),[['38','40'],['39','30']]);
}

