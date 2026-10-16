import { expect, test, type Page } from '@playwright/test';

import { renderDriveLayoutCard, restoreDriveLayoutRenderer, settleDriveLayoutShell } from './fixtures/drive-card-layout';
import { hlMaster, installHlOrderFixture } from './fixtures/hl-order-state.mjs';
import { inventoryReadFixture } from './fixtures/inventory-list-read-fixture.mjs';
import { scheduleReclassPaintProbeCheck } from './helpers/reclass-paint-probe.mjs';
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
  scope: { season: string; salesYear: string } = { season: 'F1', salesYear: '27' },
  inventoryRows = 1, sourceQuantity = 25) {
  const lotcode = `${scope.salesYear}.${scope.season}`;
  // The backend fixture must return the same row as the mounted Drive card.
  // Background inventory hydration can replace manually mounted rows.
  const control = await installHlOrderFixture(page, baseURL, { role: 'ADMIN', username: 'dylan_collyge',
    appPermissions: [{permissionKey:'module.po-management.view',kind:'module',moduleKey:'po-management',allowed:true},{permissionKey:'drive.reclass.submit',kind:'action',moduleKey:'drive',allowed:true}],
    master: [hlMaster('drive-layout-synthetic-1-no-photo', { itemcode: 'LAYOUT.001-NO-PHOTO',
      commonname: 'Synthetic Drive Card', contsize: '#3', locationcode: 'A.01.001', lotcode,
      season: scope.season, saleyear: scope.salesYear,
      ptronhand: String(sourceQuantity), ptrreviewed: '2', ptravailable: String(sourceQuantity), priority: '2', holdstopcode: '',
      photo_link: 'https://example.test/old.jpg', photo_name: 'old.jpg', spec: 'old spec', caliper: 'old caliper',
      match: 'old match', av_note: 'old AV note', pic_note: 'old pick', sales_note: 'old sales', last_updated: '2026-10-08T12:00:00Z' }),
      ...Array.from({ length: Math.max(0, inventoryRows - 1) }, (_, index) => hlMaster(`zz-volume-${String(index).padStart(4, '0')}`, {
        itemcode: `VOLUME.${String(index).padStart(4, '0')}`, commonname: `Synthetic volume row ${index}`, locationcode: `Z.${String(index).padStart(5, '0')}`,
        lotcode: '27.F1', season: 'F1', saleyear: '27', ptronhand: '100', ptravailable: '100' }))],
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
  let verifiedFullSnapshot: { revision: string; scope: string; permission: string; complete: boolean } | null = null;
  if (inventoryRows >= 1200) {
    const loaded = await page.evaluate(() => window.eval("(async () => await ensureDatasetLoaded('master', 'full', { force: true }))()"));
    expect(loaded, 'the representative full inventory must load through the production verified read path').toBe(true);
    verifiedFullSnapshot = await page.evaluate(() => window.eval(`(() => {
      const state = getDatasetState('master');
      const context = getProductionLiveSyncContext();
      return { revision: String(state.liveVerifiedRevision || ''), scope: String(state.liveVerifiedScope || ''), permission: String(state.liveVerifiedPermission || ''),
        complete: state.initialLoaded === true && state.fullLoaded === true && state.rowCompleteness === 'complete' && state.fieldCoverage === 'full'
          && state.liveVerifiedScope === context.scope && state.liveVerifiedPermission === context.dataPermissionVersion
          && isConfirmedInventoryReadRevisionCurrent(state.liveVerifiedRevision) };
    })()`));
    expect(verifiedFullSnapshot.revision, 'a revision from a completed full production read is required').toMatch(/^[1-9]\d*$/);
    expect(verifiedFullSnapshot.complete).toBe(true);
  }
  const mount = async () => {
    const preserveVerifiedInventory = inventoryRows >= 1200;
    if (preserveVerifiedInventory) {
      await page.evaluate(({ snapshot, expectedRows, physicalColumns }) => {
        const root = window as any;
        root.__reclassVerifiedInventoryBridge = { rows: window.eval('fullInventory'), snapshot, expectedRows, physicalColumns };
        const ready = window.eval(`(() => {
          const bridge = window.__reclassVerifiedInventoryBridge;
          const state = getDatasetState('master');
          const context = getProductionLiveSyncContext();
          return Array.isArray(bridge.rows) && bridge.rows.length === bridge.expectedRows && state.fullLoaded === true && state.fieldCoverage === 'full'
            && String(state.liveVerifiedRevision || '') === bridge.snapshot.revision && state.liveVerifiedScope === bridge.snapshot.scope
            && state.liveVerifiedPermission === bridge.snapshot.permission && context.scope === bridge.snapshot.scope
            && context.dataPermissionVersion === bridge.snapshot.permission && isConfirmedInventoryReadRevisionCurrent(bridge.snapshot.revision);
        })()`);
        if (!ready) { delete root.__reclassVerifiedInventoryBridge; throw new Error('RECLASS_FIXTURE_VERIFIED_INVENTORY_NOT_READY'); }
      }, { snapshot: verifiedFullSnapshot, expectedRows: inventoryRows, physicalColumns: inventoryReadFixture.physicalColumns });
    }
    try {
      await renderDriveLayoutCard(page, { theme: 'light', knownQuantities: true });
      const restored = await page.evaluate(({ values, sourceQuantity, preserveVerifiedInventory }) => {
        const root = window as any;
        root.__reclassFixtureBridge = { values, sourceQuantity, preserveVerifiedInventory };
        try {
          return window.eval(`(() => {
        const { values, sourceQuantity, preserveVerifiedInventory } = window.__reclassFixtureBridge;
        const verified = preserveVerifiedInventory ? window.__reclassVerifiedInventoryBridge : null;
        if (preserveVerifiedInventory) {
          if (!verified || !Array.isArray(verified.rows) || verified.rows.length !== verified.expectedRows) throw new Error('RECLASS_FIXTURE_VERIFIED_INVENTORY_MISSING');
          const hasRequiredFormattedFields = verified.rows.every(row => ['UNIQUE_ID', 'ITEMCODE', 'COMMONNAME', 'CONTSIZE', 'LOCATIONCODE',
            'LOTCODE', 'SEASON', 'SALEYEAR', 'PTRONHAND', 'PTRAVAILABLE'].every(field => Object.prototype.hasOwnProperty.call(row, field)));
          const uniqueCommonNames = countUniqueCacheCommonNames(verified.rows);
          if (!hasRequiredFormattedFields || uniqueCommonNames < 1200) throw new Error('RECLASS_FIXTURE_VERIFIED_INVENTORY_INCOMPLETE');
          const state = getDatasetState('master');
          const context = getProductionLiveSyncContext();
          if (String(state.liveVerifiedRevision || '') !== verified.snapshot.revision || state.liveVerifiedScope !== verified.snapshot.scope
              || state.liveVerifiedPermission !== verified.snapshot.permission || context.scope !== verified.snapshot.scope
              || context.dataPermissionVersion !== verified.snapshot.permission || !isConfirmedInventoryReadRevisionCurrent(verified.snapshot.revision)) {
            throw new Error('RECLASS_FIXTURE_VERIFIED_SNAPSHOT_CHANGED');
          }
          fullInventory = verified.rows;
          state.rowCompleteness = 'complete';
          state.fieldCoverage = 'full';
        }
        let source = fullInventory.find(row => row.UNIQUE_ID === 'drive-layout-synthetic-1-no-photo' || row.unique_id === 'drive-layout-synthetic-1-no-photo');
        if (!source) throw new Error('Reclass fixture source row is missing after inventory mount.');
        source.PTRONHAND = sourceQuantity; source.PTRAVAILABLE = sourceQuantity;
        source.ptronhand = String(sourceQuantity); source.ptravailable = String(sourceQuantity);
        source.SEASON = values.season;
        source.SALEYEAR = values.salesYear;
        source.LOTCODE = values.lotcode;
        source.season = values.season; source.saleyear = values.salesYear; source.lotcode = values.lotcode;
        source.LAST_UPDATED = '2026-10-08T12:00:00Z'; source.last_updated = '2026-10-08T12:00:00Z';
        source.DOM_ID = source.DOM_ID || 'fi_0';
        rebuildMasterInventoryIndexes();
        return { rowCount: fullInventory.length, physicalCoverage: preserveVerifiedInventory, uniqueCommonNames: preserveVerifiedInventory ? countUniqueCacheCommonNames(fullInventory) : null };
          })()`);
        } finally {
          delete root.__reclassFixtureBridge;
          delete root.__reclassVerifiedInventoryBridge;
        }
      }, { values: { ...scope, lotcode }, sourceQuantity, preserveVerifiedInventory });
      if (preserveVerifiedInventory) {
        expect(restored.rowCount).toBe(inventoryRows);
        expect(restored.physicalCoverage).toBe(true);
        expect(restored.uniqueCommonNames).toBeGreaterThanOrEqual(1200);
      }
    } finally {
      await page.evaluate(() => {
        delete (window as any).__reclassFixtureBridge;
        delete (window as any).__reclassVerifiedInventoryBridge;
      });
    }
  };
  await mount();
  const confirmInventoryRevision = async () => page.evaluate(({ snapshot }) => {
    const root = window as any;
    root.__reclassVerifiedSnapshot = snapshot;
    try {
      return window.eval(`(() => {
    const snapshot = window.__reclassVerifiedSnapshot;
    const context = getProductionLiveSyncContext();
    const master = getDatasetState('master');
    if (snapshot) {
      if (!master.initialLoaded || !master.fullLoaded || String(master.liveVerifiedRevision || '') !== snapshot.revision
          || master.liveVerifiedScope !== snapshot.scope || master.liveVerifiedPermission !== snapshot.permission
          || context.scope !== snapshot.scope || context.dataPermissionVersion !== snapshot.permission
          || !isConfirmedInventoryReadRevisionCurrent(snapshot.revision)) throw new Error('RECLASS_FIXTURE_VERIFIED_SNAPSHOT_CHANGED');
      master.rowCompleteness = 'complete';
      master.fieldCoverage = 'full';
      return true;
    }
    master.initialLoaded = true;
    master.fullLoaded = true;
    master.rowCompleteness = 'complete';
    master.fieldCoverage = 'full';
    master.liveVerifiedRevision = '1';
    master.liveVerifiedScope = context.scope;
    master.liveVerifiedPermission = context.dataPermissionVersion;
    return true;
      })()`);
    } finally {
      delete root.__reclassVerifiedSnapshot;
    }
  }, { snapshot: verifiedFullSnapshot });
  const open = async (expand = true) => {
    await confirmInventoryRevision();
    const warmSnapshot = await page.evaluate(() => window.eval(`(() => {
      const row = findItemByUniqueId('drive-layout-synthetic-1-no-photo');
      const group = getVerifiedCachedArgosItemInquiryGroup(row);
      return group ? { scope: group.scope, permission: group.permission } : null;
    })()`));
    const context = await page.evaluate(() => window.eval('getProductionLiveSyncContext()'));
    expect(warmSnapshot, 'the Item Inquiry must use the verified complete warm snapshot under the current coordinator scope and permission').toEqual({ scope: context.scope, permission: context.dataPermissionVersion });
    await page.locator('#drive-content .app-drive-card-reclass .app-card-bottom-btn').click();
    await expect(page.locator('#argos-inventory-transaction-modal')).toBeVisible();
    const row = page.locator('[data-reclass-row-card="drive-layout-synthetic-1-no-photo"]');
    if (expand && await row.locator('.argos-reclass-row-toggle').getAttribute('aria-expanded') !== 'true') await row.locator('.argos-reclass-row-toggle').click();
    return row;
  };
  return { control, calls, open, mount, confirmInventoryRevision, failNext: () => { rejectNext = true; }, conflict: () => { deliveryStatus = 'conflict'; }, setCreateReply: (replyFactory: (body: Record<string, any>) => unknown) => { createReply = replyFactory; } };
}

async function installLiveMoveEndpoint(page: Page, baseURL: string, control: any) {
  const requests: Record<string, any>[] = [];
  await page.route('**/functions/v1/app-api', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    if (body.action !== 'inventory_reclass_move') return route.fallback();
    const reply = (payload: unknown) => route.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': new URL(baseURL).origin, 'access-control-allow-credentials': 'true' }, body: JSON.stringify(payload) });
    requests.push(structuredClone(body));
    if (body.operation === 'status') return reply({ ok: true, data: { ok: true, status: 'missing' } });
    const sourceUid = body.moves[0].source.uniqueId;
    const sourceBefore = control.master.find((item: any) => item.unique_id === sourceUid);
    if (!sourceBefore) return reply({ ok: false, code: 'INVENTORY_RECLASS_SOURCE_CHANGED', message: 'Source row is missing.' });
    const total = body.moves.flatMap((move: any) => move.lines).reduce((sum: number, line: any) => sum + Number(line.quantity), 0);
    const sourceAfter = { ...sourceBefore, ptronhand: String(Number(sourceBefore.ptronhand) - total), ptravailable: String(Number(sourceBefore.ptravailable) - total),
      PTRONHAND: String(Number(sourceBefore.ptronhand) - total), PTRAVAILABLE: String(Number(sourceBefore.ptravailable) - total), last_updated: '2026-10-15T12:00:00Z' };
    const targets = new Map<string, Record<string, any>>();
    for (const move of body.moves) for (const line of move.lines) {
      const season = String(line.destinationSeason).toUpperCase();
      const existing = targets.get(season) || control.master.find((item: any) => item.unique_id === `server-target-${season.toLowerCase()}`);
      const current = existing || { ...sourceBefore, unique_id: `server-target-${season.toLowerCase()}`, UNIQUE_ID: `server-target-${season.toLowerCase()}`,
        lotcode: `${String(sourceBefore.lotcode).replace(/[.][^.]+$/, '')}.${season}`, season, ptronhand: '0', ptravailable: '0' };
      const onHand = Number(current.ptronhand ?? current.PTRONHAND ?? 0) + Number(line.quantity);
      const available = Number(current.ptravailable ?? current.PTRAVAILABLE ?? 0) + Number(line.quantity);
      targets.set(season, { ...current, lotcode: `${String(sourceBefore.lotcode).replace(/[.][^.]+$/, '')}.${season}`, LOTCODE: `${String(sourceBefore.lotcode).replace(/[.][^.]+$/, '')}.${season}`,
        season, SEASON: season, ptronhand: String(onHand), ptravailable: String(available), PTRONHAND: String(onHand), PTRAVAILABLE: String(available),
        last_updated: '2026-10-15T12:00:00Z' });
    }
    const targetRows = [...targets.values()];
    control.master = control.master.filter((item: any) => item.unique_id !== sourceUid && !targetRows.some(target => target.unique_id === item.unique_id))
      .concat(sourceAfter, ...targetRows);
    control.datasetRevision += 1;
    const receipt = { ok: true, commandId: body.commandId, requestId: `reclass-move-${requests.length}`, revision: 600 + requests.length,
      rows: [{ table: 'ph_master_inventory', row: sourceAfter }, ...targetRows.map(row => ({ table: 'ph_master_inventory', row }))],
      movements: body.moves.flatMap((move: any) => move.lines.map((line: any) => ({ direction: line.direction, destinationSeason: line.destinationSeason,
        quantity: line.quantity, sourceUniqueId: move.source.uniqueId, destinationUniqueId: `server-target-${String(line.destinationSeason).toLowerCase()}` }))),
      status: 'applied', importStatus: 'pending' };
    return reply({ ok: true, data: receipt });
  });
  return requests;
}

async function installPaintTimingProbe(page: Page, options: { phase: 'open' | 'expand' | 'optimistic'; uid: string; sourceQuantity?: number; targetQuantity?: number }) {
  await page.evaluate(({ config, schedulerSource }) => {
    const schedulePaintCheck = new Function(`return (${schedulerSource})`)();
    const root = window as any;
    const probe: any = { startedAt: null, result: null, observer: null, rafScheduled: false };
    const visible = (element: Element | null) => !!element && !!element.getClientRects().length
      && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
    const findCard = (uid: string) => [...document.querySelectorAll('[data-reclass-row-card]')]
      .find(card => card.getAttribute('data-reclass-row-card') === uid) || null;
    const finishAfterPaint = () => {
      if (probe.result) return;
      const state = window.eval('argosInventoryTransactionState') as any;
      const modal = document.getElementById('argos-inventory-transaction-modal');
      if (!visible(modal) || !state || state.uid !== config.uid || !state.inquiryModel) return;
      const sourceEntry = state.inquiryModel.locationRows?.find((entry: any) => String(entry.unique_id || '') === config.uid);
      const sourceCard = findCard(config.uid);
      if (!sourceEntry || !visible(sourceCard)) return;
      if (config.phase === 'open') {
        const source = state.inquiryModel.rows?.find((row: any) => String(row.UNIQUE_ID || row.unique_id || '') === config.uid);
        const quantity = (row: any, key: string) => Number(row && (row[key] ?? row[key.toLowerCase()]));
        const metrics = sourceCard.querySelector('.argos-reclass-row-toggle-meta')?.textContent || '';
        if (quantity(source, 'PTRONHAND') !== config.sourceQuantity || quantity(source, 'PTRAVAILABLE') !== config.sourceQuantity
          || !metrics.includes(`OH ${config.sourceQuantity}`) || !metrics.includes(`AVL ${config.sourceQuantity}`)) return;
      }
      if (config.phase === 'expand' && sourceCard.querySelector('[data-reclass-row-hydrated="true"]') == null) return;
      if (config.phase === 'optimistic') {
        const pending = state.pendingReclassMove;
        const source = state.inquiryModel.rows?.find((row: any) => String(row.UNIQUE_ID || row.unique_id || '') === config.uid);
        const target = state.inquiryModel.rows?.find((row: any) => String(row.UNIQUE_ID || row.unique_id || '').startsWith('pending-reclass-'));
        const quantity = (row: any, key: string) => Number(row && (row[key] ?? row[key.toLowerCase()]));
        if (!pending || quantity(source, 'PTRONHAND') !== config.sourceQuantity || quantity(source, 'PTRAVAILABLE') !== config.sourceQuantity
          || quantity(target, 'PTRONHAND') !== config.targetQuantity || quantity(target, 'PTRAVAILABLE') !== config.targetQuantity) return;
        const targetCard = target && findCard(String(target.UNIQUE_ID || target.unique_id || ''));
        const sourceMetrics = sourceCard.querySelector('.argos-reclass-row-toggle-meta')?.textContent || '';
        const targetMetrics = targetCard?.querySelector('.argos-reclass-row-toggle-meta')?.textContent || '';
        if (!visible(targetCard) || !sourceMetrics.includes(`OH ${config.sourceQuantity}`) || !sourceMetrics.includes(`AVL ${config.sourceQuantity}`)
          || !targetMetrics.includes(`OH ${config.targetQuantity}`) || !targetMetrics.includes(`AVL ${config.targetQuantity}`)) return;
        if (visible(document.getElementById('loading-spinner')) || visible(document.querySelector('.argos-reclass-move-waiting'))) return;
      }
      probe.result = { elapsedMs: performance.now() - probe.startedAt, phase: config.phase };
      probe.observer?.disconnect();
    };
    probe.finishAfterPaint = finishAfterPaint;
    const check = () => schedulePaintCheck(probe, requestAnimationFrame);
    const onClick = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      const matches = config.phase === 'open'
        ? !!target?.closest('.app-drive-card-reclass .app-card-bottom-btn')
        : config.phase === 'expand'
          ? !!target?.closest(`[data-reclass-row-card="${CSS.escape(config.uid)}"] .argos-reclass-row-toggle`)
        : !!target?.closest('#argos-inventory-transaction-apply');
      if (!matches || probe.startedAt != null) return;
      probe.startedAt = performance.now();
      probe.observer = new MutationObserver(check);
      probe.observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      check();
    };
    document.addEventListener('click', onClick, true);
    root.__reclassPaintTimingProbe = probe;
  }, { config: options, schedulerSource: scheduleReclassPaintProbeCheck.toString() });
}

