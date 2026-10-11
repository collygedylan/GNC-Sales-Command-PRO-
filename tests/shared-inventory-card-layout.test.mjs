import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const html = fs.readFileSync('index.html','utf8');
function extract(name) {
  const start=html.indexOf('        function '+name+'(');
  const end=html.slice(start+20).search(/\n        (?:async )?function /);
  assert.ok(start>=0&&end>0);
  return html.slice(start,start+20+end);
}
test('shared header escapes identity fields and keeps zero quantity visible', () => {
  const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  const c=vm.createContext({esc:escape,firstNonEmptyValue:(...v)=>v.find(x=>x!=null&&String(x).trim()!==''),getDockStopOrDropValue:row=>row.STOPNUMBER});
  vm.runInContext(extract('buildSharedInventoryCardLayout'),c);
  const dom=new JSDOM(c.buildSharedInventoryCardLayout({COMMONNAME:'Plant <one>',ITEMCODE:'00012',DOCK_NUM:'D1',STOPNUMBER:'02',CONTSIZE:'#3'}, {operational:true,quantity:0,spec:'Tall <3>',metricsHtml:'<div data-metrics="shared"></div>'}));
  const root=dom.window.document;
  assert.equal(root.querySelector('.app-drive-card-title').textContent,'Plant <one>#3');
  assert.equal(root.querySelector('.app-drive-card-itemcode').textContent,'00012');
  assert.deepEqual([...root.querySelectorAll('.app-operational-card-header-field')].map(x=>x.textContent),['Dock NumberD1','Drop Number02','Qty0','SpecTall <3>']);
  assert.ok(root.querySelector('.app-drive-card-details .app-drive-card-quantity-band [data-metrics="shared"]'));
  dom.window.close();
});
test('all three views use the same layout and the six-metric renderer',()=>{
  assert.equal((html.match(/buildSharedInventoryCardLayout\(item, \{/g)||[]).length,3);
  assert.match(html,/metricsHtml: driveQuantityRowHtml/);
  assert.match(html,/sourceView: 'docks', preserveUnknown: true/);
  assert.match(html,/sourceView: 'request', preserveUnknown: true/);
  for(const label of ['On Hand','Review','Available','Open Stock','Loc Photo Match','Loc On Hand'])assert.ok(html.includes("'"+label+"'")||html.includes(label+':'));
});
test('operational metrics require a verified exact inventory row',()=>{
  let verified=true;
  const c=vm.createContext({getDatasetState:()=>({rowCompleteness:'complete',initialLoaded:true}),getCardLocationOnHandValue:()=>verified?'0':null,fullInventory:[{ITEMCODE:'0001',LOCATIONCODE:'A1',LOTCODE:'L1',PTRONHAND:0}],isSameDockSuspendDcRequestCardDataLocation:(a,b)=>['ITEMCODE','LOCATIONCODE','LOTCODE'].every(k=>a[k]===b[k])});
  c.masterInventoryByItemCode=new Map([['0001',c.fullInventory]]);
  c.getItemInquiryItemCode=row=>row.ITEMCODE;
  vm.runInContext(extract('getOperationalCardInventoryRow'),c);
  assert.equal(c.getOperationalCardInventoryRow({ITEMCODE:'0001',LOCATIONCODE:'A1',LOTCODE:'L1'}).PTRONHAND,0);
  assert.equal(Object.keys(c.getOperationalCardInventoryRow({ITEMCODE:'0001',LOCATIONCODE:'B1',LOTCODE:'L1'})).length,0);
  verified=false;
  assert.equal(Object.keys(c.getOperationalCardInventoryRow({ITEMCODE:'0001',LOCATIONCODE:'A1',LOTCODE:'L1'})).length,0);
});
