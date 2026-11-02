import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {buildBunchNotesBlockPdfDocument} from '../../services/bunch-note-pdf.mjs';
export function bunchDrillFixture(){
 const inventory=['F.05.010','F.05.020','G.10.010','G.10.020'].map((locationcode,i)=>({unique_id:'drill-'+i,warehousei:'10',itemcode:'A.030.1',commonname:'Gold Mop Falsecypress',contsize:'#3',locationcode,lotcode:'27.F1',source:'LD',saleyear:'2027',ptronhand:100,ptravailable:90}));
 inventory[0].photo_url='https://example.test/one.jpg,https://example.test/two.jpg';
 const refs={ph_nursery_locations:['F.05.000','G.10.000'].map(location_code=>({location_code,total_beds:101,house_count:0,permanent_shade:'N',house_orientation:'East-West'})),ph_nursery_items_cpb:[{itemcode:'A.030.1',cpb:100}],ph_nursery_water_rating:[{common_name:'Gold Mop Falsecypress',dwu_3:'500'}],ph_dylan_decisions_store:[]};
 return {inventory,refs};
}
export async function assertBunchDrillContract(){
 const dom=new JSDOM('<div id="manager-table-management-root"></div>',{url:'https://agmetricapp.com/'}),window=dom.window,{inventory,refs}=bunchDrillFixture();
 const read=file=>fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8');
 vm.runInNewContext(read('assets/nursery-command-model.js'),{window});vm.runInNewContext(read('assets/nursery-command-tables.js'),{window,document:window.document,setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){}});
 let downloads=0,sends=0,payload,revision=0;const root=window.document.getElementById('manager-table-management-root'),settle=()=>new Promise(resolve=>setImmediate(resolve));
 const handle=window.GncNurseryTables.mount(root,{selected:'bunch-notes-simulator',identity:'drill-test',inventory:()=>inventory,authorized:()=>true,inventoryReady:()=>true,revision:()=>revision,onBunchNoteSaved(){revision++;},back(){},
  request:async({table,operation,payload})=>{if(operation==='read')return {rows:refs[table]||[]};return {row:{...payload.row,updated_at:'2026-11-02T00:00:00.000Z'}};},
  buildPdf:buildBunchNotesBlockPdfDocument,downloadPdf:pdf=>{downloads++;assert.equal(Buffer.from(pdf.base64,'base64').subarray(0,8).toString(),'%PDF-1.4');assert.match(pdf.filename,/Bunch_Notes_F\.05\.000_/);},
  sendPdf:async data=>{sends++;payload=data;assert.equal(data.cards.length,2);assert.ok(data.cards.every(c=>c.updated_at&&c.notes));return {eventId:'test-event',status:'queued',recipient:'dylan_collyge'};}});
 try{await settle();assert.equal(root.querySelectorAll('[data-bunch-alpha]').length,12);root.querySelector('[data-bunch-alpha="F"]').click();assert.equal(root.querySelector('[data-bunch-drill-level]').dataset.bunchDrillLevel,'location');root.querySelector('[data-bunch-location-open="F.05.000"]').click();assert.equal(root.querySelectorAll('[data-bunch-card]').length,2);assert.equal(root.querySelector('img').src,'https://example.test/one.jpg');assert.ok(root.querySelector('[data-bunch-inline-note]').value);assert.equal(root.querySelectorAll('[data-bunch-card-approve]').length,2);
  const start=performance.now();root.querySelector('[data-bunch-send]').click();const approvalMs=performance.now()-start;assert.ok(approvalMs<100,'optimistic approval '+approvalMs+'ms');assert.equal(root.querySelectorAll('[data-bunch-card-status]').length,2);assert.ok([...root.querySelectorAll('[data-bunch-card-status]')].every(el=>el.textContent.includes('Approved')));assert.equal(sends,0,'email must await durable approvals');
  for(let i=0;i<10&&sends===0;i++)await settle();assert.equal(downloads,1);assert.equal(sends,1);assert.match(root.textContent,/queued PDF email to dylan_collyge/);assert.equal(payload.locationCode,'F.05.000');
  assert.equal(window.GncNurseryTables.back(),true);assert.equal(root.querySelector('[data-bunch-drill-level]').dataset.bunchDrillLevel,'location');assert.equal(window.GncNurseryTables.back(),true);root.querySelector('[data-bunch-alpha="G"]').click();root.querySelector('[data-bunch-location-open="G.10.000"]').click();assert.equal(root.querySelectorAll('[data-bunch-card]').length,2);return {approvalMs};
 }finally{handle.destroy();window.close();}
}
