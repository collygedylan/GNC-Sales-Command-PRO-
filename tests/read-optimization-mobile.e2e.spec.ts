import { expect, test } from '@playwright/test';
import fs from 'node:fs';

const shell = fs.readFileSync('index.html', 'utf8');
const start = shell.indexOf('const CLIENT_BROWSE_PAGE_SIZE = 100;');
const end = shell.indexOf('function renderDriveRecordResults', start);
if (start < 0 || end < start) throw new Error('Browse paging helpers not found');
const paging = shell.slice(start, end);

test('AV, Drive and Que paging remains bounded and usable at mobile widths', async ({ page }, testInfo) => {
  await page.setContent('<body><main id="results"></main></body>');
  await page.addStyleTag({ path: 'assets/live-tailwind-v2026082010.min.css' });
  await page.addStyleTag({ content: 'body { margin:0; padding:8px; --bg-surface:#0a120e; --text-main:#f0fdf4; --text-meta:#c7d9ce; --color-border-subtle:#316e4b; } .fixture-row { padding:8px; overflow-wrap:anywhere; }' });
  await page.addScriptTag({ content: `
    let fixtureIdentity = 'reader-a';
    let fixtureView = 'av';
    const fixtureRows = Array.from({length: 240}, (_, index) => ({ UNIQUE_ID: 'row-' + (index + 1) }));
    const getSupabaseReadIdentityScope = () => fixtureIdentity;
    const buildRowsRenderSignature = (key, rows) => key + ':' + rows.map(row => row.UNIQUE_ID).join('|');
    const buildFastInvokeAttrs = (name, args, label) => 'aria-label="' + label + '" data-direction="' + args[2] + '"';
    let renderedPage;
    const scheduleAVRender = () => renderFixture();
    const scheduleDriveFilterRender = () => renderFixture();
    const scheduleRequestRender = () => renderFixture();
    ${paging}
    function renderFixture() {
      renderedPage = getClientBrowsePage(fixtureView, 'unchanged-source', fixtureRows);
      document.getElementById('results').innerHTML = renderedPage.rows.map(row => '<article class="fixture-row">' + row.UNIQUE_ID + '</article>').join('')
        + renderClientBrowsePageFooter(fixtureView, renderedPage.key, fixtureRows.length, renderedPage);
    }
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-direction]');
      if (button && !button.disabled) loadMoreClientBrowseRows(fixtureView, renderedPage.key, Number(button.dataset.direction));
    });
    window.startFixture = view => { fixtureView = view; renderFixture(); };
    window.changeIdentity = () => { fixtureIdentity = 'reader-b'; renderFixture(); };
    window.fixtureCacheSize = () => clientBrowsePageCounts.size;
  ` });
  const timings: Record<string, number> = {};
  for (const view of ['av', 'drive', 'request']) {
    timings[view] = await page.evaluate(view => {
      const started = performance.now(); (window as any).startFixture(view); return performance.now() - started;
    }, view);
    await expect(page.locator('.fixture-row')).toHaveCount(100);
    await expect(page.locator('.fixture-row').first()).toHaveText('row-1');
    await expect(page.getByRole('button', { name: 'Previous 100 rows' })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    for (const button of await page.locator('.browse-page-footer button').all()) {
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole('button', { name: 'Next 100 rows' }).click();
    await expect(page.locator('.fixture-row')).toHaveCount(100);
    await expect(page.locator('.fixture-row').first()).toHaveText('row-101');
    await page.getByRole('button', { name: 'Next 100 rows' }).click();
    await expect(page.locator('.fixture-row')).toHaveCount(40);
    await expect(page.getByRole('button', { name: 'Next 100 rows' })).toBeDisabled();
    await page.getByRole('button', { name: 'Previous 100 rows' }).click();
    await expect(page.locator('.fixture-row').first()).toHaveText('row-101');
  }
  await page.evaluate(() => (window as any).changeIdentity());
  await expect(page.locator('.fixture-row').first()).toHaveText('row-1');
  await testInfo.attach('synthetic-paging-render-ms', { body: JSON.stringify(timings), contentType: 'application/json' });
});
