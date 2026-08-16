#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import { createHash, createSign } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RELEASE = 'V2026.08.16.09-photo-archive-1';
const CHICAGO_TIME_ZONE = 'America/Chicago';
const RETENTION_DAYS = 10;
const QUARANTINE_DAYS = 30;
const SECOND_SCAN_HOURS = 24;
const MAX_ERROR_LENGTH = 500;
const APPROVED_BUCKETS = new Set([
  'request_photos',
  'flyer_photos',
  'season_sales_notes_photos',
  'location_sales_notes_photos',
  'credit_photos',
  'dock_photos',
  'grower_scout_photos',
  'marketing_materials'
]);

const DRIVE_FOLDER_ENV = Object.freeze({
  request_photos: 'GDRIVE_REQUEST_PHOTOS_FOLDER_ID',
  flyer_photos: 'GDRIVE_FLYER_PHOTOS_FOLDER_ID',
  season_sales_notes_photos: 'GDRIVE_SEASON_SALES_NOTES_FOLDER_ID',
  location_sales_notes_photos: 'GDRIVE_LOCATION_SALES_NOTES_FOLDER_ID',
  credit_photos: 'GDRIVE_CREDIT_PHOTOS_FOLDER_ID',
  dock_photos: 'GDRIVE_DOCK_PHOTOS_FOLDER_ID',
  grower_scout_photos: 'GDRIVE_GROWER_SCOUT_PHOTOS_FOLDER_ID',
  marketing_materials: 'GDRIVE_MARKETING_MATERIALS_FOLDER_ID'
});

function boolEnv(name, fallback = false) {
  const value = String(process.env[name] ?? '').trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function isoNow() {
  return new Date().toISOString();
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function compactError(error) {
  return String(error?.message || error || 'Unknown error').replace(/\s+/g, ' ').slice(0, MAX_ERROR_LENGTH);
}

function errorCode(error) {
  return String(error?.code || error?.name || 'archive_error').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retry(label, operation, { attempts = 4, baseMs = 500, capMs = 8000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= attempts) break;
      const maximum = Math.min(capMs, baseMs * (2 ** attempt));
      await sleep(Math.floor(Math.random() * maximum));
    }
  }
  const wrapped = new Error(`${label}: ${compactError(lastError)}`);
  wrapped.code = errorCode(lastError);
  throw wrapped;
}

export function getChicagoSchedule(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset'
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const offsetMatch = String(parts.timeZoneName || '').match(/GMT([+-]\d{1,2})/i);
  const offsetHours = offsetMatch ? Number(offsetMatch[1]) : -6;
  return {
    localDate: `${parts.year}-${parts.month}-${parts.day}`,
    localHour: Number(parts.hour),
    offsetHours,
    expectedGithubCron: offsetHours === -5 ? '0 6 * * *' : '0 7 * * *'
  };
}

export function parseStorageObjectUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const markers = [
      '/storage/v1/object/public/',
      '/storage/v1/object/sign/',
      '/storage/v1/object/authenticated/'
    ];
    const marker = markers.find((candidate) => url.pathname.includes(candidate));
    if (!marker) return null;
    const tail = decodeURIComponent(url.pathname.slice(url.pathname.indexOf(marker) + marker.length));
    const slash = tail.indexOf('/');
    if (slash < 1) return null;
    const bucket = tail.slice(0, slash);
    const path = tail.slice(slash + 1).replace(/^\/+/, '');
    if (!APPROVED_BUCKETS.has(bucket) || !path || path.includes('..')) return null;
    return { bucket, path, url: raw, sourceKey: createHash('sha256').update(`${bucket}/${path}`).digest('hex') };
  } catch {
    return null;
  }
}

export function splitPhotoLinks(value) {
  return String(value || '').split(/\s*,\s*(?=https?:\/\/)/i).map((item) => item.trim()).filter(Boolean);
}

function parseNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

