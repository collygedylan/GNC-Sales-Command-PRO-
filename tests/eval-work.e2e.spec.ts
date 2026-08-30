import { expect, test } from '@playwright/test';

test('assigned Eval Work is a phone-safe single-column editor with every AV Note reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=V2026.08.30.02', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).renderEvalWorkDetail === 'function');

  const result = await page.evaluate(() => window.eval(`(() => {
    currentUser = 'assigned_evaluator';
    currentUserDisplay = 'Assigned Evaluator';
    evalWorkManager = false;
    processAndLoadData({ avNotesData: Array.from({ length: 80 }, (_, index) => ({ AV_NOTE: 'Evaluation option ' + String(index + 1).padStart(2, '0') })), _fromCache: true });
    const origin = {
      UNIQUE_ID: 'eval-origin-1', ITEMCODE: 'TEST.001', COMMONNAME: 'Synthetic Test Item', CONTSIZE: '#3',
      LOCATIONCODE: 'A.01.001', LOTCODE: '27.F1', SEASON: 'F1', SALEYEAR: '27', SOURCE: 'LD',
      PTRONHAND: 125, PTRAVAILABLE: 120, PRIORITY: '1', HOLDSTOPCODE: '', HOLDSTOPREASON: ''
    };
    const context = [origin, { ...origin, UNIQUE_ID: 'eval-context-2', LOCATIONCODE: 'B.02.001', LOTCODE: '27.S1', SEASON: 'S1', PTRONHAND: 40 }];
    const work = {
      id: 'eval-work-browser-fixture', status: 'open', version: 1, itemcode: 'TEST.001', commonname: 'Synthetic Test Item', contsize: '#3',
      origin_unique_id: 'eval-origin-1', origin_locationcode: 'A.01.001', origin_lotcode: '27.F1', origin_snapshot: origin,
      assignee_username: 'assigned_evaluator', assignee_display: 'Assigned Evaluator', instructions: 'Inspect the exact origin row.',
      context_rows: context, inquiry_draft: { rowOverlays: [], transaction: { requestActions: [], holdStopProposals: [] } },
      evidence_draft: { photos: [], spec: '', caliper: '', locMatchPercent: '', avNote: '', pickNote: '', comments: '' },
      delivery: { assignment: { status: 'delivered' } }
    };
    evalWorkRows = [work];
    activeEvalWorkDetailId = work.id;
    const host = document.createElement('main');
    host.id = 'eval-work-browser-host';
    host.style.width = '390px';
    host.innerHTML = renderEvalWorkDetail(work);
    document.body.appendChild(host);
    const ids = ['eval-work-spec', 'eval-work-caliper', 'eval-work-loc-match', 'eval-work-av-note', 'eval-work-pick-note', 'eval-work-comments'];
    const fields = ids.map((id) => document.getElementById(id));
    const photoInput = host.querySelector('input[type="file"][capture="environment"]');
    const tray = host.querySelector('.eval-work-action-tray');
    openEvalWorkAvNoteSheet();
    const choices = Array.from(document.querySelectorAll('#eval-work-av-note-choices button'));
    const lastChoice = choices[choices.length - 1];
    if (lastChoice) lastChoice.scrollIntoView({ block: 'nearest' });
    const controls = Array.from(host.querySelectorAll('input:not([type="hidden"]), textarea, button, label.eval-work-photo-add')).map((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, width: box.width };
    });
    return {
      fieldsPresent: fields.every(Boolean),
      photoCapture: !!photoInput,
      rowSections: host.querySelectorAll('.argos-reclass-row-card').length,
      actionButtons: host.querySelectorAll('.argos-reclass-action-btn').length,
      trayPosition: tray ? getComputedStyle(tray).position : '',
      saveAndSubmit: !!tray && /Save Draft/.test(tray.textContent || '') && /Submit/.test(tray.textContent || ''),
      avChoices: choices.length,
      lastAvChoice: lastChoice ? lastChoice.textContent : '',
      noHorizontalOverflow: host.scrollWidth <= 391,
      controlsFit: controls.length > 0 && controls.every((box) => box.left >= -0.5 && box.right <= 390.5 && box.width <= 391)
    };
  })()`));

  expect(result.fieldsPresent).toBe(true);
  expect(result.photoCapture).toBe(true);
  expect(result.rowSections).toBe(2);
  expect(result.actionButtons).toBeGreaterThanOrEqual(8);
  expect(['sticky', 'fixed']).toContain(result.trayPosition);
  expect(result.saveAndSubmit).toBe(true);
  expect(result.avChoices).toBe(80);
  expect(result.lastAvChoice).toContain('80');
  expect(result.noHorizontalOverflow).toBe(true);
  expect(result.controlsFit).toBe(true);
});

