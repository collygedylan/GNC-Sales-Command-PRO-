import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { mappingBrowserBundle, requestMappingFunctions, requestMappingSetup, mappingFixtureRow as row } from './helpers/customer-mapping-fixture.mjs';

const requestSubmissionSource = readFileSync(new URL('../assets/request-submission.js', import.meta.url), 'utf8');
const requestSubmissionSandbox = { window: {} };
vm.runInNewContext(requestSubmissionSource, requestSubmissionSandbox);
const requestSubmissionApi = requestSubmissionSandbox.window.AgMetricRequestSubmission;
const appSource = readComposedAppSource();

function extractAppFunction(name) {
  const start = appSource.indexOf(`        function ${name}(`);
  assert.ok(start >= 0, `expected ${name} in index.html`);
  const tail = appSource.slice(start);
  const end = tail.slice(20).search(/\n        (?:async )?function /);
  assert.ok(end >= 0, `expected a function boundary after ${name}`);
  return tail.slice(0, end + 20);
}

function addAppFunction(context, name) {
  vm.runInContext(extractAppFunction(name), context);
}

function resolveMappedPayload(context) {
  const options = context.getRequestModalCustomerOptionsForRep(context.tempSelectedReqRep);
  return requestSubmissionApi.resolveCustomerMappingPayload(context.tempRequestCustomerSelectedContext, options, true);
}

function requestFixture() {
  const context=vm.createContext({window:{},document:{getElementById:()=>({value:'Custom Customer'})}});
  vm.runInContext(requestMappingSetup+'\n'+requestMappingFunctions(),context);
  context.customerRepMapRows=[row,{...row,unique_id:'map-2',customeridentityid:'00013',consigneeid:'00008'},
    {...row,unique_id:'inactive',consigneestatus:'I'}, {...row,unique_id:'unassigned',salesrepid:''},
    {...row,unique_id:'other',salesrepid:'02',salesrepname:'Rep Two',customeridentityid:'other'}];
  context.reservesInventory=[{...row,customername:'Reserve only',customeridentityid:'reserve'}];
  return context;
}
test('Request options include active full-directory identities while reserve and custom fallbacks stay excluded',()=>{
  const c=requestFixture();
  const options=c.getRequestModalCustomerOptionsForRep('Rep One');
  assert.equal(options.length,3);
  assert.deepEqual(Array.from(options, o=>o.customeridentityid).sort(),['00012','00013','other']);
  assert.equal(c.buildRequestCustomerPickerGroups(options).length,3,'identical display names stay distinct');
  assert.equal(c.getRequestModalCustomerOptionsForRep('Unknown User').length,3);
  c.processCustStep(); assert.equal(c.qtyCalls.length,0); assert.equal(c.toasts.length,1);
});
test('Request matching uses production normalization for rep aliases, statuses, duplicate names, and leading-zero IDs',()=>{
  const c=requestFixture();
  const mollyRows=[
    {...row,unique_id:'molly-1',customeridentityid:'000041',consigneeid:'000071',salesrepid:'0003',salesrepname:'Molly Dixon',customername:'Shared Customer',consigneename:'North'},
    {...row,unique_id:'molly-2',customeridentityid:'000042',consigneeid:'000072',salesrepid:'0003',salesrepname:'Molly Dixon',customername:'Shared Customer',consigneename:'South'},
    {...row,unique_id:'molly-inactive-customer',customeridentityid:'000043',consigneeid:'000073',salesrepid:'0003',salesrepname:'Molly Dixon',customerstatus:'I'},
    {...row,unique_id:'molly-inactive-consignee',customeridentityid:'000044',consigneeid:'000074',salesrepid:'0003',salesrepname:'Molly Dixon',consigneestatus:'I'},
    {...row,unique_id:'unrelated-rep',customeridentityid:'000045',consigneeid:'000075',salesrepid:'0004',salesrepname:'Morgan Smith'}
  ];
  c.customerRepMapRows=mollyRows;
  for (const rep of ['Molly Dixon','Dixon, Molly','molly_dixon','  MOLLY   DIXON  ']) {
    const options=c.getRequestModalCustomerOptionsForRep(rep);
    assert.deepEqual(Array.from(options,option=>[option.customeridentityid,option.consigneeidentityid]),[['000045','000075'],['000041','000071'],['000042','000072']],rep);
    const groups=c.buildRequestCustomerPickerGroups(options);
    assert.equal(groups.length,3,'same customer label with distinct IDs stays distinct');
  }
  assert.equal(c.getRequestModalCustomerOptionsForRep('Morgan Smith').length,3);
  assert.equal(c.getRequestModalCustomerOptionsForRep('Molly D').length,3,'unmapped users retain the full customer directory');
});
test('Request membership rechecks both IDs, names and the current map revision',()=>{
  const c=requestFixture(); const context={customeridentityid:row.customeridentityid,consigneeidentityid:row.consigneeid,customername:row.customername,consigneename:row.consigneename,request_selected_salesrep_id:'01'};
  assert.equal(c.isCurrentRequestCustomerContext(context),true);
  assert.equal(c.isCurrentRequestCustomerContext({...context,consigneeidentityid:'00008'}),false);
  assert.equal(c.isCurrentRequestCustomerContext({...context,request_selected_salesrep_id:''}),false);
  assert.equal(c.isCurrentRequestCustomerContext({...context,request_selected_salesrep_id:'02'}),false);
  c.customerRepMapRows=[];c.mappingRevision='2';
  assert.equal(c.isCurrentRequestCustomerContext(context),false);
});

