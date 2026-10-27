import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { parse } from 'acorn';
const html=readComposedAppSource();
const script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).find(s=>s.includes('function getBloomPickerTrayRowHtml('));
const ast=parse(script,{ecmaVersion:'latest'});
const names=new Set(['getBloomPickerTrayRowHtml','renderBloomPickerTrayRows','buildInventoryQuantityChipsHtml','firstNonEmptyValue','normalizeCardQuantityValue','getCardPtrOnHandValue','getCardPtrReviewedValue','getCardPtrAvailableValue','getCardOpenStockValue']);
const declarations=ast.body.filter(n=>n.type==='FunctionDeclaration'&&names.has(n.id.name));
function setup(){
 const list={innerHTML:'',dataset:{},scrollTop:42}; const tray={classList:{toggle(){}}};
 const context=vm.createContext({Array,Object,String,Number,Math,Set,Map,
 document:{getElementById:id=>id==='bloom-picker-tray'?tray:list},cartPanelOpen:true,
 preserveCardLocationOnHand:(item,value)=>value??item.LOC_ON_HAND??null,
 escapeHtml:v=>String(v??''),escJsAttrValue:v=>String(v),
 parseAppNumber:v=>{const n=Number(v);return Number.isFinite(n)?n:null;},
 getInventoryCardDesigLocValue:r=>r.DESIGLOC||'',getPhotoUrlList:v=>v?[v]:[],getRowPhotoLink:r=>r.PHOTO||'',
 getDirectImageUrl:v=>v,buildDeferredCardPhotoImg:v=>'<img data-src="'+v+'">',
 getCardLocationOnHandValue:r=>r.LOC_ON_HAND??null,formatLocPhotoMatchQtyValue:()=> 'N/A',
 closeAllBloomPickerTraySwipes(){},releaseBloomPickerTraySwipeMoveListener(){},bindBloomPickerTraySwipeHandlers(){},scheduleDeferredCardPhotoHydration(){},
 });
 vm.runInContext(declarations.map(n=>script.slice(n.start,n.end)).join('\n'),context);
 return {context,list};
}
const row=()=>({DOM_ID:'blue',ITEMCODE:'000152.050.1',COMMONNAME:'Blue Point Juniper - 2 Tier Poodle',CONTSIZE:'#5',LOCATIONCODE:'G.11.000',LOTCODE:'27.F1',PRIORITY:1,DESIGLOC:'NORTH',PTRONHAND:88,PTRREVIEWED:10,PTRAVAILABLE:78,S_LTS:153,LOC_ON_HAND:88});
test('Bloom has a thumbnail header and exactly six single-line metrics without separator elements',()=>{
 const {context}=setup();const rendered=context.getBloomPickerTrayRowHtml({...row(),PHOTO:'https://example.invalid/plant.webp'});
 assert.match(rendered,/app-bloom-card-photo[\s\S]*<img/); for (const pill of ['LOC G.11.000','LOT 27.F1','PRI 1','DESIGLOC NORTH']) assert.ok(rendered.includes('<span>'+pill+'</span>'));
 assert.ok(rendered.indexOf('app-bloom-card-meta') < rendered.indexOf('app-bloom-card-metrics'));
 assert.equal((rendered.match(/data-inventory-card-metric=/g)||[]).length,6);
 assert.match(rendered,/data-inventory-card-metric="available"[^]*?app-card-qty-value[^>]*>78</);
 assert.match(rendered,/data-inventory-card-metric="loc-on-hand"[^]*?app-card-qty-value[^>]*>88</);
 assert.doesNotMatch(rendered,/qty-separator|>-[<]/);
});
test('compact missing metrics use short placeholders and preserve genuine zero',()=>{
 const {context}=setup(); const rendered=context.buildInventoryQuantityChipsHtml({PTRONHAND:0},{compact:true,preserveUnknown:true,layout:'row'});
 assert.match(rendered,/>0</); assert.match(rendered,/>--</);assert.doesNotMatch(rendered,/Unknown|Unavailable|Not verified/);
});
test('Bloom refreshes selected values at unchanged row IDs and preserves tray scroll',()=>{
 const {context,list}=setup();const item=row();context.renderBloomPickerTrayRows([item]);const first=list.innerHTML;
 item.PTRAVAILABLE=69;context.renderBloomPickerTrayRows([item]);assert.notEqual(list.innerHTML,first);assert.match(list.innerHTML,/>69</);assert.equal(list.scrollTop,42);
});
