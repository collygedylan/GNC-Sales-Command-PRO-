// @test-group: drive
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = name => {
  const match = html.match(new RegExp('        function ' + name + '\\([^]*?^        }', 'm'));
  assert.ok(match, name);
  return match[0];
};
const plain = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const rows = [
    { UNIQUE_ID: 'c-rose', COMMONNAME: 'Rose', BLOCKALPHA: 'C', LOCATIONCODE: 'C.06.001' },
    { UNIQUE_ID: 'c-fern', COMMONNAME: 'Fern', BLOCKALPHA: 'C', LOCATIONCODE: 'C.06.001' },
    { UNIQUE_ID: 'other-c-rose', COMMONNAME: 'Rose', BLOCKALPHA: 'C', LOCATIONCODE: 'C.07.001' },
    { UNIQUE_ID: 'd-rose', COMMONNAME: 'Rose', BLOCKALPHA: 'D', LOCATIONCODE: 'D.04.001' },
  ];
  const context = vm.createContext({
    Set, Map, activeDriveMode: 'ok', activeDriveTab: 'loc', driveViewLevel: 2,
    selectedDriveBlock: 'C', selectedDriveLoc: 'C.06.001', selectedDriveName: null,
    selectedDriveSize: null, selectedDriveSeason: null, selectedDriveProgram: null,
    driveSearchRequiresManualSelection: false, resolvedViewStateEpoch: 1,
    driveUniversalSearchRestoreState: null, driveUniversalSearchPendingScrollTop: null,
    driveUniversalSearchResultCache: new Map(), driveSelectedSeasons: new Set(['F1']),
    driveGenusSelectionMode: 'all', selectedDriveGenusNames: new Set(),
    driveContSizeSelectionMode: 'all', selectedDriveContSizes: new Set(),
    driveLocationSelectionMode: 'all', selectedDriveLocationCodes: new Set(),
    driveLotSelectionMode: 'all', selectedDriveLotCodes: new Set(),
    driveQuickFilterName: '', driveQuickFilterLocation: '', driveQuickFilterLot: '',
    driveQuickFilterSize: '', driveQuickFilterLtsMode: '', driveQuickFilterLtsValue: '',
    driveQuickHoldStopOnly: false, DRIVE_NO_BLOCK_NUMBER: '__NO_BLOCK_NUMBER__',
    LocationCode: { normalize: value => String(value).trim().toUpperCase() },
    getDrivePlantLocationCode: item => item.LOCATIONCODE,
    getDriveBlockAlphaValue: item => item.BLOCKALPHA,
    getDriveBlockAlphaLabel: value => value,
    document: { getElementById: () => ({ scrollTop: 247 }) },
    firstNonEmptyValue: (...values) => values.find(value => value != null && value !== ''),
    getDriveModeItems: () => rows,
    normalizeDriveSelectedSeasons() {}, areAllDriveSeasonsSelected: () => true,
    buildDriveColumnFilterStateKey: () => '', getDriveQuickPriorityValues: () => [],
    incrementInternalPerfCounter() {},
    filterBySearch: (items, term) => items.filter(item => item.COMMONNAME.toLowerCase().includes(term.toLowerCase())),
    applyDriveColumnFiltersToItems: items => items,
    applyDriveQuickFiltersToItems: items => items, sortDriveCardItems: items => items,
  });
  context.buildDrivePlantFilterState = items => ({ filteredItems: context.driveLocationSelectionMode === 'custom'
    ? items.filter(item => context.selectedDriveLocationCodes.has(item.LOCATIONCODE)) : items });
  for (const name of ['getDriveDrillSelectionStateKey', 'captureDriveStateBeforeUniversalSearch',
    'restoreDriveStateAfterUniversalSearch', 'scopeDriveSearchToLocation',
    'getDriveUniversalSearchDataSignature', 'buildDriveUniversalSearchCacheKey',
    'setDriveUniversalSearchCacheEntry', 'buildDriveUniversalSearchState']) {
    vm.runInContext(source(name), context);
  }
  return context;
}

test('Drive search intersects the selected location with text, never widening an empty result', () => {
  const f = fixture();
  assert.deepEqual(plain(f.buildDriveUniversalSearchState('Rose').finalItems.map(row => row.UNIQUE_ID)), ['c-rose']);
  assert.equal(f.buildDriveUniversalSearchState('Oak').finalItems.length, 0);
  assert.equal(f.selectedDriveLoc, 'C.06.001');
  f.driveViewLevel = 1; f.selectedDriveLoc = null;
  assert.deepEqual(plain(f.buildDriveUniversalSearchState('Rose').finalItems.map(row => row.UNIQUE_ID)), ['c-rose', 'other-c-rose']);
});

test('Drive search cache distinguishes locations and ANDs explicit location selections', () => {
  const f = fixture();
  const first = f.buildDriveUniversalSearchState('Rose');
  f.selectedDriveBlock = 'D'; f.selectedDriveLoc = 'D.04.001';
  const second = f.buildDriveUniversalSearchState('Rose');
  assert.notEqual(first.cacheKey, second.cacheKey);
  assert.deepEqual(plain(second.finalItems.map(row => row.UNIQUE_ID)), ['d-rose']);
  f.driveLocationSelectionMode = 'custom'; f.selectedDriveLocationCodes = new Set(['C.06.001']);
  assert.equal(f.buildDriveUniversalSearchState('Rose').finalItems.length, 0);
});

test('clearing universal search restores the saved tab, drill and scroll without forcing Common Name', () => {
  const f = fixture();
  f.captureDriveStateBeforeUniversalSearch();
  f.selectedDriveBlock = 'D'; f.selectedDriveLoc = 'D.04.001'; f.driveViewLevel = 0;
  f.restoreDriveStateAfterUniversalSearch();
  assert.equal(f.activeDriveTab, 'loc'); assert.equal(f.driveViewLevel, 2);
  assert.equal(f.selectedDriveBlock, 'C'); assert.equal(f.selectedDriveLoc, 'C.06.001');
  assert.equal(f.driveUniversalSearchPendingScrollTop, 247);
  assert.equal(f.driveUniversalSearchRestoreState, null);
  f.restoreDriveStateAfterUniversalSearch();
  assert.equal(f.activeDriveTab, 'loc');
});

test('normal Drive filter computations preserve selections; explicit reset still clears them', () => {
  for (const name of ['getDriveBaseFilterContextKey', 'buildDrivePlantFilterState', 'renderDriveTopControls']) {
    assert.doesNotMatch(source(name), /clearRemovedDriveTopFilterState\(/, name);
  }
  assert.match(source('resetDriveFiltersToAll'), /clearRemovedDriveTopFilterState\(/);
  assert.match(source('buildDrivePlantFilterState'), /driveLocationSelectionMode, \[\.\.\.selectedDriveLocationCodes\]/);
});
