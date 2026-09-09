import { expect, test, type Page } from '@playwright/test';

// The real browser bootstrap, permission loaders, renderer, optimizer, upload,
// and evidence coordinator run here. Only authentication and remote boundaries
// are synthetic. No production requests or WebSockets are allowed through.
async function isolatedApp(page: Page) {
  const masterWrites: string[] = [];
  const appOrigin = new URL(String(test.info().project.use.baseURL || 'http://127.0.0.1:43116')).origin;
  await page.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (/ph_master_inventory/.test(url.pathname) && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      masterWrites.push(request.method());
    }
    const staticAsset = url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/manifest.json'
      || url.pathname.startsWith('/assets/') || /\.(?:png|webp|jpg|jpeg|svg|ico|woff2?)$/i.test(url.pathname);
    return url.origin === appOrigin && staticAsset && ['GET', 'HEAD'].includes(request.method())
      ? route.continue() : route.abort('blockedbyclient');
  });
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.goto('/?post_deploy_access_canary=login-photo-repair', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof (window as any).finalizeLogin === 'function');
  await page.evaluate(async () => {
    const w = window as any;
    w.__repair = { calls: [], toasts: [], frames: [], controls: {}, backgroundSettled: false };
    w.clearLoginStartupWatchdog();
    localStorage.clear(); sessionStorage.clear();
    const client: any = { auth:{
      signInWithPassword: async () => ({ data:{ session:{ access_token:'isolated-test-token', user:{ id:w.__repair.profile.id } } } }),
      getSession: async () => ({ data:{ session:{ access_token:'isolated-test-token', user:{ id:w.__repair.profile.id } } } }),
      onAuthStateChange: () => ({ data:{ subscription:{ unsubscribe() {} } } }),
    }, from:() => ({ select:() => ({ eq:() => ({ maybeSingle:async () => ({ data:w.__repair.profile }) }) }) }) };
    w.getSupabaseBrowserClient = () => client;
    w.__repair.identity = async (username: string, role: string) => {
      if (typeof w.invalidateLoginSessionGeneration === 'function') w.invalidateLoginSessionGeneration();
      w.clearRoleScopedClientCaches();
      w.__repair.profile = { id:'profile-' + username, username, display_name:username, role, division:'10' };
      const authenticated = await w.tryNativeAuthPasswordLogin(username, 'isolated-password');
      if (!authenticated) throw new Error('SYNTHETIC_NATIVE_AUTH_FAILED');
      if (!w.installMutationBlockedAccessCanaryIdentity(username, 'Isolated Fixture', role)) throw new Error('SYNTHETIC_APP_IDENTITY_FAILED');
    };
    await w.__repair.identity('login_photo_fixture', 'ADMIN');
    w.__repair.start = (restored = false) => {
      w.__repair.startedAt = performance.now(); w.__repair.loginDone = false;
      if (restored) { w.clearInMemorySessionIdentity(); w.clearExplicitLogoutMarker(); }
      const login = restored ? w.restoreNativeAuthSessionOnStartup()
        : w.finalizeLogin(w.__repair.profile.username, '', false, { skipBiometricPrompt:true });
      w.__repair.login = login
        .then((result: any) => { w.__repair.loginDone = true; return result; })
        .catch((error: Error) => { w.__repair.loginError = error.message; });
    };
    w.__repair.snapshot = () => ({ currentUser:w.captureLoginSessionOwnership().username,
      role:w.__repair.profile.role, native:!!w.captureLoginSessionOwnership().profileId,
      accessUser:w.getAppAccessSnapshot()?.username, requestUser:w.getRequestCapabilities()?.username });
    w.showToast = (title: string, message: string) => w.__repair.toasts.push({ title, message });
    // Suppress unrelated external integrations, not startup or its data reads.
    for (const name of ['initializeOpsPilotForCurrentSession', 'ensureLeafAssistantSession',
      'refreshCurrentSeasonSettingsFromRemote', 'refreshAvBlanksPhotoBypassSettingsFromRemote',
      'ensureDockAssignableUsers', 'ensureDockTeamStatusLoaded', 'ensureDockItemStatusLoaded',
      'ensureDockIssueDataLoaded', 'ensureAvRuleColumnsReady', 'warmCachedInventory', 'warmUserScopedDatasetCaches']) {
      w[name] = async () => false;
    }
    for (const name of ['scheduleBackgroundLoginValidation', 'ensureChatBackgroundSync',
      'installPushEnrollmentListeners', 'scheduleCellularPushEnrollment', 'queueDatasetLoad',
      'queueVisibleDatasetCatchup', 'scheduleTaskHotCacheWarmup', 'startRealtimeSubscriptions']) {
      w[name] = () => {};
    }
    const deferredRead = (name: string) => () => {
      w.__repair.calls.push(name);
      return new Promise((_resolve, reject) => { w.__repair.controls[name] = () => reject(new Error('ISOLATED_BACKGROUND_UNAVAILABLE')); });
    };
    for (const name of ['loadEvalWorkAssignments', 'loadLoginReadyDatasets', 'refreshManualSyncStatus', 'loadDepartmentCalendar', 'loadChatMessages']) {
      w[name] = deferredRead(name);
    }
    w.supabaseRpc = async (operation: string) => {
      w.__repair.calls.push(operation);
      const identity = w.__repair.snapshot();
      const delay = w.__repair.permissionDelay || 0;
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (operation === 'get_my_app_permissions_v1') {
        if (w.__repair.accessFailure) throw new Error('ISOLATED_ACCESS_UNAVAILABLE');
        w.__repair.accessResolvedAt = performance.now();
        return { contractVersion:'app-access-v1', enforcementMode:'enforced', username:identity.currentUser,
          role:identity.role, permissions:[{ permissionKey:'module.managers.view', kind:'module', moduleKey:'managers', allowed:false }] };
      }
      if (operation === 'get_request_capabilities') {
        if (w.__repair.requestFailure) throw new Error('ISOLATED_REQUEST_ACCESS_UNAVAILABLE');
        return { contract_version:2, username:identity.currentUser, scope:'global', can_view_queue:true,
          can_take_photo:true, can_edit:true, can_complete:true, can_create_general:true, can_create_av:true };
      }
      return [];
    };
    const visible = (element: Element | null) => !!element && getComputedStyle(element).display !== 'none'
      && getComputedStyle(element).visibility !== 'hidden' && element.getBoundingClientRect().height > 0;
    const sample = () => {
      const opened = visible(document.getElementById('app-wrapper')) && !visible(document.getElementById('view-login'));
      if (opened) {
        const tiles = [...document.querySelectorAll('#home-dashboard-grid > button, #home-rep-dashboard-grid > button')].filter(visible);
        w.__repair.frames.push({ at:performance.now(), count:tiles.length,
          access:visible(document.getElementById('home-module-access-status')),
          noModules:!!document.querySelector('[data-home-no-modules]'),
          denied:tiles.some(element => element.id === 'home-tile-managers') });
      }
      if (w.__repair.frames.length < 180) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  return { masterWrites };
}

for (const restored of [false, true]) {
  test(`actual ${restored ? 'restored' : 'fresh'} login reveals populated Home before failed background data`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width:390, height:844 });
    if (page.context().browser()?.browserType().name() === 'chromium') {
      const session = await page.context().newCDPSession(page);
      await session.send('Emulation.setCPUThrottlingRate', { rate:4 });
    }
    await isolatedApp(page);
    await page.evaluate(restored => {
      const w = window as any;
      w.__repair.permissionDelay = 180;
      w.__repair.start(restored);
    }, restored);
    await expect(page.locator('#view-login')).toBeHidden();
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#home-tile-drive')).toBeVisible();
    await expect(page.locator('#home-tile-managers')).toBeVisible();
    await page.waitForFunction(() => (window as any).__repair.frames.length >= 4);
    const firstFrames = await page.evaluate(() => {
      const state = (window as any).__repair;
      return { frames:state.frames, accessResolvedAt:state.accessResolvedAt, loginError:state.loginError };
    });
    expect(firstFrames.loginError).toBeUndefined();
    expect(firstFrames.frames.every((frame: any) => frame.count > 0)).toBe(true);
    expect(firstFrames.frames[0].at - firstFrames.accessResolvedAt).toBeLessThan(1000);
    await page.waitForFunction(() => !!(window as any).__repair.controls.loadEvalWorkAssignments);
    await page.evaluate(() => {
      for (const release of Object.values((window as any).__repair.controls)) (release as Function)();
    });
    await expect.poll(() => page.evaluate(() => (window as any).__repair.loginDone)).toBe(true);
    await expect(page.locator('#view-login')).toBeHidden();
    await expect(page.locator('#home-tile-drive')).toBeVisible();
    expect(await page.evaluate(() => (window as any).__repair.snapshot().native)).toBe(true);
    const freshness = page.getByRole('button', { name:/^Data (Updating|Update Needs Attention)/ });
    await expect(freshness).toBeVisible();
    await expect(freshness).not.toContainText(/not verified|Data Current/i);
  });
}

