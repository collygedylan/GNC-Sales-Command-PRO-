import { expect, test } from '@playwright/test';

test('opened Eval Work row has exactly two phone-safe Pictures & Specs and Item Inquiry tabs', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=V2026.08.31.03&post_deploy_access_canary=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).renderEvalWorkDetail === 'function');

  const result = await page.evaluate(() => window.eval(`(async () => {
    currentUser = 'assigned_evaluator';
    currentUserDisplay = 'Assigned Evaluator';
    installMutationBlockedAccessCanaryIdentity('assigned_evaluator', 'Assigned Evaluator', 'User');
    evalWorkManager = false;
    processAndLoadData({ avNotesData: Array.from({ length: 80 }, (_, index) => ({ COMMONNAME: 'Synthetic Test Item', SALESNOTE: 'Evaluation option ' + String(index + 1).padStart(2, '0') })), _fromCache: true });
    getDatasetState('avNotes').initialLoaded = true;
    const origin = {
      UNIQUE_ID: 'eval-origin-1', ITEMCODE: 'TEST.001', COMMONNAME: 'Synthetic Test Item', CONTSIZE: '#3',
      LOCATIONCODE: 'A.01.001', LOTCODE: '27.F1', SEASON: 'F1', SALEYEAR: '27', SOURCE: 'LD',
      PTRONHAND: 125, PTRAVAILABLE: 120, PRIORITY: '1', HOLDSTOPCODE: '', HOLDSTOPREASON: '', SALESNOTE: 'First location note'
    };
    const secondOrigin = { ...origin, UNIQUE_ID: 'eval-origin-2', LOCATIONCODE: 'B.02.001', LOTCODE: '27.S1', SEASON: 'S1', PTRONHAND: 40, SALESNOTE: 'Second location note' };
    const context = [origin, secondOrigin];
    const work = {
      id: 'eval-work-browser-fixture', status: 'open', version: 1, itemcode: 'TEST.001', commonname: 'Synthetic Test Item', contsize: '#3',
      origin_unique_id: 'eval-origin-1', origin_locationcode: 'A.01.001', origin_lotcode: '27.F1', origin_snapshot: origin,
      assignee_username: 'assigned_evaluator', assignee_display: 'Assigned Evaluator', instructions: 'Inspect the exact origin row.',
      contract_version: 'eval-work-v2-multi-origin', source_context: { scopeContract: 'itemcode-all-rows-v1' },
      origins: [
        { origin_unique_id: 'eval-origin-1', locationcode: 'A.01.001', lotcode: '27.F1', origin_snapshot: origin, evidence_draft: {} },
        { origin_unique_id: 'eval-origin-2', locationcode: 'B.02.001', lotcode: '27.S1', origin_snapshot: secondOrigin, evidence_draft: {} }
      ],
      context_rows: context, inquiry_draft: { rowOverlays: [], transaction: { requestActions: [], holdStopProposals: [] } },
      evidence_draft: {
        'eval-origin-1': { photos: [{ filePath: 'eval/fixture/one.jpg', name: 'one.jpg' }], spec: '24 inch', caliper: '', locMatchPercent: '100', avNote: 'Verified', pickNote: '', comments: 'First location note', picturesSpecsResolution: 'done' },
        'eval-origin-2': { photos: [{ filePath: 'eval/fixture/two.jpg', name: 'two.jpg' }], spec: '30 inch', caliper: '', locMatchPercent: '95', avNote: 'Verified', pickNote: '', comments: 'Second location note', picturesSpecsResolution: 'done' }
      },
      delivery: { assignment: { status: 'delivered' } }
    };
    let capturedSubmit = null;
    let confirmationCount = 0;
    const toastLog = [];
    showToast = (title, message) => { toastLog.push([String(title || ''), String(message || '')]); };
    showAppConfirm = async () => { confirmationCount += 1; return true; };
    evalWorkApi = async (operation, payload) => {
      if (operation === 'submit') {
        capturedSubmit = payload;
        return { ok: true, data: { ...work, status: 'submitted', version: 2, delivery: { completion: { status: 'queued' } } } };
      }
      if (operation === 'list') return { ok: true, data: [work], manager: false };
      if (operation === 'save') return { ok: true, data: { ...work, version: Number(work.version || 1) + 1 } };
      return { ok: true, data: {} };
    };
    await loadEvalWorkAssignments(true);
    openEvalWorkDetail(work.id, encodeURIComponent('eval-origin-2'));
    const host = document.createElement('main');
    host.id = 'eval-work-browser-host';
    host.style.width = '390px';
    host.innerHTML = renderEvalWorkDetail(work);
    document.body.appendChild(host);
    const ids = ['eval-work-spec', 'eval-work-caliper', 'eval-work-loc-match', 'eval-work-av-note', 'eval-work-pick-note'];
    const fields = ids.map((id) => document.getElementById(id));
    const photoInput = host.querySelector('input[type="file"][capture="environment"]');
    const tray = host.querySelector('.eval-work-action-tray');
    const noManualActionTray = !tray && !/Save Draft|Submit/.test(host.textContent || '');
    filterEvalWorkAvNotes('');
    const choices = Array.from(document.querySelectorAll('#eval-work-av-dropdown-list button'));
    const lastChoice = choices[choices.length - 1];
    if (lastChoice) lastChoice.scrollIntoView({ block: 'nearest' });
    const controls = Array.from(host.querySelectorAll('input:not([type="hidden"]), textarea, button, label.eval-work-photo-add')).map((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, width: box.width };
    });
    const evaluationResult = {
      fieldsPresent: fields.every(Boolean),
      openedCardHeading: host.querySelector('.eval-work-evidence h3')?.textContent || '',
      noLotSelector: !host.querySelector('.eval-work-origin-tabs'),
      itemInquiryHidden: !host.querySelector('.eval-work-inquiry'),
      topTabs: Array.from(host.querySelectorAll('.eval-work-detail-tab')).map((tab) => (tab.textContent || '').trim()),
      commentsValue: host.querySelector('#eval-work-comments')?.value || '',
      editableNote: !!host.querySelector('#eval-work-comments'),
      picturesMarkDone: !!host.querySelector('.eval-work-pictures-done'),
      standardAvInput: host.querySelector('#eval-work-av-note')?.type === 'text'
    };
    setEvalWorkDetailView('item-inquiry', work);
    host.innerHTML = renderEvalWorkDetail(work);
    const rowCards = Array.from(host.querySelectorAll('[data-reclass-row-card]'));
    rowCards[1].querySelector('[data-eval-row-resolution-action="no_action"]')?.click();
    rowCards[0].querySelector('.argos-reclass-row-toggle')?.click();
    rowCards[0].querySelector('[data-reclass-v3-action="recount"]')?.click();
    rowCards[0].querySelector('[data-eval-row-resolution-action="done"]')?.click();
    const reviewedInquiry = collectEvalWorkInquiryPayload(work);
    const resolutionSummary = validateEvalWorkInquiryRowResolutions(work, reviewedInquiry);
    await queueEvalWorkAutomaticCompletion();
    const inquiryResult = {
      present: !!host.querySelector('.eval-work-inquiry'),
      rowSections: host.querySelectorAll('.argos-reclass-row-card').length,
      actionButtons: host.querySelectorAll('.argos-reclass-action-btn').length,
      resolutionButtons: host.querySelectorAll('.eval-work-row-resolution-btn').length,
      rowResolutions: Array.from(host.querySelectorAll('[data-reclass-row-card]')).map((card) => card.getAttribute('data-eval-row-resolution')),
      payloadResolutions: reviewedInquiry.rowOverlays.map((overlay) => overlay.resolution),
      resolutionSummary,
      automaticSubmit: !!capturedSubmit && capturedSubmit.workId === work.id && capturedSubmit.inquiry.rowOverlays.every((overlay) => ['done', 'no_action'].includes(overlay.resolution)),
      confirmationCount,
      sentToast: toastLog.some(([title]) => title === 'Item Inquiry Sent'),
      evaluationHidden: !host.querySelector('.eval-work-evidence'),
      locSalesNoteHidden: !host.querySelector('.eval-work-loc-sales-note')
    };
    return {
      evaluationResult,
      inquiryResult,
      photoCapture: !!photoInput,
      noManualActionTray,
      avChoices: choices.length,
      lastAvChoice: lastChoice ? lastChoice.textContent : '',
      noHorizontalOverflow: host.scrollWidth <= 391,
      controlsFit: controls.length > 0 && controls.every((box) => box.left >= -0.5 && box.right <= 390.5 && box.width <= 391)
    };
  })()`));

  expect(result.evaluationResult).toEqual({
    fieldsPresent: true,
    openedCardHeading: 'Pictures & Specs: B.02.001 / 27.S1',
    noLotSelector: true,
    itemInquiryHidden: true,
    topTabs: ['Pictures & Specs', 'Item Inquiry'],
    commentsValue: 'Second location note',
    editableNote: true,
    picturesMarkDone: true,
    standardAvInput: true
  });
  expect(result.inquiryResult, JSON.stringify(result.inquiryResult)).toMatchObject({
    present: true,
    rowSections: 2,
    resolutionButtons: 4,
    rowResolutions: ['done', 'no_action'],
    payloadResolutions: ['done', 'no_action'],
    resolutionSummary: { total: 2, done: 1, noAction: 1 },
    automaticSubmit: true,
    confirmationCount: 0,
    sentToast: true
  });
  expect(result.inquiryResult.actionButtons).toBeGreaterThanOrEqual(8);
  expect(result.inquiryResult.evaluationHidden).toBe(true);
  expect(result.inquiryResult.locSalesNoteHidden).toBe(true);
  expect(result.photoCapture).toBe(true);
  expect(result.noManualActionTray).toBe(true);
  expect(result.avChoices).toBe(80);
  expect(result.lastAvChoice).toContain('80');
  expect(result.noHorizontalOverflow).toBe(true);
  expect(result.controlsFit).toBe(true);
});