test('legacy and current folder rows resolve to one cached mapped tuple; ambiguous rows stay invalid',()=>{
  const c=requestFixture();
  c.getRequestFolderName=folderRow=>folderRow.request_folder;
  c.tempRequestCustomerSelectedFinalLabel='';
  addAppFunction(c,'resolveRequestCustomerContext');
  const legacy={request_folder:'folder-a',customeridentityid:'00012',customername:'Garden ®',consigneeidentityid:'00007',consigneename:'North ™'};
  const current={...legacy,request_selected_salesrep_id:'01'};
  c.requestsInventory=[legacy,current];
  const resolved=c.resolveRequestCustomerContext('Garden ® | North ™','folder-a');
  assert.equal(resolved.request_selected_salesrep_id,'01');
  assert.equal(c.isCurrentRequestCustomerContext(resolved),true);

  c.requestsInventory=[legacy,current,{...legacy,customeridentityid:'00013'}];
  const ambiguous=c.resolveRequestCustomerContext('Garden ® | North ™','folder-a');
  assert.equal(c.isCurrentRequestCustomerContext(ambiguous),false,'conflicting stored identities cannot be guessed');
});

test('payload resolver rejects missing, ambiguous, inactive, or unverified mapping options without mutation',()=>{
  const c=requestFixture();
  const option=c.getRequestModalCustomerOptionsForRep('Rep One')[0];
  const context={
    customeridentityid:option.customeridentityid,customername:option.customername,
    consigneeidentityid:option.consigneeidentityid,consigneename:option.consigneename,
    request_selected_salesrep_id:option.request_selected_salesrep_id
  };
  const options=[option];
  const expected=requestSubmissionApi.resolveCustomerMappingPayload(context,options,true);
  assert.deepEqual({ ...expected },{
    customeridentityid:'00012',customername:'Garden ®',consigneeidentityid:'00007',consigneename:'North ™',
    request_selected_salesrep_id:'01'
  });
  const contextBefore=JSON.stringify(context);
  const optionBefore=JSON.stringify(option);
  for (const field of ['customeridentityid','customername','consigneeidentityid','consigneename']) {
    assert.equal(requestSubmissionApi.resolveCustomerMappingPayload({...context,[field]:' '},options,true),null,`missing ${field} is rejected`);
  }
  assert.equal(requestSubmissionApi.resolveCustomerMappingPayload(context,[option,{...option}],true),null,'duplicate candidates are ambiguous');
  assert.equal(requestSubmissionApi.resolveCustomerMappingPayload(context,[{...option,customerstatus:'I'}],true),null);
  assert.equal(requestSubmissionApi.resolveCustomerMappingPayload(context,[{...option,consigneestatus:'I'}],true),null);
  assert.equal(requestSubmissionApi.resolveCustomerMappingPayload({...context,request_selected_salesrep_id:''},
    [{...option,request_selected_salesrep_id:''}],true).request_selected_salesrep_id,'','full-directory choices do not impersonate the mapped rep');
  assert.equal(requestSubmissionApi.resolveCustomerMappingPayload(context,options,false),null,'cached options must be ready');
  assert.equal(JSON.stringify(context),contextBefore);
  assert.equal(JSON.stringify(option),optionBefore);
});

