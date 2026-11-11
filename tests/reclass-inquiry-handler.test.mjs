import assert from 'node:assert/strict';
import test from 'node:test';
import { executeReclassInquiryAction } from '../supabase/functions/app-api/reclass-inquiry-handler.ts';

const version = 'reclass-action-workflow-v7-editable-fields-20261009';
const makePayload = () => ({ workflowPolicyVersion: version, idempotencyToken: 'inquiry-test-command-0001',
    actorUsername: 'client_forgery', actorRole: 'super-admin', sourceContext: { sourceMode: 'drive' },
    source: { unique_id: 'y-source', itemcode: 'ITEM', locationcode: 'A.01', lotcode: '27.Y' },
    transaction: { requestActions: ['inventory_fields'], holdStopProposals: [] },
    rowOverlays: [{ unique_id: 'y-source', proposals: [],
        fieldEdits: [{ field: 'locationnote', expected: null, value: 'reviewed note' }] }] });

function receiptQuery(receiptActor) {
    const payload = { reclassPayload: { actor: { username: receiptActor },
        protectedDelivery: { inventoryRevision: '42', liveEdits: [{ unique_id: 'y-source' }] } } };
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { payload }, error: null }) };
    return query;
}

function fixture({ allowed = true, actor = {}, enqueueErrors = [], receiptActor = 'actual_actor' } = {}) {
    const calls = [], deliveries = [];
    const session = { authUserId: 'profile-id', username: 'actual_actor', role: 'REP', mustChangePassword: false };
    const profile = { id: 'profile-id', username: 'actual_actor', role: 'REP', must_change_password: false, ...actor };
    const reply = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
    const dependencies = {
        db: {
            rpc: async (name, args) => {
                calls.push({ name, args: structuredClone(args) });
                if (name === 'authorize_reclass_command_v3076') return { data: allowed, error: null };
                const message = name.startsWith('enqueue_') ? enqueueErrors.shift() : null;
                return { data: message ? null : { ok: true, jobId: 'delivery-1', status: 'queued' }, error: message ? { message } : null };
            },
            from: () => receiptQuery(receiptActor),
        },
        resolveActiveSessionProfile: async () => profile,
        normalizeUsername: value => String(value || '').trim().toLowerCase(),
        sanitizePayload: payload => structuredClone(payload),
        jsonResponse: reply,
        errorResponse: (message, status, extra) => new Response(JSON.stringify({ message, ...extra }), { status }),
        inquiryError: code => new Response(JSON.stringify({ code }), { status: /FORBIDDEN|ACTOR_REQUIRED/.test(code) ? 403 : 400 }),
        seasonPriorityError: code => reply({ code }),
        dispatchDelivery: (result, username, token) => { deliveries.push({ result, username, token }); return result; },
    };
    return { calls, deliveries, session, profile, dependencies };
}

test('inquiry create authorizes actual actor and all submitted edits before enqueue without profile-role or named grants', async () => {
    for (const role of ['REP', 'eval', 'Admin', 'super-admin']) {
        const f = fixture({ actor: { role } });
        const payload = makePayload();
        const response = await executeReclassInquiryAction(f.session, payload, f.dependencies);
        assert.equal(response.status, 200);
        assert.deepEqual(f.calls.map(call => call.name), ['authorize_reclass_command_v3076', 'enqueue_drive_reclass_inquiry_v7']);
        const command = f.calls[0].args;
        assert.equal(command.p_actor_id, 'profile-id');
        assert.equal(command.p_command.actorUsername, 'actual_actor');
        assert.equal(command.p_command.action, 'drive_reclass_inquiry');
        assert.deepEqual(command.p_command.rowOverlays, payload.rowOverlays);
        assert.equal(f.calls[1].args.p_payload.actorUsername, 'actual_actor');
        assert.equal(f.deliveries[0].username, 'actual_actor');
        assert.equal(f.deliveries[0].token, payload.idempotencyToken);
    }
});

