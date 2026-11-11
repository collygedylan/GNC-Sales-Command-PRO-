import {isOperationalTransientError, waitForOperationalRetry} from '../services/rpc-recovery-domain.js';

export function unlockProtectedSection(prefix) {
    const item = activeItem;
    if (!canUnlockCompletedRow(item)) { showRowEditRestrictedToast(prefix); return false; }
    const state = getManagerAssignedColumnState(), key = getCompletedRowUnlockKey(item);
    if (!key) return false;
    const pending = state.pendingRowUnlocks ||= new Map();
    if (pending.has(key)) return false;
    const overrides = state.unlockedRowsByKey ||= new Map();
    const signature = String(item.LAST_UPDATED || item.last_updated || '');
    state.failedRowUnlocks?.delete(key);
    overrides.set(key, true);
    for (const row of new Set([item, masterInventoryById.get(key)])) {
        if (row) Object.assign(row, {completed:false, is_completed:false, locked:false, row_locked:false,
            DATE_COMPLETED:null, date_completed:null, completed_at:null});
    }
    protectedEditState[prefix] = key;
    clearProtectedTimers(prefix);
    applyProtectedEditState(prefix);
    const scope = getSupabaseReadIdentityScope();
    const task = serializeSuspendTagRowWrite({UNIQUE_ID:key}, () => persistCanonicalRowUnlock(state, item, prefix, key, signature, scope), 'unlock|' + signature);
    pending.set(key, task);
    task.finally(() => { if (pending.get(key) === task) pending.delete(key); }).catch(() => {});
    return false;
}

async function sendCanonicalRowUnlock(key, signature, current) {
    const headers = await getNativeAuthRequestHeaders();
    if (!current()) return null;
    if (!headers?.Authorization) throw Object.assign(new Error('Native sign-in is required to unlock this row.'), {retryable:false});
    const response = await fetchWithTimeout(SUPABASE_URL + '/rest/v1/rpc/unlock_drive_evidence_v1', {
        method:'POST', headers, referrerPolicy:'no-referrer', recoverableRpcAttempt:true,
        body:JSON.stringify({p_master_uid:key,p_expected_signature:signature})
    }, 25000, 'Unlock row');
    const result = await response.json();
    if (!response.ok || result?.ok !== true) throw Object.assign(new Error(result?.message || result?.code || 'Unlock was not confirmed.'), {
        status:response.status,code:result?.code
    });
    return result;
}

export async function persistCanonicalRowUnlock(state, item, prefix, key, signature, scope) {
    const current = () => scope === getSupabaseReadIdentityScope() && state === getManagerAssignedColumnState();
    const delays = [150,400,900];
    for (let attempt = 0; attempt <= delays.length && current(); attempt++) {
        try {
            const result = await sendCanonicalRowUnlock(key, signature, current);
            if (!current() || !result) return false;
            return applyCanonicalUnlockReceipt(state,item,key,signature,result);
        } catch (error) {
            if (!current()) return false;
            if (!isOperationalTransientError(error) || attempt === delays.length) {
                return retainUnconfirmedRowUnlock(state, prefix, key, error);
            }
            await waitForOperationalRetry(delays[attempt]+Math.floor(Math.random()*50));
        }
    }
    return false;
}

function retainUnconfirmedRowUnlock(state, prefix, key, error) {
    (state.failedRowUnlocks ||= new Set()).add(key);
    window.GncRuntimeWatchdog?.capture?.(error,'persistCanonicalRowUnlock:terminal');
    if (activeItem && getCompletedRowUnlockKey(activeItem) === key) {
        renderProtectedControls(prefix);
        showToast('Unlock not confirmed', 'Your edits are retained. Tap Retry Unlock before saving.', true);
    }
    return false;
}

export function applyCanonicalUnlockReceipt(state, item, key, signature, result) {
    if (String(result?.row?.unique_id || result?.row?.UNIQUE_ID || '') !== key) {
        throw Object.assign(new Error('Unlock receipt identity mismatch.'), {retryable:false});
    }
    for (const row of new Set([item, masterInventoryById.get(key)])) {
        if (row && result.row.last_updated && String(row.LAST_UPDATED || row.last_updated || '') === signature) {
            row.LAST_UPDATED = row.last_updated = result.row.last_updated;
        }
    }
    if (state.unlockedRowsByKey.get(key) === true) state.unlockedRowsByKey.set(key, result.row.last_updated || true);
    return true;
}
