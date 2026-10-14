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
const appSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

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
  const context=vm.createContext({document:{getElementById:()=>({value:'Custom Customer'})}});
  vm.runInContext(requestMappingSetup+'\n'+requestMappingFunctions(),context);
  context.customerRepMapRows=[row,{...row,unique_id:'map-2',customeridentityid:'00013',consigneeid:'00008'},
    {...row,unique_id:'inactive',consigneestatus:'I'}, {...row,unique_id:'unassigned',salesrepid:''},
    {...row,unique_id:'other',salesrepid:'02',salesrepname:'Rep Two',customeridentityid:'other'}];
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
    assert.deepEqual(Array.from(options,option=>[option.customeridentityid,option.consigneeidentityid]),[['000041','000071'],['000042','000072']],rep);
    const groups=c.buildRequestCustomerPickerGroups(options);
    assert.equal(groups.length,2,'same customer label with distinct IDs stays distinct');
  }
  assert.equal(c.getRequestModalCustomerOptionsForRep('Morgan Smith').length,1);
  assert.equal(c.getRequestModalCustomerOptionsForRep('Molly D').length,0,'partial names cannot identify an external sales rep');
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
    request_selected_salesrep_id:'01',requested_by:'Rep One',request_selected_rep_display:'Rep One',request_selected_rep_username:null
  });
  const contextBefore=JSON.stringify(context);
  const optionBefore=JSON.stringify(option);
  for (const field of ['customeridentityid','customername','consigneeidentityid','consigneename','request_selected_salesrep_id']) {
    assert.equal(requestSubmissionApi.resolveCustomerMappingPayload({...context,[field]:' '},options,true),null,`missing ${field} is rejected`);
  }
  assert.equal(requestSubmissionApi.resolveCustomerMappingPayload(context,[option,{...option}],true),null,'duplicate candidates are ambiguous');
  assert.equal(requestSubmissionApi.resolveCustomerMappingPayload(context,[{...option,customerstatus:'I'}],true),null);
  assert.equal(requestSubmissionApi.resolveCustomerMappingPayload(context,[{...option,consigneestatus:'I'}],true),null);
  assert.equal(requestSubmissionApi.resolveCustomerMappingPayload(context,[{...option,salesrepname:' '}],true),null);
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
    request_selected_salesrep_id:'01', requested_by:'Rep One', request_selected_rep_display:'Rep One', request_selected_rep_username:null
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
    request_selected_salesrep_id:'01', requested_by:'Rep One', request_selected_rep_display:'Rep One', request_selected_rep_username:null
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
