import { expect, test } from '@playwright/test';
// @test-group: @production-schedule



test('mobile schedule keeps one search row, honest filters, and each sheet state', {"tag":["@production-schedule"]}, async ({ page }, testInfo) => {
  await page.setContent('<body class="ops-precision-pilot"><main id="view-managers"><div id="manager-production-schedule-root"></div></main></body>');
  await page.addStyleTag({ path: 'styles/production-schedule.css' });
  await page.addScriptTag({ path: 'assets/production-schedule.js' });
  await page.evaluate(() => {
    const win = window as any;
    win.scheduleCalls = [];
    const coldStart = performance.now();
    const coldObserver = new MutationObserver(() => {
      if (!document.querySelector('.ps-card')) return;
      win.scheduleColdRenderMs = performance.now() - coldStart;
      coldObserver.disconnect();
    });
    coldObserver.observe(document.body, { subtree: true, childList: true });
    const sheets = [
      { id: 1, index: 0, title: 'PROD SCHED', rowCount: 1, headerRow: 8,
        columns: [{ index: 39, header: 'NoSale' }, { index: 63, header: 'ITEM NO.' }, { index: 69, header: 'GENUS' }, { index: 71, header: 'VAR' }, { index: 154, header: '2027 SCH TOTAL' }],
        categoryColumn: 69, statusColumn: null,
        filterColumns: [{ index: 39, header: 'NoSale', options: ['N', 'Y'] }, { index: 69, header: 'GENUS', options: ['Rosa'] }] },
      { id: 2, index: 1, title: 'ContTable', rowCount: 1, headerRow: 1,
        columns: [{ index: 2, header: 'Code' }, { index: 3, header: 'Stat' }, { index: 5, header: 'Description' }],
        categoryColumn: 5, statusColumn: 3,
        filterColumns: [{ index: 3, header: 'Stat', options: ['A', 'I'] }] },
      ...['PltDate-PltGrp', 'Code Key', 'Calculations', "New Weighted%'s", 'CPB']
        .map((title, index) => ({ id: index + 3, index: index + 2, title, rowCount: 0, columns: [], filterColumns: [] })),
    ];
    win.GncProductionSchedule.mount(document.getElementById('manager-production-schedule-root'), async (payload: any) => {
      win.scheduleCalls.push(payload);
      if (payload.operation === 'metadata') return { ok: true, snapshot: { id: 'snapshot-1', importedAt: '2026-09-30T23:00:00Z' }, sheets };
      if (payload.operation === 'status') return { ok: true, run: null };
      if (payload.operation === 'row_detail') return { ok: true, snapshotId: payload.snapshotId,
        row: { sourceRow: payload.sourceRow, cells: payload.sheetId === 1
          ? { 39: 'N', 63: '003469.031.1', 69: 'Rosa', 71: 'Sunny Knock Out® Rose', 154: '0' }
          : { 2: 'C030', 3: 'A', 5: '3 gal' } } };
      if (payload.operation === 'rows') {
        const rows = payload.sheetId === 1 ? [{ sourceRow: 9, cells: { 39: 'N', 63: '003469.031.1', 69: 'Rosa', 71: 'Sunny Knock Out® Rose', 154: '0' } }]
          : payload.sheetId === 2 ? [{ sourceRow: 2, cells: { 2: 'C030', 3: 'A', 5: '3 gal' } }] : [];
        return { ok: true, rows: payload.q && !JSON.stringify(rows).toLowerCase().includes(String(payload.q).toLowerCase()) ? [] : rows,
          total: rows.length, nextCursor: null, snapshotId: 'snapshot-1' };
      }
      if (payload.operation === 'refresh') return { ok: true, run: { id: 'run-1', status: 'queued' } };
      throw new Error('Unexpected operation');
    });
  });

  await expect(page.getByRole('tab')).toHaveCount(7);
  await expect(page.locator('.ps-card')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).scheduleCalls.filter((call: any) => call.operation === 'row_detail').length)).toBe(0);
  expect(await page.evaluate(() => (window as any).scheduleCalls.find((call: any) => call.operation === 'rows').projection)).toBe('cards');
  for (const theme of ['light', 'dark']) {
    await page.locator('body').evaluate((body, nextTheme) => body.setAttribute('data-ops-theme', nextTheme), theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    const searchBox = await page.locator('[data-ps-search]').boundingBox();
    const filterButton = await page.locator('[data-ps-action="toggle-filters"]').boundingBox();
    expect(searchBox && filterButton && Math.abs(searchBox.y - filterButton.y) < 8).toBeTruthy();
  }
  await page.getByText('All source fields').click();
  await expect(page.locator('.ps-details dd').filter({ hasText: /^0$/ })).toBeVisible();
  await page.locator('[data-ps-search]').fill('Sunny');
  await expect.poll(() => page.evaluate(() => (window as any).scheduleCalls.some((call: any) => call.operation === 'rows' && call.q === 'Sunny'))).toBeTruthy();
  await page.getByRole('tab', { name: /ContTable/ }).click();
  await page.getByRole('button', { name: 'Filters' }).click();
  await expect(page.getByLabel('Status (Stat)')).toBeVisible();
  await page.getByLabel('Status (Stat)').selectOption('A');
  await page.getByRole('tab', { name: /PROD SCHED/ }).click();
  await expect(page.locator('[data-ps-search]')).toHaveValue('Sunny');
  await expect(page.getByLabel('Status (Stat)')).toHaveCount(0);
  await page.getByRole('button', { name: 'Filters' }).click();
  await expect(page.getByLabel('NoSale')).toBeVisible();
  await page.getByRole('tab', { name: /ContTable/ }).click();
  await expect(page.getByLabel('Status (Stat)')).toHaveValue('A');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  const timings = await page.evaluate(() => {
    const win = window as any;
    const readsBefore = win.scheduleCalls.filter((call: any) => call.operation === 'rows').length;
    const started = performance.now();
    (document.querySelector('[data-ps-tab="1"]') as HTMLButtonElement).click();
    return { coldFixtureRenderMs: win.scheduleColdRenderMs, warmFixtureRenderMs: performance.now() - started,
      warmRowsVisible: document.querySelectorAll('.ps-card').length,
      warmExtraReads: win.scheduleCalls.filter((call: any) => call.operation === 'rows').length - readsBefore };
  });
  expect(timings.warmRowsVisible).toBe(1);
  expect(timings.warmExtraReads).toBe(0);
  await testInfo.attach('synthetic-schedule-cold-warm-ms', { body: JSON.stringify(timings), contentType: 'application/json' });
});
