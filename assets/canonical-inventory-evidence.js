function canonicalInventoryValue(row, key) {
    return row?.[key] ?? row?.[key.toLowerCase()] ?? '';
}

function normalizeCanonicalInventoryPart(value) {
    return String(value ?? '').trim().toUpperCase();
}

function canonicalInventoryRowUid(row) {
    return String(row?.UNIQUE_ID || row?.unique_id || '').trim();
}

function canonicalInventoryLinkedUid(row) {
    return String(row?.MASTER_ID || row?.master_id || row?.MASTER_UNIQUE_ID || row?.master_unique_id || row?.master_uid || '').trim();
}

function canonicalInventoryLot(row) {
    const val = canonicalInventoryValue;
    const lot = normalizeCanonicalInventoryPart(val(row, 'LOTCODE')).replace(/[\s_-]+/g, '.').replace(/^20(\d{2})(?=\.)/, '$1');
    const year = normalizeCanonicalInventoryPart(val(row, 'SALEYEAR')).replace(/^20(?=\d{2}$)/, '');
    return /^[A-Z]\d+$/.test(lot) && /^\d{2}$/.test(year) ? `${year}.${lot}` : lot;
}

function getCanonicalAvLotKey(row) {
    const part = key => normalizeCanonicalInventoryPart(canonicalInventoryValue(row, key));
    const item = part('ITEMCODE'), location = part('LOCATIONCODE');
    const lot = canonicalInventoryLot(row);
    const year = part('SALEYEAR').replace(/^20(?=\d{2}$)/, '');
    const season = part('SEASON');
    const qualified = lot.match(/^(\d{2})\.([A-Z]\d*)$/);
    if (!item || !location || !qualified) return '';
    if ((year && year !== qualified[1]) || (season && season !== qualified[2])) return '';
    return JSON.stringify([item, location, lot]);
}

function canonicalInventorySameLocation(row, target) {
    const part = (value, key) => normalizeCanonicalInventoryPart(canonicalInventoryValue(value, key));
    const item = part(target, 'ITEMCODE'), location = part(target, 'LOCATIONCODE');
    return !!item && !!location && part(row, 'ITEMCODE') === item && part(row, 'LOCATIONCODE') === location;
}

function canonicalInventorySameLot(row, target, linked = false) {
    if (!canonicalInventorySameLocation(row, target)) return false;
    const left = canonicalInventoryLot(row), right = canonicalInventoryLot(target);
    if (left === right) return !!left || linked;
    if (!linked) return false;
    return /^[A-Z]\d+$/.test(left) && right.split('.')[1] === left
        || /^[A-Z]\d+$/.test(right) && left.split('.')[1] === right;
}

function resolveCanonicalInventoryTarget(row, byId, byItem) {
    const uid = canonicalInventoryLinkedUid(row);
    const ownUid = canonicalInventoryRowUid(row);
    const direct = byId.get(uid || ownUid);
    if (direct && canonicalInventorySameLot(row, direct, true)) return direct;
    if (uid || direct) return null;
    const code = normalizeCanonicalInventoryPart(canonicalInventoryValue(row, 'ITEMCODE'));
    const locationRows = (byItem.get(code) || []).filter(candidate => canonicalInventorySameLocation(row, candidate));
    const candidates = locationRows.filter(candidate => canonicalInventorySameLot(row, candidate, true));
    if (candidates.length === 1) return candidates[0];
    if (!candidates.length && locationRows.length === 1 && (!canonicalInventoryLot(row) || !canonicalInventoryLot(locationRows[0]))) return locationRows[0];
    return null;
}

