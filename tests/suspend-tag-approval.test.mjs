// @test-group: suspend
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto, createHmac } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const transpile = code => ts.transpileModule(code.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const approval = { id: '12345678-1234-4234-8234-123456789abc', rep_email: 'toby@example.test', submitter_email: 'dylan@example.test', status: 'pending', snapshot: {
  customername: 'Outdoor Living Supply', consigneename: 'Outdoor Living Supply', commonname: 'Royal Red butterfly bush', contsize: '#1',
  locationcode: 'E.23.000', quantityordered: 0, dock_spec: '<saved spec>', dock_caliper: '1', match: '100', av_note: 'Available', dock_note: 'Keep notes',
  dock_photo_link: 'https://example.test/photo.jpg', dock_photo_name: 'photo.jpg', rep_username: 'toby_brown', rep_display: 'Toby Brown',
} };

test('protected API has exactly three editors and passes verified identity/session to SQL', async () => {
  const ctx = vm.createContext({ jsonValue: value => value }); vm.runInContext(transpile(read('supabase/functions/_shared/suspend-tag.ts')), ctx);
  const calls = []; const client = { rpc: async (...args) => { calls.push(args); return { data: { ok: true } }; } };
  for (const username of ['dylan_collyge','megan_kelly','dan_mccuistion']) {
    await ctx.handleSuspendTag(client, { id: 'actor', username, nativeSessionId: 'verified-session' }, { operation: 'complete', payload: { sourceUid: 'row', expectedLastUpdated: null, patch: {} }, commandId: 'token', expectedVersion: 0 });
    assert.equal(calls.at(-1)[1].p_actor_id, 'actor'); assert.equal(calls.at(-1)[1].p_session_id, 'verified-session');
  }
  for (const username of ['jd_jones','toby_brown','', 'another_admin']) await assert.rejects(ctx.handleSuspendTag(client,{username},{operation:'complete',payload:{},expectedVersion:0}), /FORBIDDEN/);
  await assert.rejects(ctx.handleSuspendTag(client,{username:'dylan_collyge'},{operation:'complete',payload:{username:'forged'},expectedVersion:0}), /FIELD_FORBIDDEN/);
  await assert.rejects(ctx.handleSuspendTag(client,{username:'dylan_collyge'},{operation:'save',payload:{}}), /VERSION_REQUIRED/);
  await ctx.handleSuspendTag(client,{id:'rep',username:'toby_brown'},{operation:'decide',payload:{approvalId:approval.id,decision:'approve'}});
  assert.equal(calls.at(-1)[1].p_actor_id,'rep','SQL verifies the assigned rep');
  assert.equal(ctx.suspendTagError(Error('SUSPEND_TAG_APPROVAL_SUPERSEDED')).status,409);
});

test('Suspend Tag requires a verified native bearer bound to the current actor and session',async()=>{
  const ctx=vm.createContext({atob,jsonValue:value=>value});vm.runInContext(transpile(read('supabase/functions/_shared/suspend-tag.ts')),ctx);
  const token=claims=>'header.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.signature';
  const actor={id:'native-user'},claims={sub:actor.id,role:'authenticated',session_id:approval.id};
  const client={auth:{getUser:async()=>({data:{user:{id:actor.id}},error:null})}};
  const request=value=>new Request('https://app.example.test',{headers:{authorization:'Bearer '+value}});
  assert.equal(await ctx.verifySuspendTagSession(client,actor,request(token(claims))),approval.id);
  for(const changed of [{sub:'someone-else'},{role:'service_role'},{session_id:'not-a-session'}]) {
    await assert.rejects(ctx.verifySuspendTagSession(client,actor,request(token({...claims,...changed}))),/SESSION_REQUIRED/);
  }
  await assert.rejects(ctx.verifySuspendTagSession({auth:{getUser:async()=>({data:{user:null},error:{message:'expired'}})}},actor,request(token(claims))),/SESSION_REQUIRED/);
});

function scriptFunction(name) {
  const code=read('Code.gs'); const start=code.indexOf('function '+name+'('); assert.ok(start>=0,name);
  const end=code.indexOf('\nfunction ',start+1); return code.slice(start,end<0?undefined:end);
}
function emailHarness() {
  const sent=[], props=new Map(), receipts=new Map(); let releases=0;
  const ctx=vm.createContext({ Date, Object, String, encodeURIComponent,
    Utilities:{getUuid:()=>approval.id},
    escapeEmailHtml_: value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
    buildRequestEmailTableItemsHtml_: data=>{ assert.equal(data.requestItems[0].req_qty,0); return '<table><tr><td>Request layout</td></tr></table>'; },
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>releases++})},
    getRequestDeliveryReceipt_: id=>receipts.get(id),findSentRequestDeliveryByMessageId_:()=>null,
    saveRequestDeliveryReceipt_:(id,result)=>receipts.set(id,result),
    PropertiesService:{getScriptProperties:()=>({getProperty:id=>props.get(id),setProperty:(id,value)=>props.set(id,value),deleteProperty:id=>props.delete(id)})},
    resolveOperationalEmailHeaders_: to=>({to}),resolveAutomatedEmailSenderAddress_:()=> 'app@example.test',
    sendGmailApiMessage_: options=>{sent.push(options);return {ok:true,gmailMessageId:'gmail-1',threadId:'thread-1',recipients:[options.toList]};},
  });
  vm.runInContext(['buildSuspendTagApprovalEmail_','handleSignedSuspendTagDelivery_','buildMimeEmail_','formatMimeMailbox_'].map(scriptFunction).join('\n'),ctx);
  return {ctx,sent,props,receipts,releases:()=>releases};
}
test('Request-style email has the exact recipient, Reply-To, escaped details, photos and zero quantity',()=>{
  const h=emailHarness(), delivery={eventType:'suspend_tag_approval_requested',payload:{approval},messageIdHeader:'<request@test>'};
  const model=h.ctx.buildSuspendTagApprovalEmail_(delivery);
  assert.equal(model.to,approval.rep_email);assert.equal(model.replyTo,approval.submitter_email);
  for(const text of ['GNC PH Suspend Tag','Outdoor Living Supply','Royal Red butterfly bush #1','E.23.000','Qty: 0','photo.jpg']) assert.ok(model.textBody.includes(text),text);
  assert.match(model.htmlBody,/<table>/);assert.match(model.htmlBody,/&lt;saved spec&gt;/);assert.doesNotMatch(model.htmlBody,/<saved spec>/);
  h.ctx.handleSignedSuspendTagDelivery_(delivery);h.ctx.handleSignedSuspendTagDelivery_(delivery);
  assert.equal(h.sent.length,1,'duplicate taps recover the receipt');assert.equal(h.sent[0].replyTo,approval.submitter_email);assert.equal(h.sent[0].ccArray,undefined);
  const mime=h.ctx.buildMimeEmail_(h.sent[0]);
  assert.match(mime,/Reply-To: dylan@example.test/);assert.doesNotMatch(mime,/\r?\n(?:Cc|Bcc):/);
  assert.match(mime,/Content-Type: text\/plain/);assert.match(mime,/Content-Type: text\/html/);
  assert.throws(()=>h.ctx.buildMimeEmail_({...h.sent[0],replyTo:'dylan@example.test\r\nBcc: unwanted@example.test'}),/REPLY_TO_INVALID/);
  assert.equal(h.props.size,0);assert.equal(h.releases(),2);
});
test('decision email replies in the original thread, to the recorded completer, and cannot blindly resend uncertain mail',()=>{
  const h=emailHarness(), delivery={eventType:'suspend_tag_approval_decided',payload:{approval:{...approval,status:'denied'}},messageIdHeader:'<decision@test>',thread:{threadId:'original-thread',messageId:'<original@test>'}};
  h.ctx.handleSignedSuspendTagDelivery_(delivery);
  assert.equal(h.sent[0].toList,approval.submitter_email);assert.equal(h.sent[0].replyTo,approval.rep_email);
  assert.equal(h.sent[0].threadId,'original-thread');assert.equal(h.sent[0].inReplyTo,'<original@test>');assert.equal(h.sent[0].references,'<original@test>');
  assert.match(h.ctx.buildMimeEmail_(h.sent[0]),/In-Reply-To: <original@test>\r?\nReferences: <original@test>/);
  assert.match(h.sent[0].textBody,/Toby Brown denied/);
  const uncertain={...delivery,messageIdHeader:'<uncertain@test>'};h.props.set('suspend_tag_send:<uncertain@test>','prior-intent');
  assert.throws(()=>h.ctx.handleSignedSuspendTagDelivery_(uncertain),/RECONCILIATION_REQUIRED/);assert.equal(h.sent.length,1);
});

