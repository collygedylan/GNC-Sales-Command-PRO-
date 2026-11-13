let bloomCartOwner = '';
let bloomCartAppliedSnapshot = { raw: '', revision: 0, rows: [] };
let bloomCartLifecycleBound = false;
const bloomCartBoundIds = new Map();

function getBloomCartOwner() {
    if (!currentUser || !hasAuthenticatedOperationalReadIdentity()) return '';
    return String(nativeAuthProfile?.id || getRequestCapabilityUsernameKey(currentUser));
}

function readBloomCartStorage(storageName, key) {
    try {
        const raw = window[storageName].getItem(key);
        const snapshot = JSON.parse(raw);
        if (Number.isSafeInteger(snapshot?.revision) && Array.isArray(snapshot.rows)
            && snapshot.rows.every(isBloomCartStorageRow)) return { raw, ...snapshot };
    } catch {
        // The other storage mirror can still restore the selection.
    }
    return { raw: '', revision: 0, rows: [] };
}

function isBloomCartStorageRow(row) {
    return Array.isArray(row) && typeof row[0] === 'string' && !!row[0] && !row[0].startsWith('hl-order:')
        && typeof row[1] === 'string' && typeof row[2] === 'string' && !!row[2];
}

function readBloomCartSnapshot(owner) {
    const key = 'agdata.bloom-cart.v1:' + owner;
    const local = readBloomCartStorage('localStorage', key);
    const session = readBloomCartStorage('sessionStorage', key);
    const stored = session.revision > local.revision ? session : local;
    return owner === bloomCartOwner && bloomCartAppliedSnapshot.revision > stored.revision
        ? bloomCartAppliedSnapshot : stored;
}

function writeBloomCartSnapshot(owner, rows, revision) {
    const key = 'agdata.bloom-cart.v1:' + owner;
    const raw = JSON.stringify({ revision, rows });
    for (const storageName of ['sessionStorage', 'localStorage']) {
        try { window[storageName].setItem(key, raw); } catch {
            // Keep the in-memory selection usable if a storage mirror is unavailable.
        }
    }
    bloomCartAppliedSnapshot = { raw, revision, rows };
}

function scopeBloomCart(owner) {
    if (bloomCartOwner !== owner) {
        clearBloomCartBindings();
        bloomCartOwner = owner;
        bloomCartAppliedSnapshot = { raw: '', revision: 0, rows: [] };
    }
}

function applyBloomCartSnapshot(owner) {
    const snapshot = readBloomCartSnapshot(owner);
    if (!snapshot.raw || snapshot.raw === bloomCartAppliedSnapshot.raw) return false;
    clearBloomCartBindings();
    bloomCartAppliedSnapshot = snapshot;
    return true;
}

function removeBloomCartBinding(id) {
    selectedItems.delete(id);
    selectedItemSources.delete(id);
    requestSelectionTokens.delete(id);
}

function clearBloomCartBindings() {
    for (const id of bloomCartBoundIds.values()) removeBloomCartBinding(id);
    bloomCartBoundIds.clear();
}

function findBloomCartRow(domId, uid) {
    const displayed = findItemByDomId(domId);
    if (getItemUniqueId(displayed) === uid) return displayed;
    if (domId.startsWith('avo_')) return null;
    const current = masterInventoryById.get(uid) || findItemByUniqueId(uid);
    return canUseCartInventoryActions([current]) ? current : null;
}

function rebindBloomCartRows() {
    let changed = false;
    for (const [savedId, source, uid] of bloomCartAppliedSnapshot.rows) {
        const row = findBloomCartRow(savedId, uid);
        const id = canAddItemToBloomPicker(row, source || 'bloom-draft') ? row.DOM_ID : '';
        const previous = bloomCartBoundIds.get(uid);
        if (previous && previous !== id) {
            removeBloomCartBinding(previous);
            bloomCartBoundIds.delete(uid);
            changed = true;
        }
        if (!id) continue;
        bloomCartBoundIds.set(uid, id);
        if (selectedItems.has(id)) continue;
        selectedItems.add(id);
        selectedItemSources.set(id, source);
        requestSelectionTokens.set(id, createStableClientBatchId());
        changed = true;
    }
    return changed;
}

function restoreBloomCartSelection() {
    const owner = getBloomCartOwner();
    if (!owner) return false;
    scopeBloomCart(owner);
    if (!canAccessView('bloom')) {
        clearBloomCartBindings();
        return false;
    }
    const updated = applyBloomCartSnapshot(owner);
    if (!rebindBloomCartRows() && !updated) return false;
    scheduleCartUiRefresh();
    refreshCartButtons();
    return true;
}

function bindBloomCartLifecycle() {
    if (bloomCartLifecycleBound) return;
    bloomCartLifecycleBound = true;
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) restoreBloomCartSelection();
    });
    window.addEventListener('pageshow', restoreBloomCartSelection);
}

function persistBloomCartSelection(domIds, remove = false) {
    const owner = getBloomCartOwner();
    if (!owner || !canAccessView('bloom')) return;
    const snapshot = readBloomCartSnapshot(owner);
    const rows = new Map(snapshot.rows.map(entry => [entry[2], entry]));
    for (const id of domIds) updateBloomCartStorageRow(rows, id, remove);
    bloomCartOwner = owner;
    writeBloomCartSnapshot(owner, [...rows.values()], Math.max(Date.now(), snapshot.revision + 1));
}

function updateBloomCartStorageRow(rows, id, remove) {
    const row = findItemByDomId(id);
    const uid = getItemUniqueId(row);
    if (remove) {
        const saved = uid || [...bloomCartBoundIds].find(([, domId]) => domId === id)?.[0];
        rows.delete(saved);
        bloomCartBoundIds.delete(saved);
    } else if (uid && canUseCartInventoryActions([row])) {
        rows.set(uid, [id, selectedItemSources.get(id) || '', uid]);
        bloomCartBoundIds.set(uid, id);
    }
}

function getPersistedBloomCartIds() {
    if (getBloomCartOwner() !== bloomCartOwner) return new Set();
    return new Set(bloomCartBoundIds.values());
}

function hasSavedBloomCartRows() {
    return getBloomCartOwner() === bloomCartOwner && bloomCartAppliedSnapshot.rows.length > 0;
}

function clearPersistedBloomCart() {
    const owner = getBloomCartOwner();
    if (!owner) return;
    scopeBloomCart(owner);
    const { revision } = readBloomCartSnapshot(owner);
    bloomCartBoundIds.clear();
    writeBloomCartSnapshot(owner, [], Math.max(Date.now(), revision + 1));
}