function projectCanonicalInventoryRow(row, { strictNoteOwner = false } = {}) {
    if (!row) return row;
    if (row.__canonicalAvLotRows) {
        return hydrateCanonicalAvLotCard(row, {
            resolve: source => projectCanonicalInventoryRow(
                resolveCanonicalInventoryTarget(source, masterInventoryById, masterInventoryByItemCode) || source, { strictNoteOwner:true }),
            getPhotoUrlList,
            getPhotoEntryDateMs
        });
    }
    const val = canonicalInventoryValue;
    const target = resolveCanonicalInventoryTarget(row, masterInventoryById, masterInventoryByItemCode) || row;
    const state = getManagerAssignedColumnState(), scope = getSupabaseReadIdentityScope();
    const code = normalizeCanonicalInventoryPart(val(target, 'ITEMCODE'));
    const notes = state.noteScope === scope ? state.locationSalesNotes?.get(code) || [] : [];
    const ranked = rankCanonicalInventoryNotes(target, notes, strictNoteOwner);
    const result = {...row,...target,__canonicalInventoryResolved:true};
    const stored = val(target,'LOC_PHOTO_MATCH') !== '' ? val(target,'LOC_PHOTO_MATCH') : val(target,'LOC_MATCH_QTY');
    const depleted = stored !== '' && Number(String(stored).replace(/,/g,'')) === 0;
    applyCanonicalInventoryNotes(result, target, ranked);
    const photos = collectCanonicalInventoryPhotos(target, ranked, depleted, {val, getPhotoUrlList, getPhotoEntryDateMs});
    applyCanonicalInventoryPhotos(result, photos, {val, getPhotoRetentionFallbackDateMs});
    const onHand = Number(String(['PTRONHAND','ON_HAND','ONHAND'].map(key => val(target,key)).find(value => value !== '')).replace(/,/g,''));
    const pct = Number(String(val(result,'LOC_MATCH_PCT') || val(result,'MATCH_PCT') || val(result,'MATCH')).replace(/[% ,]/g,''));
    const quantity = stored !== '' ? stored : photos.size && onHand > 0 && pct > 0 ? Math.round(Math.min(100,pct)*onHand/100) : undefined;
    applyCanonicalInventoryMetricAliases(row, target, result, quantity);
    return result;
}

function canonicalAvLotNumber(row, keys) {
    for (const key of keys) {
        const value = canonicalInventoryValue(row, key);
        if (String(value).trim() === '') continue;
        const number = Number(String(value).replace(/[% ,]/g, ''));
        if (Number.isFinite(number)) return Math.max(0, number);
    }
    return null;
}

function hasCurrentCanonicalAvLotPhotos(row, dependencies) {
    const { getPhotoUrlList, getPhotoEntryDateMs, now = Date.now() } = dependencies;
    const quantity = canonicalAvLotNumber(row, ['LOC_PHOTO_MATCH','LOC_MATCH_QTY']);
    if (quantity === 0 || canonicalAvLotNumber(row, ['PTRONHAND','ON_HAND','ONHAND']) === 0) return false;
    const expiry = Date.parse(canonicalInventoryValue(row, 'PHOTO_EXPIRES_AT'));
    if (Number.isFinite(expiry) && expiry <= now) return false;
    return getPhotoUrlList(canonicalInventoryValue(row, 'PHOTO_LINK')).some(url => {
        const stamp = getPhotoEntryDateMs(url, row);
        return Number.isFinite(stamp) && stamp <= now && now - stamp <= 10 * 86400000;
    });
}

function sumCanonicalAvLotMetric(rows, keys) {
    const values = rows.map(row => canonicalAvLotNumber(row, keys));
    return values.some(value => value == null) ? null : values.reduce((sum, value) => sum + value, 0);
}

function getCanonicalAvLotMatch(primary, onHand, hasPhotos) {
    const stored = canonicalAvLotNumber(primary, ['LOC_PHOTO_MATCH','LOC_MATCH_QTY']);
    const pct = canonicalAvLotNumber(primary, ['LOC_MATCH_PCT','MATCH_PCT','MATCH']);
    const physical = canonicalAvLotNumber(primary, ['PTRONHAND','ON_HAND','ONHAND']);
    const baseline = canonicalAvLotNumber(primary, ['EVAL_BASELINE_AVAILABLE']);
    const available = canonicalAvLotNumber(primary, ['PTRAVAILABLE','AVAILABLE','AVAILABLE_QTY']);
    if (!hasPhotos || !stored || !pct || !physical || onHand == null || (baseline != null && available != null && baseline > available)) return stored;
    const expected = quantity => Math.round(Math.min(100, pct) * quantity / 100);
    return Math.min(onHand, stored + expected(onHand) - expected(physical));
}

