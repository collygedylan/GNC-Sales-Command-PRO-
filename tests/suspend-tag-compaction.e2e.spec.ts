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
// This is a static layout comparison; prevent the app's global 150ms button transition from skewing computed fonts.
const noMotionCss = '*, *::before, *::after { transition: none !important; animation: none !important; }';

test('compact Suspend tag order, spacing, and typography stay stable at narrow and wide widths', { tag: ['@suspend-tag'] }, async ({ page }, testInfo) => {
  const layoutStart = indexHtml.indexOf('function buildSharedInventoryCardLayout(');
  const nextFunction = indexHtml.indexOf('\n        function ', layoutStart + 12);
  const layoutSource = indexHtml.slice(layoutStart, nextFunction);
  expect(layoutSource).toContain('app-suspend-tag-header-row');
  expect(layoutSource).toContain('app-suspend-tag-text-column');
  expect(baseInlineCss).toContain('.app-drive-card-grid{display:grid');

  await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body class="ops-precision-pilot current-view-request"><div id="request-content"></div></body></html>');
  let currentStyle = await page.addStyleTag({ content: `${baseInlineCss}\n${commonCss}\n${pilotCss}\n${contrastCss}\n${noMotionCss}` });
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
    const reclass = '<div class="app-drive-card-reclass"><button class="app-card-bottom-btn" type="button" style="height:180px">Reclass</button></div>';
    const markup = runtime.buildSharedInventoryCardLayout(item, {
      operational: true, compactSuspend: true, operationalMissingValue: 'N/A', quantity: '8', photoHtml: '<img alt="Plant photo" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=">',
      operationalMetaHtml: '<div class="app-operational-card-meta app-request-card-meta"><span class="app-request-card-meta-chip">Consignee <strong>North Farm</strong></span><span class="app-request-card-meta-chip">Sales Rep <strong>Jordan</strong></span></div>',
      actionsHtml: reclass, headerHtml: '<span class="app-drive-card-badge">History</span><span class="app-drive-card-badge">Reserve: YES</span>',
      metricsHtml: '<div class="app-card-qty-row">' + ['On Hand', 'Available', 'Reserved', 'Pending', 'On Order', 'Allocated'].map(label => `<div class="app-card-qty-chip"><span class="app-card-qty-label">${label}</span><strong class="app-card-qty-value">124</strong></div>`).join('') + '</div>',
      detailsHtml: '<div class="app-suspend-tag-data-chips"><span>SPEC: Full Sun</span><span>MATCH: 95%</span></div><div class="app-card-note">AV NOTE: retain full note text without clipping</div><div class="app-suspend-tag-status border-t"><div class="app-operational-planstart-date">PLANSTART: 10/19/2026</div><div class="app-suspend-tag-actions"><button class="app-suspend-tag-action text-xs font-bold">Email Rep</button><button class="app-suspend-tag-action text-xs font-bold">Complete Tag</button></div></div>',
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
      const fields = box('.app-operational-card-header-fields');
      const party = box('.app-operational-card-meta');
      const reclass = box('.app-drive-card-reclass');
      const headerRow = box('.app-suspend-tag-header-row');
      const badges = box('.app-suspend-tag-header-badges');
      const metrics = box('.app-drive-card-quantity-band');
      const chips = box('.app-suspend-tag-data-chips');
      const note = box('.app-card-note');
      const planstart = box('.app-operational-planstart-date');
      const actions = box('.app-suspend-tag-actions');
      const titleRow = box('.app-drive-card-title-row');
      const header = box('.app-drive-card-header');
      const opLabel = box('.app-operational-card-header-field > span');
      const opValue = box('.app-operational-card-header-field > strong');
      const metaChip = box('.app-request-card-meta-chip');
      const qtyLabel = box('.app-card-qty-label');
      const qtyValue = box('.app-card-qty-value');
      const noteLabel = box('.app-card-note');
      const plan = box('.app-operational-planstart-date');
      const button = box('.app-suspend-tag-action');
      const reclassButton = box('.app-drive-card-reclass .app-card-bottom-btn');
      return {
        gaps: {
          titleItem: item.top - titleRow.bottom,
          itemLocation: location.top - item.bottom,
          locationFields: fields.top - location.bottom,
          fieldsParty: party.top - fields.bottom,
          reclassHeight: reclass.bottom - reclass.top,
          headerBadges: badges.top - headerRow.bottom,
          headerMetrics: metrics.top - header.bottom,
          metricsChips: chips.top - metrics.bottom,
          chipsNote: note.top - chips.bottom,
          notePlan: planstart.top - note.bottom,
          planActions: actions.top - planstart.bottom,
        },
        fonts: { title: title.font, size: size.font, item: item.font, location: location.font, opLabel: opLabel.font, opValue: opValue.font, metaChip: metaChip.font, qtyLabel: parseFloat(qtyLabel.font), qtyValue: parseFloat(qtyValue.font), note: noteLabel.font, plan: plan.font, action: button.font, reclassAction: reclassButton.font },
        textColumnEnd: party.right,
        textColumnBottom: party.bottom,
        reclassStart: reclass.left,
      };
    });
    const currentFonts = layout.fonts;
    await currentStyle.evaluate(style => style.remove());
    const baselineStyle = await page.addStyleTag({ content: `${baseInlineCss}\n${commonCss}\n${baselinePilotCss}\n${contrastCss}\n${noMotionCss}` });
    const baselineFonts = await page.locator('.app-suspend-tag-compact-card').evaluate(card => {
      const font = (selector: string) => {
        const element = card.querySelector(selector);
        if (!element) throw new Error(`Missing baseline element: ${selector}`);
        return getComputedStyle(element).fontSize;
      };
      return { title: font('.app-drive-card-title'), size: font('.app-drive-card-title-size'), item: font('.app-drive-card-itemcode'), location: font('.app-drive-card-meta'), opLabel: font('.app-operational-card-header-field > span'), opValue: font('.app-operational-card-header-field > strong'), metaChip: font('.app-request-card-meta-chip'), qtyLabel: parseFloat(font('.app-card-qty-label')), qtyValue: parseFloat(font('.app-card-qty-value')), note: font('.app-card-note'), plan: font('.app-operational-planstart-date'), action: font('.app-suspend-tag-action'), reclassAction: font('.app-drive-card-reclass .app-card-bottom-btn') };
    });
    await testInfo.attach(`suspend-tag-layout-${width}.json`, {
      body: JSON.stringify({ viewportWidth: width, gaps: layout.gaps, fonts: currentFonts, baselineFonts, photoPresent: true, reclassRailHeightPx: layout.gaps.reclassHeight }, null, 2),
      contentType: 'application/json',
    });
    await baselineStyle.evaluate(style => style.remove());
    currentStyle = await page.addStyleTag({ content: `${baseInlineCss}\n${commonCss}\n${pilotCss}\n${contrastCss}\n${noMotionCss}` });

    expect(layout.gaps.reclassHeight).toBeGreaterThan(170);
    expect(layout.textColumnBottom).toBeLessThan((await page.locator('.app-drive-card-reclass').evaluate(el => el.getBoundingClientRect().bottom)));
    expect(layout.gaps.titleItem).toBeGreaterThanOrEqual(2);
    expect(layout.gaps.titleItem).toBeLessThanOrEqual(4);
    for (const key of ['itemLocation', 'locationFields', 'fieldsParty'] as const) {
      expect(layout.gaps[key], `${key} at ${width}px`).toBeGreaterThanOrEqual(2);
      expect(layout.gaps[key], `${key} at ${width}px`).toBeLessThanOrEqual(4);
    }
    expect(layout.gaps.headerBadges).toBeGreaterThanOrEqual(4);
    expect(layout.gaps.headerBadges).toBeLessThanOrEqual(6);
    expect(layout.gaps.headerMetrics).toBeGreaterThanOrEqual(6);
    expect(layout.gaps.headerMetrics).toBeLessThanOrEqual(8);
    for (const key of ['metricsChips', 'chipsNote', 'notePlan', 'planActions'] as const) {
      expect(layout.gaps[key], `${key} at ${width}px`).toBeGreaterThanOrEqual(4);
      expect(layout.gaps[key], `${key} at ${width}px`).toBeLessThanOrEqual(6);
    }
    expect(layout.reclassStart, `Reclass rail is separate at ${width}px`).toBeGreaterThan(layout.textColumnEnd);
    for (const [selector, fontSize] of Object.entries(currentFonts)) {
      if (typeof fontSize === 'number') {
        expect(Number.isFinite(fontSize), `computed font for ${selector} must be finite at ${width}px`).toBeTruthy();
      } else {
        expect(fontSize, `computed font for ${selector} must be present at ${width}px`).not.toBe('');
      }
    }
    expect(currentFonts, `font sizes must equal baseline 57539e9e at ${width}px`).toEqual(baselineFonts);
  }
});
