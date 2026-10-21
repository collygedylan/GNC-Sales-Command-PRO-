import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = readComposedAppSource();
function extract(start, end) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); }

test('Item Detail options use the shared item/name index and refresh after same-count edits', () => {
  const ctx = vm.createContext({ Map, Set, JSON, Array, String,
    fullInventory: [ { ITEMCODE:'A', COMMONNAME:'Plant', CONTSIZE:'#1', UNIQUE_ID:'1' },
      { ITEMCODE:'B', COMMONNAME:'Plant', CONTSIZE:'#1', UNIQUE_ID:'2' },
      { ITEMCODE:'C', COMMONNAME:'Plant', CONTSIZE:'#3', UNIQUE_ID:'3' } ],
    inventoryDomIdLookupCacheVersion: 1,
    getSupabaseReadIdentityScope: () => 'account-a',
    getRequestItemCodeOptionItemCode: row => row.ITEMCODE,
    getRequestItemCodeOptionCommonNameKey: row => row.COMMONNAME,
    getRequestItemCodeOptionContSizeKey: row => row.CONTSIZE
  });
  vm.runInContext(extract('        let requestSharedInventoryOptionIndex', '        function getRequestItemCodeOptionRows('), ctx);
  assert.deepEqual(Array.from(ctx.getRequestSharedInventoryOptionRows(ctx.fullInventory[0]), r => r.UNIQUE_ID), ['1','2']);
  ctx.fullInventory[1] = { ITEMCODE:'D', COMMONNAME:'Other', CONTSIZE:'#1', UNIQUE_ID:'4' };
  ctx.inventoryDomIdLookupCacheVersion++;
  assert.deepEqual(Array.from(ctx.getRequestSharedInventoryOptionRows(ctx.fullInventory[0]), r => r.UNIQUE_ID), ['1']);
});

test('local options paint before remote reads, complete snapshots avoid redundant reads, denial stays visible', () => {
  const fn = extract('        async function loadRequestItemCodeOptions(', '        function getRequestThisLocationCode(');
  assert.ok(fn.indexOf('getRequestSharedInventoryOptionRows(item)') < fn.indexOf('fetchRequestItemCodeOptionRowsFromSupabase(itemCode'));
  assert.match(fn, /hasCompleteRequestOptionSnapshot\(\)/);
  assert.match(fn, /isSupabaseReadTerminalDenial\(lookupError\)/);
  assert.match(fn, /state\.denied = isSupabaseReadTerminalDenial\(error\)/);
});

test('MARK DONE is isolated from card/plus handlers and save has no spec-only gate', () => {
  const button = source.match(/<button[^>]*id="req-btn-save-complete"[^>]*>/)?.[0] || '';
  assert.match(button, /data-fast-press-ignore/);
  assert.match(button, /event\.stopImmediatePropagation\(\)/);
  assert.match(button, /saveData\(true, 'req-'\)/);
  const start = source.indexOf('        async function saveData(');
  assert.doesNotMatch(source.slice(start, start + 40000), /Spec and caliper are blank|appendSpecCaliperToAvNote\(/);
});
