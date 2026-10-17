import { expect, test } from '@playwright/test';
// @test-group: @suspend-tag,suspend

import { renderDriveLayoutCard, settleDriveLayoutShell } from './fixtures/drive-card-layout';
import { hlMaster, installHlOrderFixture } from './fixtures/hl-order-state.mjs';
import { waitForInitialHomeCohort, waitForVerifiedLiveCohort } from './helpers/initial-home-cohort.mjs';

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
  await settleDriveLayoutShell(page, info.project.name);
  await waitForInitialHomeCohort(() => page.evaluate(() => {
    const context = getProductionLiveSyncContext();
    const status = getProductionLiveSyncCoordinator().getStatus();
    return { ready: hasAppliedInitialHomeView === true && status.state === 'Up to date'
      && hasCurrentProductionLiveSyncProof(), status, view: context.view };
  }));
  await renderDriveLayoutCard(page, { theme: 'light', knownQuantities: true }, control);
  await waitForVerifiedLiveCohort(() => page.evaluate(() => {
    const context = getProductionLiveSyncContext();
    const status = getProductionLiveSyncCoordinator().getStatus();
    return { ready: context.view === 'drive' && status.state === 'Up to date'
      && hasCurrentProductionLiveSyncProof(), status, view: context.view };
  }), { label: 'Drive' });
  await control.waitForRevisionIdle();
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
  await page.evaluate(() => window.eval(`(() => {
    const original = loadArgosItemInquiryRows;
    window.__scopedReadRecovery = [];
    loadArgosItemInquiryRows = async function(...args) {
      const event = { generation: productionLiveSyncReadGeneration, view: getCurrentVisibleViewId(), outcome: 'pending' };
      window.__scopedReadRecovery.push(event);
      try { const result = await original.apply(this, args); event.outcome = 'complete'; return result; }
      catch (error) { Object.assign(event, { outcome: 'error', code: error?.code || error?.name, message: error?.message }); throw error; }
      finally { event.finalGeneration = productionLiveSyncReadGeneration; event.finalView = getCurrentVisibleViewId(); }
    };
  })()`));
  await reclassButton.click();
  await expect.poll(() => lookupRequests.length, { message: 'the scoped full read must reach the injected outage' }).toBeGreaterThan(0);
  try { await expect(page.locator('#toast-notification')).toContainText('Item Inquiry Unavailable'); }
  catch (error) {
    await info.attach('scoped-read-recovery.json', { contentType: 'application/json',
      body: JSON.stringify({ lookups: lookupRequests.length,
        reads: await page.evaluate(() => (window as any).__scopedReadRecovery) }) });
    throw error;
  }
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