test('verified mapping metadata survives grouping and permits an exact new folder selection',()=>{
  const c=requestFixture();
  const option=c.getRequestModalCustomerOptionsForRep('Rep One')[0];
  const mapRow={...option,customername:option.customerName,consigneename:option.consigneeName,consigneeid:option.consigneeidentityid,salesrepid:option.request_selected_salesrep_id};
  assert.equal(c.isActiveRequestCustomerMapping(mapRow),true);
  c.getSelectedExistingRequestFolderGroups=()=>({customerGroup:{label:option.customerName},consigneeGroup:{mapRows:[mapRow]}});
  c.getExistingRequestFolderPairLabel=()=>option.label;
  c.createNewRequestFolderForSelectedExistingPair();
  assert.equal(c.qtyCalls.length,1);
  assert.equal(c.qtyCalls[0][1],option.label);
  assert.equal(c.tempRequestCustomerSelectedContext.request_selected_salesrep_id,'01');
  assert.equal(c.isCurrentRequestCustomerContext(c.tempRequestCustomerSelectedContext),true);
  assert.deepEqual({ ...resolveMappedPayload(c) }, {
    customeridentityid:'00012', customername:'Garden ®', consigneeidentityid:'00007', consigneename:'North ™',
    request_selected_salesrep_id:'01'
  });
});

test('ordinary customer selection resolves the complete mapping by IDs within the selected rep',()=>{
  const c=requestFixture();
  c.document={getElementById:()=>({value:''})};
  c.populateCustomerList=()=>{};
  addAppFunction(c,'setCustomerInput');
  c.setCustomerInput('Garden ® | North ™','00012','00007','Garden ®','North ™');
  assert.equal(c.tempRequestCustomerSelectedContext.request_selected_salesrep_id,'01');
  assert.equal(c.isCurrentRequestCustomerContext(c.tempRequestCustomerSelectedContext),true);
  assert.deepEqual({ ...resolveMappedPayload(c) }, {
    customeridentityid:'00012', customername:'Garden ®', consigneeidentityid:'00007', consigneename:'North ™',
    request_selected_salesrep_id:'01'
  });
  c.customerRepMapRows=[{...row,salesrepid:'02',salesrepname:'Rep Two'}];
  c.tempSelectedReqRep='Rep Two';
  c.tempSelectedReqSalesrepId='02';
  assert.equal(c.isCurrentRequestCustomerContext(c.tempRequestCustomerSelectedContext),false,
    'a selection cannot be reused after the selected rep changes');
});

