// September 9 behavior coverage; see docs/rollback-sep09-validation.md.
import { expect, test } from '@playwright/test';

const fixtureUrl = '/tests/fixtures/ops-precision-browser.html';

test('Kayla receives standard Admin Request, Drive, and photo access', async ({ page }) => {
  await page.goto('/?e2e=V2026.08.20.10', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).getRoleAccessState === 'function');
  const permissions = await page.evaluate(() => {
    window.eval("window.__qaOriginalGetRoleAccessState=getRoleAccessState; window.__qaOriginalRequestIdentityTokens=getRequestRepScopedIdentityTokens; window.__qaOriginalGetRequestCapabilities=getRequestCapabilities; currentUser='kayla_knepp'; currentUserDisplay='Kayla Knepp'; currentRole='ADMIN'; getRequestCapabilities=function(){ return {contractVersion:2,username:'kayla_knepp',scope:'global',canCreateGeneral:true,canCreateAv:true,canViewQueue:true,canTakePhoto:true,canEdit:true,canComplete:true,canArchive:true}; }; getRequestRepScopedIdentityTokens=function(){ return new Set(['kayla_knepp']); }; getRoleAccessState=function(){ return window.__qaOriginalGetRoleAccessState('ADMIN','kayla_knepp'); };");
    const result = window.eval(`({
      repReadOnly: isRepReadOnlyUser(),
      globalRequestManager: canUseGlobalRequestAccess(),
      canArchiveRequestRows: canCurrentUserArchiveRequestRows(),
      canArchiveRequestRow: canCurrentUserArchiveRequestRow({ UNIQUE_ID: 'REQ-KAYLA-ARCHIVE', REQUEST_HISTORY: false }),
      requestEditable: canEditRowDetails('req-', { SOURCE_TABLE: 'ph_active_request' }),
      driveEditable: canEditRowDetails('ssn-', { SOURCE_TABLE: 'ph_master_inventory' }),
      requestPhotoLabel: getTaskDetailQuickPhotoLabel('req-')
    })`);
    window.eval("getRoleAccessState=window.__qaOriginalGetRoleAccessState; getRequestRepScopedIdentityTokens=window.__qaOriginalRequestIdentityTokens; getRequestCapabilities=window.__qaOriginalGetRequestCapabilities; delete window.__qaOriginalGetRoleAccessState; delete window.__qaOriginalRequestIdentityTokens; delete window.__qaOriginalGetRequestCapabilities;");
    return result;
  });

  expect(permissions).toEqual({
    repReadOnly: false,
    globalRequestManager: true,
    canArchiveRequestRows: true,
    canArchiveRequestRow: true,
    requestEditable: true,
    driveEditable: true,
    requestPhotoLabel: 'Take Request Photo',
  });
});

