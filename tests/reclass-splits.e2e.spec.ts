import { expect, test, type Page } from '@playwright/test';
import { installDriveCardLayoutFixture, renderDriveLayoutCard, settleDriveLayoutShell } from './fixtures/drive-card-layout';

// The real editor/submit handlers run against intercepted requests. Unknown
// writes remain rejected by the existing fixture; no real inventory/email is used.
async function fixture(page: Page, baseURL: string, project: string) {
  const control = await installDriveCardLayoutFixture(page, baseURL);
  await settleDriveLayoutShell(page, project);
  const calls: any[] = [];
  let rejectNext = false;
  let deliveryStatus = 'queued';
  await page.route('**/functions/v1/app-api', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    if (body.action !== 'drive_reclass_inquiry') return route.fallback();
    const reply = (payload: unknown) => route.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': new URL(baseURL).origin, 'access-control-allow-credentials': 'true' }, body: JSON.stringify(payload) });
    if (body.operation === 'create') {
      calls.push(structuredClone(body));
      if (rejectNext) { rejectNext = false; return reply({ ok: false, error: 'Synthetic queue failure; your draft is retained.' }); }
      return reply({ ok: true, status: 'queued', jobId: 'synthetic-reclass', queuedAt: new Date().toISOString() });
    }
    if (body.operation === 'status') return reply({ ok: true, status: deliveryStatus, jobId: 'synthetic-reclass' });
    return route.fallback();
  });
  const mount = async () => {
    await renderDriveLayoutCard(page, { theme: 'light', knownQuantities: true });
    await page.evaluate(() => window.eval(`(() => {
      fullInventory[0].PTRONHAND = 25; fullInventory[0].SEASON = 'F1'; fullInventory[0].SALEYEAR = '27';
      rebuildMasterInventoryIndexes();
    })()`));
  };
  await mount();
  const open = async () => {
    await page.locator('#drive-content .app-drive-card-reclass .app-card-bottom-btn').click();
    await expect(page.locator('#argos-inventory-transaction-modal')).toBeVisible();
    const row = page.locator('[data-reclass-row-card="drive-layout-synthetic-1-no-photo"]');
    if (await row.locator('.argos-reclass-row-toggle').getAttribute('aria-expanded') !== 'true') await row.locator('.argos-reclass-row-toggle').click();
    return row;
  };
  return { control, calls, open, mount, failNext: () => { rejectNext = true; }, conflict: () => { deliveryStatus = 'conflict'; } };
}

async function populate(page: Page) {
  const row = page.locator('[data-reclass-row-card="drive-layout-synthetic-1-no-photo"]');
  await row.locator('[data-reclass-v3-action="move_up"]').click();
  const move = row.locator('[data-reclass-move-action="move_up"]');
  await move.getByLabel('Move Up quantity 1', { exact: true }).fill('15');
  await move.getByLabel('Move Up destination 1', { exact: true }).selectOption('X');
  for (const [index, season] of [[2, 'S1'], [3, 'U1']] as const) {
    await move.getByRole('button', { name: 'Add destination', exact: true }).click();
    await move.getByLabel(`Move Up quantity ${index}`, { exact: true }).fill('5');
    await move.getByLabel(`Move Up destination ${index}`, { exact: true }).selectOption(season);
  }
  return { row, move };
}