test('folder grouping cache separates reps and customer identities with identical names',()=>{
  const c=requestFixture();
  c.getExistingRequestFolderRepRows=()=>[];
  c.canUseRequestMappedFoldersForCurrentUser=()=>true;
  c.getRequestCustomerFolderLabel=customer=>customer;
  c.requestExistingFolderGroupsCacheKey='';
  c.requestExistingFolderGroupsCache=[];
  c.customerRepMapRows=[row];
  const first=c.buildExistingRequestFolderCustomerGroups('Rep One');
  assert.equal(first[0].key,'id:00012');
  assert.equal(c.isActiveRequestCustomerMapping(first[0].consignees[0].mapRows[0]),true);
  c.customerRepMapRows=[{...row,salesrepid:'02',customeridentityid:'00013',consigneeid:'00008'}];
  c.mappingRevision='2';
  const second=c.buildExistingRequestFolderCustomerGroups('Rep One');
  assert.equal(second[0].key,'id:00013');
  assert.equal(second[0].consignees[0].key,'id:00008');
  assert.equal(second[0].consignees[0].mapRows[0].salesrepid,'02');
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
test('name correction preserves the current rep assignment and keeps drafts on conflicts',async()=>{
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
  const form=root.querySelector('form');form.querySelector('input').value='Garden Updated';
  form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(calls.at(-1).expectedRevision,'3');assert.equal(calls.at(-1).salesrepId,'01');
  assert.equal(Object.hasOwn(calls.at(-1),'customeridentityid'),false);
  assert.equal(root.querySelector('form input').value,'Garden Updated'); assert.equal(saves,0);
  assert.match(root.querySelector('[role=alert]').textContent,/Mapping changed/);
  unmount();dom.window.close();
});

test('assignments use cached canonical reps, UUID mutations and preserve drafts on conflicts',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{runScripts:'outside-only'});dom.window.eval(mappingBrowserBundle());
  const calls=[];let saves=0;
  const root=dom.window.document.getElementById('root');
  const transport=async payload=>{
    calls.push(payload);
    if(payload.operation==='reps')return {ok:true,rows:[{salesrepId:'01',salesrepName:'Morgan Smith'},{salesrepId:'02',salesrepName:'Molly Dixon'}],total:2,page:0,pageSize:2,revision:'r1'};
    if(payload.operation==='list')return {ok:true,rows:[{...row,hasOverride:false,sourceSalesrepId:'01',sourceSalesrepName:'Morgan Smith'}],total:1,page:0,pageSize:50,revision:'r1',canEdit:true};
    if(payload.operation==='assign')throw new dom.window.Error('Mapping changed. Refresh and retry.');
    return {ok:true,row,revision:'r1'};
  };
  const unmount=dom.window.MappingEditor.mountCustomerRepMapping(root,transport,()=>saves++,'manager:test');
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.match(root.textContent,/Imported/);assert.match(root.textContent,/Garden ®/);assert.match(root.textContent,/North ™/);
  Array.from(root.querySelectorAll('button')).find(button=>button.textContent==='Assign rep').click();
  const search=root.querySelector('[aria-label="Search sales reps"]');search.value='Molly';search.dispatchEvent(new dom.window.Event('input'));
  const select=root.querySelector('[aria-label="Select sales rep"]');assert.equal(select.options.length,2);select.value='02';
  const form=root.querySelector('form');form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await new Promise(resolve=>setTimeout(resolve,0));
  const submitted=calls.find(call=>call.operation==='assign');assert.equal(submitted.salesrepId,'02');assert.equal(submitted.expectedRevision,'3');
  assert.match(submitted.requestId,/^[0-9a-f-]{36}$/i);assert.equal(root.querySelector('form select').value,'02');
  assert.match(root.querySelector('[role="alert"]').textContent,/Mapping changed/);assert.equal(saves,0);
  unmount();dom.window.close();
});

test('customer assignment rep catalog prefetches concurrently and survives a same-session remount',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{runScripts:'outside-only'});dom.window.eval(mappingBrowserBundle());
  const root=dom.window.document.getElementById('root'),firstOperations=[];let secondRepCalls=0;
  const repsResult={ok:true,rows:[{salesrepId:'01',salesrepName:'Morgan Smith'}],total:1,page:0,pageSize:100,revision:'catalog-r1'};
  const pageResult={ok:true,rows:[{...row,revision:'catalog-r1',hasOverride:false}],total:1,page:0,pageSize:50,revision:'catalog-r1',canEdit:true};
  const first=dom.window.MappingEditor.mountCustomerRepMapping(root,async payload=>{
    firstOperations.push(payload.operation);
    return payload.operation==='reps'?repsResult:pageResult;
  },()=>{},'manager:catalog-cache');
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(firstOperations.slice(0,2),['reps','list'],'rep choices begin warming without waiting for the first page');
  first();
  const second=dom.window.MappingEditor.mountCustomerRepMapping(root,async payload=>{
    if(payload.operation==='reps'){secondRepCalls++;return repsResult;}
    return pageResult;
  },()=>{},'manager:catalog-cache');
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(secondRepCalls,0,'the authenticated session and unchanged dataset revision reuse the small rep catalog');
  second();dom.window.close();
});

