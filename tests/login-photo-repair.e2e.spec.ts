// September 9 behavior coverage; see docs/rollback-sep09-validation.md.
import { expect, test, type Page } from '@playwright/test';

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

// Isolated native-auth attachment boundary: real compiled upload queue, save
// coordinator, previews and RPC payloads; all external traffic is blocked.
async function drivePhotoHarness(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin;
  await page.route('**/*', route => {
    const request = route.request();
    return new URL(request.url()).origin === origin && ['GET','HEAD'].includes(request.method())
      ? route.continue() : route.abort('blockedbyclient');
  });
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.goto('/?post_deploy_access_canary=1&photo_attachment_canary=1', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof (window as any).queueDrivePhotoAttachment === 'function');
  await page.evaluate(() => window.eval(`(() => {
    if (!installMutationBlockedAccessCanaryIdentity('dylan_collyge', 'Isolated Photo Test', 'ADMIN')) throw new Error('Photo fixture identity unavailable');
    nativeAuthSessionActive = true; nativeAuthProfile = { id: 'isolated-photo-user' };
    window.__photoTest = { calls: [], uploads: 0, held: false, fail: false, gate: null, replies: new Map(),
      row: JSON.parse(localStorage.getItem('isolated-photo-row') || 'null') || {
        unique_id: 'isolated-photo-row', itemcode: 'PHOTO-TEST', locationcode: 'C.11.050',
        lotcode: '26.F1', contsize: '#3', commonname: 'Isolated photo fixture',
        photo_link: null, photo_name: null, ptravailable: 267, ptronhand: 267,
        last_updated: '2026-09-15T14:00:00Z'
      } };
    const f = window.__photoTest;
    fullInventory = formatFetchedRows([f.row], 'ph_master_inventory');
    activeItem = { ...fullInventory[0] };
    activeDetailSourceView = 'drive'; activeDetailTab = 'season';
    document.getElementById('view-login').style.setProperty('display','none','important');
    document.getElementById('app-wrapper').classList.remove('hidden');
    showOnlyPrimaryView('detail');
    document.getElementById('det-season-content').classList.remove('hidden');
    document.getElementById('ssn-spec').value = 'Unsaved specimen';
    // Deterministic Storage responses; attachment saves still call the real
    // saveSecureDriveEvidence and its protected RPC payload construction.
    uploadPhotoViaAppApi = async (prefix, file, fileName) => {
      f.uploads++;
      return { publicUrl: 'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/season_sales_notes_photos/v2/' + file.name,
        filePath: 'v2/' + file.name };
    };
    supabaseRpc = async (name, args) => {
      if (name !== 'save_drive_evidence_v2') throw new Error('Unexpected fixture RPC: ' + name);
      f.calls.push(JSON.parse(JSON.stringify(args)));
      if (f.replies.has(args.p_idempotency_key)) return f.replies.get(args.p_idempotency_key);
      if (f.held) await new Promise(resolve => { f.gate = resolve; });
      if (f.fail) throw new Error('Isolated attachment failure');
      if (args.p_baseline.photo_link !== (f.row.photo_link || '')) throw new Error('Baseline lost the previous photo');
      Object.assign(f.row, args.p_evidence, { last_updated: new Date().toISOString(), av_rule_photo_updated_at: new Date().toISOString() });
      localStorage.setItem('isolated-photo-row', JSON.stringify(f.row));
      if (f.conflictOnce) { f.conflictOnce = false; return { ok: false, code: 'DRIVE_FIELD_CONFLICT', row: { ...f.row }, conflictFields: ['photo_link'] }; }
      const reply = { ok: true, code: 'SAVED', canonicalConfirmed: true, row: { ...f.row }, requestRows: [] };
      f.replies.set(args.p_idempotency_key, reply);
      if (f.loseAck) { f.loseAck = false; throw new Error('Isolated lost acknowledgement'); }
      return reply;
    };
    renderSavedPhotos();
    f.add = name => handlePhotoUpload({ files: [new File(['isolated'], name, { type: 'image/webp' })], value: '' }, 'ssn-');
  })()`));
}

