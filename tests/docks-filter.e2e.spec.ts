import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const expectedRelease = `V${JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version}`;
const moduleHashes = new Map(['registry', 'adapters', 'coordinator'].map(name => {
  const path = `/assets/live-sync-${name}.js`;
  return [path, createHash('sha256').update(readFileSync(new URL(`..${path}`, import.meta.url))).digest('hex')];
}));

type Row = Record<string, string>;
const row = (id: string, customer: string, dock = '28'): Row => ({
  UNIQUE_ID: `isolated-filter-${id}`, ITEMCODE: `SYNTHETIC-${id}`, COMMONNAME: 'Synthetic filter fixture',
  CUSTOMERNAME: customer, SALESREPNAME: 'Fixture Rep', DOCK_NUM: dock, TRIPNUMBER: dock === '29' ? '37232' : '37231',
  PLANSTARTDATE: '2026-09-08', STOPNUMBER: '1', LOCATIONCODE: 'B.01.000', LOTCODE: '27.F1',
  SEASON: 'F1', SALESYEAR: '27', CONTSIZE: '#3', QUANTITYORDERED: '1', PTRONHAND: '10',
  PTRAVAILABLE: '10', S_LTS: '10', LAST_UPDATED: '2026-09-08T16:00:00Z'
});
const dock28 = [
  ...Array.from({ length: 55 }, (_, i) => row(`selected-${i}`, `Selected ${i % 4}`)),
  ...Array.from({ length: 62 }, (_, i) => row(`other-${i}`, 'Other Customer'))
];
const newDock29 = Array.from({ length: 32 }, (_, i) => row(`new-${i}`, 'New Customer', '29'));

/** Exercises the published-shell renderer and real saved filter handlers.
 * Inventory arrives through an isolated fixture boundary; ALL business requests
 * and WebSockets are blocked before navigation, including in remote mode.
 */
async function harness(page: Page, baseURL: string, rows: Row[], customCustomers?: string[]) {
  const origin = new URL(baseURL).origin;
  const errors: string[] = [];
  const runtime: string[] = [];
  const loadedModules = new Map<string, string>();
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (/\/assets\/live-app-runtime[^/]*\.js/.test(path)) runtime.push(response.url());
    if (moduleHashes.has(path)) response.body().then(body => loadedModules.set(path, createHash('sha256').update(body).digest('hex'))).catch(error => errors.push(`Module response unavailable: ${error.message}`));
  });
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (!['GET', 'HEAD'].includes(request.method()) || url.origin !== origin) return route.abort('blockedbyclient');
    return route.continue();
  });
  await page.routeWebSocket('**/*', socket => socket.close());
  const seed = async (nextRows: Row[] = rows, initialCustomers?: string[]) => {
    await page.waitForFunction(() => typeof (window as any).installMutationBlockedAccessCanaryIdentity === 'function');
    await page.evaluate(({ fixtureRows, customers }) => {
      (window as any).__dockFilterFixture = { rows: fixtureRows, customers };
      window.eval(`(() => {
        installMutationBlockedAccessCanaryIdentity('dylan_collyge', 'Isolated Docks Filter Test', 'ADMIN');
        const fixture = window.__dockFilterFixture;
        Object.keys(DATASET_DEFINITIONS).forEach(key => {
          const state = getDatasetState(key);
          state.initialLoaded = state.fullLoaded = true;
          state.lastLoadedAt = new Date().toISOString();
        });
        ensureViewDataForRender = () => false;
        loadDatasetTargetsWithLimit = async () => false;
        dockTeamStatusLoaded = dockItemProgressLoaded = dockIssueDataLoaded = true;
        dockTeamSchemaReady = dockItemSchemaReady = dockIssueStatusSchemaReady = dockIssueAllocationSchemaReady = true;
        if (fixture.customers) restoreDockRepCustomerFilterState({ selectedDockCustomers: fixture.customers });
        else {
          const saved = readAppFilterStateSnapshot();
          restoreDockRepCustomerFilterState(saved && saved.docks || {});
        }
        processAndLoadData({socData: fixture.rows, data: [], requestsData: [], _fromCache: true});
        document.getElementById('view-login').style.setProperty('display', 'none', 'important');
        document.getElementById('app-wrapper').classList.remove('hidden');
        dockViewMode = 'docks'; dockViewLevel = 0; selectedDockNum = selectedDockStop = null;
        document.getElementById('docks-search').value = '';
        showOnlyPrimaryView('docks');
        invalidateResolvedViewStateCaches();
        renderDocks();
      })()`);
    }, { fixtureRows: nextRows, customers: initialCustomers });
    await expect(page.locator('#view-docks')).toBeVisible();
  };
  await page.goto('/?post_deploy_access_canary=1&docks_filter_canary=1', { waitUntil: 'load' });
  await seed(rows, customCustomers);
  expect(runtime).toHaveLength(1);
  expect(await page.evaluate(() => window.eval('APP_SHELL_VERSION'))).toBe(expectedRelease);
  await expect.poll(() => loadedModules.size).toBe(moduleHashes.size);
  for (const [path, digest] of moduleHashes) expect(loadedModules.get(path), `Published source mismatch: ${path}`).toBe(digest);
  const importRows = async (nextRows: Row[]) => {
    await page.evaluate(data => {
      (window as any).__dockFilterImport = data;
      window.eval(`processAndLoadData({socData:window.__dockFilterImport,_fromCache:true}); renderDocks();`);
    }, nextRows);
  };
  return { seed, importRows, assertClean: () => expect(errors).toEqual([]) };
}