test('rep catalog validation rejects S99 and noncanonical or forged names',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{runScripts:'outside-only'});dom.window.eval(mappingBrowserBundle());
  const root=dom.window.document.getElementById('root');
  const transport=async payload=>payload.operation==='reps'
    ? {ok:true,rows:[{salesrepId:'S99',salesrepName:'Interdivision'}],total:1,page:0,pageSize:1,revision:'r1'}
    : {ok:true,rows:[{...row,hasOverride:true,sourceSalesrepId:'01',sourceSalesrepName:'Morgan Smith'}],total:1,page:0,pageSize:50,revision:'r1',canEdit:true};
  const unmount=dom.window.MappingEditor.mountCustomerRepMapping(root,transport,()=>{},'manager:invalid');
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.match(root.querySelector('[data-assignment-error="catalog"]').textContent,/invalid assignment/);
  assert.equal(Array.from(root.querySelectorAll('button')).find(button=>button.textContent==='Assign rep').disabled,false,'an override can still be opened to reset when choices are unavailable');
  Array.from(root.querySelectorAll('button')).find(button=>button.textContent==='Assign rep').click();
  assert.ok(Array.from(root.querySelectorAll('button')).some(button=>button.textContent==='Reset to imported assignment'));
  unmount();dom.window.close();
});

test('reset confirmation can be cancelled or restore imported S99 with a revisioned UUID request',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{runScripts:'outside-only'});dom.window.eval(mappingBrowserBundle());
  const root=dom.window.document.getElementById('root'),calls=[];let confirmResult=false,confirmation='';
  const imported={...row,salesrepid:'S99',salesrepname:'Interdivision',revision:'7',hasOverride:true,sourceSalesrepId:'S99',sourceSalesrepName:'Interdivision'};
  const transport=async payload=>{
    calls.push(payload);
    if(payload.operation==='reps')return{ok:true,rows:[{salesrepId:'01',salesrepName:'Morgan Smith'}],total:1,page:0,pageSize:100,revision:'list-r1'};
    if(payload.operation==='list')return{ok:true,rows:[imported],total:1,page:payload.page||0,pageSize:50,revision:'list-r1',canEdit:true};
    if(payload.operation==='reset')return{ok:true,row:{...imported,revision:'8',hasOverride:false},revision:'list-r2'};
    throw new Error('Unexpected mutation');
  };
  dom.window.confirm=message=>{confirmation=message;return confirmResult;};
  const unmount=dom.window.MappingEditor.mountCustomerRepMapping(root,transport,()=>{},'manager:reset-confirm');
  await new Promise(resolve=>setTimeout(resolve,0));
  Array.from(root.querySelectorAll('button')).find(button=>button.textContent==='Assign rep').click();
  const reset=Array.from(root.querySelectorAll('button')).find(button=>button.textContent==='Reset to imported assignment');
  reset.click();assert.match(confirmation,/Interdivision/);assert.equal(calls.filter(call=>call.operation==='reset').length,0);
  confirmResult=true;reset.click();await new Promise(resolve=>setTimeout(resolve,0));
  const request=calls.find(call=>call.operation==='reset');assert.ok(request);assert.equal(request.expectedRevision,'7');assert.match(request.requestId,/^[0-9a-f-]{36}$/i);
  assert.equal(root.querySelector('tbody tr').children[3].textContent,'Interdivision');
  unmount();dom.window.close();
});

