import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { readComposedRuntimeSource } from '../../scripts/composed-app-source.mjs';

export function registerInventorySuggestionTest() {
  test('Inventory Suggestion routes to manual 16-size consolidation', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const runtime = readComposedRuntimeSource();
  assert.match(html, /id="inventory-open-suggestions"[^]*openInventorySuggestionView/);
  assert.match(html, /id="view-inventory-suggestion"[^]*openInventoryConsolidationView/);
  assert.match(html, /id="view-inv-consolidation"/);
  assert.match(runtime, /INVENTORY_CONSOLIDATION_SIZES=Object\.freeze\(\[[^\]]+\]\)/);
  assert.match(runtime, /Number\(row\.locOnHand\) > 0 && Number\(row\.locOnHand\) < 100/);
  for (const label of ['All Crop Tiers', 'Carry Over', 'Current Crop', 'Future Crop', 'CARRY_OVER', 'CURRENT_CROP', 'FUTURE_CROP']) {
    assert.match(runtime, new RegExp(label));
  }
  assert.match(runtime, /getInventoryConsolidationValidDestinations/);
  assert.doesNotMatch(runtime, /scheduleInventoryConsolidationWarmup\(touchShell \? 900 : 120\)/);
  assert.match(runtime, /ownerKey !== getInventoryConsolidationCacheKey\(\)/);
  assert.doesNotMatch(runtime, /Current SY -> Same SY|Older SY -> Any SY/);
  assert.match(runtime, /Nothing enters Location Moves until you click Send\./);
  assert.match(runtime, /openInventoryConsolidationLocationMove/);
});

}


export function registerAvCatalogTest(source) {
test('AV marks a cold administrator catalog partial and prefers complete master over an old AV slice', () => {
  const master = Array.from({ length: 9600 }, (_, id) => ({ UNIQUE_ID: id }));
  let complete = false;
  const ctx = vm.createContext({ fullInventory: master, avOpenInventory: master.slice(0, 76), activeAVTab: 'open',
    canUseProductionLiveSync: () => true, shouldUseRepAvOpenDataset: () => false,
    getDatasetState: () => ({ rowCompleteness: complete ? 'complete' : 'partial' }),
    isDatasetLoaded: key => key === 'avOpen' || complete,
  });
  vm.runInContext(source('isAvLiveCatalogIncomplete') + source('selectAvSalesInventorySourceRows'), ctx);
  assert.equal(ctx.isAvLiveCatalogIncomplete(), true, 'a 76-row admin preview must never be advertised as complete');
  complete = true;
  ctx.shouldUseRepAvOpenDataset = () => true;
  assert.equal(ctx.selectAvSalesInventorySourceRows().length, 9600, 'the complete master supersedes a previously loaded AV subset');
});

}
