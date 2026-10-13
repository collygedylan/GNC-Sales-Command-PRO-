// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/request-submission.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox);
const api = sandbox.window.AgMetricRequestSubmission;

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

async function until(predicate) {
    for (let index = 0; index < 20 && !predicate(); index++) await Promise.resolve();
    assert.equal(predicate(), true, 'expected asynchronous operation to reach requested state');
}

function fixture(overrides = {}) {
    const entries = new Map();
    const sent = [];
    const acknowledged = [];
    const failed = [];
    const restored = [];
    const state = { owner: 'https://db.example|user-a|alice', online: true };
    const options = {
        currentOwner: () => state.owner,
        isOnline: () => state.online,
        saveEntry: async (entry) => { entries.set(entry.clientBatchId, structuredClone(entry)); },
        deleteEntry: async (key) => { entries.delete(typeof key === 'string' ? key : key.clientBatchId); },
        readEntries: async () => [...entries.values()].map((entry) => structuredClone(entry)),
        onAcknowledged: async (entry, result) => { acknowledged.push({ entry, result }); },
        onFailure: async (entry, error) => { failed.push({ entry, error }); },
        onRestore: async (entry) => { restored.push(entry); },
        ...overrides,
        send: async (entry) => {
            sent.push(structuredClone(entry));
            return overrides.send ? overrides.send(entry) : ack(entry);
        }
    };
    return { controller: api.createController(options), entries, sent, acknowledged, failed, restored, state, options };
}

function entry(overrides = {}) {
    return {
        clientBatchId: 'batch-1',
        ownerKey: 'https://db.example|user-a|alice',
        requests: [{ unique_id: 'REQ-1' }, { unique_id: 'REQ-2' }],
        selectionSnapshot: ['dom-1', 'dom-2'],
        formSnapshot: { customer: 'Greenhouse', qtyByUid: { 'MASTER-1': '', 'MASTER-2': '0' } },
        status: 'pending',
        ...overrides
    };
}

function ack(value) {
    return {
        client_batch_id: value.clientBatchId,
        delivery_state: 'pending',
        rows: value.requests.map((request) => ({ unique_id: request.unique_id }))
    };
}

function finalizerFixture({ count = 2, preflight = async () => true } = {}) {
    const calls = [];
    const rows = Array.from({ length: count }, (_, index) => ({
        DOM_ID: `dom-${index}`, UNIQUE_ID: `MASTER-${index}`, COMMONNAME: `Tree ${index}`, CONTSIZE: '1 gal',
        LOCATIONCODE: 'A1', ITEMCODE: `ITEM-${index}`, PTRAVAILABLE: 5, PRIORITY: 1
    }));
    const context = {
        getRequestSubmissionOwnerKey: () => 'owner-a', requestSubmissionGeneration: 1,
        requestSubmissionEntries: new Map(),
        getActiveRequestSubmissionEntry: () => null,
        captureRequestSubmissionForm: () => ({ customer: 'saved-customer', domIds: [] }),
        tempSelectedReqRep: 'rep-a', getDefaultRequestRepName: () => '', tempReqAppendToExistingFolder: false,
        tempReqCust: 'Grower A', isQuickDriveRequestMode: () => false,
        resolveRequestRepSelectionForCurrentUser: value => value,
        syncRequestEmailChainSelectionFromInputs() {}, buildRequestCreatorAuditInfo: () => ({}),
        canUseRequestEmailChainPicker: () => false, getRequestEmailChainSelectedRecipients: () => [],
        getRequestSourceDomIds: () => rows.map(row => row.DOM_ID), findItemByDomId: domId => rows.find(row => row.DOM_ID === domId),
        getCurrentVisibleViewId: () => 'drive', activeDetailSourceView: '', lastView: '',
        getRequestCapabilities: () => ({ canCreateGeneral: true, canCreateAv: true }),
        requestCapabilityState: { stale: false }, getRequestReusableData: () => ({ hasReusableEvidence: false }),
        normalizeRequestReuseChoice: value => value, normalizeRequestDesiredMeasurementValue: value => value || '',
        navigator: { onLine: true }, ensureRequestSchemaCompatible: preflight,
        window: { AgMetricRequestSubmission: api, __gncOpsPilot: null },
        createRequestFolderId: () => 'folder-a', resolveRequestCustomerContext: () => ({ req_consignee: 'Con A' }),
        isCurrentRequestCustomerContext: () => true, createStableClientBatchId: () => 'batch-built',
        getRequestSelectionIntentToken: domId => `token-${domId}`,
        selectedItemSources: new Map(rows.map(row => [row.DOM_ID, 'drive'])),
        applyRequestCreatorAuditFields() {}, getRequestResolvedPickNoteValue: () => '',
        getCurrentRequestCompletionUserEntry: () => null,
        showToast: (...args) => calls.push(['toast', ...args]),
        performRequestSubmission: async entryValue => { calls.push(['submit', entryValue]); return true; },
        console, Date, Math, JSON, String, Array, Object, Set, Map,
        requestQtyEmailStepActive: false, requestQtyStepIndex: 0, requestQtyStepDomIds: [],
        renderRequestQtyStepCurrentItem() {},
        firstNonEmptyValue: (...values) => values.find(value => value !== undefined && value !== null && value !== '')
    };
    vm.runInNewContext(extractFunction('finalizeRequestAction', 'function processTabSelection('), context);
    return { context, rows, calls };
}

