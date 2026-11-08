import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseExpressionAt } from 'acorn';
import {
  isCompleteMasterInventorySnapshot,
  isRecoverableSnapshotError,
  selectAvailableInventoryPreviewAdapterIds,
  shouldRetainCompleteInventorySnapshot
} from './inventory-hydration-recovery.js';
import { readComposedRuntimeSource } from '../../scripts/composed-app-source.mjs';
import { mergeLiveInventoryCardRows } from './dock-order-domain.js';
import { verifyFieldCoverageDriftRecovery } from './golden-inventory-hydration-recovery.mjs';

const readRepository = file => readFileSync(new URL('../../' + file, import.meta.url), 'utf8');

function completeInventory() {
  return Array.from({ length: 9480 }, (_, index) => ({
    unique_id: `row-${index}`,
    commonname: `Name ${index % 1635}`,
    itemcode: `Item ${index % 3263}`,
    locationcode: `Location ${index % 676}`,
    blockalpha: `Block ${index % 13}`
  }));
}

function previewFunctionSource() {
  const runtime = readComposedRuntimeSource();
  const start = runtime.indexOf('function previewProductionSnapshots(');
  assert.ok(start >= 0, 'the composed runtime retains its canonical preview publisher');
  const node = parseExpressionAt(runtime, start, { ecmaVersion: 'latest' });
  return runtime.slice(node.start, node.end);
}

function coldRecoverySource() {
  const runtime = readComposedRuntimeSource();
  const start = runtime.indexOf('async function recoverColdInventoryView(');
  assert.ok(start >= 0, 'the composed runtime retains its cold inventory recovery owner');
  const node = parseExpressionAt(runtime, start, { ecmaVersion: 'latest' });
  return runtime.slice(node.start, node.end);
}

function distinct(rows, key) {
  return new Set(rows.map(row => row[key])).size;
}

