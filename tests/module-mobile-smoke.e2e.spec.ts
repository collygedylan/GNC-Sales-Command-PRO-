import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { installSalesMobileFixture } from './fixtures/sales-mobile-fixture';
import { installDriveCardLayoutFixture, renderDriveLayoutCard, restoreDriveLayoutRenderer, settleDriveLayoutShell } from './fixtures/drive-card-layout';

// Opening/layout evidence only. The real compiled renderers and click handlers run,
// but API reads are synthetic. No business action, email or inventory write is
// accepted here. This cannot establish save/reload correctness or real RLS.
const themes = ['light', 'dark', 'outdoor'] as const;
type Evidence = { screen: string; theme: string; view: string; text: string; controls: number; issues: string[] };

test('Drive compact cards fit phone widths in every theme and keep row actions usable', async ({ page, baseURL }, testInfo) => {
  const fixtureControl = await installDriveCardLayoutFixture(page, baseURL!);
  await settleDriveLayoutShell(page, testInfo.project.name);
  for (const theme of themes) {
    for (const width of [320, 360, 390]) {
      await test.step(`${theme} at ${width}px`, async () => {
        await page.setViewportSize({ width, height: 844 });
        await renderDriveLayoutCard(page, { theme, photo: true, longContent: true });
        const card = page.locator('#drive-content .app-drive-compact-card').first();
        await expect(card).toBeVisible();
        await expect.poll(() => card.locator('.app-drive-card-photo img').evaluate((image: HTMLImageElement) => image.naturalWidth))
          .toBeGreaterThan(0);
        const metrics = await card.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const rect = (selector: string) => {
            const node = element.querySelector(selector);
            if (!node) return null;
            const r = node.getBoundingClientRect();
            return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
          };
          const title = element.querySelector('.app-drive-card-title')!;
          const photo = element.querySelector('.app-drive-card-photo :is(.app-smart-thumb,.app-inline-thumb-box)')!;
          return {
            card: { x: box.x, right: box.right, width: box.width, height: box.height },
            padding: getComputedStyle(element).paddingTop,
            titleSize: getComputedStyle(title).fontSize,
            photo: { width: photo.getBoundingClientRect().width, height: photo.getBoundingClientRect().height },
            header: rect('.app-drive-card-header'), details: rect('.app-drive-card-details'),
            grid: rect('.app-drive-card-grid'),
            action: rect('.app-drive-card-reclass .app-card-bottom-btn'),
            docOverflow: document.documentElement.scrollWidth - innerWidth,
            cardOverflow: element.scrollWidth - element.clientWidth,
            text: (element as HTMLElement).innerText,
            quantity: [...element.querySelectorAll('.app-card-qty-chip')].map((chip) => ({
              label: chip.querySelector('.app-card-qty-label')?.textContent?.trim() || '',
              value: chip.querySelector('.app-card-qty-value')?.textContent?.trim() || '',
            })),
          };
        });
        expect(metrics.card.x).toBeGreaterThanOrEqual(-1);
        expect(metrics.card.right).toBeLessThanOrEqual(width + 1);
        expect(metrics.padding).toBe('10px');
        expect(metrics.titleSize).toBe('18px');
        expect(metrics.photo).toEqual({ width: 64, height: 62 });
        expect(metrics.header && metrics.details && metrics.header.bottom).toBeLessThanOrEqual(metrics.details?.y ?? -1);
        await expect(card.locator('.app-drive-card-reclass .app-card-bottom-btn')).toHaveCount(1);
        expect(metrics.action?.width).toBeGreaterThanOrEqual(44);
        expect(metrics.action?.height).toBeGreaterThanOrEqual(44);
        expect(metrics.header && metrics.action && metrics.header.right).toBeLessThanOrEqual(metrics.action?.x ?? -1);
        expect(Math.abs((metrics.action?.right ?? 0) - (metrics.grid?.right ?? 0))).toBeLessThanOrEqual(1);
        expect(metrics.quantity).toEqual([
          { label: 'On hand', value: 'Unknown' }, { label: 'Review', value: 'Unknown' },
          { label: 'Available', value: 'Unknown' }, { label: 'Open Stock', value: 'Unknown' },
        ]);
        expect(metrics.docOverflow).toBeLessThanOrEqual(1);
        expect(metrics.cardOverflow).toBeLessThanOrEqual(1);
        expect(metrics.text).toContain('Synthetic hold reason');
        expect(metrics.text).toContain('Synthetic long sales note');

        if (theme === 'light' && width === 390) {
          const longHeight = metrics.card.height;
          await renderDriveLayoutCard(page, { theme, photo: true, longContent: false });
          const shortHeight = await card.evaluate((element) => element.getBoundingClientRect().height);
          expect(longHeight).toBeGreaterThan(shortHeight);
          await renderDriveLayoutCard(page, { theme, photo: true, longContent: true });
          await card.screenshot({ path: '.gnc-local/drive-compact-390-light.png' });
          await card.locator('.app-drive-card-photo .app-inline-thumb-column').click();
          const photoModal = page.locator('#photo-modal');
          await expect(photoModal).toBeVisible();
          await expect(photoModal.locator('#photo-modal-caption')).toContainText('Synthetic Long Drive Card Name');
          await photoModal.getByRole('button', { name: 'Close photo viewer' }).click();
          await renderDriveLayoutCard(page, { theme, photo: true, knownQuantities: true });
          const values = await card.locator('.app-card-qty-chip').evaluateAll((chips) => chips.map((chip) => ({
            label: chip.querySelector('.app-card-qty-label')?.textContent?.trim(),
            value: chip.querySelector('.app-card-qty-value')?.textContent?.trim(),
          })));
          expect(values).toEqual([
            { label: 'On hand', value: '15' }, { label: 'Review', value: '2' },
            { label: 'Available', value: '13' }, { label: 'Open Stock', value: '8' },
          ]);
        }

        // A second real render without photo keeps the designed empty-media
        // placeholder and does not invent an image.
        await renderDriveLayoutCard(page, { theme, photo: false, longContent: true });
        const noPhoto = page.locator('#drive-content .app-drive-compact-card').first();
        await expect(noPhoto.locator('.app-drive-card-photo .app-inline-thumb-box--empty')).toBeVisible();
        await expect(noPhoto.locator('.app-drive-card-photo img')).toHaveCount(0);
        await expect(noPhoto.locator('.app-drive-card-header')).toContainText('LAYOUT.001');
        await expect(noPhoto.locator('.app-drive-card-details')).toContainText('Unknown');
        const emptyPhotoBounds = await noPhoto.evaluate((element) => ({
          overflow: element.scrollWidth - element.clientWidth,
          photo: element.querySelector('.app-drive-card-photo')!.getBoundingClientRect().toJSON(),
          action: element.querySelector('.app-drive-card-reclass .app-card-bottom-btn')!.getBoundingClientRect().toJSON(),
          grid: element.querySelector('.app-drive-card-grid')!.getBoundingClientRect().toJSON(),
        }));
        expect(emptyPhotoBounds.overflow).toBeLessThanOrEqual(1);
        expect(emptyPhotoBounds.photo.width).toBe(64);
        expect(emptyPhotoBounds.action.width).toBeGreaterThanOrEqual(44);
        expect(Math.abs(emptyPhotoBounds.action.right - emptyPhotoBounds.grid.right)).toBeLessThanOrEqual(1);
      });
    }
  }

  // Verify the actual selection and row-opening handlers still work after the
  // compact markup is mounted. Neither interaction submits a business write.
  await page.setViewportSize({ width: 390, height: 844 });
  await renderDriveLayoutCard(page, { theme: 'light', photo: true, longContent: true });
  const card = page.locator('#drive-content .app-drive-compact-card').first();
  const cart = card.locator('.app-card-bottom-rail [data-cart-dom-id]');
  await expect(cart).toBeVisible();
  await cart.click();
  await expect(cart).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.eval(`selectedItems.has('drive-layout-synthetic-1-photo')`))).toBe(true);
  const reclass = card.locator('.app-drive-card-reclass .app-card-bottom-btn');
  await expect(reclass).toHaveCount(1);
  await reclass.click();
  const transaction = page.locator('#argos-inventory-transaction-modal');
  await expect(transaction).toBeVisible();
  await expect(transaction.locator('#argos-inventory-transaction-title')).toContainText('Reclass Item Inquiry');
  await transaction.getByRole('button', { name: 'Close inventory transaction' }).click();
  await card.locator('.app-drive-card-title').click();
  await expect.poll(() => page.evaluate(() => window.eval(`({ view: document.body.dataset.currentView, uid: activeItem && activeItem.UNIQUE_ID })`)))
    .toEqual({ view: 'detail', uid: 'drive-layout-synthetic-1-photo' });
  // REP quick-request access is available for known available quantity rows.
  await renderDriveLayoutCard(page, { theme: 'light', photo: true, knownQuantities: true, rep: true });
  const repCard = page.locator('#drive-content .app-drive-compact-card').first();
  await expect(repCard).toBeVisible();
  await expect(repCard.locator('.app-drive-card-reclass')).toHaveCount(0);
  const repCart = repCard.locator('.app-card-bottom-rail [data-cart-dom-id]');
  await expect(repCart).toBeVisible();
  await repCart.click();
  await expect(repCart).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.eval(`selectedItems.has('drive-layout-synthetic-1-photo')`))).toBe(true);
  await expect(repCard.locator('input.card-checkbox')).toHaveCount(0);
  await restoreDriveLayoutRenderer(page);
  expect(fixtureControl.blockedMutations).toEqual([]);
  expect(fixtureControl.errors).toEqual([]);
});