test('two sessions retain local choices, converge after clear, and keep All inclusive after import/relaunch', async ({ page, browser, baseURL }, testInfo) => {
  // A separate context is essential: filters are intentionally isolated per device.
  const use = testInfo.project.use;
  const secondContext = await browser.newContext({ baseURL, viewport: use.viewport, userAgent: use.userAgent,
    isMobile: use.isMobile, hasTouch: use.hasTouch, deviceScaleFactor: use.deviceScaleFactor, serviceWorkers: 'block' });
  const other = await secondContext.newPage();
  try {
    const all = await harness(page, baseURL!, dock28);
    const custom = await harness(other, baseURL!, dock28, ['Selected 0', 'Selected 1', 'Selected 2', 'Selected 3']);
    await expect(page.locator('[data-dock-filter-counts]')).toContainText('Showing 117 of 117');
    await expect(other.locator('[data-dock-filter-counts]')).toContainText('Showing 55 of 117');
    const imported = [...dock28, ...newDock29];
    await Promise.all([all.importRows(imported), custom.importRows(imported)]);
    await expect(page.locator('[data-dock-filter-counts]')).toContainText('Showing 149 of 149');
    await expect(other.locator('[data-dock-filter-counts]')).toContainText('Showing 55 of 149');
    await expect(other.locator('[data-dock-filter-counts]')).toContainText('1 dock hidden by filters');
    await expect(other.locator('[data-dock-active-filter-chips]')).toContainText('Customers: 4 selected');
    const filterBounds = await other.locator('[data-dock-filter-status]').evaluate(element => {
      const rect = element.getBoundingClientRect();
      const controls = document.getElementById('docks-filter-controls')!.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, controlsBottom: controls.bottom, viewport: window.innerWidth };
    });
    expect(filterBounds.left).toBeGreaterThanOrEqual(0);
    expect(filterBounds.right).toBeLessThanOrEqual(filterBounds.viewport + 1);
    expect(filterBounds.top, 'Summary must be below controls, not squeeze them into its row').toBeGreaterThanOrEqual(filterBounds.controlsBottom - 1);
    expect(await other.locator('[data-dock-filter-shell="customer"] > button').evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(44);
    await other.screenshot({ path: testInfo.outputPath('docks-custom-filter.png') });
    await other.getByRole('button', { name: 'Clear Docks filters', exact: true }).click();
    await expect(other.locator('[data-dock-filter-counts]')).toContainText('Showing 149 of 149');
    await other.reload({ waitUntil: 'load' });
    await custom.seed(imported);
    await expect(other.locator('[data-dock-customer-summary]')).toHaveText('All Customers');
    const latest = [...imported, row('late-new', 'Another New Customer', '30')];
    await custom.importRows(latest);
    await expect(other.locator('[data-dock-filter-counts]')).toContainText('Showing 150 of 150');
    all.assertClean(); custom.assertClean();
  } finally {
    await secondContext.close();
  }
});

