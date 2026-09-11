// September 9 behavior coverage; see docs/rollback-sep09-validation.md.
import { expect, test } from '@playwright/test';

test('Reclass Send as Review uses the searchable multi-evaluator Eval roster on phones', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=V2026.08.31.05', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).chooseEvalWorkAssignee === 'function');

  await page.evaluate(() => window.eval(`(() => {
    currentUser = 'dylan_collyge';
    currentUserDisplay = 'Dylan Collyge';
    assignableAppUsersLoaded = true;
    evalWorkSetupState = { assigneeUsernames: [], instructions: '', completionRecipients: [] };
    argosInventoryTransactionState = {
      snapshot: { commonName: 'Synthetic Review Item', itemCode: 'TEST.001', contSize: '#3', uniqueId: 'review-origin', locationCode: 'A.01.001', lotCode: '27.F1' },
      item: { UNIQUE_ID: 'review-origin', ITEMCODE: 'TEST.001', COMMONNAME: 'Synthetic Review Item', CONTSIZE: '#3', LOCATIONCODE: 'A.01.001', LOTCODE: '27.F1' }
    };
    const modal = ensureEvalWorkSetupModal();
    modal.classList.remove('hidden');
    syncEvalWorkSetupSummary();
  })()`));

  await page.locator('#eval-work-setup-assignee-button').click();
  const picker = page.locator('#grouped-bloom-ncr-recipient-modal');
  await expect(picker).toBeVisible();
  await expect(page.locator('#grouped-bloom-ncr-recipient-title')).toHaveText('Select Evaluator');
  await expect(page.locator('#grouped-bloom-ncr-recipient-send-btn')).toHaveText('Use Evaluators');
  await expect(page.locator('#grouped-bloom-ncr-recipient-bulk-actions')).toBeVisible();

  await page.locator('#grouped-bloom-ncr-recipient-search').fill('Kayla');
  const evaluator = page.locator('#grouped-bloom-ncr-recipient-list button', { hasText: 'kayla_knepp' });
  await expect(evaluator).toBeVisible();
  await evaluator.click();
  await expect(evaluator).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#grouped-bloom-ncr-recipient-search').fill('JD Jones');
  const honoraryEvaluator = page.locator('#grouped-bloom-ncr-recipient-list button', { hasText: 'jd_jones' });
  await expect(honoraryEvaluator).toBeVisible();
  await honoraryEvaluator.click();
  await expect(honoraryEvaluator).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#grouped-bloom-ncr-recipient-send-btn').click();

  await expect(picker).toBeHidden();
  await expect(page.locator('#eval-work-setup-assignee-copy')).toContainText('kayla_knepp');
  const result = await page.evaluate(() => window.eval(`({
    assignees: getEvalWorkSetupAssignees().map((entry) => entry.username),
    pickerZ: Number.parseInt(getComputedStyle(document.getElementById('grouped-bloom-ncr-recipient-modal')).zIndex || '0', 10),
    setupZ: Number.parseInt(getComputedStyle(document.getElementById('eval-work-setup-modal')).zIndex || '0', 10)
  })`));
  expect([...result.assignees].sort()).toEqual(['jd_jones', 'kayla_knepp']);
  expect(result.pickerZ).toBeGreaterThan(result.setupZ);
});

test('Eval assignment dropdown exposes the full managed roster and composite key', async ({ page }) => {
  await page.goto('/?e2e=V2026.08.20.10', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).getManagerEvalAssigneeOptionsHtml === 'function');
  const result = await page.evaluate(() => {
    const select = document.createElement('select');
    select.innerHTML = (window as any).getManagerEvalAssigneeOptionsHtml('');
    return {
      values: Array.from(select.options).map((option) => option.value),
      labels: Array.from(select.options).map((option) => option.textContent),
      key: (window as any).buildManagerEvalAssignmentKey(' 001668.030.1 ', ' Buddleia '),
      alias: (window as any).normalizeEvalAssignableUser('charey_robertson'),
      sheetTypoAlias: (window as any).normalizeEvalAssignableUser('Boby'),
    };
  });
  expect(result.values).toEqual([
    '',
    'josh_vann',
    'jorge_colunga',
    'abigail_vazquez',
    'bobby_adair',
    'charley_robertson',
    'ellen_ward',
    'zoe_green',
    'mitch_kaiser',
    'dylan_collyge',
    'megan_kelly',
    'kayla_knepp',
    'jd_jones',
  ]);
  expect(result.labels).toEqual(result.values.map((value) => value || 'Unassigned'));
  expect(result.key).toBe('001668.030.1|buddleia');
  expect(result.alias).toBe('charley_robertson');
  expect(result.sheetTypoAlias).toBe('bobby_adair');
});

test('Phone Drive Reclass skips the recipient picker and strips browser recipient fields', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=V2026.08.27.07', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    typeof (window as any).applyArgosInventoryTransactionEmailRecipients === 'function'
  ));
  await page.evaluate(() => {
    (window as any).__reclassRecipientPromise = (window as any).applyArgosInventoryTransactionEmailRecipients({
      actor: { username: 'forged_user', email: 'forged@example.com' },
      recipientEmails: ['forged@example.com'],
      emailRecipients: ['forged@example.com'],
      sourceContext: { sourceMode: 'drive' },
    });
  });
  const payload = await page.evaluate(async () => (window as any).__reclassRecipientPromise);
  await expect(page.locator('#grouped-bloom-ncr-recipient-modal')).toBeHidden();
  expect(payload.actor).toBeUndefined();
  expect(payload.recipientEmails).toBeUndefined();
  expect(payload.emailRecipients).toBeUndefined();
});
