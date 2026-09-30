import { expect, test } from '@playwright/test';

for (const width of [320, 390, 430]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`.011 ${theme} materials stay usable at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 760 });
      await page.goto('/tests/fixtures/ops-precision-browser.html');
      await page.evaluate(activeTheme => {
        document.body.dataset.opsTheme = activeTheme;
        document.body.classList.add('current-view-grower');
        const content = document.querySelector('#view-wrapper');
        if (content) content.innerHTML = `
          <div class="mobile-browse-rail">
            <input aria-label="Search plants" placeholder="Search plants" style="width:100%;min-width:0;font-size:16px">
            <details class="mobile-browse-filters">
              <summary>Filters</summary>
              <div class="mobile-browse-filter-panel"><button type="button">LowStock</button><button type="button">NotInF1</button></div>
            </details>
          </div>
          <article class="grower-inventory-item" style="margin-top:12px">
            <button class="grower-item-toggle" type="button"><span class="grower-item-photo-placeholder" aria-hidden="true">◈</span><span><strong>Accolade® Elm</strong><small>Item 003955.030.1</small></span><span class="grower-quantity-total">AVAILABLE 98<br>ON HAND 121</span></button>
            <div class="grower-location-total"><span>A.07 · Lot 27.F1</span><span>Avail 52 · OH 68</span></div>
            <div class="grower-row-details"><label>Sev (0–50)<input data-grower-draft-field="sev" type="number" inputmode="numeric" value="7"></label></div>
          </article>`;
      }, theme);

      const state = await page.evaluate(() => {
        const body = document.body;
        const toolbar = document.querySelector('.mobile-browse-rail')!;
        const search = toolbar.querySelector('input')!;
        const filter = toolbar.querySelector('summary')!;
        const card = document.querySelector('.grower-inventory-item')!;
        const sev = card.querySelector('input')!;
        const nav = document.querySelector('#bottom-nav')!;
        const canvas = getComputedStyle(body);
        const toolbarStyle = getComputedStyle(toolbar);
        const cardStyle = getComputedStyle(card);
        const searchRect = search.getBoundingClientRect();
        const filterRect = filter.getBoundingClientRect();
        return {
          canvas: canvas.getPropertyValue('--ops-canvas').trim(),
          surface: canvas.getPropertyValue('--ops-surface').trim(),
          accent: canvas.getPropertyValue('--ops-brand').trim(),
          border: canvas.getPropertyValue('--ops-border').trim(),
          gradient: cardStyle.backgroundImage,
          blur: toolbarStyle.backdropFilter || toolbarStyle.getPropertyValue('-webkit-backdrop-filter'),
          numericFont: getComputedStyle(sev).fontFamily,
          numericVariant: getComputedStyle(sev).fontVariantNumeric,
          navBackground: getComputedStyle(nav).backgroundColor,
          navBorderTop: getComputedStyle(nav).borderTopColor,
          activeGlow: getComputedStyle(nav.querySelector('.footer-nav-btn.active')!).boxShadow,
          sameToolbarRow: Math.abs(searchRect.top - filterRect.top) < 2,
          controlsTallEnough: [search, filter, ...nav.querySelectorAll('button')].every(node => node.getBoundingClientRect().height >= 44),
          overflow: document.documentElement.scrollWidth - innerWidth,
        };
      });

      expect(state.canvas).toBe(theme === 'dark' ? '#050806' : '#f4fbf7');
      expect(state.surface).toBe(theme === 'dark' ? '#0a120e' : '#ffffff');
      expect(state.accent).toBe(theme === 'dark' ? '#22c55e' : '#15803d');
      expect(state.border).toBe(theme === 'dark' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(22, 101, 52, 0.12)');
      expect(state.gradient).toContain('linear-gradient');
      expect(state.blur).toContain('blur(16px)');
      expect(state.numericFont).toContain('monospace');
      expect(state.numericVariant).toContain('tabular-nums');
      if (theme === 'dark') {
        expect(state.navBackground).toBe('rgb(10, 18, 14)');
        expect(state.navBorderTop).toBe('rgba(34, 197, 94, 0.15)');
        expect(state.activeGlow).toContain('rgba(34, 197, 94, 0.35)');
      }
      expect(state.sameToolbarRow).toBe(true);
      expect(state.controlsTallEnough).toBe(true);
      expect(state.overflow).toBeLessThanOrEqual(1);

      const screenshotPath = testInfo.outputPath(`theme-${theme}-${width}.png`);
      await page.screenshot({ path: screenshotPath });
      await testInfo.attach(`theme-${theme}-${width}.png`, { path: screenshotPath, contentType: 'image/png' });
      await page.locator('.mobile-browse-filters > summary').click();
      await expect(page.getByRole('button', { name: 'LowStock' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Drive' })).toBeVisible();
    });
  }
}

test('.011 retains outdoor colors and suppresses motion when requested', async ({ page }) => {
  await page.goto('/tests/fixtures/ops-precision-browser.html');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    document.documentElement.classList.add('outdoor-mode');
    document.body.dataset.opsTheme = 'light';
  });
  const state = await page.evaluate(() => ({
    canvas: getComputedStyle(document.body).getPropertyValue('--ops-canvas').trim(),
    duration: getComputedStyle(document.querySelector('.footer-nav-btn')!).transitionDuration,
  }));
  expect(state.canvas).toBe('#eff9f3');
  expect(parseFloat(state.duration)).toBeLessThanOrEqual(0.001);
});

test('.011 dark navigation uses the surface token and drops blur during constrained scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto('/tests/fixtures/ops-precision-browser.html');
  await page.evaluate(() => {
    document.body.dataset.opsTheme = 'dark';
    document.body.classList.add('performance-scroll-active');
  });
  const state = await page.evaluate(() => {
    const nav = document.querySelector('#bottom-nav')!;
    const rail = document.querySelector('.mobile-browse-rail');
    return {
      nav: getComputedStyle(nav).backgroundColor,
      navBlur: getComputedStyle(nav).backdropFilter,
      railBlur: rail ? getComputedStyle(rail).backdropFilter : 'none',
    };
  });
  expect(state.nav).toBe('rgb(10, 18, 14)');
  expect(state.navBlur).toBe('none');
  expect(state.railBlur).toBe('none');
});
