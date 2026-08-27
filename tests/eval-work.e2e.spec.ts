import { expect, test } from '@playwright/test';

test('assigned Eval Work is a phone-safe single-column editor with every AV Note reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=V2026.08.27.03', { waitUntil: 'domcontentloaded' });
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