test('phone Request detail uses natural scrolling, a photo rail, a scrollable AV sheet, and a persistent Mark Done tray', async ({ page }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize(viewport);
      await page.goto(`${fixtureUrl}?view=detail&theme=${theme}&ua=ios&monitoring=0`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#view-detail')).toBeVisible();
      await expect(page.locator('#req-spec')).toBeVisible();
      await expect(page.locator('#req-comments')).toBeVisible();
      await expect(page.locator('#req-btn-save-complete')).toBeVisible();
      await expect(page.locator('#request-photo-section')).toBeVisible();

      const state = await page.locator('#view-detail').evaluate(() => {
        const main = document.getElementById('main-scroll-area')!;
        const nav = document.getElementById('bottom-nav')!;
        const saveTray = document.getElementById('req-save-action-wrap')!;
        const form = document.getElementById('det-request-content')!;
        const photoRail = document.getElementById('request-photo-section')!;
        const inputs = Array.from(form.querySelectorAll<HTMLElement>('.input-field')).filter((input) => input.offsetParent !== null);
        const rect = (element: Element) => element.getBoundingClientRect();
        return {
          mainScrollable: main.scrollHeight > main.clientHeight,
          mainOverflowY: getComputedStyle(main).overflowY,
          horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
          formHeight: rect(form).height,
          formOverflow: getComputedStyle(form).overflow,
          savePosition: getComputedStyle(saveTray).position,
          saveTop: rect(saveTray).top,
          saveBottom: rect(saveTray).bottom,
          navTop: rect(nav).top,
          minInputHeight: Math.min(...inputs.map((input) => rect(input).height)),
          minInputFont: Math.min(...inputs.map((input) => Number.parseFloat(getComputedStyle(input).fontSize))),
          photoOverflowX: getComputedStyle(photoRail).overflowX,
          photoScrollable: photoRail.scrollWidth > photoRail.clientWidth,
          cameraFirst: photoRail.firstElementChild?.id === 'det-request-camera-panel',
        };
      });
      expect(state.mainScrollable, `${viewport.width}x${viewport.height}: ${JSON.stringify(state)}`).toBe(true);
      expect(state.mainOverflowY).toBe('auto');
      expect(state.horizontalOverflow).toBe(0);
      expect(state.formHeight).toBeGreaterThan(300);
      expect(state.formOverflow).toBe('visible');
      expect(state.savePosition).toBe('fixed');
      expect(state.saveTop).toBeGreaterThanOrEqual(0);
      expect(state.saveBottom).toBeLessThanOrEqual(state.navTop + 1);
      expect(state.minInputHeight).toBeGreaterThanOrEqual(44);
      expect(state.minInputFont).toBeGreaterThanOrEqual(16);
      expect(state.photoOverflowX).toBe('auto');
      expect(state.photoScrollable).toBe(true);
      expect(state.cameraFirst).toBe(true);

      await page.locator('#fixture-open-av-notes').click();
      const sheet = page.locator('#req-av-dropdown-list');
      await expect(sheet).toBeVisible();
      await expect(sheet.locator('.av-note-dropdown-option')).toHaveCount(80);
      const sheetState = await sheet.evaluate((panel) => ({
        overflowY: getComputedStyle(panel).overflowY,
        touchAction: getComputedStyle(panel).touchAction,
        scrollable: panel.scrollHeight > panel.clientHeight,
        width: panel.getBoundingClientRect().width,
      }));
      expect(sheetState.overflowY).toBe('auto');
      expect(sheetState.touchAction).toBe('pan-y');
      expect(sheetState.scrollable).toBe(true);
      expect(sheetState.width).toBeLessThanOrEqual(viewport.width);
      const mainScrollBeforeSheetScroll = await page.locator('#main-scroll-area').evaluate((main) => main.scrollTop);
      await sheet.locator('.av-note-dropdown-option').last().scrollIntoViewIfNeeded();
      await expect(sheet.locator('.av-note-dropdown-option').last()).toBeInViewport();
      expect(await page.locator('#main-scroll-area').evaluate((main) => main.scrollTop)).toBe(mainScrollBeforeSheetScroll);
    }
  }
});

test('Request AV sheet preserves swipe intent before selecting a later option', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=V2026.08.31.05', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).openRequestAvNoteSheet === 'function');
  await page.evaluate(() => window.eval(`(() => {
    canEditRowDetails = () => true;
    saveData = () => Promise.resolve({ ok: true });
    const input = document.getElementById('req-av-note');
    const list = document.getElementById('req-av-dropdown-list');
    input.value = '';
    list.innerHTML = Array.from({ length: 40 }, (_, index) =>
      '<button type="button" class="av-note-dropdown-option" data-av-note-option="OPTION ' + index + '" data-av-note-prefix="req-" onclick="return selectAvNote(this.dataset.avNoteOption, this.dataset.avNotePrefix, event)">OPTION ' + index + '</button>'
    ).join('');
    list.style.height = '240px';
    openRequestAvNoteSheet(list);
  })()`));

  const sheet = page.locator('#request-av-note-sheet');
  const list = page.locator('#req-av-dropdown-list');
  const first = page.locator('#req-av-dropdown-list .av-note-dropdown-option').first();
  await expect(sheet).toBeVisible();
  await first.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 100, clientY: 650 });
  await first.dispatchEvent('pointermove', { pointerType: 'touch', clientX: 100, clientY: 500 });
  await first.dispatchEvent('pointerup', { pointerType: 'touch', clientX: 100, clientY: 500 });
  await expect(sheet).toBeVisible();
  await expect(page.locator('#req-av-note')).toHaveValue('');

  const scrollTop = await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop;
  });
  expect(scrollTop).toBeGreaterThan(0);
  const last = page.locator('#req-av-dropdown-list .av-note-dropdown-option').last();
  await last.click();
  await expect(page.locator('#req-av-note')).toHaveValue('OPTION 39');
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