function preserveCanonicalAvLotPhotoOwner(result, primary) {
    for (const key of ['PHOTO_LINK','SAVED_PHOTO_LINK','PHOTOS','PHOTO_URL','PHOTO_DATE','PHOTO_NAME']) {
        const value = canonicalInventoryValue(primary, key);
        result[key] = result[key.toLowerCase()] = value;
    }
}

function hydrateCanonicalAvLotCard(card, dependencies) {
    const key = getCanonicalAvLotKey(card);
    const candidates = new Map();
    for (const source of card.__canonicalAvLotRows || []) {
        if (!key || getCanonicalAvLotKey(source) !== key) continue;
        const row = dependencies.resolve(source), uid = canonicalInventoryRowUid(row);
        if (uid && getCanonicalAvLotKey(row) === key && !candidates.has(uid)) candidates.set(uid, row);
    }
    const rows = [...candidates.values()];
    if (!rows.length) return card;
    const photoRows = rows.filter(row => hasCurrentCanonicalAvLotPhotos(row, dependencies));
    const primary = (photoRows.length ? photoRows : rows).reduce((a, b) => {
        const hand = row => canonicalAvLotNumber(row, ['PTRONHAND','ON_HAND','ONHAND']) || 0;
        return hand(b) > hand(a) ? b : a;
    });
    const result = {...card, ...primary, __canonicalAvLotRows:card.__canonicalAvLotRows};
    preserveCanonicalAvLotPhotoOwner(result, primary);
    applyCanonicalInventoryNotes(result, primary, rows.filter(row => row !== primary));
    const aggregate = {...primary};
    for (const keys of [['PTRONHAND','ON_HAND','ONHAND'],['PTRREVIEWED','PTRREVIEW','REVIEW'],['PTRAVAILABLE','AVAILABLE','AVAILABLE_QTY']]) {
        const value = sumCanonicalAvLotMetric(rows, keys);
        for (const name of keys) aggregate[name] = aggregate[name.toLowerCase()] = value;
    }
    const quantity = getCanonicalAvLotMatch(primary, aggregate.PTRONHAND, photoRows.includes(primary));
    applyCanonicalInventoryMetricAliases(card, aggregate, result, quantity ?? undefined);
    return result;
}

function rankCanonicalInventoryNotes(target, notes, strictNoteOwner) {
    const uid = canonicalInventoryRowUid(target);
    const exact = [], location = [];
    for (const note of notes) {
        if (!canonicalInventorySameLocation(note, target)) continue;
        const owner = canonicalInventoryLinkedUid(note) || canonicalInventoryRowUid(note);
        const stored = canonicalInventoryValue(note, 'LOC_PHOTO_MATCH') || canonicalInventoryValue(note, 'LOC_MATCH_QTY');
        if (stored !== '' && Number(String(stored).replace(/,/g,'')) === 0) continue;
        if (owner === uid && canonicalInventorySameLot(note,target,true)) exact.push(note);
        else if (!note.__pendingEvaluationOwner && (!strictNoteOwner || !owner)
            && (canonicalInventorySameLot(note,target) || !owner && !canonicalInventoryLot(note))) location.push(note);
    }
    return exact.concat(location);
}

function applyCanonicalInventoryNotes(result, target, notes) {
    const val = canonicalInventoryValue;
    for (const keys of [['SPEC'],['CALIPER'],['AV_NOTE'],['PIC_NOTE','PICK_NOTE','PICK'],['SALES_NOTE','COMMENTS'],['MATCH','MATCH_PCT','LOC_MATCH_PCT']]) {
        const own = keys.map(key => val(target,key)).find(value => String(value).trim() !== '');
        const inherited = notes.flatMap(note => keys.map(key => val(note,key))).find(value => String(value).trim() !== '');
        const value = keys[0] === 'AV_NOTE' && (target.AV_NOTE === '' || target.av_note === '') ? '' : own ?? inherited;
        if (value !== undefined) for (const key of keys) result[key] = result[key.toLowerCase()] = value;
    }
}

