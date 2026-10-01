// September 9 behavior coverage; preserved complete tests/sales-marketing-tasks.e2e.spec.ts fixture.
// See docs/rollback-sep09-validation.md for deliberately removed later contracts.
import { installHlOrderFixture, hlMaster } from './fixtures/hl-order-state.mjs';
import { expect, test } from '@playwright/test';

for (const username of ['madison_austin', 'madelyn_gray']) {
  test(`${username} sees shared AV Blanks but only Season Sales Notes`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    // No real accounts, customer data, or production writes are used.
    const fixtureRows = async (table: string) => page.evaluate(table => {
      const fixture = (window as any).__marketingFixture || {};
      return fixture[table === 'ph_master_inventory' ? 'data' : table === 'ph_cav_import' ? 'cavAvBlankKeysData' : 'unused'] || [];
    }, table);
    await page.route('**/functions/v1/**', async route => {
      const body = route.request().postDataJSON() || {};
      if (body.action === 'db' && body.method !== 'GET') return route.abort();
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data: await fixtureRows(body.table) }) });
    });
    await page.route('**/rest/v1/**', async route => {
      if (route.request().method() !== 'GET') return route.abort();
      const table = new URL(route.request().url()).pathname.split('/').pop()!;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(await fixtureRows(table)) });
    });
    await page.goto('/?post_deploy_access_canary=sales-marketing-tasks', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof (window as any).installMutationBlockedAccessCanaryIdentity === 'function');
    const result = await page.evaluate((username) => {
      const w = window as any;
      w.installMutationBlockedAccessCanaryIdentity(username, username, 'sales/marketing');
      // This is a deterministic cached-data UI test. Do not let login warmup
      // replace its three-row fixture with an unrelated empty API response.
      w.ensureDatasetLoaded = async () => true;
      w.ensureViewDataForRender = () => false;
      const season = w.getConfiguredCurrentSeasonCode();
      const year = w.getConfiguredCurrentSalesYearCode();
      const row = { UNIQUE_ID: 'sm-season-1', ITEMCODE: 'SM.001', COMMONNAME: 'Shared Season Plant', CONTSIZE: '#1',
        SEASON: season, SALESYEAR: year, SALEYEAR: year, LOTCODE: `${year}.${season}`, LOCATIONCODE: 'A.01.001',
        PRIORITY: '1', PTRONHAND: 100, PTRAVAILABLE: 100, ASSIGNEDTO: 'megan_kelly', APP_TAB_ASSIGNMENT: 'season' };
      w.__marketingFixture = { data: [row,
        { ...row, UNIQUE_ID: 'sm-held', ITEMCODE: 'SM.002', COMMONNAME: 'Held Plant', HOLDSTOPCODE: 'H', APP_TAB_ASSIGNMENT: 'location' },
        { ...row, UNIQUE_ID: 'sm-filled', ITEMCODE: 'SM.003', COMMONNAME: 'Already Entered Plant' }
      ], warehouseAssignedItemsData: [], cavAvBlankKeysData: [
        { ITEMCODE: 'SM.001', SEASON: season, HOLDSTOPREASON: '' },
        { ITEMCODE: 'SM.002', SEASON: season, HOLDSTOPREASON: '' },
        { ITEMCODE: 'SM.003', SEASON: season, HOLDSTOPREASON: 'READY' }
      ], _fromCache: true };
      w.processAndLoadData(w.__marketingFixture);
      w.hydrateDatasetLoadState(Object.fromEntries(['master', 'warehouseAssignedItems', 'cavAvBlankKeys'].map(key => [key, { initialLoaded: true, fullLoaded: true }])));
      w.applyRolePermissions();
      w.syncTaskSelectorState();
      const state = w.buildResolvedTaskState();
      document.getElementById('view-login')!.style.display = 'none';
      document.getElementById('app-wrapper')?.classList.remove('hidden');
      w.switchView('tasks');
      w.renderTasks();
      return {
        shared: w.shouldUseSharedTaskQueue('av-blanks'), target: w.getTaskViewTargetUser('av-blanks'),
        rows: state.tabItems.map((r: any) => r.ITEMCODE),
        modes: w.getTaskModeDropdownOptions().map((r: any) => r.value),
        filters: w.getTaskFilterValues('av-blanks'),
        views: [...w.getRoleAccessState().allowedViews],
      };
    }, username);
    expect(result.shared).toBe(true);
    expect(result.target).toBe('');
    expect(result.rows).toEqual(['SM.001']);
    expect(result.modes).toEqual(['av-blanks']);
    expect(result.filters).toEqual(['season']);
    expect(result.views).toEqual(expect.arrayContaining(['drive', 'tasks']));
    expect(result.views).not.toEqual(expect.arrayContaining(['managers']));
    await expect(page.locator('#task-crumb')).toContainText('AV BLANKS');
    await expect(page.locator('#task-crumb')).toContainText('SEASON SALES NOTES');
    await expect(page.getByRole('button', { name: 'Open block A', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Open block A', exact: true }).click();
    await page.getByRole('button', { name: 'Open location A.01', exact: true }).click();
    await expect(page.locator('#task-content')).not.toContainText('Shared Season Plant');
    await page.getByRole('button', { name: 'Open location A.01.001', exact: true }).click();
    await expect(page.locator('#task-content')).toContainText('Shared Season Plant');
    await expect(page.locator('#task-content')).not.toContainText('Held Plant');
    await expect(page.locator('#task-content')).not.toContainText('Already Entered Plant');
    // Leaving and returning must not reinstate a personal-assignee filter.
    const revisited = await page.evaluate(() => {
      const w = window as any;
      w.switchView('drive'); w.switchView('tasks');
      return w.buildResolvedTaskState().tabItems.map((r: any) => r.ITEMCODE);
    });
    expect(revisited).toEqual(['SM.001']);
  });
}