function outboxTransactionFixture(initialRecords = [], { failCommit = false } = {}) {
    const records = new Map(initialRecords.map(record => [record.clientBatchId, structuredClone(record)]));
    const operations = [];
    const history = [];
    let abortReason = null;
    const db = {
        transaction(storeName, mode) {
            assert.equal(storeName, 'request_outbox');
            assert.equal(mode, 'readwrite');
            const tx = {
                aborted: false,
                abort() { this.aborted = true; abortReason = new Error('Transaction aborted.'); setTimeout(() => this.onabort?.(), 0); },
                objectStore() {
                    return {
                        get(key) {
                            const request = {};
                            queueMicrotask(() => { request.result = structuredClone(records.get(key)); request.onsuccess?.(); });
                            return request;
                        },
                        put(record) { const item = ['put', structuredClone(record)]; operations.push(item); history.push(item); },
                        delete(key) { const item = ['delete', key]; operations.push(item); history.push(item); }
                    };
                }
            };
            setTimeout(() => {
                if (tx.aborted) return;
                if (failCommit) { tx.onerror?.({ target: { error: new Error('disk write failed') } }); return; }
                for (const [operation, value] of operations.splice(0)) {
                    if (operation === 'put') records.set(value.clientBatchId, value);
                    else records.delete(value);
                }
                tx.oncomplete?.();
            }, 0);
            return tx;
        }
    };
    const context = { openDB: async () => db, putIndexedDbRecord: async (_store, record) => { records.set(record.clientBatchId, record); return record; },
        REQUEST_OUTBOX_STORE: 'request_outbox', Date, String, Number, Math, Object, Promise, Error };
    vm.runInNewContext(extractFunction('saveRequestOutboxEntry', 'async function deleteAcknowledgedRequestBlobs('), context);
    return { context, records, operations, history, get abortReason() { return abortReason; } };
}

function extractFunction(name, nextDeclaration) {
    const match = new RegExp(`(?:async\\s+)?function ${name}\\(`).exec(appSource);
    const start = match?.index ?? -1;
    const end = appSource.indexOf(nextDeclaration, start);
    assert.ok(start >= 0 && end > start, `expected ${name} declaration in index.html`);
    return appSource.slice(start, end).trim();
}

test('optional quantities normalize blanks to null while preserving explicit zero and mixed values', () => {
    for (const value of [null, undefined, '', ' ', '\t\n']) assert.equal(api.normalizeOptionalQuantity(value), null);
    assert.equal(api.normalizeOptionalQuantity(0), '0');
    assert.equal(api.normalizeOptionalQuantity('0'), '0');
    assert.deepEqual(
        [' ', '0', '12'].map((value) => api.normalizeOptionalQuantity(value)),
        [null, '0', '12']
    );
});

test('acknowledgment requires matching batch, acceptable delivery state, and exact unique row IDs', () => {
    const request = entry();
    assert.doesNotThrow(() => api.validateAcknowledgment(request, ack(request)));
    for (const invalid of [
        { ...ack(request), client_batch_id: 'other-batch' },
        { ...ack(request), delivery_state: 'failed' },
        { ...ack(request), rows: [{ unique_id: 'REQ-1' }] },
        { ...ack(request), rows: [{ unique_id: 'REQ-1' }, { unique_id: 'REQ-1' }] },
        { ...ack(request), rows: [{ unique_id: 'REQ-1' }, { unique_id: 'REQ-2' }, { unique_id: 'REQ-3' }] }
    ]) assert.throws(() => api.validateAcknowledgment(request, invalid), { code: 'REQUEST_BATCH_ACK_INVALID' });
});

test('outbox storage failure prevents transport and reports storage-failed', async () => {
    const f = fixture({ saveEntry: async () => { throw new Error('quota'); } });
    const result = await f.controller.submit(entry());
    assert.equal(result.status, 'storage-failed');
    assert.equal(f.sent.length, 0);
    assert.equal(f.entries.size, 0);
});

test('offline submit persists the exact batch and payload without sending', async () => {
    const f = fixture();
    f.state.online = false;
    const request = entry();
    const result = await f.controller.submit(request);
    assert.equal(result.status, 'pending');
    assert.deepEqual(f.sent, []);
    assert.deepEqual(f.entries.get(request.clientBatchId), { ...request, status: 'pending' });
});

test('transient and permanent send failures retain the batch with distinct retry states', async () => {
    const transient = fixture({ send: async () => { throw Object.assign(new Error('network'), { status: 503 }); } });
    const pending = await transient.controller.submit(entry());
    assert.equal(pending.status, 'pending');
    assert.equal(transient.entries.get('batch-1').status, 'pending');

    const permanent = fixture({ send: async () => { throw Object.assign(new Error('invalid request'), { status: 422 }); } });
    const review = await permanent.controller.submit(entry());
    assert.equal(review.status, 'review-required');
    assert.equal(permanent.entries.get('batch-1').status, 'review-required');
});

test('malformed acknowledgment is not treated as success and leaves the same batch recoverable', async () => {
    const f = fixture({ send: async (value) => ({ ...ack(value), rows: [] }) });
    const result = await f.controller.submit(entry());
    assert.notEqual(result.status, 'acknowledged');
    assert.equal(f.acknowledged.length, 0);
    assert.equal(f.sent.length, 1);
    assert.equal(f.entries.get('batch-1').clientBatchId, 'batch-1');
});

test('concurrent duplicate submits share one in-flight send for the same owner and batch', async () => {
    const gate = deferred();
    let sends = 0;
    const f = fixture({ send: async (value) => { sends++; await gate.promise; return ack(value); } });
    const request = entry();
    const first = f.controller.submit(request);
    const second = f.controller.submit(request);
    await until(() => sends === 1);
    assert.equal(sends, 1);
    gate.resolve();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.status, 'acknowledged');
    assert.equal(b.status, 'acknowledged');
    assert.equal(sends, 1);
});