async function readPaintTimingProbe(page: Page) {
  try {
    await page.waitForFunction(() => !!(window as any).__reclassPaintTimingProbe?.result, null, { timeout: 5000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => {
      const root = window as any, probe = root.__reclassPaintTimingProbe, state = window.eval('argosInventoryTransactionState') as any;
      const card = document.querySelector('[data-reclass-row-card="drive-layout-synthetic-1-no-photo"]');
      const modal = document.getElementById('argos-inventory-transaction-modal');
      return { probeStarted: probe?.startedAt != null, probeResult: probe?.result, uid: state?.uid,
        modelUid: state?.inquiryModel?.locationRows?.map((entry: any) => entry.unique_id), modalClass: modal?.className,
        modalVisible: !!modal?.getClientRects().length, cardFound: !!card,
        hydrated: !!card?.querySelector('[data-reclass-row-hydrated="true"]'),
        clickButtonClass: document.querySelector('.app-drive-card-reclass .app-card-bottom-btn')?.className };
    });
    throw new Error(`RECLASS_PAINT_PROBE_TIMEOUT:${JSON.stringify(diagnostic)}; ${String(error)}`, { cause: error });
  }
  return page.evaluate(() => (window as any).__reclassPaintTimingProbe.result as { elapsedMs: number; phase: string });
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
  const f = await fixture(page, baseURL!, info.project.name, { season: 'F1', salesYear: '27' }, 1, 100);
  const moveRequests = await installLiveMoveEndpoint(page, baseURL!, f.control);
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
  expect(moveRequests).toHaveLength(2);
  expect(moveRequests.map(request => request.moves[0].lines[0].direction)).toEqual(['move_up', 'move_down']);
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

test('Move Down commits live inventory and a failed inquiry retains the separate Hold request', {"tag":["@reclass-splits"]}, async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name); await f.open();
  const moveRequests = await installLiveMoveEndpoint(page, baseURL!, f.control);
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
  f.setCreateReply(() => {
    Object.assign(f.control.master[0], { priority: '2', holdstopcode: 'H', holdstopreason: 'quality review',
      av_rule_last_clear_reason: 'priority_hold_edit', av_rule_last_cleared_at: '2026-10-09T12:01:00Z', last_updated: '2026-10-09T12:01:00Z' });
    f.control.datasetRevision = 501;
    return confirmedLiveEditResponse('2');
  });
  f.failNext(); await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#toast-notification')).toContainText('Synthetic queue failure');
  await expect(page.locator('[data-reclass-v3-proposal-action="hold"][data-reclass-v3-proposal-field="reason"]')).toHaveValue('quality review');
  expect(moveRequests).toHaveLength(1);
  expect(moveRequests[0].moves[0].lines).toEqual([
    { direction: 'move_down', destinationSeason: 'X', quantity: 15 },
    { direction: 'move_down', destinationSeason: 'S1', quantity: 5 },
    { direction: 'move_down', destinationSeason: 'U1', quantity: 5 },
  ]);
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeHidden();
  expect(f.calls).toHaveLength(2);
  expect(f.calls[1].idempotencyToken).toBe(f.calls[0].idempotencyToken);
  expect(f.calls[1].workflowPolicyVersion).toBe('reclass-action-workflow-v7-editable-fields-20261009');
  expect(f.calls[1].transaction.holdStopProposals).toEqual([expect.objectContaining({ action: 'hold', reason: 'quality review', sourceUid: 'drive-layout-synthetic-1-no-photo' })]);
  expect(f.calls[0].rowOverlays.flatMap((overlay: any) => overlay.proposals)).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ action: 'move_down' }),
  ]));
  expect(f.calls[1].rowOverlays.flatMap((overlay: any) => overlay.proposals)).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ action: 'move_down' }),
  ]));
  expect(moveRequests).toHaveLength(1, 'retrying the separate Hold inquiry must not replay stock');
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