test('Reclass Send as Review uses the searchable multi-evaluator Eval roster on phones', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=V2026.08.31.03', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).chooseEvalWorkAssignee === 'function');

  await page.evaluate(() => window.eval(`(() => {
    currentUser = 'dylan_collyge';
    currentUserDisplay = 'Dylan Collyge';
    assignableAppUsersLoaded = true;
    evalWorkSetupState = { assigneeUsernames: [], instructions: '', completionRecipients: [] };
    argosInventoryTransactionState = {
      snapshot: { commonName: 'Synthetic Review Item', itemCode: 'TEST.001', contSize: '#3', uniqueId: 'review-origin', locationCode: 'A.01.001', lotCode: '27.F1' },
      item: { UNIQUE_ID: 'review-origin', ITEMCODE: 'TEST.001', COMMONNAME: 'Synthetic Review Item', CONTSIZE: '#3', LOCATIONCODE: 'A.01.001', LOTCODE: '27.F1' }
    };
    const modal = ensureEvalWorkSetupModal();
    modal.classList.remove('hidden');
    syncEvalWorkSetupSummary();
  })()`));

  await page.locator('#eval-work-setup-assignee-button').click();
  const picker = page.locator('#grouped-bloom-ncr-recipient-modal');
  await expect(picker).toBeVisible();
  await expect(page.locator('#grouped-bloom-ncr-recipient-title')).toHaveText('Select Evaluator');
  await expect(page.locator('#grouped-bloom-ncr-recipient-send-btn')).toHaveText('Use Evaluators');
  await expect(page.locator('#grouped-bloom-ncr-recipient-bulk-actions')).toBeVisible();

  await page.locator('#grouped-bloom-ncr-recipient-search').fill('Kayla');
  const evaluator = page.locator('#grouped-bloom-ncr-recipient-list button', { hasText: 'kayla_knepp' });
  await expect(evaluator).toBeVisible();
  await evaluator.click();
  await expect(evaluator).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#grouped-bloom-ncr-recipient-search').fill('JD Jones');
  const honoraryEvaluator = page.locator('#grouped-bloom-ncr-recipient-list button', { hasText: 'jd_jones' });
  await expect(honoraryEvaluator).toBeVisible();
  await honoraryEvaluator.click();
  await expect(honoraryEvaluator).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#grouped-bloom-ncr-recipient-send-btn').click();

  await expect(picker).toBeHidden();
  await expect(page.locator('#eval-work-setup-assignee-copy')).toContainText('kayla_knepp');
  const result = await page.evaluate(() => window.eval(`({
    assignees: getEvalWorkSetupAssignees().map((entry) => entry.username),
    pickerZ: Number.parseInt(getComputedStyle(document.getElementById('grouped-bloom-ncr-recipient-modal')).zIndex || '0', 10),
    setupZ: Number.parseInt(getComputedStyle(document.getElementById('eval-work-setup-modal')).zIndex || '0', 10)
  })`));
  expect([...result.assignees].sort()).toEqual(['jd_jones', 'kayla_knepp']);
  expect(result.pickerZ).toBeGreaterThan(result.setupZ);
});

