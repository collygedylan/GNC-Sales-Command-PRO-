import { test, expect } from '@playwright/test';
import { hlMaster, installHlOrderFixture, hlUserId } from './fixtures/hl-order-state.mjs';
import { createV2311CanonicalAccessFixture } from './fixtures/v2311-canonical-access.mjs';

const access = (overrides: Record<string, boolean | null> = {}) => ({
  can_access_drive_mode: false,
  can_access_av: false,
  can_access_que: true,
  can_access_manager_tab: true,
  can_manage_user_access: true,
  can_access_eval_reports_2: false,
  can_submit_reclass: true,
  can_complete_suspend_tag: true,
  can_approve_deny_suspend: false,
  ...overrides,
});

test('v2.3.11 canonical Manager access editor updates a role baseline and a user override @v2311-frontend-smoke', async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('The isolated release artifact baseURL is required.');
  const baselines = [
    { role: 'admin', permissions: access() },
    { role: 'evaluator', permissions: access({ can_manage_user_access: false, can_access_manager_tab: false, can_access_que: false }) },
    { role: 'sales_rep', permissions: access({ can_manage_user_access: false, can_access_manager_tab: false, can_access_que: false, can_access_av: true }) },
  ];
  const users = [
    { id: hlUserId, username: 'dylan_collyge', display_name: 'Dylan College', role: 'admin', active: true,
      baseline: { role: 'admin', permissions: access() }, permission_overrides: access(Object.fromEntries(Object.keys(access()).map(key => [key, null]))) },
    { id: 'bcd56899-e4aa-470d-9016-2d525aaf43a3', username: 'annette_hancock', display_name: 'Annette Hancock', role: 'sales_rep', active: true,
      salesrep_id: 'S05', salesrep_match_names: ['Annette Hancock', 'Hancock, Annette'],
      baseline: { role: 'sales_rep', permissions: baselines[2].permissions },
      permission_overrides: Object.fromEntries(Object.keys(access()).map(key => [key, null])) },
    { id: 'b94e728e-12f3-4b34-8a32-80b09d41df2a', username: 'evaluator_one', display_name: 'Evaluator One', role: 'evaluator', active: true,
      baseline: { role: 'evaluator', permissions: baselines[1].permissions },
      permission_overrides: Object.fromEntries(Object.keys(access()).map(key => [key, null])) },
    { id: 'a9577e7a-8c20-4a6d-9af5-6d3703db1891', username: 'evaluator_two', display_name: 'Evaluator Two', role: 'evaluator', active: true,
      baseline: { role: 'evaluator', permissions: baselines[1].permissions },
      permission_overrides: Object.fromEntries(Object.keys(access()).map(key => [key, null])) },
    { id: '', username: 'legacy_only_user', display_name: 'Legacy Only', role: 'sales_rep', active: false,
      baseline: { role: 'sales_rep', permissions: baselines[2].permissions }, permission_overrides: {} },
  ];
  const accessFixture = createV2311CanonicalAccessFixture({ username: 'dylan_collyge', role: 'admin', revision: 23, roleBaselines: baselines, users });
  const fixture = await installHlOrderFixture(page, baseURL, {
    username: 'dylan_collyge', role: 'ADMIN',
    canonicalAccessFixture: accessFixture,
  });
  await page.evaluate(() => {
    window.eval("switchView('managers'); setHomeTab('access-control')");
  });
  const editor = page.locator('#canonical-user-access-editor');
  await expect(editor.locator('[data-access-status]')).toContainText(/ready|users/i);
  await expect(editor.locator('[data-user-count]')).toHaveText('4');
  await expect(editor.locator('[data-user-select] option')).toContainText(['Annette Hancock', 'Legacy Only']);

  await editor.locator('[data-role-select]').selectOption('evaluator');
  await editor.locator('[data-role-permission="can_access_eval_reports_2"]').check();
  await editor.locator('[data-role-save]').click();
  await expect.poll(() => accessFixture.state.baselines.get('evaluator')?.can_access_eval_reports_2).toBe(true);
  await expect.poll(() => accessFixture.state.users.find(user => user.username === 'evaluator_one')?.baseline.permissions.can_access_eval_reports_2).toBe(true);
  await expect.poll(() => accessFixture.state.users.find(user => user.username === 'evaluator_two')?.baseline.permissions.can_access_eval_reports_2).toBe(true);
  expect(accessFixture.state.users.find(user => user.username === 'annette_hancock')?.baseline.permissions.can_access_eval_reports_2).toBe(false);

  await editor.locator('[data-user-select]').selectOption('annette_hancock');
  await expect(editor.locator('[data-user-permission="can_access_av"]')).toHaveValue('inherit');
  await editor.locator('[data-user-permission="can_access_av"]').selectOption('false');
  await editor.locator('[data-user-save]').click();
  await expect.poll(() => accessFixture.state.users.find(user => user.username === 'annette_hancock')?.permission_overrides.can_access_av).toBe(false);
  await expect.poll(() => accessFixture.state.revision).toBe(25);
  expect(accessFixture.state.calls.map(call => call.operation)).toEqual(['resolve', 'directory', 'save_role_baseline', 'save_user_overrides']);
  expect(accessFixture.state.blocked).toEqual([]);
  expect(fixture.blockedMutations).toEqual([]);
});

