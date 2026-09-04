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
    const fixture = installMutationBlockedRequestCanaryFixture();
    if (!fixture) throw new Error('REQUEST_CANARY_FIXTURE_UNAVAILABLE');
    document.body.classList.add('ops-precision-pilot');
    showRequestModalBase();
    const canaryGroups = buildExistingRequestFolderCustomerGroups('Hosted Canary Rep');
    selectRepForRequest('Hosted Canary Rep');
    return {
      release: String(window.__APP_SHELL_VERSION__ || ''),
      customerStepVisible: !document.getElementById('step-1.5-folder').classList.contains('hidden'),
      groupLabels: canaryGroups.map((group) => group.label)
    };
  })()`));
  collectPageErrors = true;

  expect(setup.release).toBe(expectedRelease);
  expect(setup.customerStepVisible).toBe(true);
  expect(setup.groupLabels).toContain('Synthetic Canary Customer');
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

test('live Eval Reports #2 flat ITEMCODE cards and multi-select remain actionable without mutations', async ({ page }) => {
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
    if (!collectPageErrors) return;
    pageErrors.push(String(error?.message || 'PAGE_ERROR').replace(/[^a-z0-9 _.-]+/gi, '_').slice(0, 160));
  });

  const nonce = `${Date.now()}-${expectedCommit.slice(0, 7) || 'local'}`;
  await page.goto(`/?post_deploy_eval2_canary=${encodeURIComponent(nonce)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).renderManagerEvalReports2Panel === 'function'
    && typeof (window as any).toggleManagerEvalReport2ItemSelection === 'function');

  const setup = await page.evaluate(() => (window as any).eval(`(() => {
    currentUser = 'dylan_collyge';
    currentUserDisplay = 'Dylan Collyge';
    currentRole = 'Manager';
    canViewManagerEvalReports2 = () => true;
    isEvalWorkManagerUser = () => true;
    const loginView = document.getElementById('view-login');
    if (loginView) {
      loginView.classList.add('hidden');
      loginView.style.setProperty('display', 'none', 'important');
      loginView.style.setProperty('pointer-events', 'none', 'important');
    }
    activeHomeTab = 'eval-reports-2';
    const canaryAssignmentRows = [
      { UNIQUE_ID: 'HOSTED-EVAL2-ASSIGN-A', ITEMCODE: 'CANARY.EVAL.A', GENUSNAME: 'Rosa', ASSIGNEDTO: 'dylan_collyge' },
      { UNIQUE_ID: 'HOSTED-EVAL2-ASSIGN-A2', ITEMCODE: 'CANARY.EVAL.A', GENUSNAME: 'Rosa', ASSIGNEDTO: 'megan_kelly' },
      { UNIQUE_ID: 'HOSTED-EVAL2-ASSIGN-B', ITEMCODE: 'CANARY.EVAL.B', GENUSNAME: 'Acer', ASSIGNEDTO: 'megan_kelly' }
    ];
    processAndLoadData({ data: [
      { UNIQUE_ID: 'HOSTED-EVAL2-A', ITEMCODE: 'CANARY.EVAL.A', GENUSNAME: 'Rosa', COMMONNAME: 'Alpha Eval Canary', CONTSIZE: '#3 TEST', SEASON: 'F1', SALEYEAR: 27, PRIORITY: '', S_LTS: 20, LOCATIONCODE: 'T.01.001', LOTCODE: '27.F1', PTRONHAND: 24, PTRAVAILABLE: 20 },
      { UNIQUE_ID: 'HOSTED-EVAL2-A2', ITEMCODE: 'CANARY.EVAL.A', GENUSNAME: 'Rosa', COMMONNAME: 'Alpha Eval Canary', CONTSIZE: '#3 TEST', SEASON: 'F1', SALEYEAR: 27, PRIORITY: '', S_LTS: 12, LOCATIONCODE: 'U.02.001', LOTCODE: '27.U1', PTRONHAND: 13, PTRAVAILABLE: 12 },
      { UNIQUE_ID: 'HOSTED-EVAL2-B', ITEMCODE: 'CANARY.EVAL.B', GENUSNAME: 'Acer', COMMONNAME: 'Beta Eval Canary', CONTSIZE: '#5 TEST', SEASON: 'F1', SALEYEAR: 27, PRIORITY: '', S_LTS: 18, LOCATIONCODE: 'T.02.001', LOTCODE: '27.F1', PTRONHAND: 19, PTRAVAILABLE: 18 }
    ], warehouseAssignedItemsData: canaryAssignmentRows, _fromCache: true });
    const masterState = getDatasetState('master');
    const assignmentState = getDatasetState('warehouseAssignedItems');
    masterState.initialLoaded = masterState.fullLoaded = true;
    assignmentState.initialLoaded = assignmentState.fullLoaded = true;
    scheduleManagersRender = () => {};
    queueScrollMainAreaToTop = () => {};
    const originalEnsureDatasetLoaded = ensureDatasetLoaded;
    window.__eval2CanaryAssignmentVerified = false;
    ensureDatasetLoaded = async (key, mode, options = {}) => {
      if (key !== 'warehouseAssignedItems') return originalEnsureDatasetLoaded(key, mode, options);
      warehouseAssignedItemsInventory = canaryAssignmentRows.map((row) => ({ ...row }));
      assignmentState.initialLoaded = assignmentState.fullLoaded = true;
      assignmentState.lastLoadedAt = new Date().toISOString();
      window.__eval2CanaryAssignmentVerified = options.force === true;
      invalidateManagerEvalReport2Cache();
      return true;
    };
    invalidateManagerEvalReport2Cache();
    setManagerEvalReport2Mode('reports');
    setManagerEvalReport2('no-pri');
    setManagerEvalReport2Filter('assignedto', 'all');
    const host = document.createElement('main');
    host.id = 'hosted-eval2-canary';
    host.style.cssText = 'position:fixed;inset:0;z-index:9000;width:390px;overflow:auto;background:#fff;';
    host.innerHTML = renderManagerEvalReports2Panel();
    document.body.appendChild(host);
    return { release: String(window.__APP_SHELL_VERSION__ || '') };
  })()`));
  expect(setup.release).toBe(expectedRelease);
  collectPageErrors = true;

  const host = page.locator('#hosted-eval2-canary');
  await expect(host).toContainText('Eval Reports #2');
  await expect(host.locator('.manager-eval2-drive-controls')).toBeVisible();
  await expect(host.locator('.manager-eval2-drive-tabs')).toHaveCount(0);
  await expect(host.locator('#manager-eval-report-2-more-menu')).toBeVisible();
  await host.getByRole('button', { name: /All Users/i }).click();
  const initialUserSheet = page.locator('#manager-eval-user-picker');
  await initialUserSheet.getByRole('checkbox', { name: /dylan_collyge/i }).click();
  await initialUserSheet.getByRole('checkbox', { name: /megan_kelly/i }).click();
  await initialUserSheet.getByRole('button', { name: /Apply 2 Users/i }).click();
  await page.waitForFunction(() => (window as any).__eval2CanaryAssignmentVerified === true);
  await page.evaluate(() => {
    const target = document.getElementById('hosted-eval2-canary')!;
    target.innerHTML = (window as any).renderManagerEvalReports2Panel();
    const records = target.querySelector('#manager-eval-report-2-records')!;
    records.innerHTML = (window as any).getManagerEvalReport2VisibleItemGroups()
      .map((group: unknown, index: number) => (window as any).renderManagerEvalReport2SelectableCard(group, index)).join('');
  });
  await expect(host.getByRole('button', { name: /2 Users/i })).toBeEnabled();
  await expect(host).toContainText('Alpha Eval Canary');
  const alphaCard = host.getByRole('button', { name: /Open Drive Mode Item Inquiry for CANARY\.EVAL\.A/i });
  await expect(alphaCard).toContainText('Location');
  await expect(alphaCard).toContainText('Lot');
  await expect(alphaCard).toContainText('On Hand');
  await expect(alphaCard).toContainText('Available');
  await expect(alphaCard).toContainText('T.01.001');
  await expect(alphaCard).toContainText('27.F1');
  await expect(alphaCard).toContainText('24');
  await expect(alphaCard).toContainText('20');
  await expect(alphaCard).toContainText('U.02.001');
  await expect(alphaCard).toContainText('27.U1');
  const alpha = host.locator('[data-role="manager-eval2-selection-toggle"][data-itemcode="CANARY.EVAL.A"]');
  await alpha.click();
  await expect(alpha).toHaveAttribute('aria-pressed', 'true');
  await expect(host.locator('#manager-eval-report-2-selection-count')).toContainText('1 ITEMCODE');

  const beta = host.locator('[data-role="manager-eval2-selection-toggle"][data-itemcode="CANARY.EVAL.B"]');
  await beta.click();
  await expect(beta).toHaveAttribute('aria-pressed', 'true');
  await expect(host).not.toContainText('Open ITEMCODE Details');
  await expect(host.locator('#manager-eval-report-2-selection-count')).toContainText('2 ITEMCODEs');
  await expect(host.locator('#manager-eval-report-2-report-select')).toBeEnabled();
  await host.locator('#manager-eval-report-2-report-select').click();
  await expect(host.locator('input[data-eval2-report-id][value="no-pri"]')).toBeChecked();
  await expect(host.locator('input[data-eval2-report-id]')).toHaveCount(11);
  await expect(host.getByRole('button', { name: 'Apply Reports' })).toBeEnabled();
  await host.locator('#manager-eval-report-2-report-select').click();
  await expect(host.locator('#manager-eval-report-2-select-shown')).toContainText('Deselect Shown');

  await host.getByRole('button', { name: /2 Users/i }).click();
  const userSheet = page.locator('#manager-eval-user-picker');
  await expect(userSheet).toBeVisible();
  await userSheet.getByRole('checkbox', { name: /megan_kelly/i }).click();
  await page.evaluate(() => { (window as any).__eval2CanaryAssignmentVerified = false; });
  await userSheet.getByRole('button', { name: /Apply 1 User/i }).click();
  await page.waitForFunction(() => (window as any).__eval2CanaryAssignmentVerified === true);
  await page.evaluate(() => {
    const target = document.getElementById('hosted-eval2-canary')!;
    target.innerHTML = (window as any).renderManagerEvalReports2Panel();
    const records = target.querySelector('#manager-eval-report-2-records')!;
    records.innerHTML = (window as any).getManagerEvalReport2VisibleItemGroups()
      .map((group: unknown, index: number) => (window as any).renderManagerEvalReport2SelectableCard(group, index)).join('');
  });
  await expect(host).toContainText('Alpha Eval Canary');
  await expect(host).not.toContainText('Beta Eval Canary');

  const state = await page.evaluate(() => (window as any).eval(`(() => ({
    selected: getManagerEvalReport2SelectedItems().map((entry) => entry.itemCode).sort(),
    report: getManagerEvalReport2SelectedItems()[0]?.reportId || '',
    assignedToUsers: getManagerEvalReport2SelectedItems()[0]?.assignedToUsers || [],
    activeUsers: getManagerEvalAssignedUsers('eval2'),
    hasLegacySelectMode: document.getElementById('hosted-eval2-canary').textContent.includes('Select Items')
  }))()`));
  expect(state).toEqual({
    selected: ['CANARY.EVAL.A'],
    report: 'no-pri',
    assignedToUsers: ['dylan_collyge'],
    activeUsers: ['dylan_collyge'],
    hasLegacySelectMode: false,
  });

  await page.evaluate(() => (window as any).eval(`(async () => {
    assignableAppUsers = [
      { username: 'assigned_evaluator', display: 'Assigned Evaluator', email: 'assigned-evaluator@example.invalid' },
      { username: 'dylan_collyge', display: 'Dylan Collyge', email: 'dylan@example.invalid' },
      { username: 'megan_kelly', display: 'Megan Kelly', email: 'megan@example.invalid' }
    ];
    assignableAppUsersLoaded = true;
    ensureAssignableAppUsers = async () => assignableAppUsers;
    await openManagerEvalReport2BatchSetup();
  })()`));
  const setupSheet = page.locator('#manager-eval2-batch-modal');
  await expect(setupSheet).toBeVisible();
  await expect(setupSheet).toContainText('Dylan');
  await expect(setupSheet).toContainText('Megan');
  await expect(setupSheet).toContainText('ITEMCODE-wide review');
  await expect(setupSheet).toContainText('Every current row for each selected ITEMCODE is included');
  await expect(setupSheet).not.toContainText('Select All Lots');
  await expect(setupSheet).not.toContainText('Block Alpha');
  await expect(setupSheet).not.toContainText('Location/Lot');
  await expect(setupSheet.locator('#manager-eval2-batch-summary')).toContainText('Current rows2');
  await page.evaluate(() => (window as any).eval(`(() => {
    window.__evalWorkCanaryConfirmResult = 'pending';
    showAppConfirm('Confirm the hosted Eval Work prompt layer.', {
      title: 'Confirm Eval Work Batch',
      confirmLabel: 'Create Batch'
    }).then((confirmed) => { window.__evalWorkCanaryConfirmResult = confirmed; });
  })()`));
  const appPrompt = page.locator('#app-prompt-dialog');
  await expect(appPrompt).toBeVisible();
  const modalLayers = await page.evaluate(() => ({
    setup: Number(getComputedStyle(document.getElementById('manager-eval2-batch-modal')!).zIndex || 0),
    prompt: Number(getComputedStyle(document.getElementById('app-prompt-dialog')!).zIndex || 0),
  }));
  expect(modalLayers.prompt).toBeGreaterThan(modalLayers.setup);
  await appPrompt.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForFunction(() => (window as any).__evalWorkCanaryConfirmResult === false);
  await expect(appPrompt).toBeHidden();
  await page.evaluate(() => (window as any).closeManagerEvalReport2BatchSetup());
  expect(pageErrors, `sanitized page errors: ${JSON.stringify(pageErrors)}`).toEqual([]);
  expect(blockedMutations, `production mutation attempted: ${JSON.stringify(blockedMutations)}`).toEqual([]);
});