async function fixture(page: Page, baseURL: string) {
  const source = await installSalesMobileFixture(page, baseURL);
  const blocked: string[] = [];
  // These Manager reads are outside the HL fixture's inventory projection.
  // Model their empty state explicitly; unknown RPCs and all writes still fall
  // through to the fixture's mutation rejection.
  await page.route('**/rest/v1/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const emptyRead = () => route.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': new URL(baseURL).origin,
        'access-control-allow-credentials': 'true', 'content-range': '*/0' }, body: '[]' });
    if (request.method() === 'POST' && url.pathname === '/rest/v1/rpc/search_historical_inventory_common_names') {
      const payload = request.postDataJSON();
      expect(Object.keys(payload).sort(), 'historical-name read parameters').toEqual(['result_limit', 'search_text']);
      expect(payload.result_limit).toBe(100);
      expect(typeof payload.search_text).toBe('string');
      return emptyRead();
    }
    return route.fallback();
  });
  await page.route('**/functions/v1/app-api', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON() || {}, operation = body.operation || '';
    const reply = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': new URL(baseURL).origin, 'access-control-allow-credentials': 'true' },
      body: JSON.stringify({ ok: true, data }) });
    if (body.action === 'inventory_read' && operation === 'not_on_inventory_queue') {
      return reply({ rows: [], total: 0, offset: body.params?.offset || 0, limit: body.params?.limit || 250, hasMore: false });
    }
    if (body.commandId || body.command_id || /^(save|submit|publish|send|complete|add|claim|release|assign|review|amend|authorize|upload|delete|update|set_)/.test(operation)) {
      blocked.push(`${body.action}:${operation}`);
      return route.fulfill({ status: 403, contentType: 'application/json',
        headers: { 'access-control-allow-origin': new URL(baseURL).origin }, body: JSON.stringify({ ok: false, error: 'SMOKE_MUTATION_BLOCKED' }) });
    }
    if (body.action === 'season_sales_office' && operation === 'access') return route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': new URL(baseURL).origin, 'access-control-allow-credentials': 'true' },
      body: JSON.stringify({ ok: true, allowed: true, canManage: true, users: ['dylan_collyge'] }),
    });
    // Opening Season Priority reads its list and receipt status. Fulfill both
    // locally; submit/retry and unknown operations still reach mutation rejection.
    if (body.action === 'drive_reclass_inquiry'
        && ['season_priority_list', 'season_priority_state'].includes(operation)) return route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': new URL(baseURL).origin, 'access-control-allow-credentials': 'true' },
      body: JSON.stringify({ ok: true, inventoryRevision: 10, inventoryState: 'ready',
        ...(operation === 'season_priority_list' ? { rows: [], assignedToOptions: [] } : { requests: [] }) }),
    });
    if (body.action === 'navigation_preferences' && operation === 'users') return reply([{ id: source.navigation.profileId, username: 'dylan_collyge', displayName: 'Dylan fixture', role: 'ADMIN', active: true }]);
    if (body.action === 'navigation_preferences' && operation === 'user_access') return reply(source.navigation);
    if (body.action === 'bunch_note') {
      const reads: Record<string, unknown> = { blocks: { blocks: [] }, catalog: { options: [], locations: [] },
        directory: { users: [] }, drafts: { drafts: [] }, list: { jobs: [] }, destinations: { locations: [] } };
      if (Object.hasOwn(reads, operation)) return reply(reads[operation]);
    }
    return route.fallback();
  });
  return { source, blocked };
}

