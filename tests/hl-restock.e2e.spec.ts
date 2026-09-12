import { expect, test, type Page } from '@playwright/test';
import { installHlOrderFixture, hlMaster } from './fixtures/hl-order-state.mjs';

const stock = (changes = {}) => ({ itemcode: 'SYNTH.003', size: '#3', commonname: 'Synthetic HL Holly',
  po_ordered: 100, target: 30, available: 12, status: 'ready', receipt_watermark: null, can_confirm_inventory: false,
  po_balance: { status: 'ready', remaining: 100, imported: 100, receipt_adjustment: 0 }, ...changes });
const setup = (changes = {}) => ({ rows: [], poMembership: ['SYNTH.003'],
  poBalances: [{ itemcode: 'SYNTH.003', size: '#3', remaining: 100, imported: 100, status: 'ready' }],
  restockItems: [stock()], master: [hlMaster('stock-a', { ptravailable: '12' }), hlMaster('stock-zero', { locationcode: 'C.14.001', ptravailable: '0' }),
    hlMaster('old-season', { lotcode: '26.F1', ptravailable: '80' })], ...changes });
const item = (page: Page) => page.locator('[data-hl-restock-item="SYNTH.003|#3"]');
async function openRestock(page: Page) {
  await expect(page.locator('#view-login')).toBeHidden();
  await page.locator('#home-tile-hl-order').click();
  await page.locator('[data-hl-tab="restocking"]').click();
  await expect(page.locator('#hl-restock-content')).toBeVisible();
}
async function saveRestock(page: Page, quantity = '10') {
  await page.locator('#hl-restock-ship-date').fill('2026-09-15');
  await item(page).locator('[data-hl-restock-quantity]').fill(quantity);
  await item(page).locator('[data-hl-restock-save]').click();
}
const isolated = (fixture: any) => { expect(fixture.errors).toEqual([]); expect(fixture.blockedMutations).toEqual([]); };

test.beforeEach(async ({ page }) => { await page.addInitScript(() => { Reflect.deleteProperty(window, 'PushManager'); }); });

test('Restocking loads on demand without SOC demand and shows verified server quantities', async ({ page, baseURL }) => {
  const fixture = await installHlOrderFixture(page, baseURL!, setup({ restockItems: [stock(), stock({ itemcode: 'UNKNOWN', available: null, status: 'unknown' })] }));
  expect(fixture.restockReads).toBe(0);
  await openRestock(page);
  await expect(item(page)).toContainText('Synthetic HL Holly');
  await expect(item(page).locator('[data-hl-restock-quantity]')).toHaveValue('18');
  await expect(page.locator('[data-hl-restock-item="UNKNOWN|#3"]')).toContainText(/unknown|review/i);
  await expect(page.locator('[data-hl-restock-item="UNKNOWN|#3"] [data-hl-restock-save]')).toBeDisabled();
  expect(fixture.commands).toHaveLength(0);
  isolated(fixture);
});

test('a partial restocking draft persists after reload and sends the selected snapshot and ship date', async ({ page, baseURL }) => {
  const fixture = await installHlOrderFixture(page, baseURL!, setup());
  await openRestock(page); await saveRestock(page);
  await expect.poll(() => fixture.state.draft.length).toBe(1);
  const command = fixture.commands.find((entry: any) => entry.p_action === 'restock_draft_save');
  expect(command.p_payload).toMatchObject({ ship_date: '2026-09-15', rows: [{ itemcode: 'SYNTH.003', size: '#3', quantity: 10 }], inventory_snapshot: fixture.inventorySnapshot });
  expect(fixture.state.actionable_rows).toHaveLength(0);
  await page.evaluate(async () => { const coordinator = window.eval('productionLiveSyncCoordinator'); if (coordinator) { await coordinator.check('fixture-reload'); coordinator.suspend(); } });
  await fixture.waitForRevisionIdle(); await page.reload({ waitUntil: 'load' });
  await expect(page.locator('#view-login')).toBeHidden();
  if (!(await page.locator('#global-action-bar').isVisible())) await page.getByRole('button', { name: 'Bloom Picker', exact: true }).click();
  const saved = page.locator('[data-hl-draft-source-id]').first();
  await saved.locator('[data-hl-draft-quantity]').fill('6');
  await saved.getByRole('button', { name: 'Save quantity', exact: true }).click();
  await expect.poll(() => fixture.state.draft[0]?.quantity).toBe(6);
  if (await page.locator('#global-action-bar').isVisible()) await page.getByRole('button', { name: 'Bloom Picker', exact: true }).click();
  await openRestock(page);
  await expect(item(page)).toContainText(/6/);
  expect(fixture.state.draft[0].quantity).toBe(6);
  expect(fixture.state.draft[0].source.source_kind).toBe('restock'); isolated(fixture);
});