test('module access failure stays authenticated, hides modules, and retry recovers', async ({ page }) => {
  test.setTimeout(60_000);
  await isolatedApp(page);
  await page.evaluate(async () => {
    const state = (window as any).__repair;
    await state.identity('restricted_fixture', 'sales/marketing');
    state.accessFailure = true;
    state.start();
  });
  await expect(page.locator('#view-login')).toBeHidden();
  const status = page.locator('#home-module-access-status');
  await expect(status).toBeVisible();
  await expect(status).toContainText(/signed in/i);
  await expect(page.locator('#home-dashboard-grid > button:visible, #home-rep-dashboard-grid > button:visible')).toHaveCount(0);
  await page.evaluate(() => { (window as any).__repair.accessFailure = false; });
  await status.getByRole('button', { name:'Retry access', exact:true }).click();
  await expect(status).toBeHidden();
  await expect(page.locator('#home-tile-drive')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__repair.snapshot().currentUser)).toBe('restricted_fixture');
});

test('Request-only access failure does not hide independently authorized Home modules', async ({ page }) => {
  test.setTimeout(60_000);
  await isolatedApp(page);
  await page.evaluate(() => { const state = (window as any).__repair; state.requestFailure = true; state.start(); });
  await expect(page.locator('#view-login')).toBeHidden();
  await expect(page.locator('#home-tile-drive')).toBeVisible();
  await expect(page.locator('#home-request-capability-status')).toBeVisible();
  await expect(page.locator('#home-request-capability-status')).toContainText(/retry/i);
});

