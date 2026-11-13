import assert from 'node:assert/strict';
import test from 'node:test';

test('Invariant 648: six field photos transfer in order with bounded retries and verified preview fallback', async () =>
  (await import('../../tests/helpers/ordered-detail-photo-contract.mjs')).assertOrderedDetailPhotoUploads());
test('Invariant 649: Request completion transports exact queued photo IDs and reports a missing registration receipt', async () =>
  (await import('../../tests/helpers/request-photo-intent-contract.mjs')).assertRequestPhotoIntentContract());

test('Invariant 650: warm AV uses the active account and a final Suspend receipt clears only its exact order', async () => {
  const {assertWarmAvAndFinalSuspendReceipt} = await import('./warm-av-suspend-receipt-fixture.mjs');
  assertWarmAvAndFinalSuspendReceipt();
});
test('Invariant 651: Eval overview and drills, Bloom cart continuity, and Project presets work in Chromium', async () =>
  (await import('../views/eval-bloom-project-browser-fixture.mjs')).verifyEvalBloomProjectBrowser());

test('Invariant 652: the Spec keypad replaces placeholders and requires digits before unit marks', async () => {
  const { resolveDetailKeypadInsertion } = await import('../ui/detail-keypad-insertion.js');
  for (const value of ['N/A', '-', '']) {
    const selection = { value, start: value.length, end: value.length };
    assert.deepEqual(resolveDetailKeypadInsertion('spec', selection, '8'), { nextValue: '8', nextCursor: 1 });
    assert.deepEqual(resolveDetailKeypadInsertion('spec', selection, '"'), { nextValue: value, nextCursor: value.length });
  }
  assert.deepEqual(resolveDetailKeypadInsertion('spec', { value:'8-10', start:0, end:0 }, "'"), { nextValue:'8-10', nextCursor:0 });
  assert.deepEqual(resolveDetailKeypadInsertion('spec', { value:'8-10', start:4, end:4 }, '"'), { nextValue:'8-10"', nextCursor:5 });
});

test('Invariant 653: signed-in power and scoped row editors survive cold permission reads while AV Kiosk stays read only', async () =>
  (await import('../../tests/helpers/table-row-authorization-contract.mjs')).assertRetainedRowEditorAuthority());

test('Invariant 654: Pending Request all-user scope survives cold matrix reads and remains separate from Suspend', async () =>
  (await import('../../tests/helpers/que-header-contract.mjs')).assertQueueOwnerScopes());

test('Invariant 655: every route keeps its dark appearance through device and account preference changes', async () =>
  (await import('../../tests/helpers/dark-emerald-theme-contract.mjs')).assertDarkEmeraldTheme());

test('Invariant 656: an automatic mobile update waits for the camera, claims the completed shell, and restores the draft', async () =>
  (await import('../../tests/helpers/pwa-shell-upgrade-contract.mjs')).browserWorkerUpgradeContract({automatic:true}));
test('Invariant 657: Suspend fallback retains account, permission, owner aliases, and write-proof boundaries', async () => {
  const { assertSuspendOwnerFallback, assertSuspendSocDisplayOwnership } = await import('../../tests/helpers/suspend-owner-fallback.mjs');
  assertSuspendOwnerFallback();
  assertSuspendSocDisplayOwnership();
});
test('Invariant 658: compiled DRIVE filters unchanged rows before conflict while retaining pending acknowledgements and guarded legacy writes', async () =>
  (await import('../../tests/helpers/erp-drive-upsert-candidates.mjs')).assertDriveUpsertCandidates());
await import('../../tests/erp-drive-post-upsert.test.mjs');
