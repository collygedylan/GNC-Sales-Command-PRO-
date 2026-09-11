// September 9 behavior coverage; see docs/rollback-sep09-validation.md.
import { expect, test } from '@playwright/test';

test('Request rep selection always renders customer choices or a recoverable error state', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=V2026.08.27.07', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).selectRepForRequest === 'function');

  const result = await page.evaluate(() => window.eval(`(() => {
    document.body.classList.add('ops-precision-pilot');
    customerRepMapRows = [
      { SALESREPNAME: 'Kevin Effinger', CUSTOMERNAME: 'Test Garden Center', CONSIGNEENAME: 'Main Dock' }
    ];
    requestsInventory = [];
    requestModalCustomerOptionsLoading = false;
    requestModalCustomerOptionsReady = true;
    requestModalCustomerOptionsError = '';
    ensureRequestModalCustomerOptionsReady = () => Promise.resolve(true);
    canUseRequestMappedFoldersForCurrentUser = () => true;
    getExistingRequestFolderRepRows = () => [{
      UNIQUE_ID: 'request-folder-row',
      REQUEST_FOLDER: 'test-garden-center-2026-08-27-REQ-001',
      CUSTOMERNAME: 'Test Garden Center',
      CONSIGNEENAME: 'Main Dock'
    }];
    resolveCanonicalRequestRepName = (name) => String(name || 'Kevin Effinger');
    resolveRequestRepSelectionForCurrentUser = (name) => String(name || 'Kevin Effinger');
    doesRequestRepMatchValue = () => true;
    showToast = () => {};

    const modes = [
      { name: 'manager-item-detail', locked: false, rows: ['detail-row'] },
      { name: 'manager-drive', locked: false, rows: ['drive-row'] },
      { name: 'manager-bloom', locked: false, rows: ['bloom-row-1', 'bloom-row-2'] },
      { name: 'manager-av', locked: false, rows: ['av-row'] },
      { name: 'salesrep-self', locked: true, rows: ['rep-row'] },
      { name: 'csr-assistant', locked: false, rows: ['csr-row'] }
    ];
    const modeResults = modes.map((mode) => {
      isRequestRepPickerLockedForCurrentUser = () => mode.locked;
      detailRequestSourceDomIds = mode.rows.slice();
      requestExistingFolderGroupsCacheKey = '';
      requestExistingFolderGroupsCache = [];
      resetExistingRequestFolderPickerState();
      document.getElementById('step-1-rep').classList.remove('hidden');
      document.getElementById('step-1.5-folder').classList.add('hidden');
      document.getElementById('existing-folder-container').innerHTML = '';
      selectRepForRequest('Kevin Effinger');
      const folderStep = document.getElementById('step-1.5-folder');
      const folderContent = document.getElementById('existing-folder-container');
      return {
        name: mode.name,
        visible: !folderStep.classList.contains('hidden'),
        hasHeading: folderContent.textContent.includes('Select Customer'),
        hasCustomer: folderContent.textContent.includes('Test Garden Center'),
        hasAction: !!folderContent.querySelector('button'),
        content: folderContent.textContent,
        rowsPreserved: JSON.stringify(detailRequestSourceDomIds) === JSON.stringify(mode.rows)
      };
    });

    const diagnostics = [];
    reportSemanticHealthEvent = (eventName, area, code, context) => diagnostics.push({ eventName, area, code, context });
    buildExistingRequestFolderCustomerGroups = () => { throw new Error('sensitive raw failure'); };
    isRequestRepPickerLockedForCurrentUser = () => false;
    detailRequestSourceDomIds = ['preserved-row'];
    document.getElementById('step-1-rep').classList.remove('hidden');
    document.getElementById('step-1.5-folder').classList.add('hidden');
    selectRepForRequest('Kevin Effinger');
    const failureText = document.getElementById('existing-folder-container').textContent;
    return {
      modeResults,
      failure: {
        visible: !document.getElementById('step-1.5-folder').classList.contains('hidden'),
        hasRetry: failureText.includes('Retry'),
        hasBack: failureText.includes('Back'),
        rowsPreserved: JSON.stringify(detailRequestSourceDomIds) === JSON.stringify(['preserved-row']),
        diagnostic: diagnostics[0]
      }
    };
  })()`));

  for (const mode of result.modeResults) {
    expect(mode, `${mode.name}: ${mode.content}`).toMatchObject({
      visible: true,
      hasHeading: true,
      hasCustomer: true,
      hasAction: true,
      rowsPreserved: true,
    });
  }
  expect(result.failure).toMatchObject({
    visible: true,
    hasRetry: true,
    hasBack: true,
    rowsPreserved: true,
    diagnostic: {
      eventName: 'request_folder_group_render_failed',
      area: 'request_entry',
      code: 'REQUEST_FOLDER_GROUP_RENDER_FAILED',
    },
  });
  expect(JSON.stringify(result.failure.diagnostic)).not.toContain('sensitive raw failure');
});