test('overlapping login and old account responses cannot reopen or repaint the new account', async ({ page }) => {
  test.setTimeout(60_000);
  await isolatedApp(page);
  await page.evaluate(() => {
    const state = (window as any).__repair;
    state.permissionDelay = 600;
    state.start();
    state.start();
  });
  await expect.poll(() => page.evaluate(() => (window as any).__repair.calls.filter((name: string) => name === 'get_my_app_permissions_v1').length)).toBe(1);
  await page.evaluate(async () => {
    const state = (window as any).__repair;
    await state.identity('new_restricted_fixture', 'sales/marketing');
    state.permissionDelay = 0;
    state.start();
  });
  await expect(page.locator('#view-login')).toBeHidden();
  await expect(page.locator('#home-tile-drive')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__repair.calls.filter((name: string) => name === 'get_my_app_permissions_v1').length)).toBe(2);
  await page.waitForTimeout(750); // The old account's controlled permission response must arrive.
  const identity = await page.evaluate(() => (window as any).__repair.snapshot());
  expect(identity.currentUser).toBe('new_restricted_fixture');
  expect(identity.accessUser).toBe('new_restricted_fixture');
  expect(identity.requestUser).toBe('new_restricted_fixture');
  await expect(page.locator('#home-tile-managers')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__repair.frames.every((frame: any) => !frame.denied))).toBe(true);
});

