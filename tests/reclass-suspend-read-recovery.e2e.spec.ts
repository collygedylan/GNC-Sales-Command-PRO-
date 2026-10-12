import { expect, test } from '@playwright/test';

import { renderDriveLayoutCard } from './fixtures/drive-card-layout';
import { hlMaster, installHlOrderFixture } from './fixtures/hl-order-state.mjs';

const reclassPermissions = [
  { permissionKey: 'module.po-management.view', kind: 'module', moduleKey: 'po-management', allowed: true },
  { permissionKey: 'drive.reclass.submit', kind: 'action', moduleKey: 'drive', allowed: true },
];

function corsHeaders(origin: string) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, idempotency-key',
    'access-control-allow-methods': 'POST, OPTIONS',
  };
}

test('Reclass group lookup retries after a failed scoped read even when global master looks complete', { tag: ['@suspend-tag'] }, async ({ page, baseURL }, info) => {
  const control = await installHlOrderFixture(page, baseURL!, {
    role: 'ADMIN', username: 'dylan_collyge', appPermissions: reclassPermissions,
    master: [hlMaster('drive-layout-synthetic-1-no-photo', {
      itemcode: 'LAYOUT.001-NO-PHOTO', commonname: 'Synthetic Drive Card', locationcode: 'A.01.001', lotcode: '27.F1',
      season: 'F1', saleyear: '27', ptronhand: '25', ptrreviewed: '2', ptravailable: '13', priority: '2',
      last_updated: '2026-10-12T10:00:00Z',
    })],
  });
  await renderDriveLayoutCard(page, { theme: 'light', knownQuantities: true }, control);
  const sibling = hlMaster('drive-layout-sibling-2', {
    itemcode: 'LAYOUT.001-NO-PHOTO', commonname: 'Synthetic Drive Card', locationcode: 'B.02.002', lotcode: '27.F1',
    season: 'F1', saleyear: '27', ptronhand: '8', ptrreviewed: '0', ptravailable: '8', priority: '2',
    last_updated: '2026-10-12T10:00:00Z',
  });
  control.master.push(sibling);
  await page.evaluate(() => {
    const state = getDatasetState('master');
    state.fullLoaded = true;
    state.fieldCoverage = 'browse';
    productionLiveSyncVerifiedView = '';
    rebuildMasterInventoryIndexes();
  });

  const lookupRequests: Record<string, unknown>[] = [];
  let failLookups = true;
  await page.route('**/functions/v1/app-api', async route => {
    const request = route.request();
    if (request.method() !== 'POST') return route.fallback();
    let body: Record<string, any>;
    try { body = request.postDataJSON(); } catch { return route.fallback(); }
    if (body.action === 'inventory_read' && body.operation === 'master_page'
      && body.params?.dataset === 'lookup' && body.params?.projection === 'full') {
      lookupRequests.push(body.params);
      if (failLookups) {
        return route.fulfill({ status: 503, contentType: 'application/json',
          headers: corsHeaders(new URL(baseURL!).origin), body: JSON.stringify({ ok: false, error: 'Synthetic scoped lookup outage' }) });
      }
    }
    return route.fallback();
  });

  const reclassButton = page.locator('#drive-content .app-drive-card-reclass .app-card-bottom-btn');
  await reclassButton.click();
  await expect(page.locator('#toast-notification')).toContainText('Item Inquiry Unavailable');
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeHidden();
  expect(lookupRequests.length).toBeGreaterThan(0);
  failLookups = false;

  await reclassButton.click();
  await expect(page.locator('#argos-inventory-transaction-modal')).toBeVisible();
  await expect(page.locator('[data-reclass-row-card="drive-layout-synthetic-1-no-photo"]')).toBeVisible();
  await expect(page.locator('[data-reclass-row-card="drive-layout-sibling-2"]')).toBeVisible();
  expect(lookupRequests.length).toBeGreaterThanOrEqual(2);
  expect(lookupRequests.every(params => params.itemCode === 'LAYOUT.001-NO-PHOTO')).toBe(true);
  expect(control.blockedMutations).toEqual([]);
});

