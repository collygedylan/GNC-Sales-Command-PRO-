import { expect, test } from '@playwright/test';
// @test-group: @release-functional
declare global {
  interface Window {
    historyFixture: {
      calls: Array<{ query: { operation: string; customerKey?: string; consigneeKey?: string; repKey?: string; recordKind?: string; dateFrom?: string; dateTo?: string }; aborted: boolean }>;
    };
  }
}
const repKey = 'rep:50000000-0000-4000-8000-000000000001';
async function openHistory(page: import('@playwright/test').Page, scope: string) {
  await page.goto('/tests/fixtures/historical-requests.html?scope=' + scope);
  await page.getByRole('button', { name: 'Open Historical Requests' }).click();
}
const browse = (page: import('@playwright/test').Page) => page.locator('section[aria-labelledby="historical-browse-title"]');
test.describe('Historical Requests primary view', { tag: '@release-functional' }, () => {
  test('drills rep to paired customer and consignee to requests with totals and unresolved prices', async ({ page }) => {
    await openHistory(page, 'all');
    await expect(page.getByRole('heading', { name: 'Sales Reps', exact: true })).toBeVisible();
    await expect(page.getByText('$4,375.00', { exact: true })).toBeVisible();
    await browse(page).getByRole('button', { name: /Molly Dixon/ }).click();
    await expect(page.getByRole('heading', { name: 'Customers', exact: true })).toBeVisible();
    await browse(page).getByRole('button', { name: /North Nursery/ }).click();
    await expect(page.getByText('Unresolved value: The active catalog has no usable base list price for this item code.')).toBeVisible();
    await expect(browse(page).getByText('$3,500.00', { exact: false })).toBeVisible();
    await expect(page.getByText('8 feet', { exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Request photo 1' })).toBeVisible();
    await page.getByRole('img', { name: 'Request photo 1' }).scrollIntoViewIfNeeded();
    await expect.poll(() => page.getByRole('img', { name: 'Request photo 1' }).evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const queried = await page.evaluate(() => window.historyFixture.calls.map(call => call.query));
    expect(queried.some(query => query.operation === 'folders' && query.repKey === repKey)).toBe(true);
    expect(queried.some(query => query.operation === 'requests' && query.customerKey === 'customer:001' && query.consigneeKey === 'consignee:east' && query.repKey === repKey)).toBe(true);
  });
  test('keeps rep scope out of financial reports and fits light/dark mobile and tablet layouts', async ({ page }) => {
    await openHistory(page, 'own');
    await expect(browse(page).getByRole('button', { name: /North Nursery/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sales Reps', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Executive reporting' })).toHaveCount(0);
    await expect(page.locator('.historical-requests')).not.toContainText('$');
    await browse(page).getByRole('button', { name: /North Nursery/ }).click();
    await expect(page.getByText('Qty 0', { exact: false })).toBeVisible();
    await expect(page.getByText('Sent', { exact: true }).first()).toBeVisible();
    await expect(page.locator('.historical-requests')).not.toContainText('$');
    for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }]) {
      await page.setViewportSize(viewport);
      for (const theme of ['light', 'dark']) {
        await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
        const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
        expect(overflow, theme + ' layout at ' + viewport.width + 'px').toBeLessThanOrEqual(1);
      }
    }
  });
  test('slices reports by month, rep and customer and groups monthly totals', async ({ page }) => {
    await openHistory(page, 'all');
    await page.getByRole('combobox', { name: 'Period', exact: true }).selectOption('month');
    await page.getByLabel('Month', { exact: true }).fill('2026-10');
    await page.getByRole('combobox', { name: 'Reporting rep', exact: true }).selectOption(repKey);
    await page.getByRole('combobox', { name: 'Reporting customer', exact: true }).selectOption('customer:001');
    await page.getByRole('combobox', { name: 'Group totals', exact: true }).selectOption('months');
    await expect(page.getByRole('table')).toContainText('October 2026');
    const queried = await page.evaluate(() => window.historyFixture.calls.map(call => call.query));
    expect(queried.some(query => query.operation === 'months' && query.dateFrom === '2026-10-01' && query.dateTo === '2026-10-31' && query.repKey === repKey && query.customerKey === 'customer:001')).toBe(true);
    await page.getByRole('combobox', { name: 'Period', exact: true }).selectOption('range');
    await page.getByLabel('From date').fill('2026-11-02');
    await page.getByLabel('Through date').fill('2026-11-01');
    await expect(page.getByRole('alert')).toContainText('through date must be on or after');
    await expect(page.getByRole('table')).toHaveCount(0);
  });
  test('Orders preserves zero and blank dock values in individual records', async ({ page }) => {
    await openHistory(page, 'own');
    await expect(browse(page).getByRole('button', { name: /North Nursery/ })).toBeVisible();
    await page.getByRole('button', { name: 'Orders', exact: true }).click();
    await browse(page).getByRole('button', { name: /North Nursery/ }).click();
    await expect(page.getByText(/Dock 0/)).toBeVisible();
    await expect(page.getByText('Dock (blank value)', { exact: false })).toBeVisible();
    expect(await page.evaluate(() => window.historyFixture.calls.some(call => call.query.operation === 'requests' && call.query.recordKind === 'orders'))).toBe(true);
  });
  test('recovers from a failed lazy chunk with a bounded retry URL', async ({ page }) => {
    let failed = false;
    await page.route('**/historical-requests-chunks/HistoricalRequestsView-*.js*', async route => {
      if (!failed && !new URL(route.request().url()).searchParams.has('retry')) {
        failed = true;
        await route.abort();
        return;
      }
      await route.continue();
    });
    await openHistory(page, 'own');
    await expect(page.getByRole('alert')).toContainText('Historical Requests could not load');
    await page.getByRole('button', { name: 'Retry loading history' }).click();
    await expect(page.getByRole('heading', { name: 'Request History', exact: true })).toBeVisible();
  });
});