test('logout during permission loading cannot be undone by a late login response', async ({ page }) => {
  test.setTimeout(60_000);
  await isolatedApp(page);
  await page.evaluate(() => { const state = (window as any).__repair; state.permissionDelay = 500; state.start(); });
  await expect.poll(() => page.evaluate(() => (window as any).__repair.calls.filter((name: string) => name === 'get_my_app_permissions_v1').length)).toBe(1);
  await page.evaluate(() => {
    const w = window as any;
    w.clearInMemorySessionIdentity();
    w.resetLoginUiState();
  });
  await page.waitForTimeout(650); // Deliver the controlled old permission response after logout.
  await expect(page.locator('#view-login')).toBeVisible();
  await expect(page.locator('#app-wrapper')).toBeHidden();
  expect(await page.evaluate(() => (window as any).captureLoginSessionOwnership().username)).toBe('');
  expect(await page.evaluate(() => (window as any).__repair.frames.length)).toBe(0);
});

async function preparePhotoRow(page: Page, source: 'drive' | 'av' = 'drive', role = 'ADMIN') {
  const fixture = await isolatedApp(page);
  await page.evaluate(async ({ role }) => {
    const w = window as any;
    if (role !== 'ADMIN') await w.__repair.identity('photo_worker_fixture', role);
    w.__repair.start();
  }, { role });
  await expect(page.locator('#view-login')).toBeHidden();
  await page.evaluate(({ source }) => {
    const w = window as any;
    w.ensureDatasetLoaded = async () => true;
    w.ensureViewDataForRender = () => false;
    w.ensureNativeAppSessionBridge = async () => {
      w.__repair.bridgeCalls = (w.__repair.bridgeCalls || 0) + 1;
      throw new Error('ISOLATED_LEGACY_BRIDGE_DOWN');
    };
    const year = w.getConfiguredCurrentSalesYearCode();
    const season = w.getConfiguredCurrentSeasonCode();
    const row = { UNIQUE_ID:'photo-fixture-one', ITEMCODE:'TEST.PHOTO.1', COMMONNAME:'Isolated Photo Plant', GENUSNAME:'Fixture',
      CONTSIZE:'#1', LOCATIONCODE:'A.01.001', LOTCODE:`${year}.${season}`, SEASON:season, SALESYEAR:year,
      SALEYEAR:year, SOURCE:'LD', SOURCE_TABLE:'ph_master_inventory', PTRONHAND:20, PTRAVAILABLE:20,
      ASSIGNEDTO:'photo_worker_fixture', APP_TAB_ASSIGNMENT:'season', LAST_UPDATED:'2026-09-09T12:00:00Z',
      PHOTO_LINK:'', PHOTO_NAME:'', SAVED_PHOTO_LINK:'', SAVED_PHOTO_NAME:'', SPEC:'N/A', AV_NOTE:'', MATCH:100 };
    const other = { ...row, UNIQUE_ID:'photo-fixture-two', ITEMCODE:'TEST.PHOTO.2', COMMONNAME:'Different Fixture Plant', LOCATIONCODE:'B.02.001' };
    w.__repair.photoRows = [row, other];
    w.__repair.savedRows = Object.fromEntries([row, other].map(item => [item.UNIQUE_ID,
      Object.fromEntries(Object.entries(item).map(([key, value]) => [key.toLowerCase(), value]))]));
    w.__repair.uploads = [];
    w.__repair.saves = [];
    const scheduleHydration = w.scheduleDeferredDetailHydration;
    w.scheduleDeferredDetailHydration = (token: number, delay: number) => {
      w.__repair.detailHydrationToken = token;
      return scheduleHydration(token, delay);
    };
    const previousRpc = w.supabaseRpc;
    w.supabaseRpc = async (operation: string, payload: any) => {
      if (operation !== 'save_drive_evidence_v2') return previousRpc(operation, payload);
      w.__repair.saves.push(structuredClone(payload));
      if (w.__repair.holdSave) await new Promise(resolve => { w.__repair.releaseSave = resolve; });
      if (w.__repair.failSave || !navigator.onLine) throw Object.assign(new Error('ISOLATED_SAVE_UNAVAILABLE'), { status:503 });
      const row = w.__repair.savedRows[payload.p_master_uid];
      if (w.__repair.conflictSave) return { ok:false, code:'DRIVE_FIELD_CONFLICT', conflictFields:['photo_link'], row:structuredClone(row) };
      Object.assign(row, payload.p_evidence, { last_updated:'2026-09-09T12:05:00Z' });
      return { ok:true, code:'SAVED', canonicalConfirmed:true, row:structuredClone(row), requestRows:[] };
    };
    w.postAppFunctionFormData = async (_url: string, form: FormData) => {
      const upload = { contract:form.get('uploadContract'), name:form.get('fileName'),
        fileType:(form.get('file') as File).type, bytes:(form.get('file') as File).size,
        thumb144:!!form.get('thumbnail144'), thumb320:!!form.get('thumbnail320') };
      w.__repair.uploads.push(upload);
      if (w.__repair.holdUpload) await new Promise(resolve => { w.__repair.releaseUpload = resolve; });
      const publicUrl = `https://photo-fixture.invalid/storage/v1/object/public/plant_photos/v2/${'a'.repeat(63)}${w.__repair.uploads.indexOf(upload) + 1}.webp`;
      return { ok:true, publicUrl, fileName:upload.name, contentType:upload.fileType };
    };
    w.__repair.open = (uid = 'photo-fixture-one', view = source) => {
      w.openDetail(uid, view);
      w.switchDetailTab('notes', { suppressScroll:true });
    };
    w.__repair.reloadCanonical = () => {
      w.processAndLoadData({ data:w.formatFetchedRows(Object.values(w.__repair.savedRows), 'ph_master_inventory'), _fromCache:true });
      w.__repair.open();
    };
    w.processAndLoadData({ data:[row, other], avOpenData:[row, other], _fromCache:true });
    w.hydrateDatasetLoadState({ master:{initialLoaded:true, fullLoaded:true}, avOpen:{initialLoaded:true, fullLoaded:true},
      avNotes:{initialLoaded:true, fullLoaded:true} });
    w.__repair.open();
  }, { source });
  await expect(page.locator('#view-detail')).toBeVisible();
  return fixture;
}