test('Move Up and Hold remain selected together with a row reason and stamped date', {"tag":["@reclass-splits"]}, async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name);
  const row = await f.open();
  await row.locator('[data-reclass-v3-action="move_up"]').click();
  await row.getByLabel('Move Up quantity 1', { exact: true }).fill('5');
  await row.getByLabel('Move Up destination 1', { exact: true }).selectOption('X');
  await expect(row.locator('[data-reclass-v3-action="hold"]')).toBeEnabled();
  await row.locator('[data-reclass-v3-action="hold"]').click();
  await row.locator('[data-reclass-v3-proposal-action="hold"][data-reclass-v3-proposal-field="reason"]').fill('Concurrent quality review');
  await expect(row.locator('[data-reclass-hold-begin-date]')).toHaveValue(/\d{4}-\d{2}-\d{2}/);
  await expect(row.locator('[data-reclass-v3-action="move_up"]')).toHaveAttribute('aria-pressed', 'true');
  const draft = await page.evaluate(() => window.eval('collectArgosReclassV3Draft()'));
  expect(draft.holdStopProposals).toEqual([expect.objectContaining({ action: 'hold', reason: 'concurrent quality review' })]);
  expect(draft.requestActions).toEqual(expect.arrayContaining(['hold', 'move_up']));
  expect(draft.rowOverlays[0].proposals).toEqual([expect.objectContaining({ action: 'move_up' })]);
  expect(f.control.blockedMutations).toEqual([]);
});

