import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
const source=await fs.readFile(new URL('../assets/test/operations.mjs',import.meta.url),'utf8');
const pdfSource=await fs.readFile(new URL('../assets/test/pdf.mjs',import.meta.url),'utf8');
const modelSource=await fs.readFile(new URL('../assets/test/operations-model.mjs',import.meta.url),'utf8');
test('six operational consoles render, preserve cached data on failure and isolate accounts',async()=>{
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://agmetricapp.com/test/index.html',runScripts:'outside-only'}),w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 let account='actor-1',failure=false;const reads=[];
 const snapshot=()=>({actor:{id:account,username:'dylan_collyge',role:'super-admin'},pullers:[{puller_id:'001',puller_name:'Test Puller',quality_status:'ESP'},{puller_id:'002',puller_name:'Helper',quality_status:'SP'}],units:[{wingding_id:'200',max_unit_capacity:600,status:'OPERATIONAL'}],teams:[],lines:[{soc_id:'line-1',unique_id:'physical-1',load_id:'LOAD-1',drop_number:1,itemcode:'ITEM-1',commonname:'Live Oak',locationcode:'F.23.000',season:'F1',lotcode:'27.F1',dock:'38',ordered_qty:100,shipped_qty:0,pulled_qty:0,verified_qty:0,mistake_qty:0,assigned_qty:0,is_rush_priority:true,line_status:'PENDING_PULL'}],drops:[{drop_id:'drop-1',load_id:'LOAD-1',drop_number:1,total_items:100,checked_items:0,mistake_items:0,loading_status:'FIELD_PULLING',is_live_driver:true}],mistakes:[],staging:[]});
 const c={auth:{getSession:async()=>({data:{session:account?{user:{id:account}}:null}})},rpc:async(name)=>{reads.push(name);if(failure)throw Error('Transient refresh');if(name==='test_ops_snapshot')return {data:snapshot()};if(name==='test_ops_hl_overview')return {data:{orders:[]}};throw Error('UNEXPECTED_FIXTURE_READ:'+name);},channel:()=>({on(){return this;},subscribe(){return this;}})};
 w.getSupabaseBrowserClient=()=>c;
 const context=dom.getInternalVMContext(),model=new vm.SourceTextModule(modelSource,{context}),main=new vm.SourceTextModule(source,{context}),pdf=new vm.SourceTextModule(pdfSource,{context});
 await main.link(specifier=>{if(specifier==='./pdf.mjs')return pdf;assert.equal(specifier,'./operations-model.mjs');return model;});await main.evaluate();
 for(const view of ['hl','wingding','docks','mistakes','suspend','traffic']){
  await w.AgDataTestOperations.open(view);assert.equal(w.document.querySelector('#test-operations').hidden,false);assert.equal(w.document.querySelectorAll('.test-nav [data-view]').length,6);assert.ok(w.document.querySelector('.test-body'));
 }
 const navigation=[];w.switchView=v=>navigation.push(v);w.setReqTab=v=>navigation.push(v);w.getDockSuspendDcRequestMirrorRows=()=>[{UNIQUE_ID:'dock_suspend_dc_physical-1',DOCK_SUSPEND_SOURCE_UID:'physical-1'}];w.getDockSuspendDcRequestSourceUid=row=>row.DOCK_SUSPEND_SOURCE_UID;w.openDockSuspendDcRequestUpdate=(uid)=>{navigation.push(uid);return false;};
 await w.AgDataTestOperations.open('suspend');w.document.querySelector('[data-action="evaluation"]').click();assert.deepEqual(navigation,['request','suspend-tag','dock_suspend_dc_physical-1']);await w.AgDataTestOperations.open('traffic');
 assert.ok(w.document.querySelector('#view-traffic'));assert.match(w.document.body.textContent,/LOAD-1/);
 failure=true;await w.AgDataTestOperations.open('traffic');assert.match(w.document.body.textContent,/LOAD-1/);assert.match(w.document.body.textContent,/Transient refresh/);
 account=null;await w.AgDataTestOperations.open('traffic');assert.doesNotMatch(w.document.querySelector('.test-body').textContent,/LOAD-1/);
 assert.ok(reads.every(name=>['test_ops_snapshot','test_ops_hl_overview'].includes(name)));dom.window.close();
});