async function home(page: Page) {
  await page.locator('#footer-home-btn').tap();
  await expect(page.locator('#view-home')).toBeVisible();
}

async function drawer(page: Page, view: string) {
  await home(page);
  await page.locator('#footer-menu-btn').tap();
  const entry = page.locator(`#drawer-${view}-btn`);
  await expect(entry, `Dylan retains ${view} navigation`).toBeVisible();
  await entry.tap();
}

async function checkScreen(page: Page, view: string, screen: string, evidence: Evidence[], back = true) {
  const area = page.locator(`#view-${view}`);
  await expect(area, `${screen} opens its real view`).toBeVisible();
  // The view can become visible before its scheduled renderer commits content.
  // Wait for that real commit; a persistently blank view must still fail.
  await expect(area, `${screen} renders content`).toContainText(/\S/, { useInnerText: true });
  if (view === 'advertisement') {
    // Wait for the real, vendored Fabric editor rather than its loading shell.
    await expect(area.locator('#advertisement-canvas')).toHaveAttribute('data-fabric', 'main');
    await expect(area.locator('canvas.upper-canvas[data-fabric="top"]')).toBeVisible();
    await expect(area.locator('#advertisement-loading')).toBeHidden();
    await expect(area.locator('#advertisement-status')).not.toHaveClass(/\berror\b/);
    await expect(page.locator('#toast-notification')).not.toContainText('Editor Error');
  }
  // Let the actual frame scheduler paint without replacing any app functions.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  for (const theme of themes) {
    await page.evaluate(value => {
      document.body.classList.add('ops-precision-pilot');
      document.body.dataset.opsTheme = value === 'dark' ? 'dark' : 'light';
      document.documentElement.classList.toggle('outdoor-mode', value === 'outdoor');
      document.body.classList.toggle('outdoor-mode', value === 'outdoor');
    }, theme);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const result = await area.evaluate((element, options) => {
      const issues: string[] = [], bounds = element.getBoundingClientRect();
      const rendered = (node: Element) => !!node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
      if (document.documentElement.scrollWidth > innerWidth + 1) issues.push(`page overflow ${document.documentElement.scrollWidth}/${innerWidth}`);
      if (bounds.left < -1 || bounds.right > innerWidth + 1) issues.push(`view bounds ${bounds.left}..${bounds.right}/${innerWidth}`);
      const controls = [...element.querySelectorAll('button,input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]),select,textarea,[role=button]')].filter(rendered);
      for (const control of controls) {
        const box = control.getBoundingClientRect(), name = control.id || control.getAttribute('aria-label') || (control.textContent || '').trim().slice(0, 55) || control.tagName;
        if (box.height < 43.5 || box.width < 43.5) issues.push(`small control ${name}: ${box.width.toFixed(1)}x${box.height.toFixed(1)}`);
        // Horizontal scrolling is allowed inside an explicit bounded scroll region.
        let scrollRegion = control.parentElement, contained = false;
        while (scrollRegion && scrollRegion !== element) {
          const style = getComputedStyle(scrollRegion);
          if (['auto', 'scroll'].includes(style.overflowX)) { contained = true; break; }
          scrollRegion = scrollRegion.parentElement;
        }
        if (!contained && (box.left < -1 || box.right > innerWidth + 1)) issues.push(`clipped control ${name}: ${box.left.toFixed(1)}..${box.right.toFixed(1)}`);
      }
      const backs = [...document.querySelectorAll('button[aria-label="Back"],button[data-secondary-back]')].filter(rendered);
      if (options.back && (backs.length !== 1 || backs[0].id !== 'global-header-inline-back')) issues.push(`Back controls: ${backs.map(node => node.id || node.textContent?.trim()).join(', ')}`);
      const text = (element as HTMLElement).innerText.trim();
      if (!text) issues.push('empty view');
      const footer = document.getElementById('bottom-nav');
      if (footer && footer.getBoundingClientRect().bottom > innerHeight + 1) issues.push('footer below viewport');
      return { text: text.slice(0, 220), controls: controls.length, issues };
    }, { back });
    evidence.push({ screen, theme, view, ...result });
    expect.soft(result.issues, `${screen}, ${theme}`).toEqual([]);
  }
}