function collectCanonicalInventoryPhotos(target, ranked, depleted, dependencies) {
    const { val, getPhotoUrlList, getPhotoEntryDateMs } = dependencies;
    const photos = new Map();
    for (const source of [target, ...(depleted ? [] : ranked)]) {
        const raw = [source.PHOTOS, source.photos].flatMap(parseCanonicalPhotoMetadata);
        const urls = ['PHOTO_LINK', 'SAVED_PHOTO_LINK', 'PHOTOS', 'PHOTO_URL'].flatMap(key => getPhotoUrlList(val(source, key)));
        for (const url of urls) {
            const stamp = getPhotoEntryDateMs(url, source);
            if (source !== target && (!Number.isFinite(stamp) || stamp > Date.now() || Date.now() - stamp > 10 * 86400000)) continue;
            if (photos.has(url)) continue;
            const metadata = raw.find(entry => entry && typeof entry === 'object' && getPhotoUrlList([entry]).includes(url));
            photos.set(url, canonicalPhotoMetadataValue(metadata, url, stamp));
        }
    }
    return photos;
}

function canonicalPhotoMetadataValue(metadata, url, stamp) {
    if (metadata) return { ...metadata };
    return Number.isFinite(stamp) ? { url, date: new Date(stamp).toISOString() } : url;
}

