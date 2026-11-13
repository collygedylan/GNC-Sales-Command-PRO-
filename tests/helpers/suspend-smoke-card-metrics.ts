import { expect, type Page, type TestInfo } from '@playwright/test';

type FixtureRow = Record<string, string | number>;
function fixtureCard(page: Page, row: FixtureRow) {
  return page.locator(`#request-content [data-request-uid="dock_suspend_dc_${row.UNIQUE_ID}"]`);
}
type SuspendSmokeInfo = TestInfo;

export async function assertCapturedSuspendMetrics(rows: FixtureRow[], page: Page) {
  const littleLime = rows.filter(row => row.SUSPEND === 'SUSPEND' && row.ITEMCODE === '009373.031.1' && row.LOCATIONCODE === 'F.14.000' && row.LOTCODE === '27.F1');
  expect(littleLime.length).toBeGreaterThan(0);
  for (const row of littleLime) {
    const card = fixtureCard(page, row);
    await expect(card.locator('[data-inventory-card-metric="on-hand"]')).toContainText('90');
    await expect(card.locator('[data-inventory-card-metric="review"]')).toContainText('25');
    await expect(card.locator('[data-inventory-card-metric="available"]')).toContainText('65');
    await expect(card.locator('[data-inventory-card-metric="open-stock"]')).toContainText('57');
    // The captured master records 59 for this physical F1 row (90 On Hand × 65% match).
    // The location total sums 90 F1 + 59 S1 + 79 U1 + 26 X.
    await expect(card.locator('[data-inventory-card-metric="loc-photo-match"]')).toContainText('59');
    await expect(card.locator('[data-inventory-card-metric="loc-on-hand"]')).toContainText('254');
    await expect(card).toContainText('PRI 10');
    await expect(card).toContainText('light roots; thin body');
  }
  const liriope = rows.filter(row => row.SUSPEND === 'SUSPEND' && row.ITEMCODE === '004380.010.1' && row.LOCATIONCODE === 'C.09.000' && row.LOTCODE === '27.F1');
  expect(liriope.length).toBeGreaterThan(1);
  for (const row of liriope) {
    const card = fixtureCard(page, row);
    await expect(card.locator('[data-inventory-card-metric="on-hand"]')).toContainText('1542');
    await expect(card.locator('[data-inventory-card-metric="review"]')).toContainText('675');
    await expect(card.locator('[data-inventory-card-metric="available"]')).toContainText('867');
    await expect(card.locator('[data-inventory-card-metric="open-stock"]')).toContainText('1090');
    // The live master has no photo-rule timestamp for this row. Preserve
    // Drive's unverified result; an inventory update is not photo evidence.
    await expect(card.locator('[data-inventory-card-metric="loc-photo-match"]')).toContainText('N/A');
    await expect(card.locator('[data-inventory-card-metric="loc-on-hand"]')).toContainText(/23,?655/);
  }
}

export async function assertLastSuspendCard(lastVisibleRow: FixtureRow | undefined, page: Page, info: SuspendSmokeInfo) {
  expect(lastVisibleRow, 'the ordered last card must map to a captured source row').toBeDefined();
  if (lastVisibleRow) {
    const lastCard = fixtureCard(page, lastVisibleRow);
    await lastCard.scrollIntoViewIfNeeded();
    await expect(lastCard).toBeVisible();
    await expect(lastCard.getByRole('button', { name: 'Complete Tag', exact: true })).toBeVisible();
    const finalCardLayout = {
      ...await lastCard.evaluate(card => {
      const metrics = [...card.querySelectorAll<HTMLElement>('[data-inventory-card-metric]')];
      const rect = card.getBoundingClientRect();
      return {
        cardOverflow: card.scrollWidth > card.clientWidth + 1,
        inViewport: rect.bottom > 0 && rect.top < window.innerHeight,
        metrics: metrics.map(metric => {
          const label = metric.querySelector<HTMLElement>('.app-card-qty-label');
          const value = metric.querySelector<HTMLElement>('.app-card-qty-value');
          return {
            id: metric.dataset.inventoryCardMetric,
            label: label?.textContent?.trim() || '',
            value: value?.textContent?.trim() || '',
            labelSingleLine: !!label && getComputedStyle(label).whiteSpace === 'nowrap'
              && label.scrollHeight <= label.clientHeight + 1,
            valueSingleLine: !!value && getComputedStyle(value).whiteSpace === 'nowrap'
              && value.scrollHeight <= value.clientHeight + 1,
          };
        }),
      };
      }),
      completeTagVisible: await lastCard.getByRole('button', { name: 'Complete Tag', exact: true }).isVisible(),
    };
    await info.attach('release-smoke-last-card-layout', {
      body: Buffer.from(JSON.stringify(finalCardLayout)), contentType: 'application/json',
    });
    expect(finalCardLayout.inViewport).toBe(true);
    expect(finalCardLayout.cardOverflow).toBe(false);
    expect(finalCardLayout.completeTagVisible).toBe(true);
    expect(finalCardLayout.metrics.map(metric => metric.id)).toEqual(expect.arrayContaining([
      'on-hand', 'review', 'available', 'open-stock', 'loc-photo-match', 'loc-on-hand',
    ]));
    expect(finalCardLayout.metrics.every(metric => metric.label && metric.value && metric.labelSingleLine && metric.valueSingleLine)).toBe(true);
  }
}

export async function assertSuspendSharedTotals(page: Page) {
  const sharedTotals = await page.evaluate(() => window.eval(`({
    littleLime: getCardLocationOnHandValue(fullInventory.find(row => row.ITEMCODE === '009373.031.1' && row.LOCATIONCODE === 'F.14.000' && row.LOTCODE === '27.F1')),
    liriope: getCardLocationOnHandValue(fullInventory.find(row => row.ITEMCODE === '004380.010.1' && row.LOCATIONCODE === 'C.09.000' && row.LOTCODE === '27.F1'))
  })`));
  expect(String(sharedTotals.littleLime).replaceAll(',', '')).toBe('254');
  expect(String(sharedTotals.liriope).replaceAll(',', '')).toBe('23655');
  const driveSummary = await page.evaluate(() => window.eval(`collectDashboardSyncSource([
    {LAST_UPDATED:'2026-10-20T02:24:45.602Z',FILENAME:'DriveAroundMC-10-10320620261019103206.xlsx'},
    {LAST_UPDATED:'2026-10-20T02:24:45.602Z',FILENAME:'DriveAroundMC-10-16251320260916042513.xlsx'}
  ],'Drive')`));
  expect(driveSummary.files).toEqual(['DriveAroundMC-10-10320620261019103206.xlsx']);
}
