import { expect, test } from '@playwright/test';

const fixtureUrl = '/tests/fixtures/ops-precision-browser.html';

test('phone login keeps both fields and the submit action visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=V2026.08.16.07', { waitUntil: 'domcontentloaded' });

  const username = page.locator('#username-input');
  const accessCode = page.locator('#pin-code');
  const submit = page.locator('#login-button');
  await expect(username).toBeVisible();
  await expect(accessCode).toBeVisible();
  await expect(submit).toBeVisible();

  const controls = await Promise.all([username, accessCode, submit].map((control) => control.boundingBox()));
  expect(controls.every((box) => box && box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844), JSON.stringify(controls)).toBe(true);
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
