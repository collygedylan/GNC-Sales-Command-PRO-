import { assertFrontendUiTiming } from './helpers/frontend-ui-timing.mjs';
import { expect, test, type Page, type Route } from '@playwright/test';
import { installHlOrderFixture } from './fixtures/hl-order-state.mjs';

// @test-group: @home-role
test.use({ trace: 'off', screenshot: 'off' });

const columns = Array.from({ length: 171 }, (_, index) => `column_${index}`);
const reportDate = '2026-10-15';
const snapshotId = (sequence: number, dataset: string) => {
  const datasetCode = dataset === 'drive' ? '1' : dataset === 'soc' ? '2' : '3';
  return `71000000-0000-4000-8000-${datasetCode}${String(sequence).padStart(11, '0')}`;
};
const displayLabel = (sequence: number) => `${reportDate} ${String(sequence).padStart(2, '0')}`;

function snapshot(sequence: number, dataset: string) {
  return { snapshotId: snapshotId(sequence, dataset), dataset, displayLabel: displayLabel(sequence), reportDate,
    sequence, rowCount: 12000, columns };
}

function rows(id: string, afterRow: number, generation: number) {
  const items = Array.from({ length: 50 }, (_, index) => {
    const rowNumber = afterRow + index + 1;
    return { rowNumber, values: columns.map((column, columnIndex) => columnIndex === 0
      ? `generation-${generation}-dataset-${id.slice(-12, -11)}-snapshot-${id.slice(-2)}-row-${rowNumber}` : `${column}-${rowNumber}`) };
  });
  return { snapshotId: id, rows: items, hasMore: true, nextRow: items.at(-1)!.rowNumber };
}

async function appEval<T>(page: Page, source: string): Promise<T> {
  return page.evaluate(expression => window.eval(expression) as T, source);
}

async function installImportHistoryApi(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin;
  const calls: Array<{ rpc: string; args: Record<string, unknown> }> = [];
  let rowGeneration = 1;
  let failNextRows = false;
  let holdNextRows = false;
  let heldRowsStarted: (() => void) | null = null;
  let releaseHeldRows: (() => void) | null = null;
  const rowsStarted = () => new Promise<void>(resolve => { heldRowsStarted = resolve; });
  const fulfill = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
      'access-control-allow-headers': route.request().headers()['access-control-request-headers'] || 'authorization, apikey, content-type, x-client-info, prefer, range, accept-profile, content-profile',
      'access-control-allow-credentials': 'true' }, body: JSON.stringify(body) });

  // Historical Report is an existing protected Manager surface. Its initial
  // names query must receive its real empty-array contract so the global data
  // coordinator can reach a ready state before Imported Files is exercised.
  await page.route('**/rest/v1/rpc/search_historical_inventory_common_names', async route => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    const args = route.request().postDataJSON() as Record<string, unknown>;
    if (typeof args.search_text !== 'string' || args.result_limit !== 100) return fulfill(route, { message: 'HISTORICAL_SEARCH_QUERY_INVALID' }, 400);
    return fulfill(route, []);
  });

  await page.route('**/rest/v1/rpc/list_import_history_v1', async route => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    const args = route.request().postDataJSON() as Record<string, unknown>;
    calls.push({ rpc: 'list_import_history_v1', args });
    const dataset = String(args.p_dataset || '');
    const sequenceCursor = Number(args.p_before_sequence || Number.MAX_SAFE_INTEGER);
    const files = Array.from({ length: 51 }, (_, index) => snapshot(51 - index, dataset))
      .filter(file => file.sequence < sequenceCursor);
    const selected = files.slice(0, Number(args.p_limit));
    const last = selected.at(-1);
    const hasMore = files.length > selected.length;
    return fulfill(route, { files: selected, hasMore,
      nextCursor: hasMore && last ? { reportDate: last.reportDate, sequence: last.sequence } : null });
  });

  await page.route('**/rest/v1/rpc/get_import_history_rows_v1', async route => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    const args = route.request().postDataJSON() as Record<string, unknown>;
    calls.push({ rpc: 'get_import_history_rows_v1', args });
    if (holdNextRows) {
      holdNextRows = false;
      heldRowsStarted?.();
      await new Promise<void>(resolve => { releaseHeldRows = resolve; });
    }
    if (failNextRows) {
      failNextRows = false;
      return fulfill(route, { code: 'P0001', message: 'Synthetic import history read failure' }, 503);
    }
    const offset = Number(args.p_after_row || 0);
    return fulfill(route, rows(String(args.p_snapshot_id), offset, rowGeneration));
  });

  return {
    calls,
    setFailNextRows() { failNextRows = true; },
    setHoldNextRows() { holdNextRows = true; return rowsStarted(); },
    releaseRows() { const release = releaseHeldRows; releaseHeldRows = null; if (!release) throw new Error('IMPORT_HISTORY_ROWS_NOT_HELD'); release(); },
    setRowGeneration(value: number) { rowGeneration = value; },
  };
}

