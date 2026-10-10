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
async function fixture(page: Page, baseURL: string, project: string,
  scope: { season: string; salesYear: string } = { season: 'F1', salesYear: '27' }) {
  const lotcode = `${scope.salesYear}.${scope.season}`;
  // The backend fixture must return the same row as the mounted Drive card.
  // Background inventory hydration can replace manually mounted rows.
  const control = await installHlOrderFixture(page, baseURL, { role: 'ADMIN', username: 'dylan_collyge',
    appPermissions: [{permissionKey:'module.po-management.view',kind:'module',moduleKey:'po-management',allowed:true},{permissionKey:'drive.reclass.submit',kind:'action',moduleKey:'drive',allowed:true}],
    master: [hlMaster('drive-layout-synthetic-1-no-photo', { itemcode: 'LAYOUT.001-NO-PHOTO',
      commonname: 'Synthetic Drive Card', contsize: '#3', locationcode: 'A.01.001', lotcode,
      season: scope.season, saleyear: scope.salesYear,
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
      if (createReply) return reply(await createReply(body));
      return reply({ ok: true, status: 'queued', jobId: 'synthetic-reclass', queuedAt: new Date().toISOString() });
    }
    if (body.operation === 'status') return reply({ ok: true, status: deliveryStatus, jobId: 'synthetic-reclass' });
    return route.fallback();
  });
  const mount = async () => {
    await renderDriveLayoutCard(page, { theme: 'light', knownQuantities: true });
    await page.evaluate(values => window.eval(`(() => {
      fullInventory[0].PTRONHAND = 25;
      fullInventory[0].SEASON = ${JSON.stringify(values.season)};
      fullInventory[0].SALEYEAR = ${JSON.stringify(values.salesYear)};
      fullInventory[0].LOTCODE = ${JSON.stringify(values.lotcode)};
      fullInventory[0].LAST_UPDATED = '2026-10-08T12:00:00Z'; fullInventory[0].last_updated = '2026-10-08T12:00:00Z';
      rebuildMasterInventoryIndexes();
    })()`), { ...scope, lotcode });
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

test('closing a pending inquiry and reopening enables the new draft without stale completion changing it', { tag: ['@reclass-splits'] }, async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name);
  await f.open(); await populate(page);
  let finish!: (result: unknown) => void;
  f.setCreateReply(() => new Promise(resolve => { finish = resolve; }));
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect.poll(() => f.calls.length).toBe(1);
  await expect(page.locator('#argos-inventory-transaction-apply')).toBeDisabled();
  await page.locator('#argos-inventory-transaction-modal').getByRole('button', { name: 'Cancel', exact: true }).click();
  await f.open(); const { move } = await populate(page, 'move_down');
  await expect(page.locator('#argos-inventory-transaction-apply')).toBeEnabled();
  finish({ ok: true, status: 'queued', jobId: 'first-inquiry' });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('gnc_reclass_delivery_jobs_v1') || '[]').length)).toBe(1);
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeVisible();
  await expect(move.getByLabel('Move Down quantity 1', { exact: true })).toHaveValue('15');
  await expect(page.locator('#argos-inventory-transaction-apply')).toBeEnabled();
  f.setCreateReply(() => ({ ok: true, status: 'queued', jobId: 'second-inquiry' }));
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeHidden();
  expect(f.calls).toHaveLength(2);
  expect(f.calls[0].idempotencyToken).not.toBe(f.calls[1].idempotencyToken);
  expect(f.control.blockedMutations).toEqual([]);
});

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
    workflowPolicyVersion: 'reclass-action-workflow-v7-editable-fields-20261009',
    inventoryFields: [],
    inventoryRevision: '501',
    liveEdits: [{ unique_id: 'drive-layout-synthetic-1-no-photo', priority, holdstopcode: 'H', holdstopreason: 'quality review',
      av_rule_last_clear_reason: 'priority_hold_edit', av_rule_last_cleared_at: '2026-10-09T12:01:00Z', last_updated: '2026-10-09T12:01:00Z',
      evidence: confirmedEvidence('drive-layout-synthetic-1-no-photo', '2026-10-09T12:01:00Z') }],
  };
}

