import { expect, test, type Page } from '@playwright/test';

const sourceRows = [
  { UNIQUE_ID: 'bc-source-26', ITEMCODE: 'BC.ROSE', COMMONNAME: 'Clearing Rose', CONTSIZE: '#3', BLOCKALPHA: 'A', LOCATIONCODE: 'A.05.001', LOTCODE: '26.F1', SALEYEAR: 26, SEASON: 'F1', SOURCE: 'Nursery', PTRONHAND: 10 },
  { UNIQUE_ID: 'bc-source-27', ITEMCODE: 'BC.ROSE', COMMONNAME: 'Clearing Rose', CONTSIZE: '#3', BLOCKALPHA: 'A', LOCATIONCODE: 'A.05.002', LOTCODE: '27.U2', SALEYEAR: 27, SEASON: 'U2', SOURCE: 'Nursery', PTRONHAND: 12 },
  { UNIQUE_ID: 'bc-source-second-lot', ITEMCODE: 'BC.ROSE', COMMONNAME: 'Clearing Rose', CONTSIZE: '#3', BLOCKALPHA: 'A', LOCATIONCODE: 'A.05.099', LOTCODE: '27.S1', SALEYEAR: 27, SEASON: 'S1', SOURCE: 'Nursery', PTRONHAND: 14 },
  { UNIQUE_ID: 'bc-source-maple', ITEMCODE: 'BC.MAPLE', COMMONNAME: 'Clearing Maple', CONTSIZE: '#5', BLOCKALPHA: 'A', LOCATIONCODE: 'A.05.000', LOTCODE: '27.F1', SALEYEAR: 27, SEASON: 'F1', SOURCE: 'Nursery', PTRONHAND: 8 },
];

const destinationRows = [
  { UNIQUE_ID: 'bc-dest-26', ITEMCODE: 'BC.ROSE', LOCATIONCODE: 'B.02.001', SALEYEAR: 26, LOTCODE: '26.F1', PTRONHAND: 100 },
  { UNIQUE_ID: 'bc-dest-27', ITEMCODE: 'BC.ROSE', LOCATIONCODE: 'B.03.010', SALEYEAR: 27, LOTCODE: '27.F1', PTRONHAND: 5 },
  { UNIQUE_ID: 'bc-dest-27-second-lot', ITEMCODE: 'BC.ROSE', LOCATIONCODE: 'B.03.010', SALEYEAR: 27, LOTCODE: '27.S1', PTRONHAND: 6 },
  { UNIQUE_ID: 'bc-dest-wrong-year', ITEMCODE: 'BC.ROSE', LOCATIONCODE: 'B.04.001', SALEYEAR: 28, LOTCODE: '28.F1', PTRONHAND: 7 },
  { UNIQUE_ID: 'bc-dest-other-item', ITEMCODE: 'BC.OTHER', LOCATIONCODE: 'C.07.123', SALEYEAR: 27, LOTCODE: '27.F1', PTRONHAND: 9 },
  { UNIQUE_ID: 'bc-dest-same-block', ITEMCODE: 'BC.ROSE', LOCATIONCODE: 'A.06.010', SALEYEAR: 27, LOTCODE: '27.F1', PTRONHAND: 11 },
].map(row => ({ ...row, BLOCKALPHA: row.LOCATIONCODE.split('.')[0], COMMONNAME: row.ITEMCODE === 'BC.ROSE' ? 'Clearing Rose' : 'Other Inventory', CONTSIZE: '#3', SOURCE: 'Nursery' }));

async function appEval<T = any>(page: Page, script: string): Promise<T> {
  return page.evaluate(source => (window as any).__blockClearingTestEval(source), script);
}

