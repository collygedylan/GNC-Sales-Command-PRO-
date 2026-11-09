import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createAppsScriptDriveClient, createDirectDriveClient } from './photo-archive-drive-client.mjs';
import { copyArchiveCandidates, processArchiveLifecycle } from './photo-archive-jobs.mjs';

function archiveConfig(dependencies, startedAt) {
  const env = process.env;
  const schedule = dependencies.getChicagoSchedule(startedAt);
  return { dependencies, startedAt, schedule, outputPath: String(env.PHOTO_ARCHIVE_REPORT_PATH || 'artifacts/photo-archive-run.json'),
    dryRun: dependencies.boolEnv('ARCHIVE_DRY_RUN', false), deletionEnabled: dependencies.boolEnv('ARCHIVE_DELETE_ENABLED', true),
    requestArchiveReaderVerified: dependencies.boolEnv('REQUEST_ARCHIVE_READER_VERIFIED', false),
    scheduledNoop: env.GITHUB_EVENT_NAME === 'schedule' && String(env.GITHUB_EVENT_SCHEDULE || '').trim() !== schedule.expectedGithubCron };
}

async function writeReport(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function configuredDriveClient(deps, deploymentId, serviceRoleKey, requestPhotoRoot) {
  if (deploymentId) return createAppsScriptDriveClient(deploymentId, serviceRoleKey, { retry: deps.retry });
  const serviceAccount = process.env.GDRIVE_SERVICE_ACCOUNT_JSON ? JSON.parse(process.env.GDRIVE_SERVICE_ACCOUNT_JSON) : null;
  const claspRc = process.env.APPS_SCRIPT_CLASPRC_JSON ? JSON.parse(process.env.APPS_SCRIPT_CLASPRC_JSON) : null;
  const accessToken = await deps.retry('Google OAuth', () => {
    if (serviceAccount?.client_email && serviceAccount?.private_key) return deps.getGoogleAccessToken(serviceAccount);
    if (claspRc) return deps.getGoogleAccessTokenFromClasp(claspRc);
    const error = new Error('Google Drive service-account secret is not a service-account key and no Apps Script OAuth fallback is configured.');
    error.code = 'google_credentials_invalid';
    throw error;
  }, { attempts: 3, baseMs: 1000 });
  return createDirectDriveClient(accessToken, deps, requestPhotoRoot);
}

async function initializeArchive(context) {
  const { dependencies: deps } = context;
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const deploymentId = String(process.env.APPS_SCRIPT_DEPLOYMENT_ID || '').trim();
  if (!url || !key || !deploymentId && !process.env.GDRIVE_SERVICE_ACCOUNT_JSON && !process.env.APPS_SCRIPT_CLASPRC_JSON) {
    throw new Error('Supabase credentials and one Google Drive credential are required.');
  }
  context.driveFolders = Object.fromEntries(Object.entries(deps.driveFolderEnv).map(([bucket, env]) => [bucket, String(process.env[env] || '').trim()]));
  for (const [bucket, id] of Object.entries(context.driveFolders)) if (!id) throw new Error(`Missing Drive folder ID for ${bucket}.`);
  context.manifestFolderId = String(process.env.GDRIVE_MANIFEST_FOLDER_ID || '').trim();
  context.failedFolderId = String(process.env.GDRIVE_FAILED_FOLDER_ID || '').trim();
  if (!context.manifestFolderId || !context.failedFolderId) throw new Error('Drive manifest and failed-job folder IDs are required.');
  context.driveClient = await configuredDriveClient(deps, deploymentId, key, context.driveFolders.request_photos);
  await context.driveClient.verifyFolders([...new Set([...Object.values(context.driveFolders), context.manifestFolderId, context.failedFolderId])]);
  context.supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  context.runLock = context.dryRun ? { run: { id: null }, skipped: false } : await deps.acquireRun(context.supabase, context.schedule.localDate);
}

function archiveSummary(context) {
  return { release: context.dependencies.release, status: context.dryRun ? 'dry_run' : 'running',
    localDate: context.schedule.localDate, startedAt: context.startedAt.toISOString(), dryRun: context.dryRun,
    deletionEnabled: context.deletionEnabled, requestArchiveReaderVerified: context.requestArchiveReaderVerified,
    rowsScanned: 0, referencesScanned: 0, candidatesFound: 0,
    copied: 0, verified: 0, quarantined: 0, deleted: 0, recoveredArchivePaths: 0,
    blockedValidReference: 0, failed: 0, failures: [] };
}

async function uploadArchiveManifest(context, folderId, name, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await context.driveClient.upload({ folderId, name, bytes, mimeType: 'application/json',
    sourceKey: createHash('sha256').update(name).digest('hex'), sha256: createHash('sha256').update(bytes).digest('hex') });
}

async function completeArchive(context) {
  const { summary, dependencies: deps } = context;
  summary.status = context.dryRun ? 'dry_run_complete' : 'completed';
  summary.completedAt = deps.isoNow();
  await writeReport(context.outputPath, summary);
  if (!context.dryRun) {
    await uploadArchiveManifest(context, context.manifestFolderId, `${context.schedule.localDate}__photo-archive-run.json`, summary);
    if (summary.failures.length) await uploadArchiveManifest(context, context.failedFolderId, `${context.schedule.localDate}__failed-photo-jobs.json`, summary.failures);
    const { error } = await context.supabase.from('ph_photo_archive_runs').update({ status: 'completed',
      completed_at: summary.completedAt, candidates_found: summary.candidatesFound, copied_count: summary.copied,
      verified_count: summary.verified, deleted_count: summary.deleted, failed_count: summary.failed,
      summary, updated_at: summary.completedAt }).eq('id', context.runLock.run.id);
    if (error) throw new Error(`Archive run completion: ${error.message}`);
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

async function failArchive(context, error) {
  const { summary, dependencies: deps } = context;
  summary.status = 'failed';
  summary.completedAt = deps.isoNow();
  summary.failed += 1;
  summary.failures.push({ code: deps.errorCode(error), message: deps.compactError(error) });
  await writeReport(context.outputPath, summary);
  if (!context.dryRun && context.runLock.run.id) {
    const result = await context.supabase.from('ph_photo_archive_runs').update({ status: 'failed', completed_at: summary.completedAt,
      failed_count: summary.failed, error_code: deps.errorCode(error), summary, updated_at: summary.completedAt }).eq('id', context.runLock.run.id);
    if (result.error) throw new AggregateError([error, result.error], 'Archive failure receipt could not be saved.');
  }
}

async function executeArchive(context) {
  const { dependencies: deps, summary } = context;
  try {
    const rows = await deps.loadMasterRows(context.supabase);
    const references = await deps.buildReferenceMap(context.supabase, rows, context.startedAt);
    summary.rowsScanned = rows.length;
    summary.referencesScanned = [...references.values()].reduce((sum, entry) => sum + entry.refs.length, 0);
    const candidates = [...references.values()].filter(entry => entry.reasons.size > 0 && deps.allReferencesInvalid(entry));
    summary.candidatesFound = candidates.length;
    if (!context.dryRun) {
      await copyArchiveCandidates(context, candidates);
      await processArchiveLifecycle(context, references);
    }
    await completeArchive(context);
  } catch (error) {
    await failArchive(context, error);
    throw error;
  }
}

export async function runPhotoArchiveWorker(dependencies) {
  const context = archiveConfig(dependencies, new Date());
  if (context.scheduledNoop) {
    const result = { release: dependencies.release, status: 'dst_gate_noop', ...context.schedule,
      eventSchedule: String(process.env.GITHUB_EVENT_SCHEDULE || '').trim(), startedAt: context.startedAt.toISOString() };
    await writeReport(context.outputPath, result);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  await initializeArchive(context);
  if (context.runLock.skipped) {
    process.stdout.write(`${JSON.stringify({ release: dependencies.release, status: 'already_completed', localDate: context.schedule.localDate })}\n`);
    return;
  }
  context.summary = archiveSummary(context);
  await executeArchive(context);
}