test('flush replays the exact durable batch ID and request payload', async () => {
    const f = fixture();
    const request = entry();
    f.entries.set(request.clientBatchId, structuredClone(request));
    const result = await f.controller.flush();
    assert.equal(result.sent, 1);
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].clientBatchId, request.clientBatchId);
    assert.deepEqual(f.sent[0].requests, request.requests);
});

test('restore exposes only entries for the current authenticated owner', async () => {
    const f = fixture();
    f.entries.set('mine', entry({ clientBatchId: 'mine' }));
    f.entries.set('other', entry({ clientBatchId: 'other', ownerKey: 'https://db.example|user-b|bob' }));
    const result = await f.controller.restore();
    assert.equal(result.length, 1);
    assert.equal(result[0].clientBatchId, 'mine');
    assert.deepEqual(f.restored.map((value) => value.clientBatchId), ['mine']);
});

test('restore does not collide when another owner has the same client batch ID', async () => {
    const sharedBatch = 'same-id';
    const records = [
        entry({ clientBatchId: sharedBatch, ownerKey: 'https://db.example|user-b|bob' }),
        entry({ clientBatchId: sharedBatch, ownerKey: 'https://db.example|user-a|alice', formSnapshot: { customer: 'Alice Grower' } })
    ];
    const restored = [];
    const controller = api.createController({
        currentOwner: () => 'https://db.example|user-a|alice', readEntries: async () => records,
        saveEntry: async () => {}, deleteEntry: async () => {}, send: async () => {},
        onRestore: value => restored.push(value)
    });
    const entries = await controller.restore();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].ownerKey, 'https://db.example|user-a|alice');
    assert.equal(entries[0].formSnapshot.customer, 'Alice Grower');
    assert.equal(restored.length, 1);
    assert.equal(restored[0].ownerKey, 'https://db.example|user-a|alice');
});

test('restore does not reapply the source cart for a persisted acknowledgment receipt', async () => {
    const f = fixture();
    const receipt = entry({ status: 'acknowledged', acknowledgment: ack(entry()) });
    f.entries.set(receipt.clientBatchId, receipt);
    const result = await f.controller.restore();
    assert.equal(result.length, 1, 'flush still needs the receipt to retry local cleanup');
    assert.deepEqual(f.restored, [], 'a committed request must not restore its source selection or form');
});

test('restore discards its return value if ownership changes during restore callbacks', async () => {
    const f = fixture({ onRestore: async () => { f.state.owner = 'https://db.example|user-b|bob'; } });
    f.entries.set('mine', entry({ clientBatchId: 'mine' }));
    const result = await f.controller.restore();
    assert.equal(result.length, 0, 'a completed restore for the prior owner must not be returned after a scope switch');
});

test('account change while send is pending never applies the old response to the new owner', async () => {
    const gate = deferred();
    const f = fixture({ send: async (value) => { await gate.promise; return ack(value); } });
    const promise = f.controller.submit(entry());
    await until(() => f.sent.length === 1);
    f.state.owner = 'https://db.example|user-b|bob';
    gate.resolve();
    const result = await promise;
    assert.equal(result.status, 'scope-changed');
    assert.equal(f.acknowledged.length, 0);
    assert.equal(f.sent.length, 1, 'the request already reached the server under its captured owner');
    assert.equal(f.entries.has('batch-1'), false, 'a validated server commit can be cleaned up without applying rows across owners');
});

test('server acknowledgment remains acknowledged if the local callback fails', async () => {
    const f = fixture({ onAcknowledged: async () => { throw new Error('render failed'); } });
    const result = await f.controller.submit(entry());
    assert.equal(result.status, 'acknowledged');
    assert.equal(f.sent.length, 1);
    assert.equal(f.entries.has('batch-1'), false);
});

test('server acknowledgment persists a receipt if IndexedDB cleanup fails and flush retries cleanup without resend', async () => {
    let cleanupAvailable = false;
    const f = fixture({ deleteEntry: async (key) => {
        if (!cleanupAvailable) throw new Error('indexeddb cleanup failed');
        f.entries.delete(typeof key === 'string' ? key : key.clientBatchId);
    } });
    const result = await f.controller.submit(entry());
    assert.equal(result.status, 'acknowledged');
    assert.equal(f.sent.length, 1);
    assert.equal(f.entries.get('batch-1').status, 'acknowledged');
    cleanupAvailable = true;
    const cleanup = await f.controller.flush();
    assert.equal(cleanup.sent, 1);
    assert.equal(f.sent.length, 1, 'the acknowledged batch is never dispatched again');
    assert.equal(f.entries.has('batch-1'), false);
});

test('acknowledgment clears only original selection intents and preserves later selections or re-adds', () => {
    const f = entry({ formSnapshot: { quickMode: false }, selectionSnapshot: [
        { domId: 'original', selectionToken: 'token-original' },
        { domId: 'readded', selectionToken: 'token-old' },
        { domId: 'quick-original', selectionToken: 'token-quick' }
    ] });
    const context = {
        requestSelectionTokens: new Map([
            ['original', 'token-original'],
            ['readded', 'token-new'],
            ['quick-original', 'token-quick']
        ]),
        selectedItems: new Set(['original', 'readded']),
        selectedItemSources: new Map([['original', 'drive'], ['readded', 'inventory']]),
        driveQuickRequestItems: new Set(['quick-original']),
        requestSubmissionSourceRows: new Map([['original', {}], ['readded', {}], ['quick-original', {}]]),
        updateActionBar() {}
    };
    vm.runInNewContext(extractFunction('clearAcknowledgedRequestSelection', 'async function readOwnedRequestOutboxEntries('), context);
    context.clearAcknowledgedRequestSelection(f);
    assert.deepEqual([...context.selectedItems], ['readded']);
    assert.deepEqual([...context.selectedItemSources.keys()], ['readded']);
    assert.deepEqual([...context.requestSelectionTokens], [['readded', 'token-new']]);
    assert.deepEqual([...context.requestSubmissionSourceRows.keys()], ['readded']);
    assert.deepEqual([...context.driveQuickRequestItems], ['quick-original'], 'a regular request must not clear quick-mode selections');
});