async function setupBlockClearing(page: Page, width: number) {
  await page.setViewportSize({ width, height: 844 });
  // Every fixture runs without external writes, even if an unrelated app task wakes up.
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      await route.abort();
      return;
    }
    // Release metadata may change while the shared checkout is being prepared.
    // Shell upgrade navigation is outside this isolated worksheet fixture.
    if (url.pathname.endsWith('/manifest.json')) {
      await route.abort();
      return;
    }
    if (route.request().resourceType() === 'document') {
      const response = await route.fetch();
      // Local source uses indirect eval, which keeps its let/const bindings private.
      // Expose only a test bridge in that lexical environment; production code is untouched.
      const html = (await response.text()).replace(/(<script id="app-script-source" type="text\/plain">)([\s\S]*?)(<\/script>)/,
        (_match, start, source, end) => `${start}${source}\nwindow.__blockClearingTestEval = (source) => eval(source);\n${end}`);
      await route.fulfill({ response, body: html });
      return;
    }
    await route.continue();
  });
  await page.goto('/?e2e=block-clearing-pdf&post_deploy_access_canary=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).__blockClearingTestEval === 'function');
  await appEval(page, `(() => {
    installMutationBlockedAccessCanaryIdentity('dylan_collyge', 'Dylan Collyge', 'ADMIN');
    activeHomeTab = 'block-clearing';
    managersSearchTerm = '';
    const fixtureRows = ${JSON.stringify([...sourceRows, ...destinationRows])};
    processAndLoadData({ data: fixtureRows, _fromCache: true });
    getDatasetState('master').initialLoaded = getDatasetState('master').fullLoaded = true;
    // Duplicate transport rows must not double count an inventory identity.
    fullInventory.push({ ...fullInventory.find(row => row.UNIQUE_ID === 'bc-source-27') });
    managerBlockClearingCache = null;
    managerBlockClearingCacheKey = '';
    resetManagerBlockClearingSelection(true);
    managerBlockClearingLevel = 0;
    managerBlockClearingSelectedBlock = null;
    managerBlockClearingSelectedLocation = null;
    window.bcToasts = [];
    window.bcUnexpectedWrites = [];
    showToast = (title, message, error) => window.bcToasts.push({ title: String(title || ''), message: String(message || ''), error: !!error });
    getCurrentVisibleViewId = () => 'managers';
    isDrawerOpen = () => false;
    closeOpenInteractiveSurfaceForBack = () => false;
    const oldScroll = document.getElementById('main-scroll-area');
    if (oldScroll) oldScroll.id = 'bc-original-scroll-area';
    const host = document.createElement('main');
    host.id = 'main-scroll-area';
    host.style.cssText = 'position:fixed;inset:52px 0 0;z-index:2147483646;overflow:auto;background:white;padding:12px;';
    const headerBack = document.getElementById('global-header-inline-back');
    headerBack.style.cssText = 'position:fixed;top:4px;left:12px;z-index:2147483647;background:white;';
    document.body.appendChild(headerBack);
    const view = document.getElementById('view-managers');
    view.classList.remove('hidden');
    host.appendChild(view);
    document.body.appendChild(host);
    window.bcRealScheduleManagersRender = scheduleManagersRender;
    window.bcRealRenderManagers = renderManagers;
    scheduleManagersRender = () => {
      document.getElementById('managers-content').innerHTML = activeHomeTab === 'block-clearing'
        ? renderManagerBlockClearingPanel() : '<div data-bc-manager-home>Managers</div>';
      syncManagersHeaderChrome();
      updateGlobalBackButton();
      restoreManagerBlockClearingScrollAfterRender();
    };
    renderManagers = scheduleManagersRender;
    window.bcInventoryBefore = JSON.stringify(fullInventory);
    window.bcQueueBefore = JSON.stringify({ requestsInventory, managerReviewInventory, moveUpInventory, evalWorkRows });
    scheduleManagersRender();
  })()`);
}

async function openSource(page: Page) {
  await appEval(page, `selectManagerBlockClearingBlock('A'); selectManagerBlockClearingLocation('A.05');`);
}

