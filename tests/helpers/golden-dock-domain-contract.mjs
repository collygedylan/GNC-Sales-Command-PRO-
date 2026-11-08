import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { calculateLiveLocPhotoMatch } from '../../src/core/inventory-photo-domain.js';
import { suspendTagReceiptMatchesSource } from '../../src/core/suspend-receipt-domain.js';
import { buildDockPlanstartIndex, resolveDockPlanstartValue } from '../../src/core/suspend-planstart-domain.js';

function classic(name) {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(new URL(`../../assets/${name}.js`, import.meta.url), 'utf8'), context);
  return context;
}

export function dockZeroProjectionContract() {
  const browser = classic('inventory-photo-domain');
  for (const evaluate of [calculateLiveLocPhotoMatch, browser.calculateLiveLocPhotoMatch]) {
    assert.equal(evaluate({ PTRONHAND: 0, PTRAVAILABLE: 174, MATCH: 100 }), 0);
    assert.equal(evaluate({ PTRAVAILABLE: 100, MATCH: 50 }), 50);
    assert.equal(evaluate({ PTRONHAND: 80, PTRAVAILABLE: 80, MATCH: 50 }), 40);
  }
}

export function suspendExactReceiptContract() {
  const browser = classic('suspend-receipt-domain');
  for (const matches of [suspendTagReceiptMatchesSource, browser.suspendTagReceiptMatchesSource]) {
    for (const operation of ['save', 'complete', 'close']) {
      assert.equal(matches(operation, { sourceUid: 'row-a' }, { row: { unique_id: 'row-a', date_completed: '2026-09-08T16:00:00Z' } }), true);
      assert.equal(matches(operation, { sourceUid: 'row-a' }, { row: { unique_id: 'row-b' } }), false);
      assert.equal(matches(operation, { sourceUid: 'row-a' }, { row: { unique_id: ' row-a ' } }), false);
      assert.equal(matches(operation, { sourceUid: 'row-a' }, {}), false);
    }
  }
  assert.equal(suspendTagReceiptMatchesSource('complete', { sourceUid: 'row-a' }, { row: { unique_id: 'row-a', date_completed: 'invalid' } }), false);
}

export function suspendPlanstartIndexContract() {
  const browser = classic('suspend-planstart-domain');
  const rows = [
    { DOCK: '1', STOPNUMBER: '2', ITEMCODE: 'A', PLANSTART: '2026-11-02' },
    { DOCK: '1', STOPNUMBER: '3', ITEMCODE: 'A', PLANSTART: '2026-11-03' },
    { DOCK: '1', STOPNUMBER: '3', ITEMCODE: 'A', PLANSTART: '2026-11-04' },
  ];
  const aliases = ['PLANSTART'];
  for (const [build, resolve] of [[buildDockPlanstartIndex, resolveDockPlanstartValue],
    [browser.buildDockPlanstartIndex, browser.resolveDockPlanstartValue]]) {
    const index = build(rows, aliases, []);
    assert.equal(resolve({ DOCK: '1', STOPNUMBER: '2', ITEMCODE: 'A' }, null, rows, aliases, index), '2026-11-02');
    assert.equal(resolve({ DOCK: '1', STOPNUMBER: '3', ITEMCODE: 'A' }, null, rows, aliases, index), '');
    assert.equal(build(rows, aliases, [rows[0]]), null, 'shared objects retain sequential alias updates');
  }
}
