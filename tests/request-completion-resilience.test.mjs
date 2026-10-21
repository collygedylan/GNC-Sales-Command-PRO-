import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: requests,backend
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const html = readComposedAppSource();
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
  assert.match(completionSchemaProbe, /await fetchSupabasePage\(ACTIVE_REQUEST_LIVE_ROWS_TABLE, 'select=\*', 1, 0\)/);
  assert.match(completionSchemaProbe, /notifySupabaseReadAccessDenied\('Request completion', error\)/);
  assert.doesNotMatch(completionSchemaProbe, /\/rest\/v1\/|getNativeAuthRequestHeaders\(|'Authorization': 'Bearer ' \+ SUPABASE_KEY/);
});

test('native auth refreshes once before protected Request reads or writes fail', () => {
  assert.match(nativeHeaders, /client\?\.auth\?\.refreshSession\?\.\(\)/);
  assert.match(nativeHeaders, /nativeAuthAccessToken = String\(session\.access_token/);
});

test('Request completion retries one current row-version conflict with the canonical version', () => {
  assert.match(saveData, /saveRequestWorkWithReconciliation\(/);
  assert.match(html, /REQUEST_VERSION_CONFLICT/);
  assert.match(saveData, /REQUEST_WORK_CONFLICT_RETRY_LIMIT/);
  assert.doesNotMatch(saveData, /patch: requestPatch,\s*complete: !!isComplete\s*\}\);\s*break;\s*\} catch/);
});

test('ordinary Request autosave is stopped by the persisted per-row conflict breaker', () => {
  assert.match(saveData, /isRequestWorkConflictBlocked\(itemToSave\)/);
  assert.match(html, /autoRetryBlocked: true/);
  assert.match(html, /requestWorkDraft/);
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
