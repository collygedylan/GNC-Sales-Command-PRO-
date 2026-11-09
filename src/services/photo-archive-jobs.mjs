import { createHash } from 'node:crypto';
import { mergeVerifiedPathReceipts, uncoveredRequestArchivePaths } from './photo-archive-coverage.mjs';

export function candidateFromArchiveJob(job, parseStorageObjectUrl) {
  const object = parseStorageObjectUrl(job.source_url);
  if (!object || object.sourceKey !== job.source_key || object.bucket !== job.source_bucket || object.path !== job.source_path) return null;
  return { ...object, refs: (job.master_unique_ids || []).map(unique_id => ({ row: { unique_id } })),
    reasons: new Set(job.invalid_reasons || []), metadata: { size: job.source_size, createdAt: job.source_created_at } };
}

export async function readPhotoArchiveJobs(supabase, relation, statuses) {
  const jobs = [];
  const pageSize = 500;
  let after = '';
  while (true) {
    let query = supabase.from(relation).select('*').in('status', statuses).order('source_key').limit(pageSize);
    if (after) query = query.gt('source_key', after);
    const { data, error } = await query;
    if (error || !Array.isArray(data)) throw new Error(`Archive job page: ${error?.message || 'invalid response'}`);
    jobs.push(...data);
    if (data.length < pageSize) return jobs;
    const next = data.at(-1)?.source_key;
    if (typeof next !== 'string' || next <= after) throw new Error('Archive job page did not advance.');
    after = next;
  }
}

async function loadArchiveJob(supabase, sourceKey) {
  const { data, error } = await supabase.from('ph_photo_archive_queue').select('*').eq('source_key', sourceKey).single();
  if (error) throw new Error(`Archive queue read: ${error.message}`);
  return data;
}

async function candidateJob(context, entry, jobs) {
  const { supabase, startedAt, dependencies: deps } = context;
  let job = jobs.get(entry.sourceKey);
  if (!job) {
    await deps.insertJob(supabase, entry, startedAt);
    job = await loadArchiveJob(supabase, entry.sourceKey);
    jobs.set(entry.sourceKey, job);
  } else {
    const newUrl = !deps.hasVerifiedArchiveReceipt(job) && job.source_url !== entry.url;
    await deps.updateJob(supabase, entry.sourceKey, { ...(newUrl ? { source_url: entry.url } : {}),
      master_unique_ids: [...new Set(entry.refs.map(ref => String(ref.row.unique_id)))], invalid_reasons: [...entry.reasons] });
    if (newUrl) job = await loadArchiveJob(supabase, entry.sourceKey);
  }
  return job;
}

function verifyUploadedArchive(driveFile, args) {
  const sha256 = driveFile.sha256 || driveFile.appProperties?.sha256;
  const sourceKey = driveFile.sourceKey || driveFile.appProperties?.sourceKey;
  if (driveFile.trashed || !driveFile.id || Number(driveFile.size) !== args.bytes.length
    || sha256 !== args.sha256 || sourceKey !== args.sourceKey) {
    const error = new Error('Drive verification did not match source size/hash metadata.');
    error.code = 'drive_verify_mismatch';
    throw error;
  }
  return driveFile;
}

export function planPhotoArchiveUploads(bucket, paths, alreadyVerified) {
  const requestLeafRequired = paths.length > 0;
  return {
    uploadPrimary: bucket !== 'request_photos' && requestLeafRequired && !alreadyVerified,
    archiveBucket: requestLeafRequired ? 'request_photos' : bucket,
  };
}

async function uploadCandidateCopies(driveClient, driveFolders, entry, args, paths, alreadyVerified) {
  const plan = planPhotoArchiveUploads(entry.bucket, paths, alreadyVerified);
  const upload = async options => verifyUploadedArchive(await driveClient.upload({ ...args, ...options }), args);
  const primary = plan.uploadPrimary
    ? await upload({ folderId: driveFolders[entry.bucket] })
    : null;
  const archive = await upload({ folderId: driveFolders[plan.archiveBucket],
    archivePaths: paths });
  return { primary: primary || archive, archive };
}

