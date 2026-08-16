import { expect, test } from '@playwright/test';

const fixtureUrl = '/tests/fixtures/ops-precision-browser.html';

test('phone login keeps both fields and the submit action visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=V2026.08.16.04', { waitUntil: 'domcontentloaded' });

  const username = page.locator('#username-input');
  const accessCode = page.locator('#pin-code');
  const submit = page.locator('#login-button');
  await expect(username).toBeVisible();
  await expect(accessCode).toBeVisible();
  await expect(submit).toBeVisible();

  const controls = await Promise.all([username, accessCode, submit].map((control) => control.boundingBox()));
  expect(controls.every((box) => box && box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844)).toBe(true);
});

test('Home fits the 12 primary launch modules above navigation without desktop scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${fixtureUrl}?view=home&theme=dark&monitoring=0`, { waitUntil: 'domcontentloaded' });
  const phone = await page.locator('#home-dashboard-grid > *').evaluateAll((tiles) => {
    const rects = tiles.filter((tile) => (tile as HTMLElement).offsetWidth).map((tile) => tile.getBoundingClientRect());
    return {
      count: rects.length,
      columns: new Set(rects.map((rect) => Math.round(rect.left))).size,
      rows: new Set(rects.map((rect) => Math.round(rect.top))).size,
      lastBottom: Math.round(rects.at(-1)?.bottom || 0),
      navTop: Math.round(document.getElementById('bottom-nav')!.getBoundingClientRect().top),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(phone.count).toBe(12);
  expect(phone.columns).toBe(2);
  expect(phone.rows).toBe(6);
  expect(phone.lastBottom).toBeLessThanOrEqual(phone.navTop);
  expect(phone.overflow).toBe(0);

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const desktop = await page.locator('#home-dashboard-grid > *').evaluateAll((tiles) => {
    const rects = tiles.filter((tile) => (tile as HTMLElement).offsetWidth).map((tile) => tile.getBoundingClientRect());
    const navTop = document.getElementById('bottom-nav')!.getBoundingClientRect().top;
    return {
      columns: new Set(rects.map((rect) => Math.round(rect.left))).size,
      rows: new Set(rects.map((rect) => Math.round(rect.top))).size,
      lastBottom: Math.round(rects.at(-1)?.bottom || 0),
      navTop: Math.round(navTop),
      mainOverflowY: getComputedStyle(document.getElementById('main-scroll-area')!).overflowY,
      mainScrollDelta: document.getElementById('main-scroll-area')!.scrollHeight - document.getElementById('main-scroll-area')!.clientHeight,
    };
  });
  expect(desktop.columns).toBe(6);
  expect(desktop.rows).toBe(2);
  expect(desktop.lastBottom).toBeLessThan(desktop.navTop);
  expect(desktop.mainOverflowY).toBe('hidden');
  expect(desktop.mainScrollDelta).toBeLessThanOrEqual(2);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const wide = await page.locator('#home-dashboard-grid > *').evaluateAll((tiles) => {
    const rects = tiles.filter((tile) => (tile as HTMLElement).offsetWidth).map((tile) => tile.getBoundingClientRect());
    return {
      columns: new Set(rects.map((rect) => Math.round(rect.left))).size,
      rows: new Set(rects.map((rect) => Math.round(rect.top))).size,
      lastBottom: Math.round(rects.at(-1)?.bottom || 0),
      navTop: Math.round(document.getElementById('bottom-nav')!.getBoundingClientRect().top),
    };
  });
  expect(wide.columns).toBe(6);
  expect(wide.rows).toBe(2);
  expect(wide.lastBottom).toBeLessThan(wide.navTop);
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
