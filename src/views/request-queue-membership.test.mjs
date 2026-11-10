import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { applyRequestWorkValuesToItem } from '../engine/confirmed-evaluation-ui.js';

const source = name => readFileSync(new URL(name, import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const queueSource = source('./request-queue-membership.js');
const engineSource = source('../engine/row-publication-branches.js') + '\n' + source('../engine/confirmed-evaluation-ui.js');

function requestFixture(failAt) {
    const row = {UNIQUE_ID:'REQ-first', REQ_STATUS:'Pending', ROW_VERSION:1};
    const unrelated = {UNIQUE_ID:'REQ-other', REQ_STATUS:'Pending', ROW_VERSION:1};
    const rows = [row, unrelated];
    const events = [], confirmed = new Set(), draftBases = [];
    const pending = new Set();
    const element = item => ({ getAttribute: () => item.UNIQUE_ID, closest: () => null,
        remove() { events.push(`prune:${item.UNIQUE_ID}`); if (failAt === 'prune') throw new Error('prune failed'); } });
    const container = { dataset:{}, querySelectorAll: () => rows.map(element) };
    const context = vm.createContext({
        activeReqTab:'pending', ACTIVE_REQUEST_TABLE:'active_requests', requestsInventory:[...rows], scope:'account-a',
        optimisticCompletedRowIds:pending, masterInventoryById:new Map(), masterInventoryByItemCode:new Map(),
        document:{ getElementById: () => container }, normalizeRequestTabValue: value => value,
        setTimeout, clearTimeout, requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout,
        getItemUniqueId: item => item.UNIQUE_ID, canonicalInventoryRowUid: item => item?.UNIQUE_ID || '',
        getSupabaseReadIdentityScope: () => context.scope,
        isRequestPendingVisible: item => item.REQ_STATUS === 'Pending' && !pending.has(item.UNIQUE_ID),
        trackOptimisticCompletedRows: ids => ids.forEach(id => pending.add(id)),
        clearOptimisticCompletedRows: ids => ids.forEach(id => pending.delete(id)),
        hasConfirmedRequestCompletion: item => confirmed.has(item.UNIQUE_ID),
        cancelChunkRenderWorkForView() {}, setContainerRenderSignature() {}, completedPendingRequestRender:null,
        refreshRealtimeDetailLookupIndexes: () => events.push('index'),
        returnFromConfirmedEvaluationDetail: () => events.push('back'),
        paintFooterRequestBadgeOnly: () => events.push('badge'),
        resolveCanonicalInventoryTarget() { events.push('projection'); if (failAt === 'projection') throw new Error('projection failed'); return null; },
        canonicalInventoryLinkedUid: () => '',
        createRequestWorkDraft: (_item, _fields, base) => { draftBases.push(base); return {}; },
        getRequestWorkValuesFromRow: () => ({ spec:'new remote value' }), backupLocalItem: () => events.push('backup'),
        getDockSuspendDcRequestSourceUid: () => '',
        showToast: label => events.push(label)
    });
    vm.runInContext(queueSource + '\n' + engineSource, context);
    context.refreshLocalRequestViewState = reason => events.push(reason);
    const start = options => context.beginConfirmedRowEvaluationUi({row,source:{...row,SOURCE_TABLE:'active_requests'},prefix:'req-',scope:'account-a',...options});
    return { row, unrelated, events, pending, confirmed, draftBases, context, start };
}

test('the accepted request prunes only its card and returns before resolving the projection', async () => {
    const f = requestFixture();
    const state = f.start();
    assert.deepEqual(f.events, ['prune:REQ-first','back','badge','Saving']);
    assert.deepEqual(Array.from(f.context.requestsInventory), [f.unrelated]);
    assert.equal(f.row.REQ_STATUS, 'Pending');
    assert.equal(state.confirmed, false);
    assert.equal(f.pending.has(f.row.UNIQUE_ID), true);
    const prepare = state.prepareBeforePersist();
    assert.equal(state.prepareBeforePersist(), prepare);
    assert.equal(f.events.includes('projection'), false);
    assert.equal(await prepare, true);
    assert.deepEqual(f.events.slice(4,6), ['index','projection']);
    f.confirmed.add(f.row.UNIQUE_ID);
    state.commit();
    assert.equal(state.confirmed, true);
    assert.equal(f.pending.has(f.row.UNIQUE_ID), false);
    assert.deepEqual(Array.from(f.context.requestsInventory), [f.unrelated]);
});

for (const step of ['prune','projection']) {
    test(`a ${step} setup failure restores pending membership and releases the optimistic marker`, async () => {
        const f = requestFixture(step);
        if (step === 'prune') assert.throws(f.start, /prune failed/);
        else await assert.rejects(f.start().prepareBeforePersist(), /projection failed/);
        assert.equal(f.row.REQ_STATUS, 'Pending');
        assert.equal(f.pending.size, 0);
        assert.ok(f.context.requestsInventory.includes(f.row));
        assert.ok(f.context.requestsInventory.includes(f.unrelated));
        assert.ok(f.events.includes('request-complete-retry'));
    });
}

test('an older rollback cannot resurrect a confirmed request or replace a newer reopened row', () => {
    const f = requestFixture();
    const state = f.start();
    f.confirmed.add(f.row.UNIQUE_ID);
    state.rollback();
    assert.deepEqual(Array.from(f.context.requestsInventory), [f.unrelated]);

    const reopened = requestFixture();
    const reopening = reopened.start();
    const newer = {...reopened.row, ROW_VERSION:3};
    reopened.context.requestsInventory.push(newer);
    reopening.rollback();
    assert.deepEqual(Array.from(reopened.context.requestsInventory), [reopened.unrelated,newer]);
});

test('an account change during the paint yield skips projection and leaves the new queue intact', async () => {
    const f = requestFixture();
    const state = f.start();
    const prepare = state.prepareBeforePersist();
    const newAccountRow = {...f.row, ROW_VERSION:7};
    f.context.scope = 'account-b';
    f.context.requestsInventory = [newAccountRow];
    assert.equal(await prepare, false);
    assert.deepEqual(Array.from(f.context.requestsInventory), [newAccountRow]);
    assert.equal(f.events.includes('request-complete-retry'), false);
    assert.equal(f.events.includes('projection'), false);
    assert.equal(f.pending.has(newAccountRow.UNIQUE_ID), true);
});

test('a hidden tab uses one bounded timer and does not wait for an animation frame', async () => {
    const f = requestFixture();
    const timers = [];
    f.context.document.hidden = true;
    f.context.requestAnimationFrame = () => assert.fail('hidden tabs cannot rely on animation frames');
    f.context.setTimeout = (callback, delay) => { timers.push({callback,delay}); return 1; };
    const prepare = f.start().prepareBeforePersist();
    assert.deepEqual(timers.map(timer => timer.delay), [200]);
    timers[0].callback();
    assert.equal(await prepare, true);
    assert.equal(f.events.filter(event => event === 'projection').length, 1);
});

test('deferred Request backup retains the base captured at confirmation', async () => {
    const f = requestFixture();
    const requestBaseValues = { spec:'original base' };
    assert.equal(await f.start({requestBaseValues}).prepareBeforePersist(), true);
    assert.deepEqual(f.draftBases, [requestBaseValues]);
});

test('Drive and Suspend prepare and back up before leaving detail', () => {
    const drive = requestFixture();
    assert.equal(drive.start({prefix:'lsn-'}).prepareBeforePersist, undefined);
    assert.deepEqual(drive.events, ['projection','backup','back','Saving']);
    const suspend = requestFixture();
    assert.equal(suspend.start({isSuspend:true}).prepareBeforePersist, undefined);
    assert.deepEqual(suspend.events, ['projection','backup','back','row-completion-pending','Saving']);
});

test('replaying a rejected completion draft retains edits and the request lifecycle', () => {
    const pending = {REQ_STATUS:'Pending',req_status:'Pending',REQUEST_ACTIVE:true};
    const draft = {req_status:'Complete',req_spec:'20–22 inches',req_comments:'retained draft'};
    applyRequestWorkValuesToItem(pending, draft);
    assert.equal(pending.REQ_STATUS, 'Pending');
    assert.equal(pending.req_status, 'Pending');
    assert.equal(pending.REQ_SPEC, draft.req_spec);
    assert.equal(pending.REQ_COMMENTS, draft.req_comments);
    assert.equal(draft.req_status, 'Complete');
    const confirmed = {REQ_STATUS:'Complete',req_status:'Complete',REQUEST_HISTORY:true};
    applyRequestWorkValuesToItem(confirmed, {req_status:'Pending'});
    assert.equal(confirmed.REQ_STATUS, 'Complete');
    assert.equal(confirmed.req_status, 'Complete');
});
