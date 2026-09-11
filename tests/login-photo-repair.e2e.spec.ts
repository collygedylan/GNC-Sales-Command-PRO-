// September 9 behavior coverage; see docs/rollback-sep09-validation.md.
import { expect, test } from '@playwright/test';

test('phone login keeps both fields and the submit action visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=V2026.08.20.10', { waitUntil: 'load' });

  const username = page.locator('#username-input');
  const accessCode = page.locator('#pin-code');
  const submit = page.locator('#login-button');
  await expect(username).toBeVisible();
  await expect(accessCode).toBeVisible();
  await expect(submit).toBeVisible();

  const controls = await Promise.all([username, accessCode, submit].map((control) => control.boundingBox()));
  expect(controls.every((box) => box && box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844), JSON.stringify(controls)).toBe(true);
});

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
