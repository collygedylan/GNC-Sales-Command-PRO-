import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const expectedCommit = String(process.env.EXPECTED_COMMIT || process.env.GITHUB_SHA || '').trim().toLowerCase();
const expectedRelease = `V${JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version}`;

test('live Request rep to customer, consignee, folder, and quantity flow remains actionable', async ({ page }) => {
  const blockedMutations: string[] = [];
  const pageErrors: string[] = [];
  let collectPageErrors = false;

  await page.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      let pathname = 'unknown';
      try { pathname = new URL(request.url()).pathname.replace(/[^a-z0-9_./-]+/gi, '_').slice(0, 120); } catch {}
      blockedMutations.push(`${method}:${pathname}`);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  page.on('pageerror', (error) => {
    if (collectPageErrors) pageErrors.push(String(error?.message || 'PAGE_ERROR').replace(/[^a-z0-9 _.-]+/gi, '_').slice(0, 160));
  });

  const nonce = `${Date.now()}-${expectedCommit.slice(0, 7) || 'local'}`;
  await page.goto(`/?post_deploy_request_canary=${encodeURIComponent(nonce)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).selectRepForRequest === 'function'
    && typeof (window as any).buildExistingRequestFolderCustomerGroups === 'function'
    && typeof (window as any).goToQtyStep === 'function');

  const setup = await page.evaluate(() => window.eval(`(() => {
    const fixture = {
      UNIQUE_ID: 'HOSTED-REQUEST-CANARY-ROW',
      DOM_ID: 'hosted-request-canary-row',
      ITEMCODE: 'CANARY.ITEM.001',
      COMMONNAME: 'Synthetic Canary Plant',
      CONTSIZE: '#1 TEST',
      LOCATIONCODE: 'T.00.000',
      LOTCODE: '99.F1',
      SOURCE: 'TEST',
      PTRAVAILABLE: '25',
      PTRONHAND: '25',
      PTRREVIEWED: '0',
      PLANTGROUPCODE: 'TEST_GROUP'
    };
    document.body.classList.add('ops-precision-pilot');
    currentUser = 'hosted_request_canary';
    currentUserDisplay = 'Hosted Request Canary';
    currentRole = 'Manager';
    fullInventory = [fixture];
    requestsInventory = [];
    customerRepMapRows = [{
      SALESREPNAME: 'Hosted Canary Rep',
      CUSTOMERNAME: 'Synthetic Canary Customer',
      CONSIGNEENAME: 'Synthetic Canary Dock'
    }];
    invalidateInventoryDomIdLookup();
    requestModalCustomerOptionsLoading = false;
    requestModalCustomerOptionsReady = true;
    requestModalCustomerOptionsError = '';
    areRequestModalCustomerDatasetsReady = () => true;
    buildRequestModalCustomerOptionsCache = () => [];
    ensureRequestModalCustomerOptionsReady = () => Promise.resolve(true);
    canUseRequestMappedFoldersForCurrentUser = () => true;
    getExistingRequestFolderRepRows = () => [];
    resolveCanonicalRequestRepName = (name) => String(name || 'Hosted Canary Rep');
    resolveRequestRepSelectionForCurrentUser = (name) => String(name || 'Hosted Canary Rep');
    doesRequestRepMatchValue = () => true;
    isRequestRepPickerLockedForCurrentUser = () => false;
    isCsrRequestAssistantUser = () => false;
    getDefaultRequestRepName = () => '';
    window.__REQUEST_CANARY_DIAGNOSTICS__ = [];
    reportSemanticHealthEvent = (eventName, area, code, context) => window.__REQUEST_CANARY_DIAGNOSTICS__.push({ eventName, area, code, context });
    showRequestModalBase();
    detailRequestSourceDomIds = [fixture.DOM_ID];
    requestExistingFolderGroupsCacheKey = '';
    requestExistingFolderGroupsCache = [];
    selectRepForRequest('Hosted Canary Rep');
    return {
      release: String(window.__APP_SHELL_VERSION__ || ''),
      customerStepVisible: !document.getElementById('step-1.5-folder').classList.contains('hidden'),
      diagnosticCount: window.__REQUEST_CANARY_DIAGNOSTICS__.length
    };
  })()`));
  collectPageErrors = true;

  expect(setup.release).toBe(expectedRelease);
  expect(setup.customerStepVisible).toBe(true);
  expect(setup.diagnosticCount).toBe(0);
  const modal = page.locator('#request-rep-modal');
  const picker = page.locator('#existing-folder-container');
  await expect(modal).toBeVisible();
  await expect(picker).toContainText('Select Customer');

  const customer = picker.locator('button.request-choice-card', { hasText: 'Synthetic Canary Customer' });
  await expect(customer).toBeVisible();
  await customer.click();
  await expect(picker).toContainText('Select Consignee');

  const consignee = picker.locator('button.request-choice-card', { hasText: 'Synthetic Canary Dock' });
  await expect(consignee).toBeVisible();
  await consignee.click();
  await expect(picker).toContainText('Select Request Folder');

  const createFolder = picker.locator('button.request-folder-create-action', { hasText: 'CREATE NEW FOLDER' });
  await expect(createFolder).toBeVisible();
  await createFolder.click();

  const qtyStep = page.locator('#step-3-qty');
  await expect(qtyStep).toBeVisible();
  await expect(qtyStep).toContainText('Synthetic Canary Plant');
  const quantity = qtyStep.locator('.item-qty-input');
  const spec = qtyStep.locator('.item-spec-input');
  const note = qtyStep.locator('.item-note-input');
  await expect(quantity).toBeEditable();
  await expect(spec).toBeEditable();
  await expect(note).toBeEditable();
  await quantity.fill('5');
  await spec.fill('synthetic specification');
  await note.fill('synthetic canary note');
  await expect(quantity).toHaveValue('5');
  await expect(spec).toHaveValue('synthetic specification');
  await expect(note).toHaveValue('synthetic canary note');
  await expect(page.locator('#request-submit-btn')).toBeVisible();

  const finalState = await page.evaluate(() => window.eval(`(() => ({
    hasBlankModal: !document.getElementById('request-rep-modal').classList.contains('hidden')
      && !document.querySelector('#request-rep-modal .request-choice-card')
      && !document.querySelector('#request-rep-modal .request-entry-control')
      && !!document.querySelector('#request-rep-modal .request-cancel-btn'),
    failureDiagnostic: Array.isArray(window.__REQUEST_CANARY_DIAGNOSTICS__)
      ? window.__REQUEST_CANARY_DIAGNOSTICS__.some((entry) => entry && entry.code === 'REQUEST_FOLDER_GROUP_RENDER_FAILED')
      : false
  }))()`));
  expect(finalState.hasBlankModal).toBe(false);
  expect(finalState.failureDiagnostic).toBe(false);
  expect(pageErrors, `sanitized page errors: ${JSON.stringify(pageErrors)}`).toEqual([]);
  expect(blockedMutations, `production mutation attempted: ${JSON.stringify(blockedMutations)}`).toEqual([]);

  await page.evaluate(() => (window as any).closeRequestModal());
  await expect(modal).toBeHidden();
});
