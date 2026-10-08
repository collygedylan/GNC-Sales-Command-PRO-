import { hlMaster, installHlOrderFixture } from '../tests/fixtures/hl-order-state.mjs';

export const inventoryRows = Array.from({ length: 1000 }, (_, index) => hlMaster(`perf-${String(index).padStart(5, '0')}`, {
  itemcode: `00${Math.floor(index / 4)}`, commonname: `Performance plant ${String(Math.floor(index / 4)).padStart(3, '0')}`,
  locationcode: `C.06.${String(index % 22).padStart(3, '0')}`, ptravailable: '25', ptronhand: '40', priority: '1'
}));
const queueRows = inventoryRows.slice(0, 200).map(row => ({ ...row, unique_id: `request-${row.unique_id}`,
  req_status: 'Pending', req_archived: false, req_qty: '5', req_match: '100', request_folder: 'performance-folder',
  req_customer: 'Synthetic Customer', salesrepname: 'Fixture Rep', requested_by: 'performance_admin' }));

export async function installPerformanceFixture(page, origin, app) {
  if (app === 'live') {
    return installHlOrderFixture(page, origin, { username: 'performance_admin', role: 'ADMIN', master: inventoryRows,
      startupMode: 'cold', beforeLogin: async () => page.locator('#login-button').waitFor({ state: 'visible' }),
      beforeNavigate: async () => {
        await page.route('**/functions/v1/app-api', async route => {
          const body = route.request().postDataJSON();
          if (body?.action !== 'dataset_read' || body.dataset !== 'request_queue') return route.fallback();
          const { limit, offset } = body.params;
          const rows = queueRows.slice(offset, offset + limit);
          return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': origin },
            body: JSON.stringify({ ok: true, data: { rows, total: queueRows.length, offset, limit, hasMore: offset + rows.length < queueRows.length } }) });
        });
      } });
  }
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith('/runtime-config.json')) return route.fulfill({ json: {
      environment: 'sandbox', testData: true, projectRef: 'performance', productionProjectRef: 'production-blocked',
      supabaseUrl: 'https://performance.supabase.co', publishableKey: 'sb_publishable_synthetic_fixture' } });
    if (url.hostname === 'performance.supabase.co' && url.pathname === '/rest/v1/ph_master_inventory') {
      const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 100);
      const selected = (url.searchParams.get('select') || '').split(',');
      if (!selected.length || selected.includes('*') || limit > 250) throw new Error('PERFORMANCE_V2_PROJECTION_INVALID');
      const rows = inventoryRows.slice(offset, offset + limit).map(row => Object.fromEntries(selected.map(key => [key, row[key]])));
      return route.fulfill({ json: rows, headers: { 'access-control-allow-origin': origin, 'access-control-expose-headers': 'content-range',
        'content-range': `${offset}-${offset + rows.length - 1}/${inventoryRows.length}` } });
    }
    if (url.origin === origin) return route.continue();
    return route.abort('blockedbyclient');
  });
  await page.goto('/v2/#home');
  await page.locator('.home-dashboard').waitFor();
}

export async function openPerformanceView(page, app, view) {
  if (app === 'v2') {
    await page.evaluate(next => { location.hash = next; }, view);
    await waitForPerformanceVisibleElement(page, view === 'drive' ? '.drive-item-card' : '.request-card, .request-list > article, .request-list > button');
    return;
  }
  await page.locator(view === 'drive' ? '#footer-drive-btn' : '#footer-request-btn').click();
  await page.locator(`#view-${view}`).waitFor({ state: 'visible' });
  await page.waitForFunction(viewId => window.eval(`productionLiveSyncVerifiedView === productionVerifiedViewKey()
    && getCurrentVisibleViewId() === ${JSON.stringify(viewId)}`), view);
  const content = page.locator(view === 'drive' ? '#drive-content' : '#request-content');
  await content.waitFor({ state: 'visible' });
  await page.waitForFunction(selector => {
    const node = document.querySelector(selector);
    return node && !node.querySelector('.skeleton') && node.textContent.includes('Performance plant');
  }, view === 'drive' ? '#drive-content' : '#request-content');
}

export async function waitForPerformanceVisibleElement(page, selector) {
  const handle = await page.waitForFunction(value => {
    const element = document.querySelector(value);
    if (!element || element.getClientRects().length === 0) return false;
    const visibility = getComputedStyle(element).visibility;
    if (visibility === 'hidden' || visibility === 'collapse') return false;
    const { width, height } = element.getBoundingClientRect();
    return width > 0 && height > 0 ? { width, height } : false;
  }, selector, { polling: 'raf' });
  try { return await handle.jsonValue(); }
  finally { await handle.dispose(); }
}

export async function returnPerformanceHome(page, app) {
  if (app === 'v2') {
    await page.evaluate(() => { location.hash = 'home'; });
    await waitForPerformanceVisibleElement(page, '.home-dashboard');
  } else {
    await page.locator('#global-header-inline-back').click();
    await page.locator('#view-home').waitFor({ state: 'visible' });
  }
}