test('false database verdicts deny module, non-admin, mixed-row and unassigned requests before any durable write', async () => {
    for (const role of ['REP', 'eval', 'Admin', 'super-admin']) {
        const f = fixture({ allowed: false, actor: { role } });
        const payload = makePayload();
        payload.rowOverlays.push({ unique_id: 'f1-source', proposals: [], fieldEdits: [{ field: 'locationnote', expected: '', value: 'changed' }] });
        const response = await executeReclassInquiryAction(f.session, payload, f.dependencies);
        assert.equal(response.status, 403);
        assert.deepEqual(f.calls.map(call => call.name), ['authorize_reclass_command_v3076']);
        assert.equal(f.deliveries.length, 0);
    }
});

test('missing, changed and inactive session identity cannot be replaced by client actor fields', async () => {
    for (const changed of [null, { authUserId: 'foreign' }, { username: 'foreign' }, { mustChangePassword: true }]) {
        const f = fixture();
        const session = changed ? { ...f.session, ...changed } : null;
        const response = await executeReclassInquiryAction(session, makePayload(), f.dependencies);
        assert.ok(response.status === 401 || response.status === 403);
        assert.equal(f.calls.length, 0);
    }
    const f = fixture();
    f.dependencies.resolveActiveSessionProfile = async () => null;
    assert.equal((await executeReclassInquiryAction(f.session, makePayload(), f.dependencies)).status, 403);
    assert.equal(f.calls.length, 0);
});

test('reserved markers, source context and real field validators run before inquiry authorization', async () => {
    const mutations = [payload => { payload.transaction.seasonPriority = true; },
        payload => { payload.sourceContext = []; },
        payload => { payload.rowOverlays[0].fieldEdits[0].field = 'ptronhand'; }];
    for (const mutate of mutations) {
        const f = fixture(), payload = makePayload();
        mutate(payload);
        const response = await executeReclassInquiryAction(f.session, payload, f.dependencies);
        assert.equal(response.status, 400);
        assert.equal(f.calls.length, 0);
    }
});

test('transient enqueue race retries the exact authorized actor and idempotent payload only once', async () => {
    const f = fixture({ enqueueErrors: ['DRIVE_RECLASS_V7_STALE_SNAPSHOT'] });
    const response = await executeReclassInquiryAction(f.session, makePayload(), f.dependencies);
    assert.equal(response.status, 200);
    assert.equal(f.calls.length, 3);
    assert.deepEqual(f.calls[1], f.calls[2]);
    assert.equal(f.deliveries.length, 1);
});

test('status/retry retain actor-scoped durable receipt recovery independently of delivery state', async () => {
    for (const operation of ['status', 'retry']) {
        const f = fixture();
        const response = await executeReclassInquiryAction(f.session, { operation, idempotencyToken: 'saved-token', actorUsername: 'foreign' }, f.dependencies);
        const result = await response.json();
        assert.equal(result.inventoryRevision, '42');
        assert.equal(result.liveEdits[0].unique_id, 'y-source');
        assert.equal(f.calls[0].args.p_actor_username, 'actual_actor');
        assert.equal(f.calls[0].args.p_idempotency_token, 'saved-token');
        assert.equal(f.deliveries.length, operation === 'retry' ? 1 : 0);
    }
    const f = fixture({ receiptActor: 'foreign' });
    const result = await (await executeReclassInquiryAction(f.session, { operation: 'status' }, f.dependencies)).json();
    assert.equal(result.inventoryRevision, undefined);
});

test('existing protected Season Priority operations retain their server actor and RPC contracts', async () => {
    for (const operation of ['season_priority_list', 'season_priority_submit', 'season_priority_state']) {
        const f = fixture();
        const response = await executeReclassInquiryAction(f.session, { operation, expectedPriority: 3, itemcodes: ['ITEM'] }, f.dependencies);
        assert.equal(response.status, 200);
        assert.equal(f.calls.length, 1);
        assert.equal(f.calls[0].args.p_actor_id, 'profile-id');
        assert.equal(f.deliveries.length, 0);
    }
});