test('captured request form snapshot includes current modal fields, selection, recipients, and input values', () => {
    const context = {
        tempSelectedReqRep: 'rep-a', tempSelectedReqSalesrepId: 'sales-id', tempReqFolder: 'Folder A', tempReqCust: 'Grower A',
        tempReqAppendToExistingFolder: true, tempExistingReqCustomerSearch: 'grower', tempExistingReqSelectedCustomer: { id: 'cust-1' },
        tempExistingReqConsigneeSearch: 'consignee', tempExistingReqSelectedConsignee: { id: 'con-1' }, tempExistingReqFolderSearch: 'folder',
        previousReqStep: 'review', requestQtyStepDomIds: ['row-a'], requestQtyStepIndex: 1, requestQtyStepItemsData: { 'row-a': { qty: '' } },
        requestQtyEmailStepActive: true, detailRequestSourceDomIds: ['detail-a'], isQuickDriveRequestMode: () => false,
        getRequestEmailChainSelectedRecipients: () => [{ email: 'rep@example.com', name: 'Rep' }],
        document: { querySelectorAll: () => [{ id: 'request-qty', value: '', checked: false }, { id: 'request-note', value: 'note', checked: true }] }
    };
    vm.runInNewContext(extractFunction('captureRequestSubmissionForm', 'function setRequestSubmissionFormLocked('), context);
    const snapshot = context.captureRequestSubmissionForm();
    assert.equal(snapshot.customer, 'Grower A');
    assert.equal(snapshot.append, true);
    assert.deepEqual(Array.from(snapshot.domIds), ['row-a']);
    assert.deepEqual(Array.from(snapshot.recipients, (recipient) => recipient.email), ['rep@example.com']);
    assert.deepEqual(Array.from(snapshot.inputs, (input) => [input.id, input.value, input.checked]), [
        ['request-qty', '', false], ['request-note', 'note', true]
    ]);
});

test('restoring a saved request snapshot rebuilds modal state and original input values', () => {
    const nodes = new Map([['request-qty', { value: 'changed', checked: true }]]);
    const calls = [];
    const context = {
        getRequestSubmissionOwnerKey: () => 'https://db.example|user-a|alice',
        showRequestModalBase: () => calls.push('show'), activeRequestSubmissionBatchId: '',
        tempSelectedReqRep: '', tempSelectedReqSalesrepId: '', tempReqFolder: '', tempReqCust: '', tempReqAppendToExistingFolder: false,
        tempExistingReqCustomerSearch: '', tempExistingReqSelectedCustomer: null, tempExistingReqConsigneeSearch: '', tempExistingReqSelectedConsignee: null,
        tempExistingReqFolderSearch: '', previousReqStep: '', driveQuickRequestFlow: false, detailRequestSourceDomIds: [], requestQtyStepDomIds: [],
        requestQtyStepIndex: 0, requestQtyStepItemsData: {}, tempRequestEmailChainSelectedEmails: new Set(), tempRequestEmailChainRecipientByEmail: new Map(),
        requestSubmissionEntries: new Map(), canUseRequestEmailChainPicker: () => true,
        showRequestEmailChainFinalStep: () => calls.push('email-step'), updateRequestQtyStepSubmitButton() {},
        goToQtyStep: (...args) => calls.push(args), document: { getElementById: (id) => nodes.get(id) || null },
        JSON, Set, Map
    };
    vm.runInNewContext(extractFunction('restoreRequestSubmissionForm', 'function clearAcknowledgedRequestSelection('), context);
    const saved = {
        ownerKey: 'https://db.example|user-a|alice', clientBatchId: 'batch-restore',
        formSnapshot: {
            rep: 'rep-b', salesrepId: 'sales-b', folder: 'Folder B', customer: 'Grower B', append: false,
            customerSearch: 'g', selectedCustomer: { id: 'c2' }, consigneeSearch: 'con', selectedConsignee: { id: 'd2' },
            folderSearch: 'f', previousStep: 'picker', quickMode: true, detailDomIds: ['detail-b'], domIds: ['row-b'], index: 2,
            itemsData: { 'row-b': { qty: '0' } }, recipients: [{ email: 'rep-b@example.com', name: 'Rep B' }], emailStep: true,
            inputs: [{ id: 'request-qty', value: '0', checked: false }]
        },
        selectionSnapshot: [{ domId: 'command-row-a' }, { domId: 'command-row-b' }]
    };
    assert.equal(context.restoreRequestSubmissionForm(saved), true);
    assert.equal(context.activeRequestSubmissionBatchId, 'batch-restore');
    assert.equal(context.tempReqCust, 'Grower B');
    assert.equal(context.driveQuickRequestFlow, true);
    assert.deepEqual(Array.from(context.detailRequestSourceDomIds), ['command-row-a', 'command-row-b'],
        'restore must constrain modal details to this saved command rather than the current cart');
    assert.equal(context.tempRequestEmailChainSelectedEmails.has('rep-b@example.com'), true);
    assert.equal(nodes.get('request-qty').value, '0');
    assert.equal(nodes.get('request-qty').checked, false);
    assert.equal(calls.includes('email-step'), true);
    assert.deepEqual(calls[1], [null, 'Grower B', 'picker', false, { 'row-b': { qty: '0' } }, 2]);
});

