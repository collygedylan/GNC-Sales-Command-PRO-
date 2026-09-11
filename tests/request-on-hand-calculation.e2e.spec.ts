// September 9 behavior coverage; see docs/rollback-sep09-validation.md.
import { expect, test } from '@playwright/test';

test('Request quantity and spec fields stay high-contrast and responsive on phones', async ({ page }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize(viewport);
      await page.goto('/?e2e=V2026.08.27.07', { waitUntil: 'domcontentloaded' });
      await page.evaluate((activeTheme) => {
        document.body.classList.add('ops-precision-pilot');
        document.body.setAttribute('data-ops-theme', activeTheme);
        const modal = document.getElementById('request-rep-modal')!;
        modal.classList.remove('hidden');
        modal.classList.add('request-qty-active');
        modal.style.setProperty('display', 'flex', 'important');
        for (const id of ['step-1-rep', 'step-1.5-folder', 'step-2-cust']) document.getElementById(id)!.classList.add('hidden');
        const qtyStep = document.getElementById('step-3-qty')!;
        qtyStep.classList.remove('hidden');
        qtyStep.style.setProperty('display', 'flex', 'important');
        document.getElementById('qty-list-container')!.innerHTML = `
          <div class="request-entry-card">
            <div><div class="request-entry-name">Dallas Blues Switch Grass</div><div class="request-entry-meta">#3 · Location C.16.000 · Source LD</div></div>
            <div class="request-entry-fields">
              <div class="request-entry-field request-entry-field--qty"><label class="request-entry-label">Quantity</label><input class="request-entry-control item-qty-input" placeholder="Enter quantity" value="150"></div>
              <div class="request-entry-field"><label class="request-entry-label">Estimated Ship</label><select class="request-entry-control"><option>ASAP</option></select></div>
              <div class="request-entry-field"><label class="request-entry-label">Reserve</label><select class="request-entry-control"><option>NO</option></select></div>
              <div class="request-entry-field request-entry-field--wide"><label class="request-entry-label">Desired Spec</label><input class="request-entry-control item-spec-input" placeholder="Enter Spec or N/A" value="24-30 inch"></div>
              <div class="request-entry-field request-entry-field--wide"><label class="request-entry-label">Row Note</label><textarea class="request-entry-control">Visible note</textarea></div>
            </div>
          </div>`;
      }, theme);

      const state = await page.locator('.request-entry-card').evaluate((card) => {
        const labels = Array.from(card.querySelectorAll<HTMLElement>('.request-entry-label'));
        const controls = Array.from(card.querySelectorAll<HTMLElement>('.request-entry-control'));
        const qty = card.querySelector<HTMLElement>('.request-entry-field--qty')!;
        const est = labels[1].parentElement as HTMLElement;
        const reserve = labels[2].parentElement as HTMLElement;
        const rgb = (value: string) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
        const luminance = (value: string) => {
          const channels = rgb(value).map((channel) => {
            const normalized = channel / 255;
            return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
        };
        const contrast = (foreground: string, background: string) => {
          const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
          return (lighter + 0.05) / (darker + 0.05);
        };
        return {
          minLabelContrast: Math.min(...labels.map((label) => contrast(getComputedStyle(label).color, getComputedStyle(card).backgroundColor))),
          minControlContrast: Math.min(...controls.map((control) => contrast(getComputedStyle(control).color, getComputedStyle(control).backgroundColor))),
          minControlHeight: Math.min(...controls.map((control) => control.getBoundingClientRect().height)),
          minControlFont: Math.min(...controls.map((control) => Number.parseFloat(getComputedStyle(control).fontSize))),
          qtyWidth: qty.getBoundingClientRect().width,
          estWidth: est.getBoundingClientRect().width,
          estTop: Math.round(est.getBoundingClientRect().top),
          reserveTop: Math.round(reserve.getBoundingClientRect().top),
          overflow: Math.max(0, card.scrollWidth - card.clientWidth),
        };
      });
      expect(state.minLabelContrast, `${viewport.width}/${theme}: ${JSON.stringify(state)}`).toBeGreaterThanOrEqual(4.5);
      expect(state.minControlContrast).toBeGreaterThanOrEqual(4.5);
      expect(state.minControlHeight).toBeGreaterThanOrEqual(44);
      expect(state.minControlFont).toBeGreaterThanOrEqual(16);
      expect(state.qtyWidth).toBeGreaterThan(state.estWidth * 1.8);
      expect(state.estTop).toBe(state.reserveTop);
      expect(state.overflow).toBe(0);
    }
  }
});