async function settleIosShellVersion(page: import('@playwright/test').Page, projectName: string) {
  if (!projectName.includes('iphone')) return;
  const version = await page.evaluate(() => String((window as any).__APP_SHELL_VERSION__ || ''));
  expect(version).toMatch(/^V\d/);
  await page.goto(`/?shellv=${encodeURIComponent(version)}`, { waitUntil: 'load' });
  await page.locator('#view-login').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.body.classList.contains('role-access-ready')
    && window.eval('hasAppliedInitialHomeView === true'));
}

test('AV loads through app-api with raw reads blocked and shows release GNC.001', async ({ page, baseURL }, testInfo) => {
  const rawReads: string[] = [], datasets = new Set<string>();
  page.on('request', request => {
    if (request.method() === 'GET' && /\/rest\/v1\/(ph_reserves|ph_av_notes|ph_view_av_hot_price_keys)(?:\?|$)/.test(request.url())) rawReads.push(request.url());
    if (request.url().endsWith('/functions/v1/app-api') && request.method() === 'POST') {
      const body = request.postDataJSON();
      if (body?.action === 'av_read') datasets.add(body.dataset);
      // Current production runtime routes the reserves projection through the
      // bounded read boundary; count only that exact dataset, not generic POSTs.
      if (body?.action === 'dataset_read' && body.dataset === 'reserves') datasets.add(body.dataset);
    }
  });
  const reserves = Array.from({ length: 501 }, (_, index) => ({ unique_id: `reserve-${index}`, itemcode: 'SYNTH.003', commonname: 'Secure AV Plant', contsize: '#3', season: 'F1', lotcode: '27.F1', salesrepname: 'Riley Sales', customername: 'Synthetic Customer' }));
  const fixture = await installHlOrderFixture(page, baseURL!, {
    master: [hlMaster('secure-av', { commonname: 'Secure AV Plant', priority: '1' })], reserveRows: reserves,
  });
  await settleIosShellVersion(page, testInfo.project.name);
  await page.route('**/rest/v1/*', route => {
    if (/\/rest\/v1\/(ph_reserves|ph_av_notes|ph_view_av_hot_price_keys)(?:\?|$)/.test(route.request().url())) {
      return route.fulfill({ status: 403, contentType: 'application/json', body: '{"message":"permission denied"}' });
    }
    return route.fallback();
  });
  await page.evaluate(() => (window as any).switchView('av'));
  await expect(page.locator('#av-content')).toContainText('Secure AV Plant');
  await expect(page.locator('#av-content')).not.toContainText('Load Failed');
  await expect.poll(() => page.evaluate(() => window.eval('reservesInventory.length'))).toBe(501);
  expect([...datasets]).toEqual(expect.arrayContaining(['reserves', 'notes', 'hot_prices', 'settings']));
  expect(rawReads).toEqual([]);
  await page.evaluate(() => (window as any).toggleMenu());
  const release = page.locator('#app-release-version');
  await expect(release).toBeVisible();
  await expect(release).toHaveText('GNC.001');
  expect(await release.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('gnc-001-av-menu.png') });
  expect(fixture.blockedMutations).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test('AV cards keep readable priority, stock and actions across themes and widths', async ({ page, baseURL }, testInfo) => {
  const fixture = await installHlOrderFixture(page, baseURL!, { username: 'av_priority_fixture', role: 'ADMIN' });
  await settleIosShellVersion(page, testInfo.project.name);
  // Exercise the compiled renderer with cached rows. The fixture blocks production writes.
  const cases = [
    { sourceView: 'av', tab: 'open', fields: { PRIORITY: '1', AV_RESERVE_ROW_COUNT: 2,
      AV_RESERVE_CUSTOMER_COUNT: 2, AV_RESERVE_CUSTOMER_PREVIEW: 'Northside Nursery',
      AV_RESERVE_CONSIGNEE_PREVIEW: 'Main Store', AV_RESERVE_SALESREP_PREVIEW: 'Riley Sales' }, expected: '1' },
    { sourceView: 'av-photo', tab: 'open', fields: { PRIORITY: '  ', priority: '12', SOURCE: 'HL' }, expected: '12' },
    { sourceView: 'av', tab: 'reserves', fields: { PRIORITY: 0 }, expected: '0' },
    { sourceView: 'av', tab: 'open', fields: { PRIORITY: null }, expected: '—' },
    { sourceView: 'av', tab: 'open', fields: { PRIORITY: '<b>2</b>' }, expected: '<b>2</b>' },
  ];
  await page.evaluate(() => {
    const root = document.createElement('section');
    root.id = 'av-priority-fixture';
    root.style.cssText = 'position:fixed;inset:0;z-index:1000;overflow-y:auto;padding:8px;width:100%;height:100vh;box-sizing:border-box;background:var(--ops-surface,#fff)';
    document.body.prepend(root);
    const homeContent = document.getElementById('home-dynamic-content');
    if (homeContent) {
      const anchor = document.createElement('span');
      anchor.id = 'av-priority-fixture-home-anchor';
      anchor.setAttribute('aria-hidden', 'true');
      anchor.textContent = 'AV card layout fixture active';
      anchor.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;opacity:.01;pointer-events:none';
      homeContent.append(anchor);
      const observer = new MutationObserver(() => {
        if (!homeContent.contains(anchor)) homeContent.append(anchor);
      });
      observer.observe(homeContent, { childList: true });
      (window as any).__avCardHomeAnchorObserver = observer;
    }
  });
  const widths = testInfo.project.name.includes('iphone') ? [360, 390] : [360, 390, 1280];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(compact => document.body.classList.toggle('viewport-compact', compact), width < 900);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => {
        localStorage.setItem('gnc_last_theme_v1', theme);
        (window as any).__gncOpsPilot.primeCachedAppearance({ userKey: 'av_priority_fixture' });
      }, theme);
      await expect(page.locator('body')).toHaveAttribute('data-ops-theme', theme);
      expect(await page.evaluate(() => (window as any).__gncOpsPilot.getState().effectiveTheme)).toBe(theme);
      for (const entry of cases) {
        await page.evaluate(({ sourceView, tab, fields }) => {
          window.eval(`activeAVTab = ${JSON.stringify(tab)}`);
          const row = { UNIQUE_ID: 'av-priority-1', DOM_ID: 'av-priority-1', ITEMCODE: 'SYNTH.001',
            COMMONNAME: 'Priority Fixture Plant with a very long botanical description and cultivar name that must wrap',
            CONTSIZE: '#3', LOCATIONCODE: 'A.01.001', LOTCODE: '27.F1', SEASON: 'F1',
            PTRONHAND: 120, S_LTS: 80, LISTPRICE: '24.50', AV_NOTE: 'Keep near shade',
            SPEC: 'Well branched', HOLDSTOPCODE: 'H', HOLDSTOPREASON: 'Quality review', ...fields };
          document.getElementById('av-priority-fixture')!.innerHTML = (window as any).generateCard(row, sourceView);
        }, entry);
        const card = page.locator('#av-priority-fixture .app-av-catalog-card');
        const priority = card.locator('.app-av-priority-badge');
        await expect(priority).toHaveText(`Priority ${entry.expected}`);
        await expect(card.locator('.app-av-catalog-title-row .app-av-priority-badge')).toHaveCount(1);
        await expect(priority.locator('b')).toHaveCount(0);
        await expect(card.locator('.app-av-catalog-heading')).toContainText('Priority Fixture Plant');
        for (const label of ['Open stock', 'Location on hand', 'List price']) {
          await expect(card.getByText(label, { exact: true })).toBeVisible();
        }
        await expect(card.getByText('Season OH', { exact: true })).toHaveCount(entry.fields.SOURCE === 'HL' ? 1 : 0);
        await expect(card).toContainText('Keep near shade');
        await expect(card).toContainText('Well branched');
        await expect(card).toContainText('Quality review');
        // AV cards no longer reserve room for a summary or an empty AV Note.
        await expect(card.locator('.app-av-catalog-note--reserve')).toHaveCount(0);
        await expect(card.locator('.app-av-catalog-photo-status')).toContainText(/No photo yet|Loading…/);
        const geometry = await card.evaluate((el, theme) => {
          const rect = el.getBoundingClientRect();
          const frame = el.querySelector('.app-av-catalog-frame')!;
          const areas = ['header', 'media', 'details', 'actions'];
          const controls = [...el.querySelectorAll<HTMLElement>('.app-av-primary-action, .app-av-secondary-action')]
            .filter(control => !control.hasAttribute('disabled'));
          const color = (value: string) => (value.match(/[\d.]+/g) || []).map(Number);
          const background = (node: Element) => {
            for (let current: Element | null = node; current; current = current.parentElement) {
              const channels = color(getComputedStyle(current).backgroundColor);
              if (channels.length === 3 || channels[3] === 1) return channels;
            }
            return [255, 255, 255];
          };
          const luminance = (rgb: number[]) => rgb.slice(0, 3).map(channel => {
            const value = channel / 255;
            return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
          }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
          const contrast = (node: Element) => {
            const light = luminance(color(getComputedStyle(node).color));
            const dark = luminance(background(node));
            return (Math.max(light, dark) + .05) / (Math.min(light, dark) + .05);
          };
          const text = (selector: string) => el.querySelector(selector)!;
          const font = (selector: string) => parseFloat(getComputedStyle(text(selector)).fontSize);
          return {
            cardFits: el.scrollWidth <= el.clientWidth + 1 && rect.left >= -1 && rect.right <= innerWidth + 1,
            frameFits: frame.scrollWidth <= frame.clientWidth + 1,
            themeSurface: theme === 'dark' ? luminance(background(el)) < .2 : luminance(background(el)) > .7,
            namedAreas: areas.every(area => getComputedStyle(frame).gridTemplateAreas.includes(area)),
            readable: font('.app-av-catalog-title') >= (innerWidth <= 900 ? 18 : 20)
              && font('.app-av-priority-badge') >= 13
              && font('.app-av-catalog-stock-label') >= 13
              && font('.app-av-catalog-price-label') >= 13
              && font('.app-av-catalog-code') >= 13
              && font('.app-av-catalog-note-text') >= 13
              && font('.app-av-primary-action') >= 14,
            contrast: ['.app-av-catalog-title', '.app-av-priority-badge', '.app-av-catalog-stock-label',
              '.app-av-catalog-code', '.app-av-catalog-note-text'].every(selector => contrast(text(selector)) >= 4.5),
            targets: controls.every(control => {
              const bounds = control.getBoundingClientRect();
              return bounds.width >= 44 && bounds.height >= 44;
            })
          };
        }, theme);
        expect(geometry, `${width}px ${theme} ${entry.sourceView} priority ${entry.expected}`).toEqual({
          cardFits: true, frameFits: true, themeSurface: true, namedAreas: true, readable: true, contrast: true, targets: true
        });
        if (entry === cases[0] && ((width === 1280 && theme === 'light') || (width === 390 && theme === 'dark'))) {
          await card.screenshot({ path: testInfo.outputPath(`av-card-${width}-${theme}.png`) });
        }
      }
    }
  }
  await page.evaluate(() => {
    (window as any).__avCardHomeAnchorObserver?.disconnect();
    document.getElementById('av-priority-fixture-home-anchor')?.remove();
  });
  expect(fixture.errors).toEqual([]);
  expect(fixture.blockedMutations).toEqual([]);
});

