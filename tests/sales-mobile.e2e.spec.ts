import { expect, test, type Locator, type Page } from '@playwright/test';
import { folderName, installSalesMobileFixture } from './fixtures/sales-mobile-fixture';

const photo = (name: string) => ({ name, mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1QAAAAASUVORK5CYII=', 'base64') });

async function openSales(page: Page, label: string, view: string) {
  await page.locator('#footer-home-btn')[test.info().project.use.isMobile ? 'tap' : 'click']();
  await page.locator('#home-tile-sales')[test.info().project.use.isMobile ? 'tap' : 'click']();
  await page.locator('#sales-hub-grid').getByRole('button', { name: label, exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  const area = page.locator(`#${view}-content`);
  await expect(area.getByRole('heading', { name: label, level: 1, exact: true })).toBeVisible();
  await expect(area.getByText('Saving or loading…', { exact: true })).toHaveCount(0);
  return area;
}

async function expectPhoneLayout(page: Page, area: Locator) {
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => {
      document.body.classList.add('ops-precision-pilot');
      document.body.dataset.opsTheme = value;
    }, theme);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    const bounds = await area.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(-1);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    // Theme changes and premium decoration settle asynchronously. Keep the
    // minimum hit-target assertion strict, but measure the settled render.
    await expect.poll(() => area.locator('button:visible,label.sw-button:visible,input[type=search]:visible').evaluateAll(nodes =>
      nodes.filter(node => node.getBoundingClientRect().height < 43.5).map(node => ({
        label: node.textContent?.trim(), height: node.getBoundingClientRect().height,
        minHeight: getComputedStyle(node).minHeight, transform: getComputedStyle(node).transform,
        transition: getComputedStyle(node).transition, className: node.className,
      }))), { message: `Sales controls must retain 44px hit targets in ${theme} theme` }).toEqual([]);
  }
  const footer = page.locator('#bottom-nav > .footer-nav-btn:visible');
  expect(await footer.count()).toBe(8);
  expect(await footer.evaluateAll(nodes => nodes.map(node => ({ id: node.id, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })).filter(box => box.width < 43.5 || box.height < 43.5))).toEqual([]);
  if (page.viewportSize()!.width < 360) {
    expect(await footer.evaluateAll(nodes => new Set(nodes.map(node => Math.round(node.getBoundingClientRect().top))).size)).toBe(2);
  }
}

function expectIsolated(fixture: Awaited<ReturnType<typeof installSalesMobileFixture>>) {
  expect(fixture.native.runtime).toBeGreaterThan(0);
  expect(fixture.native.errors).toEqual([]);
  expect(fixture.native.blockedMutations).toEqual([]);
  expect(fixture.contractErrors).toEqual([]);
}

test('history searches the complete permitted result set, pages newest first, and preserves detail Back', async ({ page, baseURL }) => {
  const f = await installSalesMobileFixture(page, baseURL!);
  const area = await openSales(page, 'Request History', 'request-history');
  await expect(area.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const cards = area.locator('button.sw-card');
  await expect(cards).toHaveCount(50);
  await expect(cards.first()).toContainText('Pending Magnolia');
  await expect(cards.nth(1)).toContainText('2026-09-20T12:00:00.000Z');
  await expect(area.locator('.sw-history-card').filter({ hasText: 'Cedar 01' }).getByRole('button', { name: 'Request Credit', exact: true })).toHaveCount(0);
  await area.getByRole('button', { name: 'Load more', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect(cards).toHaveCount(64);
  await expect(cards.last()).toContainText('Rare Orchid');
  await expect(area.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0);
  const search = area.getByLabel('Search customer, consignee, item, common name, or folder', { exact: true });
  await search.fill('  ORCHID  ');
  await expect(cards).toHaveCount(1);
  expect(f.commands.some(call => call.action === 'request_history' && call.operation === 'search' && call.payload.query === '  ORCHID  ')).toBe(true);
  await search.fill('HIST.62');
  await expect(cards).toHaveCount(1);
  await search.fill(folderName);
  await expect(cards).toHaveCount(50);
  await search.fill('Rare Orchid');
  await expect(cards).toHaveCount(1);
  await expectPhoneLayout(page, area);
  await cards.first()[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect(area.getByRole('heading', { name: 'Rare Orchid', level: 2 })).toBeVisible();
  await expect(area).toContainText('Completed instruction 62');
  await expect(page.locator('button[aria-label="Back"]:visible')).toHaveCount(1);
  await page.locator('#global-header-inline-back')[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect(search).toHaveValue('Rare Orchid');
  await expect(cards).toHaveCount(1);
  await search.fill('');
  await expect(cards).toHaveCount(50);
  await area.getByRole('button', { name: 'Pending', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('Pending Magnolia');
  await area.getByRole('button', { name: 'All', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect(cards.first()).toContainText('Pending Magnolia');
  await area.getByRole('button', { name: 'Browse customer / consignee', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect(area.getByText('Saving or loading…', { exact: true })).toHaveCount(0);
  const folder = area.getByRole('button', { name: `${folderName} 63 records`, exact: true });
  await expect(folder).toHaveCount(1);
  await expect(area.getByRole('button', { name: 'Acme Nursery — Unknown consignee 1 records', exact: true })).toHaveCount(1);
  await folder[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect(cards.first()).toContainText('Cedar 00');
  // A denied scoped response must be reported instead of appearing as a successful empty search.
  f.denyHistory = true;
  await area.getByRole('button', { name: 'Refresh records', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect(area.getByRole('alert')).toContainText('SALES_ACCESS_DENIED');
  expectIsolated(f);
});

test('Credit tabs keep source lists and selections separate', async ({ page, baseURL }) => {
  const f = await installSalesMobileFixture(page, baseURL!);
  const area = await openSales(page, 'Credit', 'sales-credit');
  const docksTab = area.getByRole('button', { name: 'Docks History', exact: true });
  const requestsTab = area.getByRole('button', { name: 'Completed Requests', exact: true });
  await expect(docksTab).toHaveAttribute('aria-pressed', 'true');
  await area.getByRole('button', { name: `${folderName} 2 records`, exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  await area.getByRole('checkbox', { name: 'Blue Hydrangea', exact: true }).check();
  await requestsTab[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect(requestsTab).toHaveAttribute('aria-pressed', 'true');
  await area.getByRole('button', { name: `${folderName} 63 records`, exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  await area.getByRole('checkbox', { name: 'Cedar 00', exact: true }).check();
  await docksTab[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect(area.getByRole('checkbox', { name: 'Blue Hydrangea', exact: true })).toBeChecked();
  await expect(area.getByRole('checkbox', { name: 'Cedar 00', exact: true })).toHaveCount(0);
  await requestsTab[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect(area.getByRole('checkbox', { name: 'Cedar 00', exact: true })).toBeChecked();
  // Live-sync can refresh either visible tab at any point. Require both exact
  // transport contracts without asserting a timing-dependent request count.
  expect([...new Set(f.commands.filter(call => call.action === 'sales_credit' && ['folders', 'sources'].includes(call.operation))
    .map(call => `${call.operation}:${call.payload.sourceKind}`))].sort())
    .toEqual(['folders:docks', 'folders:request_history', 'sources:docks', 'sources:request_history']);
  expect(f.commands.filter(call => call.action === 'sales_credit' && ['folders', 'sources'].includes(call.operation))
    .every(call => ['docks', 'request_history'].includes(call.payload.sourceKind))).toBe(true);
  expectIsolated(f);
});

test('history Request Credit resolves the exact archive and a denied source shows an alert', async ({ page, baseURL }) => {
  const f = await installSalesMobileFixture(page, baseURL!);
  const history = await openSales(page, 'Request History', 'request-history');
  await history.getByLabel('Search customer, consignee, item, common name, or folder', { exact: true }).fill('Rare Orchid');
  await expect(history.locator('.sw-history-card')).toHaveCount(1);
  await history.getByRole('button', { name: 'Request Credit', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  const credit = page.locator('#sales-credit-content');
  await expect(credit.getByRole('heading', { name: 'Credit draft', exact: true })).toBeVisible();
  await expect(credit.getByRole('heading', { name: 'Rare Orchid', exact: true })).toBeVisible();
  expect(f.commands.some(call => call.action === 'sales_credit' && call.operation === 'source' &&
    call.payload.sourceKind === 'request_history' && call.payload.sourceUniqueId === 'history-62')).toBe(true);
  await page.locator('#global-header-inline-back')[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect(credit.getByRole('button', { name: 'Completed Requests', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(credit.getByRole('checkbox', { name: 'Rare Orchid', exact: true })).toBeChecked();
  f.denySource = true;
  await page.evaluate(() => (window as any).SalesWorkspace.openSource('docks', 'dock-2'));
  await expect(credit.getByRole('alert')).toContainText('SOURCE_ACCESS_DENIED');
  await expect(credit.getByRole('heading', { name: 'Credit draft', exact: true })).toHaveCount(0);
  f.denySource = false;
  await page.evaluate(() => (window as any).SalesWorkspace.openSource('docks', 'dock-2'));
  await expect(credit.getByRole('heading', { name: 'Red Hydrangea', exact: true })).toBeVisible();
  await expect(credit.getByRole('button', { name: 'Docks History', exact: true })).toHaveCount(0);
  expectIsolated(f);
});

test('Docks Request Credit keeps the existing unsaved draft and photos', async ({ page, baseURL }) => {
  const f = await installSalesMobileFixture(page, baseURL!, { role: 'SALES' });
  const credit = await openSales(page, 'Credit', 'sales-credit');
  await credit.getByRole('button', { name: `${folderName} 2 records`, exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  await credit.getByRole('checkbox', { name: 'Blue Hydrangea', exact: true }).check();
  await credit.getByRole('button', { name: 'Prepare credit (1 rows)', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  const blue = credit.locator('article.sw-card').filter({ has: page.getByRole('heading', { name: 'Blue Hydrangea', exact: true }) });
  await blue.getByLabel('Affected quantity', { exact: true }).fill('2');
  await blue.getByRole('textbox', { name: 'What happened?', exact: true }).fill('Two plants arrived damaged.');
  await blue.locator('input[capture="environment"]').setInputFiles(photo('unsaved-capture.png'));
  await expect(blue.getByText('unsaved-capture.png', { exact: true })).toBeVisible();
  await page.locator('#footer-docks-btn')[test.info().project.use.isMobile ? 'tap' : 'click']();
  await page.getByRole('button', { name: 'Open Dock 8', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  await page.getByRole('button', { name: 'Open Stop 2', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  const redDock = page.locator('#docks-content .item-row').filter({ hasText: 'Red Hydrangea' });
  await expect(redDock.getByRole('button', { name: 'Request Credit', exact: true })).toBeVisible();
  await redDock.getByRole('button', { name: 'Request Credit', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect(credit.getByRole('heading', { name: 'Credit draft', exact: true })).toBeVisible();
  await expect(credit.getByRole('heading', { name: 'Red Hydrangea', exact: true })).toBeVisible();
  await expect(blue.getByLabel('Affected quantity', { exact: true })).toHaveValue('2');
  await expect(blue.getByText('unsaved-capture.png', { exact: true })).toBeVisible();
  expect(f.commands.some(call => call.action === 'sales_credit' && call.operation === 'source' &&
    call.payload.sourceKind === 'docks' && call.payload.sourceUniqueId === 'dock-2')).toBe(true);
  expect(f.drafts.size).toBe(0);
  expectIsolated(f);
});

test('multi-line drafts retain repeated photos, failed uploads, Back edits, and one uncertain submission', async ({ page, baseURL }) => {
  const f = await installSalesMobileFixture(page, baseURL!);
  const area = await openSales(page, 'Credit', 'sales-credit');
  await area.getByRole('button', { name: new RegExp(folderName) })[test.info().project.use.isMobile ? 'tap' : 'click']();
  await area.getByRole('checkbox', { name: 'Blue Hydrangea', exact: true }).check();
  await area.getByRole('checkbox', { name: 'Red Hydrangea', exact: true }).check();
  await area.getByRole('button', { name: 'Prepare credit (2 rows)', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  const blue = area.locator('article.sw-card').filter({ has: page.getByRole('heading', { name: 'Blue Hydrangea', exact: true }) });
  const red = area.locator('article.sw-card').filter({ has: page.getByRole('heading', { name: 'Red Hydrangea', exact: true }) });
  await blue.getByLabel('Affected quantity', { exact: true }).fill('3');
  await blue.getByRole('textbox', { name: 'What happened?', exact: true }).fill('Three plants arrived damaged.');
  await red.getByLabel('Affected quantity', { exact: true }).fill('4');
  await red.getByRole('textbox', { name: 'What happened?', exact: true }).fill('Four plants were broken during unloading.');
  await blue.locator('input[capture="environment"]').setInputFiles(photo('first-capture.png'));
  await blue.locator('input[capture="environment"]').setInputFiles(photo('second-capture.png'));
  await red.locator('input[type=file][multiple]').setInputFiles([photo('one-file.png'), photo('two-file.png')]);
  await expect(blue.getByText('first-capture.png', { exact: true })).toBeVisible();
  await expect(blue.getByText('second-capture.png', { exact: true })).toBeVisible();
  await expect(red.locator('.sw-file-row')).toHaveCount(2);
  await expectPhoneLayout(page, area);
  f.failUploads = true;
  await area.getByRole('button', { name: 'Save draft', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect(area.getByRole('alert')).toContainText('Photo upload unavailable');
  await expect(blue.getByLabel('Affected quantity', { exact: true })).toHaveValue('3');
  await expect(red.getByRole('textbox', { name: 'What happened?', exact: true })).toHaveValue('Four plants were broken during unloading.');
  await expect(area.locator('.sw-file-row')).toHaveCount(4);
  expect(f.drafts.size).toBe(0);
  f.failUploads = false;
  await area.getByRole('button', { name: 'Save draft', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect.poll(() => f.drafts.size).toBe(1);
  await expect(area.locator('.sw-file-row')).toHaveCount(0);
  expect(f.attachments.size).toBe(4);
  const uploads = f.commands.filter(call => call.operation === 'attachment_upload');
  expect(uploads[0].commandId).toBe(uploads[1].commandId);
  await expect(blue.getByRole('button', { name: 'Photo 2', exact: true })).toBeVisible();
  await page.locator('#global-header-inline-back')[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect(area.getByRole('checkbox', { name: 'Blue Hydrangea', exact: true })).toBeChecked();
  await area.getByRole('button', { name: 'Prepare credit (2 rows)', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect(blue.getByLabel('Affected quantity', { exact: true })).toHaveValue('3');
  await expect(area.locator('article.sw-card')).toHaveCount(2);
  await f.native.waitForRevisionIdle();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openSales(page, 'Credit', 'sales-credit');
  const savedDrafts = area.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Saved drafts/ }) });
  await savedDrafts.locator('summary')[test.info().project.use.isMobile ? 'tap' : 'click']();
  await savedDrafts.getByRole('button', { name: folderName, exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect(blue.getByLabel('Affected quantity', { exact: true })).toHaveValue('3');
  await expect(red.getByRole('textbox', { name: 'What happened?', exact: true })).toHaveValue('Four plants were broken during unloading.');
  await expect(blue.getByRole('button', { name: 'Photo 2', exact: true })).toBeVisible();
  f.loseSubmitAcknowledgement = true;
  await area.getByRole('button', { name: 'Submit credit request', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect(area.getByRole('alert')).toContainText('acknowledgement lost');
  expect(f.submissions.size).toBe(1);
  await expect(blue.getByLabel('Affected quantity', { exact: true })).toBeDisabled();
  await expect(blue.locator('input[capture="environment"]')).toBeDisabled();
  await expect(area.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
  const savesBeforeRetry = f.commands.filter(call => call.operation === 'save_draft').length;
  f.loseSubmitAcknowledgement = false;
  await area.getByRole('button', { name: 'Submit credit request', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect(area.getByRole('heading', { name: 'Credit draft', exact: true })).toHaveCount(0);
  await expect(area.getByRole('button', { name: new RegExp(folderName) })).toBeVisible();
  const submits = f.commands.filter(call => call.operation === 'submit');
  expect(submits).toHaveLength(2);
  expect(submits[1].commandId).toBe(submits[0].commandId);
  expect(submits[1].expectedRevision).toBe(submits[0].expectedRevision);
  expect(f.commands.filter(call => call.operation === 'save_draft')).toHaveLength(savesBeforeRetry);
  expect(f.submissions.size).toBe(1);
  expect([...f.submissions.values()][0].lines.map((line: any) => [line.quantity, line.attachment_ids.length])).toEqual([[3, 2], [4, 2]]);
  expectIsolated(f);
});

test('review keeps separate line decisions and exposes one mixed submission in each matching tab', async ({ page, baseURL }) => {
  const f = await installSalesMobileFixture(page, baseURL!);
  const submissionId = f.seedReview();
  const area = await openSales(page, 'Credit Request', 'credit-request');
  await expect(area.locator('button.sw-card')).toHaveCount(1);
  await expect(area.locator('button.sw-card')).toContainText('2 matching lines');
  await area.locator('button.sw-card')[test.info().project.use.isMobile ? 'tap' : 'click']();
  const cards = area.locator('article.sw-card');
  await cards.nth(1).getByRole('button', { name: 'Deny line', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect(area.getByRole('alert')).toContainText('Enter a reason');
  expect(f.commands.filter(call => call.operation === 'review_line')).toHaveLength(0);
  await cards.nth(1).getByLabel('Review reason (required for denial)', { exact: true }).fill('Photos show healthy stock, not shipping damage.');
  await cards.nth(0).getByRole('button', { name: 'Approve line', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect(cards.nth(0)).toContainText('approved');
  // Re-rendering after another line changes must retain this denial explanation.
  await expect(cards.nth(1).getByLabel('Review reason (required for denial)', { exact: true })).toHaveValue('Photos show healthy stock, not shipping damage.');
  await cards.nth(1).getByRole('button', { name: 'Deny line', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect(cards.nth(1)).toContainText('denied');
  await expectPhoneLayout(page, area);
  const stored = f.submissions.get(submissionId);
  expect(stored.lines.map((line: any) => line.status)).toEqual(['approved', 'denied']);
  expect(stored.lines.map((line: any) => line.reviewHistory.length)).toEqual([1, 1]);
  await page.locator('#global-header-inline-back')[test.info().project.use.isMobile ? 'tap' : 'click']();
  await area.getByRole('button', { name: 'Refresh records', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect(area.getByText('No matching records.', { exact: true })).toBeVisible();
  for (const label of ['Approved Credit Request', 'Credit Denial']) {
    await area.getByRole('button', { name: label, exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
    await expect(area.locator('button.sw-card')).toHaveCount(1);
    await expect(area.locator('button.sw-card')).toContainText('1 matching lines');
  }
  expect(f.submissions.size).toBe(1);
  expectIsolated(f);
});

test('footer preferences survive reload, preserve fixed controls, and reject a revoked shortcut', async ({ page, baseURL }) => {
  const f = await installSalesMobileFixture(page, baseURL!);
  await page.locator('#footer-menu-btn')[test.info().project.use.isMobile ? 'tap' : 'click']();
  await page.getByRole('button', { name: 'Customize shortcuts', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  const dialog = page.getByRole('dialog', { name: 'Footer shortcuts', exact: true });
  await expect(dialog.getByRole('combobox', { name: 'Shortcut 1', exact: true })).toBeVisible();
  const chosen = ['request-history', 'drive', 'tasks', 'docks', 'bloom'];
  for (const [index, value] of chosen.entries()) await dialog.getByRole('combobox', { name: `Shortcut ${index + 1}`, exact: true }).selectOption(value);
  await dialog.getByRole('button', { name: 'Save shortcuts', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect.poll(() => f.navigation.shortcuts).toEqual(chosen);
  await dialog.getByRole('button', { name: 'Close', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  const footerViews = () => page.locator('#bottom-nav > .footer-nav-btn:visible').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.footerView || ({ 'footer-menu-btn': 'menu', 'footer-cart-btn': 'bloom' } as Record<string, string>)[node.id]));
  await expect.poll(footerViews).toEqual(['menu', 'home', ...chosen, 'communication']);
  await f.native.waitForRevisionIdle();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(footerViews).toEqual(['menu', 'home', ...chosen, 'communication']);
  await page.locator('#footer-personal-request-history')[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect(page.locator('#request-history-content').getByRole('heading', { name: 'Request History', level: 1 })).toBeVisible();
  await page.locator('#footer-menu-btn')[test.info().project.use.isMobile ? 'tap' : 'click']();
  await page.getByRole('button', { name: 'Customize shortcuts', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  await dialog.getByRole('combobox', { name: 'Shortcut 1', exact: true }).selectOption('sales-credit');
  f.rejectShortcutSave = true;
  await dialog.getByRole('button', { name: 'Save shortcuts', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect(dialog.getByRole('alert')).toContainText('permissions changed');
  await expect(dialog.getByRole('combobox', { name: 'Shortcut 1', exact: true })).toHaveValue('sales-credit');
  expect(f.navigation.shortcuts).toEqual(chosen);
  await dialog.getByRole('button', { name: 'Close', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  f.navigation.views.find((view: any) => view.view === 'request-history').allowed = false;
  f.navigation.accessRevision++;
  await page.evaluate(() => (window as any).GncNavigationPreferences.refresh());
  await expect(page.locator('#bottom-nav #footer-personal-request-history')).toHaveCount(0);
  await page.locator('#home-tile-sales')[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect(page.locator('#sales-hub-grid').getByRole('button', { name: 'Request History', exact: true })).toBeHidden();
  await expect(page.locator('#footer-menu-btn')).toBeVisible();
  await expect(page.locator('#footer-home-btn')).toBeVisible();
  await expect(page.locator('#footer-communication-btn')).toBeVisible();
  expectIsolated(f);
});

test('propagation and planting retain protected work after reload and complete without inventory writes', async ({ page, baseURL }) => {
  const f = await installSalesMobileFixture(page, baseURL!);
  const panel = page.locator('#production-workflow-page-content');
  const openWorkflow = async (type: string) => {
    await page.locator('#footer-home-btn')[test.info().project.use.isMobile ? 'tap' : 'click']();
    await page.locator('#home-tile-production')[test.info().project.use.isMobile ? 'tap' : 'click']();
    await page.locator(`#production-open-${type}`)[test.info().project.use.isMobile ? 'tap' : 'click']();
    await expect(panel).toBeVisible();
  };
  for (const [type, title, quantityLabel] of [
    ['propagation', 'Propagation', 'Amount / Percent'], ['planting', 'Planting', 'Amount Planted'],
  ]) {
    await openWorkflow(type);
    await panel.getByRole('button', { name: /^Propagation Holly/ })[test.info().project.use.isMobile ? 'tap' : 'click']();
    await panel.getByLabel(quantityLabel, { exact: true }).fill('5');
    await panel.getByLabel('Instructions Optional', { exact: true }).fill(`Keep ${type} stock together.`);
    if (type === 'planting') await panel.getByLabel('Bay Number Optional', { exact: true }).fill('001');
    // A late list/inventory response can render after typing. Reproduce that
    // boundary deterministically instead of relying on network timing.
    await page.evaluate(() => (window as any).eval('renderProductionWorkflowPanel()'));
    await expect(panel.getByLabel(quantityLabel, { exact: true })).toHaveValue('5');
    await expect(panel.getByLabel('Instructions Optional', { exact: true })).toHaveValue(`Keep ${type} stock together.`);
    if (type === 'planting') await expect(panel.getByLabel('Bay Number Optional', { exact: true })).toHaveValue('001');
    await panel.getByRole('button', { name: `Move To ${title}`, exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
    await page.locator('#app-prompt-dialog').getByRole('button', { name: 'Confirm', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
    await expect(panel.getByRole('button', { name: 'Already Open', exact: true })).toBeDisabled();
    await expect(panel.getByLabel(quantityLabel, { exact: true })).toHaveValue('');
    await expect(panel.getByLabel('Instructions Optional', { exact: true })).toHaveValue('');
    if (type === 'planting') await expect(panel.getByLabel('Bay Number Optional', { exact: true })).toHaveValue('');
    const added = [...f.productionRows.values()].find(row => row.workflow_type === type);
    expect(added.quantity).toBe(5);
    expect(added.locationcode).toBe('D.08.001');
    expect(added.instructions).toBe(`Keep ${type} stock together.`);
    if (type === 'planting') expect(added.baynumber).toBe('001');
    await f.native.waitForRevisionIdle();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openWorkflow(type);
    await panel.getByRole('button', { name: `${title} List`, exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
    await panel.getByRole('button', { name: /^Block D / })[test.info().project.use.isMobile ? 'tap' : 'click']();
    await panel.getByRole('button', { name: 'Open location D.08', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
    await panel.getByRole('button', { name: /^Loc D\.08\.001 / })[test.info().project.use.isMobile ? 'tap' : 'click']();
    await expect(panel).toContainText(`Keep ${type} stock together.`);
    await expectPhoneLayout(page, panel);
    await panel.getByRole('button', { name: 'Complete', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
    await expect(panel.getByText(`No open ${title} rows.`, { exact: true })).toBeVisible();
    expect(f.productionRows.get(added.unique_id).status).toBe('complete');
    expect(f.productionRows.get(added.unique_id).revision).toBe(2);
  }
  for (const type of ['can-filling', 'order-pulling']) {
    await openWorkflow(type);
    await expect(panel.getByRole('status')).toHaveText('Not yet available');
    await expect(panel.locator('input,textarea,select')).toHaveCount(0);
    await expect(panel.getByRole('button')).toHaveCount(1); // Necessary Close control only.
  }
  const writes = f.commands.filter(call => call.action === 'production_workflow' && call.operation !== 'list');
  expect(writes.map(call => call.operation)).toEqual(['add', 'complete', 'add', 'complete']);
  expect(writes.every(call => Boolean(call.command_id))).toBe(true);
  expect(f.native.master[0].ptravailable).toBe('15');
  expectIsolated(f);
});

test('Inventory Transaction History pages and searches on the server, preserving requested status', async ({ page, baseURL }) => {
  const capabilityRequests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/functions/v1/codex-ops-api') capabilityRequests.push(request.url());
  });
  const f = await installSalesMobileFixture(page, baseURL!);
  await page.locator('#home-tile-managers')[test.info().project.use.isMobile ? 'tap' : 'click']();
  const area = page.locator('#view-managers');
  await area.getByRole('button', { name: /^Transaction History:/ })[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect(area.locator('article')).toHaveCount(100);
  await expect(area.locator('article').first()).toContainText('TX0000');
  await area.getByRole('button', { name: 'Next page', exact: true })[test.info().project.use.isMobile ? 'tap' : 'click']();
  await expect(area.locator('article')).toHaveCount(1);
  await expect(area.locator('article')).toContainText('TX0100');
  await expect(area.locator('article')).toContainText('requested');
  await expect(area.getByRole('button', { name: 'Next page', exact: true })).toBeDisabled();
  expect(f.commands.some(call => call.action === 'inventory_transaction_history' && call.offset === 100)).toBe(true);
  await area.getByLabel('Search user, item, lot, loc, reason', { exact: true }).fill('Beyond first page request');
  await expect.poll(() => f.commands.filter(call => call.action === 'inventory_transaction_history').some(call =>
    call.offset === 0 && call.search === 'Beyond first page request')).toBe(true);
  await expect(area.locator('article')).toHaveCount(1);
  await expect(area.locator('article')).toContainText('TX0100');
  await expect(area.getByRole('button', { name: 'Previous page', exact: true })).toBeDisabled();
  await expectPhoneLayout(page, area);
  await area.getByRole('combobox', { name: 'Action', exact: true }).selectOption('transfer');
  await expect(area.locator('article')).toHaveCount(0);
  await expect(area.getByText('No QTY, Transfer, Reclass, or Priority Change history matched those filters.', { exact: true })).toBeVisible();
  expect(f.commands.some(call => call.action === 'inventory_transaction_history' && call.filter_action === 'transfer' && call.offset === 0)).toBe(true);
  // The fixture leaves the optional capability endpoint unavailable. History
  // must remain usable instead of retrying it on each render and replacing taps.
  expect(capabilityRequests).toHaveLength(1);
  expectIsolated(f);
});
