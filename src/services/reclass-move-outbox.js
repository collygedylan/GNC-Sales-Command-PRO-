const RECLASS_MOVE_OUTBOX_PREFIX = 'gnc_reclass_move_outbox_v1:';
const ARGOS_PENDING_INVENTORY_RECLASS_MOVE_KEY = 'gnc_inventory_reclass_move_pending_v1';

function reclassMoveOutboxPrefix(identityKey) {
    return RECLASS_MOVE_OUTBOX_PREFIX + encodeURIComponent(identityKey) + ':';
}

function reclassMoveOutboxKey(identityKey, commandId) {
    return reclassMoveOutboxPrefix(identityKey) + encodeURIComponent(commandId);
}

function readReclassMoveOutboxRecord(storage, key, identityKey) {
    try {
        const value = JSON.parse(storage.getItem(key) || 'null');
        return value?.identityKey === identityKey && value.command?.commandId
            && Array.isArray(value.command.moves) ? value : null;
    } catch {
        return null;
    }
}

function readLegacyReclassMoveOutbox(identityKey) {
    try {
        const stored = JSON.parse(sessionStorage.getItem(ARGOS_PENDING_INVENTORY_RECLASS_MOVE_KEY) || 'null');
        const record = stored?.version === 2 ? stored.owners?.[identityKey] : stored;
        return record?.identityKey === identityKey && record.command?.commandId
            && Array.isArray(record.command.moves) ? record : null;
    } catch {
        return null;
    }
}

function readDurableReclassMoveOutbox(identityKey, commandId) {
    try {
        if (commandId) {
            const record = readReclassMoveOutboxRecord(localStorage, reclassMoveOutboxKey(identityKey, commandId), identityKey);
            return record?.command.commandId === commandId ? record : null;
        }
        return findDurableReclassMoveOutbox(identityKey, localStorage);
    } catch (error) {
        window.GncRuntimeWatchdog?.capture?.(error, 'reclass_move_outbox_read');
        return null;
    }
}

function findDurableReclassMoveOutbox(identityKey, storage) {
    const prefix = reclassMoveOutboxPrefix(identityKey);
    for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (!key?.startsWith(prefix)) continue;
        const record = readReclassMoveOutboxRecord(storage, key, identityKey);
        if (record && reclassMoveOutboxKey(identityKey, record.command.commandId) === key) return record;
    }
    return null;
}

export function readPendingArgosInventoryReclassMove(identityKey = '', commandId = '') {
    if (!identityKey) return null;
    const durable = readDurableReclassMoveOutbox(identityKey, commandId);
    if (durable) return durable;
    const legacy = readLegacyReclassMoveOutbox(identityKey);
    return !commandId || legacy?.command.commandId === commandId ? legacy : null;
}

function clearLegacyReclassMoveOutbox(identityKey, commandId) {
    if (readLegacyReclassMoveOutbox(identityKey)?.command.commandId !== commandId) return;
    const key = ARGOS_PENDING_INVENTORY_RECLASS_MOVE_KEY;
    const stored = JSON.parse(sessionStorage.getItem(key));
    if (stored.version !== 2) {
        sessionStorage.removeItem(key);
        return;
    }
    delete stored.owners[identityKey];
    if (Object.keys(stored.owners).length) sessionStorage.setItem(key, JSON.stringify(stored));
    else sessionStorage.removeItem(key);
}

export function persistPendingArgosInventoryReclassMove(state, identityKey, completedCommandId = '') {
    const pending = state?.pendingReclassMove;
    const commandId = pending?.command?.commandId || completedCommandId;
    if (!identityKey || !commandId) return false;
    try {
        const key = reclassMoveOutboxKey(identityKey, commandId);
        if (!pending) {
            clearLegacyReclassMoveOutbox(identityKey, commandId);
            localStorage.removeItem(key);
            return true;
        }
        const record = {
            identityKey, command: pending.command, inquiryPayload: pending.inquiryPayload || null,
            movedUids: pending.movedUids || [], sourceUid: String(state.snapshot?.uniqueId || ''),
            sourceView: String(state.sourceView || 'drive')
        };
        localStorage.setItem(key, JSON.stringify(record));
        return true;
    } catch (error) {
        window.GncRuntimeWatchdog?.capture?.(error, 'reclass_move_outbox_write');
        return false;
    }
}

export function isPendingReclassMoveDurable(state, identityKey) {
    const pending = state.pendingReclassMove;
    if (persistPendingArgosInventoryReclassMove(state, identityKey)) return true;
    const stored = readPendingArgosInventoryReclassMove(identityKey, pending.command.commandId);
    return !!stored && JSON.stringify(stored.command) === JSON.stringify(pending.command)
        && JSON.stringify(stored.inquiryPayload || null) === JSON.stringify(pending.inquiryPayload || null);
}
