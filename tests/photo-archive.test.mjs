import test from 'node:test';
import assert from 'node:assert/strict';
import {
  determineInvalidReasons,
  getChicagoSchedule,
  parseStorageObjectUrl,
  splitPhotoLinks
} from '../scripts/archive-expired-photos.mjs';

test('Central schedule selects the correct UTC cron across DST', () => {
  assert.equal(getChicagoSchedule(new Date('2026-08-16T12:00:00Z')).expectedGithubCron, '0 6 * * *');
  assert.equal(getChicagoSchedule(new Date('2026-12-16T12:00:00Z')).expectedGithubCron, '0 7 * * *');
});

test('only approved Supabase photo bucket URLs are parsed', () => {
  const parsed = parseStorageObjectUrl('https://example.supabase.co/storage/v1/object/public/request_photos/2026-08-01/photo.webp');
  assert.equal(parsed.bucket, 'request_photos');
  assert.equal(parsed.path, '2026-08-01/photo.webp');
  assert.equal(parseStorageObjectUrl('https://example.supabase.co/storage/v1/object/public/private_docs/a.pdf'), null);
});

test('retention detects zero LOC match and ten-day age independently', () => {
  const now = new Date('2026-08-16T12:00:00Z');
  assert.deepEqual(determineInvalidReasons({ loc_match_qty: 0 }, { path: '2026-08-15/photo.webp' }, now).reasons, ['loc_match_qty_zero']);
  assert.deepEqual(determineInvalidReasons({ loc_match_qty: 2 }, { path: '2026-08-01/photo.webp' }, now).reasons, ['stale_10_day']);
  assert.deepEqual(determineInvalidReasons({ loc_match_qty: 2 }, { path: '2026-08-15/photo.webp' }, now).reasons, []);
});

test('comma-separated master photo links remain individually addressable', () => {
  assert.deepEqual(splitPhotoLinks('https://a.test/one.webp, https://a.test/two.webp'), [
    'https://a.test/one.webp',
    'https://a.test/two.webp'
  ]);
});

