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

    function createController(options) {
        const { currentOwner, saveEntry, deleteEntry, readEntries, send } = options;
        const inFlight = new Map(), commands = new Map(), receipts = new Map();
        const ownerMatches = entry => !!entry.ownerKey && entry.ownerKey === currentOwner();
        const keyFor = entry => JSON.stringify([entry.ownerKey, entry.clientBatchId]);
        const cleanupError = (error, entry) => { try { options.onCleanupError?.(error, entry); } catch {} };
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
                    if (ownerMatches(entry)) { try { await options.onFailure?.(pending, error); } catch {} }
                    return { status: ownerMatches(entry) ? pending.status : 'scope-changed', entry: pending, error };
                }
                return acknowledged(entry, result);
            })();
            inFlight.set(key, operation);
            operation.finally(() => { if (inFlight.get(key) === operation) inFlight.delete(key); }).catch(() => {});
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

    root.AgMetricRequestSubmission = Object.freeze({ normalizeOptionalQuantity, validateAcknowledgment, failureStatus, createController });
})(typeof window === 'object' ? window : globalThis);
