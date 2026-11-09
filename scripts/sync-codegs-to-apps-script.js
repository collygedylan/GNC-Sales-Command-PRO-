import { prepareAppsScriptPublication, restoreAppsScriptHead, verifyScopedAppsScriptFiles } from '../src/services/apps-script-publication-preparation.mjs';
import { APPS_SCRIPT_DEPLOYMENT_CONFIG_FIELDS, appsScriptApiStatus, assertAppsScriptDeploymentConfig,
  captureAppsScriptDeploymentConfig } from '../src/services/apps-script-deployment-rollback.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';
import {
  REQUEST_LIFECYCLE_POLICY_VERSION,
  REQUEST_LIFECYCLE_REQUIRED_RECIPIENT_COUNT,
  syncAppsScriptProject,
  applyDeploymentFingerprint
} from './apps-script-sync-lib.mjs';
import {
  assertProductionAppsScriptTarget,
  verifyAppsScriptDeploymentOwnership
} from './lib/production-release-guard.mjs';
import { authorizeProductionAppsScriptDeploymentFromEnvironment } from './lib/apps-script-deployment-guard.mjs';
import { createAppsScriptRecoveryEvidence, writeAppsScriptHeadOnlyEvidence } from './apps-script-recovery-evidence.mjs';
import { createAppsScriptSourceGuard } from './apps-script-function-patch.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const codeGsPath = path.join(repoRoot, 'Code.gs');
const scriptId = String(process.env.APPS_SCRIPT_SCRIPT_ID || '').trim();
const claspRcJson = String(process.env.APPS_SCRIPT_CLASPRC_JSON || process.env.CLASPRC_JSON || '').trim();
const deploymentId = String(process.env.APPS_SCRIPT_DEPLOYMENT_ID || '').trim();
const expectedScriptId = String(process.env.APPS_SCRIPT_PRODUCTION_SCRIPT_ID || '').trim();
const expectedDeploymentId = String(process.env.APPS_SCRIPT_PRODUCTION_DEPLOYMENT_ID || '').trim();
const githubSha = String(process.env.GITHUB_SHA || '').trim();
const supabaseServiceRolePlaceholder = '__SUPABASE_SERVICE_ROLE_KEY__';
const publishDeployment = process.env.APPS_SCRIPT_SCOPED_DEPLOYMENT === 'true';

function fail(code) {
  console.error(`ERROR: ${String(code || 'APPS_SCRIPT_SYNC_FAILED')}`);
  process.exit(1);
}

function statusLine(message) {
  process.stdout.write(`${message}\n`);
}

function parseClaspRc(rawValue) {
  if (!rawValue) fail('APPS_SCRIPT_CLASPRC_JSON_MISSING');
  let text = rawValue;
  const possiblePath = path.resolve(repoRoot, rawValue);
  if (!rawValue.trim().startsWith('{') && fs.existsSync(possiblePath)) {
    text = fs.readFileSync(possiblePath, 'utf8');
  }
  try {
    return JSON.parse(text);
  } catch {
    fail('APPS_SCRIPT_CLASPRC_JSON_INVALID');
  }
}

function getOAuthClientFromClaspRc(claspRc) {
  const tokens = claspRc.tokens && typeof claspRc.tokens === 'object' ? claspRc.tokens : {};
  const mappedToken = tokens.default && typeof tokens.default === 'object'
    ? tokens.default
    : Object.values(tokens).find((candidate) => candidate && typeof candidate === 'object' && candidate.refresh_token);
  const token = claspRc.token || (tokens.refresh_token ? tokens : mappedToken) || {};
  const settings = claspRc.oauth2ClientSettings || claspRc.oauth2Client || {};
  const clientId = String(settings.clientId || settings.client_id || token.client_id || process.env.APPS_SCRIPT_CLIENT_ID || '').trim();
  const clientSecret = String(settings.clientSecret || settings.client_secret || token.client_secret || process.env.APPS_SCRIPT_CLIENT_SECRET || '').trim();
  const redirectUri = String(settings.redirectUri || settings.redirect_uri || token.redirect_uri || token.redirectUri || 'http://localhost').trim();
  const refreshToken = String(token.refresh_token || process.env.APPS_SCRIPT_REFRESH_TOKEN || '').trim();
  if (!clientId) fail('APPS_SCRIPT_OAUTH_CLIENT_ID_MISSING');
  if (!clientSecret) fail('APPS_SCRIPT_OAUTH_CLIENT_SECRET_MISSING');
  if (!refreshToken) fail('APPS_SCRIPT_OAUTH_REFRESH_TOKEN_MISSING');

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials({
    refresh_token: refreshToken,
    access_token: token.access_token,
    token_type: token.token_type || 'Bearer',
    expiry_date: token.expiry_date
  });
  return oauth2Client;
}

