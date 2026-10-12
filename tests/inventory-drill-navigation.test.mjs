// @test-group: drive
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = name => html.match(new RegExp('        function ' + name + '\\([^]*?^        }', 'm'))?.[0] || assert.fail(name);
function fixture(mode) {
  const context = vm.createContext({ Set, activeDriveMode: mode, activeDriveTab: 'name', driveViewLevel: 3,
    selectedDriveName: 'Maple', selectedDriveSize: '#3', selectedDriveSeason: 'F1', selectedDriveProgram: null,
    selectedDriveBlock: null, selectedDriveLoc: null, selectedDriveCommonNames: new Set(['Maple']),
    driveCommonNameSearchTerm: 'Maple', driveCommonNameFilterOpen: true,
    driveColumnFilters: { COMMONNAME: ['Maple'], LOCATIONCODE: ['A'] },
    getManagerAssignedColumnState: () => ({}), getCurrentVisibleViewId: () => 'drive',
    isDrawerOpen: () => false, getVisibleSecondaryBack: () => null, closeOpenInteractiveSurfaceForBack: () => false,
    window: {}, LocationCode: { back: () => false },
    cancelDriveSearchRenderWork() {}, getNavigationScrollPosition: () => 42, updateGlobalBackButton() {},
    runDirectTrackedNavigation: (_view, _key, apply) => { apply(); return false; },
    document: { getElementById: () => ({ value: 'Maple', classList: { add() {} }, removeAttribute() {} }) },
    setDriveSearchManualSelectionLock() {}, restoreDriveStateAfterUniversalSearch() {}, syncDriveTabPills() {},
    scheduleDriveSearchRender() {},
  });
  for (const name of ['goBackUniversal', 'backToDriveSeasons', 'backToDriveSizes', 'backToDriveNames', 'resetDriveDrillSelectionState', 'clearDriveSearch']) vm.runInContext(source(name), context);
  return context;
}
test('shared inventory navigation backs through Season, Container Size and Common Name in order', () => {
  for (const mode of ['ok']) {
    const f = fixture(mode);
    f.goBackUniversal(); assert.equal(f.driveViewLevel, 2); assert.equal(f.selectedDriveSeason, null); assert.equal(f.selectedDriveSize, '#3');
    f.goBackUniversal(); assert.equal(f.driveViewLevel, 1); assert.equal(f.selectedDriveSize, null); assert.equal(f.selectedDriveName, 'Maple');
    f.goBackUniversal(); assert.equal(f.driveViewLevel, 0); assert.equal(f.selectedDriveName, null);
  }
});
test('clear search exits common-name filters immediately and preserves other column filters', () => {
  for (const mode of ['ok']) {
    const f = fixture(mode); f.activeDriveTab = 'loc'; f.clearDriveSearch();
    assert.equal(f.driveViewLevel, 0); assert.equal(f.activeDriveTab, 'name'); assert.equal(f.selectedDriveName, null);
    assert.equal(f.selectedDriveCommonNames.size, 0); assert.equal(f.driveCommonNameSearchTerm, '');
    assert.equal(f.driveCommonNameFilterOpen, false); assert.equal(f.driveColumnFilters.COMMONNAME, undefined);
    assert.deepEqual(f.driveColumnFilters.LOCATIONCODE, ['A']);
  }
});

test('AV search clear resets stored item drill and common-name column filters', () => {
  const f = vm.createContext({ avOpenLevel: 3, selectedAvOpenName: 'Maple', selectedAvOpenSize: '#3',
    selectedAvOpenSeason: 'F1', selectedAvOpenLot: '27.F1', avColumnFilters: { COMMONNAME: ['Maple'], CONTSIZE: ['#3'] },
    avResolvedBaseStateKey: 'old', avResolvedBaseStateCache: {},
    document: { getElementById: () => ({ value: 'Maple', classList: { add() {} } }) },
    resetAvSearchDrilldownState: () => { f.avOpenLevel = 0; },
    scheduleTrackedSearchViewRender() {}, isTouchConstrainedDevice: () => false });
  vm.runInContext(source('clearAVSearch'), f); f.clearAVSearch();
  assert.equal(f.avOpenLevel, 0); assert.equal(f.selectedAvOpenName, null); assert.equal(f.selectedAvOpenSeason, null);
  assert.equal(f.avColumnFilters.COMMONNAME, undefined); assert.deepEqual(f.avColumnFilters.CONTSIZE, ['#3']);
  assert.equal(f.avResolvedBaseStateCache, null);
});
