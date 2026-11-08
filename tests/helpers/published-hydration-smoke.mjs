import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { runPublishedReclassSmoke } from './published-reclass-smoke.mjs';
import { waitForPublishedHydration } from './release-smoke-hydration-settle.mjs';
import { waitForExactSeasonSettingsRead } from './release-smoke-settings-evidence.mjs';

const FIXTURE_USERNAMES = Object.freeze({
  'desktop-chromium': 'dylan_collyge',
  'android-chromium': 'megan_kelly',
  'iphone-webkit': 'jd_jones',
});

const COLD_DRIVE_HYDRATION = `(async () => {
  const hydrationStarted = performance.now();
  const hydrationProgress = window.__releaseSmokeHydrationProgress = [];
  const originalPrepare = prepareProductionMasterSnapshot;
  prepareProductionMasterSnapshot = async function(rows, options) {
    hydrationProgress.push({ phase: 'prepare-start', rows: rows.length, atMs: performance.now() - hydrationStarted });
    try { return await originalPrepare(rows, options); }
    finally { hydrationProgress.push({ phase: 'prepare-end', rows: rows.length, atMs: performance.now() - hydrationStarted }); }
  };
  fullInventory = []; rebuildMasterInventoryIndexes();
  Object.assign(getDatasetState('master'), { initialLoaded: false, fullLoaded: false, rowCompleteness: 'unknown', liveVerifiedScope: '' });
  activeDriveTab = 'name'; driveViewLevel = 0; selectedDriveName = '';
  window.__suspendFixtureFetchAbortContext = 'published-lkg-drive-transition';
  resetProductionLiveSync();
  showOnlyPrimaryView('drive');
  window.__suspendFixtureFetchAbortContext = '';
  let timeout;
  const coordinator = getProductionLiveSyncCoordinator();
  const settleHydration = ${waitForPublishedHydration.toString()};
  const loaded = await Promise.race([settleHydration(
    () => coordinator.check('visible-view'), () => coordinator.getStatus(),
    ms => new Promise(resolve => setTimeout(resolve, ms)),
    { timeoutMs: 119500, onAttempt: attempt => hydrationProgress.push({ phase: 'coordinator-check', ...attempt }) }),
    new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Published Drive hydration did not settle within 120 seconds')), 120000); })
  ]).finally(() => { clearTimeout(timeout); prepareProductionMasterSnapshot = originalPrepare; });
  renderDrive();
  return { loaded, rows: fullInventory.length, names: new Set(fullInventory.map(row => row.COMMONNAME)).size,
    coldHydrationMs: performance.now() - hydrationStarted,
    state: getProductionLiveSyncCoordinator().getStatus().state,
    message: getProductionLiveSyncCoordinator().getStatus().message,
    blockedSources: getProductionLiveSyncCoordinator().getStatus().blockedSources || [],
    writeProof: hasCurrentProductionLiveSyncProof() };
})()`;