test('pending assignment disables reset and manager access gates all mutation controls',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{runScripts:'outside-only'});dom.window.eval(mappingBrowserBundle());
  const root=dom.window.document.getElementById('root'),calls=[];let resolveAssign,confirmCalls=0;
  const current={...row,hasOverride:true,sourceSalesrepId:'01',sourceSalesrepName:'Morgan Smith'};
  const transport=async payload=>{
    calls.push(payload);
    if(payload.operation==='reps')return{ok:true,rows:[{salesrepId:'02',salesrepName:'Molly Dixon'}],total:1,page:0,pageSize:100,revision:'list-r1'};
    if(payload.operation==='list')return{ok:true,rows:[current],total:1,page:payload.page||0,pageSize:50,revision:'list-r1',canEdit:true};
    if(payload.operation==='assign')return new Promise(resolve=>{resolveAssign=resolve;});
    throw new Error('Unexpected reset');
  };
  dom.window.confirm=()=>{confirmCalls++;return true;};
  const unmount=dom.window.MappingEditor.mountCustomerRepMapping(root,transport,()=>{},'manager:pending-reset');
  await new Promise(resolve=>setTimeout(resolve,0));Array.from(root.querySelectorAll('button')).find(button=>button.textContent==='Assign rep').click();
  const select=root.querySelector('[aria-label="Select sales rep"]');select.value='02';select.dispatchEvent(new dom.window.Event('change'));
  root.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  const reset=Array.from(root.querySelectorAll('button')).find(button=>button.textContent==='Reset to imported assignment');
  assert.equal(reset.disabled,true);reset.click();assert.equal(confirmCalls,0);assert.equal(calls.filter(call=>['assign','reset'].includes(call.operation)).length,1);
  resolveAssign({ok:true,row:{...current,salesrepid:'02',salesrepname:'Molly Dixon',revision:'8'},revision:'list-r2'});
  await new Promise(resolve=>setTimeout(resolve,0));unmount();dom.window.close();

  const deniedDom=new JSDOM('<div id="root"></div>',{runScripts:'outside-only'});deniedDom.window.eval(mappingBrowserBundle());
  const deniedRoot=deniedDom.window.document.getElementById('root'),deniedCalls=[];
  const denied=deniedDom.window.MappingEditor.mountCustomerRepMapping(deniedRoot,async payload=>{
    deniedCalls.push(payload);
    if(payload.operation==='reps')return{ok:true,rows:[{salesrepId:'02',salesrepName:'Molly Dixon'}],total:1,page:0,pageSize:100,revision:'list-r1'};
    return{ok:true,rows:[current],total:1,page:0,pageSize:50,revision:'list-r1',canEdit:false};
  },()=>{},'manager:read-only');
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(deniedRoot.querySelectorAll('tbody button').length,0);assert.equal(deniedRoot.querySelector('form'),null);
  assert.equal(deniedCalls.some(call=>['assign','reset','save'].includes(call.operation)),false);
  denied();deniedDom.window.close();
});

