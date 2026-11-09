import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { invariant565, invariant569 } from '../src/services/golden-request-photo-archive.mjs';
import { createDirectDriveClient } from '../src/services/photo-archive-drive-client.mjs';
import { createPhotoArchiveReceiver, photoArchiveDescription } from '../src/services/photo-archive-receiver.mjs';
import { copyArchiveCandidates, processArchiveLifecycle, readPhotoArchiveJobs } from '../src/services/photo-archive-jobs.mjs';

const archivePath = ['Rep', 'Customer', 'Direct_or_NA', '2026-11-01_REQ', '100'];
const originalBytes = Buffer.from('original archive bytes');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const originalHash = hash(originalBytes);
const sourceKey = hash('request_photos/old/photo.webp');
const originalMetadata = { archive: 'gnc-supabase-photo', sourceKey, sha256: originalHash };
const requestRoot = 'request-root';

test('signed Request archive denies tampering and reuses verified objects while completing later path coverage', invariant565);
test('deleted Request photos recover canonical hierarchy copies from immutable Drive receipts', invariant569);

test('photo archive jobs traverse beyond 5,000 via bounded keyset pages without overlap', async () => {
  const rows = Array.from({ length: 5_023 }, (_, index) => ({ source_key: String(index).padStart(5, '0'), status: 'verified' }));
  const reads = [];
  const client = { from(relation) {
    let after = '';
    let limit;
    return { select() { return this; }, in(_column, statuses) { assert.deepEqual(statuses, ['verified']); return this; },
      order(column) { assert.equal(column, 'source_key'); return this; }, limit(size) { limit = size; return this; },
      gt(column, value) { assert.equal(column, 'source_key'); after = value; return this; },
      then(resolve) { reads.push({ relation, limit, after }); resolve({ data: rows.filter(row => row.source_key > after).slice(0, limit), error: null }); },
    };
  } };
  assert.deepEqual(await readPhotoArchiveJobs(client, 'ph_photo_archive_queue', ['verified']), rows);
  assert.equal(reads.length, 11);
  assert.ok(reads.every(read => read.limit === 500 && read.relation === 'ph_photo_archive_queue'));
  assert.equal(reads.at(-1).after, '04999');
});

function fixtureJob(overrides = {}) {
  return { source_key: sourceKey, source_bucket: 'request_photos', source_path: 'old/photo.webp',
    source_url: 'https://example.invalid/storage/old/photo.webp', source_size: originalBytes.length,
    drive_file_id: 'drive-primary', drive_file_name: 'photo.webp', sha256: originalHash,
    verified_at: '2026-11-01T00:00:00Z', status: 'deleted', request_archive_identity_verified: true,
    request_archive_paths: [archivePath], archive_path_receipts: [], master_unique_ids: ['request-1'], invalid_reasons: [],
    ...overrides };
}

function leafReceipt() {
  return { id: 'leaf-copy', name: 'photo.webp', folderId: 'leaf', path: archivePath,
    sha256: originalHash, size: originalBytes.length };
}

function fixtureWorker(job, driveClient) {
  const query = { select() { return this; }, in() { return this; }, order() { return this; }, limit() { return this; },
    gt() { return this; }, eq() { return this; }, single() { return { data: job }; },
    then(resolve) { resolve({ data: [job], error: null }); } };
  const updates = [];
  const removals = [];
  const storage = { from: bucket => ({ async remove(paths) { removals.push({ bucket, paths }); return {}; } }) };
  const context = { supabase: { from: () => query, storage }, driveFolders: { request_photos: requestRoot, flyer_photos: 'flyer-root' },
    summary: { recoveredArchivePaths: 0, copied: 0, verified: 0, quarantined: 0, deleted: 0, failed: 0, failures: [] },
    startedAt: new Date('2026-11-08T00:00:00Z'), driveClient, dependencies: {
      parseStorageObjectUrl: () => ({ sourceKey: job.source_key, bucket: job.source_bucket, path: job.source_path, url: job.source_url }),
      pendingErpArchiveCandidates: () => [], hasVerifiedArchiveReceipt: item => Boolean(item.verified_at),
      async updateJob(_client, key, patch) { updates.push({ key, patch }); Object.assign(job, patch); },
      compactError: String, errorCode: () => 'fixture_error', safeDriveName: () => 'photo.webp',
      retry: (_label, run) => run(), downloadStorageObject: () => ({ bytes: originalBytes, mimeType: 'image/webp' }),
      isoNow: () => '2026-11-08T00:00:00Z', addDays: date => date,
    } };
  return { context, updates, removals };
}

