import { expect, test, type Page, type Locator } from '@playwright/test';
import { installHlOrderFixture, hlSoc, hlMaster, hlRecipient } from './fixtures/hl-order-state.mjs';

async function openHl(page: Page) {
  await expect(page.locator('#view-login')).toBeHidden();
  await navigateHl(page, page.locator('#home-tile-hl-order'));
  await expect(page.locator('[data-hl-tab="needed"]')).toBeVisible();
}
async function openDetails(page: Page) {
  await navigateHl(page, page.locator('[data-hl-group]').first().getByRole('button', { name: 'View HL order details', exact: true }));
  await expect(page.locator('#hl-order-detail')).toBeVisible();
}
async function selectOne(page: Page, sourceId = 'hl-a', quantity = '6') {
  await openDetails(page);
  const rows = page.locator('#hl-order-detail [data-hl-source-id]');
  for (const row of await rows.all()) {
    await row.locator('[data-hl-select]').setChecked(await row.getAttribute('data-hl-source-id') === sourceId);
  }
  const selected = page.locator(`[data-hl-source-id="${sourceId}"]`);
  await selected.locator('[data-hl-quantity]').fill(quantity);
  await page.getByRole('button', { name: 'Order selected rows', exact: true }).click();
  await expect(page.locator(`[data-hl-draft-source-id="${sourceId}"]`)).toBeVisible();
}
async function preview(page: Page) {
  await page.locator('#batch-btn-hl-tags').click();
  await expect(page.locator('#hl-tags-preview')).toBeVisible();
  await expect(page.locator('#hl-tags-preview-content')).toContainText(hlRecipient);
  await expect(page.getByRole('link', { name: 'Open or download PDF' })).toHaveAttribute('href', /^blob:/);
}
async function reloadHl(page: Page) {
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.eval('typeof nativeAuthProfile !== "undefined" && !!nativeAuthProfile'));
  await openHl(page);
}
async function closeBloom(page: Page) {
  if (await page.locator('#global-action-bar').isVisible()) await page.getByRole('button', { name: 'Bloom Picker', exact: true }).click();
}
async function navigateHl(page: Page, target: Locator) {
  await closeBloom(page);
  await target.click();
}
const actions = (fixture: any, action: string) => fixture.commands.filter((command: any) => command.p_action === action);
async function assertWithinViewport(page: Page, element: Locator) {
  await expect.poll(async () => {
    const bounds = await element.boundingBox();
    return !!bounds && bounds.x + bounds.width <= page.viewportSize()!.width + 1;
  }).toBe(true);
}
async function capture(page: Page, path: string) {
  const help = page.locator('#push-permission-help-modal');
  if (await help.isVisible()) await help.getByRole('button', { name: 'Close', exact: true }).dispatchEvent('click');
  const prompt = page.locator('#mobile-push-enable-prompt');
  if (await prompt.isVisible()) await prompt.getByRole('button', { name: 'Dismiss', exact: true }).dispatchEvent('click');
  const toast = page.locator('#toast-notification.show');
  if (await toast.isVisible()) await toast.getByRole('button', { name: 'Dismiss notification', exact: true }).dispatchEvent('click');
  await page.screenshot({ path });
}
function assertIsolated(fixture: any) {
  expect(fixture.errors).toEqual([]);
  expect(fixture.blockedMutations).toEqual([]);
}