test('Move Up commits live stock before Priority inquiry and does not queue the move as an inquiry', {"tag":["@reclass-splits"]}, async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name); await f.open();
  const row = page.locator('[data-reclass-row-card="drive-layout-synthetic-1-no-photo"]');
  await row.locator('[data-reclass-v3-action="priority_change"]').click();
  await row.locator('[data-reclass-v3-proposal-action="priority_change"][data-reclass-v3-proposal-field="priority"]').fill('1');
  await row.locator('[data-reclass-v3-action="move_up"]').click();
  const move = row.locator('[data-reclass-move-action="move_up"]');
  await move.getByLabel('Move Up quantity 1', { exact: true }).fill('5');
  await move.getByLabel('Move Up destination 1', { exact: true }).selectOption('X');
  const moveRequests: Record<string, any>[] = [];
  await page.route('**/functions/v1/app-api', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    if (body.action !== 'inventory_reclass_move') return route.fallback();
    moveRequests.push(structuredClone(body));
    const source = { ...f.control.master[0], ptronhand: '20', ptravailable: '20', last_updated: '2026-10-15T12:00:00Z' };
    const target = { ...f.control.master[0], unique_id: 'server-target-x', lotcode: '27.X', season: 'X', ptronhand: '5', ptravailable: '5', last_updated: '2026-10-15T12:00:00Z' };
    return route.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': new URL(baseURL!).origin, 'access-control-allow-credentials': 'true' },
      body: JSON.stringify({ ok: true, data: { ok: true, commandId: body.commandId, requestId: 'five-unit-move', revision: 11,
        rows: [{ table: 'ph_master_inventory', row: source }, { table: 'ph_master_inventory', row: target }],
        movements: [{ direction: 'move_up', destinationSeason: 'X', quantity: 5, sourceUniqueId: body.moves[0].source.uniqueId, destinationUniqueId: 'server-target-x' }],
        status: 'applied', importStatus: 'pending' } }) });
  });
  f.setCreateReply(() => confirmedPriorityResponse());
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeHidden();
  expect(f.calls).toHaveLength(1);
  expect(moveRequests).toHaveLength(1);
  expect(moveRequests[0].moves[0].lines).toEqual([{ direction: 'move_up', destinationSeason: 'X', quantity: 5 }]);
  expect(f.calls[0].transaction.requestActions).toEqual(['priority_change']);
  expect(f.calls[0].transaction.holdStopProposals).toEqual([]);
  expect(f.calls[0].rowOverlays[0].proposals).toEqual(expect.arrayContaining([
    expect.objectContaining({ action: 'priority_change', priority: '1' }),
  ]));
  expect(f.control.blockedMutations).toEqual([]);
});

