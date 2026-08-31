import { expect, test } from '@playwright/test';

test('main scrolling avoids forced layout reads and universal style invalidation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=scroll-performance', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).getCurrentVisibleViewId === 'function');

  const result = await page.evaluate(() => window.eval(`(async () => {
    const performanceStyles = document.getElementById('app-performance-guardrails')?.textContent || '';
    const main = document.getElementById('main-scroll-area');
    const driveView = document.getElementById('view-drive');
    if (!main || !driveView) throw new Error('Required scrolling fixture is unavailable.');

    currentPrimaryViewId = 'drive';
    driveView.classList.remove('hidden');
    let rail = driveView.querySelector('.drive-controls-sticky');
    if (!rail) {
      rail = document.createElement('div');
      rail.className = 'drive-controls-sticky';
      driveView.prepend(rail);
    }
    const spacer = document.createElement('div');
    spacer.dataset.scrollPerformanceFixture = 'true';
    spacer.style.height = '5000px';
    driveView.appendChild(spacer);
    main.style.height = '420px';
    main.style.overflowY = 'auto';

    await new Promise((resolve) => setTimeout(resolve, 250));
    const originalGetClientRects = Element.prototype.getClientRects;
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    let clientRectReads = 0;
    let boundingRectReads = 0;
    Element.prototype.getClientRects = function(...args) {
      clientRectReads += 1;
      return originalGetClientRects.apply(this, args);
    };
    Element.prototype.getBoundingClientRect = function(...args) {
      boundingRectReads += 1;
      return originalGetBoundingClientRect.apply(this, args);
    };

    const frameGaps = [];
    let lastFrameAt = performance.now();
    try {
      for (let index = 0; index < 24; index += 1) {
        await new Promise(requestAnimationFrame);
        const now = performance.now();
        frameGaps.push(now - lastFrameAt);
        lastFrameAt = now;
        main.scrollTop = (index + 1) * 60;
        main.dispatchEvent(new Event('scroll'));
      }
      await new Promise(requestAnimationFrame);
    } finally {
      Element.prototype.getClientRects = originalGetClientRects;
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      spacer.remove();
    }

    frameGaps.sort((left, right) => left - right);
    return {
      clientRectReads,
      boundingRectReads,
      p95FrameGapMs: frameGaps[Math.max(0, Math.ceil(frameGaps.length * 0.95) - 1)] || 0,
      hasUniversalScrollSelector: /body\\.(?:performance-scroll-active|mobile-text-entry-active|mobile-filter-entry-active|gnc-perf-adaptive-hard)\\s+\\*/.test(performanceStyles),
      scrollClassApplied: document.body.classList.contains('performance-scroll-active')
    };
  })()`));

  expect(result.hasUniversalScrollSelector).toBe(false);
  expect(result.scrollClassApplied).toBe(true);
  expect(result.clientRectReads).toBe(0);
  expect(result.boundingRectReads).toBe(0);
  expect(result.p95FrameGapMs).toBeLessThan(55);
});

test('realtime UI decoration is scoped to newly added content', async ({ page }) => {
  await page.goto('/tests/fixtures/ops-precision-browser.html?view=drive&pilot=1&monitoring=0', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.locator('body').getAttribute('data-qa-ready')).toBe('true');

  const wrapper = page.locator('#view-wrapper');
  await wrapper.evaluate((element) => {
    const card = document.createElement('article');
    card.id = 'realtime-performance-card';
    card.className = 'dock-card';
    card.innerHTML = '<button type="button">Open</button><input aria-label="Note">';
    element.appendChild(card);
  });

  await expect(page.locator('#realtime-performance-card')).toHaveClass(/ui-card/);
  await expect(page.locator('#realtime-performance-card button')).toHaveClass(/ui-action/);
  await expect(page.locator('#realtime-performance-card input')).toHaveClass(/ui-field/);
});
