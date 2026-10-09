import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extract(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `source block exists: ${startMarker}`);
  return html.slice(start, end);
}

test('Eval submit checks captured identity and work instance before posting and after every await', () => {
  const submit = extract('async function submitEvalWork(', 'async function reassignEvalWork(');
  assert.match(submit, /const submitIdentityIsCurrent = \(\) =>[\s\S]*getArgosReclassLiveEditIdentityKey\(\)/);
  assert.match(submit, /const submitContextIsCurrent = \(\) =>[\s\S]*submitIdentityIsCurrent\(\)[\s\S]*evalWorkSubmitToken === submitToken[\s\S]*activeEvalWorkDetailId === submitDetailId[\s\S]*getEvalWorkById\(submitWorkId\) === work/);
  assert.ok(submit.indexOf('const submitIdentityKey = getArgosReclassLiveEditIdentityKey()') < submit.indexOf('inquiry = collectEvalWorkInquiryPayload(work)'));
  assert.ok(submit.indexOf('if (!submitContextIsCurrent()) return false;') < submit.indexOf("evalWorkApi('submit'"));
  const responseCheck = submit.indexOf('if (!submitIdentityIsCurrent()) return false;', submit.indexOf("evalWorkApi('submit'"));
  assert.ok(responseCheck > submit.indexOf("evalWorkApi('submit'"));
  assert.match(submit, /const liveEditsRefreshed = [^;]+;\s*if \(!submitContextIsCurrent\(\)\) return false;\s*Object\.assign\(work, result\.data \|\| \{\}\);/);
  assert.ok(submit.indexOf('if (!submitContextIsCurrent()) return false;', submit.indexOf('} catch (error)')) > submit.indexOf('} catch (error)'));
  assert.ok(submit.includes('if (button && submitContextIsCurrent()) button.disabled = false'));
  assert.ok(submit.indexOf('if (evalWorkSubmitToken === submitToken)') < submit.indexOf('evalWorkSubmitInFlight = false'));
  assert.ok(submit.indexOf('if (evalWorkSubmitToken === submitToken)') < submit.indexOf('evalWorkAutoSubmitting = false'));
  const open = extract('function openEvalWorkDetail(', 'function closeEvalWorkDetail(');
  const close = extract('function closeEvalWorkDetail(', 'function retryEvalWorkLoad(');
  assert.ok(open.includes('evalWorkSubmitToken = null'));
  assert.ok(close.includes('evalWorkSubmitToken = null'));
});

test('Eval collection errors still show validation feedback for the captured session', async () => {
  const submit = extract('async function submitEvalWork(', 'async function reassignEvalWork(');
  const work = { id: 'work-1', version: 1 };
  const toasts = [];
  const context = {
    activeEvalWorkDetailId: 'work-1',
    evalWorkSubmitInFlight: false,
    evalWorkAutoSubmitting: false,
    evalWorkSubmitToken: null,
    currentIdentity: 'session-1',
    getEvalWorkById: id => id === work.id ? work : null,
    getArgosReclassLiveEditIdentityKey: () => context.currentIdentity,
    collectEvalWorkInquiryPayload: () => { throw new Error('Finish the row review first.'); },
    showToast: (...args) => toasts.push(args),
  };
  vm.createContext(context);
  vm.runInContext(`${submit}; this.submit = submitEvalWork;`, context);

  await context.submit();

  assert.equal(toasts.length, 1);
  assert.equal(toasts[0][0], 'Send Failed');
  assert.match(toasts[0][1], /Finish the row review first/);
  assert.equal(context.evalWorkSubmitInFlight, false);
});

function createPendingSubmitHarness() {
  const work = { id: 'work-1', version: 1, itemcode: 'A1' };
  const requests = [];
  const toasts = [];
  const context = {
    activeEvalWorkDetailId: 'work-1',
    evalWorkSubmitInFlight: false,
    evalWorkAutoSubmitting: false,
    evalWorkSubmitToken: null,
    identity: 'session-1',
    getEvalWorkById: id => id === work.id ? work : null,
    getArgosReclassLiveEditIdentityKey: () => context.identity,
    collectEvalWorkInquiryPayload: () => ({ workflowPolicyVersion: 'v5' }),
    collectEvalWorkEvidence: () => ({ picturesSpecsResolution: 'done' }),
    collectEvalWorkEvidenceByOrigin: () => null,
    validateEvalWorkInquiryRowResolutions: () => ({ total: 0, done: 0, noAction: 0 }),
    getEvalWorkOriginEntries: () => [],
    validateEvalWorkPicturesSpecsEvidence: () => true,
    getEvalWorkCompletionRecipientCopy: () => 'reviewers',
    firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim() !== '') || '',
    persistEvalWorkLocalDraft: () => {},
    evalWorkApi: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    showToast: (...args) => toasts.push(args),
    clearEvalWorkLocalDraft: () => {},
    loadEvalWorkAssignments: async () => {},
    window: {},
  };
  vm.createContext(context);
  vm.runInContext(`${extract('async function submitEvalWork(', 'async function reassignEvalWork(')}; this.submit = submitEvalWork;`, context);
  return { context, requests, toasts, work };
}

test('an Eval success for an old account after API start cannot mutate current detail UI', async () => {
  const { context, requests, toasts, work } = createPendingSubmitHarness();
  const pending = context.submit(null, { automatic: true });
  assert.equal(requests.length, 1);

  context.identity = 'session-2';
  context.evalWorkSubmitToken = null;
  context.evalWorkSubmitInFlight = false;
  context.activeEvalWorkDetailId = '';
  requests[0].resolve({ data: { status: 'submitted', foreign: true } });
  await pending;

  assert.equal(work.status, undefined);
  assert.equal(work.foreign, undefined);
  assert.deepEqual(toasts, []);
  assert.equal(context.activeEvalWorkDetailId, '');
  assert.equal(context.evalWorkSubmitInFlight, false);
});