test('Suspend Tag photo queue stays available without whole-view proof and retains its blob when save fails', { tag: ['@suspend-tag'] }, async ({ page, baseURL }) => {
  const control = await installHlOrderFixture(page, baseURL!, {
    role: 'ADMIN', username: 'dylan_collyge',
  });
  await page.evaluate(() => switchView('docks'));
  const source = {
    unique_id: 'soc-photo-9', last_updated: '2026-10-12T10:00:00Z',
    suspend_tag_version: 3, suspend_tag_status: 'pending',
    SUSPEND: 'SUSPEND', SUSPEND_TO: 'DC',
    DOCK_PHOTO_LINK: 'old-source.jpg', dock_photo_link: 'old-source.jpg',
    DOCK_PHOTO_NAME: 'old-source.jpg', dock_photo_name: 'old-source.jpg',
    dock_note: 'preserve server note', dock_spec: 'preserve server spec', sales_note: 'preserve draft',
  };
  const mirror = {
    UNIQUE_ID: 'dock_suspend_dc-soc-photo-9', unique_id: 'dock_suspend_dc-soc-photo-9',
    DOCK_SUSPEND_SOURCE_UID: 'soc-photo-9', DOCK_SUSPEND_DC_REQUEST: true,
    SOURCE_TABLE: 'ph_soc_master', REQUEST_SOURCE: 'docks', REQ_PHOTO_LINK: 'old-source.jpg',
    REQUEST_PHOTO_LINK: 'old-source.jpg', REQ_PHOTO_NAME: 'old-source.jpg',
  };
  await page.evaluate(({ sourceRow, mirrorRow }) => {
    (window as any).__suspendPhotoSourceFixture = sourceRow;
    (window as any).__suspendPhotoMirrorFixture = mirrorRow;
    socInventory = [sourceRow];
    suspendTagInventory = [sourceRow];
    suspendTagInventoryScope = getSupabaseReadIdentityScope();
    requestsInventory = [mirrorRow];
    productionLiveSyncVerifiedView = '';
  }, { sourceRow: source, mirrorRow: mirror });
  expect(await page.evaluate(() => ({
    syncAvailable: canUseProductionLiveSync(),
    wholeViewProof: hasCurrentProductionLiveSyncProof(),
  }))).toEqual({ syncAvailable: true, wholeViewProof: false });

  const calls: { action: string; operation: string; authorized: boolean }[] = [];
  let releaseRows!: () => void;
  let rowsStarted!: () => void;
  const rowsGate = new Promise(resolve => { rowsStarted = () => resolve(undefined); });
  let firstRows = true;
  let successfulSave = false;
  let uploadedPhotoCount = 0;
  await page.route('**/functions/v1/app-api', async route => {
    const request = route.request();
    const origin = new URL(baseURL!).origin;
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders(origin) });
    if (request.method() !== 'POST') return route.fallback();
    const headers = request.headers();
    const authorized = Boolean(headers.authorization || headers['x-gnc-session']);
    const reply = (status: number, payload: unknown) => route.fulfill({ status, contentType: 'application/json',
      headers: corsHeaders(origin), body: JSON.stringify(payload) });
    if (request.headers()['content-type']?.includes('multipart/form-data')) {
      calls.push({ action: 'photo_upload', operation: 'upload', authorized });
      uploadedPhotoCount += 1;
      return reply(200, { ok: true, publicUrl: `https://example.test/photos/new-photo-${uploadedPhotoCount}.jpg`,
        filePath: `2026-10-12/new-photo-${uploadedPhotoCount}.jpg`, bucketName: 'request_photos' });
    }
    let body: Record<string, any>;
    try { body = request.postDataJSON(); } catch { return route.fallback(); }
    if (body.action === 'suspend_tag' && body.operation === 'rows') {
      calls.push({ action: body.action, operation: body.operation, authorized });
      if (firstRows) {
        firstRows = false;
        rowsStarted();
        await new Promise(resolve => { releaseRows = () => resolve(undefined); });
      }
      return reply(200, { ok: true, data: { rows: [source] } });
    }
    if (body.action === 'suspend_tag' && body.operation === 'save') {
      calls.push({ action: body.action, operation: body.operation, authorized });
      expect(Object.keys(body.payload?.patch || {}).sort()).toEqual(['dock_photo_link', 'dock_photo_name']);
      if (!successfulSave) return reply(503, { ok: false, error: 'Synthetic save outage' });
      return reply(200, { ok: true, data: { ok: true, row: {
        ...source, ...body.payload.patch, unique_id: 'soc-photo-9', suspend_tag_version: 3,
        suspend_tag_status: 'pending', last_updated: '2026-10-12T10:00:00Z',
      } } });
    }
    return route.fallback();
  });

  const queued = await page.evaluate(({ sourceRow, mirrorRow }) => {
    (window as any).__suspendPhotoSourceFixture = sourceRow;
    (window as any).__suspendPhotoMirrorFixture = mirrorRow;
    socInventory = [sourceRow];
    suspendTagInventory = [sourceRow];
    suspendTagInventoryScope = getSupabaseReadIdentityScope();
    requestsInventory = [mirrorRow];
    window.createImageBitmap = async () => ({ width: 1, height: 1, close() {} }) as any;
    window.optimizePhotoBlobForUpload = async (blob: Blob) => ({
      blob, thumbnail144Blob: blob, thumbnail320Blob: blob,
      width: 1, height: 1, thumbnail144Width: 1, thumbnail144Height: 1,
      thumbnail320Width: 1, thumbnail320Height: 1, contentType: 'image/jpeg', fileName: 'new-photo.jpg',
    }) as any;
    const file = new File([new Uint8Array([1, 2, 3])], 'new-photo.jpg', { type: 'image/jpeg' });
    return { queued: queueRowPhotoUpload(mirrorRow, 'req-', file), beforePhoto: sourceRow.dock_photo_link };
  }, { sourceRow: source, mirrorRow: mirror });
  expect(queued.queued).toBe(true);
  expect(queued.beforePhoto).toBe('old-source.jpg');
  await rowsGate;
  const pendingDuringRead = await page.evaluate(async () => ({
    blobs: (await getAllIndexedDbRecords(REQUEST_BLOB_STORE)).filter(record => record.requestId === 'dock_suspend_dc-soc-photo-9').length,
    registered: getPendingPhotoUploadsForItem(requestsInventory[0], 'req-').length,
  }));
  expect(pendingDuringRead).toEqual({ blobs: 1, registered: 1 });
  releaseRows();

  await expect(page.locator('#toast-notification')).toContainText('Photo Upload Failed', { timeout: 20_000 });
  expect(calls.map(call => `${call.action}:${call.operation}`)).toEqual([
    'suspend_tag:rows', 'photo_upload:upload', 'suspend_tag:rows', 'suspend_tag:save',
  ]);
  expect(calls.every(call => call.authorized)).toBe(true);
  const retained = await page.evaluate(async () => ({
    blobs: (await getAllIndexedDbRecords(REQUEST_BLOB_STORE)).filter(record => record.requestId === 'dock_suspend_dc-soc-photo-9').length,
    source: (() => {
      const row = (window as any).__suspendPhotoSourceFixture;
      return row && {
        photo: row.dock_photo_link ?? row.DOCK_PHOTO_LINK,
        note: row.dock_note ?? row.DOCK_NOTE,
        spec: row.dock_spec ?? row.DOCK_SPEC,
        sales: row.sales_note ?? row.SALES_NOTE,
      };
    })(),
    mirror: (window as any).__suspendPhotoMirrorFixture,
  }));
  expect(retained.blobs).toBe(1);
  expect(retained.source.photo).toBe('old-source.jpg');
  expect(retained.source.note).toBe('preserve server note');
  expect(retained.source.spec).toBe('preserve server spec');
  expect(retained.source.sales).toBe('preserve draft');
  expect(retained.mirror.REQ_PHOTO_LINK).toBe('old-source.jpg');
  expect(control.blockedMutations).toEqual([]);

  successfulSave = true;
  const retryQueued = await page.evaluate(() => {
    const mirrorRow = requestsInventory[0];
    const file = new File([new Uint8Array([4, 5, 6])], 'new-photo-retry.jpg', { type: 'image/jpeg' });
    return queueRowPhotoUpload(mirrorRow, 'req-', file);
  });
  expect(retryQueued).toBe(true);
  await expect.poll(() => calls.length, { timeout: 20_000 }).toBe(8);
  await expect.poll(() => page.evaluate(async () => (await getAllIndexedDbRecords(REQUEST_BLOB_STORE))
    .filter(record => record.requestId === 'dock_suspend_dc-soc-photo-9').length), { timeout: 20_000 }).toBe(1);
  const afterAcknowledgedRetry = await page.evaluate(() => ({
    photo: (window as any).__suspendPhotoMirrorFixture.REQ_PHOTO_LINK,
    note: (window as any).__suspendPhotoSourceFixture.dock_note,
    spec: (window as any).__suspendPhotoSourceFixture.dock_spec,
    sales: (window as any).__suspendPhotoSourceFixture.sales_note,
  }));
  expect(afterAcknowledgedRetry.photo).toContain('new-photo-2.jpg');
  expect(afterAcknowledgedRetry.note).toBe('preserve server note');
  expect(afterAcknowledgedRetry.spec).toBe('preserve server spec');
  expect(afterAcknowledgedRetry.sales).toBe('preserve draft');
});
