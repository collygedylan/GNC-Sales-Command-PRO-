import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
const read = file => fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8');
export async function assertBunchOptimisticContract(){
 const dom=new JSDOM('<div id="workspace"></div>',{url:'https://agmetricapp.com/'}),window=dom.window;
 const row={unique_id:'B.02.000::MAG.070::GHOST_LOT',locationcode:'B.02.000',itemcode:'MAG.070',lotcode:'GHOST_LOT',commonname:'Jane Magnolia',contsize:'#7',warehousei:'10',synthetic:true,historical:true};
 const definition={plan_id:'BNH:test',wf_type:'BUNCH NOTE EXCEPTION',from_loc:'2B',commonname:row.commonname,contsize:row.contsize,itemcode:row.itemcode,notes:'Not on inventory'};
 const refs={ph_dylan_decisions_store:[definition]}; let finish,fail,saves=0,projection=null;
 const request=async({operation,table,payload})=>{if(operation==='read')return {rows:refs[table]||[]};saves++;return new Promise((resolve,reject)=>{finish=()=>{const saved={...payload.row,updated_at:'2026-11-02T00:00:00Z'};refs[table].push(saved);resolve({row:saved});};fail=()=>reject(Error('Network unavailable'));});};
 vm.runInNewContext(read('assets/nursery-command-model.js'),{window});vm.runInNewContext(read('assets/nursery-command-tables.js'),{window,document:window.document,setInterval:()=>1,clearInterval(){},setTimeout,clearTimeout});
 window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};window.HTMLDialogElement.prototype.close=function(){this.dispatchEvent(new window.Event('close'));};
 const root=window.document.getElementById('workspace'),inventory=[],options={selected:'bunch-notes-simulator',identity:'approval-contract',inventory:()=>inventory,authorized:()=>true,request,onBunchNoteSaved(r,d){projection=d;},back(){}};
 const settle=()=>new Promise(resolve=>setImmediate(resolve));let mounted=window.GncNurseryTables.mount(root,options);
 try{await settle();root.querySelector('[data-bunch-subview="issues"]').click();root.querySelector('[data-bunch-open]').click();const start=performance.now();window.document.querySelector('[data-bunch-approve]').click();const ms=performance.now()-start;assert.ok(ms<250,'optimistic UI '+ms+'ms');assert.equal(saves,0);assert.equal(window.document.querySelector('[data-bunch-approve]'),null);assert.equal(projection._optimistic,true);assert.match(window.localStorage.getItem('gnc_bunch_decisions:approval-contract'),/_optimistic/);await settle();fail();await settle();assert.equal(projection,null);assert.equal(root.querySelectorAll('[data-bunch-card]').length,1);
 root.querySelector('[data-bunch-open]').click();window.document.querySelector('[data-bunch-approve]').click();await settle();finish();await settle();assert.equal(projection.notes.includes('B.02.000'),true);assert.doesNotMatch(window.localStorage.getItem('gnc_bunch_decisions:approval-contract'),/_optimistic/);mounted.destroy();mounted=window.GncNurseryTables.mount(root,{...options,selected:'approved-execution-plan'});const location=root.querySelector('[data-nursery-filter="location"]');location.value='ALL_LOCATIONS';location.dispatchEvent(new window.Event('change',{bubbles:true}));assert.match(root.textContent,/Jane Magnolia/);assert.equal(inventory.length,0);return ms;}finally{mounted.destroy();window.close();}
}