function timestampFromPath(path) {
  const epochMatches = [...String(path).matchAll(/(?:^|[^0-9])(1[5-9]\d{11}|2\d{12})(?:[^0-9]|$)/g)];
  for (const match of epochMatches) {
    const date = new Date(Number(match[1]));
    if (!Number.isNaN(date.getTime())) return date;
  }
  const dayMatch = String(path).match(/(?:^|\/)(20\d{2}-\d{2}-\d{2})(?:\/|$)/);
  if (dayMatch) {
    const date = new Date(`${dayMatch[1]}T12:00:00.000Z`);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

export function determineInvalidReasons(row, object, now = new Date()) {
  const reasons = [];
  const locMatchQty = parseNumber(row?.loc_match_qty);
  if (locMatchQty !== null && locMatchQty <= 0) reasons.push('loc_match_qty_zero');
  const sourceDateCandidates = [
    object?.createdAt,
    timestampFromPath(object?.path),
    row?.date_completed
  ];
  const sourceDate = sourceDateCandidates.map((value) => value instanceof Date ? value : value ? new Date(value) : null)
    .find((value) => value && !Number.isNaN(value.getTime()));
  if (sourceDate && now.getTime() - sourceDate.getTime() >= RETENTION_DAYS * 24 * 60 * 60 * 1000) {
    reasons.push('stale_10_day');
  }
  return { reasons, sourceDate: sourceDate?.toISOString() || null };
}

function base64Url(value) {
  return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getGoogleAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: serviceAccount.token_uri || 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${base64Url(signer.sign(serviceAccount.private_key))}`;
  const response = await fetch(serviceAccount.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  if (!response.ok) throw new Error(`Google OAuth ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const body = await response.json();
  if (!body.access_token) throw new Error('Google OAuth returned no access token.');
  return body.access_token;
}

async function driveFetch(accessToken, url, options = {}) {
  return retry('Google Drive request', async () => {
    const response = await fetch(url, {
      ...options,
      headers: { authorization: `Bearer ${accessToken}`, ...(options.headers || {}) }
    });
    if (!response.ok) {
      const error = new Error(`Drive ${response.status}: ${(await response.text()).slice(0, 400)}`);
      error.code = `drive_${response.status}`;
      throw error;
    }
    return response;
  });
}

async function verifyDriveFolder(accessToken, folderId) {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?supportsAllDrives=true&fields=id,name,mimeType,trashed`;
  const folder = await (await driveFetch(accessToken, url)).json();
  if (folder.trashed || folder.mimeType !== 'application/vnd.google-apps.folder') {
    throw new Error(`Drive target ${folderId} is not an active folder.`);
  }
  return folder;
}

function safeDriveName(path, sha256, date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  const clean = basename(path).replace(/[^a-zA-Z0-9._() -]/g, '_').slice(-140) || 'photo';
  return `${day}__${sha256.slice(0, 12)}__${clean}`;
}

async function uploadDriveFile(accessToken, { folderId, name, bytes, mimeType, sourceKey, sha256 }) {
  const boundary = `gnc-photo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const metadata = Buffer.from(JSON.stringify({
    name,
    parents: [folderId],
    appProperties: { sourceKey, sha256, archive: 'gnc-supabase-photo' }
  }));
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
    metadata,
    Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
  const url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,size,md5Checksum,appProperties,parents,trashed';
  return (await driveFetch(accessToken, url, {
    method: 'POST',
    headers: { 'content-type': `multipart/related; boundary=${boundary}`, 'content-length': String(body.length) },
    body
  })).json();
}

async function uploadJsonManifest(accessToken, folderId, name, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return uploadDriveFile(accessToken, {
    folderId,
    name,
    bytes,
    mimeType: 'application/json',
    sourceKey: createHash('sha256').update(name).digest('hex'),
    sha256: createHash('sha256').update(bytes).digest('hex')
  });
}

async function getStorageObjectInfo(supabase, bucket, path) {
  const slash = path.lastIndexOf('/');
  const prefix = slash >= 0 ? path.slice(0, slash) : '';
  const fileName = slash >= 0 ? path.slice(slash + 1) : path;
  const { data, error } = await supabase.storage.from(bucket).list(prefix, {
    limit: 100,
    offset: 0,
    search: fileName,
    sortBy: { column: 'name', order: 'asc' }
  });
  if (error) throw new Error(`Storage metadata ${bucket}/${path}: ${error.message}`);
  const found = (data || []).find((item) => item.name === fileName && item.id);
  return found ? {
    size: Number(found.metadata?.size || 0),
    createdAt: found.created_at || found.updated_at || null,
    mimeType: found.metadata?.mimetype || found.metadata?.contentType || null
  } : null;
}

async function downloadStorageObject(supabase, bucket, path) {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw new Error(`Storage download ${bucket}/${path}: ${error.message}`);
  const bytes = Buffer.from(await data.arrayBuffer());
  return { bytes, mimeType: data.type || 'application/octet-stream' };
}

async function loadMasterRows(supabase) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('ph_master_inventory')
      .select('unique_id,photo_link,photo_name,loc_match_qty,date_completed,last_updated')
      .not('photo_link', 'is', null)
      .range(from, from + 999);
    if (error) throw new Error(`Master photo references: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

async function buildReferenceMap(supabase, rows, now) {
  const references = new Map();
  const metadataCache = new Map();
  for (const row of rows) {
    for (const value of splitPhotoLinks(row.photo_link)) {
      const parsed = parseStorageObjectUrl(value);
      if (!parsed) continue;
      const cacheKey = `${parsed.bucket}/${parsed.path}`;
      let metadata = metadataCache.get(cacheKey) || null;
      let invalid = determineInvalidReasons(row, parsed, now);
      const hasReliableDate = Boolean(timestampFromPath(parsed.path) || row?.date_completed);
      if (!hasReliableDate) {
        if (!metadataCache.has(cacheKey)) {
          metadataCache.set(cacheKey, await getStorageObjectInfo(supabase, parsed.bucket, parsed.path));
        }
        metadata = metadataCache.get(cacheKey);
        invalid = determineInvalidReasons(row, { ...parsed, createdAt: metadata?.createdAt }, now);
      }
      const entry = references.get(parsed.sourceKey) || { ...parsed, metadata, refs: [], reasons: new Set() };
      entry.refs.push({ row, reasons: invalid.reasons });
      invalid.reasons.forEach((reason) => entry.reasons.add(reason));
      references.set(parsed.sourceKey, entry);
    }
  }
  return references;
}

function allReferencesInvalid(entry) {
  return !entry?.refs?.length || entry.refs.every((ref) => ref.reasons.length > 0);
}

async function updateJob(supabase, sourceKey, patch) {
  const { error } = await supabase.from('ph_photo_archive_jobs').update({ ...patch, updated_at: isoNow() }).eq('source_key', sourceKey);
  if (error) throw new Error(`Archive job update: ${error.message}`);
}

async function insertJob(supabase, entry, now) {
  const row = {
    source_key: entry.sourceKey,
    source_bucket: entry.bucket,
    source_path: entry.path,
    source_url: entry.url,
    source_size: entry.metadata?.size || null,
    source_created_at: entry.metadata?.createdAt || null,
    master_unique_ids: [...new Set(entry.refs.map((ref) => String(ref.row.unique_id)))],
    invalid_reasons: [...entry.reasons],
    status: 'pending',
    first_ref_scan_at: now.toISOString()
  };
  const { data, error } = await supabase.from('ph_photo_archive_jobs').upsert(row, {
    onConflict: 'source_key', ignoreDuplicates: true
  }).select('*').maybeSingle();
  if (error) throw new Error(`Archive job insert: ${error.message}`);
  return data;
}

async function clearDeletedReference(supabase, entry) {
  for (const ref of entry?.refs || []) {
    const row = ref.row;
    const links = splitPhotoLinks(row.photo_link);
    const names = String(row.photo_name || '').split(/\s*,\s*/).filter(Boolean);
    const keepIndexes = links.map((value, index) => ({ parsed: parseStorageObjectUrl(value), value, index }))
      .filter(({ parsed }) => !parsed || parsed.sourceKey !== entry.sourceKey);
    if (keepIndexes.length === links.length) continue;
    const patch = { photo_link: keepIndexes.length ? keepIndexes.map((item) => item.value).join(', ') : null };
    if (names.length === links.length) patch.photo_name = keepIndexes.length ? keepIndexes.map((item) => names[item.index]).join(', ') : null;
    const { error } = await supabase.from('ph_master_inventory').update(patch)
      .eq('unique_id', row.unique_id)
      .eq('photo_link', row.photo_link);
    if (error) throw new Error(`Clear deleted master photo ${row.unique_id}: ${error.message}`);
  }
}

async function acquireRun(supabase, localDate) {
  const run = { local_archive_date: localDate, status: 'running', release: RELEASE, started_at: isoNow(), updated_at: isoNow() };
  const { data, error } = await supabase.from('ph_photo_archive_runs').insert(run).select('*').single();
  if (!error) return { run: data, skipped: false };
  if (error.code !== '23505') throw new Error(`Archive run lock: ${error.message}`);
  const { data: existing, error: readError } = await supabase.from('ph_photo_archive_runs')
    .select('*').eq('local_archive_date', localDate).single();
  if (readError) throw new Error(`Archive run lock lookup: ${readError.message}`);
  if (existing.status === 'completed') return { run: existing, skipped: true };
  const { data: retried, error: retryError } = await supabase.from('ph_photo_archive_runs')
    .update({ status: 'running', release: RELEASE, started_at: isoNow(), error_code: null, updated_at: isoNow() })
    .eq('id', existing.id).select('*').single();
  if (retryError) throw new Error(`Archive run retry lock: ${retryError.message}`);
  return { run: retried, skipped: false };
}

async function main() {
  const startedAt = new Date();
  const schedule = getChicagoSchedule(startedAt);
  const eventSchedule = String(process.env.GITHUB_EVENT_SCHEDULE || '').trim();
  const dryRun = boolEnv('ARCHIVE_DRY_RUN', false);
  const deletionEnabled = boolEnv('ARCHIVE_DELETE_ENABLED', true);
  const outputPath = String(process.env.PHOTO_ARCHIVE_REPORT_PATH || 'artifacts/photo-archive-run.json');
  const scheduledEvent = String(process.env.GITHUB_EVENT_NAME || '') === 'schedule';
  if (scheduledEvent && eventSchedule !== schedule.expectedGithubCron) {
    const result = { release: RELEASE, status: 'dst_gate_noop', ...schedule, eventSchedule, startedAt: startedAt.toISOString() };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const serviceAccountRaw = String(process.env.GDRIVE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!supabaseUrl || !serviceRoleKey || !serviceAccountRaw) {
    throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and GDRIVE_SERVICE_ACCOUNT_JSON are required.');
  }
  const driveFolders = Object.fromEntries(Object.entries(DRIVE_FOLDER_ENV).map(([bucket, envName]) => [bucket, String(process.env[envName] || '').trim()]));
  for (const [bucket, folderId] of Object.entries(driveFolders)) if (!folderId) throw new Error(`Missing Drive folder ID for ${bucket}.`);
  const manifestFolderId = String(process.env.GDRIVE_MANIFEST_FOLDER_ID || '').trim();
  const failedFolderId = String(process.env.GDRIVE_FAILED_FOLDER_ID || '').trim();
  if (!manifestFolderId || !failedFolderId) throw new Error('Drive manifest and failed-job folder IDs are required.');

  const serviceAccount = JSON.parse(serviceAccountRaw);
  const accessToken = await retry('Google OAuth', () => getGoogleAccessToken(serviceAccount), { attempts: 3, baseMs: 1000 });
  for (const folderId of [...new Set([...Object.values(driveFolders), manifestFolderId, failedFolderId])]) {
    await verifyDriveFolder(accessToken, folderId);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const runLock = dryRun ? { run: { id: null }, skipped: false } : await acquireRun(supabase, schedule.localDate);
  if (runLock.skipped) {
    process.stdout.write(`${JSON.stringify({ release: RELEASE, status: 'already_completed', localDate: schedule.localDate })}\n`);
    return;
  }

  const summary = {
    release: RELEASE,
    status: dryRun ? 'dry_run' : 'running',
    localDate: schedule.localDate,
    startedAt: startedAt.toISOString(),
    dryRun,
    deletionEnabled,
    rowsScanned: 0,
    referencesScanned: 0,
    candidatesFound: 0,
    copied: 0,
    verified: 0,
    quarantined: 0,
    deleted: 0,
    blockedValidReference: 0,
    failed: 0,
    failures: []
  };

  try {
    const rows = await loadMasterRows(supabase);
    const references = await buildReferenceMap(supabase, rows, startedAt);
    summary.rowsScanned = rows.length;
    summary.referencesScanned = [...references.values()].reduce((sum, entry) => sum + entry.refs.length, 0);
    const candidates = [...references.values()].filter((entry) => entry.reasons.size > 0 && allReferencesInvalid(entry));
    summary.candidatesFound = candidates.length;

    if (!dryRun) {
      const { data: storedJobs, error: jobsError } = await supabase.from('ph_photo_archive_jobs').select('*').limit(5000);
      if (jobsError) throw new Error(`Archive jobs read: ${jobsError.message}`);
      const jobs = new Map((storedJobs || []).map((job) => [job.source_key, job]));
      for (const entry of candidates) {
        let job = jobs.get(entry.sourceKey);
        if (!job) {
          await insertJob(supabase, entry, startedAt);
          const { data, error } = await supabase.from('ph_photo_archive_jobs').select('*').eq('source_key', entry.sourceKey).single();
          if (error) throw new Error(`Archive job refresh: ${error.message}`);
          job = data;
          jobs.set(entry.sourceKey, job);
        } else {
          await updateJob(supabase, entry.sourceKey, {
            source_url: entry.url,
            master_unique_ids: [...new Set(entry.refs.map((ref) => String(ref.row.unique_id)))],
            invalid_reasons: [...entry.reasons]
          });
        }
        if (job.status === 'deleted' || job.drive_file_id && job.verified_at) continue;
        try {
          const downloaded = await retry('Storage download', () => downloadStorageObject(supabase, entry.bucket, entry.path), { attempts: 4, baseMs: 1000 });
          const sha256 = createHash('sha256').update(downloaded.bytes).digest('hex');
          const name = safeDriveName(entry.path, sha256, startedAt);
          const driveFile = await uploadDriveFile(accessToken, {
            folderId: driveFolders[entry.bucket],
            name,
            bytes: downloaded.bytes,
            mimeType: downloaded.mimeType || entry.metadata?.mimeType,
            sourceKey: entry.sourceKey,
            sha256
          });
          if (driveFile.trashed || Number(driveFile.size) !== downloaded.bytes.length || driveFile.appProperties?.sha256 !== sha256 || driveFile.appProperties?.sourceKey !== entry.sourceKey) {
            const verifyError = new Error('Drive verification did not match source size/hash metadata.');
            verifyError.code = 'drive_verify_mismatch';
            throw verifyError;
          }
          const quarantineUntil = addDays(startedAt, QUARANTINE_DAYS).toISOString();
          await updateJob(supabase, entry.sourceKey, {
            status: 'quarantined',
            source_size: downloaded.bytes.length,
            drive_folder_id: driveFolders[entry.bucket],
            drive_file_id: driveFile.id,
            drive_file_name: driveFile.name,
            sha256,
            attempts: Number(job.attempts || 0) + 1,
            copied_at: isoNow(),
            verified_at: isoNow(),
            quarantine_until: quarantineUntil,
            last_error_code: null,
            last_error_message: null
          });
          summary.copied += 1;
          summary.verified += 1;
          summary.quarantined += 1;
        } catch (error) {
          summary.failed += 1;
          summary.failures.push({ sourceKey: entry.sourceKey, bucket: entry.bucket, code: errorCode(error), message: compactError(error) });
          await updateJob(supabase, entry.sourceKey, {
            status: 'failed',
            attempts: Number(job.attempts || 0) + 1,
            last_error_code: errorCode(error),
            last_error_message: compactError(error)
          });
        }
      }

      const { data: lifecycleJobs, error: lifecycleError } = await supabase.from('ph_photo_archive_jobs')
        .select('*').in('status', ['verified', 'quarantined', 'blocked_valid_reference']).limit(5000);
      if (lifecycleError) throw new Error(`Archive lifecycle read: ${lifecycleError.message}`);
      for (const job of lifecycleJobs || []) {
        const entry = references.get(job.source_key);
        if (entry && !allReferencesInvalid(entry)) {
          summary.blockedValidReference += 1;
          await updateJob(supabase, job.source_key, { status: 'blocked_valid_reference', second_ref_scan_at: null });
          continue;
        }
        const firstScanAt = job.first_ref_scan_at ? new Date(job.first_ref_scan_at) : startedAt;
        let secondScanAt = job.second_ref_scan_at ? new Date(job.second_ref_scan_at) : null;
        if (!job.first_ref_scan_at) await updateJob(supabase, job.source_key, { first_ref_scan_at: startedAt.toISOString(), status: 'quarantined' });
        if (!secondScanAt && startedAt.getTime() - firstScanAt.getTime() >= SECOND_SCAN_HOURS * 60 * 60 * 1000) {
          secondScanAt = startedAt;
          await updateJob(supabase, job.source_key, { second_ref_scan_at: startedAt.toISOString(), status: 'quarantined' });
        }
        const quarantinePassed = job.quarantine_until && new Date(job.quarantine_until).getTime() <= startedAt.getTime();
        if (!deletionEnabled || !secondScanAt || !quarantinePassed) continue;
        try {
          const { error: removeError } = await supabase.storage.from(job.source_bucket).remove([job.source_path]);
          if (removeError) throw new Error(`Storage remove ${job.source_bucket}/${job.source_path}: ${removeError.message}`);
          await updateJob(supabase, job.source_key, { status: 'deleted', deleted_at: isoNow(), last_error_code: null, last_error_message: null });
          summary.deleted += 1;
          if (entry) {
            try {
              await clearDeletedReference(supabase, entry);
            } catch (clearError) {
              summary.failures.push({
                sourceKey: job.source_key,
                bucket: job.source_bucket,
                code: 'reference_clear_after_delete',
                message: compactError(clearError)
              });
            }
          }
        } catch (error) {
          summary.failed += 1;
          summary.failures.push({ sourceKey: job.source_key, bucket: job.source_bucket, code: errorCode(error), message: compactError(error) });
          await updateJob(supabase, job.source_key, { status: 'failed', last_error_code: errorCode(error), last_error_message: compactError(error) });
        }
      }
    }

    summary.status = dryRun ? 'dry_run_complete' : 'completed';
    summary.completedAt = isoNow();
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
    if (!dryRun) {
      const manifestName = `${schedule.localDate}__photo-archive-run.json`;
      await uploadJsonManifest(accessToken, manifestFolderId, manifestName, summary);
      if (summary.failures.length) await uploadJsonManifest(accessToken, failedFolderId, `${schedule.localDate}__failed-photo-jobs.json`, summary.failures);
      const { error: completeError } = await supabase.from('ph_photo_archive_runs').update({
        status: 'completed',
        completed_at: summary.completedAt,
        candidates_found: summary.candidatesFound,
        copied_count: summary.copied,
        verified_count: summary.verified,
        deleted_count: summary.deleted,
        failed_count: summary.failed,
        summary,
        updated_at: summary.completedAt
      }).eq('id', runLock.run.id);
      if (completeError) throw new Error(`Archive run completion: ${completeError.message}`);
    }
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (error) {
    summary.status = 'failed';
    summary.completedAt = isoNow();
    summary.failed += 1;
    summary.failures.push({ code: errorCode(error), message: compactError(error) });
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
    if (!dryRun && runLock.run.id) {
      await supabase.from('ph_photo_archive_runs').update({
        status: 'failed', completed_at: summary.completedAt, failed_count: summary.failed,
        error_code: errorCode(error), summary, updated_at: summary.completedAt
      }).eq('id', runLock.run.id);
    }
    throw error;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ level: 'error', release: RELEASE, code: errorCode(error), message: compactError(error) })}\n`);
    process.exitCode = 1;
  });
}
