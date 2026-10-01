import { createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const EXPECTED_SHEETS = [
  'PROD SCHED', 'PltDate-PltGrp', 'ContTable', 'Code Key',
  'Calculations', "New Weighted%'s", 'CPB',
];

function fail(code) {
  throw new Error(code);
}

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) fail(`PRODUCTION_SCHEDULE_${name}_REQUIRED`);
  return value;
}

function serviceHeaders(url, key) {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
    accept: 'application/json',
  };
}

export function createSignedInitialImport({ snapshotId, requestedBy, timestamp, secret }) {
  const deliveryJson = JSON.stringify({
    contractVersion: 'production-schedule-import-v1',
    workbookId: '1myBn2DzyhYtTj2MmYatf26jz575TjqxSpxC-kFt1Mhw',
    runId: snapshotId,
    snapshotId,
    requestedBy,
  });
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${deliveryJson}`, 'utf8')
    .digest('base64url');
  return { type: 'production_schedule_import_v1', timestamp, signature, deliveryJson };
}

export function assertCompleteSnapshot(metadata, expectedSnapshotId) {
  const snapshot = metadata?.snapshot;
  const sheets = Array.isArray(metadata?.sheets) ? metadata.sheets : [];
  if (!snapshot?.id || snapshot.id !== expectedSnapshotId || sheets.length !== EXPECTED_SHEETS.length) {
    fail('PRODUCTION_SCHEDULE_SNAPSHOT_INCOMPLETE');
  }
  for (let index = 0; index < EXPECTED_SHEETS.length; index += 1) {
    const sheet = sheets[index];
    if (sheet?.index !== index || sheet?.title !== EXPECTED_SHEETS[index] || !Array.isArray(sheet.columns)) {
      fail('PRODUCTION_SCHEDULE_SHEET_SET_MISMATCH');
    }
  }
  if (!(Number(sheets[0]?.rowCount) > 0)) fail('PRODUCTION_SCHEDULE_MAIN_SHEET_EMPTY');
  return { snapshotId: snapshot.id, sheetCount: sheets.length, rowCount: sheets.reduce((sum, sheet) => sum + Number(sheet.rowCount || 0), 0) };
}

async function readJson(url, init, marker) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30000), redirect: 'follow' });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; }
  catch { fail(`${marker}_INVALID_JSON`); }
  if (!response.ok) fail(`${marker}_HTTP_${response.status}`);
  return data;
}

async function rpc(baseUrl, headers, name, body) {
  return readJson(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  }, `PRODUCTION_SCHEDULE_${name.toUpperCase()}`);
}

async function main() {
  const rawSupabaseUrl = required('SUPABASE_URL');
  const supabaseUrl = new URL(rawSupabaseUrl);
  if (supabaseUrl.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/.test(supabaseUrl.hostname)) fail('PRODUCTION_SCHEDULE_SUPABASE_URL_INVALID');
  const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');
  const signingSecret = serviceKey;
  const appsScriptUrl = new URL(required('APPS_SCRIPT_WEB_APP_URL'));
  if (appsScriptUrl.protocol !== 'https:' || appsScriptUrl.hostname !== 'script.google.com'
      || !/^\/macros\/s\/AKfy[a-zA-Z0-9_-]+\/exec$/.test(appsScriptUrl.pathname)) {
    fail('PRODUCTION_SCHEDULE_APPS_SCRIPT_URL_INVALID');
  }
  const timeoutMs = Math.max(60_000, Math.min(21_600_000, Number(process.env.PRODUCTION_SCHEDULE_IMPORT_TIMEOUT_MS) || 14_400_000));
  const headers = serviceHeaders(supabaseUrl, serviceKey);
  const started = await rpc(supabaseUrl.origin, headers, 'production_schedule_start_import_v1', {
    p_requested_by: 'github_actions_release',
  });
  const snapshotId = String(started?.snapshot_id || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(snapshotId)) {
    fail('PRODUCTION_SCHEDULE_IMPORT_ID_INVALID');
  }

  // Re-delivering the same signed snapshot also restores a lost worker trigger.
  const timestamp = new Date().toISOString();
  const command = createSignedInitialImport({ snapshotId, requestedBy: 'github_actions_release', timestamp, secret: signingSecret });
  const accepted = await readJson(appsScriptUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(command),
  }, 'PRODUCTION_SCHEDULE_IMPORT_DISPATCH');
  if (accepted?.ok !== true || accepted?.accepted !== true || accepted?.snapshotId !== snapshotId) {
    fail(`PRODUCTION_SCHEDULE_IMPORT_NOT_ACCEPTED_${String(accepted?.code || 'UNKNOWN').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 60)}`);
  }

  const deadline = Date.now() + timeoutMs;
  let lastStatus = '';
  while (Date.now() < deadline) {
    const status = await rpc(supabaseUrl.origin, headers, 'production_schedule_read_status_v1', { p_snapshot_id: snapshotId });
    if (status?.id !== snapshotId) fail('PRODUCTION_SCHEDULE_IMPORT_STATUS_ID_MISMATCH');
    if (status.status !== lastStatus) {
      console.log(`Production Schedule import status: ${status.status}.`);
      lastStatus = String(status.status || '');
    }
    if (status.status === 'failed') fail(`PRODUCTION_SCHEDULE_IMPORT_FAILED_${String(status.errorCode || 'UNKNOWN').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 60)}`);
    if (status.status === 'ready') {
      const metadata = await rpc(supabaseUrl.origin, headers, 'production_schedule_read_metadata_v1', {});
      const result = assertCompleteSnapshot(metadata, snapshotId);
      console.log(`PRODUCTION_SCHEDULE_SNAPSHOT_READY sheets=${result.sheetCount} rows=${result.rowCount}`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 60_000));
  }
  fail('PRODUCTION_SCHEDULE_IMPORT_TIMEOUT');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    const marker = /^[A-Z0-9_]+$/.test(String(error?.message || '')) ? error.message : 'PRODUCTION_SCHEDULE_RELEASE_SEED_FAILED';
    console.error(marker);
    process.exitCode = 1;
  });
}