const TRANSIENT_PERMISSION_REFRESH = `(async () => {
  const profileId = String(nativeAuthProfile?.id || '');
  const before = { rowCount: fullInventory.length, visibleText: document.getElementById('drive-content')?.textContent || '',
    user: currentUser, role: currentRole };
  const legacyAccessSnapshot = appAccessSnapshotState?.snapshot || null;
  const legacyAccessLoadedAt = Number(appAccessSnapshotState?.loadedAt || 0) || Date.now() - 1000;
  if (!profileId || !legacyAccessSnapshot || legacyAccessSnapshot.username !== getRequestCapabilityUsernameKey(currentUser)) {
    throw new Error('LEGACY_ACCESS_CACHE_FIXTURE_NOT_BOUND_TO_ACTIVE_IDENTITY');
  }
  nativeAuthSessionActive = true;
  nativeAuthSessionUserId = profileId;
  nativeAuthProfile = { ...nativeAuthProfile, id: profileId, username: currentUser, role: currentRole,
    disabled_at: null, must_change_password: false };
  localStorage.setItem(getAppAccessCacheKey(currentUser), JSON.stringify({ snapshot: legacyAccessSnapshot, loadedAt: legacyAccessLoadedAt }));
  appAccessSnapshotState = { status: 'idle', snapshot: null, stale: false, errorCode: '', loadedAt: 0, username: '', profileId: '' };
  appAccessSnapshotLoadPromise = null;
  nativeAuthProfileRestorePending = false;
  getNativeAuthSession = async () => ({ user: { id: profileId }, access_token: 'browser-only-no-real-session' });
  window.GncDatabase.readProfile = async (_client, id) => ({ data: { ...nativeAuthProfile, id }, error: null });
  ensureNativeAppSessionBridge = async () => null;
  let refreshError = '';
  try { await refreshNativeRoleAndCapabilities('live-permissions'); }
  catch (error) { refreshError = String(error?.message || error); }
  return { refreshError, wrapperHidden: document.getElementById('app-wrapper')?.classList.contains('hidden') || false,
    loginCurtainVisible: !!document.getElementById('live-permission-check'),
    inertElements: document.querySelectorAll('[inert]').length,
    rowCount: fullInventory.length, visibleText: document.getElementById('drive-content')?.textContent || '',
    user: currentUser, role: currentRole, profileId: nativeAuthProfile?.id || '', sessionUserId: nativeAuthSessionUserId,
    retainedAccess: hasRetainedAuthenticatedAppAccess(), managerAllowed: canAccessView('managers'),
    driveAllowed: canAccessView('drive'), requestAllowed: canAccessView('request'), docksAllowed: canAccessView('docks'),
    appAccess: { status: appAccessSnapshotState.status, stale: appAccessSnapshotState.stale,
      owner: appAccessSnapshotState.profileId, permissionVersion: appAccessSnapshotState.snapshot?.dataPermissionVersion || '' },
    legacyCacheAdopted: appAccessSnapshotState.profileId === profileId
      && appAccessSnapshotState.snapshot?.username === getRequestCapabilityUsernameKey(currentUser)
      && appAccessSnapshotState.stale === true,
    legacyCacheLoadedAt: appAccessSnapshotState.loadedAt,
    capabilities: { status: requestCapabilityState.status, stale: requestCapabilityState.stale,
      username: requestCapabilityState.username } };
})()`;

function loadPublishedSnapshot() {
  const compressed = readFileSync(new URL('../fixtures/suspend-v2314.json.gz', import.meta.url));
  return JSON.parse(gunzipSync(compressed).toString('utf8'));
}

async function settleSeededHome(page, app, info) {
  await page.bringToFront();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.eval(`(async () => {
    let timer;
    try { return await Promise.race([getProductionLiveSyncCoordinator().check('visible-view'),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Seeded Home cohort did not settle before cold Drive hydration')), 60000); })]); }
    finally { clearTimeout(timer); }
  })()`)).catch(async error => {
    await info.attach('release-smoke-seeded-cohort-diagnostic', { contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ bootstrap: await app.readBootstrapDiagnostic(),
        failedResources: app.failedResources, consoleErrors: app.consoleErrorDetails,
        publishedReadPages: app.publishedReadPages })) });
    throw error;
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForLoadState('networkidle');
}

async function hydrateColdDrive(page, app, info) {
  return page.evaluate(code => window.eval(code), COLD_DRIVE_HYDRATION).catch(async error => {
    const progress = await page.evaluate(() => window.eval(`({ phases: window.__releaseSmokeHydrationProgress || [],
      rows: fullInventory.length, view: getCurrentVisibleViewId(), status: getProductionLiveSyncCoordinator().getStatus() })`)).catch(() => null);
    await info.attach('published-lkg-failed-read-diagnostic', {
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ pages: app.publishedReadPages, settingsReads: app.settingsReads,
        failedResources: app.failedResources, consoleErrors: app.consoleErrorDetails, progress })),
    });
    throw error;
  });
}

async function verifyCompleteHydration({ page, app, info, result, snapshot }) {
  await waitForExactSeasonSettingsRead(app.settingsReads);
  await info.attach('published-lkg-initial-read-diagnostic', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
    result, expectedSeasonSettingsKey: 'current_season_salesyear', settingsReads: app.settingsReads,
    failedResources: app.failedResources, fetchAbortEvidence: await app.readFetchAbortEvidence(), pages: app.publishedReadPages,
  })) });
  expect(result.loaded).toBe(true);
  expect(result.rows).toBe(snapshot.masterRows.length);
  expect(result.names).toBe(new Set(snapshot.masterRows.map(row => row.COMMONNAME || row.commonname)).size);
  expect(result.names).toBeGreaterThan(75);
  expect(result.state).toBe('Published data');
  expect(result.writeProof).toBe(false);
  await expect(page.locator('#drive-content')).toHaveAttribute('data-drive-commonname-state', 'complete');
}

