import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeItemcode, teamQuality, canPull, capacity, eligibleSeason, matchInventoryFamily, routeCompare, dropThresholds, validateRejection, weekdayColor, deterministicAura, manifestPdf } from '../assets/test/operations-model.mjs';

test('canonical item mapping preserves internal dots and rejects ambiguous families', () => {
  assert.equal(normalizeItemcode('  123.45... '), '123.45');
  assert.deepEqual(matchInventoryFamily('12.', [{itemcode:'12.3'}]), [{itemcode:'12.3'}]);
  assert.throws(() => matchInventoryFamily('12', [{itemcode:'12.3'}, {itemcode:'12.4'}]), /AMBIGUOUS/);
  assert.deepEqual(matchInventoryFamily('12.', [{itemcode:'12'}, {itemcode:'12.4'}]), [{itemcode:'12'}]);
});
test('mixed teams use their highest tier without allowing lower crews to pull higher tags', () => {
  assert.equal(teamQuality('', 'ESP'), 'ESP');
  assert.equal(teamQuality('SP', null), 'SP');
  for (const [team, allowed] of [['ESP', ['ESP','SP','BLANK']], ['SP',['SP','BLANK']], ['BLANK',['BLANK']]]) {
    for (const tag of ['ESP','SP','BLANK']) assert.equal(canPull(team, tag), allowed.includes(tag));
  }
  assert.throws(() => canPull('MANAGER', 'ESP'), /INVALID_QUALITY/);
  assert.equal(capacity(400),500); assert.equal(capacity(900),700);
});
test('replacement eligibility admits F1/S1 only', () => {
  for (const season of ['F1','S1','27.F1','2027.S1']) assert.equal(eligibleSeason(season),true);
  for (const season of ['Y','27.Y','U3','FS','U1','U2','X','27.FS','']) assert.equal(eligibleSeason(season),false);
});
test('rush routes precede natural block, bay and day ordering', () => {
  const rows=[{locationcode:'B.2.010'},{locationcode:'A.11.001'},{locationcode:'A.2.001'},{locationcode:'Z.90.000',is_rush_priority:true}];
  assert.deepEqual(rows.sort(routeCompare).map(r=>r.locationcode),['Z.90.000','A.2.001','A.11.001','B.2.010']);
});
test('10% handoff and 95% loading require exact evidence, including isolated remainder', () => {
  assert.equal(dropThresholds(100,9,0).inspectionReady,false);
  assert.equal(dropThresholds(100,10,0).inspectionReady,true);
  assert.equal(dropThresholds(100,95,0).palletizationReady,false);
  assert.equal(dropThresholds(100,95,5).palletizationReady,true);
  assert.equal(dropThresholds(100,94,6).palletizationReady,false);
  assert.equal(dropThresholds(0,0,0).inspectionReady,false);
  assert.throws(()=>dropThresholds(100,96,5),/INVALID_DROP/);
});
test('full and partial rejection require distinct quantity and photo evidence', () => {
  assert.equal(validateRejection('R-all',100,100,'bad.jpg',''),true);
  assert.equal(validateRejection('R-[N]',100,20,'bad.jpg','good.jpg'),true);
  assert.throws(()=>validateRejection('R-[N]',100,20,'bad.jpg',''),/TWO_PHOTOS/);
  assert.throws(()=>validateRejection('R-all',100,20,'bad.jpg',''),/MUST_MATCH/);
  assert.throws(()=>validateRejection('R-all',100,100,'',''),/EVIDENCE/);
});
test('local weekdays retain Suspend colors', () => {
  assert.deepEqual(['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06'].map(weekdayColor),['#7C3AED','#DC2626','#16A34A','#2563EB','#16A34A']);
});
test('AURA fallback uses supplied rows and needs no network or provider credential', () => {
  assert.match(deterministicAura('live drivers',{lines:[{is_rush_priority:true}],drops:[{is_live_driver:true}]}),/1 open rush lines; 1 live drivers/);
  assert.match(deterministicAura('HL bays',{staging:[{bay:1},{bay:2,released_at:'2026-11-01'}]}),/1 of 11/);
});
test('PDF manifests contain actual quantities, signatures, seal and multiple valid pages', async () => {
  const result=manifestPdf({load_id:'LOAD-1',drop_number:2,driver_name:'Driver A',inspector_signoff_by:'Inspector B',trailer_seal_number:'SEAL-9'},Array.from({length:50},(_,i)=>({itemcode:'ITEM-'+i,locationcode:'A.2.001',shipped_qty:95,ordered_qty:100})));
  const text=typeof result==='string'?result:await new Blob([result]).text();
  assert.match(text,/^%PDF-1\./); assert.match(text,/LOAD-1/); assert.match(text,/SEAL-9/); assert.match(text,/95 \/ 100/);
  assert.match(text,/\/Count 3/); assert.match(text,/startxref\n\d+\n%%EOF/);
});
