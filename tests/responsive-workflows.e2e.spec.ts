import { expect, test } from '@playwright/test';

const fixtureUrl = '/tests/fixtures/ops-precision-browser.html';

test('phone login keeps both fields and the submit action visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=V2026.08.20.10', { waitUntil: 'load' });

  const username = page.locator('#username-input');
  const accessCode = page.locator('#pin-code');
  const submit = page.locator('#login-button');
  await expect(username).toBeVisible();
  await expect(accessCode).toBeVisible();
  await expect(submit).toBeVisible();

  const controls = await Promise.all([username, accessCode, submit].map((control) => control.boundingBox()));
  expect(controls.every((box) => box && box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844), JSON.stringify(controls)).toBe(true);
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
  ]);
  expect(result.labels).toEqual(result.values.map((value) => value || 'Unassigned'));
  expect(result.key).toBe('001668.030.1|buddleia');
  expect(result.alias).toBe('charley_robertson');
  expect(result.sheetTypoAlias).toBe('bobby_adair');
});

test('Dylan and Megan alone receive cached Manager Eval Reports without an inventory refetch', async ({ page }) => {
  await page.goto('/?e2e=V2026.08.21.01', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).getManagerEvalReportIndex === 'function');
  const result = await page.evaluate(() => window.eval(`(() => {
    processAndLoadData({ data: [
      { ITEMCODE: 'A', COMMONNAME: 'Alpha', SEASON: 'F1', SALEYEAR: 27, PRIORITY: '1', S_LTS: 20, ASSIGNEDTO: 'dylan_collyge', LOCATIONCODE: 'A.01.001' },
      { ITEMCODE: 'A', COMMONNAME: 'Alpha', SEASON: 'U1', SALEYEAR: 27, PRIORITY: '', S_LTS: 300, ASSIGNEDTO: 'dylan_collyge', LOCATIONCODE: 'A.01.002' },
      { ITEMCODE: 'B', COMMONNAME: 'Beta', SEASON: 'X', SALEYEAR: 27, PRIORITY: '', S_LTS: 300, ASSIGNEDTO: 'megan_kelly', LOCATIONCODE: 'B.01.001' }
    ], _fromCache: true });
    invalidateManagerEvalReportCache();
    const first = getManagerEvalReportIndex();
    const second = getManagerEvalReportIndex();
    let inventoryFetches = 0;
    const originalEnsureDatasetLoaded = ensureDatasetLoaded;
    ensureDatasetLoaded = function(){ inventoryFetches += 1; return Promise.resolve(fullInventory); };
    setManagerEvalReport('culls');
    const afterSwitch = getManagerEvalReportIndex();
    ensureDatasetLoaded = originalEnsureDatasetLoaded;
    return {
      access: {
        dylan: canViewManagerEvalReports('dylan_collyge'),
        megan: canViewManagerEvalReports('megan_kelly'),
        other: canViewManagerEvalReports('jd_jones')
      },
      reportIds: GncEvalReports.REPORT_IDS.slice(),
      counts: first.counts,
      cached: first === second && first === afterSwitch,
      inventoryFetches
    };
  })()`));

  expect(result.access).toEqual({ dylan: true, megan: true, other: false });
  expect(result.reportIds).toEqual([
    's1-with-pri', 'od-loc-note-date', 'hs-plus-5-days', 'get-off-hold',
    'low-stock', 'no-pri', 'culls', 'not-in-f1',
  ]);
  expect(result.counts['s1-with-pri']).toBe(1);
  expect(result.counts['low-stock']).toBe(1);
  expect(result.counts.culls).toBe(1);
  expect(result.cached).toBe(true);
  expect(result.inventoryFetches).toBe(0);
});

