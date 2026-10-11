// @test-group: field-count
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../Code.gs',import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const eventId='a1000000-0000-4000-8000-000000000001';
const leaseToken='a1000000-0000-4000-8000-000000000002';
const reportId='a1000000-0000-4000-8000-000000000003';
test('field-count events use the signed handler and are excluded from legacy outbox draining',()=>{
  assert.match(source,/eventType === 'field_count_completion'\) return handleSignedFieldCountDelivery_\(delivery\)/);
  const legacy=source.slice(source.indexOf('function processRequestDeliveryOutbox_'),source.indexOf('function ',source.indexOf('function processRequestDeliveryOutbox_')+20));
  assert.match(legacy,/field_count_completion/);
});

function deliveryRuntime({status='pending',renderFailure=false,receipt=false,requestFailure=null}={}) {
  const calls=[];
  const saved={event_id:eventId,event_key:'field-count:'+reportId,event_type:'field_count_completion',delivery_status:status,
    report:{id:reportId,countType:'bunch',block:'D',location:'D.08.001',completedAt:'2026-10-10T16:00:00Z',actor:'Count Worker',rows:[
      {sourceUid:'row-1',itemcode:'00123',commonname:'Red <maple>',contsize:'#3',lotcode:'LOT-A',season:'26.F1',onHand:8,countedQty:7,direction:'north_south',rowOrder:1,note:'<verified>'}
    ]},
    recipients:[{profile_id:'dylan',username:'dylan_collyge',display:'Dylan',email:'dylan@example.test'},{profile_id:'worker',username:'worker',display_name:'Count Worker',email:'worker@example.test'}],
    pdf:null,receipt:receipt?{gmail_message_id:'saved-message',thread_id:'saved-thread',message_id_header:'<saved>',recipients:['dylan@example.test'],mode:'field_count_gmail_api'}:null};
  const ctx=vm.createContext({
    escapeEmailHtml_:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'),
    HtmlService:{createHtmlOutput:()=>({getBlob:()=>({getAs:()=>({getBytes:()=>{if(renderFailure)throw new Error('private renderer error');return [37,80,68,70,45,49,46,52,10,...Array(220).fill(102)];}})})})},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
    Utilities:{computeDigest:()=>[1,2],DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1},base64Encode:()=> 'JVBERi0xLjQK'+ 'YQ=='.repeat(40),base64Decode:value=>value,
      newBlob:(bytes,mime,name)=>({bytes,mime,name})},MimeType:{PDF:'application/pdf'},
    normalizeEmailAddress_:value=>String(value||'').trim().toLowerCase(),isLikelyEmailAddress_:value=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value),
    isGmailAdvancedServiceAvailable_:()=>true,resolveAutomatedEmailSenderAddress_:()=> 'from@example.test',saveRequestDeliveryReceipt_(){},
    getRequestDeliveryReceipt_:()=>null,findSentRequestDeliveryByMessageId_:()=>null,
    requestDeliveryRest_:(path,method,query,body)=>{
      calls.push({path,body});
      if(requestFailure&&path.includes(requestFailure.path)
        &&(!requestFailure.statusName||body?.p_status===requestFailure.statusName)) {
        const error=new Error(requestFailure.message||`Request delivery database operation failed (${requestFailure.status}).`);
        if(requestFailure.status!==undefined)error.status=requestFailure.status;
        throw error;
      }
      if(path.includes('lookup'))return saved;
      if(path.includes('freeze_pdf'))return {pdf:body.p_pdf};
      if(path.includes('delivery_record'))return {allow_send:true};
      throw new Error('unexpected RPC '+path);
    },
    sendGmailApiMessage_:message=>{calls.push({send:message});return {ok:true,gmailMessageId:'gmail-1',threadId:'thread-1',messageId:'<internet-id>'};}
  });
  vm.runInContext(source.slice(source.indexOf('function buildFieldCountCompletionPdfHtml_'),source.indexOf('function buildSuspendTagApprovalEmail_')),ctx);
  return {ctx,calls,send:()=>ctx.handleSignedFieldCountDelivery_({eventId,leaseToken,eventType:'field_count_completion',eventKey:'field-count:'+reportId,
    messageIdHeader:'<gnc-0102@request-delivery.agdatasolutions.local>'})};
}

