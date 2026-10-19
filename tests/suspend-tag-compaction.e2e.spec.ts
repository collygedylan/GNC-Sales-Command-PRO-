// @test-group: @suspend-tag,suspend
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const baseInlineCss = [...indexHtml.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].find(match => match[1].includes('.app-drive-card-grid{display:grid'))?.[1] || '';
const commonCss = [
  'theme-tokens.css',
  'live-tailwind-v2026082010.min.css',
].map(name => readFileSync(new URL(`../assets/${name}`, import.meta.url), 'utf8')).join('\n');
const pilotCss = readFileSync(new URL('../assets/ops-precision-pilot.css', import.meta.url), 'utf8');
// Font baseline captured from commit 57539e9e; SHA-256 of decompressed CSS:
// 9902b436d5578c9e2889bbae8680d7ce6750ac366cdfca92ce0a6e8ad5d65cec
const baselinePilotCss = gunzipSync(readFileSync(new URL('./fixtures/suspend-tag-57539e9e.css.gz', import.meta.url))).toString('utf8');
const contrastCss = indexHtml.match(/<style id="suspend-card-contrast">([\s\S]*?)<\/style>/)?.[1] || '';
// This later inline rule controls the production request card grid and must be present in the fixture.
const docksContrastCss = indexHtml.match(/<style id="docks-card-contrast">([\s\S]*?)<\/style>/)?.[1] || '';
// This is a static layout comparison; prevent the app's global 150ms button transition from skewing computed fonts.
const noMotionCss = '*, *::before, *::after { transition: none !important; animation: none !important; }';

