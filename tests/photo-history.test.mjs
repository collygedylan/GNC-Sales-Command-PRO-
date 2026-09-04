import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = path => fs.readFileSync(new URL('../'+path, import.meta.url),'utf8');
const sql = read('supabase/migrations/20260904142737_dylan_photo_history_gallery_v1.sql');
const copiesSql = read('supabase/migrations/20260904151119_photo_history_required_copies_v2.sql');
const edge = read('supabase/functions/app-api/index.ts');
const ui = read('assets/photo-history-v2026090401.js');
const gs = read('Code.gs');
const helperModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(read('supabase/functions/_shared/photo-history.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:helperModule.exports,URL,Set});
const {historyPhotoUrl,publicHistoryPhoto}=helperModule.exports;

test('gallery never gives a legacy card an original or a V2 card a transformation',()=>{
  const asset={bucket:'request_photos',path:'2026-06-04/Lemon Grass.jpg',storage_available:true};
  assert.equal(historyPhotoUrl('https://example.supabase.co',asset),'https://example.supabase.co/storage/v1/render/image/public/request_photos/2026-06-04/Lemon%20Grass.jpg?width=320&quality=62&resize=contain');
  assert.match(historyPhotoUrl('https://example.supabase.co',{...asset,path:'v2/'+'a'.repeat(64)+'.webp'}),/object\/public\/request_photos\/_thumbs\/v2\/a+-w320.webp$/);
  assert.match(historyPhotoUrl('https://example.supabase.co',asset,true),/object\/public\/request_photos\/2026/);
  assert.equal(publicHistoryPhoto('https://example.supabase.co',asset).path,undefined);
  assert.equal(publicHistoryPhoto('https://example.supabase.co',{...asset,storage_available:false}).thumbnailUrl,'');
});

test('unknown buckets and traversal cannot become fetch targets',()=>{
  for(const asset of [{bucket:'chat_voice_notes',path:'audio.jpg'},{bucket:'request_photos',path:'../private.jpg'},{bucket:'request_photos',path:''}])assert.throws(()=>historyPhotoUrl('https://x',asset));
});

test('Dylan is checked in the authenticated API and again in SQL; all table/RPC browser access is denied',()=>{
  assert.match(edge,/normalizeUsername\(String\(profile.username \|\| ''\)\) !== 'dylan_collyge'/);
  assert.match(edge,/p_actor_id: profile.id/);
  assert.match(sql,/lower\(btrim\(p.username\)\)='dylan_collyge'/);
  for(const table of ['assets','index_state','shares','audit'])assert.match(sql,new RegExp(`alter table public.ph_photo_history_${table} enable row level security`));
  assert.match(sql,/revoke all on function public.photo_history_gallery_v1\(uuid,text,jsonb\) from public,anon,authenticated/);
  assert.match(sql,/grant execute on function public.photo_history_gallery_v1\(uuid,text,jsonb\) to service_role/);
  assert.doesNotMatch(edge.slice(edge.indexOf('const READABLE_TABLES'),edge.indexOf('const WRITABLE_TABLES')),/ph_photo_history/);
});

test('search is metadata-only, bounded and keyset paginated; no manual load-more control',()=>{
  assert.match(sql,/ph_request_history h/);assert.match(sql,/ph_photo_archive_jobs/);
  assert.match(sql,/\(a.photo_at,a.id\)<\(cursor_at,cursor_id\)/);
  assert.match(sql,/page_size:=least\(48/);
  assert.match(sql,/source_key text not null unique/);
  assert.doesNotMatch(sql,/\b(update|delete from)\s+(storage.objects|public.ph_(master_inventory|request_history|active_request))\b/i);
  assert.doesNotMatch(ui,/Load More|Load 20 More/);
  assert.match(ui,/Math.ceil\(scroller.clientHeight\/ROW\)\+3/);
  assert.match(ui,/generation\+\+/);assert.match(ui,/if\(version!==generation/);
  assert.match(ui,/margin=mobile\?160:320/);
});

test('one event holds all selected photos, one authoritative sales rep and the original retry token',()=>{
  assert.match(sql,/recipientEmails',jsonb_build_array\(recipient.email\)/);
  assert.match(sql,/fingerprint<>fingerprint/);
  assert.match(sql,/unique\(actor_id,idempotency_key\)/);
  assert.match(sql,/ev.status='delivered' or ev.email_delivered_at is not null/);
  assert.match(ui,/api\('send',draft.pending\)/);
  assert.match(ui,/draft.pending=null;draft.message=''/);
  assert.match(read('supabase/functions/request-delivery-worker/index.ts'),/\["photo_history_share", "reclass_inquiry"/);
  assert.match(gs,/event_type=neq.photo_history_share&status=eq.pending/);
});

function emailHarness(){
  const sent=[],receipts=new Map();
  const context={console,Map,Date,Number,String,JSON,Array,Error,
    photoHistoryEmailImage_:()=>({getBytes:()=>[255,216,255,0],getContentType:()=> 'image/jpeg',setName(name){this.name=name;return this;}}),
    dedupeEmailAddresses_:values=>[...new Set(values.flat(Infinity))],
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
    getRequestDeliveryReceipt_:id=>receipts.get(id),findSentRequestDeliveryByMessageId_:()=>null,
    buildRecoveredDeliveryResult_:(_,receipt)=>receipt,
    saveRequestDeliveryReceipt_:(id,value)=>receipts.set(id,value),
    sendGmailApiMessage_:message=>{sent.push(message);return{ok:true,gmailMessageId:'test'};},
    escapeEmailHtml_:x=>String(x).replace(/</g,'&lt;'),buildPhoneSizedEmailHtml_:x=>x,resolveAutomatedEmailSenderAddress_:()=> 'test@example.test'};
  const start=gs.indexOf('function handleSignedPhotoHistoryShare_');
  vm.createContext(context);vm.runInContext(gs.slice(start,gs.indexOf('function handleSignedRequestDeliveryEvent_',start)),context);
  return {context,sent};
}
test('one email with separate correctly named attachments, dates and historical warning; replay sends nothing',()=>{
  const {context,sent}=emailHarness();
  const delivery={messageIdHeader:'<fixture>',payload:{contractVersion:'photo-history-share-v1',actorUsername:'dylan_collyge',shareId:'fixture',recipientEmails:['rep@example.test'],message:'For comparison',photos:[1,2,3].map(i=>({commonname:'Lemon Grass',filename:`original-${i}.webp`,date:'2026-06-04',itemcode:'004740.013.1',contsize:'1GP'}))}};
  context.handleSignedPhotoHistoryShare_(delivery);context.handleSignedPhotoHistoryShare_(delivery);
  assert.equal(sent.length,1);assert.equal(sent[0].attachments.length,3);
  assert.match(sent[0].attachments[0].name,/01_2026-06-04_Lemon Grass.jpg/);
  assert.match(sent[0].textBody,/not confirmation of current inventory/);
  assert.match(sent[0].textBody,/original-3.webp/);
  assert.equal(sent[0].toArray.length,1);
});
test('failed photo prevents the entire email, without a partial send or original fallback',()=>{
  const {context,sent}=emailHarness();context.photoHistoryEmailImage_=()=>{throw Error('PHOTO_HISTORY_PREVIEW_UNAVAILABLE');};
  assert.throws(()=>context.handleSignedPhotoHistoryShare_({messageIdHeader:'x',payload:{contractVersion:'photo-history-share-v1',actorUsername:'dylan_collyge',shareId:'x',recipientEmails:['x@y.test'],photos:[{}]}}));
  assert.equal(sent.length,0);
  const code=gs.slice(gs.indexOf('function photoHistoryEmailImage_'),gs.indexOf('function handleSignedPhotoHistoryShare_'));
  assert.match(code,/width=640&quality=62&resize=contain/);assert.doesNotMatch(code,/getFileById.*getBlob/);
});

test('new sends resolve both required copies on the server and never rewrite old deliveries',()=>{
  assert.match(copiesSql,/in \('dylan_collyge','jd_jones'\)/);
  assert.match(copiesSql,/jsonb_array_length\(required_copies\),0\)<>2/);
  assert.match(copiesSql,/PHOTO_HISTORY_REQUIRED_COPY_UNAVAILABLE/);
  assert.match(copiesSql,/u.email_confirmed_at is not null/);
  assert.match(copiesSql,/'contractVersion','photo-history-share-v2'/);
  assert.match(copiesSql,/'recipientEmails',recipient_emails/);
  assert.match(copiesSql,/select recipient.email as email union select/);
  assert.doesNotMatch(copiesSql,/set payload\s*=/i);
  assert.match(ui,/Dylan and JD are included automatically/);
});

function v2Delivery(overrides={}) {
  return {messageIdHeader:'<copies-fixture>',payload:{contractVersion:'photo-history-share-v2',actorUsername:'dylan_collyge',shareId:'fixture',
    selectedRecipientEmail:'rep@example.test',recipientEmails:['rep@example.test','dylan@example.test','jd@example.test'],
    requiredCopies:[{username:'dylan_collyge',email:'dylan@example.test'},{username:'jd_jones',email:'jd@example.test'}],
    photos:[1,2,3].map(i=>({filename:`photo-${i}.jpg`,date:'2026-06-04'})),...overrides}};
}
test('V2 sends one email to the rep, Dylan and JD with separate photos; replay never resends',()=>{
  const {context,sent}=emailHarness(); const delivery=v2Delivery();
  context.handleSignedPhotoHistoryShare_(delivery);context.handleSignedPhotoHistoryShare_(delivery);
  assert.equal(sent.length,1);assert.equal(sent[0].attachments.length,3);
  assert.deepEqual([...sent[0].toArray].sort(),['dylan@example.test','jd@example.test','rep@example.test']);
});
test('V2 deduplicates recipients while requiring both protected copy identities',()=>{
  const {context,sent}=emailHarness();
  context.handleSignedPhotoHistoryShare_(v2Delivery({selectedRecipientEmail:'dylan@example.test',recipientEmails:['dylan@example.test','jd@example.test']}));
  assert.equal(sent.length,1);assert.equal(sent[0].toArray.length,2);
  for(const patch of [{requiredCopies:[]},{recipientEmails:['rep@example.test']},{recipientEmails:['rep@example.test','dylan@example.test','jd@example.test','extra@example.test']},{requiredCopies:[{username:'dylan_collyge',email:'dylan@example.test'},{username:'dylan_collyge',email:'jd@example.test'}]}]){
    const h=emailHarness();assert.throws(()=>h.context.handleSignedPhotoHistoryShare_(v2Delivery(patch)),/PHOTO_HISTORY_VALIDATION/);assert.equal(h.sent.length,0);
  }
});