test('v2.3.11 Request picker shows and searches all 103 mapped customers for Annette @v2311-frontend-smoke', async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('The isolated release artifact baseURL is required.');
  const mapRows = Array.from({ length: 103 }, (_, index) => ({
    unique_id: `v2311-customer-${index + 1}`,
    salesrepid: 'S05', salesrepname: 'Annette Hancock',
    customeridentityid: String(index + 1).padStart(6, '0'),
    customername: index === 102 ? "V2311 O'Brian & Sons 103" : `V2311 Customer ${String(index + 1).padStart(3, '0')}`,
    customerstatus: 'A', consigneestatus: 'A',
  })).flatMap((row, customerIndex) => Array.from({ length: customerIndex === 0 ? 100 : 1 }, (_, locationIndex) => ({
    ...row,
    unique_id: `${row.unique_id}-${locationIndex + 1}`,
    consigneeid: String(1001 + customerIndex * 100 + locationIndex).padStart(6, '0'),
    consigneename: `V2311 Location ${String(customerIndex + 1).padStart(3, '0')}${locationIndex ? `-${locationIndex + 1}` : ''}`,
  })));
  const customerMapApi = { driftNextRead: false, failNextRead: false };
  const fixture = await installHlOrderFixture(page, baseURL, {
    username: 'dylan_collyge', role: 'ADMIN',
    beforeNavigate: async () => {
      const origin = new URL(baseURL).origin;
      await page.route('**/rest/v1/ph_customer_consignee_sales_reps*', route => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(mapRows),
        headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-expose-headers': 'content-range', 'content-range': `0-${mapRows.length - 1}/${mapRows.length}` },
      }));
      await page.route('**/functions/v1/app-api*', async route => {
        const request = route.request();
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 200, body: '', headers: { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': request.headers()['access-control-request-headers'] || 'authorization, apikey, content-type', 'access-control-allow-credentials': 'true' } });
        const body = request.postDataJSON() || {};
        if (request.method() !== 'POST' || body.action !== 'customer-rep-map' || body.operation !== 'options') return route.fallback();
        if (customerMapApi.failNextRead) {
          customerMapApi.failNextRead = false;
          return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'fixture mapping temporarily unavailable' }), headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' } });
        }
        const pageIndex = Math.max(0, Number(body.page) || 0), pageSize = Math.min(200, Math.max(1, Number(body.pageSize) || 200));
        let revision = 'v2311-customer-map-r1';
        if (customerMapApi.driftNextRead) {
          revision = pageIndex === 0 ? 'v2311-customer-map-r2' : 'v2311-customer-map-r3';
          if (pageIndex > 0) customerMapApi.driftNextRead = false;
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          ok: true, revision, total: mapRows.length,
          rows: mapRows.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize),
        }), headers: { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': request.headers()['access-control-request-headers'] || 'authorization, apikey, content-type', 'access-control-allow-credentials': 'true' } });
      });
    },
  });

  // Start at the real request customer picker and let its normal mapping
  // loader, identity grouping, search, and click handlers populate the UI.
  await page.evaluate(() => window.eval("selectRepForRequest('Annette Hancock', 'S05')"));
  const picker = page.locator('#existing-folder-container');
  await expect(picker.locator('[data-render-key^="request-customer:"]')).toHaveCount(103);
  await expect(picker).toContainText("V2311 O'Brian & Sons 103");
  customerMapApi.failNextRead = true;
  const errorRefreshSucceeded = await page.evaluate(() => window.eval('ensureRequestModalCustomerOptionsReady(true)'));
  expect(errorRefreshSucceeded).toBe(false);
  await expect(picker.locator('[data-render-key^="request-customer:"]')).toHaveCount(103);
  await expect(picker).toContainText("V2311 O'Brian & Sons 103");
  customerMapApi.driftNextRead = true;
  const refreshSucceeded = await page.evaluate(() => window.eval('ensureRequestModalCustomerOptionsReady(true)'));
  expect(refreshSucceeded).toBe(false);
  await expect(picker.locator('[data-render-key^="request-customer:"]')).toHaveCount(103);
  await expect(picker).toContainText('Showing saved customer choices while the current mapping revision is verified.');
  await picker.locator('#existing-request-customer-search-input').fill("O'Brian");
  const customer = picker.locator('[data-render-key^="request-customer:"]');
  await expect(customer).toHaveCount(1);
  await expect(customer.first()).toContainText("V2311 O'Brian & Sons 103");
  await customer.first().click();
  await expect(picker.locator('[data-render-key^="request-consignee:"]')).toHaveCount(1);
  await expect(picker).toContainText('V2311 Location 103');
  expect(fixture.blockedMutations).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test('v2.3.11 Drive Bloom tray preserves all six inventory metrics before and after opening Actions @v2311-frontend-smoke', async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('The isolated release artifact baseURL is required.');
  const itemcode = 'V2311.BLOOM.001';
  const photoUrl = 'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/v2311-bloom/blue-point.svg';
  const master = [
    hlMaster('v2311-bloom-metrics-main', {
      itemcode, commonname: 'V2311 Bloom Metric Plant', contsize: '#3',
      locationcode: 'G.11.000', lotcode: '27.F1', season: 'F1', saleyear: '27',
      ptronhand: '88', ptrreviewed: '10', ptravailable: '78', s_lts: '153',
      loc_match_qty: '', match: '', warehouseid: '10', warehousei: '10',
      photo_link: photoUrl, photo_name: 'Blue Point Juniper',
    }),
    hlMaster('v2311-bloom-metrics-second-location', {
      itemcode, commonname: 'V2311 Bloom Metric Plant', contsize: '#3',
      locationcode: 'G.11.001', lotcode: '27.F1', season: 'F1', saleyear: '27',
      ptronhand: '1', ptrreviewed: '0', ptravailable: '1', s_lts: '153',
      loc_match_qty: '', match: '', warehouseid: '10', warehousei: '10',
      photo_link: photoUrl, photo_name: 'Blue Point Juniper',
    }),
  ];
  const fixture = await installHlOrderFixture(page, baseURL, { username: 'dylan_collyge', role: 'ADMIN', master });
  await page.route('**/storage/v1/object/public/request_photos/v2311-bloom/blue-point.svg', route => route.fulfill({
    status: 200, contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#2d8a54"/></svg>',
  }));
  await page.evaluate(() => window.eval("switchView('drive')"));
  await expect(page.locator('#view-drive')).toBeVisible();
  await page.evaluate(() => window.eval("selectDriveName('V2311 Bloom Metric Plant'); selectDriveSize('#3'); selectDriveSeason('F1')"));
  const card = page.locator('#drive-content article[data-dom-id]').filter({ hasText: 'G.11.000' }).first();
  await expect(card).toBeVisible();
  const expectedLabels = ['On Hand', 'Review', 'Available', 'Open Stock', 'Loc Photo Match', 'Loc On Hand'];
  const readMetrics = async (locator: import('@playwright/test').Locator) => locator.locator('[data-inventory-card-metric]').evaluateAll(nodes => nodes.map(node => ({
    label: node.querySelector('.app-card-qty-label')?.textContent?.trim() || '',
    value: node.querySelector('.app-card-qty-value')?.textContent?.trim() || '',
  })));
  const driveMetrics = await readMetrics(card);
  expect(driveMetrics.map(metric => metric.label)).toEqual(expectedLabels);
  expect(driveMetrics.map(metric => metric.value)).toEqual(['88', '10', '78', '153', 'N/A', '88']);
  const drivePhoto = card.locator('img').first();
  await expect(drivePhoto).toBeVisible();
  await expect.poll(() => drivePhoto.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const driveCellStyles = await card.locator('[data-inventory-card-metric]').evaluateAll(nodes => nodes.map(node => {
    const label = node.querySelector('.app-card-qty-label') as HTMLElement | null;
    const value = node.querySelector('.app-card-qty-value') as HTMLElement | null;
    return [label, value].filter((element): element is HTMLElement => !!element).map(element => ({
      whiteSpace: getComputedStyle(element).whiteSpace,
      textOverflow: getComputedStyle(element).textOverflow,
      height: element.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(element).lineHeight) || 0,
    }));
  }));
  expect(driveCellStyles).toHaveLength(6);
  for (const cell of driveCellStyles.flat()) {
    expect(cell.whiteSpace).toBe('nowrap');
    expect(cell.textOverflow).toBe('ellipsis');
    expect(cell.height).toBeLessThanOrEqual(cell.lineHeight + 1);
  }
  const secondLocation = page.locator('#drive-content article[data-dom-id]').filter({ hasText: 'G.11.001' }).first();
  await expect(secondLocation).toBeVisible();
  expect((await readMetrics(secondLocation)).find(metric => metric.label === 'Loc On Hand')?.value).toBe('1');

  await card.getByRole('button', { name: 'Add To Bloom Picker', exact: true }).click();
  await page.locator('#footer-cart-btn').click();
  const tray = page.locator('#bloom-picker-tray');
  await expect(tray).toBeVisible();
  const trayCard = tray.locator('.bloom-picker-tray-row').first();
  const beforeActions = await readMetrics(trayCard);
  expect(beforeActions.map(metric => metric.label)).toEqual(expectedLabels);
  expect(beforeActions.map(metric => metric.value)).toEqual(driveMetrics.map(metric => metric.value));
  expect(await readMetrics(card)).toEqual(driveMetrics);
  const bloomGridColumns = await trayCard.locator('.app-bloom-card-metrics .app-card-qty-row').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  expect(bloomGridColumns).toBe(6);
  await expect(trayCard.locator('img').first()).toBeVisible();
  await expect.poll(() => trayCard.locator('img').first().evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const bloomCells = await trayCard.locator('.app-bloom-card-metrics [data-inventory-card-metric]').evaluateAll(nodes => nodes.map(node => {
    const label = node.querySelector('.app-card-qty-label') as HTMLElement | null;
    const value = node.querySelector('.app-card-qty-value') as HTMLElement | null;
    return [label, value].filter((element): element is HTMLElement => !!element).map(element => ({
      whiteSpace: getComputedStyle(element).whiteSpace,
      textOverflow: getComputedStyle(element).textOverflow,
      height: element.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(element).lineHeight) || 0,
    }));
  }));
  expect(bloomCells).toHaveLength(6);
  for (const cell of bloomCells.flat()) {
    expect(cell.whiteSpace).toBe('nowrap');
    expect(cell.textOverflow).toBe('ellipsis');
    expect(cell.height).toBeLessThanOrEqual(cell.lineHeight + 1);
  }
  const actions = page.locator('#bloom-picker-actions-toggle');
  await expect(actions).toBeVisible();
  await actions.click();
  await expect(trayCard.locator('.app-bloom-card-metrics [data-inventory-card-metric]')).toHaveCount(6);
  const afterActions = await readMetrics(trayCard);
  expect(afterActions).toEqual(beforeActions);
  expect(await readMetrics(card)).toEqual(driveMetrics);
  expect(fixture.blockedMutations).toEqual([]);
  expect(fixture.errors).toEqual([]);
});
