import { expect, test, type Page } from '@playwright/test';

import { renderDriveLayoutCard, restoreDriveLayoutRenderer, settleDriveLayoutShell } from './fixtures/drive-card-layout';
import { hlMaster, installHlOrderFixture } from './fixtures/hl-order-state.mjs';
// @test-group: @reclass-splits

const DRIVE_EVIDENCE_KEYS = [
  'unique_id', 'itemcode', 'locationcode', 'lotcode', 'last_updated', 'photo_link', 'photo_name', 'match', 'spec', 'caliper', 'initial_ptr', 'loc_match_qty',
  'ptravailable', 'av_note', 'pic_note', 'sales_note', 'date_completed', 'app_tab_assignment', 'av_rule_av_note_updated_at', 'av_rule_bundle_updated_at',
  'av_rule_caliper_updated_at', 'av_rule_holdstop_snapshot', 'av_rule_last_clear_reason', 'av_rule_last_cleared_at', 'av_rule_match_updated_at',
  'av_rule_photo_updated_at', 'av_rule_priority_snapshot', 'av_rule_spec_updated_at',
];

function confirmedEvidence(uid: string, lastUpdated: string) {
  return Object.assign(Object.fromEntries(DRIVE_EVIDENCE_KEYS.map(key => [key, null])), {
    unique_id: uid, itemcode: 'LAYOUT.001-NO-PHOTO', locationcode: 'A.01.001', lotcode: '27.F1', last_updated: lastUpdated,
    ptravailable: '13', av_rule_last_clear_reason: 'priority_hold_edit', av_rule_last_cleared_at: lastUpdated,
  });
}