function confirmedPriorityResponse(priority = '1') {
  return {
    ok: true, status: 'queued', jobId: 'synthetic-reclass-live', queuedAt: '2026-10-09T12:01:00Z',
    workflowPolicyVersion: 'reclass-action-workflow-v7-editable-fields-20261009',
    inventoryFields: [],
    inventoryRevision: '502',
    liveEdits: [{ unique_id: 'drive-layout-synthetic-1-no-photo', priority, holdstopcode: null, holdstopreason: null,
      av_rule_last_clear_reason: 'priority_changed', av_rule_last_cleared_at: '2026-10-09T12:01:00Z', last_updated: '2026-10-09T12:01:00Z',
      evidence: { ...confirmedEvidence('drive-layout-synthetic-1-no-photo', '2026-10-09T12:01:00Z'), av_rule_last_clear_reason: 'priority_changed' } }],
  };
}

test('Move Down uses the main On Hold action and failed submissions retain all destinations', {"tag":["@reclass-splits"]}, async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name); await f.open();
  const { row, move } = await populate(page, 'move_down');
  await expect(row.locator('[data-reclass-v3-action="hold"]')).toBeVisible();
  await expect(row.locator('[data-reclass-v3-action="take_off_hold"]')).toBeVisible();
  await expect(move.getByRole('checkbox')).toHaveCount(0);
  await expect(move.locator('[data-reclass-move-balance]')).toContainText('Remaining: 0');
  await page.locator('[data-reclass-row-card="drive-layout-synthetic-1-no-photo"] [data-reclass-v3-action="hold"]').click();
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#toast-notification')).toContainText('Hold/Stop Reason');
  expect(f.calls).toHaveLength(0);
  await page.locator('[data-reclass-v3-proposal-action="hold"][data-reclass-v3-proposal-field="reason"]').fill('Quality Review');
  f.setCreateReply(() => confirmedLiveEditResponse('2'));
  f.failNext(); await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#toast-notification')).toContainText('Synthetic queue failure');
  await expect(move.getByLabel('Move Down quantity 1', { exact: true })).toHaveValue('15');
  await expect(move.getByLabel('Move Down destination 3', { exact: true })).toHaveValue('U1');
  await expect(page.locator('[data-reclass-v3-proposal-action="hold"][data-reclass-v3-proposal-field="reason"]')).toHaveValue('quality review');
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeHidden();
  expect(f.calls).toHaveLength(2);
  expect(f.calls[1].idempotencyToken).toBe(f.calls[0].idempotencyToken);
  expect(f.calls[1].workflowPolicyVersion).toBe('reclass-action-workflow-v7-editable-fields-20261009');
  expect(f.calls[1].transaction.holdStopProposals).toEqual([expect.objectContaining({ action: 'hold', reason: 'quality review', sourceUid: 'drive-layout-synthetic-1-no-photo' })]);
  expect(f.calls[1].rowOverlays[0].proposals).toEqual([{ action: 'move_down', splits: [
    { quantity: 15, destinationSeason: 'X' }, { quantity: 5, destinationSeason: 'S1' }, { quantity: 5, destinationSeason: 'U1' },
  ], applyHold: false, holdReason: '' }]);
  expect(await page.evaluate(() => window.eval(`({oh:Number(fullInventory[0].PTRONHAND),season:fullInventory[0].SEASON,hold:fullInventory[0].HOLDSTOPCODE})`)))
    .toEqual({ oh: 25, season: 'F1', hold: 'H' });
  expect(f.control.blockedMutations).toEqual([]);
});

test('V6 confirms priority and Hold locally only after the server returns the live edit, then queues the inquiry', {"tag":["@reclass-splits"]}, async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name); await f.open();
  await populatePriorityAndHold(page);
  f.setCreateReply(() => {
    Object.assign(f.control.master[0], { priority: '1', holdstopcode: 'H', holdstopreason: 'quality review',
      av_rule_last_clear_reason: 'priority_hold_edit', av_rule_last_cleared_at: '2026-10-09T12:01:00Z', last_updated: '2026-10-09T12:01:00Z' });
    f.control.datasetRevision = 501;
    return confirmedLiveEditResponse();
  });
  await restoreDriveLayoutRenderer(page);
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeHidden();
  await expect(page.locator('#toast-notification')).toContainText('Live edits are confirmed');
  expect(f.calls).toHaveLength(1);
  const sent = f.calls[0];
  expect(sent.workflowPolicyVersion).toBe('reclass-action-workflow-v7-editable-fields-20261009');
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
  expect(queued[0].payload.workflowPolicyVersion).toBe('reclass-action-workflow-v7-editable-fields-20261009');
  expect(f.control.blockedMutations).toEqual([]);
});