test('field count completion PDF is landscape, paginates headers, and escapes snapshot text',()=>{
  const {ctx}=deliveryRuntime();
  const html=ctx.buildFieldCountCompletionPdfHtml_({id:reportId,countType:'spread',block:'D.01',location:'D.01.001',completedAt:'today',actor:'Worker',rows:[
    {sourceUid:'row-1',itemcode:'00123',commonname:'Maple <script>',contsize:'#3',lotcode:'LOT',season:'26.F1',onHand:0,countedQty:3,direction:'east_west',rowOrder:2,note:'Checked <b>all</b>'}
  ]});
  for(const text of ['size:letter landscape','table-header-group','Field Count Completion','Spread','D.01.001','00123','On hand','Counted','Direction','Note','0','3','&lt;script&gt;','Checked &lt;b&gt;all&lt;/b&gt;'])assert.ok(html.includes(text),text);
  assert.ok(!html.includes('<script>'));
});

test('automatic field count freezes one saved PDF before sending to frozen recipients',()=>{
  const d=deliveryRuntime(),result=d.send();
  assert.equal(result.ok,true);
  const freeze=d.calls.findIndex(call=>call.path?.includes('freeze_pdf'));
  const sending=d.calls.findIndex(call=>call.body?.p_status==='sending');
  const sent=d.calls.findIndex(call=>call.send);
  assert.ok(freeze>=0&&freeze<sending&&sending<sent);
  assert.equal(d.calls[freeze].body.p_event_id,eventId);
  assert.equal(d.calls[freeze].body.p_pdf.filename,'Field_Count_'+reportId+'.pdf');
  assert.equal(d.calls[sent].send.attachments[0].name,'Field_Count_'+reportId+'.pdf');
  assert.deepEqual(plain(d.calls[sent].send.toArray),['dylan@example.test','worker@example.test']);
  assert.match(d.calls[sent].send.subject,/Bunch — D \/ D\.08\.001/);
  assert.ok(d.calls.some(call=>call.body?.p_status==='sent'));
});

test('renderer failure is retryable before intent and never starts a send',()=>{
  const d=deliveryRuntime({renderFailure:true}),result=d.send();
  assert.deepEqual(plain(result),{ok:false,code:'FIELD_COUNT_PDF_RENDER_UNAVAILABLE',deliveryUncertain:false,retryable:true,
    message:'The saved count report is retained.'});
  assert.ok(!d.calls.some(call=>call.body?.p_status==='sending'||call.send));
});

test('pre-send transient database responses and known UrlFetch network failures remain retryable',()=>{
  for(const status of [408,429,500,503]) {
    const result=deliveryRuntime({requestFailure:{path:'lookup',status}}).send();
    assert.deepEqual(plain(result),{ok:false,code:'FIELD_COUNT_TRANSPORT_UNAVAILABLE',deliveryUncertain:false,retryable:true,
      message:'The saved count report is retained.'});
  }
  const network=deliveryRuntime({requestFailure:{path:'lookup',message:'Exception: Address unavailable'}}).send();
  assert.equal(network.retryable,true);
  assert.equal(network.deliveryUncertain,false);
  assert.equal(deliveryRuntime({requestFailure:{path:'lookup',message:'Service invoked too many times in a short time: urlfetch'}}).send().retryable,true);
  const permanent=deliveryRuntime({requestFailure:{path:'lookup',status:400}}).send();
  assert.equal(permanent.retryable,false);
  assert.equal(permanent.deliveryUncertain,false);
});

test('lost sending-intent response is retried safely because persisted intent blocks a second send',()=>{
  const first=deliveryRuntime({requestFailure:{path:'delivery_record',statusName:'sending',status:503}}).send();
  assert.equal(first.retryable,true);
  assert.ok(!first.deliveryUncertain);
  assert.ok(!first.send);
  const retry=deliveryRuntime({status:'sending'});
  const second=retry.send();
  assert.equal(second.deliveryUncertain,true);
  assert.ok(!retry.calls.some(call=>call.send||call.path?.includes('freeze_pdf')));
});

test('unknown delivery reconciles without regenerating a PDF or sending again',()=>{
  const d=deliveryRuntime({status:'unknown'}),result=d.send();
  assert.equal(result.deliveryUncertain,true);
  assert.ok(!d.calls.some(call=>call.path?.includes('freeze_pdf')||call.send));
  assert.ok(d.calls.some(call=>call.body?.p_status==='unknown'));
});

test('saved receipt recovers as sent without rendering or sending',()=>{
  const d=deliveryRuntime({status:'unknown',receipt:true}),result=d.send();
  assert.equal(result.ok,true);assert.equal(result.recovered,true);
  assert.ok(!d.calls.some(call=>call.path?.includes('freeze_pdf')||call.send));
  assert.ok(d.calls.some(call=>call.body?.p_status==='sent'));
});
