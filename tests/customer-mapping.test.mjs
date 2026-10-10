import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { mappingBrowserBundle, requestMappingFunctions, requestMappingSetup, mappingFixtureRow as row } from './helpers/customer-mapping-fixture.mjs';

function requestFixture() {
  const context=vm.createContext({document:{getElementById:()=>({value:'Custom Customer'})}});
  vm.runInContext(requestMappingSetup+'\n'+requestMappingFunctions(),context);
  context.customerRepMapRows=[row,{...row,unique_id:'map-2',customeridentityid:'00013',consigneeid:'00008'},
    {...row,unique_id:'inactive',consigneestatus:'I'}, {...row,unique_id:'unassigned',salesrepid:''},
    {...row,unique_id:'other',salesrepname:'Rep Two',customeridentityid:'other'}];
  context.reservesInventory=[{...row,customername:'Reserve only',customeridentityid:'reserve'}];
  return context;
}
test('Request options require active mapped identities; reserve and custom fallbacks are excluded',()=>{
  const c=requestFixture();
  const options=c.getRequestModalCustomerOptionsForRep('Rep One');
  assert.equal(options.length,2);
  assert.deepEqual(Array.from(options, o=>o.customeridentityid),['00012','00013']);
  assert.equal(c.buildRequestCustomerPickerGroups(options).length,2,'identical display names stay distinct');
  assert.equal(c.getRequestModalCustomerOptionsForRep('Unknown Rep').length,0);
  c.processCustStep(); assert.equal(c.qtyCalls.length,0); assert.equal(c.toasts.length,1);
});
test('Request membership rechecks both IDs, names and the current map revision',()=>{
  const c=requestFixture(); const context={customeridentityid:row.customeridentityid,consigneeidentityid:row.consigneeid,customername:row.customername,consigneename:row.consigneename};
  assert.equal(c.isCurrentRequestCustomerContext(context),true);
  assert.equal(c.isCurrentRequestCustomerContext({...context,consigneeidentityid:'00008'}),false);
  c.customerRepMapRows=[];c.mappingRevision='2';
  assert.equal(c.isCurrentRequestCustomerContext(context),false);
});
test('rejected mapping submissions require review while transport failures remain retryable',()=>{
  const c=requestFixture();
  assert.equal(c.getRequestOutboxFailureStatus(new Error('REQUEST_CUSTOMER_MAPPING_REQUIRED')),'mapping-review');
  assert.equal(c.getRequestOutboxFailureStatus(new Error('Network unavailable')),'pending');
  assert.equal(c.isRequestCustomerMappingError(null),false);
});
test('mapping response validation rejects unbounded or malformed database results',()=>{
  const dom=new JSDOM('<div id="root"></div>',{runScripts:'outside-only'});dom.window.eval(mappingBrowserBundle());
  const api=dom.window.MappingEditor;
  assert.equal(api.mappingRow(row).customeridentityid,'00012');
  assert.throws(()=>api.mappingRow({...row,salesrepid:17}));
  assert.throws(()=>api.mappingPage({ok:true,rows:[row],total:1,page:0,pageSize:500,revision:'1',canEdit:true}));
  dom.window.close();
});
test('mapping editor preserves drafts on conflicts and sends expected revision without source IDs',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{runScripts:'outside-only'});dom.window.eval(mappingBrowserBundle());
  const calls=[];let saves=0;
  const root=dom.window.document.getElementById('root');
  const unmount=dom.window.MappingEditor.mountCustomerRepMapping(root,async payload=>{
    calls.push(payload);
    if(payload.operation==='save')throw new dom.window.Error('Mapping changed. Cancel and refresh.');
    return {ok:true,rows:[{...row,customerstatus:' a ',consigneestatus:'a'}],total:1,page:0,pageSize:50,revision:'3',canEdit:true};
  },()=>saves++);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(root.querySelector('tbody tr').children[4].textContent,'Active','status labels use the same normalization as the server');
  Array.from(root.querySelectorAll('button')).find(b=>b.textContent==='Edit').click();
  const form=root.querySelector('form');form.querySelector('input').value='02';
  form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(calls.at(-1).expectedRevision,'3');assert.equal(calls.at(-1).salesrepId,'02');
  assert.equal(Object.hasOwn(calls.at(-1),'customeridentityid'),false);
  assert.equal(root.querySelector('form input').value,'02'); assert.equal(saves,0);
  assert.match(root.querySelector('[role=alert]').textContent,/Mapping changed/);
  unmount();dom.window.close();
});

test('mapping editor cancels obsolete reads and never paints results after unmount',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{runScripts:'outside-only'});dom.window.eval(mappingBrowserBundle());
  const requests=[];const root=dom.window.document.getElementById('root');
  const unmount=dom.window.MappingEditor.mountCustomerRepMapping(root,(_payload,signal)=>new Promise(resolve=>requests.push({resolve,signal})),()=>{});
  Array.from(root.querySelectorAll('button')).find(b=>b.textContent==='Refresh').click();
  assert.equal(requests[0].signal.aborted,true);
  requests[1].resolve({ok:true,rows:[{...row,customername:'Current'}],total:1,page:0,pageSize:50,revision:'4',canEdit:true});
  await new Promise(resolve=>setTimeout(resolve,0));
  requests[0].resolve({ok:true,rows:[{...row,customername:'Stale'}],total:1,page:0,pageSize:50,revision:'3',canEdit:true});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.match(root.textContent,/Current/);assert.doesNotMatch(root.textContent,/Stale/);
  root.dispatchEvent(new dom.window.Event('mapping-revision'));
  unmount();assert.equal(requests[2].signal.aborted,true);
  requests[2].resolve({ok:true,rows:[row],total:1,page:0,pageSize:50,revision:'5',canEdit:true});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(root.textContent,'');dom.window.close();
});
