import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
import { simple } from 'acorn-walk';

test('Valid Photos isolates row evidence and rejects unknown, expired and depleted photos in the live app', () => {
  for (const prefix of ['']) {
    const source = fs.readFileSync(new URL('../' + prefix + 'assets/row-workflow-functions.js', import.meta.url), 'utf8');
    const names = new Set(['isValidPhotoRow','getAvRowPhotoUrls','hasValidRowPhoto','getPhotoUrlList','calculateLiveLocPhotoMatch']);
    const functions = [];
    simple(parse(source, {ecmaVersion:'latest'}), {FunctionDeclaration(node) { if (names.has(node.id.name)) functions.push(source.slice(node.start,node.end)); }});
    const now = Date.parse('2026-11-05T12:00:00Z'), day = 86400000;
    const ctx = {Date:{now:()=>now},resolveCanonicalInventoryRow:row=>row,isPhotoDateMsExpired:stamp=>now-stamp>day*10,getExpandedImageUrl:v=>v,getPhotoDateMsFromText_:Date.parse,
      getPhotoEntryDateMs:(url,row)=>Date.parse(row.PHOTOS?.find(entry=>entry.url===url)?.created_at || row.PHOTO_DATE)};
    vm.runInNewContext(functions.join('\n'),ctx);
    const row = {UNIQUE_ID:'one',ITEMCODE:'plant',LOCATIONCODE:'J.03.000',PRIORITY:1,
      PHOTO_LINK:'https://fixture/photo.jpg',PHOTO_DATE:new Date(now-day*10).toISOString(),PTRAVAILABLE:100,PTRONHAND:100,MATCH:50};
    assert.equal(ctx.hasValidRowPhoto(row),true);
    for (const patch of [{PHOTO_DATE:new Date(now-day*10-1).toISOString()},{PHOTO_DATE:''},
      {PTRONHAND:0},{LOC_PHOTO_MATCH:0},{MATCH:0},{PHOTO_LINK:''},{PHOTO_LINK:'blob:pending'},
      {UNIQUE_ID:'sibling',PRIORITY:10,PHOTO_LINK:''}]) assert.equal(ctx.hasValidRowPhoto({...row,...patch}),false);
    assert.equal(ctx.hasValidRowPhoto({...row,PHOTOS:[{url:'https://fixture/new.jpg',created_at:new Date(now).toISOString()}],PHOTO_LINK:'',PHOTO_DATE:''}),true);
    const runtime = fs.readFileSync(new URL('../' + prefix + 'assets/app-runtime.js',import.meta.url),'utf8');
    for (const label of ['All Rows for Selected Season','Photos for Selected Season','All Season Photos']) assert.ok(runtime.includes(label));
    assert.match(runtime,/mode === 'no_photos'\) return items\.filter\(item => !hasValidRowPhoto\(item\)\)/);
    const html = fs.readFileSync(new URL('../'+prefix+'index.html',import.meta.url),'utf8');
    assert.doesNotMatch(html, /id="av-(valid-photos|kiosk)-toggle"/);
  }
});