test('photo modal reserves its layout before delayed photos load and keeps the selected slide', async ({ page, baseURL }, testInfo) => {
  const fixture = await installHlOrderFixture(page, baseURL!, { username: 'av_photo_fixture', role: 'ADMIN' });
  await settleIosShellVersion(page, testInfo.project.name);
  await page.setViewportSize({ width: 390, height: 844 });
  let releaseImages!: () => void;
  const imagesReady = new Promise<void>(resolve => { releaseImages = resolve; });
  await page.route('https://photos.example.test/modal-late-*.jpg', async route => {
    await imagesReady;
    const portrait = route.request().url().includes('portrait');
    await route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${portrait ? 480 : 640}" height="${portrait ? 640 : 480}"><rect width="100%" height="100%" fill="#387a59"/></svg>` });
  });
  const photos = 'https://photos.example.test/modal-late-portrait.jpg,https://photos.example.test/modal-late-landscape.jpg';
  await page.evaluate(urls => (window as any).openPhotoModal(urls, 'Delayed photos', 0), photos);
  const gallery = page.locator('#photo-modal-gallery');
  const reservedHeight = await gallery.evaluate(el => el.getBoundingClientRect().height);
  const expectedReservedHeight = await page.evaluate(() => {
    const rootStyle = getComputedStyle(document.documentElement);
    const visualHeightToken = rootStyle.getPropertyValue('--visual-height').trim();
    const visualHeight = visualHeightToken.endsWith('px') ? Number.parseFloat(visualHeightToken) : window.innerHeight;
    return Math.min(window.innerHeight * .8, visualHeight - 5 * Number.parseFloat(rootStyle.fontSize));
  });
  try {
    expect(reservedHeight, 'reserve the gallery before either image has dimensions').toBeCloseTo(expectedReservedHeight, 0);
    await expect(page.locator('#photo-modal-counter')).toHaveText('1 / 2');
  } finally {
    releaseImages();
  }
  await gallery.locator('img').evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())));
  const settled = await gallery.evaluate(async el => {
    const positions: number[] = [];
    const started = performance.now();
    // WebKit's spontaneous snap was delayed about 360ms after opening.
    do {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      positions.push(el.scrollLeft);
    } while (performance.now() - started < 500);
    return { height: el.getBoundingClientRect().height, positions };
  });
  expect(settled.height).toBeCloseTo(reservedHeight, 0);
  expect(settled.positions).toEqual(Array(settled.positions.length).fill(0));
  await expect(page.locator('#photo-modal-counter')).toHaveText('1 / 2');
  await page.evaluate(() => (window as any).closePhotoModal());
  await page.evaluate(urls => (window as any).openPhotoModal(urls, 'Delayed photos', 1), photos);
  await expect(page.locator('#photo-modal-counter')).toHaveText('2 / 2');
  await expect.poll(() => gallery.evaluate(el => Math.abs(el.scrollLeft - el.clientWidth))).toBeLessThanOrEqual(1);
  await page.evaluate(() => (window as any).closePhotoModal());
  expect(fixture.errors).toEqual([]);
  expect(fixture.blockedMutations).toEqual([]);
});