async function enableNativeCoordinator(page: Page, rows: Row[]) {
  await page.evaluate(data => {
    (window as any).__nativeSyncFixture = { rows: data, revision: '1', state: 'ready', readFailure: false, reads: [], revisionReads: 0 };
    window.eval(`(() => {
      const fixture = window.__nativeSyncFixture;
      nativeAuthSessionActive = true;
      nativeAuthProfile = { id: 'synthetic-dylan-live-sync', username: 'dylan_collyge', role: 'ADMIN', active: true };
      nativeAuthAccessToken = 'synthetic-not-a-real-token';
      fetchAllSupabaseRows = async (table) => {
        fixture.reads.push(table);
        if (table === 'ph_app_settings') return [{key:'current_season_salesyear', value:{seasonCode:'F1',salesYear:'27'}}];
        const snapshot = table === 'ph_soc_master' ? structuredClone(fixture.rows) : [];
        if (table === 'ph_soc_master' && fixture.gate) await fixture.gate;
        return snapshot;
      };
      supabaseRpc = async (name, payload) => {
        if (name !== 'get_my_dataset_revisions_v1') throw new Error('UNEXPECTED_FIXTURE_RPC:' + name);
        fixture.revisionReads++;
        if (fixture.readFailure) throw new Error('Synthetic revision connection failure');
        return { contractVersion: 1, permissionVersion: 'fixture-access-1', serverTime: new Date().toISOString(),
          sources: payload.p_dataset_keys.map(key => ({ key, revision: key === 'ph_soc_master' ? fixture.revision : '1', state: key === 'ph_soc_master' ? fixture.state : 'ready' })) };
      };
      runDockTripStatusRequest = async () => ({ ok: true, data: [] });
      chatApiGet = async () => [];
      evalWorkApi = async operation => {
        if (operation !== 'list') throw new Error('Unexpected Eval mutation in fixture');
        return {ok:true, data:[], manager:true};
      };
      shearLocationWorkApi = async operation => {
        if (operation !== 'list') throw new Error('Unexpected Shear mutation in fixture');
        return {ok:true, data:[]};
      };
      const originalFixtureSupabaseFetch = supabaseFetch;
      supabaseFetch = async (table, method, ...args) => {
        if (table === 'ph_app_users' && method === 'GET') return [];
        return originalFixtureSupabaseFetch(table, method, ...args);
      };
      getSupabaseBrowserClient = () => ({
        channel: () => {
          const channel = {
            on: (_event, _filter, callback) => { fixture.changed = callback; return channel; },
            subscribe: callback => { fixture.reconnected = () => callback('SUBSCRIBED'); return channel; }
          };
          return channel;
        }, removeChannel: async () => {}
      });
      resetProductionLiveSync();
      getProductionLiveSyncCoordinator().check('fixture-native-entry');
    })()`);
  }, rows);
  await expect(page.locator('#live-data-freshness')).toContainText('Data Current');
  const headerGeometry = await page.locator('#live-data-freshness').evaluate(element => {
    const rect = element.getBoundingClientRect();
    const obscured = ['global-header-inline-back', 'docks-search', ...Array.from(document.querySelectorAll('#global-header-search-slot [id$="-clear"]')).map(el => el.id)].filter(id => {
      const target = document.getElementById(id);
      if (!target || !target.getClientRects().length) return false;
      const targetRect = target.getBoundingClientRect();
      return [0.2, 0.5, 0.8].some(x => [0.2, 0.5, 0.8].some(y => {
        const hit = document.elementFromPoint(targetRect.left + targetRect.width * x, targetRect.top + targetRect.height * y);
        return !!hit?.closest('#live-data-freshness');
      }));
    });
    return {right:rect.right, parent:element.parentElement?.id, position:getComputedStyle(element).position, obscured};
  });
  expect(headerGeometry.parent).toBe('side-drawer');
  expect(headerGeometry.position).toBe('static');
  expect(headerGeometry.right, 'Closed Menu must keep the status offscreen').toBeLessThanOrEqual(1);
  expect(headerGeometry.obscured, 'Freshness status must not cover search, X or Back').toEqual([]);
  await page.screenshot({path:test.info().outputPath('native-freshness-header.png')});
}