test('610-unit live move stays responsive, replays the exact command after timeout, and queues only the remaining draft once', { tag: ['@reclass-splits'] }, async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name, { season: 'F1', salesYear: '27' }, 10_000, 1000);
  await installPaintTimingProbe(page, { phase: 'open', uid: 'drive-layout-synthetic-1-no-photo', sourceQuantity: 1000 });
  const row = await f.open(false);
  const cachedInquiryOpen = await readPaintTimingProbe(page);
  expect(await page.locator('#toast-notification').innerText()).not.toContain('Loading Item Inquiry');
  if (await row.locator('.argos-reclass-row-toggle').getAttribute('aria-expanded') === 'true') {
    await row.locator('.argos-reclass-row-toggle').click();
  }
  await installPaintTimingProbe(page, { phase: 'expand', uid: 'drive-layout-synthetic-1-no-photo' });
  await row.locator('.argos-reclass-row-toggle').click();
  const hydratedEditorOpen = await readPaintTimingProbe(page);
  await row.locator('[data-reclass-v3-action="priority_change"]').click();
  await row.locator('[data-reclass-v3-proposal-action="priority_change"][data-reclass-v3-proposal-field="priority"]').fill('1');
  await row.locator('[data-reclass-v3-action="move_up"]').click();
  const move = row.locator('[data-reclass-move-action="move_up"]');
  await move.getByLabel('Move Up quantity 1', { exact: true }).fill('610');
  await move.getByLabel('Move Up destination 1', { exact: true }).selectOption('U1');

  const moveRequests: Array<{ body: Record<string, any>; idempotencyKey?: string }> = [];
  const statusRequests: Record<string, any>[] = [];
  const consoleFailures: string[] = [];
  const pageFailures: string[] = [];
  const apiResponses: Record<string, any>[] = [];
  const apiResponseReads: Promise<void>[] = [];
  page.on('console', message => { if (message.type() === 'error') consoleFailures.push(message.text()); });
  page.on('pageerror', error => pageFailures.push(error.stack || error.message));
  page.on('response', response => {
    if (!response.url().includes('/functions/v1/app-api')) return;
    const request = response.request();
    let action = '', operation = '';
    try {
      const requestBody = request.postDataJSON();
      action = String(requestBody.action || '');
      operation = String(requestBody.operation || '');
    } catch {}
    const status = response.status();
    const contentLength = Number(response.headers()['content-length'] || 0);
    if (action !== 'inventory_reclass_move' && status < 400) {
      apiResponses.push({ status, action, operation, bodyCaptured: false, contentLength });
      return;
    }
    const read = response.text().then(body => apiResponses.push({ status, action, operation, body })).catch(error => {
      apiResponses.push({ status, action, operation, bodyError: String(error) });
    });
    apiResponseReads.push(read);
  });
  let firstRequestStarted!: () => void;
  let releaseFirstRequest!: () => void;
  const firstStarted = new Promise<void>(resolve => { firstRequestStarted = resolve; });
  const firstGate = new Promise<void>(resolve => { releaseFirstRequest = resolve; });
  let receipt: Record<string, any> | null = null;
  await page.route('**/functions/v1/app-api', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    const reply = (status: number, payload: unknown) => route.fulfill({ status, contentType: 'application/json',
      headers: { 'access-control-allow-origin': new URL(baseURL!).origin, 'access-control-allow-credentials': 'true' }, body: JSON.stringify(payload) });
    if (body.action !== 'inventory_reclass_move') return route.fallback();
    if (body.operation === 'status') {
      statusRequests.push(structuredClone(body));
      return reply(200, { ok: true, data: { ok: true, status: 'missing' } });
    }
    moveRequests.push({ body: structuredClone(body), idempotencyKey: route.request().headers()['idempotency-key'] });
    if (moveRequests.length === 1) {
      firstRequestStarted();
      await firstGate;
      return reply(503, { ok: false, code: 'INVENTORY_RECLASS_UNAVAILABLE', message: 'Synthetic lost response.' });
    }
    const sourceUid = body.moves[0].source.uniqueId;
    const sourceBefore = f.control.master.find((item: any) => item.unique_id === sourceUid);
    const sourceAfter = { ...sourceBefore, ptronhand: '390', ptravailable: '390', PTRONHAND: '390', PTRAVAILABLE: '390',
      last_updated: '2026-10-15T12:00:00Z' };
    const targetAfter = { ...sourceBefore, unique_id: 'server-target-u1', UNIQUE_ID: 'server-target-u1', lotcode: '27.U1', LOTCODE: '27.U1', season: 'U1', SEASON: 'U1',
      ptronhand: '610', ptravailable: '610', PTRONHAND: '610', PTRAVAILABLE: '610', last_updated: '2026-10-15T12:00:00Z' };
    f.control.master = f.control.master.filter((item: any) => item.unique_id !== sourceUid).concat(sourceAfter, targetAfter);
    f.control.datasetRevision = 610;
    receipt = { ok: true, commandId: body.commandId, requestId: '610-move-request', revision: 610,
      rows: [{ table: 'ph_master_inventory', row: sourceAfter }, { table: 'ph_master_inventory', row: targetAfter }],
      movements: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 610, sourceUniqueId: sourceUid, destinationUniqueId: 'server-target-u1' }],
      status: 'applied', importStatus: 'pending' };
    return reply(200, { ok: true, data: receipt });
  });
  f.setCreateReply(() => {
    const response = confirmedPriorityResponse('1');
    // This edit follows the committed move at revision 610. Return a newer
    // inventory revision and timestamp so it is valid after the move fence.
    response.inventoryRevision = '611';
    response.liveEdits[0].last_updated = '2026-10-15T12:01:00Z';
    response.liveEdits[0].av_rule_last_cleared_at = '2026-10-15T12:01:00Z';
    response.liveEdits[0].evidence.last_updated = '2026-10-15T12:01:00Z';
    response.liveEdits[0].evidence.av_rule_last_cleared_at = '2026-10-15T12:01:00Z';
    // Its evidence must also reflect the source's post-move availability.
    response.liveEdits[0].evidence.ptravailable = '390';
    return response;
  });

  await installPaintTimingProbe(page, { phase: 'optimistic', uid: 'drive-layout-synthetic-1-no-photo', sourceQuantity: 390, targetQuantity: 610 });
  await page.locator('#argos-inventory-transaction-apply').click();
  await firstStarted;
  const optimisticVisible = await readPaintTimingProbe(page);
  expect(optimisticVisible.elapsedMs).toBeLessThan(100);
  const immediate = await page.evaluate(() => window.eval(`(() => {
    const model = argosInventoryTransactionState.inquiryModel;
    const source = model.rows.find(row => String(row.UNIQUE_ID || row.unique_id || '').includes('drive-layout-synthetic-1-no-photo'));
    const target = model.rows.find(row => String(row.UNIQUE_ID || row.unique_id || '').startsWith('pending-reclass-'));
    const visible = element => !!element && !!element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
    return { source: Number(source && (source.PTRONHAND ?? source.ptronhand)), target: Number(target && (target.PTRONHAND ?? target.ptronhand)),
      waitingOverlay: visible(document.getElementById('loading-spinner')) || visible(document.querySelector('.argos-reclass-move-waiting')) };
  })()`));
  expect(immediate).toEqual({ source: 390, target: 610, waitingOverlay: false });
  releaseFirstRequest();
  await expect(page.locator('#toast-notification')).toContainText('Move Confirmation Pending');
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeVisible();

  await page.locator('#argos-inventory-transaction-apply').click();
  try {
    await expect(page.locator('#argos-inventory-transaction-modal')).toBeHidden({ timeout: 15_000 });
  } catch (error) {
    await Promise.all(apiResponseReads);
    const appState = await page.evaluate(() => window.eval(`(() => {
      const state = argosInventoryTransactionState;
      const sourceUid = 'drive-layout-synthetic-1-no-photo';
      const rows = state && state.inquiryModel && state.inquiryModel.rows || [];
      const summarize = row => row ? { uid: row.UNIQUE_ID || row.unique_id, lot: row.LOTCODE || row.lotcode,
        season: row.SEASON || row.season, ptronhand: row.PTRONHAND ?? row.ptronhand,
        ptravailable: row.PTRAVAILABLE ?? row.ptravailable } : null;
      let proposalState = null;
      try { proposalState = { moves: [...argosReclassMultiActionState.rowProposals.entries()] }; } catch (_) {}
      const source = rows.find(row => String(row.UNIQUE_ID || row.unique_id || '') === sourceUid);
      const target = rows.find(row => String(row.UNIQUE_ID || row.unique_id || '').includes('target-u1')
        || String(row.UNIQUE_ID || row.unique_id || '').startsWith('pending-reclass-'));
      const apply = document.getElementById('argos-inventory-transaction-apply');
      const toast = document.getElementById('toast-notification');
      return { modalVisible: !!document.getElementById('argos-inventory-transaction-modal')?.getClientRects().length,
        toast: toast?.innerText || '', applyText: apply?.textContent || '', applyDisabled: !!apply?.disabled,
        pending: state?.pendingReclassMove ? { command: state.pendingReclassMove.command,
          uncertain: state.pendingReclassMove.uncertain, inFlight: state.pendingReclassMove.inFlight } : null,
        rows: { source: summarize(source), target: summarize(target) }, proposalState };
    })()`));
    await info.attach('reclass-610-retry-failure.json', { contentType: 'application/json', body: JSON.stringify({
      appState, moveRequests, statusRequests, apiResponses, inquiryRequests: f.calls,
      consoleFailures, pageFailures
    }, null, 2) });
    throw new Error('The 610-unit move retry did not close the Item Inquiry after replay.', { cause: error });
  }
  expect(statusRequests).toEqual([{ action: 'inventory_reclass_move', operation: 'status', commandId: moveRequests[0].body.commandId }]);
  expect(moveRequests).toHaveLength(2);
  expect(moveRequests[1].body).toEqual(moveRequests[0].body);
  expect(moveRequests[1].idempotencyKey).toBe(moveRequests[0].idempotencyKey);
  expect(moveRequests[0].body.moves[0].lines).toEqual([{ direction: 'move_up', destinationSeason: 'U1', quantity: 610 }]);
  expect(receipt?.importStatus).toBe('pending');
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0].rowOverlays[0].proposals).toEqual([expect.objectContaining({ action: 'priority_change', priority: '1' })]);
  expect(f.calls[0].transaction.requestActions).toEqual(['priority_change']);
  expect(await page.evaluate(() => window.eval(`(() => {
    const source = fullInventory.find(row => row.UNIQUE_ID === 'drive-layout-synthetic-1-no-photo');
    const target = fullInventory.find(row => row.UNIQUE_ID === 'server-target-u1');
    return [Number(source.PTRONHAND), Number(source.PTRAVAILABLE), Number(target.PTRONHAND), Number(target.PTRAVAILABLE)];
  })()`))).toEqual([390, 390, 610, 610]);
  expect(cachedInquiryOpen.elapsedMs).toBeLessThanOrEqual(150);
  expect(hydratedEditorOpen.elapsedMs).toBeLessThanOrEqual(150);
  expect(optimisticVisible.elapsedMs).toBeLessThan(100);
  await info.attach('reclass-610-paint-metrics.json', { contentType: 'application/json', body: JSON.stringify({
    datasetRows: 10_000,
    warmCache: true,
    cachedInquiryOpenMs: cachedInquiryOpen.elapsedMs,
    hydratedEditorOpenMs: hydratedEditorOpen.elapsedMs,
    optimisticQuantityPaintMs: optimisticVisible.elapsedMs,
  }, null, 2) });
  expect(f.control.blockedMutations).toEqual([]);
});