async function finish(info: TestInfo, evidence: Evidence[], f: Awaited<ReturnType<typeof fixture>>) {
  await info.attach('module-opening-evidence.json', { body: JSON.stringify({ limits: 'Read-only synthetic data; no saved-work, backend, physical-device or offline assurance.', evidence }, null, 2), contentType: 'application/json' });
  expect.soft(f.source.native.errors, 'compiled runtime errors').toEqual([]);
  expect.soft(f.blocked, 'unexpected command mutations').toEqual([]);
  expect.soft(f.source.native.blockedMutations, 'unexpected backend mutations').toEqual([]);
  expect(f.source.native.runtime).toBeGreaterThan(0);
}

type HubRoute = readonly [parent: string, selector: string, view: string];
const phoneHubRouteGroups: Record<string, HubRoute[]> = {
  'Sales and inventory routes': [
    ['sales', '#hub-extra-sales-request-history', 'request-history'],
    ['sales', '#hub-extra-sales-sales-credit', 'sales-credit'],
    ['sales', '#hub-extra-sales-credit-request', 'credit-request'],
    ['sales-inventory', '#inventory-open-po-management', 'po-management'],
    ['sales-inventory', '#inventory-open-weather-hold', 'weather-hold'],
    ['sales-inventory', '#inventory-open-inventory-office', 'moves'],
    ['sales-inventory', '#inventory-open-not-on-inventory', 'detail'],
  ],
  'Production routes': [
    ['production', '#production-open-shear-list', 'shear-list'],
    ['production', '#production-open-propagation', 'production-workflow'],
    ['production', '#production-open-planting', 'production-workflow'],
    ['production', '#production-open-can-filling', 'production-workflow'],
    ['production', '#production-open-order-pulling', 'production-workflow'],
    ['production', '#production-open-84rd', 'sales-inventory'],
  ],
  'Communication and Reports routes': [
    ['communication', '#communication-hub-grid button[onclick*="switchView(\'chat\')"]', 'chat'],
    ['communication', '#communication-hub-grid button[onclick*="switchView(\'department-calendar\')"]', 'department-calendar'],
    ['managers', '#hub-extra-managers-reports', 'reports'],
  ],
};

