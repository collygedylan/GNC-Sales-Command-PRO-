import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { installSalesMobileFixture } from './fixtures/sales-mobile-fixture';

// Opening/layout evidence only. The real compiled renderers and click handlers run,
// but API reads are synthetic. No business action, email or inventory write is
// accepted here. This cannot establish save/reload correctness or real RLS.
const themes = ['light', 'dark', 'outdoor'] as const;
type Evidence = { screen: string; theme: string; view: string; text: string; controls: number; issues: string[] };

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
    if (request.method() === 'GET' && url.pathname === '/rest/v1/ph_master_inventory'
        && url.searchParams.get('app_tab_assignment') === 'eq.not_on_inventory_dylan') return emptyRead();
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

test('phone opening smoke: hub children, production states, detail and Reports', async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!), evidence: Evidence[] = [];
  const routes = [
    ['sales', '#hub-extra-sales-request-history', 'request-history'],
    ['sales', '#hub-extra-sales-sales-credit', 'sales-credit'],
    ['sales', '#hub-extra-sales-credit-request', 'credit-request'],
    ['sales-inventory', '#inventory-open-po-management', 'po-management'],
    ['sales-inventory', '#inventory-open-weather-hold', 'weather-hold'],
    ['sales-inventory', '#inventory-open-inventory-office', 'moves'],
    ['sales-inventory', '#inventory-open-not-on-inventory', 'detail'],
    ['production', '#production-open-shear-list', 'shear-list'],
    ['production', '#production-open-propagation', 'production-workflow'],
    ['production', '#production-open-planting', 'production-workflow'],
    ['production', '#production-open-can-filling', 'production-workflow'],
    ['production', '#production-open-order-pulling', 'production-workflow'],
    ['production', '#production-open-84rd', 'sales-inventory'],
    ['communication', '#communication-hub-grid button[onclick*="switchView(\'chat\')"]', 'chat'],
    ['communication', '#communication-hub-grid button[onclick*="switchView(\'department-calendar\')"]', 'department-calendar'],
    ['managers', '#hub-extra-managers-reports', 'reports'],
  ];
  try {
    for (const [parent, selector, view] of routes) await test.step(`${parent}/${selector}`, async () => {
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
});

test('phone opening smoke: each accessible Manager module and footer settings', async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!), evidence: Evidence[] = [];
  try {
    await drawer(page, 'managers');
    const moduleButtons = page.locator('#view-managers .manager-module-card:visible');
    await expect(moduleButtons.first(), 'Manager picker is painted before inventory').toBeVisible();
    const modules = await moduleButtons.evaluateAll(nodes => nodes.map(node => ({
      label: node.getAttribute('aria-label')!,
      tab: (node.getAttribute('onclick') || '').match(/setHomeTab\('([^']+)'/)?.[1] || '',
    })));
    expect(modules.length, 'real Manager module inventory').toBeGreaterThan(5);
    for (const { label, tab } of modules) await test.step(label, async () => {
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