async function selectRoseAndOpenInstructions(page: Page) {
  await openSource(page);
  await appEval(page, `toggleManagerBlockClearingItemcode('BC.ROSE'); finishManagerBlockClearingSelection();`);
}

async function setDecision(page: Page, field: string, value: string) {
  const attributes: Record<string, string> = { action: 'action', quantity: 'quantity', instructions: 'instructions', destinationMode: 'destination-mode', destinationLocationcode: 'destination', destinationSearch: 'destination-search' };
  const control = page.locator('[data-block-clearing-itemcode="BC.ROSE"]').locator(`[data-block-clearing-${attributes[field]}]`);
  if (await control.count() && ['action', 'destinationMode', 'destinationLocationcode'].includes(field)) {
    if (await control.locator('option').evaluateAll((options, target) => options.some(option => (option as HTMLOptionElement).value === target), value)) {
      await control.selectOption(value);
      return;
    }
  } else if (await control.count()) {
    await control.fill(value);
    return;
  }
  // Exercise validation against a stale value that cannot be chosen from the UI.
  await appEval(page, `setManagerBlockClearingDecision(encodeURIComponent('BC.ROSE'), ${JSON.stringify(field)}, ${JSON.stringify(value)}); scheduleManagersRender();`);
}

async function assertInventoryUnchanged(page: Page) {
  expect(await appEval(page, `JSON.stringify(fullInventory) === window.bcInventoryBefore`)).toBe(true);
  expect(await appEval(page, `JSON.stringify({ requestsInventory, managerReviewInventory, moveUpInventory, evalWorkRows }) === window.bcQueueBefore`)).toBe(true);
  expect(await appEval(page, 'window.bcUnexpectedWrites')).toEqual([]);
}

async function installPdfFetch(page: Page, response: 'success' | 'http-error' | 'invalid-pdf' | 'email-error') {
  await appEval(page, `(() => {
    window.bcRequests = [];
    window.bcResponseMode = ${JSON.stringify(response)};
    window.bcRecipientPickCount = 0;
    openGroupedBloomNcrRecipientModal = async () => {
      window.bcRecipientPickCount += 1;
      return ['dylan_collyge@greenleafnursery.com'];
    };
    window.fetch = async (url, options = {}) => {
      let payload = {};
      try { payload = JSON.parse(String(options.body || '{}')); } catch (_) {}
      if (payload.type !== 'block_clearing_pdf') {
        if (!['GET', 'HEAD'].includes(String(options.method || 'GET').toUpperCase())) window.bcUnexpectedWrites.push({ url: String(url), payload });
        return new Response(JSON.stringify({ error: 'Unrelated network request disabled by fixture' }), { status: 503 });
      }
      window.bcRequests.push({ url: String(url), method: String(options.method || 'GET'), payload });
      if (window.bcResponseMode === 'http-error') return new Response(JSON.stringify({ success: false, error: 'PDF rendering failed' }), { status: 500 });
      if (window.bcResponseMode === 'email-error') return new Response(JSON.stringify({ success: false, error: 'Email delivery failed' }), { status: 200 });
      const base64 = window.bcResponseMode === 'invalid-pdf' ? btoa('not a PDF') : btoa('%PDF-1.4\\nsynthetic browser fixture\\n%%EOF');
      return new Response(JSON.stringify(payload.operation === 'email'
        ? { success: true, contractVersion: 'block-clearing-pdf-v1', attachmentCount: 1, pdfFilename: 'Block Clearing A.05.pdf' }
        : { success: true, contractVersion: 'block-clearing-pdf-v1', attachmentCount: 1, file: { filename: 'Block Clearing A.05.pdf', mimeType: 'application/pdf', base64 } }
      ), { status: 200, headers: { 'content-type': 'application/json' } });
    };
  })()`);
}

