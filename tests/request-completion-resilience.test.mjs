import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const saveData = html.slice(
  html.indexOf('async function saveData('),
  html.indexOf('function getPendingEditsCache(')
);
const completionSchemaProbe = html.slice(
  html.indexOf('async function ensureRequestCompletionUserColumnsReady('),
  html.indexOf('const EVAL_TASK_ASSIGNMENT')
);
const nativeHeaders = html.slice(
  html.indexOf('async function getNativeAuthRequestHeaders('),
  html.indexOf('function readCachedNativeAuthProfile(')
);

test('Request completion derives the completing user server-side without a legacy schema probe', () => {
  assert.doesNotMatch(saveData, /await ensureRequestCompletionUserColumnsReady\(/);
  assert.match(saveData, /save_request_work derives completion identity from the/);
  assert.match(completionSchemaProbe, /const nativeHeaders = await getNativeAuthRequestHeaders\(\)/);
  assert.match(completionSchemaProbe, /headers: nativeHeaders/);
  assert.doesNotMatch(completionSchemaProbe, /'Authorization': 'Bearer ' \+ SUPABASE_KEY/);
});

test('native auth refreshes once before protected Request reads or writes fail', () => {
  assert.match(nativeHeaders, /client\.auth\.refreshSession\(\)/);
  assert.match(nativeHeaders, /nativeAuthAccessToken = String\(refreshedSession\.access_token/);
});

test('Request completion retries one current row-version conflict with the canonical version', () => {
  assert.match(saveData, /for \(let requestSaveAttempt = 0; requestSaveAttempt < 2;/);
  assert.match(saveData, /REQUEST_VERSION_CONFLICT/);
  assert.match(saveData, /const refreshedRow = await fetchRemoteRequestCompletionRow\(\)/);
  assert.match(saveData, /rpcExpectedVersion = refreshedVersion/);
});

test('Request completion never leaves a modal backdrop trapping the screen', () => {
  assert.match(saveData, /closeRequestPublishModal\('cancel'\);[\s\S]*closeRequestOpenInfoModal\(\);[\s\S]*closeRequestAvNoteSheet\(\);[\s\S]*closeAppPromptDialog\('cancel'\);/);
  assert.match(html, /body\.ios-device #request-open-info-modal,body\.ios-device #request-rep-modal\{backdrop-filter:none!important;-webkit-backdrop-filter:none!important/);
  assert.match(saveData, /Request Still Open/);
  assert.match(saveData, /Your entries are still here/);
});
