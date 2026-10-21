import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const html = readComposedAppSource();
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
test('operational cards use N/A for a missing location while other cards keep their existing fallback', () => {
  const c=vm.createContext({
    esc:value=>String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
    firstNonEmptyValue:(...v)=>v.find(x=>x!=null&&String(x).trim()!==''),
    getDockStopOrDropValue:row=>row.STOPNUMBER
  });
  vm.runInContext(extract('buildSharedInventoryCardLayout'),c);
  const operational=new JSDOM(c.buildSharedInventoryCardLayout({COMMONNAME:'Tree',ITEMCODE:'A1'}, {operational:true,operationalMissingValue:'N/A'}));
  const regular=new JSDOM(c.buildSharedInventoryCardLayout({COMMONNAME:'Tree',ITEMCODE:'A1'}, {}));
  assert.match(operational.window.document.querySelector('.app-drive-card-meta').textContent,/^N\/A/);
  assert.match(regular.window.document.querySelector('.app-drive-card-meta').textContent,/^No Loc/);
  operational.window.close();
  regular.window.close();
});
test('operational metadata precedes Dock/Drop/Qty/Spec chips in the shared card hierarchy', () => {
  const c=vm.createContext({
    esc:value=>String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
    firstNonEmptyValue:(...v)=>v.find(x=>x!=null&&String(x).trim()!==''),
    getDockStopOrDropValue:row=>row.STOPNUMBER
  });
  vm.runInContext(extract('buildSharedInventoryCardLayout'),c);
  const markup=c.buildSharedInventoryCardLayout({COMMONNAME:'Tree',ITEMCODE:'A1',DOCK_NUM:'D1',STOPNUMBER:'2'}, {
    operational:true, quantity:'8', spec:'Full',
    operationalMetaHtml:'<div class="app-operational-card-meta"><span>Sales RepSally</span><span>Request Qty8</span></div>'
  });
  const dom=new JSDOM(markup), root=dom.window.document;
  const meta=root.querySelector('.app-operational-card-meta');
  const fields=root.querySelector('.app-operational-card-header-fields');
  assert.ok(meta && fields);
  assert.ok(meta.compareDocumentPosition(fields) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
    'Sales Rep and Request Qty appear before Dock Number, Drop Number, Qty, and Spec');
  assert.deepEqual([...fields.querySelectorAll('.app-operational-card-header-field')].map(x=>x.textContent),['Dock NumberD1','Drop Number2','Qty8','SpecFull']);
  dom.window.close();
});

