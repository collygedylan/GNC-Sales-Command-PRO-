import { expect, test } from '@playwright/test';
import { installHlOrderFixture } from './fixtures/hl-order-state.mjs';

test('Request editing calculates immediately and renders a usable form', async ({ page, baseURL }) => {
  await installHlOrderFixture(page, baseURL, { startupMode: 'cold' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(() => window.eval(`(() => {
    const now = new Date().toISOString();
    const row = { UNIQUE_ID: 'request-edit-fixture', DOM_ID: 'request-edit-fixture', SOURCE_TABLE: 'ph_active_request',
      ITEMCODE: '001.020', COMMONNAME: 'Request test Hosta', CONTSIZE: '#1', LOTCODE: '27.F1', SEASON: 'F1', SALEYEAR: '27',
      LOCATIONCODE: 'C.09.000', PTRONHAND: '911', PTRAVAILABLE: '0', PHOTO_MATCH_PTR_AVAILABLE_KNOWN: false, REQ_INITIAL_PTR: '911', HOLDSTOPCODE: 'H',
      QUANTITY: '100', REQ_QTY: '100', REQ_PHOTO_LINK: 'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/v2/current.webp',
      REQ_PHOTO_UPDATED_AT: now, REQ_PHOTO_NAME: 'current.webp', REQ_MATCH: '100', REQ_SPEC: '4-6 H', REQUEST_FOLDER: 'fixture',
      REQUESTED_BY: 'dylan_collyge', SALESREPNAME: 'Fixture Rep' };
    syncMasterFieldsToRequestRow({ ...row, UNIQUE_ID: 'master-fixture', PTRAVAILABLE: '911', PHOTO_MATCH_PTR_AVAILABLE_KNOWN: true }, row);
    requestsInventory = [row];
    window.__requestTrace = [];
    const original = verifyRequestDetailRendered;
    verifyRequestDetailRendered = function(...args) {
      const controls = ['req-match', 'req-spec', 'req-av-note', 'req-btn-save-complete'].map(id => {
        const el = document.getElementById(id);
        const hidden = []; for(let p=el;p;p=p.parentElement) if(getComputedStyle(p).display==='none') hidden.push(p.id || p.className);
        return { id, rects: el?.getClientRects().length, hidden };
      });
      const result = original(...args); window.__requestTrace.push({ args, controls, result }); return result;
    };
    openDetail(row.DOM_ID, 'request');
  })()`));
  await page.waitForTimeout(1500);
  if (await page.locator('#request-open-info-modal').isVisible()) await page.locator('#request-open-info-ok').click();
  const result = await page.evaluate(() => window.eval(`({trace:window.__requestTrace, error: document.getElementById('request-detail-load-state').textContent,
    item: {photo:activeItem.REQ_PHOTO_LINK, evidence:getLocPhotoEvidenceState(activeItem,'request')}, view:activeDetailTab})`));
  console.log(JSON.stringify(result));
  expect(result.error).toBe('');
  expect(errors).toEqual([]);
  const customKeyboard = await page.evaluate(() => (window as any).shouldPreferDetailMeasurementKeyboard()
    && (window as any).isDetailMeasurementKeyboardInput(document.getElementById('req-match')));
  if (customKeyboard) {
    await page.locator('#req-match').click();
    await page.locator('#detail-measurement-keyboard [data-key-token="__clear"]').first().click();
    await page.locator('#detail-measurement-keyboard [data-key-token="5"]').click();
    await page.locator('#detail-measurement-keyboard [data-key-token="0"]').click();
  } else await page.locator('#req-match').fill('50');
  await expect(page.locator('#req-match')).toHaveValue('50');
  await expect(page.locator('#req-match-qty-val')).toHaveText('456', { timeout: 1000 });
  const states = await page.evaluate(() => window.eval(`(() => {
    clearQueuedLagSensitiveInputSave('req-');
    const master = { ...activeItem, PTRAVAILABLE: 0, PHOTO_MATCH_PTR_AVAILABLE_KNOWN: true };
    syncMasterFieldsToRequestRow(master, activeItem);
    calculateMatchQty('req-');
    const zero = document.getElementById('req-match-qty-val').textContent;
    syncMasterFieldsToRequestRow({ ...master, PHOTO_MATCH_PTR_AVAILABLE_KNOWN: false }, activeItem);
    calculateMatchQty('req-');
    const unknown = document.getElementById('req-match-qty-val').textContent;
    syncMasterFieldsToRequestRow({ ...master, PTRAVAILABLE: '911' }, activeItem);
    activeItem.REQ_PHOTO_LINK = ''; activeItem.REQ_PHOTO_NAME = ''; normalizeRowPhotoFields(activeItem);
    calculateMatchQty('req-');
    return { zero, unknown };
  })()`));
  expect(states).toEqual({ zero: '0', unknown: 'Not verified' });
  await page.evaluate(() => window.eval(`(() => {
    applyUploadedPhotoFieldsToItem(activeItem, 'req-',
      'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/v2/photo_' + Date.now() + '.webp',
      'photo_' + Date.now() + '.webp');
    refreshPendingPhotoUiForItem(activeItem, 'req-');
  })()`));
  await expect(page.locator('#req-match-qty-val')).toHaveText('456');
});