test.describe('September 9 photo processing', () => {

test.beforeEach(async ({ page }) => {
  await page.goto('/?e2e=photo-egress-v1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).getDirectImageUrl === 'function');
});

test('legacy and V2 card URLs never point at the original object', async ({ page }) => {
  const urls = await page.evaluate(() => {
    const hash = 'a'.repeat(64);
    const legacy = 'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/2026-09-04/legacy.webp';
    const v2 = `https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/v2/${hash}.webp`;
    return {
      legacy: (window as any).getDirectImageUrl(legacy, 'card-feature'),
      v2: (window as any).getDirectImageUrl(v2, 'card-feature'),
      fallback: (window as any).getDeferredCardPhotoFallbackSrc(legacy),
    };
  });
  expect(urls.legacy).toContain('/storage/v1/render/image/public/request_photos/');
  expect(urls.legacy).toMatch(/[?&]width=(320|640)(?:&|$)/);
  expect(urls.legacy).toContain('quality=62');
  expect(urls.legacy).toContain('resize=contain');
  expect(urls.v2).toContain(`/storage/v1/object/public/request_photos/_thumbs/v2/${'a'.repeat(64)}-w320.webp`);
  expect(urls.fallback).toBe('');
});

test('main-thread iPhone fallback emits bounded JPEG or WebP plus both thumbnails', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1400;
    canvas.height = 1000;
    const context = canvas.getContext('2d')!;
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#025f3f');
    gradient.addColorStop(0.5, '#d4efbc');
    gradient.addColorStop(1, '#69340c');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < 140; index += 1) {
      context.fillStyle = `hsl(${(index * 29) % 360} 70% 50%)`;
      context.fillRect((index * 83) % 1400, (index * 47) % 1000, 120, 70);
    }
    const source = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('png encode failed')), 'image/png'));
    const optimized = await (window as any).optimizePhotoBlobOnMainThread(source);
    return {
      type: optimized.contentType,
      displayBytes: optimized.blob.size,
      displaySignature: await (window as any).getPhotoBlobEncoding(optimized.blob),
      thumb144Bytes: optimized.thumbnail144Blob.size,
      thumb144Signature: await (window as any).getPhotoBlobEncoding(optimized.thumbnail144Blob),
      thumb320Bytes: optimized.thumbnail320Blob.size,
      thumb320Signature: await (window as any).getPhotoBlobEncoding(optimized.thumbnail320Blob),
      width: optimized.width,
      height: optimized.height,
      hash: optimized.hash,
    };
  });
  expect(['image/jpeg', 'image/webp']).toContain(result.type);
  expect(result.displaySignature).toBe(result.type);
  expect(result.thumb144Signature).toBe(result.type);
  expect(result.thumb320Signature).toBe(result.type);
  expect(result.displayBytes).toBeLessThanOrEqual(1_280_000);
  expect(result.thumb144Bytes).toBeLessThanOrEqual(80 * 1024);
  expect(result.thumb320Bytes).toBeLessThanOrEqual(160 * 1024);
  expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(1920);
  expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
});

});
