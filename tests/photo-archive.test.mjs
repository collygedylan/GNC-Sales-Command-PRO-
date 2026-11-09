import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  determineInvalidReasons,
  extractClaspCredentials,
  getChicagoSchedule,
  parseStorageObjectUrl,
  photoArchiveCanonicalRequest,
  splitPhotoLinks
} from '../scripts/archive-expired-photos.mjs';

test('archive signature canonicalization binds every security-sensitive field', () => {
  const signature = payload => createHmac('sha256', 'fixture').update(photoArchiveCanonicalRequest(payload)).digest('hex');
  const flat = { type: 'photo_archive', action: 'upload', timestamp: 1, nonce: 'abc', folderId: 'folder',
    fileName: 'file.webp', sourceKey: 'source', sha256: 'hash', mimeType: 'image/webp' };
  assert.equal(signature({ ...flat }), signature(flat));
  for (const changed of [{ folderId: 'other' }, { fileName: 'other.webp' }, { sha256: 'changed' },
    { mimeType: 'text/html' }, { sourceKey: 'changed' }, { nonce: 'changed' }, { timestamp: 2 }]) {
    assert.notEqual(signature({ ...flat, ...changed }), signature(flat));
  }
  const recovery = { ...flat, action: 'copy_existing', driveFileId: 'drive-id', sourceSize: 42, archivePaths: [['r', 'c', 'd', 'e', 'i']] };
  assert.notEqual(signature({ ...recovery, driveFileId: 'different-drive-id' }), signature(recovery));
  assert.notEqual(signature({ ...recovery, sourceSize: 43 }), signature(recovery));
  assert.notEqual(signature({ ...recovery, archivePaths: [['r', 'c', 'other', 'e', 'i']] }), signature(recovery));
  assert.notEqual(signature({ ...recovery, mimeType: 'text/html' }), signature(recovery));
  assert.notEqual(signature({ action: 'probe', folderIds: ['a,b'] }), signature({ action: 'probe', folderIds: ['a', 'b'] }));
});

test('Apps Script OAuth credentials support the repository clasp secret shape', () => {
  assert.deepEqual(extractClaspCredentials({
    tokens: { default: { client_id: 'id', client_secret: 'secret', refresh_token: 'refresh' } }
  }), { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' });
});

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