test('compact Suspend keeps aligned parties and larger full-width metrics at narrow and wide widths', { tag: ['@suspend-tag'] }, async ({ page }, testInfo) => {
  const layoutStart = indexHtml.indexOf('function buildSharedInventoryCardLayout(');
  const nextFunction = indexHtml.indexOf('\n        function ', layoutStart + 12);
  const layoutSource = indexHtml.slice(layoutStart, nextFunction);
  const reclassSourceStart = indexHtml.indexOf('function buildSuspendTagReclassActionHtml(');
  const reclassSourceEnd = indexHtml.indexOf('\n        function ', reclassSourceStart + 12);
  const reclassSource = indexHtml.slice(reclassSourceStart, reclassSourceEnd);
  expect(layoutSource).toContain('app-suspend-tag-header-row');
  expect(layoutSource).toContain('app-suspend-tag-text-column');
  expect(reclassSource).toContain('return `<div class="app-drive-card-reclass"');
  expect(reclassSource).toContain('${button}${specHtml}');
  expect(reclassSource).not.toContain('MATCH');
  expect(baseInlineCss).toContain('.app-drive-card-grid{display:grid');

  await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body class="ops-precision-pilot current-view-request"><div id="request-content"></div></body></html>');
  let currentStyle = await page.addStyleTag({ content: `${baseInlineCss}\n${commonCss}\n${pilotCss}\n${contrastCss}\n${docksContrastCss}\n${noMotionCss}` });
  await page.evaluate(source => {
    interface SuspendRendererWindow extends Window {
      esc: (value: unknown) => string;
      firstNonEmptyValue: (...values: unknown[]) => unknown;
      getDockStopOrDropValue: (item: Record<string, unknown>) => string;
      buildSharedInventoryCardLayout: (item: Record<string, unknown>, options: Record<string, unknown>) => string;
    }
    const runtime = window as SuspendRendererWindow;
    runtime.esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character);
    runtime.firstNonEmptyValue = (...values) => values.find(value => value != null && String(value).trim() !== '') || '';
    runtime.getDockStopOrDropValue = () => '3';
    window.eval(source);
    const item = { COMMONNAME: 'Variegated Liriope', CONTSIZE: '#1', ITEMCODE: 'LIR-VAR-001', LOCATIONCODE: 'NORTH-4', LOTCODE: 'LOT-22', PRIORITY: 1, DOCK_NUM: 'Dock 30' };
    const reclass = '<div class="app-drive-card-reclass"><button class="app-card-bottom-btn" type="button" style="min-height:44px">Reclass</button><span class="app-suspend-tag-reclass-spec"><span>SPEC</span><strong>Full Sun</strong></span></div>';
    const markup = runtime.buildSharedInventoryCardLayout(item, {
      operational: true, compactSuspend: true, operationalMissingValue: 'N/A', quantity: '8', photoHtml: '<img alt="Plant photo" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=">',
      operationalMetaHtml: '<div class="app-operational-card-meta app-request-card-meta"><span class="app-request-card-meta-chip">Consignee <strong>SiteOne Lds 179/R03 Wichita, KS</strong></span><span class="app-request-card-meta-chip">Sales Rep <strong>Lugas, Wes</strong></span></div>',
      actionsHtml: reclass, headerHtml: '<span class="app-drive-card-badge">History</span><span class="app-drive-card-badge">Reserve: YES</span>',
      metricsHtml: '<div class="app-card-qty-row">' + ['On Hand', 'Review', 'Available', 'Open Stock', 'Loc Photo Match', 'Loc On Hand'].map((label, index) => `<div class="app-card-qty-chip"><span class="app-card-qty-label">${label}</span><strong class="app-card-qty-value">${index === 4 ? '80%' : '23678'}</strong></div>`).join('') + '</div>',
          orderStripHtml: '<div class="app-suspend-tag-order-strip">' + ['Dock','Drop','Qty','Consignee','Sales Rep'].map((label,index) => `<span class="app-suspend-tag-order-field"><span>${label}</span><strong>${index === 0 ? '30' : index === 1 ? '30' : index === 2 ? '50' : index === 3 ? 'Brady Nursery' : 'Lugas, Wes'}</strong></span>`).join('') + '</div>',
          detailsHtml: '<div class="app-card-note">AV NOTE: retain full note text without clipping</div><div class="app-suspend-tag-holdstop-row"><span><b>Hold Stop Code</b><strong>H</strong></span><span><b>Reason</b><strong>Protected field</strong></span></div><div class="app-suspend-tag-status border-t"><div class="app-operational-planstart-date">PLANSTART: 10/19/2026</div><div class="app-suspend-tag-actions"><button class="app-suspend-tag-action text-xs font-bold">Email Rep</button><button class="app-suspend-tag-action text-xs font-bold">Complete Tag</button></div></div>',
    });
    document.querySelector('#request-content')!.innerHTML = `<article class="app-shared-drive-layout app-smart-card app-drive-compact-card app-inventory-card-overhaul app-suspend-tag-compact-card app-drive-card-with-reclass">${markup}</article>`;
  }, layoutSource);

  for (const width of [390, 1200]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.locator('.app-suspend-tag-compact-card').evaluate(card => {
      const box = (selector: string) => {
        const el = card.querySelector(selector);
        if (!el) throw new Error(`Missing fixture element: ${selector}`);
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, font: style.fontSize, marginTop: parseFloat(style.marginTop) || 0 };
      };
      const title = box('.app-drive-card-title');
      const size = box('.app-drive-card-title-size');
      const item = box('.app-drive-card-itemcode');
      const location = box('.app-drive-card-meta');
      const fields = box('.app-suspend-tag-order-strip');
      const party = box('.app-suspend-tag-order-field:nth-child(5)');
      const textColumn = box('.app-suspend-tag-text-column');
      const reclass = box('.app-drive-card-reclass');
      const headerRow = box('.app-suspend-tag-header-row');
      const badges = box('.app-suspend-tag-header-badges');
      const metrics = box('.app-drive-card-quantity-band');
      const note = box('.app-card-note');
      const holdstop = box('.app-suspend-tag-holdstop-row');
      const planstart = box('.app-operational-planstart-date');
      const actions = box('.app-suspend-tag-actions');
      const titleRow = box('.app-drive-card-title-row');
      const header = box('.app-drive-card-header');
      const opLabel = box('.app-suspend-tag-order-field > span');
      const opValue = box('.app-suspend-tag-order-field > strong');
      const metaChip = box('.app-suspend-tag-order-field:nth-child(4)');
      const qtyLabel = box('.app-card-qty-label');
      const qtyValue = box('.app-card-qty-value');
      const noteLabel = box('.app-card-note');
      const plan = box('.app-operational-planstart-date');
      const button = box('.app-suspend-tag-action');
      const reclassButton = box('.app-drive-card-reclass .app-card-bottom-btn');
      const photo = box('.app-drive-card-photo');
      const grid = box('.app-drive-card-grid');
      const details = box('.app-drive-card-details');
      const parties = [...card.querySelectorAll('.app-suspend-tag-order-field:nth-child(n+4)')].map(el => ({ top: el.getBoundingClientRect().top, offsetTop: (el as HTMLElement).offsetTop }));
      const quantities = [...card.querySelectorAll('.app-card-qty-chip')].map(el => ({ top: el.getBoundingClientRect().top, width: el.clientWidth, scrollWidth: el.scrollWidth }));
      const orderFields = [...card.querySelectorAll('.app-suspend-tag-order-field')].map(el => ({ top: el.getBoundingClientRect().top, width: el.clientWidth, scrollWidth: el.scrollWidth }));
      return {
        edges: { photo, grid, details, metrics, note, planstart, actions }, parties, quantities, orderFields,
        gaps: {
          titleItem: item.top - titleRow.bottom,
          itemLocation: location.top - item.bottom,
          headerOrder: fields.top - header.bottom,
          fieldsMetrics: metrics.top - fields.bottom,
          headerBadges: badges.top - headerRow.bottom,
          headerMetrics: metrics.top - header.bottom,
          metricsNote: note.top - metrics.bottom,
          noteHoldstop: holdstop.top - note.bottom,
          holdstopPlan: planstart.top - holdstop.bottom,
          planActions: actions.top - planstart.bottom,
        },
      fonts: { title: title.font, size: size.font, item: item.font, location: location.font, opLabel: opLabel.font, opValue: opValue.font, metaChip: metaChip.font, qtyLabel: parseFloat(qtyLabel.font), qtyValue: parseFloat(qtyValue.font), note: noteLabel.font, plan: plan.font, action: button.font, reclassAction: reclassButton.font },
        textColumnEnd: textColumn.right,
        textColumnBottom: textColumn.bottom,
        reclassStart: reclass.left,
      };
    });
    const currentFonts = layout.fonts;
    await currentStyle.evaluate(style => style.remove());
    const baselineStyle = await page.addStyleTag({ content: `${baseInlineCss}\n${commonCss}\n${baselinePilotCss}\n${contrastCss}\n${docksContrastCss}\n${noMotionCss}` });
    const baselineFonts = await page.locator('.app-suspend-tag-compact-card').evaluate(card => {
      const font = (selector: string) => {
        const element = card.querySelector(selector);
        if (!element) throw new Error(`Missing baseline element: ${selector}`);
        return getComputedStyle(element).fontSize;
      };
    return { title: font('.app-drive-card-title'), size: font('.app-drive-card-title-size'), item: font('.app-drive-card-itemcode'), location: font('.app-drive-card-meta'), opLabel: font('.app-suspend-tag-order-field > span'), opValue: font('.app-suspend-tag-order-field > strong'), metaChip: font('.app-suspend-tag-order-field'), qtyLabel: parseFloat(font('.app-card-qty-label')), qtyValue: parseFloat(font('.app-card-qty-value')), note: font('.app-card-note'), plan: font('.app-operational-planstart-date'), action: font('.app-suspend-tag-action'), reclassAction: font('.app-drive-card-reclass .app-card-bottom-btn') };
    });
    await testInfo.attach(`suspend-tag-layout-${width}.json`, {
      body: JSON.stringify({ viewportWidth: width, gaps: layout.gaps, fonts: currentFonts, baselineFonts, photoPresent: true }, null, 2),
      contentType: 'application/json',
    });
    await baselineStyle.evaluate(style => style.remove());
    currentStyle = await page.addStyleTag({ content: `${baseInlineCss}\n${commonCss}\n${pilotCss}\n${contrastCss}\n${docksContrastCss}\n${noMotionCss}` });

    expect(layout.gaps.titleItem).toBeGreaterThanOrEqual(2);
    expect(layout.gaps.titleItem).toBeLessThanOrEqual(4);
    for (const key of ['itemLocation'] as const) {
      expect(layout.gaps[key], `${key} at ${width}px`).toBeGreaterThanOrEqual(2);
      expect(layout.gaps[key], `${key} at ${width}px`).toBeLessThanOrEqual(4);
    }
    expect(layout.gaps.headerOrder, `order strip follows the full header and badges without a blank gap at ${width}px`).toBeLessThanOrEqual(8);
    expect(layout.gaps.fieldsMetrics, `metrics follow the five-field order strip with compact spacing at ${width}px`).toBeGreaterThanOrEqual(6);
    expect(layout.gaps.fieldsMetrics, `metrics follow the five-field order strip with compact spacing at ${width}px`).toBeLessThanOrEqual(8);
    expect(layout.gaps.headerBadges).toBeGreaterThanOrEqual(4);
    expect(layout.gaps.headerBadges).toBeLessThanOrEqual(6);
    for (const key of ['metricsNote', 'noteHoldstop', 'planActions'] as const) {
      expect(layout.gaps[key], `${key} at ${width}px`).toBeGreaterThanOrEqual(4);
      expect(layout.gaps[key], `${key} at ${width}px`).toBeLessThanOrEqual(6);
    }
    expect(layout.gaps.holdstopPlan, `hold row remains above PLANSTART at ${width}px`).toBeGreaterThanOrEqual(0);
    expect(layout.reclassStart, `Reclass rail is separate at ${width}px`).toBeGreaterThan(layout.textColumnEnd);
    for (const [selector, fontSize] of Object.entries(currentFonts)) {
      if (typeof fontSize === 'number') {
        expect(Number.isFinite(fontSize), `computed font for ${selector} must be finite at ${width}px`).toBeTruthy();
      } else {
        expect(fontSize, `computed font for ${selector} must be present at ${width}px`).not.toBe('');
      }
    }
    const { qtyLabel, qtyValue, ...otherFonts } = currentFonts;
    const { qtyLabel: oldLabel, qtyValue: oldValue, ...otherBaselineFonts } = baselineFonts;
    expect(otherFonts, `non-metric fonts stay unchanged at ${width}px`).toEqual(otherBaselineFonts);
    expect(qtyLabel).toBeGreaterThan(oldLabel);
    expect(qtyLabel).toBeGreaterThanOrEqual(13);
    expect(qtyValue).toBeGreaterThan(oldValue);
    expect(qtyValue).toBeGreaterThanOrEqual(22);
    expect(layout.orderFields).toHaveLength(5);
    expect(new Set(layout.orderFields.map(cell => Math.round(cell.top))).size).toBe(1);
    for (const cell of layout.orderFields) expect(cell.scrollWidth).toBeLessThanOrEqual(cell.width + 1);
    expect(layout.parties).toHaveLength(2);
    expect(layout.parties[0].offsetTop).toBe(layout.parties[1].offsetTop);
    expect(layout.parties[0].top).toBeCloseTo(layout.parties[1].top, 0);
    expect(await page.locator('.app-drive-card-reclass .app-suspend-tag-reclass-spec').innerText()).toBe('SPEC\nFull Sun');
    expect(await page.locator('.app-drive-card-reclass').innerText()).not.toContain('MATCH');
    expect(await page.locator('.app-suspend-tag-reclass-spec').evaluate(el => {
      const rail = el.parentElement;
      const button = rail?.querySelector('.app-card-bottom-btn');
      return !!button && el.getBoundingClientRect().top >= button.getBoundingClientRect().bottom;
    })).toBeTruthy();
    expect(await page.locator('.app-suspend-tag-holdstop-row').evaluate(el => {
      const plan = document.querySelector('.app-operational-planstart-date');
      return !!plan && !!(el.compareDocumentPosition(plan) & Node.DOCUMENT_POSITION_FOLLOWING);
    })).toBeTruthy();
    expect(await page.locator('.app-card-qty-chip').nth(4).innerText()).toContain('80%');
    for (const key of ['details', 'metrics', 'note', 'planstart', 'actions'] as const) {
      expect(layout.edges[key].left, `${key} starts at photo edge at ${width}px`).toBeCloseTo(layout.edges.photo.left, 0);
      expect(layout.edges[key].right, `${key} spans card content at ${width}px`).toBeCloseTo(layout.edges.grid.right, 0);
    }
    expect(layout.edges.details.top).toBeGreaterThanOrEqual(layout.edges.photo.bottom);
    expect(layout.edges.details.top).toBeGreaterThanOrEqual(await page.locator('.app-drive-card-reclass').evaluate(el => el.getBoundingClientRect().bottom));
    expect(new Set(layout.quantities.map(cell => Math.round(cell.top))).size).toBe(1);
    for (const cell of layout.quantities) expect(cell.scrollWidth).toBeLessThanOrEqual(cell.width + 1);
    await page.locator('.app-suspend-tag-compact-card').screenshot({ path: testInfo.outputPath(`suspend-card-${width}.png`) });
  }
});
