import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: requests
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(path.join(process.cwd(), 'assets/request-submission.js'), 'utf8');
const html = readComposedAppSource();
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox);
const { planRequestWorkConflictRebase, resolveRequestWorkDraftConflicts } = sandbox.window.AgMetricRequestSubmission;
const { mergeRequestWorkAcknowledgment } = sandbox.window.AgMetricRequestSubmission;

const draft = (values = { req_spec: 'local spec' }, complete = false) => ({
    requestId: 'request-1', baseVersion: 4, baseValues: { req_spec: 'base spec', req_comments: 'base comments' },
    dirtyValues: values, complete
});
const canonical = (rowVersion = 5, values = { req_spec: 'base spec', req_comments: 'remote comments' }) => ({ rowVersion, values });

test('disjoint remote edits rebase a narrow request patch to canonical version', () => {
    const plan = planRequestWorkConflictRebase(draft(), canonical());
    assert.equal(plan.status, 'rebase');
    assert.equal(plan.expectedVersion, 5);
    assert.deepEqual({ ...plan.patch }, { req_spec: 'local spec' });
});

test('intentional Done status rebases without a Keep my value conflict', () => {
    const completion = { ...draft({ req_status: 'Complete' }, true), baseValues: { req_status: 'Pending', req_spec: 'old spec' } };
    const plan = planRequestWorkConflictRebase(completion, canonical(7, { req_status: 'In Progress', req_spec: 'new spec' }));
    assert.equal(plan.status, 'rebase');
    assert.equal(plan.expectedVersion, 7);
    assert.deepEqual({ ...plan.patch }, { req_status: 'Complete' });
});

test('an explicit completion command owns only its locally edited fields on rebase', () => {
    const completion = { ...draft({ req_spec: 'my edited spec', req_status: 'Complete' }, true), intentPolicy: 'local-command',
        baseValues: { req_status: 'Pending', req_spec: 'base spec', req_comments: 'base comments' } };
    const plan = planRequestWorkConflictRebase(completion, canonical(8, { req_status: 'In Progress', req_spec: 'remote spec', req_comments: 'new remote comment' }));
    assert.equal(plan.status, 'rebase');
    assert.deepEqual({ ...plan.patch }, { req_spec: 'my edited spec', req_status: 'Complete' });
    assert.equal(Object.hasOwn(plan.patch, 'req_comments'), false);
});

test('manual Done can supersede an earlier edit conflict and background retries retain its command type', () => {
    const start = html.indexOf('        async function saveData(');
    const end = html.indexOf('        function normalizeRequestWorkDraftValue(', start);
    const save = html.slice(start, end);
    const guards = save.match(/if \([^\n]*isRequestWorkConflictBlocked\(itemToSave\)[^\n]*/g) || [];
    assert.equal(guards.length, 2);
    for (const guard of guards) assert.match(guard, /!isComplete/);
    const flush = html.slice(html.indexOf('        async function flushPendingRequestWorkEdits('));
    assert.match(flush, /entry\.conflictType = blocked\.complete && blocked\.intentPolicy === 'local-command' \? 'request-completion' : 'request-work'/);
    assert.match(flush, /if \(complete && isRequestComplete\(formatted\)\) confirmQueueCompletion\(formatted\)/);
});

test('overlapping edits require explicit per-field choices and retain completion intent', () => {
    const conflicted = draft({ req_spec: 'local spec', req_comments: 'local comments' }, true);
    const result = planRequestWorkConflictRebase(conflicted, canonical(6, { req_spec: 'remote spec', req_comments: 'base comments' }));
    assert.equal(result.status, 'review-required');
    assert.deepEqual(Array.from(result.conflictFields, item => item.field), ['req_spec']);
    assert.equal(resolveRequestWorkDraftConflicts(conflicted, canonical(6, { req_spec: 'remote spec', req_comments: 'base comments' }), {}).status, 'review-required');
    const resolved = resolveRequestWorkDraftConflicts(conflicted, canonical(6, { req_spec: 'remote spec', req_comments: 'base comments' }), { req_spec: 'local' });
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.draft.complete, true);
    assert.deepEqual({ ...resolved.draft.dirtyValues }, { req_spec: 'local spec', req_comments: 'local comments' });
});

