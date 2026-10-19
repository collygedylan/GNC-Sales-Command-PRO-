// @test-group: @v2311-frontend-smoke
import { test, expect } from '@playwright/test';
import { reclassHoldStopFixture } from './helpers/reclass-pdf-fixture.mjs';

test('Inquiry report keeps H/S, Priority and dates compact with connected Item Spec borders @v2311-frontend-smoke', { tag: '@v2311-frontend-smoke' }, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 990, height: 760 });
  await page.setContent(reclassHoldStopFixture().html);
  const row = page.locator('[data-location-row]');
  const headings = await page.locator('.column-heading-row th').allTextContents();
  const cell = (label: string) => row.locator('td').nth(headings.indexOf(label));
  await expect(cell('H/S')).toHaveText('S');
  await expect(cell('Priority')).toHaveText('1');
  await expect(cell('Source')).toHaveText('Shipping');
  await expect(cell('Loc Note Date')).toHaveText('10/19/2026');
  await expect(page.locator('.report-audit')).toContainText('By MK | Eval 10/19/2026');
  const geometry = await page.locator('.location-table th, .location-table td').evaluateAll(cells => cells.map(cell => ({
    text: cell.textContent, width: cell.clientWidth, scroll: cell.scrollWidth,
    nowrap: getComputedStyle(cell).whiteSpace, height: cell.getBoundingClientRect().height,
  })));
  for (const cell of geometry) expect(cell.scroll, `${cell.text} does not clip`).toBeLessThanOrEqual(cell.width + 1);
  expect(geometry.filter(cell => cell.nowrap === 'nowrap').length).toBeGreaterThan(20);
  expect(await row.evaluate(el => el.getBoundingClientRect().height)).toBeLessThan(65);
  const itemSpec = page.locator('.identity-cell').filter({ has: page.locator('span', { hasText: /^Item Spec$/ }) });
  await expect(itemSpec).toContainText('34" H');
  expect(await itemSpec.evaluate(el => getComputedStyle(el).borderBottomWidth)).toBe('1px');
  await page.screenshot({ path: testInfo.outputPath('inquiry-stop-report.png'), fullPage: true });
});
