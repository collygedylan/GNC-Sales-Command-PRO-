import { assertFrontendUiTiming } from './helpers/frontend-ui-timing.mjs';
import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
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

test('schedule paged cold render and warm metadata refresh stay below 100 ms at 10,000-row metadata scale', {"tag":["@production-schedule"]}, async ({ page }, testInfo) => {
  await page.setContent('<body class="ops-precision-pilot"><main id="view-managers"><div id="manager-production-schedule-root"></div></main></body>');
  await page.addStyleTag({ path: 'styles/production-schedule.css' });
  await page.addScriptTag({ path: 'assets/stable-view-dom.js' });
  await page.addScriptTag({ path: 'assets/production-schedule.js' });
  const cold = await page.evaluate(async () => {
    const win = window as any;
    const nativeApply = win.AgMetricStableViewDom.apply;
    win.scheduleApplyTimings = [];
    Object.defineProperty(win, 'AgMetricStableViewDom', { configurable: true, value: Object.freeze({ apply(container: Element, incoming: DocumentFragment) {
      const hasScheduleCards = Boolean(incoming.querySelector('.ps-card'));
      const started = performance.now();
      const result = nativeApply(container, incoming);
      if (hasScheduleCards) win.scheduleApplyTimings.push(performance.now() - started);
      return result;
    } }) });
    const rows = Array.from({ length: 20 }, (_, index) => ({
      sourceRow: index + 10,
      cells: { 1: '3gal', 2: 'Rosa', 3: `ITEM-${String(index).padStart(4, '0')}`, 4: 'A1', 5: 'LOT-1',
        6: '12', 7: '24' },
      fieldCount: 7
    }));
    win.scheduleCalls = [];
    win.scheduleRows = rows;
    win.scheduleColdStartedAt = performance.now();
    win.scheduleColdPaint = new Promise<any>(resolve => {
      const observer = new MutationObserver(() => {
        if (document.querySelectorAll('.ps-card').length !== 20) return;
        observer.disconnect();
        const domMountedAt = performance.now();
        requestAnimationFrame(() => {
          const firstFrameAt = performance.now();
          requestAnimationFrame(() => resolve({
            mountToDomMs: domMountedAt - win.scheduleColdStartedAt,
            mountToFirstFrameMs: firstFrameAt - win.scheduleColdStartedAt,
            mountToPaintMs: performance.now() - win.scheduleColdStartedAt
          }));
        });
      });
      observer.observe(document.getElementById('manager-production-schedule-root')!, { subtree: true, childList: true });
    });
    win.GncProductionSchedule.mount(document.getElementById('manager-production-schedule-root'), async (payload: any) => {
      win.scheduleCalls.push(payload);
      if (payload.operation === 'metadata') return { ok: true,
        snapshot: { id: 'perf-snapshot-10k', importedAt: '2026-10-15T12:00:00Z' },
        sheets: [{ id: 1, index: 0, title: 'PROD SCHED', rowCount: 10000,
          columns: [{ index: 1, header: 'VAR' }, { index: 2, header: 'GENUS' }, { index: 3, header: 'ITEM NO.' },
            { index: 4, header: 'Plt.Loc.' }, { index: 5, header: 'LOT' }, { index: 6, header: '2027 SCH TOTAL' }, { index: 7, header: '2027 Bed Space' }],
          filterColumns: [] }] };
      if (payload.operation === 'status') return { ok: true, run: null };
      if (payload.operation === 'rows') return { ok: true, rows: payload.cursor ? rows.map((row: any) => ({ ...row, sourceRow: row.sourceRow + 20, cells: { ...row.cells, 3: `NEXT-${row.cells[3]}` } })) : rows,
        total: 10000, nextCursor: payload.cursor ? '40' : '20', snapshotId: 'perf-snapshot-10k', hasMore: true };
      throw new Error(`Unexpected schedule performance operation: ${payload.operation}`);
    }, 'schedule-perf-dylan-session');
    const paint = await win.scheduleColdPaint;
    return { ...paint, applyMs: win.scheduleApplyTimings[0], calls: win.scheduleCalls.length,
      rowCount: document.querySelectorAll('.ps-card').length, metadataRowCount: 10000 };
  });

  // Measure the browser frame before Playwright locator assertions run, so
  // test-runner polling cannot occupy the application's first-paint window.
  const environment = { browser: testInfo.project.use.browserName || 'Chromium', project: testInfo.project.name,
    viewport: page.viewportSize(), api: 'isolated mock', cache: 'cold initial 20-row page against 10,000-row metadata' };
  const coldEvidencePath = testInfo.outputPath('schedule-20-row-cold-performance.json');
  await writeFile(coldEvidencePath, JSON.stringify({ environment, cold }, null, 2));
  console.log('[production-schedule-cold-perf]', JSON.stringify({ environment, cold }));
  await testInfo.attach('schedule-20-row-cold-performance', { path: coldEvidencePath, contentType: 'application/json' });
  await expect(page.locator('.ps-card')).toHaveCount(20);
  expect(cold.rowCount).toBe(20);
  expect(await page.evaluate(() => (window as any).scheduleCalls.find((call: any) => call.operation === 'rows')?.limit)).toBe(20);
  expect(cold.metadataRowCount).toBe(10000);
  assertFrontendUiTiming(expect(cold.mountToPaintMs), test.info().project);
  assertFrontendUiTiming(expect(cold.applyMs), test.info().project);

  const warmIdentity = await page.evaluate(() => {
    const win = window as any;
    win.scheduleOriginalCard = document.querySelector('.ps-card');
    win.scheduleOriginalSearch = document.querySelector('[data-ps-search]');
    const rect = (element: Element) => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height }; };
    win.scheduleOriginalCardRect = rect(win.scheduleOriginalCard as Element);
    win.scheduleOriginalResultsRect = rect(document.querySelector('.ps-results') as Element);
    return {
      cardRect: win.scheduleOriginalCardRect,
      resultsRect: win.scheduleOriginalResultsRect,
      previousTimings: win.scheduleApplyTimings.length,
      rowsReads: win.scheduleCalls.filter((call: any) => call.operation === 'rows').length,
      metadataReads: win.scheduleCalls.filter((call: any) => call.operation === 'metadata').length
    };
  });
  const warm = await page.evaluate(async (baseline) => {
    const win = window as any;
    const startedAt = performance.now();
    win.GncProductionSchedule.refresh();
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const rect = (element: Element) => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height }; };
    const cardAfter = document.querySelector('.ps-card');
    const resultsAfter = document.querySelector('.ps-results');
    return { refreshToPaintMs: performance.now() - startedAt,
      applyMs: win.scheduleApplyTimings.slice(baseline.previousTimings),
      sameCard: cardAfter === win.scheduleOriginalCard,
      sameSearch: document.querySelector('[data-ps-search]') === win.scheduleOriginalSearch,
      noLayoutShift: JSON.stringify(rect(cardAfter!)) === JSON.stringify(baseline.cardRect)
        && JSON.stringify(rect(resultsAfter!)) === JSON.stringify(baseline.resultsRect),
      rowCount: document.querySelectorAll('.ps-card').length,
      extraRowReads: win.scheduleCalls.filter((call: any) => call.operation === 'rows').length - baseline.rowsReads,
      cache: 'warm 20-row page; metadata refresh; no row refetch' };
  }, warmIdentity);
  const completeEvidencePath = testInfo.outputPath('schedule-20-row-performance.json');
  const completeEvidence = { environment: { ...environment, cache: 'cold initial 20-row page, then warm metadata-only refresh; cursor paging reaches later rows' }, cold, warm };
  await writeFile(completeEvidencePath, JSON.stringify(completeEvidence, null, 2));
  console.log('[production-schedule-full-perf]', JSON.stringify(completeEvidence));
  await testInfo.attach('schedule-20-row-performance', { path: completeEvidencePath, contentType: 'application/json' });
  assertFrontendUiTiming(expect(warm.refreshToPaintMs), test.info().project);
  expect(warm.applyMs.length).toBeGreaterThan(0);
  for (const applyMs of warm.applyMs) assertFrontendUiTiming(expect(applyMs), test.info().project);
  expect(warm.sameCard).toBeTruthy();
  expect(warm.sameSearch).toBeTruthy();
  expect(warm.noLayoutShift).toBeTruthy();
  expect(warm.rowCount).toBe(20);
  expect(warm.extraRowReads).toBe(0);
  await page.locator('[data-ps-action="next"]').click();
  await expect(page.locator('.ps-card')).toHaveCount(20);
  await expect(page.locator('.ps-card').first()).toContainText('NEXT-');
  expect(await page.evaluate(() => (window as any).scheduleCalls.filter((call: any) => call.operation === 'rows').length)).toBe(2);
});