async function copyCandidate(context, entry, job) {
  const { supabase, driveClient, driveFolders, startedAt, summary, dependencies: deps } = context;
  if (job.status === 'deleted') return copyDeletedCandidate(context, job);
  const downloaded = await deps.retry('Storage download', () => deps.downloadStorageObject(supabase, entry.bucket, entry.path), { attempts: 4, baseMs: 1000 });
  const sha256 = createHash('sha256').update(downloaded.bytes).digest('hex');
  const alreadyVerified = deps.hasVerifiedArchiveReceipt(job);
  if (alreadyVerified && (job.sha256 !== sha256 || Number(job.source_size) !== downloaded.bytes.length)) {
    throw new Error('Archive source no longer matches its existing receipt.');
  }
  const paths = uncoveredRequestArchivePaths(job);
  const args = {
    name: deps.safeDriveName(entry.path, sha256, startedAt), bytes: downloaded.bytes,
    mimeType: downloaded.mimeType || entry.metadata?.mimeType, sourceKey: entry.sourceKey, sha256 };
  const { primary, archive } = await uploadCandidateCopies(driveClient, driveFolders, entry, args, paths, alreadyVerified);
  const archivePathReceipts = mergeVerifiedPathReceipts(job, paths, archive.archiveCopies, sha256, downloaded.bytes.length);
  const receiptPatch = { archive_path_receipts: archivePathReceipts, attempts: Number(job.attempts || 0) + 1,
    last_error_code: null, last_error_message: null };
  const primaryReceipt = alreadyVerified ? { status: job.status === 'failed' ? 'quarantined' : job.status }
    : { status: 'quarantined', source_size: downloaded.bytes.length,
    drive_folder_id: primary.folderId || driveFolders[entry.bucket], drive_file_id: primary.id,
    drive_file_name: primary.name, sha256, copied_at: deps.isoNow(), verified_at: deps.isoNow(),
    quarantine_until: deps.addDays(startedAt, deps.quarantineDays).toISOString() };
  await deps.updateJob(supabase, entry.sourceKey, { ...primaryReceipt, ...receiptPatch });
  summary.copied += 1;
  summary.verified += 1;
  summary.quarantined += 1;
}

async function copyDeletedCandidate(context, job) {
  const { supabase, driveClient, driveFolders, summary, dependencies: deps } = context;
  if (!deps.hasVerifiedArchiveReceipt(job)) throw new Error('Deleted archive source has no verified Drive receipt.');
  const paths = uncoveredRequestArchivePaths(job);
  if (!paths.length) return;
  const copied = await driveClient.copyExisting({ folderId: driveFolders.request_photos,
    driveFileId: job.drive_file_id, name: job.drive_file_name, sourceKey: job.source_key,
    sha256: job.sha256, sourceSize: Number(job.source_size), archivePaths: paths });
  const receipts = mergeVerifiedPathReceipts(job, paths, copied.archiveCopies, job.sha256, Number(job.source_size));
  await deps.updateJob(supabase, job.source_key, { archive_path_receipts: receipts,
    attempts: Number(job.attempts || 0) + 1, last_error_code: null, last_error_message: null });
  summary.recoveredArchivePaths += paths.length;
}

async function failedJob(context, job, error, copyAttempt = true) {
  const { supabase, summary, dependencies: deps } = context;
  summary.failed += 1;
  summary.failures.push({ sourceKey: job.source_key, bucket: job.source_bucket, code: deps.errorCode(error), message: deps.compactError(error) });
  const status = job.status === 'deleted' ? 'deleted' : 'failed';
  await deps.updateJob(supabase, job.source_key, { status, ...(copyAttempt ? { attempts: Number(job.attempts || 0) + 1 } : {}),
    last_error_code: deps.errorCode(error), last_error_message: deps.compactError(error) });
}

function appendUncoveredCandidates(storedJobs, candidates, parseStorageObjectUrl) {
  const known = new Set(candidates.map(entry => entry.sourceKey));
  for (const job of storedJobs || []) {
    if (known.has(job.source_key) || !uncoveredRequestArchivePaths(job).length) continue;
    const entry = candidateFromArchiveJob(job, parseStorageObjectUrl);
    if (entry) candidates.push(entry);
  }
}

