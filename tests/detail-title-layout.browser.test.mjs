import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const assetRoot = path.resolve(repositoryRoot, process.env.GNC_BROWSER_ASSET_ROOT || '_site');
const shellPath = path.join(assetRoot, 'index.html');
const screenshotRoot = path.join(repositoryRoot, 'test-results', 'detail-title-layout');
if (!fs.existsSync(shellPath)) {
  throw new Error(`Compiled shell is missing under ${assetRoot}; set GNC_BROWSER_ASSET_ROOT to the sealed release root.`);
}

function productionStyles() {
  const source = fs.readFileSync(shellPath, 'utf8');
  const tokens = source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>|<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*>/gi);
  const styles = [];
  for (const [tag] of tokens) {
    if (/^<style\b/i.test(tag)) {
      styles.push(tag.replace(/^<style\b[^>]*>/i, '').replace(/<\/style\s*>$/i, ''));
      continue;
    }
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (!href || /^(?:[a-z]+:|\/\/|data:)/i.test(href)) continue;
    const localPath = path.resolve(assetRoot, decodeURIComponent(href.split(/[?#]/, 1)[0]));
    if (!localPath.startsWith(`${assetRoot}${path.sep}`)) continue;
    if (fs.existsSync(localPath)) styles.push(fs.readFileSync(localPath, 'utf8'));
  }
  assert.ok(styles.length, 'compiled shell should provide its production styles');
  return styles.map(css => `<style>${css}</style>`).join('\n');
}

const styles = productionStyles();

function detailMarkup(theme) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">${styles}<style>html,body{margin:0}#main-scroll-area.layout-test-shell{height:100vh!important;max-height:100vh!important;overflow-y:scroll!important}#layout-scroll-content{display:block!important;height:120vh!important;min-height:120vh!important}</style></head>
    <body class="ops-precision-pilot ag-premium-skin premium-skin-v16" data-ops-theme="${theme}">
      <div id="main-scroll-area" class="layout-test-shell" style="height:600px!important;max-height:600px!important;overflow-y:scroll!important"><main id="view-detail">
          <div class="freeze-panel">
            <nav id="det-tabs-container" class="detail-tabs amazon-filter-strip" aria-label="Item detail views">
              <button class="detail-tab active">Item Details</button><button class="detail-tab">Reserves</button>
              <button class="detail-tab">Open Orders</button><button class="detail-tab">Season</button>
              <button class="detail-tab">Location History</button><button class="detail-tab">Notes and Actions</button>
            </nav>
            <div class="mb-4">
              <div id="det-title-row">
                <h1 id="det-common">Karl Foerster Feather Reed Grass Cultivar — Super Tall Purple Flowering Border Plant</h1>
                <p id="det-size">#5 Container</p>
                <p id="det-location">North Greenhouse Block 56 Row 1202 West Bench</p>
              </div>
              <div id="det-extra-info"></div>
              <div id="det-request-desired-panel"></div>
              <div id="task-detail-camera-quick"></div>
            </div>
          </div>
          <section id="det-request-content"></section>
          <div id="layout-scroll-content" aria-hidden="true"></div>
        </main></div>
    </body></html>`;
}

test('compiled Item Detail tabs and long plant identity remain separated at phone and desktop text scales', async t => {
  fs.mkdirSync(screenshotRoot, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort('blockedbyclient'));

  for (const viewport of [{ width: 390, height: 844 }, { width: 1366, height: 768 }]) {
    for (const theme of ['light', 'dark']) {
      for (const textScale of [1, 2]) {
        await page.setViewportSize(viewport);
        await page.setContent(detailMarkup(theme));
        await page.evaluate(scale => { document.documentElement.style.fontSize = `${16 * scale}px`; }, textScale);

        for (const mode of ['standard', 'request']) {
          await page.locator('#view-detail').evaluate((detail, selectedMode) => {
            detail.classList.toggle('detail-request-mode', selectedMode === 'request');
            const request = detail.querySelector('#det-request-content');
            request.classList.toggle('hidden', selectedMode !== 'request');
          }, mode);
          const layout = await page.evaluate(() => {
            const rect = selector => {
              const box = document.querySelector(selector).getBoundingClientRect();
              return { top: box.top, right: box.right, bottom: box.bottom, left: box.left, width: box.width, height: box.height };
            };
            const tabs = document.querySelector('#det-tabs-container');
            const title = document.querySelector('#det-title-row');
            const common = document.querySelector('#det-common');
            const location = document.querySelector('#det-location');
            const style = getComputedStyle(common);
            return {
              tabs: rect('#det-tabs-container'),
              title: rect('#det-title-row'),
              common: rect('#det-common'),
              location: rect('#det-location'),
              commonLineHeight: Number.parseFloat(style.lineHeight),
              titleScrollWidth: title.scrollWidth,
              titleClientWidth: title.clientWidth,
              tabsScrollWidth: tabs.scrollWidth,
              tabsClientWidth: tabs.clientWidth,
              pageScrollWidth: document.documentElement.scrollWidth,
              pageClientWidth: document.documentElement.clientWidth,
              titlePosition: getComputedStyle(title).position,
              titleZIndex: getComputedStyle(title).zIndex,
            };
          });
          const screenshot = await page.screenshot({ animations: 'disabled' });
          assert.equal(screenshot.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
          await fs.promises.writeFile(path.join(screenshotRoot, `${viewport.width}-${theme}-${textScale}-${mode}.png`), screenshot);

          assert.ok(layout.title.top >= layout.tabs.bottom + 7.9, `${mode}: title should clear tab rail by at least 8px: ${JSON.stringify(layout)}`);
          assert.ok(layout.title.left >= -1 && layout.title.right <= viewport.width + 1, `${mode}: title should fit viewport: ${JSON.stringify(layout)}`);
          assert.ok(layout.titleScrollWidth <= layout.titleClientWidth + 1, `${mode}: title row should not overflow: ${JSON.stringify(layout)}`);
          assert.ok(layout.pageScrollWidth <= layout.pageClientWidth + 1, `${mode}: document should not overflow horizontally: ${JSON.stringify(layout)}`);
          assert.ok(layout.tabsScrollWidth >= layout.tabsClientWidth, `${mode}: tab row should preserve its horizontal scroller`);
          if (viewport.width < 640) {
            assert.ok(layout.common.height >= layout.commonLineHeight * 1.8, `${mode}: long plant name should wrap naturally: ${JSON.stringify(layout)}`);
          }
          assert.ok(layout.location.height > 0, `${mode}: location should remain visible`);
          assert.equal(layout.titleZIndex, 'auto', `${mode}: title should not overlay adjacent navigation`);

          await page.evaluate(() => { document.querySelector('#main-scroll-area').scrollTop = 120; });
          const scrolled = await page.evaluate(() => {
            const scrollArea = document.querySelector('#main-scroll-area');
            const bounds = selector => {
              const box = document.querySelector(selector).getBoundingClientRect();
              return { top: box.top, bottom: box.bottom };
            };
            return { scrollTop: scrollArea.scrollTop, clientHeight: scrollArea.clientHeight, scrollHeight: scrollArea.scrollHeight, spacer: bounds('#layout-scroll-content'), tabs: bounds('#det-tabs-container'), title: bounds('#det-title-row') };
          });
          assert.ok(scrolled.scrollTop > 0, `${mode}: fixture should scroll its main content container: ${JSON.stringify(scrolled)}`);
          assert.ok(scrolled.title.top >= scrolled.tabs.bottom + 7.9, `${mode}: title should remain below tabs while scrolling: ${JSON.stringify(scrolled)}`);
          await page.evaluate(() => { document.querySelector('#main-scroll-area').scrollTop = 0; });
        }
      }
    }
  }
});