test('restored selection updates the real toolbar helpers and ignores a different owner', () => {
    const calls = [];
    const context = {
        getRequestSubmissionOwnerKey: () => 'owner-a', requestSubmissionEntries: new Map(),
        requestSubmissionSourceRows: new Map(), requestSelectionTokens: new Map(), selectedItems: new Set(),
        selectedItemSources: new Map(), driveQuickRequestItems: new Set(),
        updateGlobalActionBar: () => calls.push('global'), refreshCartButtons: () => calls.push('cart'),
        scheduleRequestOutboxRetry: entryValue => calls.push(['retry', entryValue])
    };
    vm.runInNewContext(extractFunction('restoreRequestSubmissionSelection', 'function restoreRequestSubmissionForm('), context);
    const saved = entry({ ownerKey: 'owner-a', formSnapshot: { quickMode: false }, selectionSnapshot: [
        { domId: 'row-a', item: { UNIQUE_ID: 'row-a' }, sourceView: 'drive', selectionToken: 'token-a' }
    ] });
    context.restoreRequestSubmissionSelection(saved);
    assert.deepEqual(calls.slice(0, 2), ['global', 'cart']);
    assert.equal(calls[2][0], 'retry');
    assert.equal(context.selectedItems.has('row-a'), true);
    assert.equal(context.requestSubmissionSourceRows.get('row-a').ownerKey, 'owner-a');

    context.getRequestSubmissionOwnerKey = () => 'owner-b';
    context.restoreRequestSubmissionSelection({ ...saved, clientBatchId: 'foreign', selectionSnapshot: [{ domId: 'foreign' }] });
    assert.equal(calls.length, 3);
    assert.equal(context.requestSubmissionEntries.has('foreign'), false);
});

test('performRequestSubmission awaits the controller before navigating or reporting success', async () => {
    const gate = deferred();
    const calls = [];
    const submitted = entry();
    const context = {
        getRequestSubmissionOwnerKey: () => submitted.ownerKey,
        activeRequestSubmissionBatchId: '', requestSubmissionEntries: new Map(),
        setRequestSubmissionFormLocked: (value) => calls.push(['lock', value]),
        showToast: (...args) => calls.push(['toast', ...args]),
        getRequestSubmissionController: () => ({ submit: async (value) => { calls.push(['submit', value]); await gate.promise; return { status: 'acknowledged', entry: value }; } }),
        forcePendingRequestRoot: () => calls.push(['root']), nav: (...args) => calls.push(['nav', ...args])
    };
    vm.runInNewContext(extractFunction('performRequestSubmission', 'let lastLocalRequestDurabilityAuditAt ='), context);
    let completed = false;
    const pending = context.performRequestSubmission(submitted, { navigate: true }).then(value => { completed = true; return value; });
    await until(() => calls.some(call => call[0] === 'submit'));
    assert.equal(completed, false, 'the submit handler must remain pending while the controller is pending');
    assert.equal(calls.some(call => call[0] === 'nav'), false);
    assert.equal(calls.find(call => call[0] === 'submit')[1], submitted);
    gate.resolve();
    assert.equal(await pending, true);
    assert.equal(calls.some(call => call[0] === 'nav'), true);
    assert.deepEqual(calls.filter(call => call[0] === 'toast').at(-1).slice(1, 3), ['Requests saved', 'Requests saved; email queued']);
});

test('performRequestSubmission rejects a mismatched owner before locking, sending, or changing active batch', async () => {
    const calls = [];
    const submitted = entry();
    const context = {
        getRequestSubmissionOwnerKey: () => 'https://db.example|user-b|bob',
        activeRequestSubmissionBatchId: 'other', requestSubmissionEntries: new Map(),
        setRequestSubmissionFormLocked: () => calls.push('lock'), showToast: () => calls.push('toast'),
        getRequestSubmissionController: () => ({ submit: () => calls.push('submit') })
    };
    vm.runInNewContext(extractFunction('performRequestSubmission', 'let lastLocalRequestDurabilityAuditAt ='), context);
    assert.equal(await context.performRequestSubmission(submitted), false);
    assert.equal(context.activeRequestSubmissionBatchId, 'other');
    assert.equal(context.requestSubmissionEntries.size, 0);
    assert.deepEqual(calls, []);
});

test('storage failure leaves selections intact and unlocks the saved request form for retry', async () => {
    const formSnapshot = { customer: 'Grower A', qtyByUid: { 'MASTER-1': '' }, inputs: [{ id: 'qty', value: '' }] };
    const selectionSnapshot = [{ domId: 'drive-row', item: { UNIQUE_ID: 'MASTER-1' }, selectionToken: 'intent-a' }];
    const submitted = entry({ formSnapshot, selectionSnapshot });
    const calls = [];
    const context = {
        getRequestSubmissionOwnerKey: () => submitted.ownerKey,
        activeRequestSubmissionBatchId: submitted.clientBatchId,
        requestSubmissionEntries: new Map([[submitted.clientBatchId, submitted]]),
        setRequestSubmissionFormLocked: value => calls.push(['lock', value]),
        showToast: (...args) => calls.push(['toast', ...args]),
        getRequestSubmissionController: () => ({ submit: async () => ({ status: 'storage-failed', entry: submitted }) }),
        updateRequestQtyStepSubmitButton() {},
        clearAcknowledgedRequestSelection() { throw new Error('unacknowledged request must not clear selection'); }
    };
    vm.runInNewContext(extractFunction('performRequestSubmission', 'let lastLocalRequestDurabilityAuditAt ='), context);
    assert.equal(await context.performRequestSubmission(submitted), false);
    assert.equal(context.activeRequestSubmissionBatchId, '');
    assert.equal(context.requestSubmissionEntries.has(submitted.clientBatchId), false);
    assert.deepEqual(submitted.formSnapshot, formSnapshot, 'the editable form values remain unchanged for retry');
    assert.deepEqual(submitted.selectionSnapshot, selectionSnapshot, 'the source selection intent remains unchanged for retry');
    assert.deepEqual(calls.filter(call => call[0] === 'lock'), [['lock', true], ['lock', false]]);
    assert.equal(calls.some(call => call[0] === 'toast' && call[1] === 'Storage Error'), true);
});