test('Manager Historical Report drills Common Name to ContSize and sends only chosen columns', async ({ page }) => {
  await page.goto('/?e2e=V2026.08.21.03', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).loadManagerHistoricalRows === 'function');
  const result = await page.evaluate(() => window.eval(`(async () => {
    const originalSupabaseRpc = supabaseRpc;
    const originalCanViewManagerHistoricalReport = canViewManagerHistoricalReport;
    const calls = [];
    try {
      canViewManagerHistoricalReport = () => true;
      activeHomeTab = 'historical-report';
      managersSearchTerm = 'feather';
      supabaseRpc = async (name, body) => {
        calls.push({ name, body: JSON.parse(JSON.stringify(body || {})) });
        if (name === 'search_historical_inventory_common_names') return [{
          commonname: 'Karl Foerster Feather Reed Grass', contsize_count: 1, historical_row_count: 2
        }];
        if (name === 'get_historical_inventory_container_sizes') return [{
          contsize: '#1', itemcode_count: 1, historical_row_count: 2
        }];
        if (name === 'get_historical_inventory_rows') return {
          rows: [{
            unique_id: 'history-1', report_date: '2026-08-20',
            commonname: 'Karl Foerster Feather Reed Grass', contsize: '#1',
            values: Object.fromEntries((body.selected_columns || []).map((key) => [key, key === 'holdstopcode' ? 'H' : 'test']))
          }],
          selected_columns: body.selected_columns,
          has_more: false,
          next_cursor: null
        };
        throw new Error('unexpected rpc');
      };

      const names = await loadManagerHistoricalCommonNames('feather', true);
      managersSearchTerm = 'feather';
      const nameMarkup = renderManagerHistoricalReportPanel();
      await selectManagerHistoricalCommonName('Karl Foerster Feather Reed Grass');
      const sizeMarkup = renderManagerHistoricalReportPanel();
      await selectManagerHistoricalContSize('#1');
      toggleManagerHistoricalColumn('locationcode', false);
      toggleManagerHistoricalColumn('lotcode', false);
      toggleManagerHistoricalColumn('ptravailable', false);
      toggleManagerHistoricalColumn('holdstopreason', false);
      setManagerHistoricalDateRange('start', '2026-08-01');
      setManagerHistoricalDateRange('end', '2026-08-21');
      await loadManagerHistoricalRows(true);
      const rowCall = calls.filter((call) => call.name === 'get_historical_inventory_rows').at(-1);
      const rows = getFilteredManagerHistoricalRows();
      const rendered = renderManagerHistoricalReportPanel();
      return {
        names: names.map((row) => row.commonname),
        values: rows[0] ? rows[0].values : null,
        calls,
        rowArgs: rowCall && rowCall.body,
        nameMarkup,
        sizeMarkup,
        rendered,
        canDylan: originalCanViewManagerHistoricalReport('dylan_collyge'),
        canOther: originalCanViewManagerHistoricalReport('jd_jones')
      };
    } finally {
      supabaseRpc = originalSupabaseRpc;
      canViewManagerHistoricalReport = originalCanViewManagerHistoricalReport;
    }
  })()`));

  expect(result.names).toEqual(['Karl Foerster Feather Reed Grass']);
  expect(result.values).toEqual({ report_date: 'test', itemcode: 'test', holdstopcode: 'H' });
  expect(result.rowArgs.selected_columns).toEqual(['report_date', 'itemcode', 'holdstopcode']);
  expect(result.rowArgs.start_date).toBe('2026-08-01');
  expect(result.rowArgs.end_date).toBe('2026-08-21');
  expect(result.rendered).toContain('Karl Foerster Feather Reed Grass');
  expect(result.rendered).toContain('#1');
  expect(result.rendered).toContain('Columns (3)');
  expect(result.rendered).toContain('Hold/Stop Code');
  expect(result.nameMarkup).toContain('manager-historical-drive-card');
  expect(result.nameMarkup).toContain('manager-historical-drive-crumb');
  expect(result.nameMarkup).not.toContain('manager-module-grid');
  expect(result.sizeMarkup).toContain('manager-historical-drive-card');
  expect(result.rendered).toContain('manager-historical-drive-record');
  expect(result.rendered).toContain('app-smart-card--inventory');
  expect(result.canDylan).toBe(true);
  expect(result.canOther).toBe(false);
});

test('an acknowledged assignment immediately leaves the Unassigned filter', async ({ page }) => {
  await page.goto('/?e2e=V2026.08.20.10', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).applyAcknowledgedEvalAssignmentResults === 'function');
  const result = await page.evaluate(() => window.eval(`(() => {
    processAndLoadData({ warehouseAssignedItemsData: [{
      UNIQUE_ID: 'eval-test-1', ITEMCODE: '011364.070.1', GENUSNAME: 'Decumaria',
      ASSIGNEDTO: '', assignedto: '', COMMONNAME: 'Barbara Ann Climbing Hydrangea Espalier'
    }] });
    setManagerAssignedItemsAssigneeFilter('unassigned');
    const activeBefore = getManagerAssignedItemsActiveAssigneeKey();
    const before = getFilteredManagerAssignedItemsExportRows().map((row) => row.ITEMCODE);
    const applied = applyAcknowledgedEvalAssignmentResults(
      [{ itemcode: '011364.070.1', genusname: 'Decumaria' }],
      [{ itemcode: '011364.070.1', genusname: 'Decumaria', assignedto: 'megan_kelly', source: 'supabase_assignment_manager' }],
      'megan_kelly'
    );
    const activeAfter = getManagerAssignedItemsActiveAssigneeKey();
    const unassignedAfter = getFilteredManagerAssignedItemsExportRows().map((row) => row.ITEMCODE);
    setManagerAssignedItemsAssigneeFilter('megan_kelly');
    const meganAfter = getFilteredManagerAssignedItemsExportRows().map((row) => ({ itemcode: row.ITEMCODE, assignedto: row.ASSIGNEDTO }));
    return { activeBefore, before, applied, activeAfter, unassignedAfter, meganAfter };
  })()`));

  expect(result).toEqual({
    activeBefore: 'unassigned',
    before: ['011364.070.1'],
    applied: 1,
    activeAfter: 'unassigned',
    unassignedAfter: [],
    meganAfter: [{ itemcode: '011364.070.1', assignedto: 'megan_kelly' }],
  });
});

