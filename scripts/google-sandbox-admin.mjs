import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { buildSandboxSource } from './apps-script-sandbox.mjs';

// Credentials remain in process memory. This helper never copies production
// Script Properties, changes production content, or creates a public web app.
export async function googleApiFromClasp(credentialsFile = path.join(os.homedir(), '.clasprc.json')) {
  const rc = JSON.parse(process.env.APPS_SCRIPT_CLASPRC_JSON || fs.readFileSync(credentialsFile, 'utf8'));
  const tokens = rc.tokens || {};
  const token = rc.token || tokens.default || Object.values(tokens).find(t => t?.refresh_token) || {};
  const settings = rc.oauth2ClientSettings || rc.oauth2Client || {};
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', signal: AbortSignal.timeout(15000), body: new URLSearchParams({
      client_id: settings.clientId || settings.client_id || token.client_id || '',
      client_secret: settings.clientSecret || settings.client_secret || token.client_secret || '',
      refresh_token: token.refresh_token || '', grant_type: 'refresh_token'
    })
  });
  const access = await response.json();
  if (!response.ok || !access.access_token) throw new Error(`GOOGLE_AUTH_HTTP_${response.status}`);
  return async (url, method = 'GET', body) => {
    if (!['https://script.googleapis.com', 'https://www.googleapis.com'].includes(new URL(url).origin)) throw new Error('GOOGLE_ORIGIN_BLOCKED');
    const r = await fetch(url, { method, signal: AbortSignal.timeout(20000),
      headers: { authorization: `Bearer ${access.access_token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!r.ok) throw new Error(`GOOGLE_API_HTTP_${r.status}`);
    return r.status === 204 ? {} : r.json();
  };
}

export async function findProductionScript(api, deploymentId) {
  let pageToken = '';
  for (let page = 0; page < 5; page++) {
    const query = new URLSearchParams({ q: "mimeType = 'application/vnd.google-apps.script' and trashed = false",
      fields: 'files(id),nextPageToken', pageSize: '100', ...(pageToken ? { pageToken } : {}) });
    const files = await api(`https://www.googleapis.com/drive/v3/files?${query}`);
    for (const file of files.files || []) {
      try {
        const deployment = await api(`https://script.googleapis.com/v1/projects/${file.id}/deployments/${deploymentId}`);
        return { scriptId: file.id, deploymentId, versionNumber: deployment.deploymentConfig.versionNumber };
      } catch (error) { if (!['GOOGLE_API_HTTP_404', 'GOOGLE_API_HTTP_403'].includes(error.message)) throw error; }
    }
    pageToken = files.nextPageToken;
    if (!pageToken) break;
  }
  throw new Error('PRODUCTION_SCRIPT_NOT_RESOLVED');
}

export async function provisionSandbox(api, source, production, saveState) {
  const title = 'GNC Isolated Test Sandbox';
  const query = new URLSearchParams({ q: `name = '${title}' and trashed = false`, fields: 'files(id,mimeType)', pageSize: '100' });
  const existing = (await api(`https://www.googleapis.com/drive/v3/files?${query}`)).files || [];
  if (existing.length > 1) throw new Error('SANDBOX_IDENTITY_AMBIGUOUS');
  let scriptId = existing[0]?.id;
  if (existing[0] && existing[0].mimeType !== 'application/vnd.google-apps.script') throw new Error('SANDBOX_IDENTITY_INVALID');
  if (!scriptId) {
    scriptId = (await api('https://script.googleapis.com/v1/projects', 'POST', { title })).scriptId;
    if (!/^[\w-]{10,120}$/.test(scriptId || '') || scriptId === production.scriptId) throw new Error('SANDBOX_PRODUCTION_TARGET_BLOCKED');
    // Mark ownership immediately, so interrupted folder setup is safely resumable.
    await api(`https://script.googleapis.com/v1/projects/${scriptId}/content`, 'PUT', { files: [
      { name: 'Code', type: 'SERVER_JS', source: `// GNC ISOLATED SANDBOX: ${scriptId}\n` },
      { name: 'appsscript', type: 'JSON', source: '{"timeZone":"America/Chicago","runtimeVersion":"V8"}' }
    ] });
  }
  if (!scriptId || scriptId === production.scriptId) throw new Error('SANDBOX_PRODUCTION_TARGET_BLOCKED');
  // A reused project must carry our marker before any source overwrite.
  if (existing.length) {
    const content = await api(`https://script.googleapis.com/v1/projects/${scriptId}/content`);
    if (!content.files?.some(f => f.source?.startsWith(`// GNC ISOLATED SANDBOX: ${scriptId}`))) throw new Error('SANDBOX_OWNERSHIP_UNVERIFIED');
  }
  const state = { schemaVersion: 'gnc-test-sandbox-v1', scriptId, production, folderMap: {}, folderIds: [] };
  saveState(state);
  const context = vm.createContext({ console: { warn() {}, log() {} }, PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) } });
  new vm.Script(source).runInContext(context, { timeout: 3000 });
  const folders = vm.runInContext('Object.assign({}, FOLDERS, { HISTORY: DRIVE_AROUND_HISTORY_FOLDER_ID })', context);
  for (const [key, originalId] of Object.entries(folders)) {
    if (!originalId || state.folderMap[originalId]) continue;
    const marker = `gnc-test-${scriptId}-${key}`;
    const q = new URLSearchParams({ q: `appProperties has { key='gncSandbox' and value='${marker}' } and trashed=false`, fields: 'files(id)', pageSize: '100' });
    const matches = (await api(`https://www.googleapis.com/drive/v3/files?${q}`)).files || [];
    if (matches.length > 1) throw new Error('SANDBOX_FOLDER_AMBIGUOUS');
    const folder = matches[0] || await api('https://www.googleapis.com/drive/v3/files?fields=id', 'POST', {
      name: `GNC TEST ONLY - ${key}`, mimeType: 'application/vnd.google-apps.folder', appProperties: { gncSandbox: marker }
    });
    if (Object.values(folders).includes(folder.id)) throw new Error('SANDBOX_PRODUCTION_FOLDER_BLOCKED');
    state.folderMap[originalId] = folder.id;
    state.folderIds.push(folder.id);
    saveState(state);
  }
  const sandbox = buildSandboxSource(source, state);
  await api(`https://script.googleapis.com/v1/projects/${scriptId}/content`, 'PUT', { files: [
    { name: 'Code', type: 'SERVER_JS', source: sandbox },
    { name: 'appsscript', type: 'JSON', source: JSON.stringify({ timeZone: 'America/Chicago', runtimeVersion: 'V8',
      exceptionLogging: 'STACKDRIVER', oauthScopes: ['https://www.googleapis.com/auth/drive'] }) }
  ] });
  state.sourceInstalled = true;
  state.emailMode = 'intercepted'; state.networkMode = 'blocked'; state.triggers = 'disabled';
  saveState(state);
  return state;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const operation = process.argv[2];
    if (!['inspect', 'provision'].includes(operation)) throw new Error('USAGE_GOOGLE_SANDBOX_ADMIN_INSPECT_OR_PROVISION');
    const source = fs.readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
    const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const deploymentId = html.match(/script.google.com\/macros\/s\/([^/]+)\/exec/)?.[1];
    if (!deploymentId) throw new Error('PRODUCTION_DEPLOYMENT_UNRESOLVED');
    const api = await googleApiFromClasp(process.env.GNC_CLASP_CREDENTIALS_FILE);
    const production = process.env.APPS_SCRIPT_SCRIPT_ID
      ? { scriptId: process.env.APPS_SCRIPT_SCRIPT_ID, deploymentId,
        versionNumber: (await api(`https://script.googleapis.com/v1/projects/${process.env.APPS_SCRIPT_SCRIPT_ID}/deployments/${deploymentId}`)).deploymentConfig.versionNumber }
      : await findProductionScript(api, deploymentId);
    if (operation === 'inspect') console.log(JSON.stringify(production));
    else {
      const directory = path.resolve('.gnc-local');
      fs.mkdirSync(directory, { recursive: true });
      const result = await provisionSandbox(api, source, production, state => fs.writeFileSync(path.join(directory, 'sandbox.json'), JSON.stringify(state, null, 2)));
      const status = { ok: true, folderCount: result.folderIds.length,
        emailMode: result.emailMode, networkMode: result.networkMode, productionUnchanged: true };
      fs.writeFileSync(path.join(directory, 'sandbox-status.json'), JSON.stringify(status));
      console.log(JSON.stringify(status));
    }
  } catch (error) {
    console.error(/^[A-Z0-9_]+$/.test(error.message) ? error.message : 'SANDBOX_ADMIN_FAILED'); process.exitCode = 1;
  }
}