async function verifyFailOpenRefresh({ page, app, info, result, fixtureUsername }) {
  expect(await app.enableTransientPermissionFailures()).toBe(true);
  const accessRefresh = await page.evaluate(code => window.eval(code), TRANSIENT_PERMISSION_REFRESH);
  await info.attach('published-lkg-transient-permission-refresh', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
    accessRefresh, permissionRefreshFailures: app.permissionRefreshFailures,
    permissionRefreshResponses: app.permissionRefreshResponses,
    injectedPermissionRefreshConsoleErrors: app.injectedPermissionRefreshConsoleErrors,
    normalPermissionReads: app.normalPermissionReads, userAccessResolveReads: app.userAccessResolveReads,
  })) });
  expect(accessRefresh.refreshError).toMatch(/^$|permissions could not be verified|refresh is paused/i);
  expect(accessRefresh).toMatchObject({ wrapperHidden: false, loginCurtainVisible: false, inertElements: 0,
    rowCount: result.rows, user: fixtureUsername, retainedAccess: true, managerAllowed: true,
    driveAllowed: true, requestAllowed: true, docksAllowed: true, legacyCacheAdopted: true });
  expect(accessRefresh.visibleText).toBeTruthy();
  expect(accessRefresh.profileId).toBe(accessRefresh.sessionUserId);
  expect(accessRefresh.appAccess).toMatchObject({ status: 'ready', stale: true, owner: accessRefresh.profileId });
  expect(accessRefresh.legacyCacheLoadedAt).toBeGreaterThan(0);
  expect(app.permissionRefreshFailures.map(failure => failure.endpoint).sort()).toEqual([
    'get_my_app_permissions_v1', 'get_request_capabilities', 'user_access:resolve',
  ]);
  await expect(page.locator('#drive-content')).not.toContainText('Load Failed');
  await expect(page.locator('#drive-content')).not.toContainText('Data could not be verified');
}

async function openPublishedDetail({ page, info, result }) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const details = await page.evaluate(async () => window.eval(`(async () => {
    const row = fullInventory.find(row => row.ITEMCODE === '010539.030.1' && row.LOCATIONCODE === 'F.16.000' && row.LOTCODE === '27.F1');
    if (!row) throw new Error('Captured Rosy Muhly row missing');
    const locationOnHand = getCardLocationOnHandValue(row);
    const started = performance.now(); openDetail(row.UNIQUE_ID, 'drive');
    const syncMs = performance.now() - started;
    const immediateView = getCurrentVisibleViewId();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const firstFrameMs = performance.now() - started;
    await new Promise(resolve => requestAnimationFrame(resolve));
    const secondFrameMs = performance.now() - started;
    return { locationOnHand, immediateView, view: getCurrentVisibleViewId(), syncMs, firstFrameMs,
      openMs: firstFrameMs, secondFrameMs, uid: activeItem?.UNIQUE_ID };
  })()`));
  await info.attach('published-snapshot-availability', { contentType: 'application/json',
    body: Buffer.from(JSON.stringify({ ...result, details })) });
  expect(String(details.locationOnHand)).toBe('195');
  expect(Number.isFinite(Number(details.locationOnHand))).toBe(true);
  expect(details).toMatchObject({ immediateView: 'detail', view: 'detail' });
  expect(details.openMs).toBeLessThanOrEqual(2000);
  await expect(page.locator('#toast-notification')).not.toContainText('Row Details Unavailable');
  await expect(page.locator('#drive-content')).toHaveAttribute('data-drive-commonname-state', 'complete');
  return details;
}

export async function runPublishedHydrationSmoke({ page, baseURL, info, harness }) {
  test.setTimeout(240_000);
  const snapshot = loadPublishedSnapshot();
  const fixtureUsername = FIXTURE_USERNAMES[info.project.name];
  expect(fixtureUsername).toBeTruthy();
  const app = await harness(page, baseURL, [], { masterRows: snapshot.masterRows,
    published: true, username: fixtureUsername });
  await settleSeededHome(page, app, info);
  const result = await hydrateColdDrive(page, app, info);
  await verifyCompleteHydration({ page, app, info, result, snapshot });
  await verifyFailOpenRefresh({ page, app, info, result, fixtureUsername });
  const details = await openPublishedDetail({ page, info, result });
  await runPublishedReclassSmoke({ page, app, info, snapshot, fixtureUsername, details });
  await app.assertClean();
}