test('Suspend Tag photo queue stays available without whole-view proof and retains its blob when save fails', { tag: ['@suspend-tag'] }, async ({ page, baseURL }, info) => {
  const control = await installHlOrderFixture(page, baseURL!, {
    role: 'ADMIN', username: 'dylan_collyge',
  });
  await settleDriveLayoutShell(page, info.project.name);
  await waitForInitialHomeCohort(() => page.evaluate(() => {
    const status = getProductionLiveSyncCoordinator().getStatus();
    return { ready: hasAppliedInitialHomeView === true && status.state === 'Up to date'
      && hasCurrentProductionLiveSyncProof(), status };
  }));
  await page.evaluate(() => switchView('docks'));
  await waitForVerifiedLiveCohort(() => page.evaluate(() => {
    const context = getProductionLiveSyncContext();
    const status = getProductionLiveSyncCoordinator().getStatus();
    return { ready: context.view === 'docks' && status.state === 'Up to date'
      && hasCurrentProductionLiveSyncProof(), status };
  }), { label: 'Docks' });
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
    LAST_UPDATED: source.last_updated, SUSPEND_TAG_VERSION: source.suspend_tag_version,
    SUSPEND_TAG_STATUS: source.suspend_tag_status,
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

  await page.evaluate(() => {
    const root = window as any;
    const probe: any = root.__suspendPhotoReadProbe = { events: [], toasts: [], instrumentation: {} };
    const originalShellInteractive = root.runAfterShellInteractive;
    if (typeof originalShellInteractive === 'function') {
      probe.instrumentation.shellInteractive = true;
      root.runAfterShellInteractive = function(task: () => unknown, delayMs?: number) {
        probe.events.push({ type: 'shell-interactive-scheduled', at: performance.now(), delayMs: Number(delayMs) || 0 });
        return originalShellInteractive.call(this, () => {
          probe.events.push({ type: 'shell-interactive-start', at: performance.now(), visible: document.visibilityState, focused: document.hasFocus() });
          return task();
        }, delayMs);
      };
    }
    const originalSchedule = root.scheduleDeferredPhotoUploadStart;
    if (typeof originalSchedule === 'function') {
      probe.instrumentation.deferredScheduler = true;
      root.scheduleDeferredPhotoUploadStart = function(task: () => unknown) {
        probe.events.push({ type: 'deferred-scheduler-called', at: performance.now(), visible: document.visibilityState, focused: document.hasFocus() });
        return originalSchedule.call(this, () => {
          probe.events.push({ type: 'shell-interactive-callback-start', at: performance.now(), visible: document.visibilityState, focused: document.hasFocus() });
          return task();
        });
      };
    }
    const originalIdleCallback = root.requestIdleCallback;
    if (typeof originalIdleCallback === 'function') {
      probe.instrumentation.requestIdleCallback = true;
      root.requestIdleCallback = function(callback: (deadline: unknown) => unknown, options?: unknown) {
        probe.events.push({ type: 'idle-callback-queued', at: performance.now(), options: options || null });
        return originalIdleCallback.call(this, (deadline: unknown) => {
          probe.events.push({ type: 'idle-callback-start', at: performance.now(), visible: document.visibilityState, focused: document.hasFocus() });
          return callback(deadline);
        }, options);
      };
    }
    const originalPhotoRead = root.loadCurrentSuspendTagPhotoRow;
    if (typeof originalPhotoRead === 'function') {
      probe.instrumentation.scopedPhotoRead = true;
      root.loadCurrentSuspendTagPhotoRow = function(...args: unknown[]) {
        const mirror = args[0] as Record<string, unknown> | undefined;
        probe.events.push({ type: 'scoped-photo-read-start', at: performance.now(), sourceUid: String(mirror?.DOCK_SUSPEND_SOURCE_UID || mirror?.dock_suspend_source_uid || '') });
        const result = originalPhotoRead.apply(this, args);
        return Promise.resolve(result).then((value: unknown) => {
          probe.events.push({ type: 'scoped-photo-read-resolved', at: performance.now(), result: 'proof' });
          return value;
        }, (error: unknown) => {
          probe.events.push({ type: 'scoped-photo-read-rejected', at: performance.now(), error: String((error as Error)?.message || error).slice(0, 240) });
          throw error;
        });
      };
    }
    const originalPutRecord = root.putIndexedDbRecord;
    if (typeof originalPutRecord === 'function') {
      probe.instrumentation.indexedDbWrite = true;
      root.putIndexedDbRecord = function(storeName: string, record: any, ...args: unknown[]) {
        const isRequestBlob = storeName === REQUEST_BLOB_STORE;
        if (isRequestBlob) probe.events.push({ type: 'request-blob-write-start', at: performance.now(), hasBlob: !!record?.blob,
          fileType: String(record?.contentType || ''), requestIdPresent: !!String(record?.requestId || '') });
        const result = originalPutRecord.call(this, storeName, record, ...args);
        if (isRequestBlob && result && typeof result.then === 'function') {
          Promise.resolve(result).then(() => probe.events.push({ type: 'request-blob-write-resolved', at: performance.now() }),
            (error: unknown) => probe.events.push({ type: 'request-blob-write-rejected', at: performance.now(), error: String((error as Error)?.message || error).slice(0, 240) }));
        } else if (isRequestBlob) probe.events.push({ type: 'request-blob-write-sync-result', at: performance.now(), resultType: typeof result });
        return result;
      };
    }
    const originalObjectStorePut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value: any, key?: IDBValidKey) {
      const request = key === undefined ? originalObjectStorePut.call(this, value) : originalObjectStorePut.call(this, value, key);
      if (this.name === REQUEST_BLOB_STORE) {
        const transaction = this.transaction;
        const describeError = (error: DOMException | null | undefined) => error ? {
          name: String(error.name || '').slice(0, 100), message: String(error.message || '').slice(0, 240),
        } : null;
        probe.events.push({ type: 'request-blob-idb-put-issued', at: performance.now(),
          dbVersion: transaction.db.version, storeExists: transaction.db.objectStoreNames.contains(REQUEST_BLOB_STORE),
          mode: transaction.mode, requestReadyState: request.readyState });
        request.addEventListener('error', () => probe.events.push({ type: 'request-blob-idb-request-error', at: performance.now(),
          requestError: describeError(request.error), transactionError: describeError(transaction.error) }));
        transaction.addEventListener('error', () => probe.events.push({ type: 'request-blob-idb-transaction-error', at: performance.now(),
          transactionError: describeError(transaction.error) }));
        transaction.addEventListener('abort', () => probe.events.push({ type: 'request-blob-idb-transaction-abort', at: performance.now(),
          transactionError: describeError(transaction.error) }));
      }
      return request;
    };
    const originalShowToast = root.showToast;
    if (typeof originalShowToast === 'function') {
      probe.instrumentation.showToast = true;
      root.showToast = function(...args: unknown[]) {
        probe.toasts.push({ at: performance.now(), title: String(args[0] || '').slice(0, 100), message: String(args[1] || '').slice(0, 240), error: args[2] === true });
        return originalShowToast.apply(this, args);
      };
    }
    probe.initial = { view: getCurrentVisibleViewId(), visible: document.visibilityState, focused: document.hasFocus(),
      syncAvailable: canUseProductionLiveSync(), wholeViewProof: hasCurrentProductionLiveSyncProof(),
      scope: getSupabaseReadIdentityScope(), navigationAborted: productionLiveSyncNavigation.signal.aborted,
      coordinatorStatus: getProductionLiveSyncCoordinator().getStatus() };
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
  try {
    await expect.poll(() => calls.filter(call => call.action === 'suspend_tag' && call.operation === 'rows').length,
      { message: 'photo preparation must begin its scoped source read' }).toBe(1);
  } catch (error) {
    const diagnostics = await page.evaluate(async () => {
      const root = window as any;
      const probe = root.__suspendPhotoReadProbe || null;
      const mirrorRow = requestsInventory.find((row: any) => String(row.UNIQUE_ID || row.unique_id || '') === 'dock_suspend_dc-soc-photo-9');
      const sourceRow = (window as any).__suspendPhotoSourceFixture;
      let idbTimeout: number | undefined;
      const indexedDb = await Promise.race([
        getAllIndexedDbRecords(REQUEST_BLOB_STORE).then((records: any[]) => ({ status: 'resolved', records }), (error: unknown) => ({
          status: 'rejected', error: String((error as Error)?.message || error).slice(0, 240),
        })),
        new Promise<{ status: string; error: string }>(resolve => {
          idbTimeout = window.setTimeout(() => resolve({ status: 'timeout', error: 'IndexedDB diagnostic read exceeded 1500 ms.' }), 1500);
        }),
      ]) as { status: string; records?: any[]; error?: string };
      if (idbTimeout !== undefined) window.clearTimeout(idbTimeout);
      const blobs = indexedDb.records?.filter((record: any) => record.requestId === 'dock_suspend_dc-soc-photo-9') || [];
      const independentStorageProbe = async () => {
        const dbName = `GNC_IDB_PHOTO_DIAG_${crypto.randomUUID()}`;
        let db: IDBDatabase | null = null;
        const bounded = async <T>(promise: Promise<T>, label: string): Promise<T | { status: 'timeout'; label: string }> => Promise.race([
          promise, new Promise<{ status: 'timeout'; label: string }>(resolve => window.setTimeout(() => resolve({ status: 'timeout', label }), 1500)),
        ]);
        try {
          const openResult = await bounded(new Promise<{ status: 'opened'; db: IDBDatabase }>((resolve, reject) => {
            const request = indexedDB.open(dbName, 1);
            request.onupgradeneeded = () => request.result.createObjectStore('probe', { keyPath: 'id' });
            request.onsuccess = () => resolve({ status: 'opened', db: request.result });
            request.onerror = () => reject(request.error || new Error('diagnostic database open failed'));
          }), 'open');
          if (!('db' in openResult)) return { open: openResult };
          db = openResult.db;
          const file = new File([new Uint8Array([1, 2, 3])], 'diagnostic.jpg', { type: 'image/jpeg' });
          const values: Array<{ id: string; value: unknown }> = [
            { id: 'file', value: file }, { id: 'blob', value: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }) }, { id: 'string', value: 'diagnostic' },
          ];
          const outcomes = [] as Array<Record<string, unknown>>;
          for (const entry of values) {
            let write: unknown;
            try {
              write = await bounded(new Promise<{ status: 'written' }>((resolve, reject) => {
                const tx = db!.transaction('probe', 'readwrite');
                const request = tx.objectStore('probe').put(entry);
                request.onerror = () => reject(new Error(`write ${entry.id} request ${request.error?.name || 'UnknownRequestError'}: ${request.error?.message || 'no request error'}`));
                tx.oncomplete = () => resolve({ status: 'written' });
                tx.onabort = tx.onerror = () => reject(new Error(`write ${entry.id} transaction ${tx.error?.name || 'UnknownTransactionError'}: ${tx.error?.message || 'no transaction error'}`));
              }), `write-${entry.id}`);
            } catch (error) {
              write = { status: 'error', error: String((error as Error)?.message || error).slice(0, 240) };
            }
            if (!write || typeof write !== 'object' || (write as { status?: string }).status !== 'written') {
              outcomes.push({ id: entry.id, write });
              continue;
            }
            let read: unknown;
            try {
              read = await bounded(new Promise<{ status: 'read'; value: unknown }>((resolve, reject) => {
                const tx = db!.transaction('probe', 'readonly');
                const request = tx.objectStore('probe').get(entry.id);
                request.onsuccess = () => resolve({ status: 'read', value: request.result?.value });
                request.onerror = () => reject(request.error || new Error(`read ${entry.id} failed`));
              }), `read-${entry.id}`);
            } catch (error) {
              read = { status: 'error', error: String((error as Error)?.message || error).slice(0, 240) };
            }
            if (!read || typeof read !== 'object' || (read as { status?: string }).status !== 'read') { outcomes.push({ id: entry.id, write, read }); continue; }
            const stored = (read as { value: unknown }).value;
            outcomes.push({ id: entry.id, write, read: stored instanceof Blob ? {
              status: 'read', kind: stored instanceof File ? 'File' : 'Blob', size: stored.size, type: stored.type,
              name: stored instanceof File ? stored.name : undefined,
            } : { status: 'read', kind: typeof stored, value: String(stored || '').slice(0, 80) } });
          }
          return { databaseVersion: db.version, storeExists: db.objectStoreNames.contains('probe'), outcomes };
        } catch (error) {
          return { status: 'error', error: String((error as Error)?.message || error).slice(0, 240) };
        } finally {
          db?.close();
          try {
            await bounded(new Promise<void>(resolve => {
              const request = indexedDB.deleteDatabase(dbName);
              request.onsuccess = request.onerror = request.onblocked = () => resolve();
            }), 'delete');
          } catch { /* best-effort cleanup of isolated diagnostic database */ }
        }
      };
      const idbCapability = await independentStorageProbe();
      return { probe, view: getCurrentVisibleViewId(), visibility: document.visibilityState, focused: document.hasFocus(), online: navigator.onLine,
        scope: getSupabaseReadIdentityScope(), navigationAborted: productionLiveSyncNavigation.signal.aborted,
        syncAvailable: canUseProductionLiveSync(), wholeViewProof: hasCurrentProductionLiveSyncProof(),
        coordinatorStatus: getProductionLiveSyncCoordinator().getStatus(), mirror: mirrorRow ? {
          uid: String(mirrorRow.UNIQUE_ID || mirrorRow.unique_id || ''), sourceUid: getDockSuspendDcRequestSourceUid(mirrorRow),
          isMirror: isDockSuspendDcRequestMirrorRow(mirrorRow), canView: canCurrentUserViewDockSuspendDcRequests(),
          canWork: canCurrentUserWorkRequestItem(mirrorRow, 'photo'), pendingUploads: getPendingPhotoUploadsForItem(mirrorRow, 'req-').length,
          previewCount: getPendingPhotoPreviewEntries(mirrorRow, 'req-').length,
        } : null,
        source: sourceRow ? { uid: String(sourceRow.UNIQUE_ID || sourceRow.unique_id || ''), revision: String(sourceRow.LAST_UPDATED || sourceRow.last_updated || ''),
          version: Number(sourceRow.SUSPEND_TAG_VERSION ?? sourceRow.suspend_tag_version), status: String(sourceRow.SUSPEND_TAG_STATUS || sourceRow.suspend_tag_status || '') } : null,
        indexedDb, idbCapability, blobs: blobs.map((record: any) => ({ blobId: String(record.blobId || ''), fileName: String(record.fileName || ''), acknowledged: record.acknowledged === true })),
        schedulerState: { touchInteractionTaskCount: Object.keys((root.runAfterTouchInteractionTasks || {}) as Record<string, unknown>).length,
          pendingPhotoUploadCount: root.pendingPhotoUploads?.size || 0, shellReady: document.readyState,
          initialHomeApplied: hasAppliedInitialHomeView === true, hasRequestIdleCallback: typeof root.requestIdleCallback === 'function' },
        toastText: String(document.getElementById('toast-notification')?.innerText || '').slice(0, 500) };
    });
    await info.attach('suspend-photo-read-start-failure.json', { contentType: 'application/json', body: JSON.stringify({
      error: error instanceof Error ? error.message.slice(0, 1200) : String(error).slice(0, 1200), calls, diagnostics,
    }, null, 2) });
    throw error;
  }
  const pendingDuringRead = await page.evaluate(async () => ({
    blobs: (await getAllIndexedDbRecords(REQUEST_BLOB_STORE)).filter(record => record.requestId === 'dock_suspend_dc-soc-photo-9').length,
    // The live Docks cohort can replace the array while the scoped source
    // read is held. Assert the queue for the exact request we submitted.
    registered: getPendingPhotoUploadsForItem((window as any).__suspendPhotoMirrorFixture, 'req-').length,
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

  await expect.poll(() => page.evaluate(() => getPendingPhotoUploadsForItem(
    (window as any).__suspendPhotoMirrorFixture, 'req-').length), {
    message: 'the failed photo command must settle before retrying its durable blob',
  }).toBe(0);
  successfulSave = true;
  const retryResult = await page.evaluate(() => {
    const expectedUid = 'dock_suspend_dc-soc-photo-9';
    const expectedSourceUid = 'soc-photo-9';
    const candidates = Array.isArray(requestsInventory) ? requestsInventory : [];
    const mirrorRow = candidates.find((row: any) => String(row?.UNIQUE_ID || row?.unique_id || '') === expectedUid
      && isDockSuspendDcRequestMirrorRow(row)
      && getDockSuspendDcRequestSourceUid(row) === expectedSourceUid)
      || (window as any).__suspendPhotoMirrorFixture;
    const sourceRow = mirrorRow ? findDockSuspendDcRequestSourceRow(mirrorRow) : null;
    const pending = mirrorRow ? getPendingPhotoUploadsForItem(mirrorRow, 'req-').length : -1;
    const diagnostics = {
      view: getCurrentVisibleViewId(),
      scope: getSupabaseReadIdentityScope(),
      syncAvailable: canUseProductionLiveSync(),
      mirrorFoundInInventory: candidates.some((row: any) => row === mirrorRow),
      inventoryUids: candidates.map((row: any) => String(row?.UNIQUE_ID || row?.unique_id || '')).slice(0, 12),
      mirror: mirrorRow ? { uid: String(mirrorRow.UNIQUE_ID || mirrorRow.unique_id || ''),
        sourceUid: getDockSuspendDcRequestSourceUid(mirrorRow), isMirror: isDockSuspendDcRequestMirrorRow(mirrorRow),
        canWork: canCurrentUserWorkRequestItem(mirrorRow, 'photo'), revision: String(mirrorRow.LAST_UPDATED || mirrorRow.last_updated || ''),
        version: Number(mirrorRow.SUSPEND_TAG_VERSION ?? mirrorRow.suspend_tag_version) } : null,
      source: sourceRow ? { uid: String(sourceRow.UNIQUE_ID || sourceRow.unique_id || ''),
        revision: String(sourceRow.LAST_UPDATED || sourceRow.last_updated || ''),
        version: Number(sourceRow.SUSPEND_TAG_VERSION ?? sourceRow.suspend_tag_version) } : null,
      pendingForExactMirror: pending,
      pendingPhotoUploadCount: (window as any).pendingPhotoUploads?.size || 0,
    };
    (window as any).__suspendPhotoRetryTargetDiagnostics = diagnostics;
    const file = new File([new Uint8Array([4, 5, 6])], 'new-photo-retry.jpg', { type: 'image/jpeg' });
    return { queued: !!mirrorRow && queueRowPhotoUpload(mirrorRow, 'req-', file), diagnostics };
  });
  // The Docks coordinator may replace requestsInventory after the prior failed
  // save. Reuse only the exact logical request mirror (same source UID); the
  // next queue attempt still performs its normal fresh scoped source read.
  const retryQueued = retryResult.queued;
  if (!retryQueued) {
    await info.attach('suspend-photo-retry-target.json', { contentType: 'application/json', body: JSON.stringify(retryResult, null, 2) });
  }
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