async function selectGeneratedPhoto(page: Page, count = 1) {
  // Real browser-generated PNG enters the same file input used by the camera;
  // the production optimizer must convert it before the mocked upload boundary.
  await expect(page.locator('#task-detail-camera-quick')).toBeVisible();
  await page.locator('#camera-btn-na input[type=file]').evaluate(async (element, count) => {
    const canvas = document.createElement('canvas'); canvas.width = 60; canvas.height = 40;
    const context = canvas.getContext('2d')!;
    const transfer = new DataTransfer();
    for (let index = 0; index < count; index++) {
      context.fillStyle = index % 2 ? '#64a583' : '#1b7855'; context.fillRect(0, 0, 60, 40);
      const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
      transfer.items.add(new File([blob], `fixture-${index}.png`, {type:'image/png'}));
    }
    (element as HTMLInputElement).files = transfer.files;
    element.dispatchEvent(new Event('change', {bubbles:true}));
  }, count);
}

for (const source of ['drive', 'av'] as const) {
  test(`${source} photo-only upload waits for canonical save and survives reopen without a legacy bridge`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width:390, height:844 });
    const fixture = await preparePhotoRow(page, source);
    await expect(page.locator('#camera-btn-na input[type=file]')).toBeEnabled();
    if (source === 'av') await expect(page.locator('#na-av-note')).toBeDisabled();
    await page.evaluate(() => { (window as any).__repair.holdSave = true; });
    await selectGeneratedPhoto(page);
    await expect.poll(() => page.evaluate(() => (window as any).__repair.saves.length)).toBe(1);
    const pending = await page.evaluate(() => {
      const state = (window as any).__repair;
      return { upload:state.uploads[0], save:state.saves[0], canonical:state.savedRows['photo-fixture-one'].photo_link,
        toasts:state.toasts, bridgeCalls:state.bridgeCalls || 0 };
    });
    expect(pending.canonical).toBe('');
    expect(pending.save.p_baseline.photo_link).toBe('');
    expect(pending.save.p_evidence.photo_link).toContain('/v2/');
    expect(pending.upload.contract).toBe('plant-photo-v2');
    expect(['image/webp', 'image/jpeg']).toContain(pending.upload.fileType);
    expect(pending.upload.thumb144 && pending.upload.thumb320).toBe(true);
    expect(pending.bridgeCalls).toBe(0);
    expect(pending.toasts.some((toast: any) => /photo saved/i.test(toast.title))).toBe(false);
    await expect(page.locator('#na-photo-save-state')).toBeVisible();
    await expect(page.locator('#na-photo-save-state')).toContainText(/Saving Photo/i);
    await page.evaluate(() => { const state = (window as any).__repair; state.holdSave = false; state.releaseSave(); });
    await expect.poll(() => page.evaluate(() => (window as any).__repair.savedRows['photo-fixture-one'].photo_link)).toContain('/v2/');
    await page.evaluate(() => (window as any).__repair.reloadCanonical());
    await expect.poll(() => page.evaluate(() => (window as any).getDetailPhotoUrls((window as any).getEditableDetailItemForPrefix('na-'), 'drive').length)).toBe(1);
    expect(fixture.masterWrites).toEqual([]);
  });
}

