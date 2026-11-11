import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

export function assertRequestCompletionBatch() {
  let ready=false;
  const rows=[1,2,3].map(n=>({unique_id:'REQ-'+n,request_folder:'folder',req_spec:'spec-'+n,req_photo_link:'https://fixture/'+n+'.jpg'}));
  const context=vm.createContext({normalizeRequestIdList_:v=>v||[],REQUEST_LIFECYCLE_REQUIRED_RECIPIENT_EMAILS_:[],
    dedupeEmailAddresses_:v=>v.flat().filter(Boolean),requestDeliveryRest_:(route,method,query,payload)=>{
      assert.equal(route,'rpc/request_completion_dispatch_rows_v3065');
      assert.equal(method,'POST');assert.equal(query,'');assert.equal(payload.p_event_id,'event');
      return {ready,rows:ready?rows:[]};
    }});
  const source=fs.readFileSync(new URL('../../src/services/request-completion-email.js',import.meta.url),'utf8').replace(/^export /gm,'');
  vm.runInContext(source,context);
  const event={event_id:'event',event_type:'request_completed',request_folder:'folder'};
  for(let n=1;n<3;n++)assert.throws(()=>context.buildRequestDeliveryEmailPayload(event,rows.slice(0,n)),/REQUEST_FOLDER_NOT_COMPLETE/);
  ready=true;
  const payload=context.buildRequestDeliveryEmailPayload(event,[rows[2]]);
  assert.equal(payload.itemsCount,3);
  assert.equal(payload.items[0].req_photo_link,'https://fixture/1.jpg');
  assert.equal(payload.items[2].req_spec,'spec-3');
}
