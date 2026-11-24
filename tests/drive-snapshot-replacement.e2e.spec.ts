import { expect, test, type Page } from '@playwright/test';
import { hlMaster, installHlOrderFixture } from './fixtures/hl-order-state.mjs';
// @test-group: @local-e2e,@release-functional

function driveRows() {
  const physicalRows = [
    ['ghost-f1', 'A.01.000', 'F1', 140], ['ghost-s1', 'A.01.000', 'S1', 250],
    ['current-f1', 'B.02.000', 'F1', 119], ['current-s1', 'B.02.000', 'S1', 250],
  ] as const;
  return physicalRows.map(([id, location, season, quantity]) => hlMaster(id, {
    itemcode: 'DRIVE-REPLACEMENT', commonname: 'Blue Pacific Juniper Wreath',
    contsize: '#2', locationcode: location, season, lotcode: `27.${season}`,
    saleyear: '2027', source: 'HL', ptronhand: String(quantity), ptravailable: String(quantity), ptrreviewed: '0',
  }));
}

function displayedDriveRows(page: Page) {
  return page.evaluate(() => window.eval(`fullInventory.filter(row => row.ITEMCODE === 'DRIVE-REPLACEMENT')
    .map(row => [row.UNIQUE_ID, row.LOCATIONCODE])`));
}

test('a complete Drive replacement drops vanished locations without a page reload', {
  tag: ['@local-e2e', '@release-functional'],
}, async ({ page, baseURL }) => {
  const rows = driveRows();
  const fixture = await installHlOrderFixture(page, baseURL!, { role: 'ADMIN', username: 'fixture_admin', master: rows });
  await page.evaluate(() => window.eval("switchView('drive')"));
  await expect.poll(() => displayedDriveRows(page)).toHaveLength(4);
  fixture.master = rows.slice(2);
  fixture.datasetRevision++;
  await page.evaluate(() => window.eval("getProductionLiveSyncCoordinator().check('revision')"));
  await expect.poll(() => displayedDriveRows(page)).toEqual([['current-f1', 'B.02.000'], ['current-s1', 'B.02.000']]);

  await page.locator('#drive-search').fill('blue pac');
  await expect(page.getByRole('button', { name: 'Open Blue Pacific Juniper Wreath' })).toContainText('2 Rows');
  await page.evaluate(() => window.eval(`(() => {
    const rows = fullInventory.filter(row => row.ITEMCODE === 'DRIVE-REPLACEMENT');
    document.getElementById('drive-content').innerHTML = rows.map(row =>
      generateCard(row, 'drive', 'status-green', { preserveUnknownAvailability: true, verifiedQuantityRow: row })).join('');
  })()`));
  const cards = page.locator('#drive-content .app-drive-compact-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText('B.02.000');
  await expect(cards.first()).toContainText('369');
  await expect(page.locator('#drive-content').getByText('A.01.000', { exact: true })).toHaveCount(0);
  expect(fixture.blockedMutations).toEqual([]);
});