test('submitRequestWithQtys awaits retry of the active saved batch and prevents duplicate submits', async () => {
    const gate = deferred();
    const calls = [];
    const saved = entry();
    const context = {
        requestSubmitInFlight: false, requestSubmissionGeneration: 4,
        getRequestSubmissionOwnerKey: () => saved.ownerKey,
        getActiveRequestSubmissionEntry: () => saved,
        updateRequestQtyStepSubmitButton() {},
        performRequestSubmission: async value => { calls.push(value); await gate.promise; return true; }
    };
    vm.runInNewContext(extractFunction('submitRequestWithQtys', 'function buildManagerEvalAssignmentKey('), context);
    let completed = false;
    const first = context.submitRequestWithQtys().then(value => { completed = true; return value; });
    assert.equal(context.requestSubmitInFlight, true);
    assert.equal(await context.submitRequestWithQtys(), false, 'a second click is ignored during the existing operation');
    assert.equal(calls.length, 1);
    assert.equal(completed, false);
    gate.resolve();
    assert.equal(await first, true);
    assert.equal(context.requestSubmitInFlight, false);
});

test('finalizeRequestAction builds bounded request payloads with blank and explicit-zero quantities', async () => {
    const f = finalizerFixture();
    const result = await f.context.finalizeRequestAction(null, 'Grower A', {
        'MASTER-0': { qty: '   ', reuse: 'NO', reserve: 'NO' },
        'MASTER-1': { qty: '0', reuse: 'NO', reserve: 'NO' }
    });
    assert.equal(result, true);
    const outbox = f.calls.find(call => call[0] === 'submit')[1];
    assert.equal(outbox.requests.length, 2);
    assert.equal(outbox.requests[0].req_qty, null, 'blank quantity remains a valid nullable value');
    assert.equal(outbox.requests[1].req_qty, '0', 'explicit zero is not converted to blank or omitted');
    assert.equal(outbox.requests[0].request_folder, 'folder-a');
    assert.equal(outbox.formSnapshot.customer, 'saved-customer');
});

test('finalizeRequestAction rejects over 100 rows before schema preflight or submission', async () => {
    const f = finalizerFixture({ count: 101, preflight: async () => { f.calls.push(['preflight']); return true; } });
    const result = await f.context.finalizeRequestAction(null, 'Grower A', {});
    assert.equal(result, false);
    assert.equal(f.calls.some(call => call[0] === 'preflight'), false);
    assert.equal(f.calls.some(call => call[0] === 'submit'), false);
    assert.equal(f.calls.some(call => call[0] === 'toast' && call[1] === 'Too Many Rows'), true);
});

test('finalizeRequestAction snapshots the selected rows and form before asynchronous schema preflight', async () => {
    const gate = deferred();
    const f = finalizerFixture({ preflight: async () => { f.calls.push(['preflight']); await gate.promise; return true; } });
    const promise = f.context.finalizeRequestAction(null, 'Grower A', {
        'MASTER-0': { qty: '', reuse: 'NO' }, 'MASTER-1': { qty: '3', reuse: 'NO' }
    });
    await until(() => f.calls.some(call => call[0] === 'preflight'));
    assert.equal(f.calls.some(call => call[0] === 'submit'), false);
    const initialSourceIds = ['dom-0', 'dom-1'];
    let currentSourceIds = initialSourceIds;
    f.context.getRequestSourceDomIds = () => currentSourceIds;
    currentSourceIds = ['dom-later-added'];
    gate.resolve();
    assert.equal(await promise, true);
    const outbox = f.calls.find(call => call[0] === 'submit')[1];
    assert.equal(outbox.formSnapshot.customer, 'saved-customer');
    assert.deepEqual(Array.from(outbox.selectionSnapshot, row => row.domId), initialSourceIds,
        'the acknowledged command must keep the selection intent captured before preflight');
});

test('RPC failure leaves the complete durable command available and does not acknowledge or clear selections', async () => {
    const submitted = entry({ formSnapshot: { customer: 'Grower A', qtyByUid: { 'MASTER-1': '' }, inputs: [{ id: 'qty', value: '' }] } });
    const f = fixture({ send: async () => { throw Object.assign(new Error('service unavailable'), { status: 503 }); } });
    const outcome = await f.controller.submit(submitted);
    assert.equal(outcome.status, 'pending');
    const durable = f.entries.get(submitted.clientBatchId);
    assert.equal(durable.status, 'pending');
    assert.deepEqual(durable.formSnapshot, submitted.formSnapshot);
    assert.deepEqual(durable.selectionSnapshot, submitted.selectionSnapshot);
    assert.equal(f.acknowledged.length, 0);
    assert.equal(f.failed.length, 1);
});

test('acknowledged request survives navigation failure without another send', async () => {
    const submitted = entry();
    const f = fixture();
    const context = {
        getRequestSubmissionOwnerKey: () => submitted.ownerKey,
        activeRequestSubmissionBatchId: '', requestSubmissionEntries: new Map(),
        setRequestSubmissionFormLocked() {}, showToast() {},
        getRequestSubmissionController: () => f.controller,
        forcePendingRequestRoot() { throw new Error('navigation failed'); }, nav() {},
        console: { warn() {} }
    };
    vm.runInNewContext(extractFunction('performRequestSubmission', 'let lastLocalRequestDurabilityAuditAt ='), context);
    assert.equal(await context.performRequestSubmission(submitted, { navigate: true }), true);
    assert.equal(f.sent.length, 1);
    assert.equal(f.acknowledged.length, 1);
    assert.equal(f.entries.has(submitted.clientBatchId), false);
});