test('failed photo save retains uploaded URL and Retry does not upload the file again', async ({ page }) => {
  test.setTimeout(60_000);
  const fixture = await preparePhotoRow(page);
  await page.evaluate(() => { (window as any).__repair.failSave = true; });
  await selectGeneratedPhoto(page);
  const retry = page.locator('[data-drive-photo-retry="na-"]');
  await expect(retry).toBeVisible({ timeout:15000 });
  expect(await page.evaluate(() => (window as any).__repair.uploads.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__repair.savedRows['photo-fixture-one'].photo_link)).toBe('');
  await page.evaluate(() => { (window as any).__repair.failSave = false; });
  await retry.click();
  await expect.poll(() => page.evaluate(() => (window as any).__repair.savedRows['photo-fixture-one'].photo_link)).toContain('/v2/');
  expect(await page.evaluate(() => (window as any).__repair.uploads.length)).toBe(1);
  expect(fixture.masterWrites).toEqual([]);
});

test('navigation during an upload cannot attach that photo to a different row', async ({ page }) => {
  test.setTimeout(60_000);
  const fixture = await preparePhotoRow(page);
  await page.evaluate(() => { (window as any).__repair.holdUpload = true; });
  await selectGeneratedPhoto(page);
  await expect.poll(() => page.evaluate(() => (window as any).__repair.uploads.length)).toBe(1);
  await page.evaluate(() => {
    const state = (window as any).__repair;
    state.open('photo-fixture-two', 'drive');
    state.holdUpload = false; state.releaseUpload();
  });
  await expect.poll(() => page.evaluate(() => (window as any).__repair.savedRows['photo-fixture-one'].photo_link)).toContain('/v2/');
  const saved = await page.evaluate(() => {
    const w = window as any;
    return { second:w.__repair.savedRows['photo-fixture-two'].photo_link,
      ids:w.__repair.saves.map((save: any) => save.p_master_uid),
      active:w.getEditableDetailItemForPrefix('na-').UNIQUE_ID };
  });
  expect(saved.second).toBe('');
  expect(saved.ids.every((uid: string) => uid === 'photo-fixture-one')).toBe(true);
  expect(saved.active).toBe('photo-fixture-two');
  expect(fixture.masterWrites).toEqual([]);
});

