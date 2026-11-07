import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { hasVerifiedArchiveReceipt } from '../scripts/archive-expired-photos.mjs';
const source = fs.readFileSync(new URL('../assets/storage-request-guard.js', import.meta.url), 'utf8');
const url = 'https://example.supabase.co/storage/v1/object/public/request_photos/a.jpg';
function guard() { const ctx = { URL, Response, Request, fetch, module: {exports: {}} }; vm.runInNewContext(source, ctx); return ctx.module.exports; }
test('canonical public URL rejects placeholder filenames without changing signed/private URLs', () => {
 const g=guard();
 for(const name of ['null','undefined','%5Bobject%20Object%5D','']) assert.equal(g.normalize(url.replace('a.jpg', name)), '');
 assert.equal(g.normalize(url.replace('object/public','render/image/public')+'?width=80&v=receipt'),url+'?v=receipt');
 const signed=url.replace('/public/','/sign/')+'?token=private'; assert.equal(g.normalize(signed), signed);
});
test('400/404 are requested once per session across query variants; 504 can recover', async () => {
 for(const status of [400,404]) {const g=guard(); let calls=0; const load=async()=>{calls++;return new Response(null,{status});};
 await g.fetchOnce(new Request(url),load); await g.fetchOnce(new Request(url+'?v=2'),load); assert.equal(calls,1); assert.equal(g.failedStorageUrls.size,1); }
 const g=guard(); g.noteFailure(url,504,1000); assert.equal(g.blocked(url,1001),true); assert.equal(g.blocked(url,16001),false); assert.equal(g.failedStorageUrls.size,0);
});
test('concurrent image views share one fetch but receive independent consumable bodies', async () => {
 const g=guard(); let calls=0; const load=async()=>{calls++;return new Response('photo');};
 const responses=await Promise.all(Array.from({length:20},()=>g.fetchOnce(new Request(url),load)));
 assert.equal(calls,1); assert.deepEqual(await Promise.all(responses.map(r=>r.text())),Array(20).fill('photo'));
});
test('missing static thumbnail falls back to its exact original, preserving physical-row prefix', () => {
 const g=guard(),prefix=url.replace('a.jpg','drive-evidence/abcd/'),hash='a'.repeat(64);
 assert.equal(g.original('https://drive.google.com/thumbnail?id=drive-file'), '');
 assert.equal(g.original(prefix+'_thumbs/v2/'+hash+'-w320.jpg'),prefix+'v2/'+hash+'.jpg');
});
test('archive deletion requires a complete Drive receipt bound to the exact approved Storage object', () => {
 const receipt={source_bucket:'request_photos',source_path:'v2/a.jpg',source_key:createHash('sha256').update('request_photos/v2/a.jpg').digest('hex'),verified_at:'2026-09-01T00:00:00Z',drive_file_id:'drive-id',sha256:'b'.repeat(64),source_size:123};
 assert.equal(hasVerifiedArchiveReceipt(receipt),true);
 for(const key of ['source_key','verified_at','drive_file_id','sha256','source_size']) assert.equal(hasVerifiedArchiveReceipt({...receipt,[key]:null}),false,key);
 assert.equal(hasVerifiedArchiveReceipt({...receipt,source_path:'different.jpg'}),false);
});