test('reviewed-draft replacement is atomic and preserves the rejected draft on transaction failure', async () => {
    const old = entry({ clientBatchId: 'rejected', status: 'review-required', formSnapshot: { customer: 'Grower A' } });
    const replacement = entry({ clientBatchId: 'replacement', status: 'pending', supersedesBatchId: 'rejected' });
    const success = outboxTransactionFixture([old]);
    await success.context.saveRequestOutboxEntry(replacement);
    assert.equal(success.records.has('rejected'), false);
    assert.equal(success.records.get('replacement').clientBatchId, 'replacement');
    assert.deepEqual(success.history.map(([name]) => name), ['put', 'delete']);

    const wrongState = outboxTransactionFixture([entry({ clientBatchId: 'rejected', status: 'pending' })]);
    await assert.rejects(wrongState.context.saveRequestOutboxEntry(replacement));
    assert.equal(wrongState.records.has('rejected'), true, 'a non-rejected command must remain intact on abort');
    assert.equal(wrongState.records.has('replacement'), false);
    assert.ok(wrongState.abortReason);

    const writeFailure = outboxTransactionFixture([old], { failCommit: true });
    await assert.rejects(writeFailure.context.saveRequestOutboxEntry(replacement));
    assert.equal(writeFailure.records.has('rejected'), true, 'a failed write transaction must roll back the old draft deletion');
    assert.equal(writeFailure.records.has('replacement'), false, 'a failed transaction must not expose a partial replacement');
});

test('legacy outbox rows are adopted only when every source row matches the active user', async () => {
    const owner = JSON.stringify(['https://db.example', 'profile-a', 'alice']);
    const saved = [];
    const liveRows = new Map([['master-1', { UNIQUE_ID: 'master-1', DOM_ID: 'inventory-row-7' }]]);
    const context = {
        currentUser: 'Alice', SUPABASE_URL: 'https://db.example', nativeAuthProfile: { id: 'profile-a' },
        REQUEST_OUTBOX_STORE: 'request_outbox',
        getAllIndexedDbRecords: async () => [
            { clientBatchId: 'legacy-good', requests: [{ request_created_by_username: 'alice' }, { request_created_by_username: ' ALICE ' }],
                selectionSnapshot: [
                    { domId: 'old-row-7', item: { UNIQUE_ID: 'master-1', DOM_ID: 'old-row-7' }, selectionToken: 'intent-a' },
                    { domId: 'old-row-8', item: { UNIQUE_ID: 'missing-master', DOM_ID: 'old-row-8' }, selectionToken: 'intent-b' }
                ], formSnapshot: { domIds: ['old-row-7', 'old-row-8'], detailDomIds: ['old-row-7'] } },
            { clientBatchId: 'legacy-mixed', requests: [{ request_created_by_username: 'alice' }, { request_created_by_username: 'bob' }] },
            { clientBatchId: 'owned-foreign', ownerKey: 'https://db.example|profile-b|bob', requests: [{ request_created_by_username: 'bob' }] }
        ],
        saveRequestOutboxEntry: async record => saved.push(record),
        findItemByUniqueId: uid => liveRows.get(uid) || null
    };
    vm.runInNewContext(extractFunction('getRequestSubmissionOwnerKey', 'function getRequestSelectionIntentToken('), context);
    vm.runInNewContext(extractFunction('readOwnedRequestOutboxEntries', 'function getRequestSubmissionController('), context);
    const records = await context.readOwnedRequestOutboxEntries();
    assert.equal(records.length, 1, 'mixed-creator and explicitly foreign records are excluded from the active owner');
    assert.equal(records[0].ownerKey, owner);
    assert.deepEqual(Array.from(records[0].selectionSnapshot, source => source.domId), [
        'inventory-row-7', 'request-draft:legacy-good:missing-master'
    ]);
    assert.deepEqual(Array.from(records[0].formSnapshot.domIds), [
        'inventory-row-7', 'request-draft:legacy-good:missing-master'
    ]);
    assert.deepEqual(Array.from(records[0].formSnapshot.detailDomIds), ['inventory-row-7']);
    assert.equal(saved.length, 1, 'only the verified legacy row is migrated to durable ownership');
    assert.equal(saved[0].ownerKey, owner);
});

test('RPC rechecks submission owner and generation after auth headers resolve and before fetch', async () => {
    const state = { owner: 'owner-a', generation: 8 };
    let fetches = 0;
    const context = {
        assertEvalDataSourceAllowed() {}, SUPABASE_WRITE_TIMEOUT_MS: 5000, SUPABASE_URL: 'https://db.example',
        requestSubmissionGeneration: state.generation,
        getRequestSubmissionOwnerKey: () => state.owner,
        getNativeAuthRequestHeaders: async () => {
            const headers = { Authorization: 'Bearer test-token' };
            state.owner = 'owner-b';
            state.generation += 1;
            context.requestSubmissionGeneration = state.generation;
            return headers;
        },
        nativeSessionRecoveryError: () => new Error('No session'),
        window: { GncDatabase: { fetchRpc: async () => { fetches += 1; throw new Error('must not dispatch'); } } },
        JSON, Error, Object, String, Number, Math, Promise, redactEvalSensitiveData: value => value
    };
    vm.runInNewContext(extractFunction('supabaseRpc', 'const SECURE_DRIVE_EVIDENCE_PREFIXES ='), context);
    await assert.rejects(context.supabaseRpc('create_request_batch', {}, {
        requestSubmissionOwnerKey: 'owner-a', requestSubmissionGeneration: 8
    }), error => error.code === 'REQUEST_SCOPE_CHANGED' && error.hlOrderCommandDispatch === 'not_sent');
    assert.equal(fetches, 0, 'no RPC fetch may occur after an auth-scope drift');
});