for (const scope of [{ season: 'S1', salesYear: '27' }, { season: 'F1', salesYear: '28' }]) {
  test(`future row ${scope.salesYear}.${scope.season} can submit a selected-row Hold inquiry`, { tag: ['@reclass-splits'] }, async ({ page, baseURL }, info) => {
    const f = await fixture(page, baseURL!, info.project.name, scope);
    const row = await f.open();
    await expect(row.locator('[data-reclass-v3-action="hold"]')).toBeEnabled();
    await expect(row.locator('[data-reclass-v3-action="stop_ship"]')).toBeEnabled();
    await row.locator('[data-reclass-v3-action="hold"]').click();
    await row.locator('[data-reclass-v3-proposal-action="hold"][data-reclass-v3-proposal-field="reason"]').fill('Quality Review');
    f.setCreateReply(() => {
      const reply = confirmedLiveEditResponse('2');
      Object.assign(f.control.master[0], {holdstopcode:'H',holdstopreason:'quality review',last_updated:reply.liveEdits[0].last_updated});
      f.control.datasetRevision = 501;
      Object.assign(reply.liveEdits[0].evidence, { lotcode: `${scope.salesYear}.${scope.season}` });
      return reply;
    });
    await page.locator('#argos-inventory-transaction-apply').click();
    await expect(page.locator('#argos-inventory-transaction-modal')).toBeHidden();
    await expect(page.locator('#toast-notification')).toContainText('Live edits are confirmed');
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].workflowPolicyVersion).toBe('reclass-action-workflow-v7-editable-fields-20261009');
    expect(f.calls[0].transaction.holdStopProposals).toEqual([
      { action: 'hold', reason: 'quality review', sourceUid: 'drive-layout-synthetic-1-no-photo' },
    ]);
    expect(f.calls[0].rowOverlays).toHaveLength(1);
    expect(f.calls[0].rowOverlays[0].expected).toMatchObject({ priority: '2', holdstopcode: '', holdstopreason: '' });
    expect(await page.evaluate(() => window.eval(`(() => ({
      quantity: Number(fullInventory[0].PTRONHAND), season: fullInventory[0].SEASON, year: fullInventory[0].SALEYEAR,
      hold: fullInventory[0].HOLDSTOPCODE, reason: fullInventory[0].HOLDSTOPREASON
    }))()`))).toEqual({ quantity: 25, season: scope.season, year: scope.salesYear, hold: 'H', reason: 'quality review' });
    expect(f.control.blockedMutations).toEqual([]);
  });
}

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
  expect(f.calls[0].workflowPolicyVersion).toBe('reclass-action-workflow-v7-editable-fields-20261009');
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
  await populate(page, 'move_down');
  await page.locator('[data-reclass-row-card="drive-layout-synthetic-1-no-photo"] [data-reclass-v3-action="hold"]').click();
  await page.locator('[data-reclass-v3-proposal-action="hold"][data-reclass-v3-proposal-field="reason"]').fill('Keep for review');
  f.setCreateReply(() => {
    const receipt = confirmedLiveEditResponse('2');
    receipt.liveEdits[0].holdstopreason = 'keep for review';
    return receipt;
  });
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
  await expect(restored.getByRole('checkbox')).toHaveCount(0);
  await expect(row.locator('[data-reclass-v3-action="hold"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(row.locator('[data-reclass-v3-proposal-action="hold"][data-reclass-v3-proposal-field="reason"]')).toHaveValue('keep for review');
  expect(await page.evaluate(() => window.eval('argosInventoryTransactionState.idempotencyToken'))).not.toBe(token);
  expect(f.control.blockedMutations).toEqual([]);
});