test('deleted Request-photo jobs preserve deletion evidence and recover on a later retry', async () => {
  const job = fixtureJob({ deleted_at: '2026-11-02T00:00:00Z' });
  let attempts = 0;
  const { context, updates } = fixtureWorker(job, { async copyExisting(args) {
    assert.equal(args.driveFileId, job.drive_file_id);
    if (++attempts === 1) throw new Error('original metadata temporarily unavailable');
    return { archiveCopies: [leafReceipt()] };
  } });
  await copyArchiveCandidates(context, []);
  assert.equal(job.status, 'deleted');
  assert.equal(job.deleted_at, '2026-11-02T00:00:00Z');
  assert.equal(job.last_error_code, 'fixture_error');
  await copyArchiveCandidates(context, []);
  assert.equal(context.summary.recoveredArchivePaths, 1);
  assert.equal(updates.at(-1).patch.archive_path_receipts[0].id, 'leaf-copy');
  assert.equal(updates.at(-1).patch.status, undefined);
  assert.equal(job.status, 'deleted');
  assert.equal(job.last_error_code, null);
});

for (const alreadyVerified of [false, true]) {
  test(`cross-bucket Request leaf uses the Request root and retains its ${alreadyVerified ? 'existing' : 'new'} primary receipt`, async () => {
    const job = fixtureJob({ source_bucket: 'flyer_photos', status: alreadyVerified ? 'quarantined' : 'pending',
      verified_at: alreadyVerified ? '2026-11-01T00:00:00Z' : null });
    const uploads = [];
    const { context } = fixtureWorker(job, { async upload(args) {
      uploads.push(args.folderId);
      const isPrimary = args.folderId === 'flyer-root';
      return { ...leafReceipt(), sourceKey, id: isPrimary ? 'flyer-primary' : 'leaf-copy',
        archiveCopies: isPrimary ? [] : [leafReceipt()] };
    } });
    await copyArchiveCandidates(context, []);
    assert.deepEqual(uploads, alreadyVerified ? [requestRoot] : ['flyer-root', requestRoot]);
    assert.equal(job.drive_file_id, alreadyVerified ? 'drive-primary' : 'flyer-primary');
    assert.equal(job.archive_path_receipts[0].id, 'leaf-copy');
  });
}

test('deletion requires proven Storage identity and verified Request reader for referenced leaves', async () => {
  const variants = [
    { identity: false, reader: true, linked: true, removes: false },
    { identity: true, reader: false, linked: true, removes: false },
    { identity: true, reader: false, linked: false, removes: true },
    { identity: true, reader: true, linked: true, removes: true },
  ];
  for (const { identity, reader, linked, removes } of variants) {
    const job = fixtureJob({ status: 'quarantined', request_archive_identity_verified: identity,
      request_archive_paths: linked ? [archivePath] : [], archive_path_receipts: linked ? [leafReceipt()] : [],
      quarantine_until: '2026-11-04T00:00:00Z', first_ref_scan_at: '2026-11-05T00:00:00Z',
      second_ref_scan_at: '2026-11-06T00:00:00Z' });
    const { context, removals } = fixtureWorker(job, {});
    await processArchiveLifecycle({ ...context, deletionEnabled: true, requestArchiveReaderVerified: reader }, new Map());
    assert.equal(removals.length, Number(removes));
  }
});