test('definitive live move rejection restores the original worksheet and retains the draft', { tag: ['@reclass-splits'] }, async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name, { season: 'F1', salesYear: '27' }, 10_000, 1000);
  const row = await f.open();
  await row.locator('[data-reclass-v3-action="move_up"]').click();
  const move = row.locator('[data-reclass-move-action="move_up"]');
  await move.getByLabel('Move Up quantity 1', { exact: true }).fill('610');
  await move.getByLabel('Move Up destination 1', { exact: true }).selectOption('U1');
  const requests: Record<string, any>[] = [];
  await page.route('**/functions/v1/app-api', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    if (body.action !== 'inventory_reclass_move') return route.fallback();
    requests.push(structuredClone(body));
    return route.fulfill({ status: 409, contentType: 'application/json',
      headers: { 'access-control-allow-origin': new URL(baseURL!).origin, 'access-control-allow-credentials': 'true' },
      body: JSON.stringify({ ok: false, code: 'INVENTORY_RECLASS_SOURCE_CHANGED', message: 'Source changed.' }) });
  });
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#toast-notification')).toContainText('Source changed');
  expect(requests).toHaveLength(1);
  const restored = await page.evaluate(() => window.eval(`(() => {
    const model = argosInventoryTransactionState.inquiryModel;
    const source = model.rows.find(row => String(row.UNIQUE_ID || row.unique_id || '').includes('drive-layout-synthetic-1-no-photo'));
    const target = model.rows.find(row => String(row.UNIQUE_ID || row.unique_id || '').startsWith('pending-reclass-'));
    return { source: Number(source && (source.PTRONHAND ?? source.ptronhand)), hasTemporaryTarget: !!target,
      moveDraft: Number(getArgosReclassRowProposalMap('drive-layout-synthetic-1-no-photo', false)?.move_up?.splits?.[0]?.quantity) };
  })()`));
  expect(restored).toEqual({ source: 1000, hasTemporaryTarget: false, moveDraft: 610 });
  expect(f.calls).toHaveLength(0);
  expect(f.control.blockedMutations).toEqual([]);
});

