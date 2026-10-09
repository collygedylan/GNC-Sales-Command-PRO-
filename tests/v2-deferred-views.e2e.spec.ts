// @test-group: @release-timing
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { installPerformanceFixture, openPerformanceView, returnPerformanceHome } from '../scripts/performance-browser-fixture.mjs';

type ViteManifest = Record<string, { file: string; isDynamicEntry?: boolean }>;
const siteRoot = path.resolve(process.env.GNC_LOCAL_SITE_DIR || '_site');

function dynamicChunk(manifest: ViteManifest, source: string) {
  const entry = manifest[source];
  if (!entry?.isDynamicEntry || !entry.file) throw new Error(`PHASE6_DYNAMIC_CHUNK_MISSING:${source}`);
  return entry.file;
}

let requestChunk: string;
let driveChunk: string;

// Playwright imports every spec before applying suite tags. Only executing this
// compiled suite requires its artifact; unrelated database collection does not.
test.beforeAll(async () => {
  const manifest = JSON.parse(await readFile(path.join(siteRoot, 'v2', '.vite', 'manifest.json'), 'utf8')) as ViteManifest;
  requestChunk = dynamicChunk(manifest, 'src/pages/RequestQueue.tsx');
  driveChunk = dynamicChunk(manifest, 'src/components/DriveInventory.tsx');
});

async function installStaticApp(page: import('@playwright/test').Page, origin: string) {
  await installPerformanceFixture(page, origin, 'v2');
}

test('compiled Que and Drive chunks load only on route entry and keep their established state lifetimes', { tag: ['@release-timing'] }, async ({ page, baseURL }) => {
  const scriptRequests = new Set<string>();
  page.on('request', request => {
    if (request.resourceType() === 'script') scriptRequests.add(new URL(request.url()).pathname);
  });
  await installStaticApp(page, String(baseURL));
  expect(scriptRequests.has(`/v2/${requestChunk}`)).toBe(false);
  expect(scriptRequests.has(`/v2/${driveChunk}`)).toBe(false);

  await openPerformanceView(page, 'v2', 'request');
  await expect.poll(() => scriptRequests.has(`/v2/${requestChunk}`)).toBe(true);
  await page.locator('.filter-select select').selectOption('sales');
  await returnPerformanceHome(page, 'v2');
  await openPerformanceView(page, 'v2', 'drive');
  await expect.poll(() => scriptRequests.has(`/v2/${driveChunk}`)).toBe(true);

  const search = page.getByRole('textbox', { name: 'Search inventory' });
  await search.fill('Performance plant 001');
  await expect(search).toHaveValue('Performance plant 001');
  await returnPerformanceHome(page, 'v2');
  await openPerformanceView(page, 'v2', 'drive');
  await expect(page.getByRole('textbox', { name: 'Search inventory' })).toHaveValue('');
  await returnPerformanceHome(page, 'v2');
  await openPerformanceView(page, 'v2', 'request');
  await expect(page.locator('.filter-select select')).toHaveValue('sales');
});

test('a failed Queue chunk can recover by reloading the same route', { tag: ['@release-timing'] }, async ({ page, baseURL }) => {
  await installStaticApp(page, String(baseURL));
  let failOnce = true;
  await page.route(`**/${requestChunk}`, async route => {
    if (failOnce) {
      failOnce = false;
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  await page.evaluate(() => { window.location.hash = 'request'; });
  await expect(page.getByRole('alert')).toContainText('Que could not be loaded');
  await page.getByRole('button', { name: 'Reload app to retry' }).click();
  await expect(page.locator('.request-card').first()).toBeVisible();
  expect(new URL(page.url()).hash).toBe('#request');
});

test('a failed Que boundary does not poison the separately keyed Drive route', { tag: ['@release-timing'] }, async ({ page, baseURL }) => {
  await installStaticApp(page, String(baseURL));
  await page.route(`**/${requestChunk}`, route => route.abort('failed'));

  await page.evaluate(() => { window.location.hash = 'request'; });
  await expect(page.getByRole('alert')).toContainText('Que could not be loaded');
  await page.evaluate(() => { window.location.hash = 'drive'; });
  await expect(page.locator('.drive-item-card').first()).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Que stays within phone and tablet geometry across themes and shell updates', { tag: ['@release-timing'] }, async ({ page, baseURL }, testInfo) => {
  await installStaticApp(page, String(baseURL));
  await openPerformanceView(page, 'v2', 'request');
  await expect(page.locator('.request-card').first()).toBeVisible();
  await page.evaluate(() => {
    (window as Window & { __phase6QueueList?: Element | null }).__phase6QueueList = document.querySelector('.request-list');
  });

  const cases = [
    { id: 'phone-light', width: 390, height: 844, theme: 'Light' },
    { id: 'phone-dark', width: 390, height: 844, theme: 'Dark' },
    { id: 'tablet-light', width: 820, height: 1180, theme: 'Light' },
    { id: 'tablet-dark', width: 820, height: 1180, theme: 'Dark' }
  ];
  for (const item of cases) {
    await page.setViewportSize({ width: item.width, height: item.height });
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('button', { name: item.theme }).click();
    await page.getByRole('button', { name: 'Close menu' }).click();

    const scrolled = await page.locator('main.main-scroll').evaluate(node => {
      node.scrollTop = Math.min(500, node.scrollHeight - node.clientHeight);
      node.dispatchEvent(new Event('scroll', { bubbles: true }));
      return { top: node.scrollTop, classAdded: document.querySelector('.app-shell')?.classList.contains('is-scrolling') };
    });
    expect(scrolled.top).toBeGreaterThan(0);
    expect(scrolled.classAdded).toBe(true);
    const geometry = await page.evaluate(expectedTheme => {
      const root = document.querySelector<HTMLElement>('.app-shell')!;
      const main = document.querySelector<HTMLElement>('main.main-scroll')!;
      const card = document.querySelector<HTMLElement>('.request-card')!;
      const rect = card.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        mainWidth: main.clientWidth,
        cardLeft: rect.left,
        cardRight: rect.right,
        rootTheme: root.classList.contains(`theme-${expectedTheme}`),
        sameList: (window as Window & { __phase6QueueList?: Element | null }).__phase6QueueList === document.querySelector('.request-list')
      };
    }, item.theme.toLowerCase());
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.cardLeft).toBeGreaterThanOrEqual(-1);
    expect(geometry.cardRight).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.rootTheme).toBe(true);
    expect(geometry.sameList).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`phase6-que-${item.id}.png`) });
    await page.locator('main.main-scroll').evaluate(node => { node.scrollTop = 0; node.dispatchEvent(new Event('scroll', { bubbles: true })); });
  }
});