function appendSummary(result) {
  const summaryPath = String(process.env.GITHUB_STEP_SUMMARY || '').trim();
  if (!summaryPath) return;
  const deploymentLine = result.headOnly
    ? '@HEAD updated; immutable version creation and deployment updates were intentionally skipped'
    : result.versionCapacityExhausted
    ? `@HEAD updated for triggers; web app verified at existing version ${result.deployedVersionNumber}; immutable publication deferred (version capacity exhausted)`
    : result.deploymentUpdated
    ? `version ${result.versionNumber}, verified at version ${result.deployedVersionNumber}`
    : 'source updated without deployment advancement';
  const healthLines = result.health
    ? `\n- Deployed commit: ${result.health.deployedCommit}\n- Lifecycle policy: ${result.health.lifecycleRecipientPolicyVersion}\n- Required lifecycle recipients: ${result.health.requiredRecipientCount}`
    : '';
  fs.appendFileSync(
    summaryPath,
    `## Apps Script sync\n\n- Version capacity before sync: ${result.versionCountBefore}/200\n- Result: ${deploymentLine}${healthLines}\n`
  );
}

async function initializePublication() {
  try {
    assertProductionAppsScriptTarget({ scriptId, deploymentId, expectedScriptId, expectedDeploymentId });
  } catch (error) {
    fail(error?.code || 'PRODUCTION_RELEASE_GUARD_TARGET_INVALID');
  }
  if (!fs.existsSync(codeGsPath)) fail('APPS_SCRIPT_SOURCE_NOT_FOUND');
  const source = fs.readFileSync(codeGsPath, 'utf8');
  if (!source.trim()) fail('APPS_SCRIPT_SOURCE_EMPTY');
  if (source.includes(supabaseServiceRolePlaceholder)) {
    statusLine('Supabase service credentials remain in Apps Script Properties; no credential is embedded in source.');
  }

  await authorizeProductionAppsScriptDeploymentFromEnvironment();
  const claspRc = parseClaspRc(claspRcJson);
  const auth = getOAuthClientFromClaspRc(claspRc);
  const script = google.script({ version: 'v1', auth });

  const deploymentBeforeSync = await verifyAppsScriptDeploymentOwnership({ script, scriptId, deploymentId,
    fields: APPS_SCRIPT_DEPLOYMENT_CONFIG_FIELDS, requestOptions: { timeout: 12000, retry: false } });
  const previousConfig = captureAppsScriptDeploymentConfig(deploymentBeforeSync.deploymentConfig);
  const existingDeploymentVersion = previousConfig.versionNumber;
  statusLine('Production Apps Script deployment ownership verified.');
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const prepared = await prepareAppsScriptPublication({ script, scriptId, source, manifest,
    githubSha, applyFingerprint: applyDeploymentFingerprint,
    deployedVersion: publishDeployment ? existingDeploymentVersion : undefined });
  return { script, existingDeploymentVersion, previousConfig, ...prepared };
}

async function authorizeScopedMutation(script, previousConfig) {
  await authorizeProductionAppsScriptDeploymentFromEnvironment();
  if (!publishDeployment) return;
  await assertAppsScriptDeploymentConfig({ script, scriptId, deploymentId }, previousConfig, 'APPS_SCRIPT_SCOPED_DEPLOYMENT_CHANGED');
}

async function publishPreparedSource(prepared) {
  const { script, source, companionFiles, patchEvidence, expectedRemoteDigest, publishedDigest, deployedBaseFiles, previousConfig } = prepared;
  let restorationAttempted = false;
  const restoreHead = async () => {
    restorationAttempted = true;
    await restoreAppsScriptHead({ script, scriptId, headFiles: prepared.headFiles, expectedRemoteDigest, publishedDigest,
      authorize: authorizeProductionAppsScriptDeploymentFromEnvironment });
  };
  const verifyVersionFiles = versionNumber => verifyScopedAppsScriptFiles({ script, scriptId, versionNumber, expectedDigest: publishedDigest });
  const mode = publishDeployment ? { requireVersionCreation: true, deployedBaseFiles,
    verifyPreparedVersion: verifyVersionFiles, afterPreparedVersion: restoreHead, verifyPublishedVersion: verifyVersionFiles,
    rollbackDeployment: { previousConfig, authorize: authorizeProductionAppsScriptDeploymentFromEnvironment },
    recordDeploymentEvidence: (result, candidateConfig) => recordDeploymentEvidence(prepared, result, candidateConfig) }
    : { headOnly: true };
  statusLine(publishDeployment ? 'Publishing scoped Apps Script changes to the existing deployment...'
    : 'Syncing guarded Apps Script @HEAD only; immutable versions and deployments are disabled...');
  try {
    return await syncAppsScriptProject({ script, scriptId, deploymentId, source, companionFiles, githubSha,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '', ...mode,
      beforeMutation: patchEvidence ? createAppsScriptSourceGuard({ script, scriptId,
        beforeDigest: expectedRemoteDigest, afterDigest: publishedDigest,
        authorize: () => authorizeScopedMutation(script, previousConfig),
      }) : authorizeProductionAppsScriptDeploymentFromEnvironment });
  } catch (error) {
    if (publishDeployment && !restorationAttempted) await restoreHeadAfterPreparationFailure(restoreHead, error);
    throw error;
  }
}