test('choosing latest remote value clears only that conflicting field', () => {
    const result = resolveRequestWorkDraftConflicts(
        draft({ req_spec: 'local spec' }), canonical(7, { req_spec: 'remote spec', req_comments: 'base comments' }), { req_spec: 'remote' }
    );
    assert.equal(result.status, 'resolved');
    assert.deepEqual({ ...result.draft.dirtyValues }, {});
});

test('same value already written remotely is acknowledged and removed from the retry patch', () => {
    const plan = planRequestWorkConflictRebase(draft(), canonical(6, { req_spec: 'local spec', req_comments: 'remote comments' }));
    assert.equal(plan.status, 'rebase');
    assert.deepEqual({ ...plan.patch }, {});
});

test('second version conflict remains blocked instead of starting another retry', () => {
    const firstRebase = planRequestWorkConflictRebase(draft(), canonical(5));
    assert.equal(firstRebase.status, 'rebase');
    const secondConflict = planRequestWorkConflictRebase({ ...draft(), baseVersion: firstRebase.expectedVersion, baseValues: canonical(5).values }, canonical(6, { req_spec: 'new remote spec', req_comments: 'base comments' }));
    assert.equal(secondConflict.status, 'review-required');
});

test('mocked save performs one safe rebase retry and then stops on a second conflict', async () => {
    const sends = [];
    let reads = 0;
    const outcome = await sandbox.window.AgMetricRequestSubmission.saveRequestWorkWithReconciliation({
        draft: draft(), expectedVersion: 4, initialPatch: { req_spec: 'local spec', req_comments: 'base comments' },
        send: async input => { sends.push(input); if (sends.length < 3) throw Object.assign(new Error('REQUEST_VERSION_CONFLICT'), { code: '40001' }); return { ok: true }; },
        readCanonical: async () => { reads += 1; return canonical(reads + 4, reads === 1 ? { req_spec: 'base spec', req_comments: 'remote comments' } : { req_spec: 'another remote spec', req_comments: 'remote comments' }); }
    });
    assert.equal(outcome.status, 'review-required');
    assert.equal(sends.length, 2);
    assert.equal(reads, 2);
    assert.equal(sends[1].expectedVersion, 5);
    assert.deepEqual({ ...sends[1].patch }, { req_spec: 'local spec' });
});

test('mocked save treats an already-applied value as acknowledged without replaying it', async () => {
    let sends = 0;
    const outcome = await sandbox.window.AgMetricRequestSubmission.saveRequestWorkWithReconciliation({
        draft: draft(), expectedVersion: 4, initialPatch: { req_spec: 'local spec' },
        send: async () => { sends += 1; throw Object.assign(new Error('REQUEST_VERSION_CONFLICT'), { code: '40001' }); },
        readCanonical: async () => canonical(5, { req_spec: 'local spec', req_comments: 'base comments' })
    });
    assert.equal(outcome.status, 'saved');
    assert.equal(outcome.alreadyApplied, true);
    assert.equal(sends, 1);
});

test('successful acknowledgment clears sent values but retains edits typed while the save was in flight', () => {
    const original = draft({ req_spec: 'sent spec' });
    const merged = mergeRequestWorkAcknowledgment({
        draft: original, currentDraft: original,
        sentValues: { req_spec: 'sent spec' }, dispatchValues: { req_spec: 'sent spec', req_comments: 'base comments' },
        currentValues: { req_spec: 'newer spec', req_comments: 'new comments' },
        canonical: canonical(5, { req_spec: 'sent spec', req_comments: 'base comments' })
    });
    assert.equal(merged.status, 'pending');
    assert.deepEqual({ ...merged.dirtyValues }, { req_spec: 'newer spec', req_comments: 'new comments' });
    assert.equal(merged.draft.baseVersion, 5);
});

test('acknowledgment does not turn stale untouched form fields into a pending draft', () => {
    const original = draft({ req_spec: 'sent spec' });
    const merged = mergeRequestWorkAcknowledgment({
        draft: original, currentDraft: original,
        sentValues: { req_spec: 'sent spec' }, dispatchValues: { req_spec: 'sent spec', req_comments: 'old comments' },
        currentValues: { req_spec: 'sent spec', req_comments: 'old comments' },
        canonical: canonical(5, { req_spec: 'sent spec', req_comments: 'new remote comments' })
    });
    assert.equal(merged.status, 'acknowledged');
    assert.deepEqual({ ...merged.dirtyValues }, {});
});