async function checkHubRoutes(page: Page, baseURL: string, info: TestInfo, routes: HubRoute[]) {
  const f = await fixture(page, baseURL), evidence: Evidence[] = [];
  try {
    for (const [parent, selector, view] of routes) await test.step(`${parent}/${view}`, async () => {
      await drawer(page, parent);
      await page.locator(selector).tap();
      await checkScreen(page, view, selector, evidence);
      if (/can-filling|order-pulling/.test(selector)) {
        await expect(page.locator('#production-workflow-page-content')).toContainText('Not yet available');
        await expect(page.locator('#production-workflow-page-content input')).toHaveCount(0);
      }
      await page.locator('#global-header-inline-back').tap();
      await expect(page.locator(`#view-${parent}`), `Back to ${parent}`).toBeVisible();
    });
  } finally { await finish(info, evidence, f); }
}

async function checkManagerModuleGroup(page: Page, baseURL: string, info: TestInfo, group: 0 | 1) {
  const f = await fixture(page, baseURL), evidence: Evidence[] = [];
  try {
    await drawer(page, 'managers');
    const moduleButtons = page.locator('#view-managers .manager-module-card:visible');
    await expect(moduleButtons.first(), 'Manager picker is painted before inventory').toBeVisible();
    const modules = await moduleButtons.evaluateAll(nodes => nodes.map(node => ({
      label: node.getAttribute('aria-label')!,
      tab: (node.getAttribute('onclick') || '').match(/setHomeTab\('([^']+)'/)?.[1] || '',
    })));
    expect(modules.length, 'real Manager module inventory').toBeGreaterThan(5);
    const midpoint = Math.ceil(modules.length / 2);
    const selectedModules = group === 0 ? modules.slice(0, midpoint) : modules.slice(midpoint);
    expect(selectedModules.length, `Manager module group ${group + 1} is nonempty`).toBeGreaterThan(0);
    for (const { label, tab } of selectedModules) await test.step(label, async () => {
      expect(tab, 'module has a concrete navigation target').not.toBe('');
      await page.locator('#view-managers').getByRole('button', { name: label, exact: true }).tap();
      const view = tab === 'hours' ? 'hours' : 'managers';
      await expect.poll(() => page.evaluate(() => ({
        view: document.body.dataset.currentView,
        tab: window.eval('activeHomeTab'),
      })), { message: `The requested ${label} module actually opens` }).toEqual({
        view, tab: tab === 'hours' ? 'dashboard' : tab,
      });
      await checkScreen(page, view, `Manager/${label}`, evidence);
      if (tab === 'season-priority') {
        await expect(page.locator('#manager-season-priority')).toContainText('No selected Season Sales Notes at priority 2, 3, or 4 match these filters.');
        await expect(page.locator('#manager-season-priority [role="alert"]')).toHaveCount(0);
      }
      await page.locator('#global-header-inline-back').tap();
      await expect(page.locator('#view-managers .manager-module-card:visible').first()).toBeVisible();
    });
  } finally { await finish(info, evidence, f); }
}

