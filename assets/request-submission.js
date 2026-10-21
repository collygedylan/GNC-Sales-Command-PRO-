(function(root) {
    'use strict';
    const copy = value => JSON.parse(JSON.stringify(value));
    const failure = code => Object.assign(new Error(code), { code });
    const rowId = row => String(row?.unique_id ?? row?.UNIQUE_ID ?? '').trim();

    function normalizeOptionalQuantity(value) {
        if (value == null) return null;
        const text = String(value).trim();
        return text === '' ? null : text;
    }

    /**
     * @typedef {Object} RequestCustomerContext
     * @property {string} customeridentityid
     * @property {string} customername
     * @property {string} consigneeidentityid
     * @property {string} consigneename
     * @property {string} request_selected_salesrep_id
     */
    /** @typedef {RequestCustomerContext & {salesrepname: string, customerstatus: string, consigneestatus: string}} RequestCustomerOption */
    /** @typedef {RequestCustomerContext & {requested_by: string, request_selected_rep_display: string, request_selected_rep_username: null}} RequestCustomerPayload */

    /**
     * Resolve only against the complete, authorized options already cached by the picker.
     * @param {RequestCustomerContext | null} context
     * @param {RequestCustomerOption[]} options
     * @param {boolean} ready
     * @returns {RequestCustomerPayload | null}
     */
    function resolveCustomerMappingPayload(context, options, ready = true) {
        if (!ready || !context || !Array.isArray(options)) return null;
        /** @type {Array<keyof RequestCustomerContext>} */
        const fields = ['customeridentityid', 'customername', 'consigneeidentityid', 'consigneename', 'request_selected_salesrep_id'];
        if (!fields.every(key => typeof context[key] === 'string' && context[key].trim())) return null;
        const matches = options.filter(option => option
            && fields.every(key => typeof option[key] === 'string' && option[key].trim() === context[key].trim())
            && String(option.customerstatus || '').trim().toUpperCase() === 'A'
            && String(option.consigneestatus || '').trim().toUpperCase() === 'A'
            && typeof option.salesrepname === 'string' && option.salesrepname.trim());
        if (matches.length !== 1) return null;
        const mapping = matches[0];
        return {
            customeridentityid: mapping.customeridentityid.trim(), customername: mapping.customername.trim(),
            consigneeidentityid: mapping.consigneeidentityid.trim(), consigneename: mapping.consigneename.trim(),
            request_selected_salesrep_id: mapping.request_selected_salesrep_id.trim(),
            requested_by: mapping.salesrepname.trim(), request_selected_rep_display: mapping.salesrepname.trim(),
            // The options response contains imported rep names, not verified profile usernames.
            request_selected_rep_username: null
        };
    }

    function validateAcknowledgment(entry, result) {
        const expected = (entry.requests || []).map(rowId);
        const actual = Array.isArray(result?.rows) ? result.rows.map(rowId) : [];
        if (!expected.length || expected.length > 100 || expected.some(id => !id)
            || new Set(expected).size !== expected.length
            || result?.client_batch_id !== entry.clientBatchId
            || !['pending', 'delivered'].includes(result?.delivery_state)
            || actual.length !== expected.length || actual.some(id => !id)
            || new Set(actual).size !== actual.length || actual.some(id => !expected.includes(id))) {
            throw failure('REQUEST_BATCH_ACK_INVALID');
        }
        return result;
    }

    function failureStatus(error) {
        if (error?.code === 'REQUEST_BATCH_ACK_INVALID') return 'pending';
        if (/^(22|23)/.test(String(error?.code || '')) || error?.code === '42501'
            || /\bREQUEST_CUSTOMER_MAPPING_REQUIRED\b/.test(String(error?.message || ''))) return 'review-required';
        return [400, 401, 403, 404, 409, 410, 422].includes(Number(error?.status)) ? 'review-required' : 'pending';
    }

    /**
     * @typedef {Object} RequestWorkDraft
     * @property {string} requestId
     * @property {number} baseVersion
     * @property {Record<string, unknown>} baseValues
     * @property {Record<string, unknown>} dirtyValues
     * @property {boolean} complete
     * @property {'local-command'} [intentPolicy]
     * @property {boolean} [legacy]
     */

    /** @param {unknown} value */
    function isRecord(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }

    /** @param {RequestWorkDraft} draft @param {{rowVersion:number, values:Record<string, unknown>}} canonical */
    function planRequestWorkConflictRebase(draft, canonical) {
        if (!isRecord(draft) || !String(draft.requestId || '').trim()
            || !Number.isSafeInteger(Number(draft.baseVersion)) || Number(draft.baseVersion) < 1
            || !isRecord(draft.baseValues) || !isRecord(draft.dirtyValues) || !Object.keys(draft.dirtyValues).length
            || !isRecord(canonical) || !Number.isSafeInteger(Number(canonical.rowVersion)) || Number(canonical.rowVersion) < 1
            || !isRecord(canonical.values)) {
            return { status: 'review-required', reason: 'legacy-or-invalid-draft', conflictFields: [] };
        }
        const fields = Object.keys(draft.dirtyValues);
        if (fields.some(field => !Object.prototype.hasOwnProperty.call(draft.baseValues, field)
            || !Object.prototype.hasOwnProperty.call(canonical.values, field))) {
            return { status: 'review-required', reason: 'incomplete-base', conflictFields: [] };
        }
        // A confirmed user command owns its narrow dirty patch. Untouched remote
        // fields never enter that patch; normal editing retains conflict review.
        const conflictFields = fields.filter(field => !(draft.complete && (draft.intentPolicy === 'local-command'
            || field === 'req_status' && draft.dirtyValues[field] === 'Complete'))
            && draft.baseValues[field] !== canonical.values[field]
            && draft.dirtyValues[field] !== canonical.values[field]);
        const rebasedValues = Object.fromEntries(fields
            .filter(field => draft.dirtyValues[field] !== canonical.values[field])
            .map(field => [field, draft.dirtyValues[field]]));
        if (conflictFields.length) {
            return {
                status: 'review-required', reason: 'overlapping-changes',
                conflictFields: conflictFields.map(field => ({
                    field, base: draft.baseValues[field], local: draft.dirtyValues[field], remote: canonical.values[field]
                })), canonical
            };
        }
        return { status: 'rebase', expectedVersion: Number(canonical.rowVersion), patch: rebasedValues, canonical };
    }

    /**
     * @param {RequestWorkDraft} draft
     * @param {{rowVersion:number, values:Record<string, unknown>}} canonical
     * @param {Record<string, 'local'|'remote'>} choices
     */
    function resolveRequestWorkDraftConflicts(draft, canonical, choices) {
        const plan = planRequestWorkConflictRebase(draft, canonical);
        if (plan.status !== 'review-required' || plan.reason !== 'overlapping-changes') return { status: plan.status, draft };
        const conflictFields = plan.conflictFields;
        if (!conflictFields.every(conflict => choices && (choices[conflict.field] === 'local' || choices[conflict.field] === 'remote'))) {
            return { status: 'review-required', draft, unresolved: conflictFields.map(conflict => conflict.field) };
        }
        const dirtyValues = { ...draft.dirtyValues };
        for (const conflict of conflictFields) if (choices[conflict.field] === 'remote') delete dirtyValues[conflict.field];
        return {
            status: 'resolved',
            draft: {
                requestId: draft.requestId, baseVersion: Number(canonical.rowVersion),
                baseValues: { ...canonical.values }, dirtyValues,
                complete: !!draft.complete && choices.req_status !== 'remote',
                legacy: false, resolvedAt: new Date().toISOString()
            }
        };
    }

    /**
     * Run one compare-and-swap save and at most one safe rebase retry.
     * @param {{draft:RequestWorkDraft, expectedVersion:number, initialPatch:Record<string,unknown>, maxRebases?:number,
     *   send:(input:{expectedVersion:number, patch:Record<string,unknown>, complete:boolean, attempt:number})=>Promise<unknown>,
     *   readCanonical:()=>Promise<{rowVersion:number,values:Record<string,unknown>,row?:unknown}|null>}} options
     */
    async function saveRequestWorkWithReconciliation(options) {
        let draft = options.draft;
        let expectedVersion = Number(options.expectedVersion);
        let patch = { ...(options.initialPatch || {}) };
        const maxRebases = Math.max(0, Math.min(1, Number(options.maxRebases ?? 1) || 0));
        for (let attempt = 0; attempt <= maxRebases; attempt += 1) {
            try {
                if (attempt > 0 && !Object.keys(patch).length) {
                    const canonical = await options.readCanonical();
                    if (!canonical) return { status: 'review-required', reason: 'canonical-row-unavailable', draft, attempts: attempt };
                    return { status: 'saved', result: { row: canonical.row, row_version: canonical.rowVersion }, draft, expectedVersion, patch, attempts: attempt, alreadyApplied: true };
                }
                const result = await options.send({ expectedVersion, patch, complete: !!(draft && draft.complete), attempt });
                return { status: 'saved', result, draft, expectedVersion, patch, attempts: attempt + 1 };
            } catch (error) {
                const detail = `${String(error && error.message || error || '')} ${String(error && error.code || '')}`.toUpperCase();
                const conflict = detail.includes('REQUEST_VERSION_CONFLICT') || detail.includes('40001') || Number(error && error.status) === 409;
                if (!conflict) return { status: 'error', error, draft, attempts: attempt + 1 };
                let canonical = null;
                try { canonical = await options.readCanonical(); } catch (error) { globalThis.GncRuntimeWatchdog?.capture?.(error, 'saveRequestWorkWithReconciliation');}
                if (!canonical) return { status: 'review-required', reason: 'canonical-row-unavailable', error, draft, attempts: attempt + 1 };
                const plan = planRequestWorkConflictRebase(draft, canonical);
                if (plan.status !== 'rebase') return { status: 'review-required', error, draft, plan, canonical, attempts: attempt + 1 };
                if (!Object.keys(plan.patch).length) {
                    return { status: 'saved', result: { row: canonical.row, row_version: canonical.rowVersion }, draft, expectedVersion: canonical.rowVersion, patch: {}, attempts: attempt + 1, alreadyApplied: true };
                }
                if (attempt >= maxRebases) return { status: 'review-required', error, draft, plan, canonical, attempts: attempt + 1 };
                expectedVersion = plan.expectedVersion;
                patch = { ...plan.patch };
                draft = { ...draft, baseVersion: canonical.rowVersion, baseValues: { ...canonical.values }, dirtyValues: { ...plan.patch } };
            }
        }
        return { status: 'review-required', draft, attempts: maxRebases + 1 };
    }

    /**
     * Keep only edits that differ from the acknowledged values after a successful save.
     * @param {{draft:RequestWorkDraft,currentDraft?:RequestWorkDraft,sentValues:Record<string,unknown>,dispatchValues:Record<string,unknown>,currentValues:Record<string,unknown>,canonical:{rowVersion:number,values:Record<string,unknown>}}} input
     */
    function mergeRequestWorkAcknowledgment(input) {
        const currentDraft = input.currentDraft || input.draft;
        const remaining = {};
        const fields = new Set([
            ...Object.keys(input.draft && input.draft.dirtyValues || {}),
            ...Object.keys(currentDraft && currentDraft.dirtyValues || {}),
            ...Object.keys(input.currentValues || {})
        ]);
        for (const field of fields) {
            const current = Object.prototype.hasOwnProperty.call(input.currentValues || {}, field)
                ? input.currentValues[field]
                : (currentDraft.dirtyValues && currentDraft.dirtyValues[field]);
            const sent = Object.prototype.hasOwnProperty.call(input.sentValues || {}, field)
                ? input.sentValues[field]
                : (input.draft.dirtyValues && input.draft.dirtyValues[field]);
            const changedDuringSave = Object.prototype.hasOwnProperty.call(input.dispatchValues || {}, field)
                && current !== input.dispatchValues[field];
            const newerStoredDraft = Object.prototype.hasOwnProperty.call(currentDraft.dirtyValues || {}, field)
                && currentDraft.dirtyValues[field] !== sent;
            if ((changedDuringSave || newerStoredDraft)
                && current !== input.canonical.values[field] && current !== undefined) remaining[field] = current;
        }
        const unappliedAfterCompletion = String(input.canonical.values && input.canonical.values.req_status || '').trim().toLowerCase() === 'complete'
            ? Object.fromEntries(Object.entries(input.sentValues || {}).filter(([field, value]) => input.canonical.values[field] !== value))
            : {};
        if (Object.keys(unappliedAfterCompletion).length) {
            Object.assign(remaining, unappliedAfterCompletion);
            return {
                status: 'review-required', reason: 'request-already-completed', dirtyValues: remaining,
                draft: { ...currentDraft, baseVersion: input.canonical.rowVersion, baseValues: { ...input.canonical.values }, dirtyValues: remaining, complete: false, acknowledged: false }
            };
        }
        return Object.keys(remaining).length
            ? { status: 'pending', dirtyValues: remaining, draft: { ...currentDraft, baseVersion: input.canonical.rowVersion, baseValues: { ...input.canonical.values }, dirtyValues: remaining, complete: false, acknowledged: false } }
            : { status: 'acknowledged', dirtyValues: {}, draft: { ...currentDraft, baseVersion: input.canonical.rowVersion, baseValues: { ...input.canonical.values }, dirtyValues: {}, complete: false, acknowledged: true } };
    }

    function createController(options) {
        const { currentOwner, saveEntry, deleteEntry, readEntries, send } = options;
        const inFlight = new Map(), commands = new Map(), receipts = new Map();
        const ownerMatches = entry => !!entry.ownerKey && entry.ownerKey === currentOwner();
        const keyFor = entry => JSON.stringify([entry.ownerKey, entry.clientBatchId]);
        const cleanupError = (error, entry) => { try { options.onCleanupError?.(error, entry); } catch (error) { globalThis.GncRuntimeWatchdog?.capture?.(error, 'createController');} };
        const acknowledged = async (entry, result, notify = true) => {
            const key = keyFor(entry);
            const receipt = { ...entry, status: 'acknowledged', acknowledgment: result };
            receipts.set(key, receipt);
            try { await saveEntry(receipt); } catch (error) { cleanupError(error, receipt); }
            if (notify && ownerMatches(entry)) {
                try { await options.onAcknowledged?.(receipt, result); } catch (error) { cleanupError(error, receipt); }
            }
            try { await deleteEntry(entry.clientBatchId); receipts.delete(key); commands.delete(key); }
            catch (error) { cleanupError(error, receipt); }
            return { status: ownerMatches(entry) ? 'acknowledged' : 'scope-changed', entry: receipt, result };
        };

        function submit(input) {
            if (!ownerMatches(input)) return Promise.resolve({ status: 'scope-changed', entry: input });
            const key = keyFor(input);
            if (inFlight.has(key)) return inFlight.get(key);
            const operation = (async () => {
                const receipt = receipts.get(key) || (input.status === 'acknowledged' ? input : null);
                if (receipt) {
                    validateAcknowledgment(receipt, receipt.acknowledgment);
                    return acknowledged(receipt, receipt.acknowledgment, !receipts.has(key));
                }
                if (input.status === 'review-required') return { status: 'review-required', entry: input };
                const entry = commands.get(key) || copy(input);
                if (!entry.clientBatchId || !Array.isArray(entry.requests) || !entry.requests.length || entry.requests.length > 100) {
                    return { status: 'review-required', entry, error: failure('REQUEST_BATCH_SIZE_INVALID') };
                }
                // Storage must succeed before any network dispatch or cart cleanup.
                try { await saveEntry(entry); }
                catch (cause) { return { status: 'storage-failed', entry, error: Object.assign(failure('REQUEST_STORAGE_FAILED'), { cause }) }; }
                commands.set(key, entry);
                if (!ownerMatches(entry)) return { status: 'scope-changed', entry };
                if (options.isOnline?.() === false) return { status: 'pending', entry, error: failure('REQUEST_OFFLINE') };
                let result;
                try {
                    result = await send(entry);
                    validateAcknowledgment(entry, result);
                } catch (error) {
                    const pending = { ...entry, status: failureStatus(error), attempts: Math.max(0, Number(entry.attempts) || 0) + 1,
                        lastAttemptAt: new Date().toISOString(), lastErrorCode: String(error?.code || (error?.status ? `HTTP_${error.status}` : 'REQUEST_COMMIT_FAILED')) };
                    commands.set(key, pending);
                    try { await saveEntry(pending); } catch (storageError) { cleanupError(storageError, pending); }
                    if (ownerMatches(entry)) { try { await options.onFailure?.(pending, error); } catch (error) { globalThis.GncRuntimeWatchdog?.capture?.(error, 'submit');} }
                    return { status: ownerMatches(entry) ? pending.status : 'scope-changed', entry: pending, error };
                }
                return acknowledged(entry, result);
            })();
            inFlight.set(key, operation);
            operation.finally(() => { if (inFlight.get(key) === operation) inFlight.delete(key); }).catch(error => { globalThis.GncRuntimeWatchdog?.capture?.(error, 'submit'); });
            return operation;
        }

        async function restore() {
            const owner = currentOwner();
            if (!owner) return [];
            const entries = await readEntries();
            if (owner !== currentOwner()) return [];
            const scoped = entries.filter(entry => entry.ownerKey === owner);
            for (const entry of scoped) {
                if (owner !== currentOwner()) break;
                if (entry.status === 'acknowledged') continue;
                try { await options.onRestore?.(copy(entry)); } catch (error) { cleanupError(error, entry); }
            }
            return owner === currentOwner() ? scoped : [];
        }

        async function flush() {
            const entries = await restore();
            let sent = 0, pending = 0;
            for (const entry of entries.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))) {
                if (!ownerMatches(entry)) break;
                if (entry.status === 'review-required' || entry.status === 'mapping-review') { pending++; continue; }
                const outcome = await submit(entry);
                if (outcome.status === 'acknowledged') sent++; else pending++;
            }
            return { sent, pending };
        }
        return Object.freeze({ submit, restore, flush });
    }

    root.AgMetricRequestSubmission = Object.freeze({
        normalizeOptionalQuantity, resolveCustomerMappingPayload, validateAcknowledgment, failureStatus,
        planRequestWorkConflictRebase, resolveRequestWorkDraftConflicts, saveRequestWorkWithReconciliation,
        mergeRequestWorkAcknowledgment, createController
    });
})(typeof window === 'object' ? window : globalThis);
