import { expect, test } from '@playwright/test';
import { installHlOrderFixture, hlMaster } from './fixtures/hl-order-state.mjs';

test('unchanged verification preserves Drive demand cards across three refresh cycles', async ({ page, baseURL }, testInfo) => {
  await page.addInitScript(() => { Reflect.deleteProperty(window, 'PushManager'); });
  const fixture = await installHlOrderFixture(page, baseURL!, {
    reserveRows: Array.from({ length: 8 }, (_, i) => ({ unique_id: `steady-reserve-${i}`, itemcode: 'SYNTH.003', lotcode: '27.F1', customername: 'Steady Reserve', quantityordered: '0' })),
    demandSocRows: Array.from({ length: 8 }, (_, i) => ({ unique_id: `steady-order-${i}`, itemcode: 'SYNTH.003', lotcode: '27.F1', customername: 'Steady Order', invoicedate: null, quantityordered: '4' }))
  });
  await expect(page.locator('#view-login')).toBeHidden();
  await page.locator('#home-tile-hl-order').click();
  await page.locator('[data-hl-group]').first().getByRole('button', { name: 'View HL order details', exact: true }).click();
  await page.locator('#hl-order-detail [data-hl-drive-location="C.12.001"] .app-drive-compact-card').click();
  await expect(page.locator('#view-detail')).toBeVisible();
  for (const [tab, panel] of [['customer', 'det-customer-panel'], ['open-orders', 'det-open-orders-panel']]) {
    const mobile = page.locator('#det-mobile-tab-select');
    if (await mobile.isVisible()) await mobile.selectOption(tab);
    else await page.locator(`#dtab-${tab}`).click();
    await expect(page.locator(`#${panel} [data-drive-demand-row]`)).toHaveCount(8);
    const reads = { ...fixture.demandReads };
    const trace = await page.evaluate(async id => {
      const root = document.getElementById(id)!;
      const first = root.querySelector('[data-drive-demand-row]');
      let replacements = 0;
      const observer = new MutationObserver(records => { replacements += records.filter(record => record.type === 'childList').length; });
      observer.observe(root, { childList: true, subtree: true });
      const cycles = [];
      for (let i = 0; i < 3; i++) {
        await window.eval('getProductionLiveSyncCoordinator().check("foreground-safeguard")');
        await new Promise<void>(resolve => {
          const settled = () => {
            if (window.eval('Object.keys(uiRenderTimers).concat(Object.keys(uiRenderFrames)).some(key => key.startsWith("drive-demand-display:"))')) setTimeout(settled, 20);
            else requestAnimationFrame(() => resolve());
          };
          settled();
        });
        cycles.push({ sameNode: first === root.querySelector('[data-drive-demand-row]'), replacements,
          state: window.eval('getProductionLiveSyncCoordinator().getStatus().state') });
      }
      observer.disconnect();
      return cycles;
    }, panel);
    await testInfo.attach(`${tab}-refresh-trace.json`, { body: JSON.stringify(trace), contentType: 'application/json' });
    expect(trace).toEqual(Array.from({ length: 3 }, () => ({ sameNode: true, replacements: 0, state: 'Up to date' })));
    expect(fixture.demandReads).toEqual(reads);
    // A changed imported line must still appear, even though its neighbor is
    // unchanged. Keep that neighbor attached through loading and reconciliation.
    await page.locator(`#${panel} [data-drive-demand-row]`).nth(3).evaluate(node => {
      (window as any).__retainedDemand = node;
      const scroll = document.getElementById('main-scroll-area')!;
      scroll.scrollTop += node.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const topBefore = await page.evaluate(() => (window as any).__retainedDemand.getBoundingClientRect().top);
    await page.locator('#main-scroll-area').dispatchEvent('pointerdown', { pointerId: 57, pointerType: 'touch', isPrimary: true, button: 0 });
    const rows = tab === 'customer' ? fixture.reserveRows : fixture.demandSocRows;
    rows.unshift({ ...rows[0], unique_id: `added-${tab}`, customername: 'Newly imported customer', quantityordered: '8' });
    fixture.datasetRevision++;
    await page.evaluate(() => window.eval('getProductionLiveSyncCoordinator().check("changed-demand")'));
    await expect(page.locator(`#${panel} [data-drive-demand-row]`)).toHaveCount(8);
    await expect(page.locator('[data-live-display-pending]')).not.toHaveCount(0);
    await page.locator('#main-scroll-area').dispatchEvent('pointerup', { pointerId: 57, pointerType: 'touch', isPrimary: true, button: 0 });
    await expect(page.locator(`#${panel} [data-drive-demand-row]`)).toHaveCount(9);
    expect(await page.evaluate(() => (window as any).__retainedDemand.isConnected)).toBe(true);
    await expect.poll(() => page.evaluate(before => Math.abs((window as any).__retainedDemand.getBoundingClientRect().top - before), topBefore)).toBeLessThanOrEqual(2);
    await expect(page.locator(`#${panel}`)).toContainText('Newly imported customer');
    const source = tab === 'customer' ? 'ph_reserves' : 'ph_soc_master';
    fixture.datasetSourceStates.set(source, 'unavailable');
    await page.evaluate(() => window.eval('getProductionLiveSyncCoordinator().check("denied-demand")'));
    await expect(page.locator(`#${panel} [data-drive-demand-row]`)).toHaveCount(0);
    fixture.datasetSourceStates.set(source, 'ready');
  }
  expect(fixture.blockedMutations).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

const itemCount = 18;

test('unchanged HL reads preserve detail and Bloom inputs and same-revision balance updates remain visible', async ({ page, baseURL }) => {
  await page.addInitScript(() => { Reflect.deleteProperty(window, 'PushManager'); });
  const fixture = await installHlOrderFixture(page, baseURL!);
  await expect(page.locator('#view-login')).toBeHidden();
  await page.locator('#home-tile-hl-order').click();
  await page.locator('[data-hl-group]').first().getByRole('button', { name: 'View HL order details', exact: true }).click();
  const detail = page.locator('#hl-order-detail');
  await expect(detail.locator('[data-hl-drive-location="C.12.001"] .app-drive-compact-card')).toBeVisible();
  await page.evaluate(() => window.eval('getProductionLiveSyncCoordinator().check("fixture-settle")'));
  await expect.poll(() => page.evaluate(() => window.eval('!productionLiveSyncRenderPending && !productionLiveSyncActiveRender'))).toBe(true);
  const unchanged = await page.evaluate(async () => {
    const node = document.getElementById('hl-order-detail');
    const input = node!.querySelector('[data-hl-quantity]');
    const render = window.eval('scheduleProductionLiveSyncRender');
    (window as any).__refreshSchedules = 0;
    (window as any).__originalRefreshSchedule = render;
    window.eval('scheduleProductionLiveSyncRender = function(...args) { window.__refreshSchedules++; return window.__originalRefreshSchedule(...args); }');
    for (let i = 0; i < 3; i++) {
      await window.eval('Promise.all([loadHlOrderState(true), loadHlOrderState(true), getProductionLiveSyncCoordinator().check("foreground-safeguard")])');
    }
    window.eval('scheduleProductionLiveSyncRender = window.__originalRefreshSchedule');
    return { sameNode: node === document.getElementById('hl-order-detail'), sameInput: input === document.querySelector('#hl-order-detail [data-hl-quantity]'), schedules: (window as any).__refreshSchedules };
  });
  expect(unchanged).toEqual({ sameNode: true, sameInput: true, schedules: 0 });
  const revision = fixture.state.revision;
  for (const balance of fixture.poBalances.values()) balance.remaining = 901;
  await page.evaluate(() => window.eval('loadHlOrderState(true)'));
  await expect(detail).toContainText('901');
  expect(fixture.state.revision).toBe(revision);
  await detail.locator('[data-hl-source-id="hl-b"] [data-hl-select]').uncheck();
  await detail.locator('[data-hl-source-id="hl-a"] [data-hl-quantity]').fill('6');
  await page.getByRole('button', { name: 'Order selected rows', exact: true }).click();
  const draft = page.locator('[data-hl-draft-source-id="hl-a"]');
  await expect(draft).toBeVisible();
  await draft.locator('[data-hl-draft-quantity]').fill('4');
  await draft.locator('[data-hl-draft-quantity]').evaluate(node => node.setAttribute('data-kept-input', 'yes'));
  for (let i = 0; i < 3; i++) await page.evaluate(() => window.eval('Promise.all([loadHlOrderState(true), getProductionLiveSyncCoordinator().check("foreground-safeguard")])'));
  await expect(draft.locator('[data-hl-draft-quantity]')).toHaveValue('4');
  await expect(draft.locator('[data-hl-draft-quantity]')).toHaveAttribute('data-kept-input', 'yes');
  expect(fixture.blockedMutations).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test('unchanged shared checks preserve Drive Tasks Que and Docks content', async ({ page, baseURL }) => {
  await page.addInitScript(() => { Reflect.deleteProperty(window, 'PushManager'); });
  const fixture = await installHlOrderFixture(page, baseURL!);
  await expect(page.locator('#view-login')).toBeHidden();
  for (const view of ['drive', 'tasks', 'request', 'docks']) {
    await page.locator(`[data-footer-view="${view}"]`).click();
    await expect(page.locator(`#view-${view}`)).toBeVisible();
    await page.evaluate(() => window.eval('getProductionLiveSyncCoordinator().check("fixture-settle")'));
    await expect.poll(() => page.evaluate(() => window.eval('!productionLiveSyncRenderPending && !productionLiveSyncActiveRender'))).toBe(true);
    const result = await page.evaluate(async view => {
      const root = document.getElementById(window.eval('VIEW_LOAD_UI')[view].container)!;
      const first = root.firstElementChild;
      const reads = window.eval('getProductionLiveSyncCoordinator().getStatistics().adapterReads');
      for (let i = 0; i < 3; i++) await window.eval('getProductionLiveSyncCoordinator().check("foreground-safeguard")');
      return { populated: !!first, sameNode: first === root.firstElementChild, downloads: window.eval('getProductionLiveSyncCoordinator().getStatistics().adapterReads') - reads, state: window.eval('getProductionLiveSyncCoordinator().getStatus().state') };
    }, view);
    expect(result, view).toEqual({ populated: true, sameNode: true, downloads: 0, state: 'Up to date' });
  }
  expect(fixture.blockedMutations).toEqual([]);
});
// LowStock shows current-F1 itemcodes through their valid support-season rows.
// Keep one F1 low-stock row and one U1 support row for every visual card.
const inventory = Array.from({ length: itemCount }, (_, index) => {
  const itemcode = `EVAL2.${String(index + 1).padStart(3, '0')}`;
  const commonname = `Refresh Anchor ${String(index + 1).padStart(2, '0')}`;
  const shared = { itemcode, commonname, contsize: '#3', locationcode: 'A.01.001', blockalpha: 'A', blocknumber: '01', saleyear: '27', priority: '' };
  return [
    hlMaster(`eval2-f1-${index + 1}`, { ...shared, lotcode: '27.F1', season: 'F1', s_lts: '1', ptronhand: '1', ptravailable: '1' }),
    hlMaster(`eval2-u1-${index + 1}`, { ...shared, lotcode: '26.U1', season: 'U1', saleyear: '26', s_lts: '999', ptronhand: '1', ptravailable: '1' })
  ];
}).flat();
const assignments = inventory.map((row, index) => ({
  unique_id: `assignment-${index + 1}`, itemcode: row.itemcode, genusname: row.genusname,
  contsize: row.contsize, locationcode: row.locationcode, warehouseid: row.warehouseid,
  assignedto: 'dylan_collyge'
}));

async function installAssignmentsRoute(page: any) {
  await page.route('**/rest/v1/ph_warehouse_assigned_items**', async (route: any) => {
    await route.fulfill({ status: 200, contentType: 'application/json', headers: {
      'content-range': `0-${Math.max(0, assignments.length - 1)}/${assignments.length}`,
      'access-control-expose-headers': 'content-range'
    }, body: JSON.stringify(assignments) });
  });
}

async function installCodexCapabilitiesRoute(page: any) {
  await page.route('**/functions/v1/codex-ops-api', async (route: any) => {
    const body = route.request().postDataJSON() || {};
    if (body.action !== 'capabilities') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      contractVersion: 'mobile-codex-ops-v1', username: 'dylan_collyge',
      canView: true, canSubmit: false, canApprove: false,
      submissionEnabled: false, deploymentEnabled: false
    }) });
  });
}

async function openLowStockLocationCards(page: any) {
  // The fixture starts at Home. Force the real guarded loader after installing
  // the authoritative assignment source, so this test does not depend on an
  // unrelated Home warm-up completing first.
  const loaded = await page.evaluate(() => window.eval(`(async () => {
    await ensureDatasetLoaded('master', 'full', { force: true, preserveRequestedMode: true });
    await ensureDatasetLoaded('warehouseAssignedItems', 'full', { force: true, preserveRequestedMode: true });
    invalidateManagerEvalReport2Cache();
    return { master: fullInventory.length, assignments: warehouseAssignedItemsInventory.length };
  })()`));
  expect(loaded).toEqual({ master: inventory.length, assignments: assignments.length });
  await page.locator('#home-tile-managers').click();
  await expect(page.locator('#view-managers')).toBeVisible();
  await page.getByRole('button', { name: /Eval Reports #2/i }).click();
  const picker = page.locator('[data-manager-eval2-report-picker]');
  await expect(picker).toBeVisible();
  const lowStock = picker.locator('input[data-eval2-report-id][value="low-stock"]');
  // A live shell render can replace the picker while it first becomes ready.
  // Retry the same visible user interaction, never a forced/hidden checkbox.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await picker.locator('summary').click();
    try {
      await expect(picker).toHaveAttribute('open', '', { timeout: 3_000 });
      await expect(lowStock).toBeVisible({ timeout: 3_000 });
      await lowStock.check({ timeout: 3_000 });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  await picker.getByRole('button', { name: 'Apply Reports', exact: true }).click();
  await expect(page.locator('#manager-eval-report-2-view-location')).toBeVisible();
  await page.locator('#manager-eval-report-2-view-location').click();
  await expect(page.locator('[data-manager-eval2-drill-kind="blockalpha"]')).toHaveCount(1);
  await page.locator('[data-manager-eval2-drill-kind="blockalpha"]').click();
  await expect(page.locator('[data-manager-eval2-drill-kind="locationcode"]')).toHaveCount(1);
  await page.locator('[data-manager-eval2-drill-kind="locationcode"]').click();
  await expect(page.locator('.manager-eval2-item-card')).toHaveCount(itemCount);
  await expect(page.locator('[data-role="manager-eval2-auto-load-status"]')).toHaveText(`All ${itemCount} matching ITEMCODEs loaded`);
  await expect.poll(() => page.evaluate(() => window.eval(`!productionLiveSyncRenderPending && !productionLiveSyncActiveRender`))).toBe(true);
  await page.evaluate(() => document.fonts?.ready);
  await expect.poll(() => page.evaluate(() => Array.from(document.querySelectorAll('.manager-eval2-item-card')).every((card: Element) =>
    !card.matches(':active') && card.getAnimations().every(animation => animation.playState !== 'running')))).toBe(true);
}

async function setupEval2Location(page: any, baseURL: string) {
  const fixture = await installHlOrderFixture(page, baseURL, { master: inventory.map(row => ({ ...row })), startupMode: 'restored' });
  await installAssignmentsRoute(page);
  await installCodexCapabilitiesRoute(page);
  await openLowStockLocationCards(page);
  return fixture;
}

test('verified background refresh keeps Eval Reports #2 LowStock location cards and their scroll anchor', async ({ page, baseURL }, testInfo) => {
  const fixture = await setupEval2Location(page, baseURL!);
  // Scrolling changes the hovered card on desktop. Wait for that interaction's
  // real transform transition before measuring a settled refresh anchor.
  await page.evaluate(() => { document.getElementById('main-scroll-area')!.scrollTop = 420; });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect.poll(() => page.evaluate(() => Array.from(document.querySelectorAll('.manager-eval2-item-card')).every((card: Element) =>
    !card.matches(':active') && card.getAnimations().every(animation => animation.playState !== 'running')))).toBe(true);

  const before = await page.evaluate(() => window.eval(`(() => {
    const scroller = document.getElementById('main-scroll-area');
    const cards = Array.from(document.querySelectorAll('.manager-eval2-item-card'));
    const bounds = scroller.getBoundingClientRect();
    const first = cards.find((card) => card.getBoundingClientRect().bottom > bounds.top);
    const anchor = first?.querySelector('.text-lg')?.textContent?.trim() || '';
    const anchorTop = first ? first.getBoundingClientRect().top - bounds.top : null;
    window.__eval2RefreshProbe = { cards, anchor, anchorTop, scrollTop: scroller.scrollTop };
    return { anchor, anchorTop, scrollTop: scroller.scrollTop, drill: managerEvalReport2DrillLevel, location: managerEvalReport2SelectedLocationCode };
  })()`));
  expect(before.drill).toBe(2);
  expect(before.location).toBe('A.01.001');
  expect(before.anchor).toContain('Refresh Anchor');

  // Keep the production implementation intact, but record the exact anchor
  // lifecycle so a sub-pixel miss can distinguish a late layout shift from
  // transformed scroll geometry.
  await page.evaluate(() => window.eval(`(() => {
    const diagnostic = [];
    const snapshot = (phase, anchor = null) => {
      const scroller = document.getElementById('main-scroll-area');
      const root = document.getElementById('managers-content');
      const bounds = scroller?.getBoundingClientRect();
      const cards = Array.from(root?.querySelectorAll('.manager-eval2-item-card') || []);
      const first = cards.find((card) => card.getBoundingClientRect().bottom > bounds.top);
      const firstStyle = first ? getComputedStyle(first) : null;
      const ancestors = [];
      for (let node = first; node && ancestors.length < 15; node = node.parentElement) {
        const style = getComputedStyle(node);
        ancestors.push({ node: node.tagName + (node.id ? '#' + node.id : ''), transform: style.transform, zoom: style.zoom, position: style.position, overflowY: style.overflowY });
      }
      diagnostic.push({ phase, at: performance.now(), anchor: anchor && { top: anchor.top, anchors: anchor.anchors },
        scrollTop: scroller?.scrollTop, scrollHeight: scroller?.scrollHeight, clientHeight: scroller?.clientHeight,
        scrollerTop: bounds?.top, firstKey: first?.getAttribute('data-manager-eval2-selection-key'),
        firstTop: first ? first.getBoundingClientRect().top - bounds.top : null,
        firstOffsetTop: first?.offsetTop, firstOffsetHeight: first?.offsetHeight,
        firstTransform: firstStyle?.transform, firstTransition: firstStyle?.transition,
        firstActive: first?.matches(':active') || false,
        firstAnimations: first?.getAnimations().map(animation => ({ playState: animation.playState, currentTime: animation.currentTime })) || [],
        ancestors });
    };
    const capture = captureProductionRefreshAnchor;
    const restore = restoreProductionRefreshAnchor;
    const finish = finishProductionRefresh;
    captureProductionRefreshAnchor = function(view) {
      const anchor = capture.call(this, view);
      snapshot('capture', anchor);
      return anchor;
    };
    restoreProductionRefreshAnchor = function(anchor) {
      snapshot('restore:before', anchor);
      const result = restore.call(this, anchor);
      snapshot('restore:after', anchor);
      requestAnimationFrame(() => snapshot('restore:raf', anchor));
      return result;
    };
    finishProductionRefresh = function(refresh) {
      snapshot('finish:before');
      const result = finish.call(this, refresh);
      snapshot('finish:after');
      requestAnimationFrame(() => snapshot('finish:raf'));
      return result;
    };
    window.__eval2AnchorDiagnostic = diagnostic;
    window.__eval2AnchorDiagnosticSnapshot = snapshot;
  })()`));
  await page.evaluate(() => window.eval(`window.__eval2AnchorDiagnosticSnapshot('before-unchanged')`));

  const readRefreshState = () => page.evaluate(() => window.eval(`(() => {
    const scroller = document.getElementById('main-scroll-area');
    const cards = Array.from(document.querySelectorAll('.manager-eval2-item-card'));
    const bounds = scroller.getBoundingClientRect();
    const first = cards.find((card) => card.getBoundingClientRect().bottom > bounds.top);
    return {
      drill: managerEvalReport2DrillLevel,
      location: managerEvalReport2SelectedLocationCode,
      cardCount: cards.length,
      anchor: first?.querySelector('.text-lg')?.textContent?.trim() || '',
      anchorDelta: first ? Math.abs((first.getBoundingClientRect().top - bounds.top) - window.__eval2RefreshProbe.anchorTop) : null,
      scrollDelta: Math.abs(scroller.scrollTop - window.__eval2RefreshProbe.scrollTop)
    };
  })()`));
  const unchanged = await page.evaluate(() => window.eval(`(async () => {
    await getProductionLiveSyncCoordinator().check('eval2-unchanged-metadata');
    const cards = Array.from(document.querySelectorAll('.manager-eval2-item-card'));
    return {
      drill: managerEvalReport2DrillLevel,
      location: managerEvalReport2SelectedLocationCode,
      sameFirstNode: cards[0] === window.__eval2RefreshProbe.cards[0]
    };
  })()`));
  expect(unchanged).toEqual({ drill: 2, location: 'A.01.001', sameFirstNode: true });
  await expect.poll(() => page.evaluate(() => window.eval(`!productionLiveSyncRenderPending && !productionLiveSyncActiveRender`))).toBe(true);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => window.eval(`window.__eval2AnchorDiagnosticSnapshot('after-unchanged')`));
  const afterUnchanged = await readRefreshState();
  const unchangedDiagnostic = await page.evaluate(() => window.eval(`window.__eval2AnchorDiagnostic || []`));
  await testInfo.attach('eval2-unchanged-refresh.json', { body: JSON.stringify({ before, afterUnchanged, diagnostic: unchangedDiagnostic }, null, 2), contentType: 'application/json' });
  expect(afterUnchanged.anchor).toBe(before.anchor);
  expect(afterUnchanged.anchorDelta).not.toBeNull();
  expect(afterUnchanged.anchorDelta).toBeLessThanOrEqual(2);

  // Use the real progressive-delivery function and current guarded source
  // payload. This bypasses unrelated Dylan-only side-panel reads while still
  // exercising the warehouse snapshot that previously reset this drill.
  await page.evaluate(() => window.eval(`(() => {
    const context = getProductionLiveSyncContext();
    context.progressive = true; context.visible = true;
    previewProductionSnapshots([
      { adapter: { id: 'core:warehouseAssignedItems' }, value: { payload: { warehouseAssignedItemsData: warehouseAssignedItemsInventory.map((row) => ({ ...row })) } } }
    ], context);
  })()`));

  const immediate = await readRefreshState();
  // The original regression reset navigation synchronously at preview time.
  expect(immediate.drill).toBe(2);
  expect(immediate.location).toBe('A.01.001');

  await expect.poll(() => page.evaluate(() => window.eval(`!productionLiveSyncRenderPending && !productionLiveSyncActiveRender`))).toBe(true);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const after = await readRefreshState();
  const diagnostic = await page.evaluate(() => window.eval(`window.__eval2AnchorDiagnostic || []`));
  await testInfo.attach('eval2-background-preview.json', { body: JSON.stringify({ before, unchanged, afterUnchanged, immediate, after, diagnostic }, null, 2), contentType: 'application/json' });
  expect(after.cardCount).toBe(itemCount);
  expect(after.anchor).toBe(before.anchor);
  expect(after.anchorDelta).not.toBeNull();
  expect(after.anchorDelta).toBeLessThanOrEqual(2);
  expect(fixture.blockedMutations).toEqual([]);
});

test('touch-held Eval Reports #2 refresh keeps location cards in place until the gesture ends', async ({ page, baseURL }, testInfo) => {
  test.skip(!/(android|iphone)/.test(testInfo.project.name), 'exercise the touch-specific scheduler on mobile profiles');
  const fixture = await setupEval2Location(page, baseURL!);
  const scroller = page.locator('#main-scroll-area');
  await page.evaluate(() => window.eval(`(() => {
    const scroller = document.getElementById('main-scroll-area');
    scroller.scrollTop = 420;
    const cards = Array.from(document.querySelectorAll('.manager-eval2-item-card'));
    const bounds = scroller.getBoundingClientRect();
    const first = cards.find((card) => card.getBoundingClientRect().bottom > bounds.top);
    window.__eval2GestureProbe = {
      key: first?.getAttribute('data-manager-eval2-selection-key') || '',
      anchor: first?.textContent || '',
      top: first?.getBoundingClientRect().top - bounds.top,
      node: first
    };
  })()`));
  await scroller.dispatchEvent('pointerdown', { pointerId: 47, pointerType: 'touch', isPrimary: true, button: 0 });
  // Deliver a real, complete revision while touch is active. A raw progressive
  // preview deliberately cannot make Eval2's edit-safe derived index current.
  fixture.master.splice(0, fixture.master.length, ...fixture.master.map((row: any) => ({ ...row, ptravailable: '9', ptronhand: '9' })));
  fixture.datasetRevision += 1;
  await page.evaluate(() => window.eval(`getProductionLiveSyncCoordinator().check('eval2-touch-held-change')`));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const held = await page.evaluate(() => window.eval(`(() => {
    const card = document.querySelector('[data-manager-eval2-selection-key="' + CSS.escape(window.__eval2GestureProbe.key) + '"]');
    return { drill: managerEvalReport2DrillLevel, location: managerEvalReport2SelectedLocationCode,
      sameVisibleNode: card === window.__eval2GestureProbe.node, firstText: card?.textContent || '' };
  })()`));
  expect(held.drill).toBe(2);
  expect(held.location).toBe('A.01.001');
  expect(held.sameVisibleNode).toBe(true);
  expect(held.firstText).not.toContain('9');

  await scroller.dispatchEvent('pointerup', { pointerId: 47, pointerType: 'touch', isPrimary: true, button: 0 });
  await expect.poll(() => page.evaluate(() => window.eval(`!productionLiveSyncRenderPending && !productionLiveSyncActiveRender`))).toBe(true);
  const released = await page.evaluate(() => window.eval(`(() => {
    const scroller = document.getElementById('main-scroll-area'), bounds = scroller.getBoundingClientRect();
    const first = document.querySelector('[data-manager-eval2-selection-key="' + CSS.escape(window.__eval2GestureProbe.key) + '"]');
    return { drill: managerEvalReport2DrillLevel, location: managerEvalReport2SelectedLocationCode,
      firstText: first?.textContent || '', anchorDelta: Math.abs((first?.getBoundingClientRect().top - bounds.top) - window.__eval2GestureProbe.top) };
  })()`));
  expect(released.drill).toBe(2);
  expect(released.location).toBe('A.01.001');
  expect(released.firstText).toContain('9');
  expect(released.anchorDelta).toBeLessThanOrEqual(2);
  expect(fixture.blockedMutations).toEqual([]);
});

test('only a complete verified refresh may leave a removed Eval Reports #2 location', async ({ page, baseURL }) => {
  const fixture = await setupEval2Location(page, baseURL!);
  // Progressive preview may show newer source data, but must retain the drill
  // until the complete verified reconciliation can prove this branch vanished.
  const previewState = await page.evaluate(() => window.eval(`(() => {
    const context = getProductionLiveSyncContext(); context.progressive = true; context.visible = true;
    previewProductionSnapshots([
      { adapter: { id: 'core:master' }, value: { payload: { data: [] } } },
      { adapter: { id: 'core:warehouseAssignedItems' }, value: { payload: { warehouseAssignedItemsData: warehouseAssignedItemsInventory.map((row) => ({ ...row })) } } }
    ], context);
    return { drill: managerEvalReport2DrillLevel, location: managerEvalReport2SelectedLocationCode };
  })()`));
  expect(previewState).toEqual({ drill: 2, location: 'A.01.001' });
  fixture.master.splice(0, fixture.master.length);
  fixture.datasetRevision += 1;
  await page.evaluate(() => window.eval(`getProductionLiveSyncCoordinator().check('eval2-location-removed')`));
  await expect(page.locator('#live-data-freshness')).toContainText('Up to date');
  await expect.poll(() => page.evaluate(() => window.eval(`managerEvalReport2DrillLevel`))).toBe(0);
  await expect(page.locator('[data-manager-eval2-drill-kind="blockalpha"]')).toHaveCount(0);
  expect(fixture.blockedMutations).toEqual([]);
});