for (const width of [390, 1280]) {
  test(`Block Clearing groups full bucket ITEMCODEs and retains all source rows through search at ${width}px`, async ({ page }) => {
    await setupBlockClearing(page, width);
    await openSource(page);
    const groups = await appEval(page, `getManagerBlockClearingItemGroupsForSelectedLocation().map(group => ({ itemcode: group.itemcode, ids: group.rows.map(row => row.UNIQUE_ID).sort(), total: group.totalOnHand }))`);
    expect(groups).toEqual([
      { itemcode: 'BC.MAPLE', ids: ['bc-source-maple'], total: 8 },
      { itemcode: 'BC.ROSE', ids: ['bc-source-26', 'bc-source-27', 'bc-source-second-lot'], total: 36 },
    ]);
    const cards = page.locator('#managers-content [data-block-clearing-itemcode]');
    await expect(cards).toHaveCount(2);
    await page.locator('#managers-search').fill('27.U2');
    await expect(cards).toHaveCount(1);
    const rose = cards.first();
    for (const location of ['A.05.001', 'A.05.002', 'A.05.099']) await expect(rose).toContainText(location);
    await rose.getByRole('checkbox').check();
    await appEval(page, 'finishManagerBlockClearingSelection()');
    expect(await appEval(page, `getManagerBlockClearingSelectedRows().map(row => row.UNIQUE_ID).sort()`)).toEqual(['bc-source-26', 'bc-source-27', 'bc-source-second-lot']);
    expect(await page.locator('#main-scroll-area').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await assertInventoryUnchanged(page);
  });

  test(`Block Clearing has one header Back with draft and search retention at ${width}px`, async ({ page }) => {
    await setupBlockClearing(page, width);
    await openSource(page);
    await page.locator('#managers-search').fill('Clearing Rose');
    await expect(page.locator('#managers-content [data-block-clearing-itemcode]')).toHaveCount(1);
    await appEval(page, `toggleManagerBlockClearingItemcode('BC.ROSE'); finishManagerBlockClearingSelection();`);
    await setDecision(page, 'action', 'move');
    await setDecision(page, 'quantity', '7');
    await setDecision(page, 'destinationLocationcode', 'B.03.010');
    await setDecision(page, 'instructions', 'Preserve the reviewed draft.');
    const before = await appEval(page, `JSON.stringify(getManagerBlockClearingDecision('BC.ROSE'))`);
    await appEval(page, `managersSearchTerm = '27.U2'; syncManagersHeaderChrome(); document.activeElement.blur();`);
    const back = page.locator('#global-header-inline-back');
    await expect(back).toBeVisible();
    await expect(page.locator('#view-managers button[onclick*="backManagerBlockClearing"]')).toHaveCount(0);
    for (const expected of [
      { level: 2, instructions: false, tab: 'block-clearing', search: 'Clearing Rose' },
      { level: 1, instructions: false, tab: 'block-clearing', search: '' },
      { level: 0, instructions: false, tab: 'block-clearing', search: '' },
      { level: 0, instructions: false, tab: 'dashboard', search: '' },
    ]) {
      await back.click();
      expect(await appEval(page, `({ level: managerBlockClearingLevel, instructions: managerBlockClearingInstructionMode, tab: activeHomeTab, search: managersSearchTerm })`)).toEqual(expected);
      expect(await appEval(page, `JSON.stringify(getManagerBlockClearingDecision('BC.ROSE'))`)).toBe(before);
    }
    await appEval(page, `activeHomeTab = 'block-clearing'; selectManagerBlockClearingBlock('A'); selectManagerBlockClearingLocation('A.05'); finishManagerBlockClearingSelection();`);
    await expect(page.locator('[data-block-clearing-quantity]')).toHaveValue('7');
    await expect(page.locator('[data-block-clearing-destination]')).toHaveValue('B.03.010');
    await expect(page.locator('#managers-search')).toHaveValue('27.U2');
    await assertInventoryUnchanged(page);
  });

  test(`Block Clearing destinations use all source years, search full codes and invalidate stale choices at ${width}px`, async ({ page }) => {
    await setupBlockClearing(page, width);
    await selectRoseAndOpenInstructions(page);
    await page.locator('[data-block-clearing-action]').selectOption('move');
    const mode = page.locator('[data-block-clearing-destination-mode]');
    const destination = page.locator('[data-block-clearing-destination]');
    const values = async () => destination.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value).filter(Boolean));
    await expect(mode).toHaveValue('itemcode');
    expect(await values()).toEqual(['A.06.010', 'B.02.001', 'B.03.010']);
    await destination.selectOption('B.03.010');
    await mode.selectOption('all');
    await expect(destination).toHaveValue('B.03.010');
    expect(await values()).toEqual(['A.06.010', 'B.02.001', 'B.03.010', 'B.04.001', 'C.07.123']);
    await destination.selectOption('');
    await page.locator('[data-block-clearing-destination-search]').fill('C.07');
    await expect.poll(values).toEqual(['C.07.123']);
    await destination.selectOption('C.07.123');
    await mode.selectOption('itemcode');
    await expect(destination).toHaveValue('');
    await page.locator('[data-block-clearing-destination-search]').fill('');
    await destination.selectOption('B.02.001');
    await page.locator('[data-block-clearing-action]').selectOption('grade_save_best');
    await expect(destination).toHaveCount(0);
    expect(await appEval(page, `getManagerBlockClearingDecision('BC.ROSE').destinationLocationcode`)).toBe('');
    await page.locator('[data-block-clearing-action]').selectOption('move');
    await destination.selectOption('B.02.001');
    await page.locator('[data-block-clearing-action]').selectOption('ta');
    expect(await appEval(page, `getManagerBlockClearingDecision('BC.ROSE').destinationLocationcode`)).toBe('');
    expect(await page.locator('#main-scroll-area').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await assertInventoryUnchanged(page);
  });

  test(`Block Clearing validates each action quantity before the PDF request at ${width}px`, async ({ page }) => {
    await setupBlockClearing(page, width);
    await selectRoseAndOpenInstructions(page);
    await installPdfFetch(page, 'success');
    await appEval(page, 'downloadManagerBlockClearingPdf()');
    expect(await appEval(page, 'window.bcRequests')).toEqual([]);
    for (const action of ['ta', 'move', 'grade_save_best']) {
      await setDecision(page, 'action', action);
      if (action === 'move') await setDecision(page, 'destinationLocationcode', 'B.02.001');
      for (const quantity of ['', '0', '-1', '1.5', '37']) {
        await setDecision(page, 'quantity', quantity);
        await appEval(page, 'downloadManagerBlockClearingPdf()');
        expect(await appEval(page, 'window.bcRequests')).toEqual([]);
      }
      await setDecision(page, 'quantity', '36');
      if (action === 'move') {
        await setDecision(page, 'destinationLocationcode', 'A.05.002');
        await appEval(page, 'downloadManagerBlockClearingPdf()');
        expect(await appEval(page, 'window.bcRequests')).toEqual([]);
        await setDecision(page, 'destinationLocationcode', 'B.02.001');
      }
      const download = page.waitForEvent('download');
      await appEval(page, 'downloadManagerBlockClearingPdf()');
      await download;
      const requests = await appEval(page, 'window.bcRequests');
      expect(requests).toHaveLength(1);
      expect(requests[0].payload.report.items[0]).toMatchObject({ action, quantity: 36 });
      await appEval(page, 'window.bcRequests = []');
    }
    expect(await appEval(page, 'window.bcToasts.some(toast => toast.error)')).toBe(true);
    await assertInventoryUnchanged(page);
  });

  test(`Block Clearing PDF download sends one versioned report and never opens email at ${width}px`, async ({ page }) => {
    await setupBlockClearing(page, width);
    await openSource(page);
    await page.locator('[data-block-clearing-itemcode="BC.ROSE"] input[type="checkbox"]').check();
    await page.locator('[data-block-clearing-itemcode="BC.MAPLE"] input[type="checkbox"]').check();
    await page.locator('#block-clearing-continue').click();
    await setDecision(page, 'action', 'move');
    await setDecision(page, 'quantity', '36');
    await setDecision(page, 'destinationLocationcode', 'B.03.010');
    await setDecision(page, 'instructions', 'Move all reviewed stock.');
    const maple = page.locator('[data-block-clearing-itemcode="BC.MAPLE"]');
    await maple.locator('[data-block-clearing-action]').selectOption('ta');
    await maple.locator('[data-block-clearing-quantity]').fill('8');
    await installPdfFetch(page, 'success');
    const download = page.waitForEvent('download');
    await appEval(page, 'downloadManagerBlockClearingPdf()');
    expect((await download).suggestedFilename()).toMatch(/\.pdf$/i);
    const requests = await appEval(page, 'window.bcRequests');
    expect(requests).toHaveLength(1);
    expect(requests[0].payload).toMatchObject({ type: 'block_clearing_pdf', operation: 'render', contractVersion: 'block-clearing-pdf-v1', report: { locationBucket: 'A.05', blockalpha: 'A' } });
    expect(requests[0].payload.report.items).toHaveLength(2);
    const roseReport = requests[0].payload.report.items.find((item: any) => item.itemcode === 'BC.ROSE');
    const mapleReport = requests[0].payload.report.items.find((item: any) => item.itemcode === 'BC.MAPLE');
    expect(roseReport).toMatchObject({ itemcode: 'BC.ROSE', action: 'move', quantity: 36, destinationMode: 'itemcode', destinationLocationcode: 'B.03.010' });
    expect(mapleReport).toMatchObject({ itemcode: 'BC.MAPLE', action: 'ta', quantity: 8, rows: [{ uniqueId: 'bc-source-maple', locationcode: 'A.05.000', ptronhand: 8 }] });
    expect(roseReport.rows.map((row: any) => row.uniqueId).sort()).toEqual(['bc-source-26', 'bc-source-27', 'bc-source-second-lot']);
    expect(roseReport.rows.map((row: any) => row.locationcode).sort()).toEqual(['A.05.001', 'A.05.002', 'A.05.099']);
    expect(await appEval(page, 'window.bcRecipientPickCount')).toBe(0);
    await assertInventoryUnchanged(page);
  });

  test(`Block Clearing PDF and email failures retain draft and never report success at ${width}px`, async ({ page }) => {
    await setupBlockClearing(page, width);
    await selectRoseAndOpenInstructions(page);
    await setDecision(page, 'action', 'ta');
    await setDecision(page, 'quantity', '1');
    const before = await appEval(page, `JSON.stringify(getManagerBlockClearingDecision('BC.ROSE'))`);
    for (const response of ['http-error', 'invalid-pdf', 'email-error'] as const) {
      await installPdfFetch(page, response);
      await appEval(page, 'window.bcToasts = []');
      await appEval(page, response === 'email-error' ? 'sendManagerBlockClearingEmail()' : 'downloadManagerBlockClearingPdf()');
      const requests = await appEval(page, 'window.bcRequests');
      expect(requests).toHaveLength(1);
      expect(requests[0].payload).toMatchObject({ type: 'block_clearing_pdf', contractVersion: 'block-clearing-pdf-v1', operation: response === 'email-error' ? 'email' : 'render' });
      expect(await appEval(page, `JSON.stringify(getManagerBlockClearingDecision('BC.ROSE'))`)).toBe(before);
      const toasts = await appEval(page, 'window.bcToasts');
      expect(toasts.some((toast: any) => toast.error)).toBe(true);
      expect(toasts.some((toast: any) => !toast.error && /\bsent\b|downloaded|success|pdf ready/i.test(toast.title))).toBe(false);
      await expect(page.locator('[data-block-clearing-quantity]')).toHaveValue('1');
    }
    await installPdfFetch(page, 'success');
    await appEval(page, 'sendManagerBlockClearingEmail()');
    const requests = await appEval(page, 'window.bcRequests');
    expect(requests).toHaveLength(1);
    expect(requests[0].payload).toMatchObject({ type: 'block_clearing_pdf', operation: 'email', contractVersion: 'block-clearing-pdf-v1' });
    await assertInventoryUnchanged(page);
  });

  test(`Block Clearing real manager renderer preserves focused input and Back scroll at ${width}px`, async ({ page }) => {
    await setupBlockClearing(page, width);
    await selectRoseAndOpenInstructions(page);
    await setDecision(page, 'action', 'ta');
    await setDecision(page, 'quantity', '7');
    await setDecision(page, 'instructions', 'Keep this careful handwritten note.');
    await appEval(page, `(() => {
      ensureViewDataForRender = () => false;
      window.bcRealRenderCount = 0;
      renderManagers = (...args) => { window.bcRealRenderCount += 1; return window.bcRealRenderManagers(...args); };
      scheduleManagersRender = window.bcRealScheduleManagersRender;
      const input = document.querySelector('[data-block-clearing-instructions]');
      input.focus(); input.setSelectionRange(5, 9);
      window.bcFocusedInput = input;
      queueInteractiveViewRender('managers', false, true, 0, 0);
    })()`);
    await expect.poll(() => appEval(page, 'window.bcRealRenderCount')).toBeGreaterThan(0);
    expect(await appEval(page, `({ sameInput: document.activeElement === window.bcFocusedInput, value: document.activeElement.value, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd })`)).toEqual({ sameInput: true, value: 'Keep this careful handwritten note.', start: 5, end: 9 });
    // Native Back can arrive before the text field blurs. Navigation must still render.
    await appEval(page, `document.getElementById('managers-content').style.minHeight = '1800px'; goBackUniversal();`);
    await expect(page.locator('[data-block-clearing-itemcode="BC.ROSE"] input[type="checkbox"]')).toBeVisible();
    await appEval(page, `document.getElementById('main-scroll-area').scrollTop = 180; finishManagerBlockClearingSelection();`);
    await expect(page.locator('[data-block-clearing-quantity]')).toHaveValue('7');
    await appEval(page, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await appEval(page, `document.getElementById('main-scroll-area').scrollTop = 360;`);
    await page.locator('#global-header-inline-back').click();
    await expect(page.locator('[data-block-clearing-itemcode="BC.ROSE"] input[type="checkbox"]')).toBeVisible();
    expect(await appEval(page, `managerBlockClearingDraftState.views.get('2|A|A.05|instructions').scroll`)).toBe(360);
    // The general renderer also schedules a delayed restore; the saved browse position
    // must still win after that asynchronous work has completed.
    const scroll = await appEval(page, `new Promise(resolve => setTimeout(() => resolve(getMainAreaScrollTop()), 400))`);
    expect(scroll).toBe(180);
    await appEval(page, 'finishManagerBlockClearingSelection()');
    await expect(page.locator('[data-block-clearing-quantity]')).toHaveValue('7');
    const instructionScroll = await appEval(page, `new Promise(resolve => setTimeout(() => resolve(getMainAreaScrollTop()), 400))`);
    expect(instructionScroll).toBe(360);
    await assertInventoryUnchanged(page);
  });

  test(`Block Clearing email retry replays its frozen report after live stock changes at ${width}px`, async ({ page }) => {
    await setupBlockClearing(page, width);
    await selectRoseAndOpenInstructions(page);
    await setDecision(page, 'action', 'ta');
    await setDecision(page, 'quantity', '10');
    await installPdfFetch(page, 'email-error');
    await appEval(page, 'sendManagerBlockClearingEmail()');
    const first = await appEval(page, 'window.bcRequests[0].payload');
    await appEval(page, `(() => {
      fullInventory.filter(row => row.ITEMCODE === 'BC.ROSE' && row.LOCATIONCODE.startsWith('A.05.')).forEach(row => { row.PTRONHAND = 0; });
      managerBlockClearingCache = null;
      managerBlockClearingCacheKey = '';
      window.bcInventoryBefore = JSON.stringify(fullInventory);
    })()`);
    await appEval(page, 'sendManagerBlockClearingEmail()');
    let requests = await appEval(page, 'window.bcRequests');
    expect(requests).toHaveLength(2);
    expect(requests[1].payload).toEqual(first);
    expect(requests[1].payload.report.items[0].rows.reduce((sum: number, row: any) => sum + row.ptronhand, 0)).toBe(36);
    await appEval(page, `(() => {
      fullInventory = fullInventory.filter(row => !row.LOCATIONCODE.startsWith('A.05.'));
      managerBlockClearingCache = null;
      managerBlockClearingCacheKey = '';
      window.bcInventoryBefore = JSON.stringify(fullInventory);
      window.bcResponseMode = 'success';
      scheduleManagersRender();
    })()`);
    await expect(page.locator('[data-block-clearing-itemcode="BC.ROSE"]')).toBeVisible();
    await expect(page.locator('#block-clearing-email-send-btn')).toBeEnabled();
    await page.locator('#block-clearing-email-send-btn').click();
    await expect.poll(() => appEval(page, 'window.bcRequests.length')).toBe(3);
    requests = await appEval(page, 'window.bcRequests');
    expect(requests[2].payload).toEqual(first);
    await expect.poll(() => appEval(page, `window.bcToasts.some(toast => toast.title === 'Email Sent')`)).toBe(true);
    await assertInventoryUnchanged(page);
  });

  test(`Block Clearing late email success does not erase another location draft at ${width}px`, async ({ page }) => {
    await setupBlockClearing(page, width);
    await selectRoseAndOpenInstructions(page);
    await setDecision(page, 'action', 'ta');
    await setDecision(page, 'quantity', '5');
    await installPdfFetch(page, 'success');
    await appEval(page, `(() => {
      const respond = window.fetch;
      window.fetch = (url, options) => {
        const payload = JSON.parse(options && options.body || '{}');
        return payload.type === 'block_clearing_pdf' && payload.operation === 'email'
          ? new Promise(resolve => { window.bcReleaseEmail = async () => resolve(await respond(url, options)); })
          : respond(url, options);
      };
      window.bcPendingEmail = sendManagerBlockClearingEmail();
    })()`);
    await expect.poll(() => appEval(page, 'typeof window.bcReleaseEmail')).toBe('function');
    await appEval(page, `selectManagerBlockClearingLocation('A.06'); toggleManagerBlockClearingItemcode('BC.ROSE'); finishManagerBlockClearingSelection();`);
    await setDecision(page, 'action', 'ta');
    await setDecision(page, 'quantity', '3');
    await setDecision(page, 'instructions', 'This belongs to the second clearing location.');
    const secondDraft = await appEval(page, `JSON.stringify(getManagerBlockClearingDecision('BC.ROSE'))`);
    await appEval(page, `window.bcReleaseEmail(); window.bcPendingEmail`);
    expect(await appEval(page, `({ location: managerBlockClearingSelectedLocation, instructions: managerBlockClearingInstructionMode, selected: Array.from(managerBlockClearingSelectedIds), draft: JSON.stringify(getManagerBlockClearingDecision('BC.ROSE')) })`)).toEqual({ location: 'A.06', instructions: true, selected: ['BC.ROSE'], draft: secondDraft });
    await expect(page.locator('[data-block-clearing-quantity]')).toHaveValue('3');
    const requests = await appEval(page, 'window.bcRequests');
    expect(requests).toHaveLength(1);
    expect(requests[0].payload.report.locationBucket).toBe('A.05');
    await assertInventoryUnchanged(page);
  });
}