test('acknowledgment does not resurrect a remote photo change from unrelated cached row data', () => {
    const original = draft({ req_spec: 'sent spec' });
    const merged = mergeRequestWorkAcknowledgment({
        draft: original, currentDraft: original,
        sentValues: { req_spec: 'sent spec' },
        dispatchValues: { req_spec: 'sent spec', req_photo_link: 'old link', req_photo_name: 'old name' },
        currentValues: { req_spec: 'sent spec', req_photo_link: 'old link', req_photo_name: 'old name' },
        canonical: canonical(5, { req_spec: 'sent spec', req_photo_link: 'remote link', req_photo_name: 'remote name' })
    });
    assert.equal(merged.status, 'acknowledged');
    assert.deepEqual({ ...merged.dirtyValues }, {});
});

test('acknowledgment preserves a photo uploaded while the request save was in flight', () => {
    const original = draft({ req_spec: 'sent spec' });
    const merged = mergeRequestWorkAcknowledgment({
        draft: original, currentDraft: original, sentValues: { req_spec: 'sent spec' },
        dispatchValues: { req_spec: 'sent spec', req_photo_link: 'old link', req_photo_name: 'old name' },
        currentValues: { req_spec: 'sent spec', req_photo_link: 'new upload', req_photo_name: 'new name' },
        canonical: canonical(5, { req_spec: 'sent spec', req_photo_link: 'old link', req_photo_name: 'old name' })
    });
    assert.equal(merged.status, 'pending');
    assert.deepEqual({ ...merged.dirtyValues }, { req_photo_link: 'new upload', req_photo_name: 'new name' });
});

test('completed-row response keeps unapplied sent fields in visible review state', () => {
    const merged = mergeRequestWorkAcknowledgment({
        draft: draft({ req_spec: 'submitted spec' }),
        sentValues: { req_spec: 'submitted spec' }, dispatchValues: { req_spec: 'submitted spec' },
        currentValues: { req_spec: 'submitted spec' },
        canonical: canonical(8, { req_spec: 'server spec', req_status: 'Complete' })
    });
    assert.equal(merged.status, 'review-required');
    assert.equal(merged.reason, 'request-already-completed');
    assert.deepEqual({ ...merged.dirtyValues }, { req_spec: 'submitted spec' });
});

test('offline and completion drafts share the same bounded rebase contract', () => {
    const offlineDraft = draft({ req_spec: 'offline spec' }, true);
    const plan = planRequestWorkConflictRebase(offlineDraft, canonical(9));
    assert.equal(plan.status, 'rebase');
    assert.equal(plan.expectedVersion, 9);
    assert.equal(offlineDraft.complete, true);
});

test('legacy pending requests without a base version require visible review', () => {
    const legacy = { requestId: 'request-1', dirtyValues: { req_spec: 'old edit' }, complete: false };
    const plan = planRequestWorkConflictRebase(legacy, canonical());
    assert.equal(plan.status, 'review-required');
    assert.equal(plan.reason, 'legacy-or-invalid-draft');
});

test('save path persists a per-row breaker and stops autosaves after a conflict', () => {
    assert.match(html, /isRequestWorkConflictBlocked\(itemToSave\)/);
    assert.match(html, /autoRetryBlocked = true/);
    assert.match(html, /requestWorkDraft/);
    assert.match(html, /requestSavePermissionVersion !== String\(appAccessSnapshotState\.snapshot\?\.dataPermissionVersion/);
    assert.match(html, /if \(!entry\.requestWorkDraft\)[\s\S]*legacy: true[\s\S]*autoRetryBlocked = true/);
    assert.match(html, /const requestWorkValuesAtResponse = getRequestWorkFormValues\(itemToSave\)[\s\S]*Object\.assign\(itemToSave, formattedServerRow/);
    assert.match(html, /readCanonical: async \(\) => \{ assertRequestSaveScope\(\); const canonical = await fetchCanonicalRequestWorkRow[\s\S]*assertRequestSaveScope\(\); return canonical; \}/);
    assert.match(html, /\}\);\s*assertRequestSaveScope\(\);\s*if \(requestSaveOutcome\.status === 'review-required'\)/);
    assert.match(html, /readCanonical: async \(\) => \{ assertPendingRequestScope\(\); const canonical = await fetchCanonicalRequestWorkRow[\s\S]*assertPendingRequestScope\(\); return canonical; \}/);
    assert.match(html, /\}\);\s*if \(!requestScopeIsCurrent\(\)\) continue;/);
});
