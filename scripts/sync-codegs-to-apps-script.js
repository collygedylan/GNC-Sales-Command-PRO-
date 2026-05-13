const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const repoRoot = path.resolve(__dirname, '..');
const codeGsPath = path.join(repoRoot, 'Code.gs');
const scriptId = String(process.env.APPS_SCRIPT_SCRIPT_ID || '').trim();
const claspRcJson = String(process.env.APPS_SCRIPT_CLASPRC_JSON || process.env.CLASPRC_JSON || '').trim();
const deploymentId = String(process.env.APPS_SCRIPT_DEPLOYMENT_ID || '').trim();
const githubSha = String(process.env.GITHUB_SHA || '').trim();

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseClaspRc(rawValue) {
  if (!rawValue) fail('APPS_SCRIPT_CLASPRC_JSON secret is required.');

  let text = rawValue;
  const possiblePath = path.resolve(repoRoot, rawValue);
  if (!rawValue.trim().startsWith('{') && fs.existsSync(possiblePath)) {
    text = fs.readFileSync(possiblePath, 'utf8');
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`APPS_SCRIPT_CLASPRC_JSON is not valid JSON: ${error.message}`);
  }
}

function getOAuthClientFromClaspRc(claspRc) {
  const token = claspRc.token || claspRc.tokens || {};
  const settings = claspRc.oauth2ClientSettings || claspRc.oauth2Client || {};
  const clientId = String(settings.clientId || settings.client_id || process.env.APPS_SCRIPT_CLIENT_ID || '').trim();
  const clientSecret = String(settings.clientSecret || settings.client_secret || process.env.APPS_SCRIPT_CLIENT_SECRET || '').trim();
  const redirectUri = String(settings.redirectUri || settings.redirect_uri || 'http://localhost').trim();
  const refreshToken = String(token.refresh_token || process.env.APPS_SCRIPT_REFRESH_TOKEN || '').trim();

  if (!clientId) fail('OAuth client ID is missing from APPS_SCRIPT_CLASPRC_JSON.');
  if (!clientSecret) fail('OAuth client secret is missing from APPS_SCRIPT_CLASPRC_JSON.');
  if (!refreshToken) fail('OAuth refresh token is missing from APPS_SCRIPT_CLASPRC_JSON.');

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials({
    refresh_token: refreshToken,
    access_token: token.access_token,
    token_type: token.token_type || 'Bearer',
    expiry_date: token.expiry_date
  });
  return oauth2Client;
}

function normalizeAppsScriptFileName(name) {
  return String(name || '').trim().replace(/\.(gs|js)$/i, '');
}

async function main() {
  if (!scriptId) fail('APPS_SCRIPT_SCRIPT_ID secret is required.');
  if (!fs.existsSync(codeGsPath)) fail(`Code.gs was not found at ${codeGsPath}.`);

  const source = fs.readFileSync(codeGsPath, 'utf8');
  if (!source.trim()) fail('Code.gs is empty. Refusing to sync an empty Apps Script source file.');

  const claspRc = parseClaspRc(claspRcJson);
  const auth = getOAuthClientFromClaspRc(claspRc);
  const script = google.script({ version: 'v1', auth });

  console.log(`Fetching Apps Script project ${scriptId}...`);
  const current = await script.projects.getContent({ scriptId });
  const files = Array.isArray(current.data.files) ? current.data.files.slice() : [];
  if (!files.length) fail('Apps Script project content was empty or could not be read.');

  const codeFileIndex = files.findIndex((file) => {
    const name = normalizeAppsScriptFileName(file.name);
    return name === 'Code' && file.type === 'SERVER_JS';
  });

  const nextCodeFile = {
    name: 'Code',
    type: 'SERVER_JS',
    source
  };

  if (codeFileIndex >= 0) {
    files[codeFileIndex] = {
      ...files[codeFileIndex],
      ...nextCodeFile
    };
  } else {
    files.push(nextCodeFile);
  }

  console.log('Updating Code.gs while preserving other Apps Script files...');
  await script.projects.updateContent({
    scriptId,
    requestBody: { files }
  });
  console.log('Code.gs synced to Apps Script project.');

  if (!deploymentId) {
    console.log('APPS_SCRIPT_DEPLOYMENT_ID was not provided. Code was updated, but no web-app deployment was advanced.');
    return;
  }

  const shortSha = githubSha ? githubSha.slice(0, 7) : new Date().toISOString();
  const description = `GitHub Code.gs sync ${shortSha}`;
  console.log(`Creating Apps Script version for deployment ${deploymentId}...`);
  const version = await script.projects.versions.create({
    scriptId,
    requestBody: { description }
  });

  const versionNumber = version.data.versionNumber;
  if (!versionNumber) fail('Apps Script version was created without a version number.');

  console.log(`Updating Apps Script deployment ${deploymentId} to version ${versionNumber}...`);
  await script.projects.deployments.update({
    scriptId,
    deploymentId,
    requestBody: {
      deploymentConfig: {
        versionNumber,
        manifestFileName: 'appsscript',
        description
      }
    }
  });
  console.log(`Deployment updated to Apps Script version ${versionNumber}.`);
}

main().catch((error) => {
  const details = error && error.response && error.response.data
    ? JSON.stringify(error.response.data, null, 2)
    : (error && error.stack ? error.stack : String(error));
  fail(details);
});