export async function invariant548({ read = readRepository } = {}) {
  const currentRows = completeInventory();
  const incomingRows = currentRows.slice(0, 200).map((row, index) => ({
    ...row,
    commonname: `Preview ${index % 9}`
  }));
  const retain = shouldRetainCompleteInventorySnapshot({
    currentRows,
    currentState: {
      initialLoaded: true,
      fullLoaded: true,
      rowCompleteness: 'complete',
      expectedRowCount: 9480
    },
    incomingRows,
    incomingCompleteness: 'partial'
  });
  const publishedRows = retain ? currentRows : incomingRows;
  assert.equal(publishedRows.length, 9480);
  assert.equal(distinct(publishedRows, 'commonname'), 1635);
  assert.equal(distinct(publishedRows, 'itemcode'), 3263);
  assert.equal(distinct(publishedRows, 'locationcode'), 676);
  assert.equal(distinct(publishedRows, 'blockalpha'), 13);
  assert.equal(isCompleteMasterInventorySnapshot({
    rows: incomingRows,
    state: { initialLoaded: true, fullLoaded: false, rowCompleteness: 'partial', expectedRowCount: 9480 }
  }), false);
  assert.equal(isRecoverableSnapshotError(
    new Error('Inventory field coverage changed between pages; the partial snapshot was discarded.')
  ), true);
  const previewSource = previewFunctionSource();
  assert.match(previewSource, /shouldRetainCompleteInventorySnapshot/);
  assert.ok(previewSource.indexOf('shouldRetainCompleteInventorySnapshot')
    < previewSource.indexOf('processAndLoadData(payload)'));
  assert.match(coldRecoverySource(), /ensureDatasetLoaded\('master', 'full',[\s\S]*bypassLiveSyncCoordinator:\s*true,[\s\S]*force:\s*true/);
  await verifyFieldCoverageDriftRecovery(read);
  assert.match(read('.agents/skills/agdata-core-sync/SKILL.md'), /Invariant 548/);
}

export async function invariant549({ read = readRepository } = {}) {
  const physicalRows = [
    { UNIQUE_ID: 'one', ITEMCODE: 'ITEM-1', LOCATIONCODE: 'A-1', LOTCODE: 'F1', PHOTO_LINK: 'https://example.test/one.jpg' },
    { UNIQUE_ID: 'two', ITEMCODE: 'ITEM-1', LOCATIONCODE: 'A-1', LOTCODE: 'F1', PHOTO_LINK: 'https://example.test/two.jpg' }
  ];
  const parsePhotos = value => String(value || '').split(',').map(entry => entry.trim()).filter(Boolean);
  const merged = mergeLiveInventoryCardRows(physicalRows);
  assert.equal(merged.length, 1);
  assert.deepEqual(parsePhotos(merged[0].PHOTO_LINK), [
    'https://example.test/one.jpg', 'https://example.test/two.jpg'
  ]);
  assert.doesNotMatch(readRepository('assets/app-runtime.js'), /function parsePhotoCsvValues/);
  assert.match(read('src/core/inventory-photo-domain.js'), /export function parsePhotoCsvValues/);
  assert.match(read('.agents/skills/agdata-core-sync/SKILL.md'), /Invariant 549/);
}

export async function invariant550({ read = readRepository } = {}) {
  const metadata = { id: 'side:homeSyncMetadata' };
  assert.equal(selectAvailableInventoryPreviewAdapterIds({
    progressive: true, view: 'home', adapters: [metadata]
  }), undefined);
  assert.deepEqual(selectAvailableInventoryPreviewAdapterIds({
    progressive: true, view: 'home', adapters: [{ id: 'core:master' }, metadata]
  }), ['core:master']);
  const runtime = readRepository('assets/app-runtime.js');
  assert.match(runtime, /function observeHlOrderVerificationContext\([\s\S]*selectAvailableInventoryPreviewAdapterIds/);
  assert.match(read('.agents/skills/agdata-core-sync/SKILL.md'), /Invariant 550/);
}

export async function invariant551({ read = readRepository } = {}) {
  const runtime = readComposedRuntimeSource();
  const start = runtime.indexOf('function rebuildMasterInventoryIndexes(');
  assert.ok(start >= 0, 'the canonical master index owner remains available');
  const node = parseExpressionAt(runtime, start, { ecmaVersion: 'latest' });
  const source = runtime.slice(node.start, node.end);
  assert.doesNotMatch(source, /fullInventory\s*=\s*mergeLiveInventoryCardRows/);
  assert.match(source, /buildMasterInventoryIndexMaps\(fullInventory\)/);
  const canonicalRows = [
    { UNIQUE_ID: 'one', ITEMCODE: 'ITEM', LOCATIONCODE: 'A-1', LOTCODE: 'F1', DOM_ID: 'fi_0' },
    { UNIQUE_ID: 'two', ITEMCODE: 'ITEM', LOCATIONCODE: 'A-1', LOTCODE: 'F1', DOM_ID: 'fi_1' }
  ];
  assert.equal(mergeLiveInventoryCardRows(canonicalRows).length, 2);
  assert.match(read('.agents/skills/agdata-core-sync/SKILL.md'), /Invariant 551/);
}

export async function invariant552({ read = readRepository } = {}) {
  const runtime = readComposedRuntimeSource();
  const start = runtime.indexOf('function renderDriveCompleteCommonNames(');
  assert.ok(start >= 0, 'the Drive Common Name view owner remains available');
  const node = parseExpressionAt(runtime, start, { ecmaVersion: 'latest' });
  const source = runtime.slice(node.start, node.end);
  assert.ok(source.split(/\r?\n/).length <= 60);
  assert.doesNotMatch(source, /productionLiveSyncCoordinator\.getStatus/);
  assert.match(source, /GncDriveCommonNamePreparation\.prepareDriveCommonNameBatches/);
  assert.match(read('.agents/skills/agdata-core-sync/SKILL.md'), /Invariant 552/);
}

export async function invariant553({ read = readRepository } = {}) {
  const runtime = readComposedRuntimeSource();
  const start = runtime.indexOf('function finishProductionRefresh(');
  assert.ok(start >= 0, 'the staged refresh completion owner remains available');
  const node = parseExpressionAt(runtime, start, { ecmaVersion: 'latest' });
  const source = runtime.slice(node.start, node.end);
  assert.doesNotMatch(source, /productionLiveSyncCoordinator\.getStatus/);
  assert.match(source, /getProductionLiveSyncCoordinator\(\)\?\.getStatus/);
  assert.match(read('.agents/skills/agdata-core-sync/SKILL.md'), /Invariant 553/);
}

export async function invariant554({ read = readRepository } = {}) {
  const sourceText = read('assets/row-workflow-functions.js');
  const start = sourceText.indexOf('function resolveLiveInventoryForCard(');
  assert.ok(start >= 0, 'the canonical live card display resolver remains available');
  const node = parseExpressionAt(sourceText, start, { ecmaVersion: 'latest' });
  const source = sourceText.slice(node.start, node.end);
  assert.doesNotMatch(source, /exactMaster[\s\S]*return\s+\{\.\.\.canonical/);
  assert.match(source, /hydrateLiveInventoryCardDisplay\(primary, selected, atLocation, rows/);
  assert.match(read('src/core/dock-order-domain.js'), /resolveLiveInventoryCardPhotoMatch/);
  assert.match(read('.agents/skills/agdata-core-sync/SKILL.md'), /Invariant 554/);
}
