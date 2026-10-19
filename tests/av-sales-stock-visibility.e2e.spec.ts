import { expect, test } from '@playwright/test';
import { hlMaster, installHlOrderFixture } from './fixtures/hl-order-state.mjs';

// @test-group: @local-e2e
// Synthetic inventory/reserve data only. The fixture blocks all mutations and
// never sends email or writes to Supabase.
test('sales reps retain full AV hydration and see open stock plus their normalized reserve itemcodes', { tag: ['@av-sales-stock-visibility', '@local-e2e'] }, async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  page.on('pageerror', error => console.log('AV_BROWSER_ERROR', error.message));

  const master = Array.from({ length: 9_996 }, (_, index) => hlMaster(`bulk-${String(index).padStart(5, '0')}`, {
    itemcode: `BULK-${String(index).padStart(5, '0')}`,
    commonname: `Synthetic bulk row ${index}`,
    season: 'U2', saleyear: '27', lotcode: '27.U2', s_lts: '0',
  }));
  master.push(
    hlMaster('open-positive', { itemcode: 'OPEN-1500', commonname: 'Open stock without reserve', season: 'F1', saleyear: '27', lotcode: '27.F1', s_lts: '1,500' }),
    hlMaster('own-reserve-lot-a', { itemcode: 'Own-200', commonname: 'Own reserve across lots', season: 'F1', saleyear: '27', lotcode: '27.F1', s_lts: '0' }),
    hlMaster('own-reserve-lot-b', { itemcode: 'OWN-200', commonname: 'Own reserve across lots', season: 'F1', saleyear: '27', lotcode: '26.F1', s_lts: '-2' }),
    hlMaster('own-other-customer', { itemcode: 'OWN-SECOND', commonname: 'Own second customer reserve', season: 'F1', saleyear: '27', lotcode: '27.F1', s_lts: '0' }),
    hlMaster('other-rep-reserve', { itemcode: 'OTHER-300', commonname: 'Other rep reserve only', season: 'F1', saleyear: '27', lotcode: '27.F1', s_lts: '0' }),
  );
  const reserves = [
    { unique_id: 'own-reserve', itemcode: ' own-200 ', season: 'F1', lotcode: '27.F1', salesrepname: 'Riley Sales', customername: 'Riley Customer', consigneename: 'Riley Customer' },
    { unique_id: 'own-second-reserve', itemcode: 'OWN-SECOND', season: 'F1', lotcode: '27.F1', salesrepname: 'Riley Sales', customername: 'Second Customer', consigneename: 'Second Customer' },
    { unique_id: 'other-reserve', itemcode: 'OTHER-300', season: 'F1', lotcode: '27.F1', salesrepname: 'Morgan Sales', customername: 'Other Customer', consigneename: 'Other Customer' },
  ];

  const fixture = await installHlOrderFixture(page, baseURL!, {
    username: 'riley_sales', role: 'REP', master, reserveRows: reserves,
  });
  await page.evaluate(() => (window as any).switchView('av'));
  await expect(page.locator('#view-av')).toBeVisible();
  // Await the complete 10,001-row cold snapshot separately from warm UI/CPU
  // timing gates. WebKit preparation exceeded the default 15-second expect wait
  // but completed without error; retain a bounded functional hydration wait.
  const hydrationStarted = Date.now();
  await expect.poll(() => page.evaluate(() => window.eval(`
    selectAvSalesInventorySourceRows().length === 10_001
      && isDatasetLoaded('master', 'full') && isDatasetLoaded('reserves', 'full')
  `)), { timeout: 60_000 }).toBe(true);
  const hydrationMs = Date.now() - hydrationStarted;

  expect(fixture.masterLaterPageReads).toBeGreaterThan(0);
  await expect(page.locator('#av-content').getByRole('heading')).toHaveCount(4);
  await expect(page.locator('#av-content')).toContainText('Open stock without reserve');
  await expect(page.locator('#av-content')).toContainText('Own reserve across lots');
  await expect(page.locator('#av-content')).not.toContainText('Other rep reserve only');
  await expect(page.locator('#av-crumb')).toContainText('Current Season (4 items)');
  await expect(page.locator('#av-export-btn-label')).toContainText('(4)');

  const initial = await page.evaluate(() => window.eval(`(() => {
    const started = performance.now();
    const rows = createAvSalesRowsDerivation('current');
    const visible = rows.finalize(rows.sourceRows.map(rows.mapRow).filter(Boolean));
    return { derivationMs: performance.now() - started, count: visible.length, itemcodes: visible.map(row => String(row.ITEMCODE || row.itemcode || '').trim().toUpperCase()),
      exportLabel: document.getElementById('av-export-btn-label')?.textContent || '' };
  })()`));
  expect(initial.count).toBe(4);
  expect(initial.derivationMs).toBeLessThanOrEqual(250);
  expect(initial.itemcodes).toEqual(expect.arrayContaining(['OPEN-1500', 'OWN-200']));
  expect(initial.itemcodes).not.toContain('OTHER-300');

  const press = test.info().project.use.isMobile ? 'tap' : 'click';
  const mobileFilters = page.locator('#view-av summary').filter({ hasText: 'Filters' });
  if (await mobileFilters.isVisible()) await mobileFilters[press]();
  const customerFilter = page.locator('[data-av-filter-shell="customer"] [data-role="button"]');
  await expect(customerFilter).toBeVisible();
  await customerFilter[press]();
  await page.getByRole('button', { name: 'Riley Customer', exact: true })[press]();
  await expect.poll(() => page.evaluate(() => window.eval(`(() => {
    const rows = createAvSalesRowsDerivation('customer-open');
    return rows.finalize(rows.sourceRows.map(rows.mapRow).filter(Boolean)).length;
  })()`))).toBe(3);
  await expect.poll(() => page.locator('#av-export-btn-label').textContent()).toContain('(3)');

  const parity = await page.evaluate(() => window.eval(`(() => {
    const rows = createAvSalesRowsDerivation('customer-open');
    const visible = rows.finalize(rows.sourceRows.map(rows.mapRow).filter(Boolean));
    return { count: visible.length, exportLabel: document.getElementById('av-export-btn-label')?.textContent || '',
      selectedCustomer: selectedAvRepCustomerKey };
  })()`));
  expect(parity.count).toBe(3);
  await expect(page.locator('#av-content').getByRole('heading')).toHaveCount(3);
  await expect(page.locator('#av-export-btn-label')).toContainText('(3)');
  await expect(page.locator('#av-crumb')).toContainText('Customer + Open Stock (3 items)');
  await expect(page.locator('#av-content')).not.toContainText('Own second customer reserve');
  expect(parity.selectedCustomer).toBe('riley customer|||riley customer');
  const metrics = await page.evaluate(async () => {
    const started = performance.now();
    window.eval('renderAV()');
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return { renderMs: performance.now() - started, inventoryRows: window.eval('selectAvSalesInventorySourceRows().length'),
      visibleRows: window.eval('getCurrentAVBaseItems().items.length'), exportCount: window.eval('getAVVisibleExportCount(getCurrentAVBaseItems().items)'),
      cache: 'warm accepted local snapshot; shared OS cache uncontrolled', trace: 'off' };
  });
  expect(metrics.exportCount).toBe(3);
  expect(metrics.visibleRows).toBe(3);
  expect(metrics.renderMs).toBeLessThanOrEqual(1500);
  console.log('AV_VISIBILITY_METRICS', JSON.stringify({ ...metrics, coldFullHydrationMs: hydrationMs, derivationMs: initial.derivationMs, browser: test.info().project.name }));
  expect(fixture.blockedMutations).toEqual([]);
  expect(fixture.errors).toEqual([]);
});
