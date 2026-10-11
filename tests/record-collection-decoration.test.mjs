// @test-group: foundation
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const client=fs.readFileSync(new URL('../assets/ops-precision-pilot.js',import.meta.url),'utf8');
const source=client.slice(client.indexOf('  function isRecordNode('),client.indexOf('  function scheduleDecorateRecordCollections('));
const pattern=client.match(/  const RECORD_CLASS_PATTERN = [^\n]+/)[0];
function fixture(markup) {
 const dom=new JSDOM(`<div id="request-content">${markup}</div>`,{runScripts:'outside-only'});
 const w=dom.window;
 w.eval(`${pattern}\nvar state={activeView:'request'},decorateFrame=0,LIST_VIEWS=new Set(['request']),LIST_ROOT_IDS={request:'request-content'};\n${source}\nwindow.decorate=decorateRecordCollections;`);
 return {dom,w,root:w.document.getElementById('request-content')};
}

test('unchanged record collections retain classes and DOM nodes without style mutations',()=>{
 const f=fixture('<div id="a" class="item-row"><div>One</div></div><div id="b" class="item-row"><div>Two</div></div>');
 try {
  f.w.decorate();
  const cards=Array.from(f.root.children);
  assert.equal(f.root.classList.contains('ops-record-collection'),true);
  assert.equal(cards.every(card=>card.classList.contains('ops-record-node')),true);
  const observer=new f.w.MutationObserver(()=>{});
  observer.observe(f.root,{attributes:true,attributeFilter:['class'],subtree:true});
  f.w.decorate();
  assert.equal(observer.takeRecords().length,0);
  assert.deepEqual(Array.from(f.root.children),cards);
  const newCard=f.w.document.createElement('div');newCard.className='item-row';f.root.appendChild(newCard);
  f.w.decorate();
  assert.equal(newCard.classList.contains('ops-record-node'),true);
  assert.deepEqual(observer.takeRecords().map(record=>record.target),[newCard]);
  observer.disconnect();
 }finally{f.dom.window.close();}
});

test('changed grouping removes stale outer classes and reclassifies nested records',()=>{
 const f=fixture('<div id="a" class="item-row"><div class="item-row" id="one"></div><div class="item-row" id="two"></div></div><div id="b" class="item-row"></div>');
 try{
  f.w.decorate();
  const first=f.w.document.getElementById('a');
  assert.equal(first.classList.contains('ops-record-node'),true);
  assert.equal(f.w.document.getElementById('one').classList.contains('ops-record-node'),false);
  first.classList.remove('item-row');
  f.w.decorate();
  assert.equal(f.root.classList.contains('ops-record-collection'),false);
  assert.equal(first.classList.contains('ops-record-node'),false);
  assert.equal(first.classList.contains('ops-record-collection'),true);
  assert.equal(f.w.document.getElementById('one').classList.contains('ops-record-node'),true);
  assert.equal(f.w.document.getElementById('two').classList.contains('ops-record-node'),true);
  assert.equal(f.w.document.getElementById('b').classList.contains('ops-record-node'),false);
 }finally{f.dom.window.close();}
});