export async function copyArchiveCandidates(context, candidates) {
  const storedJobs = await readPhotoArchiveJobs(context.supabase, 'ph_photo_archive_queue',
    ['pending', 'failed', 'verified', 'quarantined', 'blocked_valid_reference', 'deleted']);
  const jobs = new Map((storedJobs || []).map(job => [job.source_key, job]));
  candidates.push(...context.dependencies.pendingErpArchiveCandidates(storedJobs, candidates));
  appendUncoveredCandidates(storedJobs, candidates, context.dependencies.parseStorageObjectUrl);
  context.summary.candidatesFound = candidates.length;
  for (const entry of candidates) {
    const job = await candidateJob(context, entry, jobs);
    if (context.dependencies.hasVerifiedArchiveReceipt(job) && !uncoveredRequestArchivePaths(job).length) continue;
    try { await copyCandidate(context, entry, job); }
    catch (error) { await failedJob(context, job, error); }
  }
}

async function secondReferenceScan(context, job) {
  const { supabase, startedAt, dependencies: deps } = context;
  const first = job.first_ref_scan_at ? new Date(job.first_ref_scan_at) : startedAt;
  let second = job.second_ref_scan_at ? new Date(job.second_ref_scan_at) : null;
  if (!job.first_ref_scan_at) await deps.updateJob(supabase, job.source_key, { first_ref_scan_at: startedAt.toISOString(), status: 'quarantined' });
  if (!second && startedAt.getTime() - first.getTime() >= deps.secondScanHours * 60 * 60 * 1000) {
    second = startedAt;
    await deps.updateJob(supabase, job.source_key, { second_ref_scan_at: startedAt.toISOString(), status: 'quarantined' });
  }
  return second;
}

async function deleteArchivedSource(context, job, entry) {
  const { supabase, summary, dependencies: deps } = context;
  const { error } = await supabase.storage.from(job.source_bucket).remove([job.source_path]);
  if (error) throw new Error(`Storage remove ${job.source_bucket}/${job.source_path}: ${error.message}`);
  await deps.updateJob(supabase, job.source_key, { status: 'deleted', deleted_at: deps.isoNow(), last_error_code: null, last_error_message: null });
  summary.deleted += 1;
  if (!entry) return;
  try { await deps.clearDeletedReference(supabase, entry); }
  catch (clearError) {
    summary.failures.push({ sourceKey: job.source_key, bucket: job.source_bucket,
      code: 'reference_clear_after_delete', message: deps.compactError(clearError) });
  }
}

export async function processArchiveLifecycle(context, references) {
  const { supabase, summary, dependencies: deps } = context;
  const jobs = await readPhotoArchiveJobs(supabase, 'ph_photo_archive_jobs', ['verified', 'quarantined', 'blocked_valid_reference']);
  for (const job of jobs || []) {
    const entry = references.get(job.source_key);
    if (entry && !deps.allReferencesInvalid(entry)) {
      summary.blockedValidReference += 1;
      await deps.updateJob(supabase, job.source_key, { status: 'blocked_valid_reference', second_ref_scan_at: null });
      continue;
    }
    const second = await secondReferenceScan(context, job);
    const quarantinePassed = job.quarantine_until && new Date(job.quarantine_until).getTime() <= context.startedAt.getTime();
    if (!context.deletionEnabled || !second || !quarantinePassed || !deps.hasVerifiedArchiveReceipt(job)) continue;
    try {
      const current = await loadArchiveJob(supabase, job.source_key);
      if (current.request_archive_identity_verified !== true || uncoveredRequestArchivePaths(current).length
        || !deps.hasVerifiedArchiveReceipt(current)) continue;
      if (Array.isArray(current.request_archive_paths) && current.request_archive_paths.length
        && context.requestArchiveReaderVerified !== true) continue;
      await deleteArchivedSource(context, current, entry);
    } catch (failure) { await failedJob(context, job, failure, false); }
  }
}