test('logout during upload prevents its late completion from saving under another session', async ({ page }) => {
  const fixture = await preparePhotoRow(page);
  await page.evaluate(() => { (window as any).__repair.holdUpload = true; });
  await selectGeneratedPhoto(page);
  await expect.poll(() => page.evaluate(() => (window as any).__repair.uploads.length)).toBe(1);
  await page.evaluate(() => {
    const w = window as any;
    w.clearInMemorySessionIdentity(); w.resetLoginUiState();
    w.__repair.holdUpload = false; w.__repair.releaseUpload();
  });
  await page.waitForTimeout(1200); // Release and settle the controlled late upload response.
  await expect(page.locator('#view-login')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__repair.saves.length)).toBe(0);
  expect(await page.evaluate(() => (window as any).__repair.savedRows['photo-fixture-one'].photo_link)).toBe('');
  expect(fixture.masterWrites).toEqual([]);
});

test('offline after upload retains the photo for a confirmed no-reupload retry', async ({ page, context }) => {
  const fixture = await preparePhotoRow(page);
  await page.evaluate(() => { (window as any).__repair.holdUpload = true; });
  await selectGeneratedPhoto(page);
  await expect.poll(() => page.evaluate(() => (window as any).__repair.uploads.length)).toBe(1);
  await context.setOffline(true);
  try {
    await page.evaluate(() => { const state = (window as any).__repair; state.holdUpload = false; state.releaseUpload(); });
    await expect(page.locator('[data-drive-photo-retry="na-"]')).toBeVisible({ timeout:15000 });
    expect(await page.evaluate(() => (window as any).__repair.savedRows['photo-fixture-one'].photo_link)).toBe('');
  } finally {
    await context.setOffline(false);
  }
  await page.locator('[data-drive-photo-retry="na-"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).__repair.savedRows['photo-fixture-one'].photo_link)).toContain('/v2/');
  expect(await page.evaluate(() => (window as any).__repair.uploads.length)).toBe(1);
  expect(fixture.masterWrites).toEqual([]);
});

test('Drive saves multiple photos while preserving entered AV note data', async ({ page }) => {
  test.setTimeout(60_000);
  const fixture = await preparePhotoRow(page);
  await page.locator('#na-av-note').fill('FRESH GROWTH');
  await expect(page.locator('#na-av-note')).toHaveValue('FRESH GROWTH');
  await page.evaluate(async () => { await (window as any).saveData(false, 'na-', true); });
  await expect.poll(() => page.evaluate(() => (window as any).__repair.savedRows['photo-fixture-one'].av_note)).toBe('FRESH GROWTH');
  await selectGeneratedPhoto(page, 2);
  await expect.poll(() => page.evaluate(() => String((window as any).__repair.savedRows['photo-fixture-one'].photo_link).split(',').filter(Boolean).length)).toBe(2);
  await page.evaluate(() => (window as any).__repair.reloadCanonical());
  await expect(page.locator('#na-av-note')).toHaveValue('FRESH GROWTH');
  expect(await page.evaluate(() => (window as any).__repair.uploads.length)).toBe(2);
  expect(fixture.masterWrites).toEqual([]);
});

test('late detail hydration preserves typed AV Note and cursor before its protected save', async ({ page }) => {
  const fixture = await preparePhotoRow(page);
  const field = page.locator('#na-av-note');
  const hydration = await field.evaluate(element => {
    const w = window as any;
    const input = element as HTMLInputElement;
    const spec = document.getElementById('na-spec') as HTMLInputElement;
    // Both input events and the late hydration occur before the 340ms autosave.
    // Keeping them in one browser task reproduces the fast hosted-WebKit race
    // without adding sleeps or depending on Playwright transport latency.
    spec.focus(); spec.value = '24-30 H'; spec.dispatchEvent(new Event('input', { bubbles:true }));
    input.focus(); input.value = 'FRESH GROWTH'; input.dispatchEvent(new Event('input', { bubbles:true }));
    input.setSelectionRange(5, 5);
    const before = input.value;
    const baseline = w.__repair.savedRows['photo-fixture-one'].av_note;
    const ran = w.runDeferredDetailHydration(w.__repair.detailHydrationToken);
    return { before, ran, after:input.value, focused:document.activeElement === input,
      start:input.selectionStart, end:input.selectionEnd, spec:spec.value, baseline,
      canonicalAv:w.getEditableDetailItemForPrefix('na-').AV_NOTE };
  });
  expect(hydration).toEqual({ before:'FRESH GROWTH', ran:true, after:'FRESH GROWTH', focused:true,
    start:5, end:5, spec:'24-30 H', baseline:'', canonicalAv:'' });
  await page.evaluate(async () => { await (window as any).saveData(false, 'na-', true); });
  await expect.poll(() => page.evaluate(() => (window as any).__repair.savedRows['photo-fixture-one'].av_note)).toBe('FRESH GROWTH');
  expect(await page.evaluate(() => (window as any).__repair.saves[0].p_baseline.av_note)).toBe('');
  expect(await page.evaluate(() => (window as any).__repair.savedRows['photo-fixture-one'].spec)).toBe('24-30 H');
  expect(fixture.masterWrites).toEqual([]);
});

test('same-field photo conflict keeps the draft and stops background retries', async ({ page }) => {
  test.setTimeout(60_000);
  const fixture = await preparePhotoRow(page);
  await page.evaluate(() => { (window as any).__repair.conflictSave = true; });
  await selectGeneratedPhoto(page);
  await expect(page.locator('[data-drive-photo-retry="na-"]')).toContainText('Review');
  await page.waitForTimeout(1200); // Longer than the coordinator's bounded network retry delay.
  const state = await page.evaluate(() => {
    const w = window as any;
    const draft = w.getDrivePhotoDraft(w.getEditableDetailItemForPrefix('na-'));
    return { saves:w.__repair.saves.length, uploads:w.__repair.uploads.length, canonical:w.__repair.savedRows['photo-fixture-one'].photo_link,
      draftUrls:draft.entries.filter((entry: any) => !!entry.publicUrl).length };
  });
  expect(state).toEqual({ saves:1, uploads:1, canonical:'', draftUrls:1 });
  expect(fixture.masterWrites).toEqual([]);
});

test('AV does not expose photo editing to a role denied equivalent Drive editing', async ({ page }) => {
  test.setTimeout(60_000);
  const fixture = await preparePhotoRow(page, 'av', 'REP');
  await expect(page.locator('#task-detail-camera-quick')).toBeHidden();
  await expect(page.locator('#camera-btn-na input[type=file]')).toBeDisabled();
  const allowed = await page.evaluate(() => {
    const w = window as any;
    const row = w.getEditableDetailItemForPrefix('na-');
    return w.canUploadRowPhoto('na-', row);
  });
  expect(allowed).toBe(false);
  expect(await page.evaluate(() => (window as any).__repair.uploads.length)).toBe(0);
  expect(fixture.masterWrites).toEqual([]);
});

test('a second isolated client sees the saved photo from canonical data, not the first client draft', async ({ page, browser }) => {
  test.setTimeout(60_000);
  await preparePhotoRow(page);
  await selectGeneratedPhoto(page);
  await expect.poll(() => page.evaluate(() => (window as any).__repair.savedRows['photo-fixture-one'].photo_link)).toContain('/v2/');
  const canonical = await page.evaluate(() => (window as any).__repair.savedRows);
  const context = await browser.newContext({ baseURL:String(test.info().project.use.baseURL), serviceWorkers:'block' });
  try {
    const second = await context.newPage();
    await preparePhotoRow(second);
    await second.evaluate(rows => {
      const state = (window as any).__repair;
      state.savedRows = rows;
      state.reloadCanonical();
    }, canonical);
    const evidence = await second.evaluate(() => {
      const w = window as any;
      const row = w.getEditableDetailItemForPrefix('na-');
      return { photos:w.getDetailPhotoUrls(row, 'drive').length, draft:!!w.getDrivePhotoDraft(row), uploads:w.__repair.uploads.length };
    });
    expect(evidence).toEqual({ photos:1, draft:false, uploads:0 });
  } finally {
    await context.close();
  }
});