async function openImportedFiles(page: Page) {
  await page.locator('#footer-home-btn').click();
  await page.locator('#footer-menu-btn').click();
  await page.locator('#drawer-managers-btn').click();
  await expect(page.locator('#view-managers')).toBeVisible();
  await page.locator('#view-managers .manager-module-card').filter({ hasText: 'Historical Report' }).click();
  await expect(page.locator('#view-managers')).toContainText('Inventory History');
  const importedFilesTab = page.getByRole('button', { name: 'Imported Files', exact: true });
  const viewportWidth = page.viewportSize()?.width || 0;
  if (viewportWidth >= 768 && viewportWidth <= 820) {
    const hitTest = await importedFilesTab.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { hittable: !!hit && element.contains(hit), header: document.querySelector('#view-managers .manager-module-freeze')?.getBoundingClientRect().toJSON(), tab: rect.toJSON() };
    });
    expect(hitTest.hittable, JSON.stringify(hitTest)).toBe(true);
  }
  await importedFilesTab.click();
  await expect(page.locator('[aria-label="Imported files history"]')).toBeVisible();
}

test('Manager Imported Files browses cached immutable snapshots with bounded 50×8 rendering', { tag: ['@home-role'] }, async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('The Imported Files browser fixture requires a base URL.');
  await installHlOrderFixture(page, baseURL, { username: 'dylan_collyge', role: 'ADMIN' });
  const api = await installImportHistoryApi(page, baseURL);
  const heldRowsRequest = api.setHoldNextRows();
  await openImportedFiles(page);

  const history = page.locator('[aria-label="Imported files history"]');
  await heldRowsRequest;
  await expect(history).toContainText('Loading imported rows…');
  const snapshotPicker = history.locator('select').nth(1);
  await expect(snapshotPicker.locator('option').nth(1)).toHaveText(`${displayLabel(51)} · 12,000 rows`);
  const firstSnapshotRequestCount = api.calls.filter(call => call.rpc === 'get_import_history_rows_v1').length;
  await snapshotPicker.selectOption(snapshotId(50, 'drive'));
  await expect.poll(() => api.calls.filter(call => call.rpc === 'get_import_history_rows_v1').length).toBe(firstSnapshotRequestCount + 1);
  await expect(history.locator('tbody tr').first()).toContainText('generation-1-dataset-1-snapshot-50-row-1');
  api.releaseRows();
  await expect(history.locator('tbody tr').first()).toContainText('generation-1-dataset-1-snapshot-50-row-1');
  await expect(history.locator('tbody tr')).toHaveCount(50);
  await expect(history.locator('tbody td')).toHaveCount(400);
  await expect(history).toContainText('Rows 1–50 of 12,000');

  const renderMeasurement = await appEval<{
    coldMs: number; warmMs: number; cells: number; columns: number; rows: number;
    browser: string; viewport: { width: number; height: number } | null;
  }>(page, `(() => {
    const module = managerImportHistoryModule;
    const state = managerImportedHistoryUiState;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px';
    document.body.append(host);
    const measure = () => {
      const started = performance.now();
      host.innerHTML = module.renderImportedFilesPanel({
        dataset:state.dataset,files:state.files,hasMoreFiles:state.hasMoreFiles,hasPreviousFiles:state.hasPreviousFiles,
        filePageNumber:state.filePageNumber,filesLoading:false,filesError:'',selectedSnapshotId:state.selectedSnapshotId,
        selectedSnapshot:state.selectedSnapshot,selectedColumnIndexes:state.selectedColumns,columnSearch:'',columnError:'',
        rows:state.rows,rowsLoading:false,rowsRefreshing:false,rowsError:'',rowCount:state.rowCount,
        pageNumber:state.rowPageNumber,pageCount:240,hasPrevious:false,hasMoreRows:true,
      });
      host.getBoundingClientRect();
      return { ms:performance.now()-started,cells:host.querySelectorAll('tbody td').length };
    };
    const cold = measure(); const warm = measure();
    const result = { coldMs:cold.ms,warmMs:warm.ms,cells:cold.cells,columns:state.selectedSnapshot.columns.length,
      rows:state.rows.length,browser:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight} };
    host.remove(); return result;
  })()`);
  console.log('IMPORTED_HISTORY_RENDER_MEASUREMENT', JSON.stringify({ ...renderMeasurement,
    datasetRows: 12000, pageRows: 50, sourceColumns: 171, renderedColumns: 8,
    cacheConditions: 'Cold component render and immediate warm repeat after one fixture-backed page read.' }));
  expect(renderMeasurement.rows).toBe(50);
  expect(renderMeasurement.columns).toBe(171);
  expect(renderMeasurement.cells).toBe(400);
  assertFrontendUiTiming(expect(renderMeasurement.coldMs), test.info().project);
  assertFrontendUiTiming(expect(renderMeasurement.warmMs), test.info().project);

  const nextRows = history.getByRole('button', { name: 'Next', exact: true });
  await nextRows.click();
  await expect(history.locator('tbody tr').first()).toContainText('generation-1-dataset-1-snapshot-50-row-51');
  await expect(history).toContainText('Rows 51–100 of 12,000');
  await history.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(history.locator('tbody tr').first()).toContainText('generation-1-dataset-1-snapshot-50-row-1');

  api.setRowGeneration(2);
  api.setFailNextRows();
  await appEval(page, 'loadManagerImportedHistoryRows(true)');
  await expect(history.getByRole('alert')).toContainText(/Synthetic import history read failure|Could not load this imported snapshot page/);
  await expect(history.locator('tbody tr')).toHaveCount(50);
  await expect(history.locator('tbody tr').first()).toContainText('generation-1-dataset-1-snapshot-50-row-1');
  await history.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
  await expect(history.locator('tbody tr').first()).toContainText('generation-2-dataset-1-snapshot-50-row-1');

  await history.getByRole('button', { name: 'Older snapshots' }).click();
  await expect.poll(() => api.calls.filter(call => call.rpc === 'list_import_history_v1').length).toBeGreaterThan(1);
  await expect(history.locator('select').nth(1)).toContainText(`${displayLabel(1)} · 12,000 rows`);
  await history.getByRole('button', { name: 'Newer', exact: true }).click();
  await expect(history.locator('select').nth(1).locator('option').nth(1)).toHaveText(`${displayLabel(51)} · 12,000 rows`);

  const sourcePicker = history.locator('select').first();
  const heldSocRowsRequest = api.setHoldNextRows();
  await sourcePicker.selectOption('soc');
  await expect(history.locator('select').nth(1).locator('option').nth(1)).toHaveText(`${displayLabel(51)} · 12,000 rows`);
  await heldSocRowsRequest;
  const socSnapshotRequestCount = api.calls.filter(call => call.rpc === 'get_import_history_rows_v1').length;
  await sourcePicker.selectOption('reserves');
  await expect.poll(() => api.calls.filter(call => call.rpc === 'get_import_history_rows_v1').length).toBe(socSnapshotRequestCount + 1);
  await expect(history.locator('tbody tr').first()).toContainText('generation-2-dataset-3-snapshot-51-row-1');
  api.releaseRows();
  await expect(history.locator('tbody tr').first()).toContainText('generation-2-dataset-3-snapshot-51-row-1');
  await expect(history.locator('tbody tr')).toHaveCount(50);
  expect(api.calls.filter(call => call.rpc === 'list_import_history_v1').map(call => call.args.p_dataset)).toEqual(
    expect.arrayContaining(['drive', 'soc', 'reserves']));

  // A new auth epoch is part of the read identity. It must clear the cached
  // manifest and fetch again while the already-authorized manager remains in view.
  const listCountBeforeScopeChange = api.calls.filter(call => call.rpc === 'list_import_history_v1').length;
  await appEval(page, `productionLiveSyncReadAuthEpoch += 1; getManagerImportedHistoryState(); scheduleManagersRender(true)`);
  await expect(history.locator('select').nth(1)).toContainText('Select snapshot…');
  await appEval(page, 'loadManagerImportedHistoryFiles(true)');
  await expect.poll(() => api.calls.filter(call => call.rpc === 'list_import_history_v1').length).toBeGreaterThan(listCountBeforeScopeChange);
  await expect(history.locator('tbody tr')).toHaveCount(50);

  expect(api.calls.filter(call => call.rpc === 'list_import_history_v1').every(call => call.args.p_limit === 50)).toBe(true);
  expect(api.calls.filter(call => call.rpc === 'get_import_history_rows_v1').every(call => call.args.p_limit === 50)).toBe(true);
});