test('Queue Eval Work renders every stored Drive Mode origin as a Request-style row card', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=V2026.08.31.03', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).renderEvalWorkQueue === 'function');

  const result = await page.evaluate(() => window.eval(`(() => {
    const fixtureRows = [{
      id: 'eval-work-drive-rows', status: 'open', version: 1, itemcode: '007541.051.1',
      commonname: 'Blue Bayou Pampas Grass', contsize: '#3', assignee_username: 'dylan_collyge',
      assignee_display: 'Dylan Collyge', updated_at: '2026-08-30T15:47:10.528Z',
      contract_version: 'eval-work-v2-multi-origin',
      source_context: { report: { reportId: 's1-with-pri', reportLabel: 'S1WithPRI' } },
      origins: [
        { origin_unique_id: 'drive-origin-1', locationcode: 'F.08.000', lotcode: '26.X', block_alpha: 'F', block_number: '08', origin_snapshot: { PTRONHAND: 12 } },
        { origin_unique_id: 'drive-origin-2', locationcode: 'F.16.000', lotcode: '27.S1', block_alpha: 'F', block_number: '16', origin_snapshot: { PTRONHAND: 7 } },
        { origin_unique_id: 'drive-origin-3', locationcode: 'E.07.000', lotcode: '26.U2', origin_snapshot: { BLOCKALPHA: 'E', BLOCKNUMBER: '07', PTRONHAND: 4 } }
      ]
    }, {
      id: 'eval-work-other-user', status: 'open', version: 1, itemcode: 'OTHER.001',
      commonname: 'Other Evaluator Item', contsize: '#5', assignee_username: 'megan_kelly',
      assignee_display: 'Megan Kelly', updated_at: '2026-08-30T15:48:10.528Z',
      contract_version: 'eval-work-v2-multi-origin',
      origins: [{ origin_unique_id: 'other-origin', locationcode: 'A.01.000', lotcode: '26.Z', block_alpha: 'A', block_number: '01', origin_snapshot: {} }]
    }];
    const previousMarkup = '<div id="previous-queue-card">Suspend Tag</div>';
    const host = document.createElement('main');
    host.id = 'eval-work-queue-regression-host';
    host.innerHTML = previousMarkup;
    document.body.appendChild(host);
    const html = renderEvalWorkQueue({ rows: fixtureRows, manager: true, statusFilter: 'all', assigneeFilter: 'dylan_collyge' });
    host.innerHTML = html;
    const cards = Array.from(host.querySelectorAll('[data-eval-work-origin-row="true"]'));
    return {
      replacedPriorQueue: !host.querySelector('#previous-queue-card'),
      requestStyleCards: cards.length === 3 && cards.every((card) => card.classList.contains('app-request-card-surface')),
      everyLocationVisible: ['F.08.000', 'F.16.000', 'E.07.000'].every((location) => host.textContent.includes(location)),
      everyLotVisible: ['26.X', '27.S1', '26.U2'].every((lot) => host.textContent.includes(lot)),
      noBlockDrillCards: !host.querySelector('.eval-work-drill-card'),
      sharedAssignment: cards.every((card) => card.getAttribute('data-eval-work-id') === 'eval-work-drive-rows'),
      sourceReportVisible: cards.every((card) => card.querySelector('.app-card-subline-source')?.textContent?.trim() === 'S1WithPRI'),
      otherEvaluatorHidden: !host.textContent.includes('Other Evaluator Item')
    };
  })()`));

  expect(result).toEqual({
    replacedPriorQueue: true,
    requestStyleCards: true,
    everyLocationVisible: true,
    everyLotVisible: true,
    noBlockDrillCards: true,
    sharedAssignment: true,
    sourceReportVisible: true,
    otherEvaluatorHidden: true
  });
});