test('ordinary compact AV cards stay within the row budget', async ({ page, baseURL }, testInfo) => {
  const fixture = await installHlOrderFixture(page, baseURL!, { username: 'av_compact_fixture', role: 'ADMIN' });
  await settleIosShellVersion(page, testInfo.project.name);
  await page.route('**/storage/v1/object/public/request_photos/**', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"></svg>'
  }));
  await page.route('**/storage/v1/render/image/public/request_photos/**', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"></svg>'
  }));
  await page.evaluate(() => {
    const root = document.createElement('section');
    root.id = 'av-compact-fixture';
    root.style.cssText = 'position:fixed;inset:0;z-index:1000;overflow-y:auto;padding:8px;width:100%;height:100vh;box-sizing:border-box;background:var(--ops-surface,#fff)';
    document.body.prepend(root);
  });
  const widths = testInfo.project.name.includes('iphone') ? [360, 390] : [1280];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(compact => document.body.classList.toggle('viewport-compact', compact), width <= 900);
    for (const hasPhoto of [false, true]) {
      for (const source of ['', 'HL']) {
        await page.evaluate(({ hasPhoto, source }) => {
          window.eval("activeAVTab = 'open'");
          const photoDate = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
          const photoUrl = `https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/v2/${photoDate}/compact.webp`;
          const row = {
            UNIQUE_ID: `av-compact-${hasPhoto}-${source || 'regular'}`,
            DOM_ID: `av-compact-${hasPhoto}-${source || 'regular'}`,
            ITEMCODE: 'SYNTH.003', COMMONNAME: 'Compact Fixture Plant', CONTSIZE: '#1',
            LOCATIONCODE: 'A.01.001', LOTCODE: '27.F1', SEASON: 'F1', PRIORITY: '1',
            PTRONHAND: 12, S_LTS: 8, LISTPRICE: '4.50', SOURCE: source,
            AV_RESERVE_ROW_COUNT: 2,
            ...(hasPhoto ? { PHOTO_NAME: `${photoDate}-compact.webp`, PHOTO_LINK: photoUrl, DATE_COMPLETED: `${photoDate}T12:00:00Z` } : {})
          };
          document.getElementById('av-compact-fixture')!.innerHTML = (window as any).generateCard(row, 'av-photo');
        }, { hasPhoto, source });
        const card = page.locator('#av-compact-fixture .app-av-catalog-card');
        await expect(card.locator('.app-av-catalog-note--reserve')).toHaveCount(0);
        await expect(card.getByText('AV Note', { exact: true })).toHaveCount(0);
        await expect(card.locator('.app-av-photo-slide img')).toHaveCount(hasPhoto ? 1 : 0);
        await expect(card.getByText('Season OH', { exact: true })).toHaveCount(source === 'HL' ? 1 : 0);
        const compact = await card.evaluate((el, width) => {
          const thumbnail = el.querySelector<HTMLElement>('.app-av-catalog-photo-wrap')!;
          const bounds = thumbnail.getBoundingClientRect();
          const cardBounds = el.getBoundingClientRect();
          const frame = el.querySelector<HTMLElement>('.app-av-catalog-frame')!;
          const header = el.querySelector<HTMLElement>('.app-av-catalog-heading')!;
          const details = el.querySelector<HTMLElement>('.app-av-catalog-info')!;
          return {
            height: cardBounds.height,
            thumbnail: { width: bounds.width, height: bounds.height },
            besideHeader: Math.abs(bounds.top - header.getBoundingClientRect().top) <= 2,
            phoneDetailsFullWidth: width > 900 || Math.abs(details.getBoundingClientRect().width - frame.getBoundingClientRect().width) <= 2
          };
        }, width);
        expect(compact.height, `${width}px ${hasPhoto ? 'photo' : 'empty'} ${source || 'standard'} card height`).toBeLessThanOrEqual(width <= 900 ? 300 : 220);
        expect(compact.thumbnail.width).toBeCloseTo(width <= 900 ? 64 : 88, 0);
        expect(compact.thumbnail.height).toBeCloseTo(width <= 900 ? 64 : 88, 0);
        expect(compact.besideHeader).toBe(true);
        expect(compact.phoneDetailsFullWidth).toBe(true);
        if (hasPhoto && width <= 900) {
          const actions = await card.locator('.app-av-catalog-actions > button').evaluateAll(buttons =>
            buttons.map(button => button.getBoundingClientRect().top));
          expect(actions).toHaveLength(2);
          expect(Math.abs(actions[0] - actions[1]), 'phone photo actions share one row').toBeLessThanOrEqual(1);
        }
        await testInfo.attach(`card-${width}-${hasPhoto ? 'photo' : 'empty'}-${source || 'standard'}`, { body: JSON.stringify(compact), contentType: 'application/json' });
        if (!source && (width === 1280 || width === 390)) await card.screenshot({ path: testInfo.outputPath(`compact-${width}-${hasPhoto ? 'photo' : 'empty'}.png`) });
      }
    }
  }
  await page.evaluate(() => {
    window.eval("activeAVTab = 'reserves'");
    const photoDate = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const row = {
      UNIQUE_ID: 'av-reserve-route-1', DOM_ID: 'av-reserve-route-1', ITEMCODE: 'SYNTH.004',
      COMMONNAME: 'Reserve Route Fixture', CONTSIZE: '#1', LOCATIONCODE: 'A.01.001',
      LOTCODE: '27.F1', PTRONHAND: 6, S_LTS: 5, LISTPRICE: '4.50',
      PHOTO_NAME: `${photoDate}-reserve.webp`, DATE_COMPLETED: `${photoDate}T12:00:00Z`,
      PHOTO_LINK: `https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/v2/${photoDate}/reserve.webp`
    };
    document.getElementById('av-compact-fixture')!.innerHTML = (window as any).generateCard(row, 'av');
  });
  const reserveCard = page.locator('#av-compact-fixture .app-av-catalog-card');
  expect(await reserveCard.locator('.app-av-photo-slide').evaluate(el => el.tagName === 'DIV')).toBe(true);
  expect(await reserveCard.evaluate(el => {
    const w = window as any;
    const encodedArgs = el.getAttribute('onclick')?.match(/handleFastPressClick\(event, 'card', 'av', '([^']+)'\)/)?.[1];
    return w.decodeFastPressArgs(encodedArgs || '');
  })).toEqual(['av-reserve-route-1', 'av-reserve-route-1', 'av']);
  expect(fixture.errors).toEqual([]);
  expect(fixture.blockedMutations).toEqual([]);
});

