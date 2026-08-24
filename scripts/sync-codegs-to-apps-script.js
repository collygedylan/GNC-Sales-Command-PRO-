import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';
import {
  REQUEST_LIFECYCLE_POLICY_VERSION,
  REQUEST_LIFECYCLE_REQUIRED_RECIPIENT_COUNT,
  syncAppsScriptProject
} from './apps-script-sync-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const codeGsPath = path.join(repoRoot, 'Code.gs');
const scriptId = String(process.env.APPS_SCRIPT_SCRIPT_ID || '').trim();
const claspRcJson = String(process.env.APPS_SCRIPT_CLASPRC_JSON || process.env.CLASPRC_JSON || '').trim();
const deploymentId = String(process.env.APPS_SCRIPT_DEPLOYMENT_ID || '').trim();
const githubSha = String(process.env.GITHUB_SHA || '').trim();
const supabaseServiceRolePlaceholder = '__SUPABASE_SERVICE_ROLE_KEY__';

function fail(code) {
  console.error(`ERROR: ${String(code || 'APPS_SCRIPT_SYNC_FAILED')}`);
  process.exit(1);
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
  const deploymentLine = result.deploymentUpdated
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

async function main() {
  if (!scriptId) fail('APPS_SCRIPT_SCRIPT_ID_MISSING');
  if (!fs.existsSync(codeGsPath)) fail('APPS_SCRIPT_SOURCE_NOT_FOUND');
  const source = fs.readFileSync(codeGsPath, 'utf8');
  if (!source.trim()) fail('APPS_SCRIPT_SOURCE_EMPTY');
  if (source.includes(supabaseServiceRolePlaceholder)) {
    console.log('Supabase service credentials remain in Apps Script Properties; no credential is embedded in source.');
  }

  const claspRc = parseClaspRc(claspRcJson);
  const auth = getOAuthClientFromClaspRc(claspRc);
  const script = google.script({ version: 'v1', auth });

  console.log('Preflighting Apps Script version capacity before source update...');
  const result = await syncAppsScriptProject({
    script,
    scriptId,
    deploymentId,
    source,
    githubSha,
    logger: console
  });

  console.log(`Version capacity verified (${result.versionCountBefore}/200 before sync).`);
  if (result.deploymentUpdated) {
    console.log(`Deployment updated and verified at Apps Script version ${result.versionNumber}.`);
    console.log(`Deployment health verified for commit ${result.health.deployedCommit.slice(0, 7)}.`);
    console.log(`Lifecycle recipient policy ${REQUEST_LIFECYCLE_POLICY_VERSION} verified with ${REQUEST_LIFECYCLE_REQUIRED_RECIPIENT_COUNT} required recipients.`);
  } else {
    console.log('Code.gs synced; deployment advancement was not requested.');
  }
  appendSummary(result);
}

main().catch((error) => {
  const explicitCode = String(error?.code || error?.message || '').trim();
  if (/^[A-Z0-9_]+$/.test(explicitCode)) fail(explicitCode);
  const status = Number(error?.response?.status || error?.response?.statusCode || 0);
  fail(status ? `APPS_SCRIPT_API_HTTP_${status}` : 'APPS_SCRIPT_SYNC_FAILED');
});
