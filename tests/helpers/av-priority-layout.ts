import { expect, type Page, type Locator, type TestInfo } from '@playwright/test';

const cases = [
    { sourceView: 'av', tab: 'open', fields: { PRIORITY: '1', AV_RESERVE_ROW_COUNT: 2,
      AV_RESERVE_CUSTOMER_COUNT: 2, AV_RESERVE_CUSTOMER_PREVIEW: 'Northside Nursery',
      AV_RESERVE_CONSIGNEE_PREVIEW: 'Main Store', AV_RESERVE_SALESREP_PREVIEW: 'Riley Sales' }, expected: '1' },
    { sourceView: 'av-photo', tab: 'open', fields: { PRIORITY: '  ', priority: '12', SOURCE: 'HL' }, expected: '12' },
    { sourceView: 'av', tab: 'reserves', fields: { PRIORITY: 0 }, expected: '0' },
    { sourceView: 'av', tab: 'open', fields: { PRIORITY: null }, expected: '—' },
    { sourceView: 'av', tab: 'open', fields: { PRIORITY: '<b>2</b>' }, expected: '<b>2</b>' },
  ];

function mountPriorityCardHost() {
  const root = document.createElement('section');
  root.id = 'av-priority-fixture';
  root.style.cssText = 'position:fixed;inset:0;z-index:1000;overflow-y:auto;padding:8px;width:100%;height:100vh;box-sizing:border-box;background:var(--ops-surface,#fff)';
  document.body.prepend(root);
  const homeContent = document.getElementById('home-dynamic-content');
  if (!homeContent) return;
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

async function renderPriorityCard(page: Page, entry: typeof cases[number]) {
  await page.evaluate(({ sourceView, tab, fields }) => {
    window.eval(`activeAVTab = ${JSON.stringify(tab)}`);
    const row = { UNIQUE_ID: 'av-priority-1', DOM_ID: 'av-priority-1', ITEMCODE: 'SYNTH.001',
      COMMONNAME: 'Priority Fixture Plant with a very long botanical description and cultivar name that must wrap',
      CONTSIZE: '#3', LOCATIONCODE: 'A.01.001', LOTCODE: '27.F1', SEASON: 'F1',
      PTRONHAND: 120, S_LTS: 80, LISTPRICE: '24.50', SOURCE: 'PH', AV_NOTE: 'Keep near shade',
      SPEC: 'Well branched', HOLDSTOPCODE: 'H', HOLDSTOPREASON: 'Quality review', ...fields };
    document.getElementById('av-priority-fixture')!.innerHTML = (window as any).generateCard(row, sourceView);
  }, entry);
}

async function assertPriorityContent(card: Locator, entry: typeof cases[number]) {
  const priority = card.locator('.app-av-priority-badge');
  await expect(priority).toHaveText(`PRI ${entry.expected}`);
  await expect(card.locator('.app-av-catalog-meta .app-av-priority-badge')).toHaveCount(1);
  await expect(priority.locator('b')).toHaveCount(0);
  await expect(card.locator('.app-av-catalog-heading')).toContainText('Priority Fixture Plant');
  for (const label of ['Open Stock', 'Loc On Hand', 'List price']) {
    await expect(card.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(card.getByText('Season OH', { exact: true })).toHaveCount(entry.fields.SOURCE === 'HL' ? 1 : 0);
  await expect(card).toContainText('Keep near shade');
  await expect(card).toContainText('Well branched');
  await expect(card).toContainText('Quality review');
  // AV cards no longer reserve room for a summary or an empty AV Note.
  await expect(card.locator('.app-av-catalog-note--reserve')).toHaveCount(0);
  await expect(card.locator('.app-av-catalog-photo-status')).toContainText(/No photo yet|Loading…/);
}

function readPriorityCardGeometry(el: Element) {
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
    themeSurface: luminance(background(el)) < .2,
    namedAreas: areas.every(area => getComputedStyle(frame).gridTemplateAreas.includes(area)),
    bloomActions: el.querySelectorAll('.app-av-catalog-actions .app-av-primary-action[data-cart-dom-id]').length,
    readable: font('.app-av-catalog-title') >= (innerWidth <= 900 ? 18 : 20)
      && font('.app-av-priority-badge') >= 13
      && font('.app-card-qty-label') >= 13
      && font('.app-av-catalog-price-label') >= 13
      && font('.app-av-catalog-code') >= 13
      && font('.app-av-catalog-note-text') >= 13
      && font('.app-av-primary-action') >= 14,
    contrast: ['.app-av-catalog-title', '.app-av-priority-badge', '.app-card-qty-label',
      '.app-av-catalog-code', '.app-av-catalog-note-text'].every(selector => contrast(text(selector)) >= 4.5),
    targets: controls.every(control => {
      const bounds = control.getBoundingClientRect();
      return bounds.width >= 44 && bounds.height >= 44;
    })
  };
}

async function verifyPriorityCard(page: Page, entry: typeof cases[number], width: number, theme: string) {
  await renderPriorityCard(page, entry);
  const card = page.locator('#av-priority-fixture .app-av-catalog-card');
  await assertPriorityContent(card, entry);
  const geometry = await card.evaluate(readPriorityCardGeometry);
  expect(geometry, `${width}px ${theme} ${entry.sourceView} priority ${entry.expected}`).toEqual({
    cardFits: true, frameFits: true, themeSurface: true, namedAreas: true, bloomActions: 1,
    readable: true, contrast: true, targets: true
  });
  return card;
}

export async function verifyAvPriorityLayouts(page: Page, testInfo: TestInfo) {
  await page.evaluate(mountPriorityCardHost);
  const widths = testInfo.project.name.includes('iphone') ? [360, 390] : [360, 390, 1280];
  for (const width of widths) await verifyPriorityWidth(page, testInfo, width);
}

async function verifyPriorityWidth(page: Page, testInfo: TestInfo, width: number) {
  await page.setViewportSize({ width, height: 844 });
  await page.evaluate(compact => document.body.classList.toggle('viewport-compact', compact), width < 900);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(savedTheme => {
      localStorage.setItem('gnc_last_theme_v1', savedTheme);
      (window as any).__gncOpsPilot.primeCachedAppearance({ userKey: 'av_priority_fixture' });
    }, theme);
    await expect(page.locator('body')).toHaveAttribute('data-ops-theme', 'dark');
    expect(await page.evaluate(() => (window as any).__gncOpsPilot.getState().effectiveTheme)).toBe('dark');
    for (const entry of cases) {
      const card = await verifyPriorityCard(page, entry, width, theme);
      if (entry === cases[0] && ((width === 1280 && theme === 'light') || (width === 390 && theme === 'dark'))) {
        await card.screenshot({ path: testInfo.outputPath('av-card-' + width + '-' + theme + '.png') });
      }
    }
  }
}