function workerHarness(options={}) {
  const calls=[],fetches=[];const key='synthetic-service-key';let handler;
  const event={event_id:'event',lease_token:'lease',event_key:'suspend-request:1',event_type:'suspend_tag_approval_requested',payload:{approval_id:approval.id},...options.event};
  const client={rpc:async(name,args)=>{calls.push({name,args});if(name==='claim_request_delivery_events') return {data:[event]};if(name==='prepare_suspend_tag_delivery_v1') return {data:options.suppressed?{suppressed:true}:{approval:options.approval || approval,thread:{threadId:'original-thread',messageId:'<original@test>'}}};return {data:{}};}};
  const ctx=vm.createContext({console:{error(){}},Request,Response,TextEncoder,AbortController,setTimeout,clearTimeout,btoa,crypto:webcrypto,
    Deno:{env:{get:name=>({SUPABASE_URL:'https://db.example.test',SUPABASE_SERVICE_ROLE_KEY:key,REQUEST_DELIVERY_CRON_SECRET:'cron',APPS_SCRIPT_WEB_APP_URL:'https://script.example.test'})[name]}},
    createClient:()=>client,serve:fn=>handler=fn,withObservedRequest:(_,__,fn)=>fn(),
    fetch:async(url,input)=>{fetches.push({url,input});if(url.includes('send-push-alert')) return Response.json(options.pushFailure?{failureCounts:{delivery_error:1}}:{delivered:0,subscriptions:0});
      const signed=JSON.parse(input.body);assert.equal(signed.signature,createHmac('sha256',key).update(signed.timestamp+'.'+signed.deliveryJson).digest('base64url'));
      return Response.json({ok:true,gmailMessageId:'gmail',threadId:'thread',messageIdHeader:JSON.parse(signed.deliveryJson).messageIdHeader,recipients:[approval.rep_email]});},
  });vm.runInContext(transpile(read('supabase/functions/request-delivery-worker/index.ts')),ctx);
  return {calls,fetches,run:async(headers={'x-delivery-cron-secret':'cron'})=>{const response=await handler(new Request('https://worker.example.test',{method:'POST',headers,body:'{}'}));return {status:response.status,body:await response.json()};}};
}
test('delivery records email independently of push, and retry skips the confirmed email',async()=>{
  const h=workerHarness({pushFailure:true});assert.equal((await h.run()).body.failed,1);
  const email=h.calls.find(c=>c.name==='record_request_delivery_channel_result');assert.ok(email.args.p_channel_results.email);
  assert.ok(h.calls.some(c=>c.name==='fail_request_delivery_event'));
  const retry=workerHarness({event:{email_delivered_at:'2026-10-05T12:00:00Z'}});assert.equal((await retry.run()).body.delivered,1);
  assert.equal(retry.fetches.length,1);assert.match(retry.fetches[0].url,/send-push-alert/);
  assert.equal(retry.calls.find(c=>c.name==='record_request_delivery_channel_result').args.p_channel_results.push.mode,'no_subscription');
});
test('decision delivery is email-only, carries original threading and suppresses obsolete rounds',async()=>{
  const h=workerHarness({event:{event_type:'suspend_tag_approval_decided',push_delivered_at:'already'}});assert.equal((await h.run()).body.delivered,1);
  assert.equal(h.fetches.length,1);const delivery=JSON.parse(JSON.parse(h.fetches[0].input.body).deliveryJson);assert.equal(delivery.thread.threadId,'original-thread');
  const old=workerHarness({suppressed:true});await old.run();assert.equal(old.fetches.length,0);
  const denied=workerHarness();assert.equal((await denied.run({authorization:'Bearer forged'})).status,401);assert.equal(denied.calls.length,0);
});