test('successful assignment paints its confirmed row while the followup page refresh is pending',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{runScripts:'outside-only'});dom.window.eval(mappingBrowserBundle());
  const root=dom.window.document.getElementById('root'),calls=[];let followupResolve;
  const current={...row,revision:'3',hasOverride:false,sourceSalesrepId:'01',sourceSalesrepName:'Morgan Smith'};
  const transport=async payload=>{
    calls.push(payload);
    if(payload.operation==='reps')return{ok:true,rows:[{salesrepId:'02',salesrepName:'Molly Dixon'}],total:1,page:0,pageSize:100,revision:'list-r1'};
    if(payload.operation==='list'){
      if(calls.filter(call=>call.operation==='list').length===1)return{ok:true,rows:[current],total:1,page:0,pageSize:50,revision:'list-r1',canEdit:true};
      return new Promise(resolve=>{followupResolve=resolve;});
    }
    if(payload.operation==='assign')return{ok:true,row:{...current,salesrepid:'02',salesrepname:'Molly Dixon',revision:'4',hasOverride:true},revision:'list-r2'};
    throw new Error('Unexpected mutation');
  };
  const unmount=dom.window.MappingEditor.mountCustomerRepMapping(root,transport,()=>{},'manager:paint-success');
  await new Promise(resolve=>setTimeout(resolve,0));Array.from(root.querySelectorAll('button')).find(button=>button.textContent==='Assign rep').click();
  const select=root.querySelector('[aria-label="Select sales rep"]');select.value='02';root.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  for(let i=0;i<8&&!followupResolve;i++)await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(typeof followupResolve,'function');assert.equal(root.querySelector('tbody tr').children[3].textContent,'Molly Dixon');
  followupResolve({ok:true,rows:[{...current,salesrepid:'02',salesrepname:'Molly Dixon',revision:'4',hasOverride:true}],total:1,page:0,pageSize:50,revision:'list-r2',canEdit:true});
  await new Promise(resolve=>setTimeout(resolve,0));unmount();dom.window.close();
});

test('rep directory loads every bounded page and caches it only at the matching revision',async()=>{
  const dom=new JSDOM('',{runScripts:'outside-only'});dom.window.eval(mappingBrowserBundle());
  const calls=[];const choices=Array.from({length:101},(_,index)=>({salesrepId:String(index+1),salesrepName:`Rep${index+1} Smith`}));
  const client=dom.window.MappingEditor.createCustomerRepAssignments(async(payload)=>{
    calls.push(payload);const page=payload.page||0;return{ok:true,rows:choices.slice(page*100,(page+1)*100),total:choices.length,page,pageSize:100,revision:'directory-r1'};
  },'manager:directory-test');
  const first=await client.reps(new dom.window.AbortController().signal);assert.equal(first.length,101);assert.deepEqual(calls.map(call=>call.page),[0,1]);
  client.setRevision('directory-r1');assert.equal(await client.reps(new dom.window.AbortController().signal),first);assert.equal(calls.length,2);
  client.dispose();dom.window.close();
});

test('startup rep prefetch seeds the same scoped catalog cache used by the editor',async()=>{
  const dom=new JSDOM('',{runScripts:'outside-only'});dom.window.eval(mappingBrowserBundle());
  const calls=[];const choices=[{salesrepId:'01',salesrepName:'Morgan Smith'}];
  const transport=async payload=>{calls.push(payload);return{ok:true,rows:choices,total:1,page:0,pageSize:100,revision:'prefetch-r1'};};
  const warmed=await dom.window.MappingEditor.prefetchCustomerRepOptions(transport,'manager:prefetch',new dom.window.AbortController().signal);
  const client=dom.window.MappingEditor.createCustomerRepAssignments(transport,'manager:prefetch');
  const reused=await client.reps(new dom.window.AbortController().signal);
  assert.equal(warmed,reused);assert.equal(calls.length,1);assert.equal(reused[0].salesrepName,'Morgan Smith');
  const otherIdentity=await dom.window.MappingEditor.prefetchCustomerRepOptions(transport,'manager:other',new dom.window.AbortController().signal);
  assert.notEqual(otherIdentity,warmed);assert.equal(calls.length,2);
  client.dispose();dom.window.close();
});

test('an obsolete or aborted rep response cannot populate the shared catalog cache',async()=>{
  const dom=new JSDOM('',{runScripts:'outside-only'});dom.window.eval(mappingBrowserBundle());
  let resolveOld;const calls=[];
  const client=dom.window.MappingEditor.createCustomerRepAssignments(async(payload)=>{
    calls.push(payload);
    if(calls.length===1)return new Promise(resolve=>{resolveOld=resolve;});
    return{ok:true,rows:[{salesrepId:'02',salesrepName:'Molly Dixon'}],total:1,page:0,pageSize:100,revision:'r2'};
  },'manager:obsolete-test');
  const oldController=new dom.window.AbortController();const old=client.reps(oldController.signal).catch(error=>error);
  client.setRevision('r2');oldController.abort();
  resolveOld({ok:true,rows:[{salesrepId:'01',salesrepName:'Morgan Smith'}],total:1,page:0,pageSize:100,revision:'r1'});
  assert.match((await old).message,/changed while loading/);
  const current=await client.reps(new dom.window.AbortController().signal);assert.equal(current.length,1);assert.equal(current[0].salesrepId,'02');assert.equal(current[0].salesrepName,'Molly Dixon');
  assert.equal(calls.length,2);client.dispose();dom.window.close();
});

