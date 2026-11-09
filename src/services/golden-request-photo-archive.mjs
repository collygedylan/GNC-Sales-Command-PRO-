import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parse } from 'acorn';
import { photoArchiveCanonicalRequest, createDirectDriveClient } from './photo-archive-drive-client.mjs';
import { mergeVerifiedPathReceipts, uncoveredRequestArchivePaths } from './photo-archive-coverage.mjs';
import { planPhotoArchiveUploads } from './photo-archive-jobs.mjs';
import { buildPhotoArchiveReceiver } from '../../scripts/build-photo-archive-receiver.mjs';

const key = 'fixture-archive-signing-key';
const bytes = Buffer.from('original high resolution photo bytes');
const hash = value => createHash('sha256').update(Buffer.from(value)).digest('hex');
const signature = payload => createHmac('sha256', key).update(photoArchiveCanonicalRequest(payload)).digest('hex');
const sourceKey = hash('request_photos/original.webp');
const path = ['Molly Dixon', 'North Nursery', 'Direct_or_NA', '2026-10-10_REQ-1', '00012'];
const nextPath = ['Molly Dixon', 'North Nursery', 'East Yard', '2026-10-11_REQ-2', '00012'];

function fakeIterator(values) {
  let index = 0;
  return { hasNext: () => index < values.length, next: () => values[index++] };
}

function fakeFile(blob, files, counters) {
  const id = `drive-file-${++counters.files}`;
  let description = '';
  let appProperties;
  let trashed = false;
  const file = { getId: () => id, getName: () => blob.name, getSize: () => blob.bytes.length,
    getBlob: () => ({ getBytes: () => blob.bytes, getContentType: () => blob.mimeType || 'application/octet-stream' }), getDescription: () => description,
    setDescription: value => { description = value; }, getAppProperties: () => appProperties,
    setAppProperties: value => { appProperties = value; }, isTrashed: () => trashed,
    setTrashed: value => { trashed = value; if (value) files.splice(files.indexOf(file), 1); } };
  files.push(file);
  counters.byId.set(id, file);
  return file;
}

function fakeFolder(id, name, counters) {
  const children = new Map();
  const files = [];
  return { getId: () => id, getName: () => name,
    getFoldersByName: label => fakeIterator(children.has(label) ? [children.get(label)] : []),
    createFolder(label) {
      const child = fakeFolder(`folder-${++counters.folders}`, label, counters);
      children.set(label, child);
      return child;
    },
    getFilesByName: name => fakeIterator(files.filter(file => file.getName() === name)),
    createFile: blob => fakeFile(blob, files, counters),
  };
}

function fakeDrive() {
  const roots = new Map();
  const counters = { folders: 0, files: 0, byId: new Map() };
  return { getFolderById: id => roots.get(id), getFileById: id => counters.byId.get(id),
    addRoot: id => roots.set(id, fakeFolder(id, id, counters)),
    counts: () => [counters.folders, counters.files], clearDescription: id => counters.byId.get(id).setDescription(''),
    description: id => counters.byId.get(id).getDescription(),
    setDescription: (id, value) => counters.byId.get(id).setDescription(value),
    setAppProperties: (id, value) => counters.byId.get(id).setAppProperties(value),
    getAppProperties: id => counters.byId.get(id).getAppProperties() };
}