test('a decision before the email receipt is recorded still recovers the original thread without another approval push',async()=>{
  const h=workerHarness({approval:{...approval,status:'denied'}});
  assert.equal((await h.run()).body.delivered,1);assert.equal(h.fetches.length,1);
  assert.match(h.fetches[0].url,/script.example.test/);
  assert.equal(h.calls.find(c=>c.name==='record_request_delivery_channel_result'&&c.args.p_channel_results.push).args.p_channel_results.push.mode,'decision_already_recorded');
});

test('protected approval push targets only its rep and skips confirmed devices after partial failure',async()=>{
  let handler,failSecond=true;
  const sent=[],confirmed=new Set();
  const rows=['first','second'].map((endpoint,id)=>({id,username:'toby_brown',endpoint,p256dh:'key',auth:'auth'}));
  rows.push({id:3,username:'jd_jones',endpoint:'unrelated',p256dh:'key',auth:'auth'});
  const query={select(){return this;},eq(){return this;},in(){return Promise.resolve({data:rows});}};
  const client={from:()=>query,rpc:async(name,args)=>{if(name==='resolve_operational_recipients_v1')return {data:args.p_recipients,error:null};if(args.p_delivered)confirmed.add(args.p_endpoint);return {data:confirmed.has(args.p_endpoint)};}};
  const ctx=vm.createContext({Request,Response,console,
    Deno:{env:{get:name=>({SUPABASE_URL:'https://db.example.test',SUPABASE_SERVICE_ROLE_KEY:'service',WEB_PUSH_VAPID_PUBLIC_KEY:'public',WEB_PUSH_VAPID_PRIVATE_KEY:'private'})[name]}},
    createClient:()=>client,serve:fn=>handler=fn,withObservedRequest:(_,__,fn)=>fn(),
    normalizeUsername:value=>String(value).toLowerCase(),readSupabaseOrAppSessionFromRequest:async()=>({role:'ADMIN'}),getRoleAccessState:()=>({}),
    resolveOperationalRecipients:async(_client,targets)=>targets,
    webpush:{setVapidDetails(){},async sendNotification(subscription,payload){sent.push({endpoint:subscription.endpoint,payload:JSON.parse(payload)});if(subscription.endpoint==='second'&&failSecond)throw Error('temporary');}},
  });vm.runInContext(transpile(read('supabase/functions/send-push-alert/index.ts')),ctx);
  const run=async(key='service')=>{const response=await handler(new Request('https://push.example.test',{method:'POST',headers:{authorization:'Bearer '+key},body:JSON.stringify({eventType:'suspend_tag_approval_requested',approvalId:approval.id,repUsername:'toby_brown'})}));return {status:response.status,body:await response.json()};};
  assert.equal((await run('ordinary-session')).status,403);assert.equal(sent.length,0);
  assert.equal((await run()).body.failureCounts.delivery_error,1);assert.deepEqual([...confirmed],['first']);
  failSecond=false;assert.equal((await run()).body.delivered,2);
  assert.deepEqual(sent.map(item=>item.endpoint),['first','second','second']);
  assert.deepEqual(sent[0].payload.actions,[{action:'approve',title:'Approve'},{action:'deny',title:'Deny'}]);
  assert.equal(sent[0].payload.approvalId,approval.id);
});
