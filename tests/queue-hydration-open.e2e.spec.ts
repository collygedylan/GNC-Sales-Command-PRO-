import { readFileSync } from 'node:fs';
import { expect, test, type Route } from '@playwright/test';
import { hlMaster, installHlOrderFixture } from './fixtures/hl-order-state.mjs';
// @test-group: @suspend-tag,suspend

test('direct Que → Suspend open repaints hydrated photo and evaluation evidence across normalized identities', { tag: ['@suspend-tag'] }, async ({ page, baseURL }, info) => {
  test.setTimeout(90_000);
  const photoLink = 'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/v2/2026-10-18/que-hydration-448.png';
  const master = [
    hlMaster('hydration-master-448', {
      itemcode: '004380.010.1', locationcode: 'C.09.000', lotcode: '27.F1', source: '1',
      commonname: 'Variegated Liriope', contsize: '#1', ptronhand: '89', ptrreviewed: '27', ptravailable: '62',
      photo_link: photoLink, photo_name: '2026-10-18-que-hydration-448.png',
      date_completed: '2026-10-18T12:00:00Z', spec: '6-8" H', match: '80', av_note: 'SPEC - 6-8" H', loc_match_qty: '62',
    }),
    // Same item and location, different lot: the exact identity result must not
    // take this photo/evidence in place of the requested 27.F1 row.
    hlMaster('hydration-master-wrong-lot', {
      itemcode: '004380.010.1', locationcode: 'C.09.000', lotcode: '27.F2', source: '1',
      commonname: 'Variegated Liriope', contsize: '#1', ptronhand: '888', ptrreviewed: '0', ptravailable: '888',
      photo_link: 'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/v2/2026-10-18/incorrect-lot.png',
      photo_name: '2026-10-18-incorrect-lot.png', date_completed: '2026-10-18T12:00:00Z',
      spec: 'WRONG LOT', match: '1', av_note: 'WRONG LOT NOTE', loc_match_qty: '888',
    }),
  ];
  const suspended = [{
    unique_id: 'soc-hydration-448', itemcode: '43800101', locationcode: 'c.9.0', lotcode: '27.F1',
    commonname: 'Variegated Liriope', contsize: '#1', season: 'F1', saleyear: '27', req_status: 'Pending',
    req_archived: false, req_qty: '10', quantityordered: '10', request_folder: 'Hydration', requested_by: 'dylan_collyge',
    req_customer: 'Hydration customer', customername: 'Hydration customer', consigneename: 'Hydration consignee',
    salesrepname: 'Dylan Collyge', assignedto: 'dylan_collyge', suspend_tag_version: 1, suspend_tag_status: 'pending',
    suspend: 'SUSPEND', suspend_to: 'dc', source_table: 'ph_soc_master', request_source: 'docks',
    dock_num: '30', stopnumber: '30', tripnumber: '1', planstart: '10/19/2026', last_updated: '2026-10-17T12:00:00Z',
  }];

  let releaseIdentityBatch!: () => void;
  let resolveIdentityBatchStarted!: () => void;
  const identityBatchStarted = new Promise<void>(resolve => { resolveIdentityBatchStarted = resolve; });
  const identityBatchGate = new Promise<void>(resolve => { releaseIdentityBatch = resolve; });
  let identityRequest: Record<string, unknown> | null = null;
  let holdIdentityBatch = false;
  const imageRequests: string[] = [];
  const fixture = await installHlOrderFixture(page, baseURL!, {
    master,
    demandSocRows: suspended,
    appPermissions: ['request', 'drive', 'docks', 'po-management'].map(moduleKey => ({ permissionKey: `module.${moduleKey}.view`, kind: 'module', moduleKey, allowed: true })),
    beforeNavigate: async () => {
      // Keep the 10-day photo-retention assertion stable when this fixture is
      // run later than today while browser timers continue normally.
      await page.addInitScript(epoch => {
        const NativeDate = Date;
        const startedAt = NativeDate.now();
        const now = () => epoch + NativeDate.now() - startedAt;
        class FixtureDate extends NativeDate {
          constructor(...args: ConstructorParameters<typeof Date>) {
            if (args.length === 0) super(now());
            else super(...args);
          }
          static now() { return now(); }
        }
        Object.setPrototypeOf(FixtureDate, NativeDate);
        window.Date = FixtureDate as DateConstructor;
      }, Date.parse('2026-10-18T12:00:00Z'));
      await page.route('**/storage/v1/**', async route => {
        imageRequests.push(route.request().url());
        return route.fulfill({ status: 200, contentType: 'image/png', body: readFileSync('assets/branding/ag-data-solutions-icon-v2026080925-32.png') });
      });
      await page.route('**/functions/v1/app-api', async (route: Route) => {
        const body = route.request().postDataJSON();
        if (body?.action === 'inventory_read' && body.operation === 'master_identity_batch' && holdIdentityBatch) {
          holdIdentityBatch = false;
          identityRequest = body.params as Record<string, unknown>;
          resolveIdentityBatchStarted();
          await identityBatchGate;
        }
        if (body?.action === 'dataset_read' && ['request_queue', 'active_request', 'suspend_tag'].includes(body.dataset)) {
          const params = body.params || {};
          const rows = body.dataset === 'suspend_tag' ? suspended : [];
          const offset = Number(params.offset) || 0, limit = Number(params.limit) || 500;
          return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify({ ok: true, data: { rows: rows.slice(offset, offset + limit), offset, limit, total: rows.length, hasMore: offset + limit < rows.length } }) });
        }
        return route.fallback();
      });
    },
  });
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });

  await page.locator('#footer-request-btn').click();
  await expect(page.locator('#request-content')).toBeVisible();
  await expect(page.locator('[data-request-category="suspend-tag"]')).toBeVisible();
  holdIdentityBatch = true;
  await page.locator('[data-request-category="suspend-tag"]').click();
  const card = page.locator('#request-content [data-request-uid="dock_suspend_dc_soc-hydration-448"]');
  let initialImages: string[] = [];
  let batchResponsePromise: Promise<import('@playwright/test').Response> | null = null;
  try {
    await expect(card).toBeVisible();
    await identityBatchStarted;
    batchResponsePromise = page.waitForResponse(response => response.url().includes('/functions/v1/app-api')
      && response.request().postDataJSON()?.action === 'inventory_read'
      && response.request().postDataJSON()?.operation === 'master_identity_batch');
    initialImages = await card.locator('img').evaluateAll(images => images.map(image => (image as HTMLImageElement).getAttribute('src') || ''));
    expect(initialImages.some(src => src === photoLink)).toBe(false);
    await expect(card).not.toContainText('SPEC: 6-8" H');
    await expect(card).not.toContainText('AV NOTE: SPEC - 6-8" H');
  } finally {
    releaseIdentityBatch();
  }
  const batchResponse = await batchResponsePromise!;
  const batchBody = await batchResponse.json();
  const diagnostics = await page.evaluate(() => window.eval(`(() => {
    const card=document.querySelector('#request-content [data-request-uid="dock_suspend_dc_soc-hydration-448"]');
    return {version:queueCardInventoryRenderVersion,images:Array.from(card?.querySelectorAll('img')||[]).map(img=>({src:img.currentSrc,complete:img.complete,width:img.naturalWidth})),text:card?.textContent,
      context:getQueueCardInventoryContext(), sync:productionLiveSyncCoordinator?.getStatus?.()};
  })()`));
  if (!batchResponse.ok() || !batchBody?.data?.rows?.[0]?.row) {
    const failure = {identityRequest, batchStatus: batchResponse.status(), diagnostics, batchBody, operations: fixture.inventoryReadOperations, browserErrors};
    await info.attach('queue-identity-batch-failure', { body: JSON.stringify(failure, null, 2), contentType: 'application/json' });
  }
  await expect.poll(async () => await card.textContent(), { timeout: 8_000,
    message: JSON.stringify({ identityRequest, batchStatus: batchResponse.status(), diagnostics, batchBody, operations: fixture.inventoryReadOperations, browserErrors, imageRequests })
  }).toContain('PHOTO 10/18/26');
  await expect.poll(async () => {
    const images = await card.locator('img').evaluateAll(elements => elements.map(image => {
      const img = image as HTMLImageElement;
      return { src: img.currentSrc, complete: img.complete, width: img.naturalWidth };
    }));
    return images.some(image => image.src.includes('que-hydration-448.png') && image.complete && image.width === 32);
  }, { timeout: 20_000 }).toBe(true);
  await expect(card.locator('.app-suspend-tag-data-chips')).toContainText('SPEC: 6-8" H');
  await expect(card.locator('.app-suspend-tag-data-chips')).toContainText('MATCH: 80%');
  await expect(card.locator('.app-suspend-tag-data-note')).toContainText('AV NOTE: SPEC - 6-8" H');

  const identity = await page.evaluate(() => window.eval(`(() => {
    const mirror=getDockSuspendDcRequestMirrorRows().find(row=>String(getItemUniqueId(row)).includes('soc-hydration-448'));
    const state=getQueueCardInventoryState(mirror,'request');
    return {status:state.status,uid:state.row?.unique_id,itemcode:state.row?.itemcode,location:state.row?.locationcode,lot:state.row?.lotcode,
      renderVersion:queueCardInventoryRenderVersion,photo:document.querySelector('#request-content [data-request-uid="dock_suspend_dc_soc-hydration-448"] img')?.currentSrc};
  })()`));
  expect(identity).toMatchObject({ status: 'ready', uid: 'hydration-master-448', itemcode: '004380.010.1', location: 'C.09.000', lot: '27.F1' });
  expect(String(identity.photo)).toContain('que-hydration-448.png');
  expect(identityRequest).toBeTruthy();
  expect(imageRequests.some(url => url.includes('que-hydration-448.png'))).toBe(true);
  expect(JSON.stringify(identityRequest)).not.toContain('hydration-master-wrong-lot');
  await info.attach('queue-direct-open-hydration', { body: JSON.stringify({ project: info.project.name, identity, identityRequest, imageRequests }, null, 2), contentType: 'application/json' });
});