async function loadFixtureReceiver() {
  const drive = fakeDrive();
  let locked = false;
  const lock = { tryLock: () => { assert.equal(locked, false); locked = true; return true; },
    releaseLock: () => { assert.equal(locked, true); locked = false; } };
  const utilities = { DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
    computeHmacSha256Signature: (value, secret) => [...createHmac('sha256', secret).update(value).digest()],
    computeDigest: (_algorithm, value) => [...createHash('sha256').update(Buffer.from(value)).digest()],
    base64Decode: value => [...Buffer.from(value, 'base64')], newBlob: (bytes, mimeType, name) => ({ bytes, mimeType, name }) };
  const context = vm.createContext({ Utilities: utilities, DriveApp: drive,
    Drive: { Files: { get: id => ({ appProperties: drive.getAppProperties(id) }) } },
    LockService: { getScriptLock: () => lock },
    SUPABASE_KEY: key, PHOTO_ARCHIVE_CLOCK_SKEW_MS: 60_000, PHOTO_ARCHIVE_MAX_BYTES: 12_000_000,
    sanitizePhotoUploadFileName_: value => value });
  const code = await readFile(new URL('../../Code.gs', import.meta.url), 'utf8');
  const companion = await buildPhotoArchiveReceiver();
  const names = new Set(['getPhotoArchiveFolderMap_', 'photoArchiveBytesToHex_', 'photoArchiveSafeEqual_',
    'photoArchiveCanonicalRequest_', 'verifyPhotoArchiveRequest_', 'requirePhotoArchiveFolder_', 'handlePhotoArchiveRequest_']);
  const declarations = parse(code, { ecmaVersion: 'latest', sourceType: 'script' }).body
    .filter(node => node.type === 'FunctionDeclaration' && names.has(node.id.name));
  assert.equal(declarations.length, names.size);
  vm.runInContext(`${companion}\n${declarations.map(node => code.slice(node.start, node.end)).join('\n')}`, context);
  const roots = context.getPhotoArchiveFolderMap_();
  Object.values(roots).forEach(drive.addRoot);
  return { drive, roots, receive: payload => JSON.parse(JSON.stringify(context.handlePhotoArchiveRequest_(payload))) };
}

function upload(root, archivePaths) {
  const payload = { action: 'upload', timestamp: Date.now(), nonce: 'a'.repeat(36), folderId: root,
    fileName: 'original.webp', sourceKey, sha256: hash(bytes), mimeType: 'image/webp', imageBase64: bytes.toString('base64'), archivePaths };
  return { ...payload, signature: signature(payload) };
}

function recover(root, driveFileId, archivePaths) {
  const payload = { action: 'copy_existing', timestamp: Date.now(), nonce: 'b'.repeat(36), folderId: root,
    driveFileId, fileName: 'original.webp', sourceKey, sha256: hash(bytes), sourceSize: bytes.length,
    mimeType: 'image/webp', archivePaths };
  return { ...payload, signature: signature(payload) };
}

function assertDeniedRequests(fixture) {
  const valid = upload(fixture.roots.request_photos, [path]);
  assert.throws(() => fixture.receive({ ...valid, archivePaths: [nextPath] }), /signature is invalid/);
  assert.throws(() => fixture.receive({ ...valid, mimeType: 'text/html' }), /signature is invalid/);
  assert.throws(() => fixture.receive(upload('forged-root', [path])), /destination is not approved/);
  assert.throws(() => fixture.receive(upload(fixture.roots.credit_photos, [path])), /approved Request photo root/);
  assert.throws(() => fixture.receive(upload(fixture.roots.request_photos, [path.slice(1)])), /five folders/);
  assert.deepEqual(fixture.drive.counts(), [0, 0]);
}

export async function invariant565() {
  const fixture = await loadFixtureReceiver();
  assertDeniedRequests(fixture);
  const direct = createDirectDriveClient('fixture', {}, fixture.roots.request_photos);
  await assert.rejects(direct.upload({ folderId: fixture.roots.credit_photos, archivePaths: [path] }), /approved Request photo root/);
  const first = fixture.receive(upload(fixture.roots.request_photos, [path]));
  assert.equal(first.sha256, hash(bytes));
  assert.equal(first.size, bytes.length);
  assert.equal(first.rootFolderId, fixture.roots.request_photos);
  assert.deepEqual(first.archiveCopies[0].path, path);
  fixture.drive.clearDescription(first.id);
  const replay = fixture.receive(upload(fixture.roots.request_photos, [path, path]));
  assert.equal(replay.id, first.id);
  assert.deepEqual(fixture.drive.counts(), [5, 1]);
  const job = { source_size: bytes.length, sha256: first.sha256, request_archive_paths: [path, nextPath], archive_path_receipts: first.archiveCopies };
  assert.deepEqual(uncoveredRequestArchivePaths(job), [nextPath]);
  assert.throws(() => mergeVerifiedPathReceipts(job, [nextPath], first.archiveCopies, first.sha256, bytes.length), /leaf receipt/);
  const later = fixture.receive(upload(fixture.roots.request_photos, [nextPath]));
  const updated = mergeVerifiedPathReceipts(job, [nextPath], later.archiveCopies, first.sha256, bytes.length);
  assert.deepEqual(uncoveredRequestArchivePaths({ ...job, archive_path_receipts: updated }), []);
  assert.equal(updated.find(receipt => receipt.path[2] === 'Direct_or_NA').id, first.id);
  assert.deepEqual(fixture.drive.counts(), [8, 2]);
  assert.equal(fixture.receive(upload(fixture.roots.request_photos, [nextPath])).id, later.id);
  assert.deepEqual(fixture.drive.counts(), [8, 2]);
}

