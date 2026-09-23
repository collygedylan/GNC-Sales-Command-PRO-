// September 9 behavior coverage; preserved complete tests/docks-filter.e2e.spec.ts fixture.
// See docs/rollback-sep09-validation.md for deliberately removed later contracts.
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

async function closeMenuAccessibly(page: Page) {
  const closeMenu = page.getByRole('button', { name: 'Close menu', exact: true });
  await expect(closeMenu).toBeVisible();
  await closeMenu.press('Enter');
}

async function expectDockCounts(page: Page, shown: number, total: number, hiddenDocks = 0) {
  const status = page.locator('[data-dock-filter-status]');
  const counts = status.locator('[data-dock-filter-counts]');
  for (const [name, value] of Object.entries({ shown, total, 'hidden-docks': hiddenDocks })) {
    await expect(status).toHaveAttribute(`data-${name}`, String(value));
    await expect(counts).toHaveAttribute(`data-${name}`, String(value));
  }
}

async function assertCompactDockLayout(page: Page, testInfo: { outputPath(name: string): string, project: { name: string } }) {
  const controls = page.locator('#docks-filter-controls');
  const shells = controls.locator('[data-dock-filter-shell]');
  await expect(shells).toHaveCount(4);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => document.body.setAttribute('data-ops-theme', value), theme);
    const geometry = await controls.evaluate(element => {
      const shellRects = Array.from(element.querySelectorAll<HTMLElement>('[data-dock-filter-shell]'), node => node.getBoundingClientRect());
      const targets = Array.from(element.querySelectorAll<HTMLElement>('[data-dock-filter-shell] button, [data-dock-filter-shell] select'))
        .filter(node => node.getClientRects().length).map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }));
      return {
        railHeight: Math.max(...shellRects.map(rect => rect.bottom)) - Math.min(...shellRects.map(rect => rect.top)),
        targets,
        pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
        phone: window.innerWidth < 768,
      };
    });
    expect(geometry.targets.every(target => target.width >= 44 && target.height >= 44), JSON.stringify(geometry)).toBe(true);
    expect(geometry.pageOverflow, JSON.stringify(geometry)).toBeLessThanOrEqual(1);
    if (geometry.phone) expect(geometry.railHeight, JSON.stringify(geometry)).toBeLessThanOrEqual(120);
    await page.screenshot({ path: testInfo.outputPath(`docks-compact-${theme}.png`) });
  }
  await page.locator('[data-dock-filter-shell="customer"] > button').click();
  const sheet = page.locator('#dock-mobile-filter-sheet');
  const popup = await sheet.isVisible() ? sheet : page.locator('[data-dock-customer-panel]');
  await expect(popup).toBeVisible();
  const popupGeometry = await popup.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const search = element.querySelector('input[type="search"]');
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      searchFont: search ? parseFloat(getComputedStyle(search).fontSize) : 0 };
  });
  expect(popupGeometry.left).toBeGreaterThanOrEqual(0);
  expect(popupGeometry.right).toBeLessThanOrEqual(popupGeometry.viewportWidth + 1);
  expect(popupGeometry.top).toBeGreaterThanOrEqual(0);
  expect(popupGeometry.bottom).toBeLessThanOrEqual(popupGeometry.viewportHeight + 1);
  if ((page.viewportSize()?.width || 1000) < 768) expect(popupGeometry.searchFont).toBeGreaterThanOrEqual(16);
  const done = popup.getByRole('button', { name: 'Done', exact: true });
  expect((await done.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await done.click();
  if (!testInfo.project.name.includes('android')) return;

  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: viewport.width, height: 360 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
  try {
    await page.locator('#docks-search').fill('Synthetic');
    await expect(page.locator('#docks-search-clear')).toBeVisible();
    const unobstructed = await page.locator('#global-header-inline-back, #docks-search-clear, #footer-menu-btn').evaluateAll(elements => elements.flatMap(element => {
      const bounds = element.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      return hit === element || element.contains(hit) ? [] : [element.id];
    }));
    expect(unobstructed).toEqual([]);
    await page.locator('[data-dock-filter-shell="customer"] > button').click();
    const compactPopup = await sheet.isVisible() ? sheet : page.locator('[data-dock-customer-panel]');
    await expect(compactPopup).toBeVisible();
    const compactGeometry = await page.evaluate(() => {
      const visible = (element: Element) => element.getClientRects().length > 0;
      const rect = (element: Element) => element.getBoundingClientRect();
      const popup = Array.from(document.querySelectorAll<HTMLElement>('#dock-mobile-filter-sheet, [data-dock-customer-panel]')).find(visible)!;
      const controls = Array.from(document.querySelectorAll<HTMLElement>('#docks-filter-controls [data-dock-filter-shell], #global-header-inline-back, #docks-search, #docks-search-clear, #footer-menu-btn')).filter(visible);
      const popupRect = rect(popup);
      return {
        controls: controls.map(element => ({ id: element.id || element.getAttribute('data-dock-filter-shell'), width: rect(element).width, height: rect(element).height })),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        popup: { left: popupRect.left, right: popupRect.right, top: popupRect.top, bottom: popupRect.bottom },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    });
    expect(compactGeometry.controls.every(control => control.width >= 44 && control.height >= 44), JSON.stringify(compactGeometry)).toBe(true);
    expect(compactGeometry.overflow, JSON.stringify(compactGeometry)).toBeLessThanOrEqual(1);
    expect(compactGeometry.popup.left).toBeGreaterThanOrEqual(0);
    expect(compactGeometry.popup.right).toBeLessThanOrEqual(compactGeometry.viewport.width + 1);
    expect(compactGeometry.popup.top).toBeGreaterThanOrEqual(0);
    expect(compactGeometry.popup.bottom).toBeLessThanOrEqual(compactGeometry.viewport.height + 1);
    await page.screenshot({ path: testInfo.outputPath('docks-larger-text-short-viewport.png') });
    await compactPopup.getByRole('button', { name: 'Done', exact: true }).click();
    await page.locator('#docks-search-clear').click();
  } finally {
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    await page.setViewportSize(viewport);
  }
}

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
        invalidateResolvedViewStateCaches();
        markViewDirty('docks');
        switchView('docks', { force: true });
      })()`);
    }, { fixtureRows: nextRows, customers: initialCustomers });
    await expect(page.locator('#view-docks')).toBeVisible();
    await expect(page.locator('#global-header-search-slot #docks-search')).toBeVisible();
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

test('compact filter rail remains usable across themes, larger text and shortened phone height', async ({ page, baseURL }, testInfo) => {
  const session = await harness(page, baseURL!, dock28, ['Selected 0', 'Selected 1', 'Selected 2', 'Selected 3']);
  await expectDockCounts(page, 55, 117);
  await expect(page.locator('[data-dock-clear-filters]')).toBeVisible();
  await assertCompactDockLayout(page, testInfo);
  session.assertClean();
});

test('two sessions retain local choices, converge after clear, and keep All inclusive after import/relaunch', async ({ page, browser, baseURL }, testInfo) => {
  // A separate context is essential: filters are intentionally isolated per device.
  const use = testInfo.project.use;
  const secondContext = await browser.newContext({ baseURL, viewport: use.viewport, userAgent: use.userAgent,
    isMobile: use.isMobile, hasTouch: use.hasTouch, deviceScaleFactor: use.deviceScaleFactor, serviceWorkers: 'block' });
  const other = await secondContext.newPage();
  try {
    const all = await harness(page, baseURL!, dock28);
    const custom = await harness(other, baseURL!, dock28, ['Selected 0', 'Selected 1', 'Selected 2', 'Selected 3']);
    await expectDockCounts(page, 117, 117);
    await expectDockCounts(other, 55, 117);
    const imported = [...dock28, ...newDock29];
    await Promise.all([all.importRows(imported), custom.importRows(imported)]);
    await expectDockCounts(page, 149, 149);
    await expectDockCounts(other, 55, 149, 1);
    await expect(other.locator('[data-dock-filter-status]')).toHaveClass(/\bsr-only\b/);
    await expect(other.locator('[data-dock-active-filter-chips]')).toHaveCount(0);
    await expect(other.locator('[data-dock-clear-filters]')).toBeVisible();
    await expect(other.locator('#docks-content')).toContainText('55 Items');
    await expect(other.locator('#docks-content')).not.toContainText('Dock 29');
    await other.screenshot({ path: testInfo.outputPath('docks-custom-filter.png') });
    await other.locator('[data-dock-clear-filters]').click();
    await expectDockCounts(other, 149, 149);
    await expect(other.locator('[data-dock-clear-filters]')).toBeHidden();
    await expect(other.locator('#docks-content')).toContainText('Dock 29');
    await other.reload({ waitUntil: 'load' });
    await custom.seed(imported);
    await expect(other.locator('[data-dock-customer-summary]')).toHaveText('All Customers');
    const latest = [...imported, row('late-new', 'Another New Customer', '30')];
    await custom.importRows(latest);
    await expectDockCounts(other, 150, 150);
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
      // The canary identity starts before access verification. This native-sync
      // fixture represents the same identity after access and role startup finish.
      appAccessSnapshotState = {
        status: 'ready', stale: false, errorCode: '', loadedAt: Date.now(), username: currentUser,
        snapshot: normalizeAppAccessSnapshot({
          contractVersion: APP_ACCESS_CONTRACT_VERSION, enforcementMode: 'enforced',
          username: currentUser, role: currentRole,
          permissions: [{ permissionKey: 'module.docks.view', kind: 'module', moduleKey: 'docks', allowed: true }]
        }, currentUser)
      };
      setRoleAccessReadyState(true);
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
  try {
    await expect(page.locator('#live-data-freshness')).toContainText('Up to date');
  } catch (error) {
    console.log('DOCKS_STARTUP_STATE', await page.evaluate(() => window.eval(`({
      hidden: document.hidden, focus: document.hasFocus(), view: getCurrentVisibleViewId(),
      pending: productionLiveSyncRenderPending, active: productionLiveSyncActiveRender,
      activeCurrent: isProductionRefreshCurrent(productionLiveSyncActiveRender),
      context: productionVerifiedViewKey(), generation: productionLiveSyncRenderGeneration,
      draft: hasProductionLiveSyncDraft(), focused: document.activeElement && document.activeElement.id
    })`)));
    throw error;
  }
  await expect(page.locator('#live-data-freshness')).toHaveAttribute('role', 'status');
  await expect(page.locator('#live-data-freshness')).toHaveAttribute('aria-label', 'Data status');
  await expect(page.locator('#live-data-freshness')).toHaveAttribute('aria-live', 'polite');
  expect(await page.locator('#live-data-freshness').evaluate(element => element.parentElement?.id)).toBe('side-drawer');
  await page.locator('#footer-menu-btn').click();
  await expect(page.locator('#side-drawer')).toHaveClass(/open/);
  await expect(page.getByRole('heading', { name: 'Data status', exact: true })).toBeVisible();
  await expect(page.locator('#live-data-status-label')).toContainText('Up to date');
  await page.screenshot({path:test.info().outputPath('native-freshness-menu.png')});
  await closeMenuAccessibly(page);
  await expect(page.locator('#side-drawer')).not.toHaveClass(/open/);
  await page.locator('#docks-search').fill('Synthetic');
  await expect(page.locator('#docks-search')).toBeFocused();
  await expect(page.locator('#docks-search-clear')).toBeVisible();
  const clearHitTarget = await page.locator('#docks-search-clear').evaluate(element => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit === element || !!hit?.closest('#docks-search-clear');
  });
  expect(clearHitTarget, 'Docks search X must remain unobstructed').toBe(true);
  const hitTargetObstructions = (selector: string) => page.locator(selector).evaluateAll(elements => elements.flatMap(element => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return rect.width > 0 && rect.height > 0 && (hit === element || element.contains(hit)) ? [] : [element.id];
  }));
  await expect.poll(() => hitTargetObstructions('#global-header-inline-back, #docks-search-clear, #footer-menu-btn'), {
    message: 'Focused search must leave Back, clear, and Menu as hit targets'
  }).toEqual([]);
  const searchChrome = await page.locator('#global-header-inline-back, #docks-search, #docks-search-clear, #footer-menu-btn').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    return { id: element.id, width: rect.width, height: rect.height, fontSize: parseFloat(getComputedStyle(element).fontSize) };
  }));
  expect(searchChrome.every(control => control.width >= 44 && control.height >= 44), JSON.stringify(searchChrome)).toBe(true);
  if ((page.viewportSize()?.width || 1000) < 768) expect(searchChrome.find(control => control.id === 'docks-search')!.fontSize).toBeGreaterThanOrEqual(16);
  await page.locator('#docks-search-clear').click();
  await expect(page.locator('#docks-search')).toHaveValue('');
  await page.screenshot({path:test.info().outputPath('native-search-clear.png')});
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
    await expectDockCounts(page, 117, 117);
    await expectDockCounts(other, 55, 117);
    for (const p of [page, other]) {
      await p.evaluate(() => { const fixture = (window as any).__nativeSyncFixture; fixture.state = 'ready'; fixture.changed(); });
      await expect(p.locator('#live-data-freshness')).toContainText('Up to date');
    }
    await expectDockCounts(page, 149, 149);
    await expectDockCounts(other, 55, 149, 1);
    // Freeze the first changed snapshot, update its revision while it is in flight.
    await page.evaluate(() => {
      const fixture = (window as any).__nativeSyncFixture;
      fixture.revision = '3';
      fixture.rows = fixture.rows.slice(0, 1);
      fixture.gate = new Promise<void>(resolve => { fixture.release = resolve; });
      fixture.changed();
    });
    await expect(page.locator('#live-data-freshness')).toContainText('Showing available rows · Refreshing');
    expect(await page.evaluate(() => window.eval('getProductionLiveSyncCoordinator().getStatus().state'))).toBe('Syncing');
    await expectDockCounts(page, 149, 149);
    await page.evaluate(data => {
      const fixture = (window as any).__nativeSyncFixture;
      fixture.rows = data; fixture.revision = '4'; const release = fixture.release; fixture.gate = null; release();
    }, [...imported, row('latest', 'Newest Customer', '30')]);
    await expectDockCounts(page, 150, 150);
    await expect.poll(() => page.evaluate(() => window.eval('getProductionLiveSyncCoordinator().getStatistics().discardedLoads'))).toBeGreaterThan(0);
    await page.evaluate(() => {
      (window as any).__nativeSyncFixture.readFailure = true;
      window.dispatchEvent(new Event('focus'));
    });
    await expect(page.locator('#live-data-freshness')).toContainText('Needs attention');
    await expectDockCounts(page, 150, 150);
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
  await expectDockCounts(page, 0, 2, 2);
  await expect(page.locator('[data-dock-filter-status]')).toHaveClass(/\bsr-only\b/);
  await expect(page.locator('[data-dock-clear-filters]')).toBeVisible();
  await page.reload({ waitUntil: 'load' });
  await app.seed([row('a', 'Customer A'), row('b', 'Customer B', '29')]);
  await expect(page.locator('[data-dock-customer-summary]')).toHaveText('Custom · 0 selected');
  await page.locator('[data-dock-clear-filters]').click();
  await expectDockCounts(page, 2, 2);
  app.assertClean();
});

test('native refresh preserves an open Dock draft and reloads changed query and identity scopes', async ({ page, baseURL }) => {
  const initial = [row('draft-a', 'Customer A')];
  const app = await harness(page, baseURL!, initial);
  // The editor display case requires a foreground page after multi-context tests.
  // Leave those multi-session fixtures' visibility and refresh behavior intact.
  await page.bringToFront();
  await page.waitForFunction(() => document.visibilityState === 'visible');
  await enableNativeCoordinator(page, initial);
  // A normal visible render can supersede a queued background refresh. Its
  // completed display must not retain the superseded refresh's pending label.
  await page.evaluate(() => window.eval(`(() => {
    scheduleProductionLiveSyncRender();
    renderProductionDataFreshness(getProductionLiveSyncCoordinator().getStatus());
    window.__dockPendingLabel = document.getElementById('live-data-freshness').textContent;
    prepareLatestViewRender('docks');
    renderViewContent('docks', false, true);
  })()`));
  expect(await page.evaluate(() => (window as any).__dockPendingLabel)).toContain('Updates ready');
  await expect.poll(() => page.evaluate(() => window.eval(`!productionLiveSyncRenderPending && !productionLiveSyncActiveRender`))).toBe(true);
  await expect(page.locator('#live-data-freshness')).toContainText('Up to date');
  await page.evaluate(() => window.eval(`openDockInfoModal('28', '37231')`));
  await expect(page.locator('#dock-info-modal')).toBeVisible();
  // Verification may finish while displaying its replacement waits for the editor.
  await expect.poll(() => page.evaluate(() => window.eval(`getProductionLiveSyncCoordinator().getStatus().state`))).toBe('Up to date');
  await expect(page.locator('#live-data-freshness')).toContainText('Updates ready · Waiting for display');
  await expect(page.locator('#live-data-freshness')).toContainText('Edit needs review');
  await page.locator('#dock-status').selectOption('Palletize');
  await page.evaluate(data => {
    const fixture = (window as any).__nativeSyncFixture;
    fixture.rows = data; fixture.revision = '2'; fixture.changed();
  }, [...initial, row('draft-b', 'Customer B', '29')]);
  await expect(page.locator('#live-data-freshness')).toContainText('Edit needs review');
  await expect(page.locator('#dock-status')).toHaveValue('Palletize');
  await expectDockCounts(page, 1, 1);
  await page.locator('#dock-info-modal').getByRole('button', { name: 'CANCEL', exact: true }).click();
  await expectDockCounts(page, 2, 2);
  await expect.poll(() => page.evaluate(() => window.eval(`!productionLiveSyncRenderPending && !productionLiveSyncActiveRender`))).toBe(true);
  await expect(page.locator('#live-data-freshness')).toContainText('Up to date');

  // Exercise real side-adapter cache keys and commits, with only the protected
  // transaction-history read boundary replaced. Metadata revisions do not change.
  await page.evaluate(() => window.eval(`(() => {
    window.__nativeSyncFixture.transactionQueries = [];
    postAppFunctionJson = async (url, payload, options = {}) => {
      if (url !== APP_API_FUNCTION_URL || payload.action !== 'inventory_transaction_history'
        || payload.commandId || payload.command_id || options.idempotencyKey) throw new Error('Unexpected synthetic boundary');
      window.__nativeSyncFixture.transactionQueries.push(payload.search);
      return {ok:true, rows:[{unique_id:'synthetic-query-' + payload.search, description:payload.search}], count:1, hasMore:false};
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
