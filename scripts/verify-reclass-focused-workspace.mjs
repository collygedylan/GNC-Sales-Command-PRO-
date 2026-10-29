import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

// Exercises deployed UI with disposable rows and an intercepted save service.
// Never sends a production mutation, email, or worker wake.
export async function verifyReclassFocusedWorkspace({ preview = false, evidenceDirectory, url = 'https://agmetricapp.com/' } = {}) {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await context.route('**/functions/v1/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"rows":[],"data":[]}' }));
    await context.route('**/rest/v1/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await context.route('**/script.google.com/**', route => route.abort());
    if (preview) {
      const [runtime, html] = await Promise.all([readFile(new URL('../assets/app-runtime.js', import.meta.url), 'utf8'), readFile(new URL('../index.html', import.meta.url), 'utf8')]);
      await context.route('**/assets/app-runtime.js*', route => route.fulfill({ contentType: 'text/javascript', body: runtime }));
      await context.route(/^https:\/\/agmetricapp\.com\/(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/html', body: html }));
    }
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.stack || error.message));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => typeof requestArgosReclassSubmission === 'function', { timeout: 20000 });
    const started = performance.now();
    const setup = () => page.evaluate(() => {
      localStorage.clear(); sessionStorage.clear();
      nativeAuthProfile = { id: 'fixture-user', username: 'dylan_collyge' };
      currentUser = 'dylan_collyge'; currentUserDisplay = 'Dylan Collyge';
      canCurrentUserSubmitRepInventoryOperations = () => false;
      isEvalWorkManagerUser = () => true;
      isEvalReclassRowAssigned = () => true;
      getArgosReclassLiveEditIdentityKey = () => 'reclass-ui-fixture';
      ensureArgosReclassSubmissionVerification = () => true;
      canUseProductionLiveSync = () => true;
      getSupabaseReadIdentityScope = () => 'reclass-ui-fixture';
      getCurrentReclassDeliveryActor = () => 'dylan_collyge';
      captureEvalWorkLocalDraftSoon = () => {};
      getArgosReclassScopeSettings = () => ({ season: 'U3', salesYear: 2028 });
      window.__reclassToasts = []; window.__reclassSaves = [];
      showToast = (title, message) => window.__reclassToasts.push({ title, message });
      getInventoryReclassMovesService = () => ({ submit: command => { window.__reclassSaves.push(command); return new Promise(() => {}); } });
      const rows = ['26.U3', '27.U3', '27.Y', '28.F1', '28.S1', '28.Y', '27.Y'].map((lot, i) => ({
        UNIQUE_ID: 'fixture-' + i, unique_id: 'fixture-' + i, ITEMCODE: '000180.008.1', itemcode: '000180.008.1',
        COMMONNAME: 'Hetzi Column Juniper', CONTSIZE: '8 IN.', LOCATIONCODE: i === 6 ? 'F.12.000' : 'L.05.000', locationcode: i === 6 ? 'F.12.000' : 'L.05.000',
        LOTCODE: lot, lotcode: lot, PTRONHAND: 293, ptronhand: 293, PTRAVAILABLE: 293, ptravailable: 293, PTRREVIEWED: 0, ptrreviewed: 0,
        PRIORITY: '', SOURCE: 'LD', SOURCE_TABLE: 'ph_master_inventory', SEASON: lot.split('.')[1], S_LTS: 293
      }));
      fullInventory = rows;
      const locationRows = rows.map(row => ({ unique_id: row.UNIQUE_ID, sourceRow: row, values: { locationcode: row.LOCATIONCODE, lotcode: row.LOTCODE, ptronhand: 293, ptravailable: 293, ptrreviewed: 0, priority: '', holdstopcode: '', holdstopreason: '' } }));
      argosInventoryTransactionState = {
        item: rows[0], snapshot: { uniqueId: 'fixture-0', sourceTable: 'ph_master_inventory', itemCode: '000180.008.1', lotCode: '26.U3', locationCode: 'L.05.000', season: 'U3', salesYear: 2026 },
        sourceView: 'drive', inquiryModel: { identity: { itemcode: '000180.008.1' }, rows, locationRows, seasons: [] }, idempotencyToken: 'fixture-confirm-' + Date.now()
      };
      resetArgosReclassMultiActionState();
      const modal = ensureArgosInventoryTransactionModal(); modal.classList.remove('hidden');
      document.getElementById('argos-inventory-transaction-title').textContent = 'Hetzi Column Juniper 8 IN.';
      document.getElementById('argos-inventory-transaction-apply').textContent = 'Review & Apply Reclass';
      document.getElementById('argos-inventory-transaction-review').classList.remove('hidden');
      document.getElementById('argos-reclass-item-inquiry').innerHTML = renderArgosReclassInquiryEditor(argosInventoryTransactionState.inquiryModel, 'fixture-0');
    });
    await setup();
    const heights = await page.locator('[data-reclass-row-card]').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height));
    assert.equal(heights.length, 7); assert.ok(heights.every(height => height <= 56));
    const selectRow = async () => {
      await page.locator('[data-reclass-row-card="fixture-0"] .argos-reclass-row-toggle').click();
      const text = await page.locator('.argos-reclass-confirmation').textContent();
      for (const value of ['Open This Row', 'L.05.000', '26.U3', 'OH: 293', 'REV: 0', 'AVL: 293', 'PRI: —']) assert.ok(text.includes(value), value);
    };
    await selectRow(); await page.locator('[data-reclass-confirm-cancel]').click();
    assert.equal(await page.locator('[data-reclass-row-expanded="true"]').count(), 0);
    await selectRow(); await page.locator('[data-reclass-confirm-ok]').click();
    await page.locator('[data-reclass-row-card="fixture-0"] [data-reclass-v3-action="move_down"]').click();
    const actionOrder = await page.locator('[data-reclass-row-card="fixture-0"] [data-reclass-v3-action]').evaluateAll(buttons => buttons.map(button => button.getAttribute('data-reclass-v3-action')));
    assert.deepEqual(actionOrder, ['move_up', 'move_down', 'recount', 'hold', 'take_off_hold', 'priority_change', 'stop_ship', 'off_stop_ship', 'sheared']);
    const geometry = await page.evaluate(() => {
      const modal = document.getElementById('argos-inventory-transaction-modal');
      const rect = selector => { const r = modal.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
      const body = modal.querySelector('.argos-tx-body');
      return { quantity: rect('[data-reclass-v3-proposal-field="quantity"]'), destination: rect('[data-reclass-v3-proposal-field="destinationSeason"]'), apply: rect('#argos-inventory-transaction-apply'), clientHeight: body.clientHeight, scrollHeight: body.scrollHeight, visibleRows: [...modal.querySelectorAll('[data-reclass-row-card]')].filter(row => !row.hidden).length };
    });
    assert.equal(geometry.visibleRows, 1); assert.ok(geometry.destination.width >= 150);
    assert.ok(geometry.scrollHeight <= geometry.clientHeight + 1);
    for (const rect of [geometry.quantity, geometry.destination, geometry.apply]) assert.ok(rect.y >= 0 && rect.bottom <= 844);
    await page.locator('[data-reclass-v3-proposal-field="quantity"]').fill('50');
    await page.locator('[data-reclass-v3-proposal-field="destinationSeason"]').selectOption('F1');
    await page.locator('[data-reclass-row-card="fixture-0"] .argos-reclass-row-toggle').click();
    assert.equal(await page.locator('[data-reclass-row-card]:visible').count(), 7);
    await selectRow(); await page.locator('[data-reclass-confirm-ok]').click();
    assert.equal(await page.locator('[data-reclass-v3-proposal-field="quantity"]').inputValue(), '50');
    const timings = [];
    for (const mode of ['apply', 'review']) {
      if (mode === 'review') {
        await setup(); await selectRow(); await page.locator('[data-reclass-confirm-ok]').click();
        await page.locator('[data-reclass-row-card="fixture-0"] [data-reclass-v3-action="move_down"]').click();
        await page.locator('[data-reclass-v3-proposal-field="quantity"]').fill('50');
        await page.locator('[data-reclass-v3-proposal-field="destinationSeason"]').selectOption('F1');
      }
      await page.locator('#argos-inventory-transaction-' + mode).click();
      const text = await page.locator('.argos-reclass-confirmation').textContent();
      for (const value of ['Confirm Reclass Submission', 'L.05.000', '26.U3', 'Move Down: 50 → Lot 26.F1', 'Remaining: 243']) assert.ok(text.includes(value), value);
      await page.locator('[data-reclass-confirm-cancel]').click();
      assert.equal(await page.locator('[data-reclass-v3-proposal-field="quantity"]').inputValue(), '50');
      assert.equal(await page.evaluate(() => window.__reclassSaves.length), 0);
      await page.locator('#argos-inventory-transaction-' + mode).click();
      const timing = await page.evaluate(() => {
        const started = performance.now(); document.querySelector('[data-reclass-confirm-ok]').click();
        return { elapsedMs: performance.now() - started, closed: document.getElementById('argos-inventory-transaction-modal').classList.contains('hidden'), sourceOh: fullInventory.find(row => row.UNIQUE_ID === 'fixture-0')?.PTRONHAND, calls: window.__reclassSaves.length, toasts: window.__reclassToasts };
      });
      if (!timing.closed) { await page.waitForTimeout(30); timing.diagnostic = await page.evaluate(() => ({ toasts: window.__reclassToasts, pending: !!argosInventoryTransactionState?.pendingReclassMove })); }
      assert.equal(timing.closed, true, JSON.stringify(timing)); assert.equal(Number(timing.sourceOh), 243);
      assert.equal(timing.calls, 1); assert.ok(timing.elapsedMs < 100, JSON.stringify(timing));
      timings.push({ mode, ...timing });
    }
    assert.deepEqual(errors, []);
    const proof = { preview, viewport: '390x844', heights, geometry, timings, errors, functionalSeconds: (performance.now() - started) / 1000, interceptedProductionWrites: true };
    if (evidenceDirectory) await writeFile(evidenceDirectory + (preview ? '/preview-dom-proof.json' : '/live-dom-proof.json'), JSON.stringify(proof, null, 2));
    return proof;
  } finally { await browser.close(); }
}

if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const proof = await verifyReclassFocusedWorkspace({ preview: process.argv.includes('--preview'), evidenceDirectory: process.env.RELEASE_EVIDENCE_DIRECTORY });
  console.log(JSON.stringify(proof));
  process.exit(0);
}
