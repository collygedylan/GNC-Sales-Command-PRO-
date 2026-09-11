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
  await expect(page.locator('#live-data-freshness')).toContainText('Up to date');
  const headerGeometry = await page.locator('#live-data-freshness').evaluate(element => {
    const rect = element.getBoundingClientRect();
    const obscured = ['global-header-inline-back', 'docks-search'].filter(id => {
      const target = document.getElementById(id);
      if (!target || !target.getClientRects().length) return false;
      const targetRect = target.getBoundingClientRect();
      const hit = document.elementFromPoint(targetRect.left + targetRect.width / 2, targetRect.top + targetRect.height / 2);
      return !!hit?.closest('#live-data-freshness');
    });
    return {left:rect.left, right:rect.right, top:rect.top, width:window.innerWidth, obscured};
  });
  expect(headerGeometry.left).toBeGreaterThanOrEqual(0);
  expect(headerGeometry.right).toBeLessThanOrEqual(headerGeometry.width + 1);
  expect(headerGeometry.top).toBeGreaterThanOrEqual(0);
  expect(headerGeometry.obscured, 'Freshness status must not cover header action centers').toEqual([]);
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
      await expect(p.locator('#live-data-freshness')).toContainText('Importing');
    }
    await expect(counts(page)).toContainText('Showing 117 of 117');
    await expect(counts(other)).toContainText('Showing 55 of 117');
    for (const p of [page, other]) {
      await p.evaluate(() => { const fixture = (window as any).__nativeSyncFixture; fixture.state = 'ready'; fixture.changed(); });
      await expect(p.locator('#live-data-freshness')).toContainText('Up to date');
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
    await expect(page.locator('#live-data-freshness')).toContainText('Syncing');
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
    await expect(page.locator('#live-data-freshness')).toContainText('Needs attention');
    await expect(counts(page)).toContainText('Showing 150 of 150');
    await page.evaluate(() => {
      (window as any).__nativeSyncFixture.readFailure = false;
      (window as any).__nativeSyncFixture.reconnected();
    });
    await expect(page.locator('#live-data-freshness')).toContainText('Up to date');
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

test('native refresh preserves an open Dock draft and reloads changed query and identity scopes', async ({ page, baseURL }) => {
  const initial = [row('draft-a', 'Customer A')];
  const app = await harness(page, baseURL!, initial);
  await enableNativeCoordinator(page, initial);
  await page.evaluate(() => window.eval(`openDockInfoModal('28', '37231')`));
  await expect(page.locator('#dock-info-modal')).toBeVisible();
  await expect(page.locator('#live-data-freshness')).toContainText('Up to date');
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
  await expect(page.locator('#live-data-freshness')).toContainText('Up to date');
  await expect(page.locator('#hours-amount')).toHaveValue('12.5');
  app.assertClean();
});
