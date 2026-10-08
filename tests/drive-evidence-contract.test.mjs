import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const built = buildSync({
  absWorkingDir: root,
  entryPoints: ['services/driveEvidence.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  logLevel: 'silent'
});
const driveEvidenceModule = { exports: {} };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(require, driveEvidenceModule, driveEvidenceModule.exports);
const { confirmedDriveEvidence, driveEvidenceColumns, driveEvidenceRevision } = driveEvidenceModule.exports;

function row(overrides = {}) {
  return {
    ...Object.fromEntries(driveEvidenceColumns.map(column => [column, null])),
    unique_id: 'drive-evidence-fixture',
    itemcode: 'DRIVE.EVIDENCE.FIXTURE',
    locationcode: 'C.12.001',
    lotcode: '27.F1',
    last_updated: '2026-10-07T12:34:56.123456Z',
    ...overrides
  };
}

function ack(rowValue = row(), overrides = {}) {
  return { ok: true, canonicalConfirmed: true, row: rowValue, ...overrides };
}

test('confirmed Drive evidence accepts the full fixed nullable row and preserves canonical identity', () => {
  const value = row({ loc_match_qty: '0', match: '0', av_rule_photo_updated_at: null, spec: null });
  assert.equal(confirmedDriveEvidence(ack(value)), value);
  assert.equal(confirmedDriveEvidence(ack(value)).unique_id, 'drive-evidence-fixture');
});

test('confirmed Drive evidence rejects missing selected fields and invalid field types', () => {
  const missing = row();
  delete missing.av_rule_bundle_updated_at;
  assert.throws(() => confirmedDriveEvidence(ack(missing)), /could not be verified/);

  for (const invalid of [
    row({ itemcode: 17 }),
    row({ av_rule_photo_updated_at: 123 }),
    row({ unique_id: 17 })
  ]) {
    assert.throws(() => confirmedDriveEvidence(ack(invalid)), /could not be verified/);
  }
});

test('failed or unconfirmed RPC results are never accepted as saved evidence', () => {
  assert.throws(() => confirmedDriveEvidence(ack(row(), { ok: false })), /could not be verified/);
  assert.throws(() => confirmedDriveEvidence(ack(row(), { canonicalConfirmed: false })), /could not be verified/);
  assert.throws(() => confirmedDriveEvidence({ ok: true, canonicalConfirmed: true }), /could not be verified/);
});

test('revision rejects missing or malformed timestamps', () => {
  for (const value of [null, undefined, '', 'not-a-timestamp', '2026-02-30T12:00:00Z', '2026-10-07T12:34:56.1234567Z']) {
    assert.equal(driveEvidenceRevision(value), 0, String(value));
  }
  assert.throws(() => confirmedDriveEvidence(ack(row({ last_updated: null }))), /could not be verified/);
  assert.throws(() => confirmedDriveEvidence(ack(row({ last_updated: 'unknown' }))), /could not be verified/);
});

test('revision ordering retains microseconds across UTC and offset timestamp forms', () => {
  const lower = driveEvidenceRevision('2026-10-07T12:34:56.123455Z');
  const higher = driveEvidenceRevision('2026-10-07T12:34:56.123456Z');
  assert.ok(higher > lower);
  assert.equal(driveEvidenceRevision('2026-10-07T12:34:56.123456+00:00'), higher);
  assert.equal(driveEvidenceRevision('2026-10-07T12:34:56.123456+00'), higher);
  assert.equal(driveEvidenceRevision('2026-10-07 12:34:56.123456+00'), higher);
  assert.equal(driveEvidenceRevision('2026-10-07T18:04:56.123456+05:30'), higher);
});