test('an old same-work Eval success cannot close a reopened detail or clear its newer submit guard', async () => {
  const { context, requests, toasts, work } = createPendingSubmitHarness();
  const oldPending = context.submit(null, { automatic: true });
  assert.equal(requests.length, 1);

  context.evalWorkSubmitToken = null;
  context.evalWorkSubmitInFlight = false;
  const newPending = context.submit(null, { automatic: true });
  assert.equal(requests.length, 2);
  const newToken = context.evalWorkSubmitToken;

  requests[0].resolve({ data: { status: 'old-submit', stale: true } });
  await oldPending;
  assert.equal(context.evalWorkSubmitToken, newToken);
  assert.equal(context.evalWorkSubmitInFlight, true);
  assert.equal(context.activeEvalWorkDetailId, 'work-1');
  assert.equal(work.stale, undefined);
  assert.deepEqual(toasts, []);

  requests[1].reject(new Error('new submit failed'));
  await newPending;
  assert.equal(context.evalWorkSubmitToken, null);
  assert.equal(context.evalWorkSubmitInFlight, false);
  assert.equal(toasts.length, 1);
  assert.match(toasts[0][1], /new submit failed/);
});

test('a stale Eval API failure neither toasts nor resets a newer same-work submission', async () => {
  const { context, requests, toasts } = createPendingSubmitHarness();
  const oldPending = context.submit(null, { automatic: true });
  context.evalWorkSubmitToken = null;
  context.evalWorkSubmitInFlight = false;
  const newPending = context.submit(null, { automatic: true });
  const newToken = context.evalWorkSubmitToken;

  requests[0].reject(new Error('old request failed'));
  await oldPending;
  assert.deepEqual(toasts, []);
  assert.equal(context.evalWorkSubmitToken, newToken);
  assert.equal(context.evalWorkSubmitInFlight, true);

  requests[1].reject(new Error('new request failed'));
  await newPending;
  assert.equal(toasts.length, 1);
  assert.match(toasts[0][1], /new request failed/);
  assert.equal(context.evalWorkSubmitInFlight, false);
});

test('an older same-work Eval submit cannot clear the token or in-flight guard of a reopened detail', async () => {
  const submit = extract('async function submitEvalWork(', 'async function reassignEvalWork(');
  const work = { id: 'work-1', version: 1, itemcode: 'A1' };
  const confirmations = [];
  const toasts = [];
  const context = {
    activeEvalWorkDetailId: 'work-1',
    evalWorkSubmitInFlight: false,
    evalWorkAutoSubmitting: false,
    evalWorkSubmitToken: null,
    getEvalWorkById: id => id === work.id ? work : null,
    getArgosReclassLiveEditIdentityKey: () => 'session-1',
    collectEvalWorkInquiryPayload: () => ({ workflowPolicyVersion: 'v5' }),
    collectEvalWorkEvidence: () => ({ picturesSpecsResolution: 'done' }),
    collectEvalWorkEvidenceByOrigin: () => null,
    validateEvalWorkInquiryRowResolutions: () => ({ total: 0, done: 0, noAction: 0 }),
    getEvalWorkOriginEntries: () => [],
    validateEvalWorkPicturesSpecsEvidence: () => true,
    getEvalWorkCompletionRecipientCopy: () => 'reviewers',
    firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim() !== '') || '',
    showAppConfirm: () => new Promise(resolve => confirmations.push(resolve)),
    showToast: (...args) => toasts.push(args),
  };
  vm.createContext(context);
  vm.runInContext(`${submit}; this.submit = submitEvalWork;`, context);

  const oldSubmit = context.submit();
  assert.equal(confirmations.length, 1, JSON.stringify(toasts));
  context.evalWorkSubmitToken = null;
  context.evalWorkSubmitInFlight = false;
  const reopenedSubmit = context.submit();
  assert.equal(confirmations.length, 2);
  const reopenedToken = context.evalWorkSubmitToken;

  confirmations[0](true);
  await oldSubmit;
  assert.equal(context.evalWorkSubmitToken, reopenedToken);
  assert.equal(context.evalWorkSubmitInFlight, true);
  assert.deepEqual(toasts, []);

  confirmations[1](false);
  await reopenedSubmit;
  assert.equal(context.evalWorkSubmitToken, null);
  assert.equal(context.evalWorkSubmitInFlight, false);
});

test('Manager season-priority submit applies same-session receipts but fences UI callbacks by captured state', () => {
  const submit = extract('async function submitManagerSeasonPriority(', 'function renderManagerSeasonPriorityPanel(');
  assert.match(submit, /const submitIdentityIsCurrent = \(\) => submitIdentityKey === getArgosReclassLiveEditIdentityKey\(\)/);
  const resultCheck = submit.indexOf('if (!submitIdentityIsCurrent()) return false;', submit.indexOf("await driveReclassApi('season_priority_submit'"));
  const receiptApply = submit.indexOf('applyConfirmedArgosReclassLiveEdits(result, submitIdentityKey)', resultCheck);
  const uiCheck = submit.indexOf('if (!submitContextIsCurrent()) return false;', receiptApply);
  assert.ok(resultCheck >= 0 && receiptApply > resultCheck && uiCheck > receiptApply);
  assert.ok(submit.includes('if (submitContextIsCurrent()) {'));
  assert.ok(submit.includes('if (submitContextIsCurrent() && isManagerSeasonPriorityVisible(state)) scheduleManagersRender(true)'));
});