test('retry scheduling accepts only online transient commands belonging to the current owner', () => {
    const timers = [];
    const flushed = [];
    const context = {
        requestSubmissionRetryTimer: 0, requestSubmissionGeneration: 2,
        navigator: { onLine: true }, getRequestSubmissionOwnerKey: () => 'owner-a',
        setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
        flushRequestOutbox: reason => { flushed.push(reason); return Promise.resolve(); }
    };
    vm.runInNewContext(extractFunction('scheduleRequestOutboxRetry', 'function captureRequestSubmissionForm('), context);
    context.scheduleRequestOutboxRetry(entry({ ownerKey: 'owner-b', status: 'pending' }));
    context.scheduleRequestOutboxRetry(entry({ status: 'review-required' }));
    context.scheduleRequestOutboxRetry(entry({ status: 'acknowledged' }));
    assert.equal(timers.length, 0);
    context.scheduleRequestOutboxRetry(entry({ ownerKey: 'owner-a', status: 'pending', attempts: 1 }));
    assert.equal(timers.length, 1);
    assert.equal(timers[0].delay, 4000);
    timers[0].callback();
    assert.deepEqual(flushed, ['retry']);

    context.requestSubmissionRetryTimer = 0;
    context.scheduleRequestOutboxRetry(entry({ ownerKey: 'owner-a', status: 'pending' }));
    context.requestSubmissionGeneration = 3;
    timers[1].callback();
    assert.deepEqual(flushed, ['retry'], 'a retry timer from an old auth epoch must not dispatch');

    context.requestSubmissionRetryTimer = 0;
    context.navigator.onLine = false;
    context.scheduleRequestOutboxRetry(entry({ ownerKey: 'owner-a', status: 'pending' }));
    assert.equal(timers.length, 2, 'offline retry requests do not create timers');
});

test('in-flight submit locks modal fields, close preserves submit lock, and reopen is blocked', async () => {
    const controls = [
        { id: 'request-customer', disabled: false, attrs: new Map(), hasAttribute(name) { return this.attrs.has(name); },
            setAttribute(name, value) { this.attrs.set(name, value); }, getAttribute(name) { return this.attrs.get(name); }, removeAttribute(name) { this.attrs.delete(name); } },
        { id: 'request-close', disabled: false, attrs: new Map([['onclick', 'closeRequestModal()']]), hasAttribute(name) { return this.attrs.has(name); },
            setAttribute(name, value) { this.attrs.set(name, value); }, getAttribute(name) { return this.attrs.get(name); }, removeAttribute(name) { this.attrs.delete(name); } },
        { id: 'request-submit-btn', disabled: false, attrs: new Map(), innerText: '', hasAttribute(name) { return this.attrs.has(name); },
            setAttribute(name, value) { this.attrs.set(name, value); }, getAttribute(name) { return this.attrs.get(name); }, removeAttribute(name) { this.attrs.delete(name); } }
    ];
    const context = {
        requestSubmitInFlight: true, requestModalAsyncGeneration: 0, activeRequestSubmissionBatchId: 'batch-active',
        setRequestSubmissionFormLocked(locked) {
            controls.forEach(control => {
                if (control.id === 'request-submit-btn' || /closeRequestModal/.test(control.getAttribute('onclick') || '')) return;
                if (locked && !control.hasAttribute('data-request-lock')) {
                    control.setAttribute('data-request-lock', control.disabled ? 'disabled' : 'enabled');
                    control.disabled = true;
                } else if (!locked && control.hasAttribute('data-request-lock')) {
                    control.disabled = control.getAttribute('data-request-lock') === 'disabled';
                    control.removeAttribute('data-request-lock');
                }
            });
        },
        document: {
            getElementById: id => controls.find(control => control.id === id) || { classList: { add() {}, remove() {} }, value: '' },
            querySelectorAll: () => controls
        },
        resetRequestModalVisibleOptionLimits() {}, resetExistingRequestFolderPickerState() {}, resetRequestCustomerSelectionState() {},
        resetRequestEmailChainState() {}, resetRequestQtyStepState() {}, resetQuickDriveRequestState() {}, configureRequestCustomerStep() {},
        renderDriveQuickRequestBar() {}, toggleCartPanel() {}, showToast() {},
        getRequestSubmissionOwnerKey: () => 'owner-a',
        getRequestSubmissionController: () => ({ restore: async () => { throw new Error('reopen must not restore while sending'); } }),
        console: { warn() {} }, Map
    };
    vm.runInNewContext(extractFunction('setRequestSubmissionFormLocked', 'function restoreRequestSubmissionSelection('), context);
    vm.runInNewContext(extractFunction('closeRequestModal', 'function encodeBloomPickerOrderMeta('), context);
    vm.runInNewContext(extractFunction('openRequestModal', 'function filterRepList('), context);

    context.setRequestSubmissionFormLocked(true);
    assert.equal(controls[0].disabled, true);
    assert.equal(controls[1].disabled, false, 'close remains available while other controls are locked');
    const closed = context.closeRequestModal();
    assert.equal(closed, undefined);
    assert.equal(context.activeRequestSubmissionBatchId, '');
    assert.equal(controls[2].disabled, true, 'close must not enable submission while the network operation is active');
    assert.equal(controls[0].disabled, false, 'the modal is closed and fields can be reset');
    assert.equal(await context.openRequestModal(), false, 'a second modal session cannot start during the old submit');
});