test('cards use all five grouping fields and detail shows all accessible matching Drive seasons despite search filters', async ({ page, baseURL }, info) => {
  const fixture = await installHlOrderFixture(page, baseURL!, { rows: [hlSoc('hl-a'), hlSoc('hl-b', { quantityordered: '15', locationcode: 'C.14.002', lotcode: '26.F1' }),
    hlSoc('date', { planstartdate: '2026-09-16' }), hlSoc('dock', { dock: '5' }), hlSoc('stop', { stopnumber: '3' }), hlSoc('size', { contsize: '#7' }), hlSoc('item', { itemcode: 'OTHER' })] });
  expect(fixture.runtime).toBe(1);
  // These are existing Drive controls, not HL filter state. No list contents are replaced.
  await page.evaluate(() => {
    const search = document.getElementById('drive-search') as HTMLInputElement | null;
    if (search) { search.value = 'UNRELATED'; search.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await openHl(page);
  await expect(page.locator('[data-hl-group]')).toHaveCount(6);
  const card = page.locator('[data-hl-group]').filter({ hasText: 'SOC quantity: 25' });
  await expect(card).toContainText('Dock: 4'); await expect(card).toContainText('Stop: 2');
  await navigateHl(page, card.getByRole('button', { name: 'View HL order details', exact: true }));
  const detail = page.locator('#hl-order-detail');
  await expect(detail.locator('[data-hl-source-id]')).toHaveCount(2);
  await expect(detail.locator('[data-hl-source-id="hl-a"] [data-hl-quantity]')).toHaveValue('10');
  await expect(detail.locator('[data-hl-source-id="hl-b"] [data-hl-quantity]')).toHaveValue('15');
  await expect(detail.locator('[data-hl-drive-location]')).toHaveCount(4);
  await expect(detail.locator('[data-hl-drive-location="A.02.001"]')).toContainText(/Unknown|Not available/);
  await expect(detail.locator('[data-hl-drive-location="B.01.010"]')).toContainText(/Available:\s*0/);
  await expect(detail.locator('[data-hl-drive-location="C.12.001"]')).toContainText(/Season:\s*27 F1/);
  await expect(detail.locator('[data-hl-drive-location="C.14.002"]')).toContainText(/Season:\s*26 F1/);
  await expect(detail.locator('[data-hl-drive-location="A.02.001"]')).toContainText(/Season:\s*25 S1/);
  await expect(detail.locator('[data-hl-drive-location="B.01.010"]')).toContainText(/Season:\s*28 F1/);
  await expect(detail.locator('[data-hl-drive-location="A.07.001"]')).toHaveCount(0);
  await expect(detail.locator('[data-hl-drive-location="A.08.001"]')).toHaveCount(0);
  await assertWithinViewport(page, detail);
  await capture(page, info.outputPath('hl-full-detail.png'));
  await navigateHl(page, detail.getByRole('button', { name: 'Back', exact: true }));
  await expect(page.locator('[data-hl-group]')).toHaveCount(6);
  expect(fixture.commands).toHaveLength(0); assertIsolated(fixture);
});

test('selected editable quantities persist through reload and HL removal preserves unrelated Bloom items', async ({ page, baseURL }) => {
  const fixture = await installHlOrderFixture(page, baseURL!);
  await openHl(page);
  await expect.poll(() => page.evaluate(() => window.eval(`(() => {
    const unrelated = fullInventory.find(row => row.UNIQUE_ID === 'master-other-item');
    if (!unrelated?.DOM_ID || !canUseHlOrderVerifiedData() || !canCurrentUserSelectDriveWorkflowRow(findItemByDomId(unrelated.DOM_ID), 'drive')) return false;
    window.__hlUnrelatedId = unrelated.DOM_ID;
    toggleGlobalItem(unrelated.DOM_ID, true, 'drive');
    return selectedItems.has(unrelated.DOM_ID);
  })()`))).toBe(true);
  await selectOne(page, 'hl-a', '6');
  expect(actions(fixture, 'draft_save').at(-1).p_payload.rows).toEqual([{ source_id: 'hl-a', quantity: 6 }]);
  expect(fixture.state.draft.map((row: any) => row.source_id)).toEqual(['hl-a']);
  expect(await page.evaluate(() => window.eval('selectedItems.has(window.__hlUnrelatedId)'))).toBe(true);
  const draft = page.locator('[data-hl-draft-source-id="hl-a"]');
  await draft.locator('[data-hl-draft-quantity]').fill('7');
  await draft.getByRole('button', { name: 'Save quantity', exact: true }).click();
  await expect.poll(() => fixture.state.draft[0].quantity).toBe(7);
  await draft.getByRole('button', { name: 'Remove from Bloom Picker', exact: true }).click();
  await expect.poll(() => fixture.state.draft.length).toBe(0);
  expect(await page.evaluate(() => window.eval('selectedItems.has(window.__hlUnrelatedId)'))).toBe(true);
  await navigateHl(page, page.locator('#hl-order-detail').getByRole('button', { name: 'Back', exact: true }));
  await selectOne(page, 'hl-a', '7');
  await reloadHl(page);
  await expect(page.locator('[data-hl-draft-source-id="hl-a"] [data-hl-draft-quantity]')).toHaveValue('7');
  await expect(page.locator('[data-hl-group]')).toContainText('In Bloom Picker');
  assertIsolated(fixture);
});

test('PO inventory action pages verified same-size rows and preserves zero availability', async ({ page, baseURL }) => {
  const master = [hlMaster('po-exact', { itemcode: 'PO.TEST', contsize: '#3', locationcode: 'C.12.001', lotcode: '27.F1', ptravailable: '0' }),
    ...Array.from({ length: 251 }, (_, index) => hlMaster(`po-related-${String(index).padStart(3, '0')}`, { itemcode: 'PO.TEST', contsize: '#3', locationcode: `C.14.${String(index).padStart(3, '0')}`, lotcode: '27.F1', ptravailable: index === 1 ? null : '3' }))];
  const fixture = await installHlOrderFixture(page, baseURL!, { master, poRows: [{ row_index: 1, itemcode: 'PO.TEST', commonname: 'PO test', contsize: '#3', locationcode: 'C.12.001', lotcode: '27.F1' }] });
  await page.evaluate(() => window.eval("switchView('po-management')"));
  await page.getByRole('button', { name: 'HL PO', exact: true }).click();
  await page.getByRole('button', { name: '27F1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View inventory', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View inventory', exact: true }).click();
  const detail = page.locator('#po-inventory-detail-content');
  await expect(detail).toContainText('Exact item, size, location and lot match');
  await expect(detail).toContainText('PTRAVAILABLE: 0');
  await expect(detail).toContainText('Related item and size');
  expect(fixture.blockedMutations).toEqual([]);
});

test('HL TAGS separates saved drafts by canonical ship date and previews only the chosen date', async ({ page, baseURL }) => {
  const fixture = await installHlOrderFixture(page, baseURL!, { rows: [hlSoc('hl-a', { planstartdate: 'Tue Sep 15 2026 10:00:00 GMT-0500 (Central Daylight Time)' }),
    hlSoc('hl-b', { planstartdate: '2026-09-16', locationcode: 'C.14.002', lotcode: '26.F1' })] });
  await openHl(page); await selectOne(page, 'hl-a', '6');
  await navigateHl(page, page.locator('#hl-order-detail').getByRole('button', { name: 'Back', exact: true }));
  await navigateHl(page, page.locator('[data-hl-group]').filter({ hasText: 'Sep 16, 2026' }).getByRole('button', { name: 'View HL order details', exact: true }));
  const second = page.locator('[data-hl-source-id="hl-b"]');
  await second.locator('[data-hl-quantity]').fill('5');
  await page.getByRole('button', { name: 'Order selected rows', exact: true }).click();
  await expect(page.locator('[data-hl-ship-date="2026-09-15"]')).toContainText('Sep 15, 2026');
  await expect(page.locator('[data-hl-ship-date="2026-09-16"]')).toContainText('Sep 16, 2026');
  await page.locator('#batch-btn-hl-tags').click();
  const chooser = page.locator('#hl-tags-date-selector');
  await expect(chooser).toBeVisible();
  await chooser.getByRole('button', { name: 'Choose Sep 16, 2026', exact: true }).click();
  await expect(page.locator('#hl-tags-preview')).toBeVisible();
  expect(actions(fixture, 'preview').at(-1).p_payload).toEqual({ ship_date: '2026-09-16' });
  const report = [...fixture.previews.values()].at(-1).report;
  expect(report.ship_date).toBe('2026-09-16');
  expect(report.lines.map((line: any) => line.source_id)).toEqual(['hl-b']);
  assertIsolated(fixture);
});

test('PDF review freezes edited quantities and Needed survives queued delivery until confirmation', async ({ page, baseURL }, info) => {
  const fixture = await installHlOrderFixture(page, baseURL!);
  await openHl(page); await selectOne(page, 'hl-a', '6');
  await preview(page);
  expect(actions(fixture, 'submit')).toHaveLength(0);
  expect(fixture.pdfRequests).toHaveLength(1);
  expect(fixture.pdfRequests[0].type).toBe('hl_order_preview');
  const report = [...fixture.previews.values()][0].report;
  expect(report.lines.map((line: any) => [line.source_id, line.quantity, line.dock, line.stopnumber])).toEqual([['hl-a', 6, '4', '2']]);
  await capture(page, info.outputPath('hl-saved-pdf-preview.png'));
  await page.locator('#hl-tags-send').click();
  await expect(page.locator('#hl-tags-preview')).not.toBeVisible();
  expect(actions(fixture, 'submit')).toHaveLength(1);
  expect(fixture.state.orders).toHaveLength(1);
  await expect(page.locator('[data-hl-draft-source-id="hl-a"]')).toContainText(/pending|submitting/i);
  await navigateHl(page, page.locator('[data-hl-tab="needed"]'));
  await expect(page.locator('[data-hl-group]')).toContainText('In Bloom Picker');
  fixture.deliver('sent');
  await reloadHl(page);
  await expect(page.locator('[data-hl-draft-source-id="hl-a"]')).toHaveCount(0);
  await expect(page.locator('[data-hl-group]')).not.toContainText('In Bloom Picker');
  await navigateHl(page, page.locator('[data-hl-tab="orders"]'));
  await expect(page.locator('[data-hl-order-id]')).toContainText('sent');
  assertIsolated(fixture);
});

test('failed PDF and changed source never submit, and source review preserves the saved quantity', async ({ page, baseURL }) => {
  const fixture = await installHlOrderFixture(page, baseURL!);
  await openHl(page); await selectOne(page, 'hl-a', '6');
  fixture.failPreview = true;
  await page.locator('#batch-btn-hl-tags').click();
  await expect.poll(() => fixture.pdfRequests.length).toBe(1);
  await expect(page.locator('#hl-tags-preview')).not.toBeVisible();
  expect(actions(fixture, 'submit')).toHaveLength(0);
  expect(fixture.state.draft[0].quantity).toBe(6);
  fixture.failPreview = false; await preview(page);
  fixture.markChanged('hl-a', { quantityordered: '12', dock: '7' });
  await page.locator('#hl-tags-send').click();
  await expect.poll(() => actions(fixture, 'submit').length).toBe(1);
  expect(fixture.state.orders).toHaveLength(0);
  await page.locator('#hl-tags-preview').getByRole('button', { name: 'Close', exact: true }).click();
  await navigateHl(page, page.locator('[data-hl-tab="needs-review"]'));
  await expect(page.locator('[data-hl-review-source-id="hl-a"]')).toContainText('Source row changed');
  expect(fixture.state.draft[0].quantity).toBe(6);
  assertIsolated(fixture);
});

test('uncertain delivery remains protected across reload without another submission', async ({ page, baseURL }) => {
  const fixture = await installHlOrderFixture(page, baseURL!);
  await openHl(page); await selectOne(page); await preview(page);
  await page.locator('#hl-tags-send').click();
  await expect(page.locator('#hl-tags-preview')).not.toBeVisible();
  fixture.deliver('delivery_unknown'); await reloadHl(page);
  await expect(page.locator('#hl-order-content')).toContainText('Delivery could not be confirmed');
  await expect(page.locator('[data-hl-draft-source-id="hl-a"] [data-hl-draft-quantity]')).toBeDisabled();
  await navigateHl(page, page.locator('[data-hl-tab="orders"]'));
  await expect(page.locator('[data-hl-order-id]')).toContainText('delivery_unknown');
  expect(actions(fixture, 'submit')).toHaveLength(1);
  expect(fixture.state.orders).toHaveLength(1);
  assertIsolated(fixture);
});

test('an older uncertain order stays protected while a different-date ready source can be reviewed and ordered', async ({ page, baseURL }) => {
  const fixture = await installHlOrderFixture(page, baseURL!, { rows: [hlSoc('hl-a'), hlSoc('hl-b', { quantityordered: '15', locationcode: 'C.14.002', lotcode: '26.F1', planstartdate: '2026-09-16' })], seedOrder: true, seedDelivery: 'delivery_unknown' });
  const oldOrderId = fixture.state.orders[0].id;
  await openHl(page); await openDetails(page);
  const oldRow = page.locator('[data-hl-source-id="hl-a"]');
  await expect(oldRow.locator('[data-hl-select]')).toBeDisabled();
  await expect(oldRow.locator('[data-hl-quantity]')).toBeDisabled();
  await navigateHl(page, page.locator('#hl-order-detail').getByRole('button', { name: 'Back', exact: true }));
  await navigateHl(page, page.locator('[data-hl-group]').filter({ hasText: 'Sep 16, 2026' }).getByRole('button', { name: 'View HL order details', exact: true }));
  const newRow = page.locator('[data-hl-source-id="hl-b"]');
  await newRow.locator('[data-hl-select]').check();
  await newRow.locator('[data-hl-quantity]').fill('5');
  await page.getByRole('button', { name: 'Order selected rows', exact: true }).click();
  await expect(page.locator('[data-hl-draft-source-id="hl-b"]')).toBeVisible();
  expect(actions(fixture, 'draft_save').at(-1).p_payload.rows).toEqual([{ source_id: 'hl-b', quantity: 5 }]);
  await preview(page);
  const report = [...fixture.previews.values()].at(-1).report;
  expect(report.lines.map((line: any) => [line.source_id, line.quantity])).toEqual([['hl-b', 5]]);
  expect(report.total_quantity).toBe(5);
  await page.locator('#hl-tags-send').click();
  await expect(page.locator('#hl-tags-preview')).not.toBeVisible();
  expect(fixture.state.orders).toHaveLength(2);
  expect(fixture.state.orders[0].lines.map((line: any) => line.source_id)).toEqual(['hl-b']);
  fixture.deliver('sent'); await reloadHl(page);
  expect(fixture.state.orders.find((order: any) => order.id === oldOrderId).status).toBe('delivery_unknown');
  expect(fixture.state.delivery_issues.map((issue: any) => issue.order_id)).toEqual([oldOrderId]);
  await expect(page.locator('[data-hl-draft-source-id="hl-a"] [data-hl-draft-quantity]')).toBeDisabled();
  await expect(page.locator('[data-hl-draft-source-id="hl-b"]')).toHaveCount(0);
  expect(actions(fixture, 'submit')).toHaveLength(1);
  assertIsolated(fixture);
});

test('a lost submit response recovers the same command instead of creating another order', async ({ page, baseURL }) => {
  const fixture = await installHlOrderFixture(page, baseURL!);
  await openHl(page); await selectOne(page); await preview(page);
  fixture.loseSubmitResponse = true;
  await page.locator('#hl-tags-send').click();
  await expect.poll(() => fixture.state.orders.length).toBe(1);
  await expect(page.locator('#hl-tags-send')).toBeEnabled();
  fixture.loseSubmitResponse = false;
  await page.locator('#hl-tags-preview').getByRole('button', { name: 'Close', exact: true }).click();
  const refreshed = page.waitForResponse((response) => response.url().endsWith('/rpc/hl_order_state'));
  await navigateHl(page, page.locator('[data-hl-tab="needed"]'));
  await refreshed;
  await navigateHl(page, page.getByRole('button', { name: 'Check saved change', exact: true }));
  await expect.poll(() => actions(fixture, 'submit').length).toBeGreaterThan(1);
  expect(new Set(actions(fixture, 'submit').map((command: any) => command.p_command_id)).size).toBe(1);
  expect(fixture.state.orders).toHaveLength(1);
  await page.getByRole('button', { name: 'Bloom Picker', exact: true }).click();
  await expect(page.locator('[data-hl-draft-source-id="hl-a"]')).toContainText(/pending|submitting/i);
  assertIsolated(fixture);
});

test('replacement demand defaults to its remaining ceiling and rejects fractional or excessive quantities', async ({ page, baseURL }) => {
  const fixture = await installHlOrderFixture(page, baseURL!, { rows: [hlSoc('hl-a', { quantityordered: '10', available_quantity: 4 })] });
  await openHl(page); await openDetails(page);
  const input = page.locator('[data-hl-source-id="hl-a"] [data-hl-quantity]');
  await expect(input).toHaveValue('4'); await expect(input).toHaveAttribute('max', '4');
  for (const value of ['0', '-1', '2.5', '5']) {
    await input.fill(value);
    await page.getByRole('button', { name: 'Order selected rows', exact: true }).click();
    expect(actions(fixture, 'draft_save')).toHaveLength(0);
  }
  await input.fill('4');
  await page.getByRole('button', { name: 'Order selected rows', exact: true }).click();
  await expect.poll(() => fixture.state.draft[0]?.quantity).toBe(4);
  assertIsolated(fixture);
});

test('Remove selected rows is reversible without dismissing the other SOC row', async ({ page, baseURL }) => {
  const fixture = await installHlOrderFixture(page, baseURL!);
  await openHl(page); await openDetails(page);
  await page.locator('[data-hl-source-id="hl-b"] [data-hl-select]').uncheck();
  await page.getByRole('button', { name: 'Remove selected rows', exact: true }).click();
  await expect.poll(() => actions(fixture, 'dismiss').length).toBe(1);
  expect(actions(fixture, 'dismiss')[0].p_payload.source_ids).toEqual(['hl-a']);
  await navigateHl(page, page.locator('[data-hl-tab="removed"]'));
  const removed = page.locator('[data-hl-removed-source-id="hl-a"]');
  await expect(removed).toBeVisible();
  await expect(page.locator('[data-hl-removed-source-id="hl-b"]')).toHaveCount(0);
  await removed.getByRole('button', { name: 'Restore to Needed', exact: true }).click();
  await navigateHl(page, page.locator('[data-hl-tab="needed"]'));
  await expect(page.locator('[data-hl-group]')).toContainText('SOC quantity: 25');
  assertIsolated(fixture);
});

test('partial receipts and corrections remain separate from cancellation PDF submission', async ({ page, baseURL }, info) => {
  const fixture = await installHlOrderFixture(page, baseURL!, { seedOrder: true });
  await openHl(page); await navigateHl(page, page.locator('[data-hl-tab="orders"]'));
  await expect(page.locator('[data-hl-order-id]')).toBeVisible();
  await capture(page, info.outputPath('hl-orders.png'));
  await navigateHl(page, page.getByRole('button', { name: 'View order', exact: true }));
  const tracking = page.locator('#hl-order-tracking');
  const line = tracking.locator('[data-hl-order-line-id]').first();
  await line.locator('[data-hl-line-select]').check();
  await line.locator('[data-hl-received-quantity]').fill('6');
  await tracking.getByRole('button', { name: 'Save received quantities', exact: true }).click();
  await expect.poll(() => fixture.state.orders[0].lines[0].received_quantity).toBe(6);
  await expect(line).toContainText('Outstanding: 4');
  await line.locator('[data-hl-line-select]').check();
  await line.locator('[data-hl-received-quantity]').fill('4');
  await page.locator('#hl-order-reason').fill('Corrected unloading count');
  await tracking.getByRole('button', { name: 'Save received quantities', exact: true }).click();
  await expect.poll(() => fixture.state.orders[0].lines[0].received_quantity).toBe(4);
  expect(fixture.state.orders[0].receipts).toHaveLength(2);
  await expect(tracking).toContainText('Corrected unloading count');
  await assertWithinViewport(page, tracking);
  await capture(page, info.outputPath('hl-order-tracking.png'));
  await line.locator('[data-hl-line-select]').check();
  await line.locator('[data-hl-cancel-quantity]').fill('3');
  await page.locator('#hl-order-reason').fill('Covered from local stock');
  await tracking.getByRole('button', { name: 'Review cancellation PDF', exact: true }).click();
  await expect(page.locator('#hl-tags-preview')).toBeVisible();
  await expect(page.locator('#hl-tags-preview-content')).toContainText('Cancellation');
  expect(actions(fixture, 'cancellation_submit')).toHaveLength(0);
  const cancellation = [...fixture.previews.values()].find((entry: any) => entry.report.kind === 'cancellation');
  expect(cancellation.report.original_order_number).toBe(fixture.state.orders[0].order_number);
  expect(cancellation.report.lines[0].quantity).toBe(3);
  await page.locator('#hl-tags-send').click();
  await expect(page.locator('#hl-tags-preview')).not.toBeVisible();
  expect(actions(fixture, 'cancellation_submit')).toHaveLength(1);
  expect(fixture.state.orders[0].lines[0].quantity).toBe(10);
  expect(fixture.state.orders[0].lines[0].received_quantity).toBe(4);
  expect(fixture.state.orders[0].cancellations).toHaveLength(1);
  fixture.confirmCancellation(); await reloadHl(page);
  await navigateHl(page, page.locator('[data-hl-tab="orders"]'));
  await navigateHl(page, page.getByRole('button', { name: 'View order', exact: true }));
  await line.locator('[data-hl-line-select]').check();
  await line.locator('[data-hl-received-quantity]').fill('7');
  await tracking.getByRole('button', { name: 'Save received quantities', exact: true }).click();
  await expect.poll(() => fixture.state.orders[0].fulfillment_status).toBe('received_and_cancelled');
  await navigateHl(page, tracking.getByRole('button', { name: 'Back', exact: true }));
  await expect(page.locator('[data-hl-order-id]')).toHaveCount(0);
  await navigateHl(page, page.locator('[data-hl-tab="history"]'));
  await expect(page.locator('[data-hl-order-id]')).toHaveCount(1);
  assertIsolated(fixture);
});

test('a focused draft edit cannot overwrite another device after a newer state poll', async ({ page, baseURL }) => {
  const fixture = await installHlOrderFixture(page, baseURL!);
  await openHl(page); await selectOne(page, 'hl-a', '6');
  const draft = page.locator('[data-hl-draft-source-id="hl-a"]');
  const baseline = await draft.getAttribute('data-hl-edit-revision');
  expect(baseline).not.toBeNull();
  await draft.locator('[data-hl-draft-quantity]').fill('5');
  fixture.command({ p_command_id: '20000000-0000-4000-8000-000000000001', p_action: 'draft_save',
    p_payload: { rows: [{ source_id: 'hl-a', quantity: 7 }] }, p_expected_revision: fixture.state.revision });
  await page.evaluate(() => window.eval('loadHlOrderState(true)'));
  await expect(draft.locator('[data-hl-draft-quantity]')).toHaveValue('5');
  await expect(draft).toHaveAttribute('data-hl-edit-revision', baseline!);
  await draft.getByRole('button', { name: 'Save quantity', exact: true }).click();
  await expect.poll(() => actions(fixture, 'draft_save').length).toBe(3);
  expect(actions(fixture, 'draft_save').at(-1).p_expected_revision).toBe(Number(baseline));
  expect(fixture.state.draft[0].quantity).toBe(7);
  await expect(page.locator('#hl-order-content')).toContainText(/changed|refresh|review/i);
  assertIsolated(fixture);
});

test('a focused receipt correction cannot overwrite a newer receipt after a state poll', async ({ page, baseURL }) => {
  const fixture = await installHlOrderFixture(page, baseURL!, { seedOrder: true });
  await openHl(page); await navigateHl(page, page.locator('[data-hl-tab="orders"]'));
  await navigateHl(page, page.getByRole('button', { name: 'View order', exact: true }));
  const tracking = page.locator('#hl-order-tracking'), line = tracking.locator('[data-hl-order-line-id]').first();
  const baseline = await tracking.getAttribute('data-hl-edit-revision');
  expect(baseline).not.toBeNull();
  await line.locator('[data-hl-line-select]').check();
  await line.locator('[data-hl-received-quantity]').fill('6');
  const order = fixture.state.orders[0];
  fixture.command({ p_command_id: '20000000-0000-4000-8000-000000000002', p_action: 'receive',
    p_payload: { order_id: order.id, lines: [{ line_id: order.lines[0].id, received_quantity: 4 }], reason: 'Another device received four' }, p_expected_revision: fixture.state.revision });
  await page.evaluate(() => window.eval('loadHlOrderState(true)'));
  await expect(line.locator('[data-hl-received-quantity]')).toHaveValue('6');
  await expect(tracking).toHaveAttribute('data-hl-edit-revision', baseline!);
  await tracking.getByRole('button', { name: 'Save received quantities', exact: true }).click();
  await expect.poll(() => actions(fixture, 'receive').length).toBe(2);
  expect(actions(fixture, 'receive').at(-1).p_expected_revision).toBe(Number(baseline));
  expect(fixture.state.orders[0].lines[0].received_quantity).toBe(4);
  expect(fixture.state.orders[0].receipts).toHaveLength(1);
  await expect(page.locator('#hl-order-content')).toContainText(/changed|refresh|review/i);
  assertIsolated(fixture);
});

test('a same-state refresh during a mouse press preserves the HL card activation', async ({ page, baseURL }) => {
  // Browser push is optional for HL. Keep its education overlays out of this held-pointer scenario.
  await page.addInitScript(() => { Reflect.deleteProperty(window, 'PushManager'); });
  const fixture = await installHlOrderFixture(page, baseURL!);
  expect(await page.evaluate(() => window.eval('isPushSupported()'))).toBe(false);
  await openHl(page);
  const button = page.locator('[data-hl-group]').first().getByRole('button', { name: 'View HL order details', exact: true });
  await button.hover();
  await page.mouse.down();
  // A native read completes while the mouse is held. Its unchanged state must
  // not replace the pressed node before the browser dispatches mouseup/click.
  await page.evaluate(() => window.eval('loadHlOrderState(true)'));
  await page.mouse.up();
  await expect(page.locator('#hl-order-detail')).toBeVisible();
  expect(fixture.commands).toHaveLength(0);
  assertIsolated(fixture);
});

test('a state refresh during an edited order button press preserves the save', async ({ page, baseURL }) => {
  await page.addInitScript(() => { Reflect.deleteProperty(window, 'PushManager'); });
  const fixture = await installHlOrderFixture(page, baseURL!);
  expect(await page.evaluate(() => window.eval('isPushSupported()'))).toBe(false);
  await openHl(page); await openDetails(page);
  const selected = page.locator('[data-hl-source-id="hl-a"]');
  await page.locator('[data-hl-source-id="hl-b"] [data-hl-select]').uncheck();
  await selected.locator('[data-hl-quantity]').fill('7');
  const button = page.getByRole('button', { name: 'Order selected rows', exact: true });
  await button.hover();
  await page.mouse.down();
  expect(await page.evaluate(() => window.eval('activeFastPress?.actionKey.startsWith("invoke|orderHlSelectedRows|")'))).toBe(true);
  await page.evaluate(() => window.eval('loadHlOrderState(true)'));
  await page.mouse.up();
  await expect(page.locator('[data-hl-draft-source-id="hl-a"]')).toBeVisible();
  expect(actions(fixture, 'draft_save')).toHaveLength(1);
  expect(fixture.state.draft[0].quantity).toBe(7);
  assertIsolated(fixture);
});

test('another admin cannot discover or open HL ordering', async ({ page, baseURL }) => {
  const fixture = await installHlOrderFixture(page, baseURL!, { username: 'jd_jones' });
  await expect(page.locator('#home-tile-hl-order')).toBeHidden();
  await expect(page.locator('#drawer-hl-order-btn')).toBeHidden();
  expect(await page.evaluate(() => window.eval('canAccessView("hl-order")'))).toBe(false);
  await page.evaluate(() => window.eval('switchView("hl-order")'));
  await expect(page.locator('#view-hl-order')).toBeHidden();
  expect(fixture.commands).toHaveLength(0); expect(fixture.pdfRequests).toHaveLength(0);
  assertIsolated(fixture);
});