function parseCanonicalPhotoMetadata(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string' || !value.trim().startsWith('[')) return [];
    try { return JSON.parse(value); } catch { return []; }
}

function applyCanonicalInventoryPhotos(result, photos, dependencies) {
    if (!photos.size) return;
    const { val, getPhotoRetentionFallbackDateMs } = dependencies;
    result.PHOTO_LINK = result.photo_link = result.SAVED_PHOTO_LINK = [...photos.keys()].join(',');
    result.PHOTOS = result.photos = [...photos.values()];
    result.PHOTO_URL = result.photo_url = [...photos.keys()][0];
    const stamp = getPhotoRetentionFallbackDateMs(result);
    if (!String(val(result, 'PHOTO_DATE')).trim() && Number.isFinite(stamp)) result.PHOTO_DATE = result.photo_date = new Date(stamp).toISOString();
}

function applyCanonicalInventoryMetricAliases(row, target, result, quantity) {
    const metricFamilies = [["PTRONHAND", "PTR_ON_HAND", "EXT_PTRONHAND", "ON_HAND", "ONHAND", "onHand", "qty_on_hand", "oh"], ["PTRREVIEWED", "PTR_REVIEWED", "PTRREVIEW", "REVIEWED", "REVIEW", "REVIEW_QTY"], ["PTRAVAILABLE", "PRTAVAILABLE", "AVAILABLE", "AVAILABLE_QTY", "LOC_AVAIL", "LOC_AVAILABLE", "LOCAVA"], ["S_LTS", "OPEN_STOCK", "openStock"], ["LOC_ON_HAND", "locOnHand"], ["LOC_PHOTO_MATCH", "LOC_MATCH_QTY", "CURRENT_PHOTO_MATCH_QTY", "REQ_LOC_MATCH_QTY", "PHOTO_MATCH_QTY", "locPhotoMatch"]];
    const snapshot = row.SNAPSHOT || target.SNAPSHOT ? { ...(row.SNAPSHOT || {}), ...(target.SNAPSHOT || {}) } : null;
    for (const keys of metricFamilies) {
        const aliases = [...new Set(keys.flatMap(key => [key, key.toLowerCase()]))];
        const ownKey = aliases.find(key => Object.hasOwn(target, key));
        const value = canonicalMetricFamilyValue(keys, aliases, target, quantity, ownKey);
        applyCanonicalMetricFamily(result, snapshot, aliases, value, keys[0] === 'LOC_ON_HAND' && ownKey !== undefined);
    }
    if (snapshot) result.SNAPSHOT = snapshot;
}

function canonicalMetricFamilyValue(keys, aliases, target, quantity, ownKey) {
    if (keys[0] === 'LOC_PHOTO_MATCH' && quantity !== undefined) return quantity;
    if (ownKey !== undefined) return target[ownKey];
    const snapshotKey = target.SNAPSHOT ? aliases.find(key => Object.hasOwn(target.SNAPSHOT, key)) : undefined;
    return snapshotKey !== undefined ? target.SNAPSHOT[snapshotKey] : undefined;
}

function applyCanonicalMetricFamily(result, snapshot, aliases, value, keepNullLocation) {
    for (const key of aliases) {
        if ((value == null || String(value).trim() === '') && !keepNullLocation) {
            delete result[key];
            if (snapshot) delete snapshot[key];
        } else {
            result[key] = value;
            if (snapshot) snapshot[key] = value;
        }
    }
}

function getConfirmedDriveEvidenceRow(result, item) {
    const masterUid = String(firstNonEmptyValue(item?.UNIQUE_ID, item?.unique_id, item?.master_uid, '') || '').trim();
    const raw = result?.writeConfirmed === true
        ? getCommittedDriveEvidenceReceipt(result,item).row : window.GncDatabase.confirmedDriveEvidence(result);
    if (!masterUid || String(raw.unique_id || '') !== masterUid) throw new Error('DRIVE_ROW_IDENTITY_MISMATCH');
    result.locationRows = (Array.isArray(result.locationRows) ? result.locationRows : []).filter(row => String(row.unique_id || '') === masterUid);
    if (!isSameDriveEvidenceLocation(raw,item,true)) throw new Error('The saved inventory identity changed. Reopen the item before retrying.');
    return {raw,masterUid};
}

function applyConfirmedDriveLocationEvidence(target, source, prefix) {
    const skip = ['unique_id','itemcode','locationcode','lotcode','ptravailable','loc_match_qty'];
    for (const key of window.GncDatabase.driveEvidenceColumns) {
        if (skip.includes(key)) continue;
        const value = source[key.toUpperCase()] ?? source[key] ?? null;
        target[key.toUpperCase()] = target[key] = value;
    }
    target.PICK = target.pic_note = firstNonEmptyValue(source.PICK,source.pic_note,source.PIC_NOTE,'');
    const qty = getEditorLocMatchQtyValue(target,firstNonEmptyValue(source.MATCH,source.match,''));
    target.LOC_MATCH_QTY = target.loc_match_qty = qty == null ? firstNonEmptyValue(source.LOC_MATCH_QTY,source.loc_match_qty,'') : qty;
    target.LOC_MATCH_PCT = target.loc_match_pct = parseAppNumber(firstNonEmptyValue(source.loc_match_pct,source.LOC_MATCH_PCT,source.MATCH,source.match,''));
    target.LOC_PHOTO_MATCH = target.loc_photo_match = target.LOC_MATCH_QTY;
    target.PHOTO_MATCH_PTR_AVAILABLE_KNOWN = parseAppNumber(firstNonEmptyValue(target.PTRONHAND,target.ptronhand,target.PTRAVAILABLE,target.ptravailable,'')) != null;
    setPhotoAliasFieldsForPrefix(target,prefix,firstNonEmptyValue(source.PHOTO_LINK,source.photo_link,''),firstNonEmptyValue(source.PHOTO_NAME,source.photo_name,''));
    normalizeRowPhotoFields(target);
    buildSearchIndex(target);
}

function reconcileConfirmedDriveMasterRows(responseRows, item, prefix) {
    const claimed = new Set(), applied = [];
    for (const sourceRow of responseRows) {
        if (!isSameDriveEvidenceLocation(sourceRow,item,true)) continue;
        const canonical = formatFetchedRows([sourceRow],'ph_master_inventory')[0];
        for (const key of window.GncDatabase.driveEvidenceColumns) canonical[key.toUpperCase()] = canonical[key] = sourceRow[key];
        canonical.PICK = sourceRow.pic_note;
        canonical.PHOTO_MATCH_PTR_AVAILABLE_KNOWN = parseAppNumber(sourceRow.ptravailable) != null;
        const uid = String(firstNonEmptyValue(canonical.UNIQUE_ID,sourceRow.unique_id,'') || '').trim();
        const existing = masterInventoryById.get(uid);
        const master = existing && !claimed.has(existing) ? Object.assign(existing,canonical) : canonical;
        if (master === canonical) {
            fullInventory.push(master);
            masterInventoryById.set(uid,master);
        }
        claimed.add(master);
        applyConfirmedDriveLocationEvidence(master,canonical,prefix);
        applied.push(master);
        confirmedDriveEvidenceRows.set(String(master.UNIQUE_ID || uid),buildConfirmedDriveEvidenceState(master));
    }
    return applied;
}

function updateConfirmedDriveEvidenceState(master, masterUid, raw, scope) {
    const state = getManagerAssignedColumnState();
    if (state.photoReadScope === scope && state.photoReadRows?.has(masterUid)) state.photoReadRows.set(masterUid,master);
    if (state.sessionPhotoScope === scope) state.recentSessionPhotos?.delete('uid:' + masterUid);
    if (state.noteScope !== scope) state.locationSalesNotes = new Map();
    state.noteScope = scope;
    const code = getRequestItemCodeOptionItemCode(master);
    const notes = (state.locationSalesNotes ||= new Map()).get(code) || [];
    state.locationSalesNotes.set(code,notes.filter(note => note.unique_id !== masterUid).concat(raw));
    state.fullInventory = fullInventory;
    state.photoGeneration = (state.photoGeneration || 0) + 1;
}

function preserveDriveEvidenceEditor(item, options) {
    if (options.photoOnly !== true || String(activeItem?.SOURCE_TABLE || '').toLowerCase() !== 'ph_master_inventory'
        || !isSameDriveEvidenceLocation(activeItem,item,true)) return null;
    const draft = {...activeItem};
    if (fullInventory.includes(activeItem)) activeItem = {...activeItem};
    return draft;
}

function restoreDriveEvidenceEditor(item, draft, master, prefix) {
    if (!draft || !isSameDriveEvidenceLocation(activeItem,item,true)) return;
    Object.assign(activeItem,draft);
    for (const key of ['PHOTO_DATE','photo_date','AV_RULE_PHOTO_UPDATED_AT','av_rule_photo_updated_at']) {
        if (master[key] != null) activeItem[key] = master[key];
    }
    setPhotoAliasFieldsForPrefix(activeItem,prefix,master.PHOTO_LINK || '',master.PHOTO_NAME || '');
    normalizeRowPhotoFields(activeItem);
}

function reconcileConfirmedDriveEvidence(result, item, prefix = '', options = {}) {
    const scope = getSupabaseReadIdentityScope();
    if (options.scope && options.scope !== scope) throw Object.assign(new Error('Photo session changed.'), {code:'DRIVE_SAVE_ABORTED'});
    if (result?.noOp === true) return {row:item,applied:false};
    const {raw,masterUid} = getConfirmedDriveEvidenceRow(result,item);
    const draft = preserveDriveEvidenceEditor(item,options);
    const responseRows = result.locationRows.length ? result.locationRows.filter(row => row && typeof row === 'object') : [raw];
    const applied = reconcileConfirmedDriveMasterRows(responseRows,item,prefix);
    const master = applied.find(row => String(row.UNIQUE_ID || '') === masterUid);
    if (!master) throw new Error('DRIVE_ROW_IDENTITY_MISMATCH');
    if (options.photoOnly !== true && item !== master) applyConfirmedDriveLocationEvidence(item,master,prefix);
    const changedKeys = getDatasetKeysForTable('ph_master_inventory');
    try {
        rebuildMasterInventoryIndexes();
        updateConfirmedDriveEvidenceState(master,masterUid,raw,scope);
        touchDatasetLoadStateForLocalChange(changedKeys);
        propagateCommittedEdit('ph_master_inventory',master,changedKeys,null,{prefix,
            preserveDetailDraft:options.preserveDetailDraft === true || options.photoOnly === true,delay:0,typingDelay:120});
    } finally {
        reapplyPendingEvaluationProjection(masterUid,getManagerAssignedColumnState(),scope);
        restoreDriveEvidenceEditor(item,draft,master,prefix);
    }
    return {row:master,rows:applied,applied:true};
}
