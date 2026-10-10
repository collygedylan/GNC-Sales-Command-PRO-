import { expect, test } from '@playwright/test';
// @test-group: @release-functional

declare global {
  interface Window {
    historyFixture: {
      calls: Array<{ query: { operation: string; customerKey?: string; consigneeKey?: string }; aborted: boolean }>;
    };
  }
}

test.describe('Historical Requests primary view', { tag: '@release-functional' }, () => {
  test('drills customer to consignee to requests and shows server totals and unresolved prices', async ({ page }) => {
    await page.goto('/tests/fixtures/historical-requests.html?scope=all');
    await page.getByRole('button', { name: 'Open Historical Requests' }).click();
    await expect(page.getByRole('heading', { name: 'Requests by sales rep' })).toBeVisible();
    await expect(page.getByText('$4,375.00')).toBeVisible();
    await page.getByRole('button', { name: /North Nursery/ }).click();
    await expect(page.getByRole('heading', { name: /Consignees/ })).toBeVisible();
    await page.getByRole('button', { name: /East Yard/ }).click();
    await expect(page.getByText('Unresolved value: Current master list price is unavailable or invalid.')).toBeVisible();
    await expect(page.getByText('$3,500.00')).toBeVisible();
    const queried = await page.evaluate(() => window.historyFixture.calls.map((call: { query: { operation: string; customerKey?: string; consigneeKey?: string } }) => call.query));
    expect(queried.some(query => query.operation === 'consignees' && query.customerKey === 'customer:001')).toBe(true);
    expect(queried.some(query => query.operation === 'requests' && query.customerKey === 'customer:001' && query.consigneeKey === 'consignee:east')).toBe(true);
  });

  test('keeps rep scope out of the dashboard and fits light/dark mobile and tablet layouts', async ({ page }) => {
    await page.goto('/tests/fixtures/historical-requests.html?scope=own');
    await page.getByRole('button', { name: 'Open Historical Requests' }).click();
    await expect(page.getByRole('button', { name: /North Nursery/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Requests by sales rep' })).toHaveCount(0);
    for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }]) {
      await page.setViewportSize(viewport);
      for (const theme of ['light', 'dark']) {
        await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
        const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
        expect(overflow, `${theme} layout at ${viewport.width}px`).toBeLessThanOrEqual(1);
      }
    }
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
    await page.goto('/tests/fixtures/historical-requests.html?scope=own');
    await page.getByRole('button', { name: 'Open Historical Requests' }).click();
    await expect(page.getByRole('alert')).toContainText('Historical Requests could not load');
    await page.getByRole('button', { name: 'Retry loading history' }).click();
    await expect(page.getByRole('heading', { name: 'Historical Requests' })).toBeVisible();
  });
});
