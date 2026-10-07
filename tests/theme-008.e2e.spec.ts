import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark'] as const) {
  test(`Queue and Item Detail respect ${theme} app preference with opposite OS preference`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: theme === 'dark' ? 'light' : 'dark' });
    const html = await (await page.request.get('/index.html')).text();
    await page.goto('/tests/fixtures/ops-precision-browser.html');
    await page.evaluate(({ html, theme }) => {
      const source = new DOMParser().parseFromString(html, 'text/html');
      const opsSheet = document.querySelector('link[href*="ops-precision-pilot.css"]')!;
      // Use production inline selectors as well as its compiled Tailwind sheet.
      for (const style of source.querySelectorAll('style')) document.head.insertBefore(style.cloneNode(true), opsSheet);
      const sheet = document.createElement('link'); sheet.rel = 'stylesheet';
      sheet.href = '/assets/live-tailwind-v2026082010.min.css';
      document.head.insertBefore(sheet, opsSheet);
      document.body.dataset.opsTheme = theme;
      const host = document.querySelector('#view-wrapper')!;
      host.innerHTML = '<section id="view-request"></section><section id="view-detail" class="detail-request-mode"><div id="det-season-content"></div><div id="det-request-content"></div></section>';
      const copy = (id: string, target: string) => {
        const original = source.getElementById(id);
        if (!original) throw new Error('Missing production control: ' + id);
        const node = original.cloneNode(true) as HTMLElement;
        for (const element of [node, ...node.querySelectorAll('*')]) {
          for (const attribute of [...element.attributes]) if (attribute.name.startsWith('on')) element.removeAttribute(attribute.name);
        }
        node.classList.remove('hidden');
        host.querySelector(target)!.appendChild(node);
      };
      copy('request-search', '#view-request');
      copy('detail-overview-drive-fields', '#det-season-content');
      copy('req-spec', '#det-request-content');
      copy('req-av-note-wrap', '#det-request-content');
      copy('req-comments-wrap', '#det-request-content');
      copy('inventory-edit-route-type', '#det-request-content');
      copy('inventory-edit-reason', '#det-request-content');
      (host.querySelector('#req-comments') as HTMLTextAreaElement).disabled = true;
      const nested = document.createElement('div');
      nested.innerHTML = '<div class="request-av-option-full-card is-disabled"><div class="request-av-option-selectbar"><span class="request-av-option-selectbar-main">AV Options</span><span class="request-av-option-selectbar-reason">Unavailable</span></div></div><div class="crop-roll-form-card"><label>Inventory Checks<input id="nested-inventory-check" class="crop-roll-field-control" placeholder="No recorded check" disabled></label><div class="app-empty-state">No checks recorded</div></div>';
      host.querySelector('#det-request-content')!.appendChild(nested);
      const probe = document.createElement('div');
      probe.id = 'dark-variant-probe'; probe.className = source.getElementById('detail-overview-drive-fields')!.className;
      // Remove legacy bg-white mapping to prove the actual compiled dark utility activates.
      probe.classList.remove('bg-white', 'hidden'); probe.textContent = 'Inventory Checks';
      host.querySelector('#det-request-content')!.appendChild(probe);
      host.querySelectorAll<HTMLElement>('#view-request,#view-detail,#det-request-content,#det-season-content').forEach(node => { node.style.display = 'block'; });
    }, { html, theme });
    await page.locator('#req-spec').focus();
    await expect.poll(() => page.locator('#req-spec').evaluate(node => getComputedStyle(node).backgroundColor))
      .toBe(theme === 'dark' ? 'rgb(10, 18, 14)' : 'rgb(255, 255, 255)');
    for (const selector of ['#request-search', '#req-av-note', '#req-comments', '#detail-overview-drive-fields', '#inventory-edit-route-type', '#inventory-edit-reason']) {
      const colors = await page.locator(selector).evaluate(node => {
        const style = getComputedStyle(node);
        return { background: style.backgroundColor, text: style.color };
      });
      expect(colors.background).not.toBe('rgba(0, 0, 0, 0)');
      expect(colors.background).not.toBe(colors.text);
      if (theme === 'dark') expect(colors.background).not.toBe('rgb(255, 255, 255)');
    }
    await expect(page.locator('#nested-inventory-check')).toBeDisabled();
    for (const selector of ['.request-av-option-full-card', '.request-av-option-selectbar', '#nested-inventory-check']) {
      const color = await page.locator(selector).evaluate(node => getComputedStyle(node).backgroundColor);
      expect(color).not.toBe('rgba(0, 0, 0, 0)');
      if (theme === 'dark') expect(color).not.toMatch(/rgb\((?:255, 255, 255|248, 250, 252|236, 253, 245)\)/);
    }
    if (theme === 'dark') {
      // This independent probe has no legacy bg-white override or ID-specific surface rule.
      await page.locator('#dark-variant-probe').evaluate(node => document.querySelector('#view-request')!.appendChild(node));
      await expect.poll(() => page.locator('#dark-variant-probe').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(10, 18, 14)');
    }
    const screenshotPath = testInfo.outputPath(`queue-detail-${theme}.png`);
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach(`queue-detail-${theme}`, { path: screenshotPath, contentType: 'image/png' });
  });
}

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