test('both directions share the OH cap and split controls fit mobile widths', {"tag":["@reclass-splits"]}, async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name); await f.open();
  const moveRequests = await installLiveMoveEndpoint(page, baseURL!, f.control);
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
  expect(moveRequests).toHaveLength(1);
  expect(moveRequests[0].moves[0].lines).toEqual([
    { direction: 'move_up', destinationSeason: 'X', quantity: 15 },
    { direction: 'move_up', destinationSeason: 'U1', quantity: 5 },
    { direction: 'move_down', destinationSeason: 'Y', quantity: 5 },
  ]);
  expect(f.calls).toHaveLength(0, 'pure movement has no inquiry payload');
  expect(await page.evaluate(() => window.eval(`(() => ({
    source: Number(fullInventory.find(row => row.UNIQUE_ID === 'drive-layout-synthetic-1-no-photo').PTRONHAND),
    targets: ['server-target-x','server-target-u1','server-target-y'].map(uid => Number(fullInventory.find(row => row.UNIQUE_ID === uid)?.PTRONHAND))
  }))()`))).toEqual({ source: 0, targets: [15, 5, 5] });
  expect(f.control.blockedMutations).toEqual([]);
});

test('refresh and Review and Resend restore the separate Hold request without replaying a confirmed Move Down', {"tag":["@reclass-splits"]}, async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!, info.project.name); await f.open();
  const moveRequests = await installLiveMoveEndpoint(page, baseURL!, f.control);
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
  await expect(row.locator('[data-reclass-v3-action="move_down"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(row.locator('[data-reclass-v3-action="hold"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(row.locator('[data-reclass-v3-proposal-action="hold"][data-reclass-v3-proposal-field="reason"]')).toHaveValue('keep for review');
  expect(await page.evaluate(() => window.eval('argosInventoryTransactionState.idempotencyToken'))).not.toBe(token);
  f.setCreateReply(() => ({ ok: true, status: 'queued', jobId: 'synthetic-reclass-retry', queuedAt: new Date().toISOString() }));
  await page.locator('#argos-inventory-transaction-apply').click();
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeHidden();
  expect(f.calls).toHaveLength(2);
  expect(f.calls[1].transaction.holdStopProposals).toEqual([expect.objectContaining({ action: 'hold', reason: 'keep for review' })]);
  expect(f.calls[1].rowOverlays.flatMap((overlay: any) => overlay.proposals)).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ action: 'move_down' }),
  ]));
  expect(moveRequests).toHaveLength(1, 'resending the inquiry cannot repeat the committed movement');
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
  // Seed both the mounted cache and the authoritative fixture row. Background
  // master reads must see the already-saved capture before the live Hold edit.
  Object.assign(f.control.master[0], {
    holdstopcode: 'H', holdstopreason: 'test hold', photo_link: photo, photo_name: '2026-10-09-keep.webp',
    spec: 'keep specs', caliper: '2', match: '100', av_note: 'keep note', last_updated: '2026-10-09T12:00:00Z',
  });
  f.control.datasetRevision = 501;
  await page.evaluate(photo => window.eval(`(() => {
    Object.assign(fullInventory[0], {HOLDSTOPCODE:'H',HOLDSTOPREASON:'test hold',PHOTO_LINK:${JSON.stringify(photo)},PHOTO_NAME:'2026-10-09-keep.webp',SAVED_PHOTO_LINK:${JSON.stringify(photo)},SPEC:'keep specs',CALIPER:'2',MATCH:'100',AV_NOTE:'keep note',LAST_UPDATED:'2026-10-09T12:00:00Z',last_updated:'2026-10-09T12:00:00Z'});
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