test('iPhone Request Queue renders all 19 rows instead of only the first adaptive chunk', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=V2026.08.20.10', { waitUntil: 'domcontentloaded' });

  const result = await page.evaluate(() => {
    const appWindow = window as typeof window & {
      isIOSDevice?: () => boolean;
      getRequestChunkRenderOptions?: (options?: Record<string, unknown>) => Record<string, unknown>;
      renderMarkupChunkedByKey?: (
        key: string,
        container: HTMLElement,
        crumb: HTMLElement,
        rows: Array<{ id: number }>,
        crumbText: string,
        renderRow: (row: { id: number }) => string,
        options: Record<string, unknown>
      ) => boolean;
    };
    appWindow.isIOSDevice = () => true;
    document.body.classList.add('ios-device', 'viewport-phone', 'current-view-request');
    const container = document.createElement('div');
    const crumb = document.createElement('div');
    document.body.append(container, crumb);
    const rows = Array.from({ length: 19 }, (_, index) => ({ id: index + 1 }));
    const options = appWindow.getRequestChunkRenderOptions?.({ onComplete: () => {} }) || {};
    appWindow.renderMarkupChunkedByKey?.(
      'request-main-test',
      container,
      crumb,
      rows,
      'All Request Que',
      (row) => `<div data-request-uid="REQ-${row.id}">Row ${row.id}</div>`,
      options
    );
    return {
      configuredSyncLimit: Number(options.iosSyncRowLimit || 0),
      renderedRows: container.querySelectorAll('[data-request-uid]').length,
    };
  });

  expect(result.configuredSyncLimit).toBeGreaterThanOrEqual(19);
  expect(result.renderedRows).toBe(19);
});

test('Queue tab changes load only the canonical datasets needed by that tab', async ({ page }) => {
  await page.goto('/?e2e=V2026.08.20.10', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).getRequestViewLoadingConfig === 'function');
  const configs = await page.evaluate(() => {
    const getConfig = (window as any).getRequestViewLoadingConfig;
    const summarize = (tab: string) => {
      const config = getConfig(tab);
      return {
        required: config.required.map((item: any) => `${item.key}:${item.mode}`),
        background: config.background.map((item: any) => `${item.key}:${item.mode}`),
      };
    };
    return {
      query: (window as any).buildActiveRequestLiveRowsQuery('*'),
      pending: summarize('pending'),
      reps: summarize('reps'),
      suspendTag: summarize('suspend-tag'),
      recount: summarize('recount'),
      avCheck: summarize('av-check'),
    };
  });

  expect(configs.query).toBe('select=*&order=unique_id.desc');
  expect(configs.query).not.toContain('date_completed=is.null');
  expect(configs.pending).toEqual({ required: ['requests:full'], background: [] });
  expect(configs.reps.required).toEqual(['requests:full', 'requestHistory:full', 'salesCredits:full']);
  expect(configs.suspendTag.required).toEqual(['requests:full', 'soc:full']);
  expect(configs.recount).toEqual({ required: ['salesOffice:full'], background: ['requests:full'] });
  expect(configs.avCheck).toEqual({ required: [], background: ['requests:full'] });
});

test('Kayla keeps request photo and save access without gaining other sales-rep row edits', async ({ page }) => {
  await page.goto('/?e2e=V2026.08.20.10', { waitUntil: 'domcontentloaded' });
  const permissions = await page.evaluate(() => {
    window.eval("window.__qaOriginalGetRoleAccessState=getRoleAccessState; window.__qaOriginalRequestIdentityTokens=getRequestRepScopedIdentityTokens; getRequestRepScopedIdentityTokens=function(){ return new Set(['kayla_knepp']); }; getRoleAccessState=function(){ return window.__qaOriginalGetRoleAccessState('SALESREP','kayla_knepp'); };");
    const result = window.eval(`({
      repReadOnly: isRepReadOnlyUser(),
      globalRequestManager: canUseGlobalRequestAccess(),
      requestEditable: canEditRowDetails('req-', { SOURCE_TABLE: 'ph_active_request' }),
      driveEditable: canEditRowDetails('ssn-', { SOURCE_TABLE: 'ph_master_inventory' }),
      requestPhotoLabel: getTaskDetailQuickPhotoLabel('req-')
    })`);
    window.eval("getRoleAccessState=window.__qaOriginalGetRoleAccessState; getRequestRepScopedIdentityTokens=window.__qaOriginalRequestIdentityTokens; delete window.__qaOriginalGetRoleAccessState; delete window.__qaOriginalRequestIdentityTokens;");
    return result;
  });

  expect(permissions).toEqual({
    repReadOnly: true,
    globalRequestManager: true,
    requestEditable: true,
    driveEditable: false,
    requestPhotoLabel: 'Take Request Photo',
  });
});

test('saved Dark theme owns the first two seconds without a white frame', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('gnc_last_theme_v1', 'dark'));
  await page.addInitScript(() => {
    (window as typeof window & { __themePaintSamples?: Array<{ root: string; body: string; theme: string }> }).__themePaintSamples = [];
    const sample = () => {
      const rootStyle = getComputedStyle(document.documentElement);
      const bodyStyle = document.body ? getComputedStyle(document.body) : null;
      (window as typeof window & { __themePaintSamples?: Array<{ root: string; body: string; theme: string }> }).__themePaintSamples?.push({
        root: rootStyle.backgroundColor,
        body: bodyStyle?.backgroundColor || '',
        theme: document.documentElement.dataset.opsPrepaintTheme || document.body?.dataset.opsTheme || '',
      });
    };
    window.setInterval(sample, 25);
  });
  await page.goto('/?e2e=V2026.08.20.10&theme=dark', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const result = await page.evaluate(() => ({
    saved: localStorage.getItem('gnc_last_theme_v1'),
    bodyTheme: document.body.dataset.opsTheme,
    samples: (window as typeof window & { __themePaintSamples?: Array<{ root: string; body: string; theme: string }> }).__themePaintSamples || [],
  }));
  const visibleSamples = result.samples.filter((sample) => sample.body);
  expect(result.saved).toBe('dark');
  expect(result.bodyTheme).toBe('dark');
  expect(visibleSamples.length).toBeGreaterThan(10);
  expect(visibleSamples.some((sample) => /rgb\(255, 255, 255\)|rgba\(255, 255, 255, 1\)/.test(`${sample.root}|${sample.body}`)), JSON.stringify(visibleSamples.slice(0, 12))).toBe(false);
  expect(visibleSamples.every((sample) => sample.theme === 'dark')).toBe(true);
});