test('V7 field-only inquiry enables submission, preserves the draft on failure and reconciles confirmed values', { tag: ['@reclass-splits'] }, async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name);
  const row = await f.open();
  if (!await row.locator('[data-reclass-location-details]').evaluate(element => element.hasAttribute('open'))) await row.locator('[data-reclass-location-details] > summary').click();
  const note = row.locator('[data-reclass-temporary-field="locationnote"]');
  await note.fill('New location instructions');
  await row.locator('[data-reclass-temporary-field="salesnote"]').fill('New sales instructions');
  await row.locator('[data-reclass-temporary-field="suspend"]').selectOption('yes');
  await expect(page.locator('#argos-inventory-transaction-apply')).toBeEnabled();
  f.failNext();
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#toast-notification')).toContainText('Synthetic queue failure');
  await expect(note).toHaveValue('New location instructions');
  expect(f.calls[0].transaction.requestActions).toEqual(['inventory_fields']);
  expect(f.calls[0].rowOverlays[0].proposals).toEqual([]);
  expect(f.calls[0].rowOverlays[0].fieldEdits).toEqual([
    {field:'locationnote',expected:'',value:'New location instructions'},
    {field:'salesnote',expected:'',value:'New sales instructions'},
    {field:'suspend',expected:'',decision:'yes'},
  ]);
  f.setCreateReply(() => {
    const receipt = confirmedPriorityResponse('2');
    Object.assign(f.control.master[0], {locationnote:'New location instructions',salesnote:'New sales instructions',suspend:'DC',prisetby:'DC',priupdated:'2026-10-09',locationnotedate:'2026-10-09',last_updated:receipt.liveEdits[0].last_updated});
    f.control.datasetRevision = 502;
    const before = Object.fromEntries(['locationnote','locationptn1','desigitem','desigcust','desigloc','pullerresponsibility','oversellpercentage','salesnote','suspend'].map(field => [field,null]));
    return { ...receipt, workflowPolicyVersion:'reclass-action-workflow-v7-editable-fields-20261009',
      inventoryFields:[{unique_id:receipt.liveEdits[0].unique_id,before,
        after:{...before,locationnote:'New location instructions',salesnote:'New sales instructions',suspend:'DC'},
        changedFields:['locationnote','salesnote','suspend'],
        stamps:{prisetby:'DC',priupdated:'2026-10-09',locationnotedate:'2026-10-09',evaldate:'2026-10-09'}}] };
  });
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeHidden();
  expect(f.calls[1].idempotencyToken).toBe(f.calls[0].idempotencyToken);
  expect(await page.evaluate(() => window.eval(`(() => {const row=fullInventory.find(row=>row.UNIQUE_ID==='drive-layout-synthetic-1-no-photo');return {note:row.LOCATIONNOTE,sales:row.SALESNOTE,sus:row.SUSPEND,onHand:Number(row.PTRONHAND)};})()`)))
    .toEqual({note:'New location instructions',sales:'New sales instructions',sus:'DC',onHand:25});
  expect(f.control.blockedMutations).toEqual([]);
});

test('Take off hold YES queues the inquiry and retains confirmed photos and specs', { tag: ['@reclass-splits'] }, async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name);
  const photo = 'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/v2/2026-10-09/keep.webp';
  await page.evaluate(photo => window.eval(`(() => {
    Object.assign(fullInventory[0], {HOLDSTOPCODE:'H',HOLDSTOPREASON:'test hold',PHOTO_LINK:${JSON.stringify(photo)},PHOTO_NAME:'2026-10-09-keep.webp',SAVED_PHOTO_LINK:${JSON.stringify(photo)},SPEC:'keep specs',CALIPER:'2',MATCH:'100',AV_NOTE:'keep note'});
    rebuildMasterInventoryIndexes();
    if (!canSubmitLiveHoldRemoval(fullInventory[0])) throw new Error('Fixture must be authorized for live Hold removal');
    void sendDriveRowToHoldRelease(fullInventory[0].UNIQUE_ID);
  })()`), photo);
  await expect(page.locator('#hold-release-modal')).toBeVisible();
  f.setCreateReply(() => {
    const response = confirmedPriorityResponse('2');
    Object.assign(response.liveEdits[0].evidence, {photo_link:photo,photo_name:'2026-10-09-keep.webp',spec:'keep specs',caliper:'2',match:'100',av_note:'keep note',av_rule_last_clear_reason:null,av_rule_last_cleared_at:null});
    Object.assign(response.liveEdits[0], {av_rule_last_clear_reason:null,av_rule_last_cleared_at:null});
    Object.assign(f.control.master[0], response.liveEdits[0].evidence, {holdstopcode:null,holdstopreason:null});
    f.control.datasetRevision = 502;
    return {...response,workflowPolicyVersion:'reclass-action-workflow-v7-editable-fields-20261009',inventoryFields:[]};
  });
  await page.locator('#hold-release-yes-btn').click();
  await expect.poll(() => f.calls.length).toBe(1);
  await expect(page.locator('#toast-notification')).toContainText('Hold removed');
  expect(f.calls[0].transaction.requestActions).toEqual(['take_off_hold']);
  expect(f.calls[0].rowOverlays[0].proposals).toEqual([]);
  expect(await page.evaluate(() => window.eval(`(() => {const row=fullInventory.find(row=>row.UNIQUE_ID==='drive-layout-synthetic-1-no-photo');return {hold:row.HOLDSTOPCODE,photo:row.PHOTO_LINK,spec:row.SPEC,onHand:Number(row.PTRONHAND)};})()`)))
    .toEqual({hold:'',photo,spec:'keep specs',onHand:25});
  expect(f.control.blockedMutations).toEqual([]);
});