function fixtureSourceReceiver() {
  let sourceDescription = '';
  let sourceWrites = 0;
  let sourceAppProperties = null;
  const empty = () => ({ hasNext: () => false });
  const source = { getName: () => 'photo.webp', getSize: () => originalBytes.length,
    getBlob: () => ({ getBytes: () => originalBytes }), getDescription: () => sourceDescription,
    setDescription: value => { sourceDescription = value; sourceWrites += 1; } };
  const folder = { getId: () => requestRoot, getFoldersByName: empty, getFilesByName: empty,
    createFolder: () => folder, createFile: blob => ({
      getId: () => 'drive-leaf', getName: () => blob.name, getSize: () => blob.bytes.length,
      getBlob: () => ({ getBytes: () => blob.bytes }), setDescription() {},
    }) };
  const dependencies = { verify() {}, getFileById: () => source, getArchiveProperties: () => sourceAppProperties,
    requireRoot: () => folder, requestPhotoRoot: requestRoot, maxBytes: 1024, hashBytes: hash,
    sanitizeName: value => value, utilities: { newBlob: (bytes, _mime, name) => ({ bytes, name }) },
    lock: { tryLock: () => true, releaseLock() {} } };
  return { receiver: createPhotoArchiveReceiver(dependencies), getSourceWrites: () => sourceWrites,
    setProperties: value => { sourceAppProperties = value; } };
}

test('Apps Script verifies legacy source metadata without relabeling an unmarked original', () => {
  const { receiver, getSourceWrites, setProperties } = fixtureSourceReceiver();
  const payload = { action: 'copy_existing', folderId: requestRoot, driveFileId: 'drive-original',
    sourceSize: originalBytes.length, sourceKey, sha256: originalHash, archivePaths: [archivePath] };
  assert.throws(() => receiver.handle(payload), /metadata did not match/);
  setProperties({ ...originalMetadata, sourceKey: 'f'.repeat(64) });
  assert.throws(() => receiver.handle(payload), /metadata did not match/);
  setProperties(originalMetadata);
  assert.equal(receiver.handle(payload).archiveCopies[0].id, 'drive-leaf');
  assert.equal(getSourceWrites(), 0);
});

function fixtureDirectClient(leafBytes) {
  let createdFolders = 0;
  let sentDescription;
  const dependencies = { async driveFetch(_token, url, options) {
    if (url.includes('/drive-original/copy')) {
      sentDescription = JSON.parse(options.body).description;
      return Response.json({ id: 'drive-leaf', size: originalBytes.length,
        parents: ['folder-5'], appProperties: originalMetadata });
    }
    if (url.includes('/drive-original') && url.includes('alt=media')) return new Response(originalBytes);
    if (url.includes('/drive-leaf') && url.includes('alt=media')) return new Response(leafBytes);
    if (url.includes('/drive-original')) return Response.json({ size: originalBytes.length,
      description: photoArchiveDescription({ ...originalMetadata, name: 'photo.webp' }, []) });
    if (options?.method === 'POST') return Response.json({ id: `folder-${++createdFolders}` });
    return Response.json({ files: [] });
  } };
  return { client: createDirectDriveClient('fixture', dependencies, requestRoot), getDescription: () => sentDescription };
}

test('direct recovery checks actual leaf bytes and writes portable identity', async () => {
  const args = { folderId: requestRoot, driveFileId: 'drive-original', name: 'photo.webp',
    sourceKey, sha256: originalHash, sourceSize: originalBytes.length, archivePaths: [archivePath] };
  const corrupt = fixtureDirectClient(Buffer.alloc(originalBytes.length));
  await assert.rejects(corrupt.client.copyExisting(args), /copy bytes did not match/);
  const safe = fixtureDirectClient(originalBytes);
  const receipt = await safe.client.copyExisting(args);
  assert.equal(receipt.archiveCopies[0].sha256, originalHash);
  assert.deepEqual(JSON.parse(safe.getDescription()), { ...originalMetadata, originalName: args.name, archivePath });
});