test('Drive Common Name search preserves grouped drill results', async ({ page }) => {
  await page.goto('/?e2e=V2026.08.20.10', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(() => {
    const appWindow = window as typeof window & {
      shouldRenderDriveUniversalDetailedSearch?: () => boolean;
      renderDriveCommonNameDrill?: () => void;
      selectDriveName?: (name: string) => void;
    };
    return {
      detailedSearchOnDefaultCommonNameTab: appWindow.shouldRenderDriveUniversalDetailedSearch?.(),
      hasGroupedRenderer: typeof appWindow.renderDriveCommonNameDrill === 'function',
      hasDrillSelection: typeof appWindow.selectDriveName === 'function',
    };
  });
  expect(result).toEqual({
    detailedSearchOnDefaultCommonNameTab: false,
    hasGroupedRenderer: true,
    hasDrillSelection: true,
  });
});

test('Android keyboard viewport changes retain Drive search focus, node identity, value, and caret', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${fixtureUrl}?view=drive&theme=dark&monitoring=0`, { waitUntil: 'domcontentloaded' });
  const search = page.locator('#drive-search');
  await search.focus();
  await search.fill('Karl Foerster');
  await search.evaluate((input) => {
    const typed = input as HTMLInputElement;
    typed.setSelectionRange(4, 4);
    (window as typeof window & { __qaDriveSearchNode?: HTMLInputElement }).__qaDriveSearchNode = typed;
  });

  await page.setViewportSize({ width: 390, height: 500 });
  await page.waitForTimeout(280);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(280);

  const result = await search.evaluate((input) => {
    const typed = input as HTMLInputElement;
    return {
      sameNode: (window as typeof window & { __qaDriveSearchNode?: HTMLInputElement }).__qaDriveSearchNode === typed,
      connected: typed.isConnected,
      focused: document.activeElement === typed,
      value: typed.value,
      selectionStart: typed.selectionStart,
      selectionEnd: typed.selectionEnd,
      mountedInCommandSlot: !!typed.closest('#global-header-search-slot'),
    };
  });
  expect(result).toEqual({
    sameNode: true,
    connected: true,
    focused: true,
    value: 'Karl Foerster',
    selectionStart: 4,
    selectionEnd: 4,
    mountedInCommandSlot: true,
  });
});

test('Home adaptively fits all 12 launch modules without scrolling or quick-bar overlap', async ({ page }) => {
  const viewports = [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1900, height: 990 },
    { width: 1920, height: 1080 },
  ];

  for (const theme of ['light', 'dark']) {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto(`${fixtureUrl}?view=home&theme=${theme}&monitoring=0`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#view-home')).toHaveAttribute('data-home-fit-complete', 'true');
      const layout = await page.locator('#home-dashboard-grid > *').evaluateAll((tiles) => {
        const visible = tiles.filter((tile) => (tile as HTMLElement).offsetWidth > 0) as HTMLElement[];
        const rects = visible.map((tile) => tile.getBoundingClientRect());
        const main = document.getElementById('main-scroll-area')!;
        const nav = document.getElementById('bottom-nav')!;
        const navRect = nav.getBoundingClientRect();
        const lastBottom = rects.length ? Math.max(...rects.map((rect) => rect.bottom)) : 0;
        const overlaps = rects.some((rect, index) => rects.slice(index + 1).some((other) => (
          Math.min(rect.right, other.right) - Math.max(rect.left, other.left) > 1
          && Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top) > 1
        )));
        const labels = visible.map((tile) => tile.querySelector('span') as HTMLElement).filter(Boolean);
        return {
          count: rects.length,
          columns: new Set(rects.map((rect) => Math.round(rect.left))).size,
          rows: new Set(rects.map((rect) => Math.round(rect.top))).size,
          clearance: Math.round((navRect.top - lastBottom) * 100) / 100,
          minWidth: Math.min(...rects.map((rect) => rect.width)),
          minHeight: Math.min(...rects.map((rect) => rect.height)),
          lastBottom,
          navTop: navRect.top,
          overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
          mainScrollDelta: Math.max(0, main.scrollHeight - main.clientHeight),
          mainOverflowY: getComputedStyle(main).overflowY,
          navPosition: getComputedStyle(nav).position,
          navBottom: getComputedStyle(nav).bottom,
          overlaps,
          clipped: rects.some((rect) => rect.left < -1 || rect.right > window.innerWidth + 1 || rect.top < -1 || rect.bottom > navRect.top + 1),
          unreadableLabel: labels.some((label) => label.getBoundingClientRect().height < 9 || Number.parseFloat(getComputedStyle(label).fontSize) < 9),
          fitData: { ...(document.getElementById('view-home') as HTMLElement).dataset },
          fitTile: getComputedStyle(document.getElementById('view-home')!).getPropertyValue('--home-fit-tile-height'),
          fitAvailable: getComputedStyle(document.getElementById('view-home')!).getPropertyValue('--home-fit-available-height'),
          gridTop: document.getElementById('home-dashboard-grid')!.getBoundingClientRect().top,
          firstTileStyle: (() => { const style = getComputedStyle(visible[0]); return { height: style.height, minHeight: style.minHeight, maxHeight: style.maxHeight, padding: style.padding, boxSizing: style.boxSizing, aspectRatio: style.aspectRatio, alignSelf: style.alignSelf }; })(),
          gridStyle: (() => { const style = getComputedStyle(document.getElementById('home-dashboard-grid')!); return { rows: style.gridTemplateRows, autoRows: style.gridAutoRows, align: style.alignContent }; })(),
        };
      });

      expect(layout.count, `${theme} ${viewport.width}x${viewport.height}`).toBe(12);
      expect(layout.minWidth).toBeGreaterThanOrEqual(44);
      expect(layout.minHeight).toBeGreaterThanOrEqual(44);
      expect(layout.lastBottom, `${theme} ${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`).toBeLessThanOrEqual(layout.navTop + 1);
      expect(layout.clearance).toBeGreaterThanOrEqual(-1);
      expect(layout.overflowX, `${theme} ${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`).toBe(0);
      expect(layout.mainScrollDelta).toBeLessThanOrEqual(2);
      expect(layout.mainOverflowY).toBe('hidden');
      expect(layout.navPosition).toBe('fixed');
      expect(layout.navBottom).toBe('0px');
      expect(layout.overlaps).toBe(false);
      expect(layout.clipped).toBe(false);
      expect(layout.unreadableLabel).toBe(false);

      if (viewport.width >= 1100) {
        expect(layout.columns).toBe(6);
        expect(layout.rows).toBe(2);
        expect(layout.clearance).toBeGreaterThanOrEqual(20);
        expect(layout.clearance).toBeLessThanOrEqual(52);
      } else if (viewport.width < 640 && viewport.height >= viewport.width) {
        expect(layout.columns).toBe(2);
        expect(layout.rows).toBe(6);
      } else {
        expect(layout.columns).toBeGreaterThanOrEqual(3);
        expect(layout.columns).toBeLessThanOrEqual(6);
      }
    }
  }
});

test('Home refits after resize, orientation, and 125–200 percent viewport reflow', async ({ page }) => {
  const reflowViewports = [
    { width: 1536, height: 864 },
    { width: 1097, height: 617 },
    { width: 960, height: 540 },
  ];
  await page.goto(`${fixtureUrl}?view=home&theme=dark&monitoring=0`, { waitUntil: 'domcontentloaded' });
  for (const viewport of reflowViewports) {
    await page.setViewportSize(viewport);
    await expect(page.locator('#view-home')).toHaveAttribute('data-home-fit-complete', 'true');
    await expect.poll(async () => page.locator('#view-home').getAttribute('data-home-fit-columns')).not.toBeNull();
    await expect.poll(async () => page.locator('#home-dashboard-grid').evaluate((grid) => {
      const tiles = Array.from(grid.children).filter((tile) => (tile as HTMLElement).offsetWidth) as HTMLElement[];
      const navTop = document.getElementById('bottom-nav')!.getBoundingClientRect().top;
      return navTop - Math.max(...tiles.map((tile) => tile.getBoundingClientRect().bottom));
    }), { timeout: 3_000 }).toBeGreaterThanOrEqual(-1);
    const state = await page.locator('#view-home').evaluate((home) => {
      const tiles = Array.from(document.querySelectorAll('#home-dashboard-grid > *')).filter((tile) => (tile as HTMLElement).offsetWidth) as HTMLElement[];
      const rects = tiles.map((tile) => tile.getBoundingClientRect());
      const navTop = document.getElementById('bottom-nav')!.getBoundingClientRect().top;
      const main = document.getElementById('main-scroll-area')!;
      return {
        count: rects.length,
        columns: Number((home as HTMLElement).dataset.homeFitColumns || 0),
        minHeight: Math.min(...rects.map((rect) => rect.height)),
        clearance: navTop - Math.max(...rects.map((rect) => rect.bottom)),
        scrollDelta: main.scrollHeight - main.clientHeight,
      };
    });
    expect(state.count).toBe(12);
    expect(state.columns).toBeGreaterThanOrEqual(4);
    expect(state.minHeight).toBeGreaterThanOrEqual(44);
    expect(state.clearance).toBeGreaterThanOrEqual(-1);
    expect(state.scrollDelta).toBeLessThanOrEqual(2);
  }
});

test('phone Chat composer fills the shell and never overlaps quick navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${fixtureUrl}?view=chat&theme=dark&monitoring=0`, { waitUntil: 'domcontentloaded' });

  const composer = page.locator('.chat-thread-composer');
  const nav = page.locator('#bottom-nav');
  await expect(composer).toBeVisible();
  await expect(page.locator('.android-chat-input')).toBeVisible();
  const composerBox = await composer.boundingBox();
  const navBox = await nav.boundingBox();
  expect(composerBox).not.toBeNull();
  expect(navBox).not.toBeNull();
  expect(composerBox!.width).toBeGreaterThanOrEqual(388);
  expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(navBox!.y);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(composer).toBeVisible();
  const desktopComposer = await composer.boundingBox();
  const desktopNav = await nav.boundingBox();
  expect(desktopComposer).not.toBeNull();
  expect(desktopNav).not.toBeNull();
  expect(desktopComposer!.y + desktopComposer!.height).toBeLessThanOrEqual(desktopNav!.y);
});

test('Item Inquiry fits every viewport and groups lot rows with accurate location totals', async ({ page }) => {
  const viewports = [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
  ];
  const itemFields = ['COMMONNAME', 'CONTSIZE', 'ITEMCODE', 'ITEMSPEC', 'FIELDTAGCOLOR', 'HOLDSTOPCODE', 'HOLDSTOPBEGINDATE', 'HOLDSTOPREASON', 'SUSPENDTO', 'SPECIALPULLER'];
  const rowFields = ['LOTCODE', 'LOCATIONCODE', 'SOURCE', 'DesigItem', 'DesigCust', 'DesigLoc', 'PRIORITY', 'PTRONHAND', 'PTRREVIEWED', 'PRISETBY', 'PRIUPDATED', 'LOCATIONNOTE', 'LOCATIONPTN1'];

  for (const theme of ['light', 'dark']) {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto(`${fixtureUrl}?view=item-inquiry&theme=${theme}&monitoring=0`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#item-inquiry-panel')).toBeVisible();
      await expect(page.locator('[data-item-inquiry-summary] [data-item-inquiry-field]')).toHaveCount(itemFields.length);
      expect(await page.locator('[data-item-inquiry-summary] [data-item-inquiry-field]').evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-item-inquiry-field')))).toEqual(itemFields);
      await expect(page.locator('[data-item-inquiry-location]')).toHaveCount(2);
      const f19 = page.locator('[data-item-inquiry-location="F.19.000"]');
      await expect(f19.locator('[data-item-inquiry-row-line]')).toHaveCount(3);
      await expect(f19.locator('[data-item-inquiry-location-total-onhand]')).toHaveText('1,766');
      await expect(f19.locator('[data-item-inquiry-location-total-reviewed]')).toHaveText('80');
      await expect(f19.locator('[data-item-inquiry-column="PTRREVIEWED"] .item-inquiry-cell-value')).toHaveText(['80', '—', '—']);
      const firstRowLabels = await f19.locator('[data-item-inquiry-row-line]').first().locator('[data-item-inquiry-column]').evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-item-inquiry-column')));
      expect(firstRowLabels).toEqual(rowFields);

      const layout = await page.locator('#item-inquiry-panel').evaluate((panel) => {
        const panelRect = panel.getBoundingClientRect();
        const ledger = panel.querySelector('.item-inquiry-ledger') as HTMLElement;
        const firstRow = panel.querySelector('.item-inquiry-ledger-row') as HTMLElement;
        const cellValues = Array.from(panel.querySelectorAll('.item-inquiry-cell-value')) as HTMLElement[];
        return {
          viewportWidth: window.innerWidth,
          documentOverflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
          panelLeft: panelRect.left,
          panelRight: panelRect.right,
          panelWidth: panelRect.width,
          ledgerClientWidth: ledger.clientWidth,
          ledgerScrollWidth: ledger.scrollWidth,
          ledgerClientHeight: ledger.clientHeight,
          rowColumns: getComputedStyle(firstRow).gridTemplateColumns.split(' ').filter(Boolean).length,
          headerDisplay: getComputedStyle(panel.querySelector('.item-inquiry-ledger-header')!).display,
          smallestFont: Math.min(...cellValues.map((cell) => Number.parseFloat(getComputedStyle(cell).fontSize))),
          verticalWord: cellValues.some((cell) => getComputedStyle(cell).wordBreak === 'break-all'),
        };
      });
      expect(layout.documentOverflowX, `${theme} ${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`).toBe(0);
      expect(layout.panelLeft).toBeGreaterThanOrEqual(-1);
      expect(layout.panelRight).toBeLessThanOrEqual(viewport.width + 1);
      expect(layout.panelWidth).toBeGreaterThan(250);
      expect(layout.ledgerScrollWidth).toBeLessThanOrEqual(layout.ledgerClientWidth + 1);
      expect(layout.ledgerClientHeight).toBeGreaterThan(80);
      expect(layout.smallestFont).toBeGreaterThanOrEqual(8);
      expect(layout.verticalWord).toBe(false);
      if (viewport.width >= 1100) {
        expect(layout.headerDisplay).toBe('grid');
        expect(layout.rowColumns).toBe(13);
      } else {
        expect(layout.headerDisplay).toBe('none');
        expect(layout.rowColumns).toBe(viewport.width <= 640 ? 2 : 4);
      }
    }
  }
});

test('Drive Grid is a readable spreadsheet and every control stays on one rail', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${fixtureUrl}?view=drive&display=grid&theme=dark&monitoring=0`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.drive-grid-table')).toHaveCount(0);
  await expect(page.locator('#drive-content .inv-card')).toHaveCount(4);
  await expect(page.locator('button[data-ops-display-mode="grid"]')).toBeDisabled();
  await expect(page.locator('button[data-ops-display-mode="cards"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#ops-display-note')).toContainText('Cards are always used on phones');

  for (const viewport of [{ width: 768, height: 1024 }, { width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    await page.goto(`${fixtureUrl}?view=drive&display=grid&theme=dark&monitoring=0`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.drive-grid-table')).toBeVisible();
    await expect(page.locator('.drive-grid-table thead')).toBeVisible();
    await expect(page.locator('.drive-grid-header-row > th')).toHaveCount(14);
    await expect(page.locator('.drive-grid-filter-row [data-drive-grid-filter]')).toHaveCount(14);
    await expect(page.getByLabel('Filter Common Name')).toBeVisible();
    await page.getByLabel('Filter Common Name').fill('Baby Gem');
    await expect(page.locator('.drive-grid-table tbody > tr:not([hidden])')).toHaveCount(1);
    await expect(page.locator('.drive-grid-visible-count')).toHaveText('1 of 4 rows');
    await page.getByRole('button', { name: 'Clear column filters' }).click();
    await expect(page.locator('.drive-grid-table tbody > tr:not([hidden])')).toHaveCount(4);
    const gridState = await page.locator('.drive-grid-sheet').evaluate((sheet) => {
      const cells = Array.from(sheet.querySelectorAll('tbody :is(th,td)')) as HTMLElement[];
      return {
        sheetWidth: sheet.getBoundingClientRect().width,
        tableWidth: sheet.querySelector('table')!.getBoundingClientRect().width,
        narrowestCell: Math.min(...cells.map((cell) => cell.getBoundingClientRect().width)),
        verticalWords: cells.some((cell) => getComputedStyle(cell).wordBreak === 'break-all'),
      };
    });
    expect(gridState.sheetWidth).toBeLessThanOrEqual(viewport.width);
    expect(gridState.tableWidth).toBeGreaterThanOrEqual(gridState.sheetWidth - 3);
    expect(gridState.narrowestCell).toBeGreaterThan(30);
    expect(gridState.verticalWords).toBe(false);

    const railState = await page.locator('#drive-toolbar-rail').evaluate((rail) => {
      const controls = Array.from(rail.querySelectorAll('.task-tab,.task-top-control-shell,.drive-mode-export-button,.drive-filter-reset-button')) as HTMLElement[];
      const tops = controls.filter((control) => control.offsetWidth).map((control) => Math.round(control.getBoundingClientRect().top));
      return {
        topSpread: Math.max(...tops) - Math.min(...tops),
        scrollable: rail.scrollWidth >= rail.clientWidth,
      };
    });
    expect(railState.topSpread).toBeLessThanOrEqual(2);
    expect(railState.scrollable).toBe(true);
  }
  await expect(page.getByText('Season Sales Notes', { exact: true })).toHaveCount(0);
});

test('Request detail fits the visible shell without outer scrolling or hidden actions', async ({ page }) => {
  const viewports = [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto(`${fixtureUrl}?view=detail&theme=dark&monitoring=0`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#view-detail')).toBeVisible();
    await expect(page.locator('#req-spec')).toBeVisible();
    await expect(page.locator('#req-comments')).toBeVisible();
    await expect(page.locator('#req-btn-save-complete')).toBeVisible();
    await expect(page.locator('#req-shear-action')).toBeVisible();
    await expect(page.locator('#req-matching-inventory-container')).toHaveAttribute('aria-expanded', 'false');

    const state = await page.locator('#view-detail').evaluate((detail) => {
      const main = document.getElementById('main-scroll-area')!;
      const nav = document.getElementById('bottom-nav')!;
      const form = document.getElementById('det-request-content')!;
      const summary = detail.querySelector(':scope > .freeze-panel') as HTMLElement;
      const save = document.getElementById('req-btn-save-complete')!;
      const shear = document.getElementById('req-shear-action')!;
      const rect = (element: Element) => element.getBoundingClientRect();
      return {
        outerScroll: main.scrollHeight - main.clientHeight,
        horizontalOverflow: main.scrollWidth - main.clientWidth,
        detailTop: rect(detail).top,
        detailBottom: rect(detail).bottom,
        navTop: rect(nav).top,
        formVisible: rect(form).height > 0 && rect(form).bottom <= rect(nav).top + 1,
        summaryVisible: rect(summary).height > 0,
        saveVisible: rect(save).top >= rect(form).top && rect(save).bottom <= rect(nav).top + 1,
        shearVisible: rect(shear).top >= rect(form).top && rect(shear).bottom <= rect(nav).top + 1,
        columns: getComputedStyle(detail).gridTemplateColumns.split(' ').length,
      };
    });
    expect(state.outerScroll, `${viewport.width}x${viewport.height}: ${JSON.stringify(state)}`).toBeLessThanOrEqual(2);
    expect(state.horizontalOverflow).toBeLessThanOrEqual(2);
    expect(state.detailBottom, `${viewport.width}x${viewport.height}: ${JSON.stringify(state)}`).toBeLessThanOrEqual(state.navTop + 1);
    expect(state.formVisible).toBe(true);
    expect(state.summaryVisible).toBe(true);
    expect(state.saveVisible).toBe(true);
    expect(state.shearVisible).toBe(true);
    expect(state.columns).toBe(viewport.width >= 900 ? 2 : 1);
  }
});

test('module filters sit below the command search with responsive breathing room', async ({ page }) => {
  const cases = [
    { width: 390, height: 844, minGap: 20, maxGap: 44 },
    { width: 768, height: 1024, minGap: 42, maxGap: 62 },
    { width: 1366, height: 768, minGap: 68, maxGap: 98 },
    { width: 1920, height: 1080, minGap: 84, maxGap: 120 },
  ];
  for (const viewport of cases) {
    await page.setViewportSize(viewport);
    await page.goto(`${fixtureUrl}?view=drive&theme=dark&monitoring=0`, { waitUntil: 'domcontentloaded' });
    await page.locator('#side-drawer').evaluate((drawer) => { (drawer as HTMLElement).style.display = 'none'; });
    await page.locator('#fixture-layout').evaluate((layout) => { (layout as HTMLElement).style.gridTemplateColumns = 'minmax(0, 1fr)'; });
    const spacing = await page.locator('#view-drive .ops-module-filter-band').evaluate((rail) => {
      const search = document.getElementById('global-header-search-row')!;
      const searchRect = search.getBoundingClientRect();
      const railRect = rail.getBoundingClientRect();
      const gapToken = Number.parseFloat(getComputedStyle(rail).marginTop);
      return {
        gap: Math.round((railRect.top - searchRect.bottom) * 100) / 100,
        gapToken,
        railTop: railRect.top,
        searchBottom: searchRect.bottom,
      };
    });
    expect(spacing.railTop, `${viewport.width}x${viewport.height}: ${JSON.stringify(spacing)}`).toBeGreaterThan(spacing.searchBottom);
    expect(spacing.gapToken).toBeGreaterThan(0);
    expect(spacing.gap, `${viewport.width}x${viewport.height}: ${JSON.stringify(spacing)}`).toBeGreaterThanOrEqual(viewport.minGap);
    expect(spacing.gap, `${viewport.width}x${viewport.height}: ${JSON.stringify(spacing)}`).toBeLessThanOrEqual(viewport.maxGap);
  }
});

test('light and dark navigation use explicit semantic fallback colors', async ({ page }) => {
  for (const theme of ['light', 'dark']) {
    await page.goto(`${fixtureUrl}?view=drive&theme=${theme}&monitoring=0`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.locator('body').getAttribute('data-ops-theme')).toBe(theme);
    await expect.poll(() => page.locator('#bottom-nav').getAttribute('data-resolved-theme')).toBe(theme);
    await page.locator('body').evaluate((body) => body.removeAttribute('data-ops-theme'));
    const navState = await page.locator('#bottom-nav').evaluate((nav) => {
      const toRgb = (value: string) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const luminance = (value: string) => {
        const channels = toRgb(value).map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
      };
      const contrast = (foreground: string, background: string) => {
        const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
        return (lighter + 0.05) / (darker + 0.05);
      };
      const inactive = nav.querySelector('.footer-nav-btn:not(.active)') as HTMLElement;
      const active = nav.querySelector('.footer-nav-btn.active') as HTMLElement;
      const label = inactive.querySelector('span') as HTMLElement;
      const navStyle = getComputedStyle(nav);
      const inactiveStyle = getComputedStyle(inactive);
      const activeStyle = getComputedStyle(active);
      return {
        background: navStyle.backgroundColor,
        border: navStyle.borderTopColor,
        inactiveColor: inactiveStyle.color,
        activeColor: activeStyle.color,
        activeBackground: activeStyle.backgroundColor,
        inactiveContrast: contrast(inactiveStyle.color, navStyle.backgroundColor),
        activeContrast: contrast(activeStyle.color, activeStyle.backgroundColor),
        labelOpacity: getComputedStyle(label).opacity,
        resolvedTheme: (nav as HTMLElement).dataset.resolvedTheme,
      };
    });
    expect(navState.background).toBe(theme === 'dark' ? 'rgb(11, 28, 22)' : 'rgb(255, 255, 255)');
    expect(navState.border).not.toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/);
    expect(navState.inactiveContrast).toBeGreaterThanOrEqual(4.5);
    expect(navState.activeContrast).toBeGreaterThanOrEqual(4.5);
    expect(navState.activeBackground).not.toBe(navState.background);
    expect(navState.labelOpacity).toBe('1');
    expect(navState.resolvedTheme).toBe(theme);
  }
});

test('anonymous monitoring activates for non-Dylan sessions without PII', async ({ page }) => {
  await page.goto(`${fixtureUrl}?pilot=0&monitoring=1&theme=dark`, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.locator('body').getAttribute('data-qa-ready')).toBe('true');
  expect(await page.locator('body').getAttribute('data-qa-sentry-pii')).toBe('false');
  expect(await page.locator('body').getAttribute('data-qa-error-sample')).toBe('1');
  expect(await page.locator('body').getAttribute('data-qa-trace-sample')).toBe('0.1');
  const payload = String(await page.locator('body').getAttribute('data-qa-monitoring-events'));
  expect(payload).not.toContain('dylan_collyge');
  expect(payload).not.toContain('private note');
  expect(payload).not.toContain('ABC-123456');
});

test('non-Dylan users receive Appearance controls with phone-safe Grid behavior', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${fixtureUrl}?pilot=1&monitoring=0&theme=light&display=cards&reset=1`, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.locator('body').getAttribute('data-qa-ready')).toBe('true');
  await expect(page.locator('#ops-pilot-settings')).toBeVisible();
  await expect(page.locator('button[data-ops-theme-mode="light"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('button[data-ops-display-mode="grid"]')).toBeDisabled();
  await page.locator('button[data-ops-theme-mode="dark"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-ops-theme', 'dark');

  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(page.locator('button[data-ops-display-mode="grid"]')).toBeEnabled();
  await page.locator('button[data-ops-display-mode="grid"]').click();
  await expect(page.locator('body')).toHaveClass(/ops-grid-effective/);
});