test('Queue tab changes load only the canonical datasets needed by that tab', async ({ page }) => {
  await page.goto('/?e2e=V2026.08.20.10', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).getRequestViewLoadingConfig === 'function');
  const configs = await page.evaluate(() => {
    const getConfig = (window as any).getRequestViewLoadingConfig;
    const summarize = (tab: string) => {
      const config = getConfig(tab);
      return {
        required: config.required.map((item: any) => `${item.key}:${item.mode}`),
        background: config.background.map((item: any) => `${item.key}:${item.mode}`),
      };
    };
    return {
      query: (window as any).buildActiveRequestLiveRowsQuery('*'),
      pending: summarize('pending'),
      reps: summarize('reps'),
      suspendTag: summarize('suspend-tag'),
      recount: summarize('recount'),
      avCheck: summarize('av-check'),
    };
  });

  expect(configs.query).toBe('select=*&order=unique_id.desc');
  expect(configs.query).not.toContain('date_completed=is.null');
  expect(configs.pending).toEqual({ required: ['requests:full'], background: [] });
  expect(configs.reps.required).toEqual(['requests:full', 'requestHistory:full', 'salesCredits:full']);
  expect(configs.suspendTag.required).toEqual(['requests:full', 'soc:full']);
  expect(configs.recount).toEqual({ required: ['salesOffice:full'], background: ['requests:full'] });
  expect(configs.avCheck).toEqual({ required: [], background: ['requests:full'] });
});

test('iPhone Request Queue renders all 19 rows instead of only the first adaptive chunk', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=V2026.08.20.10', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).getRequestChunkRenderOptions === 'function'
    && typeof (window as any).renderMarkupChunkedByKey === 'function');

  const result = await page.evaluate(() => {
    const appWindow = window as typeof window & {
      isIOSDevice?: () => boolean;
      getRequestChunkRenderOptions: (options?: Record<string, unknown>) => Record<string, unknown>;
      renderMarkupChunkedByKey: (
        key: string,
        container: HTMLElement,
        crumb: HTMLElement,
        rows: Array<{ id: number }>,
        crumbText: string,
        renderRow: (row: { id: number }) => string,
        options: Record<string, unknown>
      ) => boolean;
    };
    appWindow.isIOSDevice = () => true;
    document.body.classList.add('ios-device', 'viewport-phone', 'current-view-request');
    const container = document.createElement('div');
    const crumb = document.createElement('div');
    document.body.append(container, crumb);
    const rows = Array.from({ length: 19 }, (_, index) => ({ id: index + 1 }));
    const options = appWindow.getRequestChunkRenderOptions({ onComplete: () => {} });
    appWindow.renderMarkupChunkedByKey(
      'request-main-test',
      container,
      crumb,
      rows,
      'All Request Que',
      (row) => `<div data-request-uid="REQ-${row.id}">Row ${row.id}</div>`,
      options
    );
    return {
      configuredSyncLimit: Number(options.iosSyncRowLimit || 0),
      renderedRows: container.querySelectorAll('[data-request-uid]').length,
    };
  });

  expect(result.configuredSyncLimit).toBeGreaterThanOrEqual(19);
  expect(result.renderedRows).toBe(19);
});