test('AV cached card refreshes priority and preserves photo and picker hooks offline', async ({ page, context, baseURL }, testInfo) => {
  const activate = async (control: import('@playwright/test').Locator) => {
    if (!testInfo.project.name.includes('iphone')) return control.click();
    await expect(control).toBeInViewport();
    const bounds = await control.boundingBox();
    if (!bounds) throw new Error('Expected a visible touch target');
    // Locator auto-scroll can advance WebKit's snap gallery before the tap.
    // Touch the visible control directly, as a phone user does.
    await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  };
  const fixture = await installHlOrderFixture(page, baseURL!, { username: 'av_photo_fixture', role: 'ADMIN' });
  await settleIosShellVersion(page, testInfo.project.name);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.body.classList.add('viewport-compact'));
  let releasePhotos!: () => void;
  const photoGate = new Promise<void>(resolve => { releasePhotos = resolve; });
  const fulfillPhoto = async (route: import('@playwright/test').Route) => {
    await photoGate;
    return route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#387a59"/></svg>'
    });
  };
  await page.route('**/storage/v1/object/public/request_photos/**', fulfillPhoto);
  await page.route('**/storage/v1/render/image/public/request_photos/**', fulfillPhoto);
  const photoDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const setup = await page.evaluate(photoDate => {
    const row = { UNIQUE_ID: 'av-photo-1', DOM_ID: 'av-photo-1', ITEMCODE: 'SYNTH.002',
      COMMONNAME: 'Photo Fixture Plant', CONTSIZE: '#3', LOCATIONCODE: 'A.01.001',
      LOTCODE: '27.F1', SEASON: 'F1', PTRONHAND: 120, S_LTS: 80, LISTPRICE: '24.50',
      PRIORITY: '1', DATE_COMPLETED: `${photoDate}T12:00:00Z`,
      AV_NOTE: 'Photo AV note retained in full', SPEC: 'Photo specification retained in full',
      PICK: 'Photo pick instruction retained in full', HOLDSTOPCODE: 'H', HOLDSTOPREASON: 'Photo hold reason retained in full',
      PHOTO_NAME: `${photoDate}-one.webp,${photoDate}-two.webp`,
      PHOTO_LINK: `https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/v2/${photoDate}/one.webp,https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/v2/${photoDate}/two.webp` };
    const root = document.createElement('section');
    root.id = 'av-photo-fixture';
    root.style.cssText = 'position:fixed;inset:0;z-index:1000;overflow-y:auto;padding:8px;width:100%;height:100vh;box-sizing:border-box;background:var(--ops-surface,#fff)';
    document.body.prepend(root);
    (window as any).__avPhotoFixtureRow = row;
    window.eval('fullInventory.push(window.__avPhotoFixtureRow); invalidateInventoryDomIdLookup()');
    root.innerHTML = (window as any).generateCard(row, 'av-photo');
    const first = window.eval('buildRowsRenderSignature("av:cached", [window.__avPhotoFixtureRow])');
    return { first };
  }, photoDate);
  const card = page.locator('#av-photo-fixture .app-av-catalog-card');
  // The compact card displays its first image only. The modal remains the full gallery.
  await expect(card.locator('.app-av-photo-track .app-av-photo-slide')).toHaveCount(1);
  await expect(card.locator('.app-av-photo-count')).toHaveText('1 / 2');
  await expect(card.locator('.app-av-photo-nav, .app-av-photo-position')).toHaveCount(0);
  await expect(card.locator('.app-av-catalog-photo-loading').first()).toBeVisible();
  await page.evaluate(() => window.eval('scheduleDeferredCardPhotoHydration(document.getElementById("av-photo-fixture"))'));
  releasePhotos();
  await expect(card.locator('.app-av-photo-track img').first()).toHaveAttribute('src', /request_photos/);
  await expect(card.locator('.app-av-photo-track img').first()).toHaveAttribute('data-av-photo-loaded', '1');
  await expect(card.locator('.app-av-catalog-photo-loading').first()).toBeHidden();
  for (const text of ['Photo AV note retained in full', 'Photo specification retained in full',
    'Photo pick instruction retained in full', 'Photo hold reason retained in full']) {
    await expect(card).toContainText(text);
  }
  const photoText = await card.evaluate(el => {
    const date = el.querySelector('.app-av-catalog-photo-evidence .app-inline-thumb-date')!;
    const viewPhotos = el.querySelector('.app-av-secondary-action')!;
    const locationMatch = el.querySelector('.app-av-catalog-photo-match')!;
    const surfaceProbe = document.createElement('span');
    surfaceProbe.style.backgroundColor = 'var(--av-surface)';
    el.append(surfaceProbe);
    const cardSurface = getComputedStyle(surfaceProbe).backgroundColor;
    surfaceProbe.remove();
    return {
      dateReadable: parseFloat(getComputedStyle(date).fontSize) >= 13,
      viewPhotosReadable: parseFloat(getComputedStyle(viewPhotos).fontSize) >= 14,
      dateFollowsLocationMatch: Boolean(locationMatch.compareDocumentPosition(date) & Node.DOCUMENT_POSITION_FOLLOWING),
      dateSurfaceMatchesCard: getComputedStyle(date).backgroundColor === cardSurface
    };
  });
  expect(photoText).toEqual({ dateReadable: true, viewPhotosReadable: true, dateFollowsLocationMatch: true, dateSurfaceMatchesCard: true });
  await card.screenshot({ path: testInfo.outputPath('av-photo-loaded-390.png') });
  if (!testInfo.project.name.includes('iphone')) {
    await page.setViewportSize({ width: 1280, height: 844 });
    await page.evaluate(() => document.body.classList.remove('viewport-compact'));
    await card.screenshot({ path: testInfo.outputPath('av-photo-loaded-1280.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.body.classList.add('viewport-compact'));
  }
  await page.evaluate(() => {
    localStorage.setItem('gnc_last_theme_v1', 'dark');
    (window as any).__gncOpsPilot.primeCachedAppearance({ userKey: 'av_photo_fixture' });
  });
  await expect(page.locator('body')).toHaveAttribute('data-ops-theme', 'dark');
  await expect.poll(() => card.evaluate(el => {
    const date = el.querySelector('.app-av-catalog-photo-evidence .app-inline-thumb-date')!;
    const surfaceProbe = document.createElement('span');
    surfaceProbe.style.backgroundColor = 'var(--av-surface)';
    el.append(surfaceProbe);
    const cardSurface = getComputedStyle(surfaceProbe).backgroundColor;
    surfaceProbe.remove();
    return getComputedStyle(date).backgroundColor === cardSurface
      && parseFloat(getComputedStyle(date).fontSize) >= 13;
  })).toBe(true);
  await card.screenshot({ path: testInfo.outputPath('av-photo-loaded-390-dark.png') });
  await expect(card.locator('.app-av-primary-action')).toHaveAttribute('aria-pressed', 'false');
  await expect(card.locator('.app-av-secondary-action')).toContainText('View Photos');
  await activate(card.locator('.app-av-photo-slide'));
  await expect(page.locator('#photo-modal')).not.toHaveClass(/hidden/);
  await expect(page.locator('#photo-modal-counter')).toContainText('1 / 2');
  await activate(page.locator('#photo-modal-next'));
  await expect(page.locator('#photo-modal-counter')).toContainText('2 / 2');
  await expect.poll(() => page.locator('#photo-modal-gallery').evaluate(el =>
    Math.abs(el.scrollLeft - el.clientWidth))).toBeLessThanOrEqual(1);
  await activate(page.locator('#photo-modal-next'));
  await expect(page.locator('#photo-modal-counter')).toContainText('1 / 2');
  await expect.poll(() => page.locator('#photo-modal-gallery').evaluate(el => el.scrollLeft)).toBe(0);
  await activate(page.locator('#photo-modal-prev'));
  await expect(page.locator('#photo-modal-counter')).toContainText('2 / 2');
  await activate(page.locator('#photo-modal-close'));
  await expect(page.locator('#photo-modal')).toHaveClass(/hidden/);
  await activate(card.locator('.app-av-secondary-action'));
  await expect(page.locator('#photo-modal')).not.toHaveClass(/hidden/);
  await expect(page.locator('#photo-modal-counter')).toContainText('1 / 2');
  await activate(page.locator('#photo-modal-close'));
  await expect(page.locator('#photo-modal')).toHaveClass(/hidden/);
  await context.setOffline(true);
  const changed = await page.evaluate(() => {
    const row = (window as any).__avPhotoFixtureRow;
    row.PRIORITY = '2';
    const signature = window.eval('buildRowsRenderSignature("av:cached", [window.__avPhotoFixtureRow])');
    document.getElementById('av-photo-fixture')!.innerHTML = (window as any).generateCard(row, 'av-photo');
    return signature;
  });
  expect(changed).not.toBe(setup.first);
  await expect(card.locator('.app-av-priority-badge')).toHaveText('Priority 2');
  await activate(card.locator('.app-av-primary-action'));
  expect(await page.evaluate(() => window.eval('selectedItems.has("av-photo-1")'))).toBe(true);
  await page.evaluate(() => {
    document.getElementById('av-photo-fixture')!.innerHTML = (window as any).generateCard((window as any).__avPhotoFixtureRow, 'av-photo');
  });
  await expect(card.locator('.app-av-primary-action')).toHaveAttribute('aria-pressed', 'true');
  await expect(card.locator('.app-av-primary-action')).toContainText('In Bloom Picker');
  await page.evaluate(() => window.eval('selectedItems.delete("av-photo-1")'));
  await context.setOffline(false);
  expect(fixture.errors).toEqual([]);
  expect(fixture.blockedMutations).toEqual([]);
});
