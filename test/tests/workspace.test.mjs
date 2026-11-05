import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { dockNumber, dockGroups, checkInControls, itemCards } from '../assets/test/operations-ui.mjs';
test('physical dock hierarchy rejects load IDs and combines drops under one dock', () => {
  assert.equal(dockNumber('Dock 34'), '34'); assert.equal(dockNumber('T12832'), '');
  const groups = dockGroups([{dock_bay:'Dock 34',total_items:10,checked_items:2},{dock_bay:'34',total_items:20,checked_items:3,is_live_driver:true},{dock_bay:'T12832'}], []);
  assert.equal(groups[0].drops.length,2); assert.equal(groups[0].total,30); assert.equal(groups[0].checked,5); assert.equal(groups[0].rush,true); assert.equal(groups[1].dock,'');
});
test('check-in has three explicit states and item cards keep six independent metrics', () => {
  const html=checkInControls({load_id:'TEST',check_in_status:''});
  assert.equal((html.split('</select>')[0].match(/<option/g)||[]).length,3);
  for(const value of ['value=""','value="Trailer"','value="Live Driver"'])assert.ok(html.includes(value));
  const card=itemCards([{soc_id:'x',itemcode:'A',dock:'Dock 38',ordered_qty:10,shipped_qty:8,ptronhand:100,ptrreviewed:20,ptravailable:80,open_stock:30,loc_match_qty:40,loc_on_hand:120}]);
  assert.equal((card.match(/class="test-kpi"/g)||[]).length,6);assert.ok(card.includes('8 / 10'));assert.ok(!card.includes('Dock Dock'));
});
test('a replacement test worker activates only after complete shell caching succeeds', async () => {
  const source=await fs.readFile(new URL('../sw-test.js',import.meta.url),'utf8');
  for(const fail of [false,true]) {
    const events={},calls=[];let task;
    vm.runInNewContext(source,{Request:class {constructor(url,init){this.url=url;this.cache=init.cache;}},caches:{open:async()=>({addAll:async entries=>{assert.ok(entries.every(r=>r.cache==='reload'));calls.push('cached');if(fail)throw Error('offline');}})},self:{addEventListener:(name,fn)=>events[name]=fn,skipWaiting:async()=>calls.push('activate')}});
    events.install({waitUntil:p=>task=p});if(fail)await assert.rejects(task,/offline/);else await task;
    assert.deepEqual(calls,fail?['cached']:['cached','activate']);
  }
});