async function restoreHeadAfterPreparationFailure(restoreHead, preparationError) {
  try {
    await restoreHead();
  } catch (restoreError) {
    throw new AggregateError([preparationError, restoreError], 'APPS_SCRIPT_SCOPED_HEAD_CLEANUP_FAILED');
  }
}

async function recordHeadEvidence({ script, publishedDigest, existingDeploymentVersion }) {
    const evidenceDirectory = process.platform === 'win32'
      ? path.win32.resolve('G:\\My Drive\\GNC\\AgData\\Release Evidence\\Apps Script')
      : path.join(repoRoot, '.gnc-local');
    try {
      await writeAppsScriptHeadOnlyEvidence({ script, scriptId, deploymentId,
        expectedCommit: githubSha, expectedDeploymentVersion: existingDeploymentVersion,
        expectedFilesDigest: publishedDigest, evidenceDirectory });
    } catch (error) {
      fail(error?.code || error?.message || 'APPS_SCRIPT_HEAD_ONLY_EVIDENCE_FAILED');
    }

}

async function recordDeploymentEvidence({ script, source, patchEvidence }, result, candidateConfig) {
    const evidence = await createAppsScriptRecoveryEvidence({
      script,
      scriptId,
      deploymentId,
      expectedCommit: githubSha,
      expectedVersionNumber: result.versionNumber,
      expectedDeploymentConfig: candidateConfig,
      expectedSource: applyDeploymentFingerprint(source, githubSha),
      attempts: 13,
      onObservation: observation => console.warn(JSON.stringify(observation))
    });
    const evidenceDirectory = process.platform === 'win32'
      ? path.win32.resolve('G:\\My Drive\\GNC\\AgData\\Release Evidence\\Apps Script') : path.join(repoRoot, '.gnc-local');
    fs.mkdirSync(evidenceDirectory, { recursive: true });
    fs.writeFileSync(path.join(evidenceDirectory, 'apps-script-recovery-evidence.json'), `${JSON.stringify({ ...evidence, scopedPatch: patchEvidence }, null, 2)}\n`);

}

async function reportPublication(prepared, result) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT,
    `head-updated=${!publishDeployment && result.headUpdated === true}\nversion-capacity-exhausted=${result.versionCapacityExhausted === true}\n`);
  if (result.headOnly) {
    if (!prepared.publishedDigest) fail('APPS_SCRIPT_HEAD_SYNC_VERIFICATION_FAILED');
    await recordHeadEvidence(prepared);
    statusLine(`Apps Script @HEAD updated (${result.versionCountBefore}/200 existing versions).`);
    statusLine('Apps Script @HEAD sync verified; no version creation or deployment update was attempted.');
  } else {
    statusLine('Scoped deployment files and restored unpublished HEAD verified.');
    statusLine(`Deployment updated and verified at Apps Script version ${result.versionNumber}.`);
    statusLine(`Deployment health verified for commit ${result.health.deployedCommit.slice(0, 7)}.`);
    statusLine(`Lifecycle recipient policy ${REQUEST_LIFECYCLE_POLICY_VERSION} verified with ${REQUEST_LIFECYCLE_REQUIRED_RECIPIENT_COUNT} required recipients.`);
  }
  appendSummary(result);
}

async function main() {
  const prepared = await initializePublication();
  const result = await publishPreparedSource(prepared);
  await reportPublication(prepared, result);
}

const safeIoErrorCodes = new Set(['EACCES', 'ECONNABORTED', 'ECONNREFUSED', 'ECONNRESET', 'ENOSPC', 'ETIMEDOUT']);

function sanitizedErrorCode(error) {
  const code = String(error?.code || error?.message || '').trim();
  if (/^(?:APPS_SCRIPT_|PRODUCTION_RELEASE_GUARD_)[A-Z0-9_]{1,100}$/.test(code)) return code;
  const status = appsScriptApiStatus(error);
  if (status) return `APPS_SCRIPT_API_HTTP_${status}`;
  if (safeIoErrorCodes.has(code)) return `APPS_SCRIPT_IO_${code}`;
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return 'APPS_SCRIPT_API_REQUEST_TIMEOUT';
  return 'APPS_SCRIPT_SYNC_FAILED';
}

function failPublication(error) {
  if (error instanceof AggregateError) {
    console.error(`Apps Script publication causes: ${error.errors.map(sanitizedErrorCode).join(', ')}`);
  }
  fail(sanitizedErrorCode(error));
}

main().catch(failPublication);