test('native shared coordinator preserves filtered sessions, stages import races and resumes after a lost connection', async ({ page, browser, baseURL }, testInfo) => {
  const use = testInfo.project.use;
  const secondContext = await browser.newContext({ baseURL, viewport: use.viewport, userAgent: use.userAgent,
    isMobile: use.isMobile, hasTouch: use.hasTouch, deviceScaleFactor: use.deviceScaleFactor, serviceWorkers: 'block' });
  const other = await secondContext.newPage();
  try {
    const all = await harness(page, baseURL!, dock28);
    const custom = await harness(other, baseURL!, dock28, ['Selected 0', 'Selected 1', 'Selected 2', 'Selected 3']);
    await enableNativeCoordinator(page, dock28);
    await enableNativeCoordinator(other, dock28);
    const counts = (p: Page) => p.locator('[data-dock-filter-counts]');
    const reads = () => page.evaluate(() => (window as any).__nativeSyncFixture.reads.length);
    const before = await reads();
    await page.evaluate(() => window.eval('getProductionLiveSyncCoordinator().check("unchanged-fixture")'));
    expect(await reads(), 'unchanged revisions should not redownload inventory').toBe(before);
    const imported = [...dock28, ...newDock29];
    for (const p of [page, other]) {
      await p.evaluate(data => {
        const fixture = (window as any).__nativeSyncFixture;
        fixture.rows = data; fixture.revision = '2'; fixture.state = 'importing'; fixture.changed();
      }, imported);
      await expect(p.locator('#live-data-freshness')).toContainText('Data Updating');
    }
    await expect(counts(page)).toContainText('Showing 117 of 117');
    await expect(counts(other)).toContainText('Showing 55 of 117');
    for (const p of [page, other]) {
      await p.evaluate(() => { const fixture = (window as any).__nativeSyncFixture; fixture.state = 'ready'; fixture.changed(); });
      await expect(p.locator('#live-data-freshness')).toContainText('Data Current');
    }
    await expect(counts(page)).toContainText('Showing 149 of 149');
    await expect(counts(other)).toContainText('Showing 55 of 149');
    // Freeze the first changed snapshot, update its revision while it is in flight.
    await page.evaluate(() => {
      const fixture = (window as any).__nativeSyncFixture;
      fixture.revision = '3';
      fixture.rows = fixture.rows.slice(0, 1);
      fixture.gate = new Promise<void>(resolve => { fixture.release = resolve; });
      fixture.changed();
    });
    await expect(page.locator('#live-data-freshness')).toContainText('Data Updating');
    await expect(counts(page)).toContainText('Showing 149 of 149');
    await page.evaluate(data => {
      const fixture = (window as any).__nativeSyncFixture;
      fixture.rows = data; fixture.revision = '4'; const release = fixture.release; fixture.gate = null; release();
    }, [...imported, row('latest', 'Newest Customer', '30')]);
    await expect(counts(page)).toContainText('Showing 150 of 150');
    await expect.poll(() => page.evaluate(() => window.eval('getProductionLiveSyncCoordinator().getStatistics().discardedLoads'))).toBeGreaterThan(0);
    await page.evaluate(() => {
      (window as any).__nativeSyncFixture.readFailure = true;
      window.dispatchEvent(new Event('focus'));
    });
    await expect(page.locator('#live-data-freshness')).toContainText('Data Update Needs Attention');
    await expect(counts(page)).toContainText('Showing 150 of 150');
    await page.locator('#footer-menu-btn').click();
    const statusButton = page.locator('#side-drawer #live-data-freshness');
    await expect(page.locator('#side-drawer')).toHaveClass(/open/);
    await statusButton.scrollIntoViewIfNeeded();
    const revisionReads = await page.evaluate(() => (window as any).__nativeSyncFixture.revisionReads);
    await statusButton.click();
    await expect.poll(() => page.evaluate(() => (window as any).__nativeSyncFixture.revisionReads)).toBeGreaterThan(revisionReads);
    await expect(statusButton).toContainText('Data Update Needs Attention');
    await expect(page.locator('#toast-notification')).toContainText('Retrying the data check');
    await page.evaluate(() => window.eval('setMenuOpenState(false)'));
    await page.evaluate(() => {
      (window as any).__nativeSyncFixture.readFailure = false;
      (window as any).__nativeSyncFixture.reconnected();
    });
    await expect(page.locator('#live-data-freshness')).toContainText('Data Current');
    await expect(other.locator('[data-dock-customer-summary]')).toHaveText('Custom · 4 selected');
    all.assertClean(); custom.assertClean();
  } finally {
    await secondContext.close();
  }
});