test('compact Suspend publishes the current order strip below its header rail while leaving shared Docks layout unchanged', () => {
  const c=vm.createContext({esc:value=>String(value ?? ''),firstNonEmptyValue:(...v)=>v.find(x=>x!=null&&String(x).trim()!==''),getDockStopOrDropValue:row=>row.STOPNUMBER});
  vm.runInContext(extract('buildSharedInventoryCardLayout'),c);
  c.item = { DOCK_NUM:'Dock 30', STOPNUMBER:'4' };
  c.requestConsignee = 'Consignee'; c.suspendSalesRep = 'Sales Rep';
  c.getDockDisplayQty = () => 0; c.formatDockDisplayQty = String;
  const stripStart = html.indexOf('                const suspendOrderField =');
  const stripEnd = html.indexOf('                const suspendHoldstopCode =', stripStart);
  vm.runInContext(html.slice(stripStart, stripEnd) + '\nthis.orderStripHtml = suspendOrderStripHtml;', c);
  const dom=new JSDOM(c.buildSharedInventoryCardLayout({COMMONNAME:'Tree',DOCK_NUM:'Dock 30',STOPNUMBER:'4',LOCATIONCODE:'I.12.000'}, {
    operational:true,compactSuspend:true,quantity:0,spec:'Full',planstartValue:'10/19/2026',actionsHtml:'<div class="app-drive-card-reclass"><button>Reclass</button></div>',
    orderStripHtml:c.orderStripHtml, operationalMetaHtml:'<div class="app-operational-card-meta">Consignee, Sales Rep</div>', detailsHtml:'<div>SpecFull</div>'
  }));
  const root=dom.window.document,fields=root.querySelector('.app-suspend-tag-order-strip');
  assert.equal(root.querySelector('.app-drive-card-details').firstElementChild,fields);
  assert.deepEqual([...fields.querySelectorAll('.app-suspend-tag-order-field')].map(node=>node.textContent),['Dock30','Drop4','Qty0','ConsigneeConsignee','Sales RepSales Rep']);
  assert.equal(root.querySelector('.app-drive-card-header .app-suspend-tag-order-strip'),null);
  const headerRow=root.querySelector('.app-suspend-tag-header-row');
  const textColumn=headerRow?.querySelector(':scope > .app-suspend-tag-text-column');
  const reclassRail=headerRow?.querySelector(':scope > .app-drive-card-reclass');
  assert.ok(headerRow && textColumn && reclassRail,'compact Suspend keeps Reclass in its independent header rail');
  assert.equal(textColumn.nextElementSibling,reclassRail,'the Reclass rail is beside, not nested in, the text column');
  assert.ok(textColumn.querySelector('.app-drive-card-title-row .app-drive-card-title'));
  assert.equal(root.querySelector('.app-drive-card-header .app-operational-planstart-date'),null);
  assert.match(root.querySelector('.app-drive-card-details').textContent,/SpecFull/);
  dom.window.close();
  const zeroDock=new JSDOM(c.buildSharedInventoryCardLayout({DOCK_NUM:0}, {operational:true}));
  assert.equal(zeroDock.window.document.querySelector('.app-operational-card-header-field strong').textContent,'0');
  zeroDock.window.close();
});
test('all three views use the same layout and the six-metric renderer',()=>{
  assert.equal((html.match(/buildSharedInventoryCardLayout\(item, \{/g)||[]).length,3);
  assert.match(html,/metricsHtml: driveQuantityRowHtml/);
  assert.match(html,/sourceView: 'docks', preserveUnknown: true/);
  assert.match(html,/sourceView: 'request', preserveUnknown: true/);
  for(const label of ['On Hand','Review','Available','Open Stock','Loc Photo Match','Loc On Hand'])assert.ok(html.includes("'"+label+"'")||html.includes(label+':'));
});

test('Docks details preserve field chips without duplicating the six inventory metrics',()=>{
  const docks=html.slice(html.indexOf("if(sourceView === 'docks'){"),html.indexOf("if(sourceView==='sales-office-order'){"));
  assert.ok(docks.includes('buildSharedInventoryCardLayout(item, {'));
  assert.match(docks,/detailsHtml: `\$\{buildInventoryCardFieldChipsHtml\(item, \{ compact: true \}\)\}\$\{noteHtml\}\$\{inventoryEditActionHtml\}\$\{actionBtns\}`/);
  assert.doesNotMatch(docks,/\$\{compactCardFieldChipsHtml\}/);
  assert.equal((docks.match(/buildInventoryQuantityChipsHtml\(/g)||[]).length,1);
  assert.match(docks,/operationalMetaHtml: dockMetaHtml/);
  assert.match(docks,/getDockSuspendDcRequestPlanstartInfo\(item\)/);
  assert.match(docks,/const dockInventoryRow = getOperationalCardInventoryRow\(item\)/);
  assert.match(docks,/buildInventoryQuantityChipsHtml\(dockInventoryRow, \{[\s\S]*?locationMetricItem: dockInventoryRow/);
  assert.match(docks,/Sales Rep/);
  assert.match(docks,/Request Qty/);
  const weekdayStart=html.indexOf('.app-smart-card.app-card-planstart-monday');
  const weekdayTones=html.slice(weekdayStart,html.indexOf('</style>',weekdayStart));
  for(const [tone,color] of Object.entries({monday:'#f3e8ff',tuesday:'#ffe4e6',wednesday:'#dcfce7',thursday:'#dbeafe',friday:'#e2e8f0'})) {
    assert.ok(weekdayTones.includes(`app-card-planstart-${tone}`),`shared pastel palette includes ${tone}`);
    assert.ok(weekdayTones.includes(color),`${tone} uses its specified pastel color`);
  }
  assert.match(html,/#docks-content \.app-operational-planstart-card\[class\*="app-planstart-"\][\s\S]*?color:#111827/);
});
test('native registry and legacy Docks loading cohorts include master inventory for verified card metrics',()=>{
  const registry=fs.readFileSync('assets/live-sync-registry.js','utf8');
  assert.match(registry,/docks:\s*data\(\['soc',\s*'master',\s*'customerRepMap'\]/);
  assert.match(html,/if \(viewId === 'docks'\) return withEvalInventoryEditRequestsForRowView\(\{ required: \[\{ key: 'soc', mode: 'full' \}\], background: \[\{ key: 'master', mode: 'full' \}\]/);
});
test('operational metrics require a verified exact inventory row',()=>{
  let verified=true;
  const c=vm.createContext({getDatasetState:()=>({rowCompleteness:'complete',initialLoaded:true}),nativeAuthSessionActive:false,nativeAuthProfile:null,getCardLocationOnHandValue:()=>verified?'0':null,fullInventory:[{ITEMCODE:'0001',LOCATIONCODE:'A1',LOTCODE:'L1',PTRONHAND:0}],isSameDockSuspendDcRequestCardDataLocation:(a,b)=>['ITEMCODE','LOCATIONCODE','LOTCODE'].every(k=>a[k]===b[k]),getSuspendTagInventoryIdentity:row=>row,matchesSuspendTagInventoryIdentity:()=>true,getSuspendTagHydratedInventoryRow:()=>null,findDockSuspendDcRequestSourceRow:()=>null});
  c.masterInventoryByItemCode=new Map([['0001',c.fullInventory]]);
  c.isDockSuspendDcRequestMirrorRow = () => false;
  c.getItemInquiryItemCode=row=>row.ITEMCODE;
  vm.runInContext(extract('getOperationalCardInventoryRow'),c);
  assert.equal(c.getOperationalCardInventoryRow({ITEMCODE:'0001',LOCATIONCODE:'A1',LOTCODE:'L1'}).PTRONHAND,0);
  assert.equal(Object.keys(c.getOperationalCardInventoryRow({ITEMCODE:'0001',LOCATIONCODE:'B1',LOTCODE:'L1'})).length,0);
  verified=false;
  assert.equal(c.getOperationalCardInventoryRow({ITEMCODE:'0001',LOCATIONCODE:'A1',LOTCODE:'L1'}).PTRONHAND,0,
    'an unavailable location aggregate does not erase independently verified inventory fields');
});

test('Docks operational metrics render N/A for missing values without changing other card defaults',()=>{
  const c=vm.createContext({
    escapeHtml:value=>String(value ?? ''),
    normalizeCardQuantityValue:value=>value == null || String(value).trim()==='' ? '0' : String(value),
    getCardPtrOnHandValue:()=>null, getCardPtrReviewedValue:()=>null, getCardPtrAvailableValue:()=>null,
    getCardOpenStockValue:()=>null, formatLocPhotoMatchQtyValue:()=> 'Not verified',
    getCardLocationOnHandValue:()=>null
  });
  vm.runInContext(extract('buildInventoryQuantityChipsHtml'),c);
  const docks=new JSDOM(c.buildInventoryQuantityChipsHtml({}, {layout:'row',sourceView:'docks',preserveUnknown:true,missingValue:'N/A'}));
  assert.deepEqual([...docks.window.document.querySelectorAll('.app-card-qty-value')].map(node=>node.textContent),Array(6).fill('N/A'));
  docks.window.close();
  const other=new JSDOM(c.buildInventoryQuantityChipsHtml({}, {layout:'row',sourceView:'other',preserveUnknown:true}));
  assert.deepEqual([...other.window.document.querySelectorAll('.app-card-qty-value')].map(node=>node.textContent), Array(6).fill('--'));
  other.window.close();
});

test('verified Dock metrics preserve zero and location values from one exact hydrated row',()=>{
  const c=vm.createContext({
    escapeHtml:value=>String(value ?? ''),
    normalizeCardQuantityValue:value=>String(value ?? ''),
    getCardPtrOnHandValue:row=>row?.PTRONHAND ?? null,
    getCardPtrReviewedValue:row=>row?.PTRREVIEWED ?? null,
    getCardPtrAvailableValue:row=>row?.PTRAVAILABLE ?? null,
    getCardOpenStockValue:row=>row?.S_LTS ?? null,
    formatLocPhotoMatchQtyValue:row=>row?.LOC_PHOTO_MATCH ?? 'Not verified',
    getCardLocationOnHandValue:row=>row?.LOC_ON_HAND ?? null
  });
  vm.runInContext(extract('buildInventoryQuantityChipsHtml'),c);
  const row={PTRONHAND:0,PTRREVIEWED:4,PTRAVAILABLE:7,S_LTS:8,LOC_PHOTO_MATCH:5,LOC_ON_HAND:9};
  const dom=new JSDOM(c.buildInventoryQuantityChipsHtml(row,{layout:'row',sourceView:'docks',locationMetricItem:row,preserveUnknown:true,missingValue:'N/A'}));
  assert.deepEqual([...dom.window.document.querySelectorAll('.app-card-qty-value')].map(node=>node.textContent),['0','4','7','8','5','9']);
  dom.window.close();
});
