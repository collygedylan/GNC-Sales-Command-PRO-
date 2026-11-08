import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import { buildDockPlanstartIndex, resolveDockPlanstartValue } from '../src/core/suspend-planstart-domain.js';

const aliases = ['PLANSTART', 'planstart'];
const row = (id, date) => ({ dock: '1', stopnumber: id, itemcode: '001.1', consignee: 'customer', planstart: date });

test('indexed planstart fallback matches direct resolution for aliases, unique and ambiguous dates', () => {
  const rows = [row('1', '2026-11-02'), row('1', '2026-11-02'), row('2', '2026-11-03'), row('2', '2026-11-04')];
  const index = buildDockPlanstartIndex(rows, aliases);
  assert.equal(buildDockPlanstartIndex(rows, aliases, [rows[0]]), null, 'shared source objects retain sequential alias mutation semantics');
  for (const [item, source, expected] of [
    [row('1', ''), null, '2026-11-02'], [row('2', ''), null, ''],
    [row('3', ''), null, ''], [row('1', 'item-date'), row('1', 'source-date'), 'source-date'],
    [row('1', 'item-date'), null, 'item-date'], [row('1', 0), null, 0],
    [{ ...row('1', ''), SNAPSHOT: { PLANSTART: 'snapshot-date' } }, null, 'snapshot-date'],
  ]) {
    assert.equal(resolveDockPlanstartValue(item, source, rows, aliases, index), expected);
    assert.equal(resolveDockPlanstartValue(item, source, rows, aliases), expected);
  }
});

test('one plan index avoids rescanning source rows for each missing date', () => {
  let reads = 0;
  const rows = Array.from({ length: 500 }, (_, i) => new Proxy(row(String(i), ''), {
    get(target, key) { if (key === 'dock') reads += 1; return target[key]; },
  }));
  const index = buildDockPlanstartIndex(rows, aliases);
  for (const item of rows) resolveDockPlanstartValue(item, null, rows, aliases, index);
  assert.ok(reads <= rows.length * 2, `expected linear identity reads, got ${reads}`);
});

test('runtime planstart owner retains alias publication for an indexed fallback', () => {
  const source = readComposedAppSource();
  const start = source.indexOf('function getDockSuspendDcRequestPlanstartValue(');
  const end = source.indexOf('function getDockSuspendDcRequestPlanstartInfo(', start);
  assert.ok(start >= 0 && end > start);
  const rows = [row('1', '2026-11-02')];
  const item = row('1', '');
  const ctx = vm.createContext({ socInventory: rows, DOCK_SUSPEND_PLANSTART_ALIASES: aliases,
    resolveDockPlanstartValue, findDockSuspendDcRequestSourceRow: () => null });
  vm.runInContext(source.slice(start, end), ctx);
  assert.equal(ctx.getDockSuspendDcRequestPlanstartValue(item, null, buildDockPlanstartIndex(rows, aliases, [item])), '2026-11-02');
  assert.deepEqual([item.PLANSTART, item.planstart, item.PLAN_START], ['2026-11-02', '2026-11-02', '2026-11-02']);
});