test('live PO Management uses authenticated PostgREST and never the retired database proxy', async ({ page }) => {
  const blockedMutations: string[] = [];
  const poRequests: string[] = [];
  const pageErrors: string[] = [];

  await page.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    let parsedUrl: URL | null = null;
    try { parsedUrl = new URL(request.url()); } catch {}
    if (method === 'GET' && parsedUrl?.pathname.endsWith('/rest/v1/ph_view_po_27f1_hl')) {
      poRequests.push(parsedUrl.search);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 1, run_id: 'CANARY', row_index: 1, itemcode: 'CANARY.PO.001', commonname: 'Synthetic PO Canary', contsize: '#1 TEST', lotcode: '27.F1', po_remain: 12, built_at: '2026-08-27T00:00:00Z' },
          { id: 2, run_id: 'CANARY', row_index: 2, itemcode: 'CANARY.PO.002', commonname: 'Synthetic PO Canary Two', contsize: '#3 TEST', lotcode: '27.F1', po_remain: 8, built_at: '2026-08-27T00:00:00Z' }
        ])
      });
      return;
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const pathname = parsedUrl?.pathname.replace(/[^a-z0-9_./-]+/gi, '_').slice(0, 120) || 'unknown';
      blockedMutations.push(`${method}:${pathname}`);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  page.on('pageerror', (error) => {
    pageErrors.push(String(error?.message || 'PAGE_ERROR').replace(/[^a-z0-9 _.-]+/gi, '_').slice(0, 160));
  });

  const nonce = `${Date.now()}-${expectedCommit.slice(0, 7) || 'local'}`;
  await page.goto(`/?post_deploy_po_canary=${encodeURIComponent(nonce)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).fetchPoManagementRows === 'function'
    && typeof (window as any).fetchAuthenticatedSupabaseReadPage === 'function');

  const result = await page.evaluate(() => (window as any).eval(`(async () => {
    getNativeAuthRequestHeaders = async () => ({
      apikey: 'synthetic-canary-key',
      Authorization: 'Bearer synthetic-canary-token',
      'Content-Type': 'application/json'
    });
    const rows = await fetchPoManagementRows();
    return {
      release: String(window.__APP_SHELL_VERSION__ || ''),
      rowCount: rows.length,
      itemcodes: rows.map((row) => row.itemcode)
    };
  })()`));

  expect(result.release).toBe(expectedRelease);
  expect(result.rowCount).toBe(2);
  expect(result.itemcodes).toEqual(['CANARY.PO.001', 'CANARY.PO.002']);
  expect(poRequests).toHaveLength(1);
  expect(poRequests[0]).toContain('order=row_index.asc');
  expect(poRequests[0]).toContain('limit=1000');
  expect(poRequests[0]).toContain('offset=0');
  expect(blockedMutations, `retired proxy or mutation attempted: ${JSON.stringify(blockedMutations)}`).toEqual([]);
  expect(pageErrors, `sanitized page errors: ${JSON.stringify(pageErrors)}`).toEqual([]);
});

test('live authorized Admin opens Access Control from the manager module card without mutation', async ({ page }) => {
  const blockedMutations: string[] = [];
  const accessRequests: string[] = [];
  const codexReadRequests: string[] = [];
  const forbiddenPolicyMutations: string[] = [];
  const pageErrors: string[] = [];

  await page.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    let parsedUrl: URL | null = null;
    try { parsedUrl = new URL(request.url()); } catch {}
    const pathname = parsedUrl?.pathname || '';
    if (method === 'POST' && pathname.endsWith('/rest/v1/rpc/get_my_app_permissions_v1')) {
      accessRequests.push(pathname);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          contractVersion: 'app-access-v1',
          enforcementMode: 'audit',
          policyVersion: 1,
          policyRevision: 1,
          username: 'dylan_collyge',
          role: 'ADMIN',
          permissions: [
            { permissionKey: 'module.managers.view', kind: 'module', moduleKey: 'managers', label: 'Managers', allowed: true, scope: null, source: 'role' },
            { permissionKey: 'access_control.manage', kind: 'action', moduleKey: 'access-control', label: 'Access Control', allowed: true, scope: null, source: 'role' }
          ]
        })
      });
      return;
    }
    if (method === 'POST' && pathname.endsWith('/rest/v1/rpc/get_access_control_matrix_v2')) {
      accessRequests.push(pathname);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          contractVersion: 'app-access-view-v2',
          enforcementMode: 'audit',
          policy: { id: 1, version: 1, revision: 1, status: 'draft' },
          capabilities: { canView: true, canEdit: true },
          filters: { modules: ['managers'], roles: ['MANAGER'] },
          page: { subjectType: 'users', subjectOffset: 0, subjectLimit: 100, subjectTotal: 1, permissionOffset: 0, permissionLimit: 8, permissionTotal: 1 },
          summary: { userCount: 1, permissionCount: 1, mismatchCount: 0, baselineMissingCount: 0 },
          permissions: [{ permissionKey: 'module.managers.view', kind: 'module', moduleKey: 'managers', label: 'Managers', scopeOptions: [], sortOrder: 1 }],
          users: [{
            username: 'dylan_collyge',
            displayName: 'Dylan Collyge',
            role: 'ADMIN',
            roleKey: 'ADMIN',
            decisions: { 'module.managers.view': { allowed: true, scope: null, source: 'role' } }
          }],
          roles: []
        })
      });
      return;
    }
    if (method === 'POST' && pathname.endsWith('/functions/v1/codex-ops-api')) {
      let payload: Record<string, unknown> = {};
      try { payload = request.postDataJSON() as Record<string, unknown>; } catch {}
      if (payload.action === 'capabilities') {
        codexReadRequests.push('capabilities');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            contractVersion: 'mobile-codex-ops-v1',
            username: 'dylan_collyge',
            canView: true,
            canSubmit: false,
            canApprove: false,
            submissionEnabled: false,
            deploymentEnabled: false
          })
        });
        return;
      }
    }
    if (pathname.endsWith('/rest/v1/rpc/save_access_control_draft_v1')
      || pathname.endsWith('/rest/v1/rpc/publish_access_control_policy_v1')) {
      forbiddenPolicyMutations.push(`${method}:${pathname}`);
      await route.abort('blockedbyclient');
      return;
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      blockedMutations.push(`${method}:${pathname.replace(/[^a-z0-9_./-]+/gi, '_').slice(0, 120) || 'unknown'}`);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  page.on('pageerror', (error) => {
    pageErrors.push(String(error?.message || 'PAGE_ERROR').replace(/[^a-z0-9 _.-]+/gi, '_').slice(0, 160));
  });

  const nonce = `${Date.now()}-${expectedCommit.slice(0, 7) || 'local'}`;
  await page.goto(`/?post_deploy_access_canary=${encodeURIComponent(nonce)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).initializeAppAccessSnapshot === 'function'
    && typeof (window as any).getAuditedAppPermission === 'function');

  const result = await page.evaluate(() => (window as any).eval(`(async () => {
    if (!installMutationBlockedAccessCanaryIdentity('dylan_collyge', 'Dylan Collyge', 'ADMIN')) throw new Error('ACCESS_CANARY_IDENTITY_UNAVAILABLE');
    const snapshot = await initializeAppAccessSnapshot({ force: true, reason: 'post-deploy-canary' });
    const managers = getAuditedAppPermission('module.managers.view');
    const accessControl = getAuditedAppPermission('access_control.manage');
    const managerView = document.getElementById('view-managers');
    if (!managerView) throw new Error('ACCESS_CANARY_MANAGERS_VIEW_UNAVAILABLE');
    ensureViewDataForRender = () => false;
    scheduleManagersRender = () => renderManagers();
    currentPrimaryViewId = 'managers';
    managerView.classList.remove('hidden');
    renderManagers();
    const moduleCard = Array.from(managerView.querySelectorAll('button.manager-module-card'))
      .find((button) => /access control/i.test(String(button.textContent || '')));
    if (!moduleCard) throw new Error('ACCESS_CANARY_MODULE_CARD_UNAVAILABLE');
    moduleCard.click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    renderManagers();
    const accessCanaryState = getMutationBlockedAccessCanaryState();
    return {
      release: String(window.__APP_SHELL_VERSION__ || ''),
      contractVersion: snapshot && snapshot.contractVersion,
      enforcementMode: snapshot && snapshot.enforcementMode,
      username: snapshot && snapshot.username,
      managersAllowed: managers && managers.allowed,
      managersSource: managers && managers.source,
      accessControlAllowed: accessControl && accessControl.allowed,
      accessControlSource: accessControl && accessControl.source,
      matrixContract: accessCanaryState && accessCanaryState.matrixContract,
      canViewMatrix: accessCanaryState && accessCanaryState.canViewMatrix,
      canEditMatrix: accessCanaryState && accessCanaryState.canEditMatrix,
      codexContract: codexOpsState && codexOpsState.capabilities && codexOpsState.capabilities.contractVersion,
      codexSubmissionEnabled: codexOpsState && codexOpsState.capabilities && codexOpsState.capabilities.submissionEnabled,
      codexDeploymentEnabled: codexOpsState && codexOpsState.capabilities && codexOpsState.capabilities.deploymentEnabled,
      managerSearchPlaceholder: getManagersSearchPlaceholder()
    };
  })()`));

  expect(accessRequests).toEqual([
    '/rest/v1/rpc/get_my_app_permissions_v1',
    '/rest/v1/rpc/get_access_control_matrix_v2'
  ]);
  expect(codexReadRequests).toEqual(['capabilities']);
  expect(result).toEqual({
    release: expectedRelease,
    contractVersion: 'app-access-v1',
    enforcementMode: 'audit',
    username: 'dylan_collyge',
    managersAllowed: true,
    managersSource: 'role',
    accessControlAllowed: true,
    accessControlSource: 'role',
    matrixContract: 'app-access-view-v2',
    canViewMatrix: true,
    canEditMatrix: true,
    codexContract: 'mobile-codex-ops-v1',
    codexSubmissionEnabled: false,
    codexDeploymentEnabled: false,
    managerSearchPlaceholder: 'Search usernames, names, roles, or permissions...'
  });
  expect(forbiddenPolicyMutations).toEqual([]);
  expect(blockedMutations, `unexpected mutation attempted: ${JSON.stringify(blockedMutations)}`).toEqual([]);
  expect(pageErrors, `sanitized page errors: ${JSON.stringify(pageErrors)}`).toEqual([]);
});