test('real customer controls expose empty Custom, All and device-saved selections', async ({ page, baseURL }) => {
  const app = await harness(page, baseURL!, [row('a', 'Customer A'), row('b', 'Customer B', '29')]);
  await page.locator('[data-dock-filter-shell="customer"] > button').click();
  const sheet = page.locator('#dock-mobile-filter-sheet');
  const panel = page.locator('[data-dock-customer-panel]');
  const options = await sheet.isVisible() ? sheet : panel;
  await options.getByRole('button', { name: 'None', exact: true }).click();
  await options.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('[data-dock-customer-summary]')).toHaveText('Custom · 0 selected');
  await expect(page.locator('[data-dock-filter-counts]')).toContainText('Showing 0 of 2');
  await expect(page.locator('[data-dock-filter-status]')).toContainText('Saved on this device');
  await page.reload({ waitUntil: 'load' });
  await app.seed([row('a', 'Customer A'), row('b', 'Customer B', '29')]);
  await expect(page.locator('[data-dock-customer-summary]')).toHaveText('Custom · 0 selected');
  await page.getByRole('button', { name: 'Clear Docks filters', exact: true }).click();
  await expect(page.locator('[data-dock-filter-counts]')).toContainText('Showing 2 of 2');
  app.assertClean();
});

for (const width of [320, 390, 1280]) {
  test(`Menu data status never intercepts search X or Sales Office Back at ${width}px`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height: 900 });
    const app = await harness(page, baseURL!, [row('header', 'Customer A')]);
    // The coordinator integration above tests real failure/retry semantics. This
    // independent layout fixture supplies its statuses directly without starting
    // a second permission/data bootstrap when the real navigation changes views.
    await page.evaluate(() => window.eval(`canUseProductionLiveSync=()=>true; getProductionLiveSyncCoordinator=()=>null`));
    const statuses = [
      { state: 'Needs attention', lastVerifiedAt: null, message: 'A dataset could not load. Your entered draft remains available for review.', draft: true },
      { state: 'Up to date', lastVerifiedAt: '2026-09-09T16:42:00Z', message: 'All required revisions verified.', draft: false },
      { state: 'Offline', lastVerifiedAt: null, message: 'The device is offline. Cached data has not been verified.', draft: false },
    ];
    for (const status of statuses) {
      await page.evaluate(nextStatus => {
        (window as any).__headerStatusFixture = nextStatus;
        window.eval(`productionLiveSyncDraftChanged=window.__headerStatusFixture.draft; renderProductionDataFreshness(window.__headerStatusFixture); switchView('drive');`);
      }, status);
      const search = page.locator('#drive-search');
      await search.fill('Synthetic retained search');
      await expect(page.locator('#drive-search-clear')).toBeVisible();
      await expect(search).toBeFocused();
      // A status repaint must neither blur nor clear the active search draft.
      await page.evaluate(() => window.eval('productionLiveSyncDraftChanged=window.__headerStatusFixture.draft; renderProductionDataFreshness(window.__headerStatusFixture)'));
      await expect(search).toHaveValue('Synthetic retained search');
      await expect(search).toBeFocused();
      await page.locator('#drive-search-clear').click();
      await expect(search).toHaveValue('');

      await page.evaluate(() => window.eval(`activeSalesOfficeTab='season'; switchView('sales-office'); productionLiveSyncDraftChanged=window.__headerStatusFixture.draft; renderProductionDataFreshness(window.__headerStatusFixture)`));
      await expect(page.locator('#view-sales-office')).toBeVisible();
      const salesOfficeGeometry = await page.locator('#global-header-inline-back').evaluate(back => {
        const rect = back.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        const status = document.getElementById('live-data-freshness')!;
        return { backHit: hit === back || !!hit && back.contains(hit), statusRight: status.getBoundingClientRect().right,
          statusPosition: getComputedStyle(status).position, inMenu: status.parentElement?.id === 'side-drawer' };
      });
      expect(salesOfficeGeometry).toMatchObject({ backHit: true, statusPosition: 'static', inMenu: true });
      expect(salesOfficeGeometry.statusRight).toBeLessThanOrEqual(1);
      await page.locator('#footer-menu-btn').click();
      await expect(page.locator('#side-drawer')).toHaveClass(/open/);
      const statusButton = page.locator('#side-drawer #live-data-freshness');
      await statusButton.scrollIntoViewIfNeeded();
      await expect(statusButton).toBeInViewport();
      const layout = await statusButton.evaluate(element => ({
        left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
        drawerRight: element.parentElement!.getBoundingClientRect().right,
        label: element.getAttribute('aria-label'), text: element.textContent,
      }));
      expect(layout.left).toBeGreaterThanOrEqual(0);
      expect(layout.right).toBeLessThanOrEqual(layout.drawerRight + 1);
      expect(layout.label).toContain(layout.text!);
      if (status.state === 'Needs attention') {
        await expect(statusButton).toContainText('Awaiting first data check');
        await expect(statusButton).toContainText('Edit needs review');
      }
      await page.evaluate(() => window.eval('setMenuOpenState(false)'));
      await expect(page.locator('#side-drawer')).not.toHaveClass(/open/);
    }
    await page.screenshot({ path: test.info().outputPath(`nonblocking-data-status-${width}.png`) });
    app.assertClean();
  });
}