test('same-date restocking previews additions under the existing HL number', async ({ page, baseURL }) => {
  const options: any = setup({ seedOrder: true }); delete options.rows;
  const fixture = await installHlOrderFixture(page, baseURL!, options);
  const orderNumber = fixture.state.orders[0].order_number;
  await openRestock(page); await saveRestock(page, '5');
  await expect.poll(() => fixture.state.draft.length).toBe(1);
  await page.getByRole('button', { name: 'Bloom Picker', exact: true }).click();
  await page.locator('#bloom-picker-actions-toggle').click();
  await page.locator('#batch-btn-hl-tags').click();
  await expect(page.locator('#hl-tags-preview')).toBeVisible();
  const report: any = [...fixture.previews.values()].at(-1)?.report;
  expect(report).toMatchObject({ contract_version: 'hl-order-report-v3', kind: 'addition', order_number: orderNumber, total_quantity: 5 });
  expect(report.lines).toHaveLength(1); expect(report.lines[0].source_kind).toBe('restock');
  await expect(page.locator('#hl-tags-preview-content')).toContainText(/restocking/i); isolated(fixture);
});

test('received restocking stays paused until explicit confirmation of the updated inventory', async ({ page, baseURL }) => {
  const fixture = await installHlOrderFixture(page, baseURL!, setup({ restockItems: [stock({ status: 'receipt_pending', can_confirm_inventory: true,
    receipt_watermark: 'receipt-1', receipts: [{ id: 'receipt-1', quantity_delta: 5, received_quantity: 5, created_at: '2026-09-12T11:00:00Z' }] })] }));
  await openRestock(page);
  await expect(item(page)).toContainText(/awaiting inventory/i);
  await expect(item(page).locator('[data-hl-restock-save]')).toBeDisabled();
  await item(page).getByRole('button', { name: 'Confirm inventory updated', exact: true }).click();
  await expect(page.locator('#hl-restock-confirm-dialog')).toBeVisible();
  expect(fixture.commands).toHaveLength(0);
  await page.locator('#hl-restock-confirm-dialog').getByRole('button', { name: 'Confirm inventory updated', exact: true }).click();
  await expect.poll(() => fixture.commands.filter((entry: any) => entry.p_action === 'restock_inventory_confirm').length).toBe(1);
  expect(fixture.commands.at(-1).p_payload).toMatchObject({ itemcode: 'SYNTH.003', size: '#3', receipt_watermark: 'receipt-1', inventory_snapshot: fixture.inventorySnapshot });
  isolated(fixture);
});

test('other administrators cannot load or order restocking', async ({ page, baseURL }) => {
  const fixture = await installHlOrderFixture(page, baseURL!, setup({ username: 'jd_jones' }));
  await expect(page.locator('#home-tile-hl-order')).toBeHidden();
  await page.evaluate(() => window.eval('switchView("hl-order")'));
  await expect(page.locator('#view-hl-order')).toBeHidden();
  expect(fixture.restockReads).toBe(0); expect(fixture.commands).toHaveLength(0); isolated(fixture);
});
