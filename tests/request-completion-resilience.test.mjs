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
const requestNativeInputContract = html.slice(
  html.indexOf('function isRequestDetailNativeTypingInput('),
  html.indexOf('function isDetailMeasurementKeyboardInput(')
);
const requestDetailEntryContract = html.slice(
  html.indexOf('function ensureRequestDetailEntryVisible('),
  html.indexOf('function renderEvalTaskDetailPanel(')
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

test('iPhone Request entry uses the native keyboard and bypasses fast press handling', () => {
  assert.match(requestNativeInputContract, /isIOSDevice\(\)/);
  for (const id of ['req-spec', 'req-caliper', 'req-match']) {
    assert.match(requestNativeInputContract, new RegExp(`['"]${id}['"]`));
  }
  for (const id of ['req-spec', 'req-caliper', 'req-match', 'req-av-note', 'req-pick', 'req-comments']) {
    const fieldTag = html.match(new RegExp(`<(?:input|textarea)[^>]*id=["']${id}["'][^>]*>`, 'i'))?.[0] || '';
    assert.match(fieldTag, /data-fast-press-ignore/);
  }
  assert.match(html, /#req-spec,#req-caliper,#req-match,#req-av-note,#req-pick,#req-comments[\s\S]*touch-action:auto !important[\s\S]*-webkit-user-select:text !important/);
});

test('iPhone Request hydration preserves the focused field and debounces viewport anchoring', () => {
  assert.match(html, /safePrefix === 'req-' && getActiveIosPhoneRequestDetailEntry\(\)/);
  assert.match(requestDetailEntryContract, /const activeRequestEntry = getActiveIosPhoneRequestDetailEntry\(\)/);
  assert.match(requestDetailEntryContract, /if \(!activeRequestEntry\) \{[\s\S]*populateDetailInputsForPrefix\('req-', activeItem\)/);
  assert.match(requestDetailEntryContract, /isIosPhoneRequestFlowView\('detail'\) && !activeRequestEntry/);
  assert.match(requestDetailEntryContract, /if \(iosPhoneRequestDetailAnchorTimer\) clearTimeout\(iosPhoneRequestDetailAnchorTimer\)/);
  assert.match(requestDetailEntryContract, /const delay = safeReason\.startsWith\('visual-'\) \? 320 : 360/);
  assert.doesNotMatch(requestDetailEntryContract, /setTimeout\(run, 80\)[\s\S]*setTimeout\(run, 260\)/);
});