test('Drive photos remain pending until saved, append during a held save, and persist on reload', async ({ page, baseURL }) => {
  await drivePhotoHarness(page, baseURL!);
  await page.evaluate(() => window.eval(`__photoTest.held = true; __photoTest.add('one.webp');`));
  await expect.poll(() => page.evaluate(() => (window as any).__photoTest.calls.length)).toBe(1);
  await expect(page.locator('#ssn-photo-preview')).toContainText('Saving');
  await page.evaluate(() => window.eval(`__photoTest.add('two.webp');`));
  await expect.poll(() => page.evaluate(() => (window as any).__photoTest.uploads)).toBe(2);
  expect(await page.evaluate(() => (window as any).__photoTest.calls.length)).toBe(1);
  await page.evaluate(() => window.eval(`__photoTest.held = false; __photoTest.gate();`));
  await expect.poll(() => page.evaluate(() => window.eval('drivePhotoAttachments.size'))).toBe(0);
  const saved = await page.evaluate(() => ({ ...((window as any).__photoTest) }));
  expect(saved.row.photo_link.split(',')).toHaveLength(2);
  expect(saved.calls[0].p_evidence.photo_link).toContain('one.webp');
  expect(saved.calls[1].p_baseline.photo_link).toContain('one.webp');
  await expect(page.locator('#ssn-spec')).toHaveValue('Unsaved specimen');
  await expect(page.locator('#ssn-photo-list-container img')).toHaveCount(2);
  await page.reload();
  await drivePhotoHarness(page, baseURL!);
  await expect(page.locator('#ssn-photo-list-container img')).toHaveCount(2);
  await page.evaluate(() => window.eval(`__photoTest.add('three.webp');`));
  await expect.poll(() => page.evaluate(() => window.eval('drivePhotoAttachments.size'))).toBe(0);
  expect(await page.evaluate(() => (window as any).__photoTest.row.photo_link.split(',').length)).toBe(3);
});

test('Drive photo failure retains preview and retries the same attachment without reuploading', async ({ page, baseURL }) => {
  await drivePhotoHarness(page, baseURL!);
  await page.evaluate(() => window.eval(`__photoTest.fail = true; __photoTest.add('retry.webp');`));
  const retry = page.getByRole('button', { name: 'Retry photo', exact: true });
  await expect(retry).toBeVisible();
  expect(await page.evaluate(() => (window as any).__photoTest.row.photo_link)).toBeNull();
  await page.evaluate(() => window.eval(`__photoTest.fail = false;`));
  await retry.click();
  await expect.poll(() => page.evaluate(() => window.eval('drivePhotoAttachments.size'))).toBe(0);
  const state = await page.evaluate(() => (window as any).__photoTest);
  expect(state.uploads).toBe(1);
  expect(state.calls).toHaveLength(2);
  expect(state.calls[0].p_idempotency_key).toBe(state.calls[1].p_idempotency_key);
  await expect(page.locator('#ssn-photo-list-container img')).toHaveCount(1);
});

test('Drive photo queued behind a save lock cannot write after the account changes', async ({ page, baseURL }) => {
  await drivePhotoHarness(page, baseURL!);
  await page.evaluate(() => window.eval(`
    runWithDriveEvidenceCrossTabLock = async (uid, run) => { await new Promise(resolve => { __photoTest.gate = resolve; }); return run(); };
    __photoTest.add('old-account.webp');
  `));
  await expect.poll(() => page.evaluate(() => !!(window as any).__photoTest.gate)).toBe(true);
  await page.evaluate(() => window.eval(`resetProductionLiveSync(); currentUser = 'different_account'; __photoTest.gate();`));
  await expect.poll(() => page.evaluate(() => window.eval('pendingPhotoUploads.size'))).toBe(0);
  expect(await page.evaluate(() => (window as any).__photoTest.calls.length)).toBe(0);
  expect(await page.evaluate(() => window.eval('drivePhotoAttachments.size'))).toBe(0);
});

test('Drive photo replay and a canonical-already-attached conflict do not duplicate or lose photos', async ({ page, baseURL }) => {
  await drivePhotoHarness(page, baseURL!);
  await page.evaluate(() => window.eval(`__photoTest.loseAck = true; __photoTest.add('uncertain.webp');`));
  await expect(page.getByRole('button', { name: 'Retry photo', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry photo', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.eval('drivePhotoAttachments.size'))).toBe(0);
  await page.evaluate(() => window.eval(`__photoTest.conflictOnce = true; __photoTest.add('conflict.webp');`));
  await expect(page.getByRole('button', { name: 'Retry photo', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry photo', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.eval('drivePhotoAttachments.size'))).toBe(0);
  const state = await page.evaluate(() => (window as any).__photoTest);
  expect(state.uploads).toBe(2);
  expect(state.calls).toHaveLength(3);
  expect(state.calls[0].p_idempotency_key).toBe(state.calls[1].p_idempotency_key);
  await expect(page.locator('#ssn-photo-list-container img')).toHaveCount(2);
});

test('Drive photo file selection appends every image and preserves an unsaved note', async ({ page, baseURL }) => {
  await drivePhotoHarness(page, baseURL!);
  await page.evaluate(() => window.eval(`handlePhotoUpload({ files: ['batch-a.webp','batch-b.webp','batch-c.webp'].map(name => new File(['isolated'], name, { type: 'image/webp' })), value: '' }, 'ssn-');`));
  await expect.poll(() => page.evaluate(() => (window as any).__photoTest.calls.length)).toBe(3);
  await expect.poll(() => page.evaluate(() => window.eval('drivePhotoAttachments.size'))).toBe(0);
  await expect(page.locator('#ssn-photo-list-container img')).toHaveCount(3);
  await expect(page.locator('#ssn-spec')).toHaveValue('Unsaved specimen');
});