test('Request reusable evidence prompt accepts partial exact-row data without auto-completing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=V2026.09.04.04&post_deploy_request_canary=reuse-evidence', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    typeof (window as any).getRequestReusableData === 'function'
    && typeof (window as any).renderRequestQtyStepCurrentItem === 'function'
  ));
  await page.waitForLoadState('load');
  await page.waitForTimeout(1000);

  const eligibility = await page.evaluate(() => window.eval(`(() => {
    const now = new Date().toISOString();
    const row = {
      DOM_ID: 'hosted-request-canary-row',
      UNIQUE_ID: '007850_031_1-3DP-A_06_000-27_S1-LD----',
      SOURCE_TABLE: 'ph_master_inventory',
      ITEMCODE: '007850.031.1',
      COMMONNAME: 'Invincibelle Wee White® Hydrangea',
      CONTSIZE: '3DP',
      LOCATIONCODE: 'A.06.000',
      LOTCODE: '27.S1',
      SOURCE: 'LD',
      PTRONHAND: '332',
      PTRAVAILABLE: '332',
      SAVED_PHOTO_LINK: 'https://example.com/request-reuse-photo.jpg',
      SAVED_PHOTO_NAME: 'photo ' + now,
      SPEC: 'N/A',
      MATCH: '50',
      LOC_MATCH_QTY: '166',
      AV_RULE_BUNDLE_UPDATED_AT: now,
      AV_RULE_SPEC_UPDATED_AT: now,
      AV_RULE_MATCH_UPDATED_AT: now,
      AV_RULE_PHOTO_UPDATED_AT: now,
      AV_RULE_PRIORITY_SNAPSHOT: '',
      AV_RULE_HOLDSTOP_SNAPSHOT: ''
    };
    const reusable = getRequestReusableData(row);
    const photoOnly = getRequestReusableData({ ...row, SPEC: '', MATCH: '', LOC_MATCH_QTY: '' });
    const expiredAt = new Date(Date.now() - (11 * 24 * 60 * 60 * 1000)).toISOString();
    const expired = getRequestReusableData({
      ...row,
      SAVED_PHOTO_NAME: 'photo ' + expiredAt,
      AV_RULE_BUNDLE_UPDATED_AT: expiredAt,
      AV_RULE_SPEC_UPDATED_AT: expiredAt,
      AV_RULE_MATCH_UPDATED_AT: expiredAt,
      AV_RULE_PHOTO_UPDATED_AT: expiredAt
    });
    const differentLot = isSameRequestReusableRow(row, { ...row, LOTCODE: '27.F1' });

    const fixture = installMutationBlockedRequestCanaryFixture();
    if (!fixture) throw new Error('REQUEST_CANARY_FIXTURE_UNAVAILABLE');
    Object.assign(fixture, row);
    invalidateInventoryDomIdLookup();
    document.getElementById('view-login').classList.add('hidden');
    showRequestModalBase();
    goToQtyStep(null, 'Synthetic Canary Customer | Synthetic Canary Dock', 'step-2-cust', false);
    return {
      reusable: {
        hasReusableEvidence: reusable.hasReusableEvidence,
        readyForAutoComplete: reusable.readyForAutoComplete,
        spec: reusable.spec,
        match: reusable.match,
        hasPhoto: !!reusable.photoLink
      },
      photoOnly: photoOnly.hasReusableEvidence,
      expired: expired.hasReusableEvidence,
      differentLot,
      renderedPrompt: document.querySelectorAll('.item-reuse-data-input').length === 1,
      renderedItem: !!findItemByDomId(row.DOM_ID)
    };
  })()`));

  expect(eligibility).toEqual({
    reusable: {
      hasReusableEvidence: true,
      readyForAutoComplete: false,
      spec: 'N/A',
      match: '50',
      hasPhoto: true,
    },
    photoOnly: false,
    expired: false,
    differentLot: false,
    renderedPrompt: true,
    renderedItem: true,
  });

  const prompt = page.locator('.item-reuse-data-input');
  const submit = page.locator('#request-submit-btn');
  await expect(prompt).toBeVisible();
  await expect(prompt).toHaveValue('');
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveText('CHOOSE PHOTO/DATA OPTION');

  await prompt.selectOption('YES');
  await expect(submit).toBeEnabled();
  await page.evaluate(() => (window as any).renderRequestQtyStepCurrentItem());
  await expect(prompt).toHaveValue('YES');
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(prompt).toBeVisible();
  await expect(prompt).toHaveValue('YES');

  const storedChoice = await page.evaluate(() => (window as any).getCurrentRequestReuseDecisionState().choice);
  expect(storedChoice).toBe('YES');
});