test('split move holds require a reason and failed submissions retain all destinations', async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name); await f.open();
  const { move } = await populate(page);
  await expect(move.locator('[data-reclass-move-balance]')).toContainText('Remaining: 0');
  await move.getByLabel('Place moved quantities On Hold', { exact: true }).check();
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#toast-notification')).toContainText('Hold reason');
  expect(f.calls).toHaveLength(0);
  await move.getByLabel('Move Up Hold reason', { exact: true }).fill('Quality Review');
  f.failNext(); await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#toast-notification')).toContainText('Synthetic queue failure');
  await expect(move.getByLabel('Move Up quantity 1', { exact: true })).toHaveValue('15');
  await expect(move.getByLabel('Move Up destination 3', { exact: true })).toHaveValue('U1');
  await expect(move.getByLabel('Move Up Hold reason', { exact: true })).toHaveValue('Quality Review');
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeHidden();
  expect(f.calls).toHaveLength(2);
  expect(f.calls[1].idempotencyToken).toBe(f.calls[0].idempotencyToken);
  expect(f.calls[1].workflowPolicyVersion).toBe('reclass-action-workflow-v4-split-moves-20261006');
  expect(f.calls[1].transaction.holdStopProposals).toEqual([]);
  expect(f.calls[1].rowOverlays[0].proposals).toEqual([{ action: 'move_up', splits: [
    { quantity: 15, destinationSeason: 'X' }, { quantity: 5, destinationSeason: 'S1' }, { quantity: 5, destinationSeason: 'U1' },
  ], applyHold: true, holdReason: 'quality review' }]);
  expect(await page.evaluate(() => window.eval(`({oh:fullInventory[0].PTRONHAND,season:fullInventory[0].SEASON,hold:fullInventory[0].HOLDSTOPCODE})`)))
    .toEqual({ oh: 25, season: 'F1', hold: '' });
  expect(f.control.blockedMutations).toEqual([]);
});

test('both directions share the OH cap and split controls fit mobile widths', async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name); await f.open();
  const { row, move } = await populate(page);
  await move.getByRole('button', { name: 'Remove Move Up destination 2', exact: true }).click();
  await expect(move.getByLabel('Move Up destination 2', { exact: true })).toHaveValue('U1');
  await row.locator('[data-reclass-v3-action="move_down"]').click();
  const down = row.locator('[data-reclass-move-action="move_down"]');
  await down.getByLabel('Move Down quantity 1', { exact: true }).fill('6');
  await down.getByLabel('Move Down destination 1', { exact: true }).selectOption('Y');
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#toast-notification')).toContainText('cannot exceed original OH');
  expect(f.calls).toHaveLength(0);
  await down.getByLabel('Move Down quantity 1', { exact: true }).fill('5');
  const bounds = await row.evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth,
    smallButtons: [...element.querySelectorAll('[data-reclass-move-action] button')].filter(button => button.getBoundingClientRect().height < 44).length }));
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1); expect(bounds.smallButtons).toBe(0);
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeHidden();
  expect(f.calls[0].rowOverlays[0].proposals).toHaveLength(2);
  expect(f.control.blockedMutations).toEqual([]);
});

test('refresh and Review and Resend restore every split and hold instruction', async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name); await f.open();
  const { move } = await populate(page);
  await move.getByLabel('Place moved quantities On Hold', { exact: true }).check();
  await move.getByLabel('Move Up Hold reason', { exact: true }).fill('Keep for review');
  f.conflict(); await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Review and Resend', exact: true })).toBeVisible();
  const token = f.calls[0].idempotencyToken;
  await page.reload(); await page.locator('#view-login').waitFor({ state: 'hidden' }); await f.mount();
  await page.getByRole('button', { name: 'Review and Resend', exact: true }).click();
  const row = page.locator('[data-reclass-row-card="drive-layout-synthetic-1-no-photo"]');
  if (await row.locator('.argos-reclass-row-toggle').getAttribute('aria-expanded') !== 'true') await row.locator('.argos-reclass-row-toggle').click();
  const restored = row.locator('[data-reclass-move-action="move_up"]');
  await expect(restored.getByLabel('Move Up quantity 3', { exact: true })).toHaveValue('5');
  await expect(restored.getByLabel('Move Up destination 3', { exact: true })).toHaveValue('U1');
  await expect(restored.getByLabel('Place moved quantities On Hold', { exact: true })).toBeChecked();
  await expect(restored.getByLabel('Move Up Hold reason', { exact: true })).toHaveValue('keep for review');
  expect(await page.evaluate(() => window.eval('argosInventoryTransactionState.idempotencyToken'))).not.toBe(token);
  expect(f.control.blockedMutations).toEqual([]);
});
