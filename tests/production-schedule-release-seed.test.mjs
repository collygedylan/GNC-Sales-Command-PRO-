import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { assertCompleteSnapshot, createSignedInitialImport } from '../scripts/seed-production-schedule-release.mjs';

const titles = ['PROD SCHED', 'PltDate-PltGrp', 'ContTable', 'Code Key', 'Calculations', "New Weighted%'s", 'CPB'];
const snapshotId = '00000000-0000-4000-8000-000000000013';

test('release import signature binds the fixed workbook and trusted system actor', () => {
  const command = createSignedInitialImport({ snapshotId, requestedBy: 'github_actions_release', timestamp: '2026-10-01T00:00:00.000Z', secret: 'test-secret' });
  const expected = createHmac('sha256', 'test-secret')
    .update(`2026-10-01T00:00:00.000Z.${command.deliveryJson}`)
    .digest('base64url');
  assert.equal(command.signature, expected);
  assert.equal(command.type, 'production_schedule_import_v1');
  assert.deepEqual(JSON.parse(command.deliveryJson), {
    contractVersion: 'production-schedule-import-v1',
    workbookId: '1myBn2DzyhYtTj2MmYatf26jz575TjqxSpxC-kFt1Mhw',
    runId: snapshotId,
    snapshotId,
    requestedBy: 'github_actions_release',
  });
});

test('release publication requires all seven ordered source sheets and the matching active snapshot', () => {
  const metadata = {
    snapshot: { id: snapshotId },
    sheets: titles.map((title, index) => ({ index, title, rowCount: index === 0 ? 10 : 2, columns: [{ index: 1, header: 'A' }] })),
  };
  assert.deepEqual(assertCompleteSnapshot(metadata, snapshotId), { snapshotId, sheetCount: 7, rowCount: 22 });
  assert.throws(() => assertCompleteSnapshot(metadata, '00000000-0000-4000-8000-000000000014'), /SNAPSHOT_INCOMPLETE/);
  assert.throws(() => assertCompleteSnapshot({ ...metadata, sheets: metadata.sheets.slice(0, 6) }, snapshotId), /SNAPSHOT_INCOMPLETE/);
  assert.throws(() => assertCompleteSnapshot({ ...metadata, sheets: metadata.sheets.map((sheet, index) => index ? sheet : { ...sheet, title: 'Wrong' }) }, snapshotId), /SHEET_SET_MISMATCH/);
});