test('mutation requests deduplicate in flight and reuse one request ID for an exact retry',async()=>{
  const dom=new JSDOM('',{runScripts:'outside-only'});dom.window.eval(mappingBrowserBundle());
  const calls=[];let rejectFirst;let attempts=0;
  const client=dom.window.MappingEditor.createCustomerRepAssignments(async(payload)=>{
    calls.push(payload);attempts++;
    if(attempts===1)return new Promise((_resolve,reject)=>{rejectFirst=reject;});
    if(attempts===2)throw new Error('temporary network failure');
    return{ok:true,row:{...row,revision:'4',salesrepid:'02',salesrepname:'Molly Dixon'},revision:'4'};
  },'manager:retry-test');
  const signal=new dom.window.AbortController().signal;
  const pending=client.assign(row,'02',signal);assert.equal(client.assign(row,'02',signal),pending);assert.equal(calls.length,1);
  rejectFirst(new Error('network unavailable'));await assert.rejects(pending,/network unavailable/);
  await assert.rejects(client.assign(row,'02',signal),/temporary network failure/);
  const retry=client.assign(row,'02',signal);await retry;
  assert.equal(calls.length,3);assert.ok(calls.every(call=>call.requestId===calls[0].requestId));assert.equal(calls[0].salesrepId,'02');
  client.dispose();dom.window.close();
});

test('mapping validator requires identity and status fields while allowing additive source metadata',()=>{
  const dom=new JSDOM('',{runScripts:'outside-only'});dom.window.eval(mappingBrowserBundle());
  assert.throws(()=>dom.window.MappingEditor.mappingRow({...row,customeridentityid:undefined}),/customeridentityid/);
  assert.throws(()=>dom.window.MappingEditor.mappingRow({...row,consigneestatus:12}),/consigneestatus/);
  assert.equal(dom.window.MappingEditor.mappingRow(row).sourceSalesrepName,null);
  dom.window.close();
});

test('canonical rep validation rejects control characters and mutation response identity mismatches',async()=>{
  const dom=new JSDOM('',{runScripts:'outside-only'});dom.window.eval(mappingBrowserBundle());
  const invalidCatalog=dom.window.MappingEditor.createCustomerRepAssignments(async()=>({ok:true,rows:[{salesrepId:'01',salesrepName:'Morgan\nSmith'}],total:1,page:0,pageSize:100,revision:'r1'}),'manager:control-name');
  await assert.rejects(invalidCatalog.reps(new dom.window.AbortController().signal),/invalid assignment/);
  const wrongRow=dom.window.MappingEditor.createCustomerRepAssignments(async()=>({ok:true,row:{...row,unique_id:'another-mapping'},revision:'r2'}),'manager:wrong-row');
  await assert.rejects(wrongRow.assign(row,'02',new dom.window.AbortController().signal),/different mapping/);
  invalidCatalog.dispose();wrongRow.dispose();dom.window.close();
});

test('mapping editor cancels obsolete reads and never paints results after unmount',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{runScripts:'outside-only'});dom.window.eval(mappingBrowserBundle());
  const requests=[];const root=dom.window.document.getElementById('root');
  const unmount=dom.window.MappingEditor.mountCustomerRepMapping(root,(payload,signal)=>payload.operation==='list'?new Promise(resolve=>requests.push({resolve,signal})):Promise.resolve({ok:true,rows:[],total:0,page:0,pageSize:50,revision:'4'}),()=>{});
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