const drawerGroups = {
  'inventory and work modules': ['drive', 'tasks', 'request', 'av', 'reserves', 'docks', 'take-back', 'crop-roll', 'low-stock', 'review', 'move-up'],
  'hubs and specialist modules': ['sales', 'sales-inventory', 'production', 'office', 'qc', 'communication', 'sales-office', 'advertisement', 'grower', 'pest-management', 'disease-pest', 'hours', 'bunch-note', 'hl-order'],
};
for (const [group, views] of Object.entries(drawerGroups)) test(`phone opening smoke: ${group}`, async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!), evidence: Evidence[] = [];
  try {
    for (const view of views) await test.step(view, async () => {
      await drawer(page, view);
      await checkScreen(page, view, `drawer/${view}`, evidence);
      await page.locator('#global-header-inline-back').tap();
      await expect(page.locator('#view-home'), `Back from ${view} returns Home`).toBeVisible();
    });
  } finally { await finish(info, evidence, f); }
});

for (const [group, routes] of Object.entries(phoneHubRouteGroups)) {
  test(`phone opening smoke: ${group}`, async ({ page, baseURL }, info) => {
    await checkHubRoutes(page, baseURL!, info, routes);
  });
}

test('phone opening smoke: first half of accessible Manager modules', async ({ page, baseURL }, info) => {
  await checkManagerModuleGroup(page, baseURL!, info, 0);
});

test('phone opening smoke: second half of accessible Manager modules', async ({ page, baseURL }, info) => {
  await checkManagerModuleGroup(page, baseURL!, info, 1);
});

test('phone opening smoke: footer shortcut settings', async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!), evidence: Evidence[] = [];
  try {
    await home(page);
    await page.locator('#footer-menu-btn').tap();
    await page.getByRole('button', { name: 'Customize shortcuts', exact: true }).tap();
    const dialog = page.getByRole('dialog', { name: 'Footer shortcuts', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'Shortcut 1', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await dialog.getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(dialog).toBeHidden();
  } finally { await finish(info, evidence, f); }
});
