import { textPdf } from '../assets/test/pdf.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import vm from 'node:vm';
const code=await fs.readFile(new URL('../workers/email/Code.gs',import.meta.url),'utf8');
function fixture(fail=false){
 const secret='test-signing-fixture',properties=new Map([['TEST_MAIL_SIGNING_SECRET',secret]]),sent=[];
 const context={MailApp:{getRemainingDailyQuota:()=>100,sendEmail:mail=>{sent.push(mail);if(fail)throw Error('Unknown transport result');}},PropertiesService:{getScriptProperties:()=>({getProperty:key=>properties.get(key),setProperty:(key,value)=>properties.set(key,value)})},LockService:{getScriptLock:()=>({waitLock(){},hasLock:()=>true,releaseLock(){}})},Utilities:{base64Decode:text=>[...Buffer.from(text,'base64')],newBlob:(bytes,mime,name)=>({bytes,mime,name}),computeHmacSha256Signature:(text,key)=>[...crypto.createHmac('sha256',key).update(text).digest()]},ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>text})}};
 vm.runInNewContext(code,context);
 function request(extra={}){const envelope={timestamp:Date.now(),eventId:crypto.randomUUID(),body:JSON.stringify({subject:'Validation',text:'Test',html:'<p>Test</p>',to:'wrong@example.com',cc:'wrong@example.com',bcc:'wrong@example.com'}),...extra};envelope.signature=crypto.createHmac('sha256',secret).update(envelope.timestamp+'\n'+envelope.eventId+'\n'+envelope.body).digest('hex');return envelope;}
 return {context,sent,request,send:envelope=>JSON.parse(context.doPost({postData:{contents:JSON.stringify(envelope)}}))};
}
test('signed mail cannot override Dylan through To, CC, BCC or reply headers',()=>{
 const f=fixture(),request=f.request(),receipt=f.send(request);assert.equal(receipt.status,'SENT');assert.equal(f.sent.length,1);
 assert.equal(f.sent[0].to,'dylan_collyge@greenleafnursery.com');assert.equal(f.sent[0].cc,undefined);assert.equal(f.sent[0].bcc,undefined);assert.equal(f.sent[0].replyTo,undefined);
 assert.deepEqual(f.send(request),receipt);assert.equal(f.sent.length,1);
});
test('invalid signatures cannot send mail',()=>{const f=fixture(),request=f.request();request.signature='wrong';assert.equal(f.send(request).code,'INVALID_SIGNATURE');assert.equal(f.sent.length,0);});
test('an ambiguous send does not automatically duplicate a message',()=>{const f=fixture(true),request=f.request();f.send(request);assert.equal(f.send(request).status,'REVIEW');assert.equal(f.sent.length,1);});

test('signed report probes validate a PDF without sending and deliveries retain the attachment',()=>{const f=fixture(),pdf=Buffer.from(textPdf(['AgData Test report','Exact row: 123'])).toString('base64');const probe=f.request({body:JSON.stringify({mode:'verify_report',pdf})});const verified=f.send(probe);assert.equal(verified.emailsSent,0);assert.ok(verified.pdfBytes>100);assert.equal(f.sent.length,0);const delivered=f.send(f.request({body:JSON.stringify({subject:'Reclass',text:'Exact row: 123',html:'<p>Exact row: 123</p>',pdf})}));assert.equal(delivered.status,'SENT');assert.equal(f.sent[0].attachments[0].mime,'application/pdf');});