// The real editor/submit handlers run against intercepted requests. Unknown
// writes remain rejected by the existing fixture; no real inventory/email is used.
async function fixture(page: Page, baseURL: string, project: string) {
  // The backend fixture must return the same row as the mounted Drive card.
  // Background inventory hydration can replace manually mounted rows.
  const control = await installHlOrderFixture(page, baseURL, { role: 'ADMIN', username: 'dylan_collyge',
    master: [hlMaster('drive-layout-synthetic-1-no-photo', { itemcode: 'LAYOUT.001-NO-PHOTO',
      commonname: 'Synthetic Drive Card', contsize: '#3', locationcode: 'A.01.001', lotcode: '27.F1',
      ptronhand: '25', ptrreviewed: '2', ptravailable: '13', priority: '2', holdstopcode: '',
      photo_link: 'https://example.test/old.jpg', photo_name: 'old.jpg', spec: 'old spec', caliper: 'old caliper',
      match: 'old match', av_note: 'old AV note', pic_note: 'old pick', sales_note: 'old sales', last_updated: '2026-10-08T12:00:00Z' })],
  });
  await settleDriveLayoutShell(page, project);
  const calls: any[] = [];
  let rejectNext = false;
  let deliveryStatus = 'queued';
  let createReply: ((body: Record<string, any>) => unknown) | null = null;
  await page.route('**/functions/v1/app-api', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    if (body.action !== 'drive_reclass_inquiry') return route.fallback();
    const reply = (payload: unknown) => route.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': new URL(baseURL).origin, 'access-control-allow-credentials': 'true' }, body: JSON.stringify(payload) });
    if (body.operation === 'create') {
      calls.push(structuredClone(body));
      if (rejectNext) { rejectNext = false; return reply({ ok: false, error: 'Synthetic queue failure; your draft is retained.' }); }
      if (createReply) return reply(createReply(body) as Record<string, unknown>);
      return reply({ ok: true, status: 'queued', jobId: 'synthetic-reclass', queuedAt: new Date().toISOString() });
    }
    if (body.operation === 'status') return reply({ ok: true, status: deliveryStatus, jobId: 'synthetic-reclass' });
    return route.fallback();
  });
  const mount = async () => {
    await renderDriveLayoutCard(page, { theme: 'light', knownQuantities: true });
    await page.evaluate(() => window.eval(`(() => {
      fullInventory[0].PTRONHAND = 25; fullInventory[0].SEASON = 'F1'; fullInventory[0].SALEYEAR = '27';
      fullInventory[0].LAST_UPDATED = '2026-10-08T12:00:00Z'; fullInventory[0].last_updated = '2026-10-08T12:00:00Z';
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
  return { control, calls, open, mount, failNext: () => { rejectNext = true; }, conflict: () => { deliveryStatus = 'conflict'; }, setCreateReply: (replyFactory: (body: Record<string, any>) => unknown) => { createReply = replyFactory; } };
}

async function populate(page: Page, action: 'move_up' | 'move_down' = 'move_up') {
  const row = page.locator('[data-reclass-row-card="drive-layout-synthetic-1-no-photo"]');
  const label = action === 'move_up' ? 'Move Up' : 'Move Down';
  await row.locator(`[data-reclass-v3-action="${action}"]`).click();
  const move = row.locator(`[data-reclass-move-action="${action}"]`);
  await move.getByLabel(`${label} quantity 1`, { exact: true }).fill('15');
  await move.getByLabel(`${label} destination 1`, { exact: true }).selectOption('X');
  for (const [index, season] of [[2, 'S1'], [3, 'U1']] as const) {
    await move.getByRole('button', { name: 'Add destination', exact: true }).click();
    await move.getByLabel(`${label} quantity ${index}`, { exact: true }).fill('5');
    await move.getByLabel(`${label} destination ${index}`, { exact: true }).selectOption(season);
  }
  return { row, move };
}

async function populatePriorityAndHold(page: Page) {
  const row = page.locator('[data-reclass-row-card="drive-layout-synthetic-1-no-photo"]');
  await row.locator('[data-reclass-v3-action="priority_change"]').click();
  await row.locator('[data-reclass-v3-proposal-action="priority_change"][data-reclass-v3-proposal-field="priority"]').fill('1');
  await row.locator('[data-reclass-v3-action="hold"]').click();
  await row.locator('[data-reclass-v3-proposal-action="hold"][data-reclass-v3-proposal-field="reason"]').fill('Quality Review');
  return row;
}

function confirmedLiveEditResponse(priority = '1') {
  return {
    ok: true, status: 'queued', jobId: 'synthetic-reclass-live', queuedAt: '2026-10-09T12:01:00Z',
    inventoryRevision: '501',
    liveEdits: [{ unique_id: 'drive-layout-synthetic-1-no-photo', priority, holdstopcode: 'H', holdstopreason: 'quality review',
      av_rule_last_clear_reason: 'priority_hold_edit', av_rule_last_cleared_at: '2026-10-09T12:01:00Z', last_updated: '2026-10-09T12:01:00Z',
      evidence: confirmedEvidence('drive-layout-synthetic-1-no-photo', '2026-10-09T12:01:00Z') }],
  };
}

function confirmedPriorityResponse(priority = '1') {
  return {
    ok: true, status: 'queued', jobId: 'synthetic-reclass-live', queuedAt: '2026-10-09T12:01:00Z',
    inventoryRevision: '502',
    liveEdits: [{ unique_id: 'drive-layout-synthetic-1-no-photo', priority, holdstopcode: null, holdstopreason: null,
      av_rule_last_clear_reason: 'priority_changed', av_rule_last_cleared_at: '2026-10-09T12:01:00Z', last_updated: '2026-10-09T12:01:00Z',
      evidence: { ...confirmedEvidence('drive-layout-synthetic-1-no-photo', '2026-10-09T12:01:00Z'), av_rule_last_clear_reason: 'priority_changed' } }],
  };
}

test('Move Down hold requires a reason and failed submissions retain all destinations', {"tag":["@reclass-splits"]}, async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name); await f.open();
  const { move } = await populate(page, 'move_down');
  await expect(move.locator('[data-reclass-move-balance]')).toContainText('Remaining: 0');
  await move.getByLabel('Place moved quantities On Hold', { exact: true }).check();
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#toast-notification')).toContainText('Hold reason');
  expect(f.calls).toHaveLength(0);
  await move.getByLabel('Move Down Hold reason', { exact: true }).fill('Quality Review');
  f.failNext(); await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#toast-notification')).toContainText('Synthetic queue failure');
  await expect(move.getByLabel('Move Down quantity 1', { exact: true })).toHaveValue('15');
  await expect(move.getByLabel('Move Down destination 3', { exact: true })).toHaveValue('U1');
  await expect(move.getByLabel('Move Down Hold reason', { exact: true })).toHaveValue('Quality Review');
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeHidden();
  expect(f.calls).toHaveLength(2);
  expect(f.calls[1].idempotencyToken).toBe(f.calls[0].idempotencyToken);
  expect(f.calls[1].workflowPolicyVersion).toBe('reclass-action-workflow-v4-split-moves-20261006');
  expect(f.calls[1].transaction.holdStopProposals).toEqual([]);
  expect(f.calls[1].rowOverlays[0].proposals).toEqual([{ action: 'move_down', splits: [
    { quantity: 15, destinationSeason: 'X' }, { quantity: 5, destinationSeason: 'S1' }, { quantity: 5, destinationSeason: 'U1' },
  ], applyHold: true, holdReason: 'quality review' }]);
  expect(await page.evaluate(() => window.eval(`({oh:Number(fullInventory[0].PTRONHAND),season:fullInventory[0].SEASON,hold:fullInventory[0].HOLDSTOPCODE})`)))
    .toEqual({ oh: 25, season: 'F1', hold: '' });
  expect(f.control.blockedMutations).toEqual([]);
});

test('V6 confirms priority and Hold locally only after the server returns the live edit, then queues the inquiry', {"tag":["@reclass-splits"]}, async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name); await f.open();
  await populatePriorityAndHold(page);
  f.setCreateReply(() => {
    Object.assign(f.control.master[0], { priority: '1', holdstopcode: 'H', holdstopreason: 'quality review',
      av_rule_last_clear_reason: 'priority_hold_edit', av_rule_last_cleared_at: '2026-10-09T12:01:00Z', last_updated: '2026-10-09T12:01:00Z' });
    return confirmedLiveEditResponse();
  });
  await restoreDriveLayoutRenderer(page);
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeHidden();
  await expect(page.locator('#toast-notification')).toContainText('Live edits are confirmed');
  expect(f.calls).toHaveLength(1);
  const sent = f.calls[0];
  expect(sent.workflowPolicyVersion).toBe('reclass-action-workflow-v6-smart-shield-20261009');
  expect(sent.transaction.requestActions).toEqual(expect.arrayContaining(['priority_change', 'hold']));
  expect(sent.transaction.holdStopProposals).toEqual([{ action: 'hold', reason: 'quality review', sourceUid: 'drive-layout-synthetic-1-no-photo' }]);
  expect(sent.rowOverlays[0].expected).toMatchObject({ priority: '2', holdstopcode: '', holdstopreason: '' });
  expect(sent.rowOverlays[0].proposals).toEqual(expect.arrayContaining([
    expect.objectContaining({ action: 'priority_change', priority: '1' }),
  ]));
  const state = await page.evaluate(() => window.eval(`(() => {
    const uid = 'drive-layout-synthetic-1-no-photo';
    const master = fullInventory.find(row => String(row.UNIQUE_ID || row.unique_id) === uid);
    const av = avOpenInventory.find(row => String(row.UNIQUE_ID || row.unique_id) === uid);
    return { master: [master?.PRIORITY, master?.HOLDSTOPCODE, master?.HOLDSTOPREASON],
      av: [av?.PRIORITY, av?.HOLDSTOPCODE, av?.HOLDSTOPREASON],
      evidence: [master?.PHOTO_LINK, master?.SAVED_PHOTO_LINK, master?.SPEC, master?.CALIPER, master?.MATCH, master?.AV_NOTE, master?.PIC_NOTE, master?.SALES_NOTE] };
  })()`));
  expect(state.master).toEqual(['1', 'H', 'quality review']);
  expect(state.av).toEqual(['1', 'H', 'quality review']);
  expect(state.evidence).toEqual(['', '', null, null, null, null, null, null]);
  await page.locator('#drive-content [aria-label="Open Synthetic Drive Card"]').click();
  await page.locator('#drive-content [aria-label="Open #3"]').click();
  await page.locator('#drive-content [aria-label="Open season F1"]').click();
  await expect(page.locator('#drive-content .app-drive-compact-card')).toContainText('quality review');
  const queued = await page.evaluate(() => JSON.parse(localStorage.getItem('gnc_reclass_delivery_jobs_v1') || '[]'));
  expect(queued).toHaveLength(1);
  expect(queued[0].payload.workflowPolicyVersion).toBe('reclass-action-workflow-v6-smart-shield-20261009');
  expect(f.control.blockedMutations).toEqual([]);
});

test('rejected and stale V6 replies do not overwrite local inventory or discard the inquiry draft', {"tag":["@reclass-splits"]}, async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name); await f.open();
  const row = await populatePriorityAndHold(page);
  f.failNext(); await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#toast-notification')).toContainText('Synthetic queue failure');
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeVisible();
  await expect(row.locator('[data-reclass-v3-proposal-action="priority_change"][data-reclass-v3-proposal-field="priority"]')).toHaveValue('1');
  await expect(row.locator('[data-reclass-v3-proposal-action="hold"][data-reclass-v3-proposal-field="reason"]')).toHaveValue('quality review');
  const beforeStale = await page.evaluate(() => window.eval(`(() => ({ priority: fullInventory[0].PRIORITY, hold: fullInventory[0].HOLDSTOPCODE, reason: fullInventory[0].HOLDSTOPREASON }))()`));

  await page.evaluate(() => window.eval(`getDatasetState('master').liveVerifiedRevision = '900'`));
  f.setCreateReply(() => confirmedLiveEditResponse());
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeHidden();
  await expect(page.locator('#toast-notification')).toContainText('needs a refresh before it can be confirmed');
  const afterStale = await page.evaluate(() => window.eval(`(() => ({ priority: fullInventory[0].PRIORITY, hold: fullInventory[0].HOLDSTOPCODE, reason: fullInventory[0].HOLDSTOPREASON }))()`));
  expect(afterStale).toEqual(beforeStale);
  const queued = await page.evaluate(() => JSON.parse(localStorage.getItem('gnc_reclass_delivery_jobs_v1') || '[]'));
  expect(queued).toHaveLength(1);
  expect(queued[0].payload.transaction.holdStopProposals).toEqual([{ action: 'hold', reason: 'quality review', sourceUid: 'drive-layout-synthetic-1-no-photo' }]);
  expect(f.control.blockedMutations).toEqual([]);
});

test('Move Up plus Priority submits V6 movement inquiry without any Hold proposal', {"tag":["@reclass-splits"]}, async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name); await f.open();
  const row = page.locator('[data-reclass-row-card="drive-layout-synthetic-1-no-photo"]');
  await row.locator('[data-reclass-v3-action="priority_change"]').click();
  await row.locator('[data-reclass-v3-proposal-action="priority_change"][data-reclass-v3-proposal-field="priority"]').fill('1');
  await row.locator('[data-reclass-v3-action="move_up"]').click();
  const move = row.locator('[data-reclass-move-action="move_up"]');
  await move.getByLabel('Move Up quantity 1', { exact: true }).fill('5');
  await move.getByLabel('Move Up destination 1', { exact: true }).selectOption('X');
  f.setCreateReply(() => confirmedPriorityResponse());
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeHidden();
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0].workflowPolicyVersion).toBe('reclass-action-workflow-v6-smart-shield-20261009');
  expect(f.calls[0].transaction.requestActions).toEqual(expect.arrayContaining(['priority_change', 'move_up']));
  expect(f.calls[0].transaction.holdStopProposals).toEqual([]);
  expect(f.calls[0].rowOverlays[0].proposals).toEqual(expect.arrayContaining([
    expect.objectContaining({ action: 'priority_change', priority: '1' }),
    expect.objectContaining({ action: 'move_up', splits: [{ quantity: 5, destinationSeason: 'X' }] }),
  ]));
  expect(f.control.blockedMutations).toEqual([]);
});

test('both directions share the OH cap and split controls fit mobile widths', {"tag":["@reclass-splits"]}, async ({ page, baseURL }, info) => {
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

test('refresh and Review and Resend restore every Move Down split and hold instruction', {"tag":["@reclass-splits"]}, async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name); await f.open();
  const { move } = await populate(page, 'move_down');
  await move.getByLabel('Place moved quantities On Hold', { exact: true }).check();
  await move.getByLabel('Move Down Hold reason', { exact: true }).fill('Keep for review');
  f.conflict(); await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Review and Resend', exact: true })).toBeVisible();
  const token = f.calls[0].idempotencyToken;
  await page.reload(); await page.locator('#view-login').waitFor({ state: 'hidden' }); await f.mount();
  await page.getByRole('button', { name: 'Review and Resend', exact: true }).click();
  const row = page.locator('[data-reclass-row-card="drive-layout-synthetic-1-no-photo"]');
  if (await row.locator('.argos-reclass-row-toggle').getAttribute('aria-expanded') !== 'true') await row.locator('.argos-reclass-row-toggle').click();
  const restored = row.locator('[data-reclass-move-action="move_down"]');
  await expect(restored.getByLabel('Move Down quantity 3', { exact: true })).toHaveValue('5');
  await expect(restored.getByLabel('Move Down destination 3', { exact: true })).toHaveValue('U1');
  await expect(restored.getByLabel('Place moved quantities On Hold', { exact: true })).toBeChecked();
  await expect(restored.getByLabel('Move Down Hold reason', { exact: true })).toHaveValue('keep for review');
  expect(await page.evaluate(() => window.eval('argosInventoryTransactionState.idempotencyToken'))).not.toBe(token);
  expect(f.control.blockedMutations).toEqual([]);
});