export async function invariant569() {
  const fixture = await loadFixtureReceiver();
  const primary = fixture.receive(upload(fixture.roots.request_photos, [path]));
  const recovered = fixture.receive(recover(fixture.roots.request_photos, primary.id, [nextPath]));
  assert.equal(recovered.recoveredFromDrive, true);
  assert.equal(recovered.sha256, primary.sha256);
  assert.deepEqual(recovered.archiveCopies[0].path, nextPath);
  assert.throws(() => fixture.receive({ ...recover(fixture.roots.request_photos, primary.id, [path]),
    driveFileId: 'forged-drive-file' }), /signature is invalid/);
  const replay = fixture.receive(recover(fixture.roots.request_photos, primary.id, [nextPath]));
  assert.equal(replay.id, recovered.id);
  assert.deepEqual(fixture.drive.counts(), [8, 2]);
  fixture.drive.setDescription(primary.id, JSON.stringify({ archive: 'gnc-supabase-photo', sourceKey: 'c'.repeat(64), sha256: primary.sha256 }));
  assert.throws(() => fixture.receive(recover(fixture.roots.request_photos, primary.id, [path])), /metadata did not match/);
  const jobs = await readFile(new URL('./photo-archive-jobs.mjs', import.meta.url), 'utf8');
  assert.match(jobs, /'blocked_valid_reference', 'deleted'/);
  assert.match(jobs, /job[.]status === 'deleted'[^]*copyDeletedCandidate/);
  assert.match(jobs, /driveClient[.]copyExisting/);
}

export async function invariant571() {
  assert.deepEqual(planPhotoArchiveUploads('flyer_photos', [path], false),
    { uploadPrimary: true, archiveBucket: 'request_photos' });
  assert.deepEqual(planPhotoArchiveUploads('flyer_photos', [path], true),
    { uploadPrimary: false, archiveBucket: 'request_photos' });
  assert.deepEqual(planPhotoArchiveUploads('flyer_photos', [], false),
    { uploadPrimary: false, archiveBucket: 'flyer_photos' });
  const fixture = await loadFixtureReceiver();
  const primary = fixture.receive(upload(fixture.roots.request_photos, [path]));
  fixture.drive.clearDescription(primary.id);
  assert.throws(() => fixture.receive(recover(fixture.roots.request_photos, primary.id, [nextPath])),
    /metadata did not match/);
  assert.equal(fixture.drive.description(primary.id), '');
  fixture.drive.setAppProperties(primary.id,
    { archive: 'gnc-supabase-photo', sourceKey, sha256: primary.sha256 });
  const recovered = fixture.receive(recover(fixture.roots.request_photos, primary.id, [nextPath]));
  assert.equal(recovered.recoveredFromDrive, true);
  const catalog = await readFile(new URL('../../supabase/migrations/20261109002000_agdata3039_request_archive_catalog.sql', import.meta.url), 'utf8');
  const reader = await readFile(new URL('../../supabase/migrations/20261109008000_agdata3039_request_archive_reader.sql', import.meta.url), 'utf8');
  assert.match(catalog, /request_archive_photo_object_v3039[^]*array\['\*'\]/);
  assert.match(reader, /request_archive_photo_object_v3039\(link[.]source_url\)/);
}
