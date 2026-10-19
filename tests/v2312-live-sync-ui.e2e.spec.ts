import { expect, test } from '@playwright/test';
import { installHlOrderFixture } from './fixtures/hl-order-state.mjs';
// @test-group: @v2312-ui

const currentStages = ['drive', 'pikes_orders', 'stine_lumber_orders', 'soc', 'reserves', 'customer_rep_map', 'warehouse_assigned_items', 'cav', 'transactions_keyed', 'hl_po_parsed'];

test('manual sync status displays a failed stage and advances through the ten-stage queue', { tag: ['@v2312-ui'] }, async ({ page, baseURL }) => {
  const fixture = await installHlOrderFixture(page, baseURL!, { username: 'dylan_collyge', role: 'ADMIN' });
  const state = await page.evaluate(stages => window.eval(`(() => {
    const now = new Date().toISOString();
    manualSyncStatusState = {
      active: true, runId: 'synthetic-v2312-run', source: 'manual',
      stageOrder: ${JSON.stringify(stages)}, stageIndex: 1,
      currentStage: 'pikes_orders', currentStageLabel: 'Pikes Orders',
      stageResults: [{ key: 'drive', outcome: 'failed', errorCode: 'DRIVE_SOURCE_FAILED', message: 'Drive Around source failed; continuing.' }],
      startedAt: now, updatedAt: now, message: 'Continuing with the next stage.', error: '', errorCode: ''
    };
    syncGoogleScriptButton();
    return { progress: getManualSyncProgressInfo(), result: manualSyncStatusState.stageResults[0] };
  })()`), currentStages);
  expect(state.progress).toMatchObject({ completed: 1, total: 10, displayCompleted: 2, text: '2/10' });
  expect(state.result).toMatchObject({ key: 'drive', outcome: 'failed', errorCode: 'DRIVE_SOURCE_FAILED' });
  await expect(page.locator('#run-google-script-btn [data-run-script-label]')).toHaveText('Sync 2/10');
  expect(fixture.blockedMutations).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test('drawer logout does not flash empty-credential validation, while a deliberate empty login still validates', { tag: ['@v2312-ui'] }, async ({ page, baseURL }) => {
  const fixture = await installHlOrderFixture(page, baseURL!, { username: 'dylan_collyge', role: 'ADMIN' });
  await page.locator('#footer-menu-btn').click();
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.locator('#drawer-logout-btn').click(),
  ]);
  await expect(page.locator('#view-login')).toBeVisible();
  await expect(page.locator('#toast-notification')).not.toContainText('Please enter username and password');
  await page.locator('#login-button').click();
  await expect(page.locator('#toast-notification')).toContainText('Please enter username and password');
  expect(fixture.blockedMutations).toEqual([]);
  expect(fixture.errors).toEqual([]);
});
