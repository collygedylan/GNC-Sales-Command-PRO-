import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const require = createRequire(import.meta.url);
const React = require('react');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'react') return React;
  return originalLoad.call(this, request, parent, isMain);
};
const built = await build({ entryPoints: [new URL('../components/historical-requests/HistoricalRequestsView.tsx', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react-dom', 'react/jsx-runtime'], jsx: 'automatic', loader: { '.css': 'empty' } });
const componentModule = { exports: {} };
require('vm').runInNewContext(built.outputFiles[0].text, { require, module: componentModule, exports: componentModule.exports,
  console, process, Error, globalThis, AbortController, Intl, Date, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask });
const { HistoricalRequestsView } = componentModule.exports;
const { render, screen, fireEvent, waitFor, cleanup } = require('@testing-library/react');
afterEach(() => cleanup());

const REP='rep:50000000-0000-4000-8000-000000000001';
const OTHER='rep:50000000-0000-4000-8000-000000000002';
const group=(key,label,value=900)=>({key,label,requestCount:1,totalValue:value,unpricedCount:1,customerKey:null,consigneeKey:null,consigneeName:null});
const folder=()=>({...group('g:east','Customer 001'),customerKey:'c:001',consigneeKey:'g:east',consigneeName:'East Yard'});
const requestRow=()=>({id:'req-1',customerName:'Customer 001',consigneeName:'East Yard',salesrepUserId:REP.slice(4),salesrepName:'Molly Dixon',
 itemcode:'00012',commonname:'Red Maple',location:'A.01',requestedAt:null,status:'Completed',requestQty:0,effectiveQty:25,listPrice:null,totalValue:null,
 unresolvedReason:'current_list_price_unavailable_or_invalid',dock:null,spec:'6–8 feet',caliper:'2 inches',comments:'Keep the tag',photoNotes:'Front view',
 photoLinks:['https://example.invalid/photo.jpg'],sentAt:'2026-10-10T12:00:00Z',deliveryState:'delivered'});
function pageFor(query,scope,rows,total=rows.length){return {scope,financials:scope==='all',recordKind:query.recordKind||'requests',ownRepKey:REP,
 revision:'rev1',generatedAt:'2026-10-10T12:00:00Z',page:query.page||0,pageSize:25,total,
 rows:rows.map(row=>scope==='own'?{...row,totalValue:null,unpricedCount:null,listPrice:'listPrice' in row?null:undefined,unresolvedReason:'unresolvedReason' in row?null:undefined}:row),
 summary:{requestCount:10,totalValue:scope==='all'?2500:null,unpricedCount:scope==='all'?2:null}};}
const archiveFolder=(value,label)=>({kind:'folder',key:`folder:${value}`,value,label,subtitle:'1 indexed record',recordCount:1,totalValue:null});
const archiveRecord=kind=>({kind:'record',id:`${kind}-1`,title:`${kind} Red Maple`,subtitle:'Indexed history',status:'Archived',occurredAt:'2026-10-10T12:00:00Z',
 itemcode:'00012',commonname:'Red Maple',contsize:'10G',locationcode:'A.01',lotcode:'L1',quantity:0,unitListPrice:null,lineDollarValue:null,
 photoLinks:['https://example.invalid/archive.jpg'],facts:{Dock:'0'},notes:['Permanent snapshot']});
function archivePage(query,rows){return {scope:'all',financials:false,recordKind:query.recordKind,operation:query.operation,path:query.path||[],
 depth:(query.path||[]).length,maxDepth:query.recordKind==='reserves'?4:3,revision:'archive-r1',generatedAt:'2026-10-10T12:00:00Z',
 page:query.page||0,pageSize:25,total:rows.length,rows};}
function makeBridge(scopeKey,overrides={}){const calls=[];return {calls,bridge:{scopeKey,role:scopeKey.startsWith('dylan:')?'Admin':scopeKey.startsWith('eval:')?'Eval':'Sales Rep',revisionKey:overrides.revisionKey||'rev1',read:async(query,signal)=>{
 calls.push({query,signal});if(overrides.read){const data=await overrides.read(query,signal);return query.operation==='summary'?{...data,rows:[],total:0}:data;}const scope=overrides.scope||'own';
 return pageFor(query,scope,query.operation==='reps'?[group(REP,'Molly Dixon')]:query.operation==='folders'?[folder()]:query.operation==='requests'?[requestRow()]:[]);
},readArchive:async(query,signal)=>{calls.push({query,signal});if(overrides.readArchive)return overrides.readArchive(query,signal);
 const depth=(query.path||[]).length;const rows=query.operation==='archive-search'||query.operation==='archive-records'?[archiveRecord(query.recordKind)]:[archiveFolder(`${depth+1}`,`Folder ${depth+1}`)];
 return archivePage(query,rows);}}};}
async function openFolder(all=false){if(all)fireEvent.click(await screen.findByRole('button',{name:/Molly Dixon/}));fireEvent.click(await screen.findByRole('button',{name:/Customer 001/}));}

test('report lookup choices retain their DOM and options while a revision refresh is pending', async () => {
 let hold = false; const releases = [];
 const fixture = makeBridge('dylan:directory-cache', { read: async query => {
  if (hold && query.recordKind === 'all') await new Promise(resolve => releases.push(resolve));
  return pageFor(query, 'all', query.operation === 'reps' ? [group(REP, 'Molly Dixon')]
   : query.operation === 'customers' ? [group('c:001', 'Customer 001')] : []);
 }});
 const view = render(React.createElement(HistoricalRequestsView, { bridge: fixture.bridge }));
 const select = await screen.findByLabelText('Reporting customer');
 await waitFor(() => assert.match(select.textContent, /Customer 001/));
 hold = true;
 view.rerender(React.createElement(HistoricalRequestsView, { bridge: { ...fixture.bridge, revisionKey: 'rev2' } }));
 await waitFor(() => assert.ok(releases.length));
 assert.equal(screen.getByLabelText('Reporting customer'), select);
 assert.match(select.textContent, /Customer 001/);
 hold = false; releases.forEach(resolve => resolve());
 await waitFor(() => assert.match(select.textContent, /Customer 001/));
});

test('drills rep to exact customer/consignee folder and renders specs, photos, sent data and unresolved pricing for Dylan',async()=>{
 const fixture=makeBridge('dylan:all',{scope:'all'});render(React.createElement(HistoricalRequestsView,{bridge:fixture.bridge}));await openFolder(true);
 await screen.findByText('Unresolved value: Current master list price is unavailable or invalid.');await screen.findByText('6–8 feet');
 assert.equal(screen.getByRole('img',{name:'Request photo 1'}).getAttribute('src'),'https://example.invalid/photo.jpg');await screen.findByText('delivered');
 const q=fixture.calls.find(call=>call.query.operation==='requests').query;assert.equal(q.repKey,REP);assert.equal(q.customerKey,'c:001');assert.equal(q.consigneeKey,'g:east');
});
test('defaults a rep to their own folders and renders financials only after server confirms Dylan all scope',async()=>{
 const own=makeBridge('rep:own');render(React.createElement(HistoricalRequestsView,{bridge:own.bridge}));await screen.findByRole('button',{name:/Customer 001/});
 assert.equal(screen.queryByRole('heading',{name:'Sales Reps'}),null);assert.equal(document.body.textContent.includes('$'),false);
 assert.equal(own.calls.filter(call=>call.query.operation==='folders').every(call=>call.query.repKey===REP),true);
 cleanup();const all=makeBridge('dylan:all',{scope:'all'});render(React.createElement(HistoricalRequestsView,{bridge:all.bridge}));await screen.findByRole('heading',{name:'Sales Reps'});await screen.findByText('$2,500.00');
});
test('hides server-claimed financials from Eval and redacts the page before it enters the view cache',async()=>{
 const fixture=makeBridge('eval:all',{scope:'all',read:async query=>pageFor(query,'all',query.operation==='reps'?[{...group(REP,'Molly Dixon',2500)}]:[])});
 render(React.createElement(HistoricalRequestsView,{bridge:fixture.bridge}));await screen.findByRole('heading',{name:'Sales Reps'});
 assert.equal(document.body.textContent.includes('$'),false);assert.equal(screen.queryByRole('heading',{name:'Executive reporting'}),null);
});
test('fails closed on all-scope customer values when the rep endpoint returns own scope',async()=>{
 const fixture=makeBridge('actor:own',{read:async query=>query.operation==='reps'?pageFor(query,'own',[group(REP,'Own Rep')]):pageFor(query,'all',[{...folder(),label:'Confidential Customer',totalValue:7777}])});
 render(React.createElement(HistoricalRequestsView,{bridge:fixture.bridge}));await screen.findByText('Data scope could not be confirmed.');
 assert.equal(screen.queryByRole('button',{name:/Confidential Customer/}),null);assert.equal(screen.queryByText('$7,777.00'),null);
});
test('keeps authorization probe active through drilldown and hides cached details after error or scope downgrade',async()=>{
 for(const outcome of ['error','own']){cleanup();let mode='all';const fixture=makeBridge('dylan:'+outcome,{read:async query=>{
  if(query.operation==='reps'){if(mode==='error')throw new Error('Rep scope unavailable.');return pageFor(query,mode,[group(REP,'Molly Dixon')]);}
  return pageFor(query,'all',query.operation==='folders'?[folder()]:[{...requestRow(),commonname:'Confidential Plant',requestQty:1,effectiveQty:1,listPrice:6000,totalValue:6000,unresolvedReason:null}]);
 }});const view=render(React.createElement(HistoricalRequestsView,{bridge:fixture.bridge}));await openFolder(true);await screen.findByText('Confidential Plant');
 mode=outcome;view.rerender(React.createElement(HistoricalRequestsView,{bridge:{...fixture.bridge,revisionKey:'rev2'}}));await screen.findByText('Data scope could not be confirmed.');
 assert.equal(screen.queryByText('Confidential Plant'),null);assert.equal(screen.queryByText('$6,000.00'),null);assert.equal(screen.queryByRole('button',{name:/Customer 001/}),null);
 assert.ok(screen.getByRole('button',{name:'Return to customers and refresh'}));}
});
test('account change replaces private SWR cache and aborts the previous account read',async()=>{
 let oldSignal;const first=makeBridge('actor-a',{read:(query,signal)=>{oldSignal=signal;return new Promise(()=>{});}});const view=render(React.createElement(HistoricalRequestsView,{bridge:first.bridge}));
 await waitFor(()=>assert.ok(oldSignal));const second=makeBridge('actor-b');view.rerender(React.createElement(HistoricalRequestsView,{bridge:second.bridge}));await screen.findByRole('button',{name:/Customer 001/});assert.equal(oldSignal.aborted,true);
 assert.equal(document.body.textContent.includes('$'),false);
});
test('role change with a reused scope key replaces the finance cache and aborts an in-flight Admin read',async()=>{
 let adminSignal,finishAdminRead;const scopeKey='shared-session';const admin=makeBridge(scopeKey,{read:(query,signal)=>{
  if(query.operation==='requests')return new Promise(resolve=>{adminSignal=signal;finishAdminRead=()=>resolve(pageFor(query,'all',[{...requestRow(),requestQty:1,effectiveQty:1,listPrice:6000,totalValue:6000,unresolvedReason:null}]))});
  return pageFor(query,'all',query.operation==='reps'?[group(REP,'Molly Dixon')]:query.operation==='folders'?[folder()]:[]);
 }});admin.bridge.role='Admin';
 const view=render(React.createElement(HistoricalRequestsView,{bridge:admin.bridge}));await openFolder(true);await waitFor(()=>assert.ok(adminSignal));
 const evalBridge=makeBridge(scopeKey,{scope:'all'}).bridge;evalBridge.role='Eval';
 view.rerender(React.createElement(HistoricalRequestsView,{bridge:evalBridge}));await screen.findByRole('heading',{name:'Sales Reps'});
 assert.equal(adminSignal.aborted,true);assert.equal(document.body.textContent.includes('$'),false);assert.equal(screen.queryByRole('heading',{name:'Executive reporting'}),null);
 finishAdminRead();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(document.body.textContent.includes('$'),false);
});
test('hides prior rows and exposes retry when the current request read fails',async()=>{
 let attempt=0;const fixture=makeBridge('actor:own',{read:async query=>{if(query.operation==='reps')return pageFor(query,'own',[group(REP,'Molly Dixon')]);
  if(++attempt===1)return pageFor(query,'own',[folder()]);throw new Error('History service unavailable.');}});
 render(React.createElement(HistoricalRequestsView,{bridge:fixture.bridge}));await screen.findByRole('button',{name:/Customer 001/});fireEvent.click(screen.getByRole('button',{name:'Refresh'}));await screen.findByRole('alert');
 assert.equal(screen.queryByRole('button',{name:/Customer 001/}),null);assert.ok(screen.getByText('History service unavailable.'));
});
test('requests next server folder page instead of aggregating only the initial page',async()=>{
 const fixture=makeBridge('dylan:all',{read:async query=>query.operation==='reps'?pageFor(query,'all',[group(REP,'Molly Dixon')]):
  {...pageFor(query,'all',[{...folder(),key:query.page?'g:south':'g:north',label:query.page?'South Nursery':'North Nursery'}],2),pageSize:1}});
 render(React.createElement(HistoricalRequestsView,{bridge:fixture.bridge}));fireEvent.click(await screen.findByRole('button',{name:/Molly Dixon/}));await screen.findByRole('button',{name:/North Nursery/});fireEvent.click(screen.getByRole('button',{name:'Next'}));await screen.findByRole('button',{name:/South Nursery/});
 assert.ok(fixture.calls.some(call=>call.query.operation==='folders'&&call.query.page===1));
});
test('exposes exactly four archive tabs with indexed drilldown and per-domain search',async()=>{
 const fixture=makeBridge('rep:own');render(React.createElement(HistoricalRequestsView,{bridge:fixture.bridge}));
 const tabNames=['Historical Requests','Historical SOC Open Orders','Historical SOC Reserves','Historical Drive Around'];
 assert.deepEqual(tabNames.map(name=>screen.getByRole('button',{name}).textContent),tabNames);
 const search=screen.getByRole('searchbox',{name:'Search this archive'});fireEvent.change(search,{target:{value:'maple'}});
 await screen.findByText('requests Red Maple');assert.ok(fixture.calls.some(call=>call.query.operation==='archive-search'&&call.query.recordKind==='requests'));
 for(const [name,kind] of [['Historical SOC Open Orders','orders'],['Historical SOC Reserves','reserves'],['Historical Drive Around','drive']]){
  fireEvent.click(screen.getByRole('button',{name}));await screen.findByText(`${kind} Red Maple`);
  assert.ok(fixture.calls.some(call=>call.query.operation==='archive-search'&&call.query.recordKind===kind));
 }
 fireEvent.click(screen.getByRole('button',{name:'Clear'}));await screen.findByRole('button',{name:/Folder 1/});
 for(let depth=1;depth<=3;depth++)fireEvent.click(await screen.findByRole('button',{name:new RegExp(`Folder ${depth}`)}));
 await screen.findByText('drive Red Maple');assert.ok(fixture.calls.some(call=>call.query.operation==='archive-records'&&call.query.recordKind==='drive'&&call.query.path.length===3));
});
test('rejects foreign-owner detail rows and unsafe photo links without weakening displayed ownership checks',async()=>{
 const fixture=makeBridge('rep:own',{read:async query=>pageFor(query,'own',query.operation==='reps'?[group(REP,'Molly Dixon')]:query.operation==='folders'?[folder()]:[{...requestRow(),salesrepUserId:OTHER.slice(4),commonname:'Other Rep Secret'}])});
 render(React.createElement(HistoricalRequestsView,{bridge:fixture.bridge}));await openFolder();await screen.findByText('Data scope could not be confirmed.');assert.equal(screen.queryByText('Other Rep Secret'),null);
 const {historicalPhotoUrls}=componentModule.exports;assert.deepEqual(Array.from(historicalPhotoUrls(['javascript:alert(1)','//untrusted.invalid/photo','https://example.invalid/photo.jpg','["https://example.invalid/photo.jpg"]'])),['https://example.invalid/photo.jpg']);
});
test('executive month, rep and customer filters query complete server totals and monthly grouping',async()=>{
 const fixture=makeBridge('dylan:reports',{scope:'all'});render(React.createElement(HistoricalRequestsView,{bridge:fixture.bridge}));
 await screen.findByRole('heading',{name:'Executive reporting'});
 fireEvent.change(screen.getByLabelText('Period'),{target:{value:'month'}});
 fireEvent.change(screen.getByLabelText('Month'),{target:{value:'2026-02'}});
 fireEvent.change(screen.getByLabelText('Group totals'),{target:{value:'months'}});
 await waitFor(()=>assert.ok(fixture.calls.some(call=>call.query.operation==='months'&&call.query.dateFrom==='2026-02-01'&&call.query.dateTo==='2026-02-28')));
 fireEvent.change(screen.getByLabelText('Reporting rep'),{target:{value:REP}});
 await waitFor(()=>assert.ok(fixture.calls.some(call=>call.query.operation==='months'&&call.query.repKey===REP)));
 assert.ok(fixture.calls.some(call=>call.query.operation==='customers'&&call.query.pageSize===100));
 cleanup();const own=makeBridge('rep:no-finance');render(React.createElement(HistoricalRequestsView,{bridge:own.bridge}));await screen.findByRole('button',{name:/Customer 001/});
 assert.equal(screen.queryByRole('heading',{name:'Executive reporting'}),null);assert.equal(document.body.textContent.includes('$'),false);
});
test('invalid reporting range retains inputs, hides values and does not query a reversed range',async()=>{
 const fixture=makeBridge('dylan:range',{scope:'all'});render(React.createElement(HistoricalRequestsView,{bridge:fixture.bridge}));await screen.findByRole('heading',{name:'Executive reporting'});
 fireEvent.change(screen.getByLabelText('Period'),{target:{value:'range'}});fireEvent.change(screen.getByLabelText('From date'),{target:{value:'2026-10-02'}});
 fireEvent.change(screen.getByLabelText('Through date'),{target:{value:'2026-10-01'}});await screen.findByText('The through date must be on or after the from date.');
 assert.equal(screen.getByLabelText('From date').value,'2026-10-02');assert.equal(document.body.textContent.includes('$'),false);
 assert.equal(fixture.calls.some(call=>call.query.dateFrom==='2026-10-02'&&call.query.dateTo==='2026-10-01'),false);
});
test('an executive report scope downgrade hides all cached dollar values immediately',async()=>{
 const fixture=makeBridge('dylan:downgrade',{read:async query=>pageFor(query,query.operation==='months'?'own':'all',
  query.operation==='summary'?[]:query.operation==='reps'?[group(REP,'Molly Dixon')]:[folder()])});
 render(React.createElement(HistoricalRequestsView,{bridge:fixture.bridge}));await screen.findByRole('heading',{name:'Executive reporting'});
 fireEvent.change(screen.getByLabelText('Group totals'),{target:{value:'months'}});await screen.findByText('Dashboard scope could not be confirmed.');
 assert.equal(document.body.textContent.includes('$'),false);
});