test('Reclass Send as Review uses the shared searchable single-evaluator sheet on phones', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=V2026.08.30.02', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).chooseEvalWorkAssignee === 'function');

  await page.evaluate(() => window.eval(`(() => {
    currentUser = 'dylan_collyge';
    currentUserDisplay = 'Dylan Collyge';
    assignableAppUsersLoaded = true;
    evalWorkSetupState = { assigneeUsername: '', assigneeEmail: '', instructions: '', completionRecipients: [] };
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
  await expect(page.locator('#grouped-bloom-ncr-recipient-send-btn')).toHaveText('Use Evaluator');
  await expect(page.locator('#grouped-bloom-ncr-recipient-bulk-actions')).toBeHidden();

  await page.locator('#grouped-bloom-ncr-recipient-search').fill('Kayla');
  const evaluator = page.locator('#grouped-bloom-ncr-recipient-list button', { hasText: 'kayla_knepp' });
  await expect(evaluator).toBeVisible();
  await evaluator.click();
  await expect(evaluator).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#grouped-bloom-ncr-recipient-send-btn').click();

  await expect(picker).toBeHidden();
  await expect(page.locator('#eval-work-setup-assignee-copy')).toContainText('kayla_knepp');
  const result = await page.evaluate(() => window.eval(`({
    assignee: getEvalWorkSetupAssignee() && getEvalWorkSetupAssignee().username,
    pickerZ: Number.parseInt(getComputedStyle(document.getElementById('grouped-bloom-ncr-recipient-modal')).zIndex || '0', 10),
    setupZ: Number.parseInt(getComputedStyle(document.getElementById('eval-work-setup-modal')).zIndex || '0', 10)
  })`));
  expect(result.assignee).toBe('kayla_knepp');
  expect(result.pickerZ).toBeGreaterThan(result.setupZ);
});

test('Queue Eval Work renders every stored Drive Mode origin instead of retaining the prior queue', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=V2026.08.30.02', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).renderEvalWorkQueue === 'function');

  const result = await page.evaluate(() => window.eval(`(() => {
    currentUser = 'dylan_collyge';
    currentUserDisplay = 'Dylan Collyge';
    evalWorkManager = true;
    evalWorkLoaded = true;
    evalWorkLoading = false;
    evalWorkError = '';
    evalWorkStatusFilter = 'all';
    evalWorkAssigneeFilter = 'all';
    evalWorkBlockAlphaFilter = '';
    evalWorkBlockNumberFilter = '';
    evalWorkRows = [{
      id: 'eval-work-drive-rows', status: 'open', version: 1, itemcode: '007541.051.1',
      commonname: 'Blue Bayou Pampas Grass', contsize: '#3', assignee_username: 'dylan_collyge',
      assignee_display: 'Dylan Collyge', updated_at: '2026-08-30T15:47:10.528Z',
      contract_version: 'eval-work-v2-multi-origin',
      origins: [
        { origin_unique_id: 'drive-origin-1', locationcode: 'F.08.000', lotcode: '26.X', block_alpha: 'F', block_number: '08', origin_snapshot: {} },
        { origin_unique_id: 'drive-origin-2', locationcode: 'F.16.000', lotcode: '27.S1', block_alpha: 'F', block_number: '16', origin_snapshot: {} },
        { origin_unique_id: 'drive-origin-3', locationcode: 'E.07.000', lotcode: '26.U2', origin_snapshot: { BLOCKALPHA: 'E', BLOCKNUMBER: '07' } }
      ]
    }];
    const previousMarkup = '<div id="previous-queue-card">Suspend Tag</div>';
    const host = document.createElement('main');
    host.id = 'eval-work-queue-regression-host';
    host.innerHTML = previousMarkup;
    document.body.appendChild(host);
    const html = renderEvalWorkQueue();
    host.innerHTML = html;
    const originEntries = getEvalWorkOriginEntries(evalWorkRows[0]);
    return {
      replacedPriorQueue: !host.querySelector('#previous-queue-card'),
      blockAlphaF: originEntries.some((origin) => origin.block_alpha === 'F' && ['08', '16'].includes(origin.block_number)),
      blockAlphaE: originEntries.some((origin) => origin.block_alpha === 'E' && origin.block_number === '07'),
      everyOriginGrouped: originEntries.length === 3 && originEntries.every((origin) => origin.block_alpha && origin.block_number),
      queueHtml: html.length > 0
    };
  })()`));

  expect(result).toEqual({
    replacedPriorQueue: true,
    blockAlphaF: true,
    blockAlphaE: true,
    everyOriginGrouped: true,
    queueHtml: true
  });
});