test('native refresh preserves an open Dock draft and reloads changed query and identity scopes', async ({ page, baseURL }) => {
  const initial = [row('draft-a', 'Customer A')];
  const app = await harness(page, baseURL!, initial);
  await enableNativeCoordinator(page, initial);
  await page.evaluate(() => window.eval(`openDockInfoModal('28', '37231')`));
  await expect(page.locator('#dock-info-modal')).toBeVisible();
  await expect(page.locator('#live-data-freshness')).toContainText('Data Current');
  await page.locator('#dock-status').selectOption('Palletize');
  await page.evaluate(data => {
    const fixture = (window as any).__nativeSyncFixture;
    fixture.rows = data; fixture.revision = '2'; fixture.changed();
  }, [...initial, row('draft-b', 'Customer B', '29')]);
  await expect(page.locator('#live-data-freshness')).toContainText('Edit needs review');
  await expect(page.locator('#dock-status')).toHaveValue('Palletize');
  await expect(page.locator('[data-dock-filter-counts]')).toContainText('Showing 1 of 1');
  await page.locator('#dock-info-modal').getByRole('button', { name: 'CANCEL', exact: true }).click();
  await expect(page.locator('[data-dock-filter-counts]')).toContainText('Showing 2 of 2');

  // Exercise real side-adapter cache keys and commits, with the read-only Apps
  // Script boundary replaced. Metadata revisions deliberately do not change.
  await page.evaluate(() => window.eval(`(() => {
    window.__nativeSyncFixture.transactionQueries = [];
    postGoogleScriptRawJsonPayload = async payload => {
      if (payload.type !== 'inventory_transaction_history') throw new Error('Unexpected synthetic boundary');
      window.__nativeSyncFixture.transactionQueries.push(payload.search);
      return {ok:true, rows:[{unique_id:'synthetic-query-' + payload.search, description:payload.search}]};
    };
    inventoryTransactionHistoryState.search = 'pine';
    return ensureProductionLiveSyncSideData('transactions');
  })()`));
  const queries = () => page.evaluate(() => (window as any).__nativeSyncFixture.transactionQueries);
  expect(await queries()).toEqual(['pine']);
  await page.evaluate(() => window.eval(`ensureProductionLiveSyncSideData('transactions')`));
  expect(await queries()).toEqual(['pine']);
  await page.evaluate(() => window.eval(`inventoryTransactionHistoryState.search='oak'; ensureProductionLiveSyncSideData('transactions')`));
  expect(await queries()).toEqual(['pine', 'oak']);
  expect(await page.evaluate(() => window.eval(`inventoryTransactionHistoryState.rows[0].description`))).toBe('oak');
  await page.evaluate(() => window.eval(`nativeAuthProfile={...nativeAuthProfile,id:'synthetic-second-scope'}; ensureProductionLiveSyncSideData('transactions')`));
  expect(await queries()).toEqual(['pine', 'oak', 'oak']);
  await page.evaluate(() => window.eval(`showOnlyPrimaryView('hours'); renderViewContent('hours',true,true)`));
  await page.locator('#hours-amount').fill('12.5');
  await page.locator('#hours-amount').blur();
  await page.evaluate(() => {
    const fixture = (window as any).__nativeSyncFixture;
    fixture.revision = '3'; fixture.changed();
  });
  await expect(page.locator('#live-data-freshness')).toContainText('Data Current');
  await expect(page.locator('#hours-amount')).toHaveValue('12.5');
  app.assertClean();
});
