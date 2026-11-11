
function normalizeDockViewDockKey(dockNum = '') {
    const normalized = String(dockNum ?? '').trim().replace(/^dock\s*/i, '').replace(/[.]0+$/, '');
    return /^[0-9]+$/.test(normalized) && /[1-9]/.test(normalized)
        ? normalized.replace(/^0+(?=[0-9])/, '') : 'Unassigned';
}

function normalizeDockViewStopKey(stopNum = '') {
    const normalized = String(stopNum || '').trim().replace(/^(?:drop|stop)\s*/i, '').replace(/^(-?\d+)\.0+$/, '$1');
    return normalized || 'Unassigned';
}

function firstDockValue(row, keys) {
    return firstDockNonEmpty(...keys.map(key => row[key]));
}

function getDockOrderBusinessKey(row = {}) {
    const value = (...keys) => firstDockValue(row, keys);
    const code = String(value('ITEMCODE','itemcode')).trim().toUpperCase().replace(/[.]+$/, '');
    const dock = normalizeDockViewDockKey(value('DOCK','dock','DOCK_NUM','dock_num'));
    const drop = normalizeDockViewStopKey(value('STOPNUMBER','stopnumber','STOP','stop','DROP_NUMBER','drop_number','DROP','drop'));
    const location = String(value('LOCATIONCODE','locationcode','LOCATION','location')).trim().toUpperCase();
    if (!code || dock === 'Unassigned' || drop === 'Unassigned') return '';
    const quantity = Number(String(value('QUANTITYORDERED','quantityordered','QTY','qty','ORDERED_QTY','ordered_qty') || 0).replace(/,/g,''));
    return JSON.stringify([dock,drop,code,location,String(value('CONSIGNEENAME','consigneename','CONSIGNEE','consignee')).trim(),Number.isFinite(quantity)?quantity:0]);
}

function normalizeDockSuspendRequestValue(value = '') {
    return String(value || '').trim().toUpperCase().replace(/[\s_-]+/g, ' ');
}

function getDockSuspendValue(item = null) {
    return normalizeDockSuspendRequestValue(firstDockValue(item || {}, ['SUSPEND', 'suspend', 'Suspend']));
}

function isDockSuspendDcRequestSource(item = null) {
    if (!item || !['SUSPEND', 'SUSPENDED'].includes(getDockSuspendValue(item))) return false;
    const dock = firstDockValue(item, ['DOCK_NUM', 'dock_num', 'DOCK', 'dock']);
    const closed = item.suspend_completed === true || item.SUSPEND_COMPLETED === true || item.completed === true;
    const candidate = String(item.suspend_candidate_state || item.SUSPEND_CANDIDATE_STATE || '').toLowerCase();
    const status = String(item.status || item.STATUS || '').toLowerCase();
    return normalizeDockViewDockKey(dock) !== 'Unassigned' && !closed
        && !['approved', 'rejected', 'replaced', 'denied', 'canceled', 'cancelled'].includes(candidate)
        && !['complete', 'completed', 'deleted'].includes(status);
}

function isDockSuspendDcRequestMirrorRow(item = null) {
    if (!item) return false;
    const text = (...keys) => String(firstDockValue(item, keys) || '').trim().toLowerCase();
    const isSuspendTag = item.IS_SUSPEND_TAG === true || item.is_suspend_tag === true
        || ['true', '1', 'yes'].includes(text('IS_SUSPEND_TAG', 'is_suspend_tag'));
    const uniqueId = String(firstDockValue(item, ['UNIQUE_ID', 'unique_id']) || '').trim();
    return isSuspendTag || text('REQUEST_TYPE', 'request_type') === 'suspend_tag' || isDockSuspendDcRequestSource(item)
        || item.DOCK_SUSPEND_DC_REQUEST === true
        || String(item.DOCK_SUSPEND_DC_REQUEST || '').trim().toLowerCase() === 'true'
        || /^dock_suspend_dc_/i.test(uniqueId) || !!(item.DOCK_SUSPEND_SOURCE_UID || item.dock_suspend_source_uid)
        || (text('SOURCE_TABLE', 'source_table') === 'ph_soc_master' && text('REQUEST_SOURCE', 'request_source') === 'docks');
}

function liveInventoryCardValue(row, ...keys) {
    for (const key of keys) for (const alias of [key, key.toLowerCase()]) {
        const value = row?.[alias];
        if (value != null && String(value).trim() !== '') return value;
    }
    return '';
}

function resolveLiveInventoryCardPhotoMatch(primary, note, number, calculateMatch) {
    const evidence = {...primary,...(note || {})};
    const pct = number(evidence,'MATCH_PCT','LOC_MATCH_PCT','MATCH');
    const stored = number(evidence,'LOC_PHOTO_MATCH','LOC_MATCH_QTY');
    const noteStored = number(note,'LOC_PHOTO_MATCH','LOC_MATCH_QTY');
    const depleted = liveInventoryCardValue(evidence,
        'EVAL_BASELINE_AVAILABLE','INITIAL_LOC_PHOTO_MATCH','INITIAL_PHOTO_MATCH_QTY') !== '';
    if (noteStored > 0) return noteStored;
    const photos = liveInventoryCardValue(evidence,'PHOTO_LINK','PHOTO_URL','PHOTOS');
    const photoTimestamp = liveInventoryCardValue(evidence,'AV_RULE_PHOTO_UPDATED_AT','PHOTO_DATE');
    if (!photos || !photoTimestamp) return null;
    if (depleted) return calculateMatch(primary,note);
    const available = number(primary,'PTRAVAILABLE','AVAILABLE','AVAILABLE_QTY');
    if (photos && pct > 0) return Math.round(Math.min(100,pct)*available/100);
    return stored > 0 ? stored : Math.round(Math.min(100,pct)*number(primary,'PTRONHAND','ON_HAND')/100);
}

function hydrateLiveInventoryCardDisplay(primary, selected, atLocation, rows, options) {
    const text = value => String(value || '').trim().toUpperCase();
    const location = value => options.normalizeLocation(value) || text(value);
    const lot = value => text(value).replace(/^(?:\d{2}|\d{4})[.\s-]*/, '');
    const number = (item,...keys) => Math.max(0,Number(String(liveInventoryCardValue(item,...keys)).replace(/[, %]/g,'')) || 0);
    const onHand = item => number(item,'PTRONHAND','ON_HAND','ONHAND');
    const available = item => number(item,'PTRAVAILABLE','AVAILABLE','AVAILABLE_QTY');
    const review = item => number(item,'PTRREVIEWED','PTRREVIEW','REVIEW','REVIEW_QTY');
    const loc = location(liveInventoryCardValue(primary,'LOCATIONCODE'));
    const result = {...options.canonical, __liveInventoryCardDisplay:true};
    const uid = String(primary.UNIQUE_ID || primary.unique_id || '');
    const notes = options.notes;
    const note = notes.find(item => {
        const noteUid = String(item.MASTER_UNIQUE_ID || item.master_unique_id || item.MASTER_ID || item.master_id || item.UNIQUE_ID || item.unique_id || '');
        return location(liveInventoryCardValue(item,'LOCATIONCODE')) === loc && noteUid === uid && canonicalInventorySameLot(item,primary);
    });
    const fields = [['SPEC'],['CALIPER'],['AV_NOTE','AVNOTE'],['PIC_NOTE','PICK_NOTE','PICKNOTE'],['SALES_NOTE','COMMENTS'],['PHOTO_LINK','PHOTO_URL','PHOTOS'],['PHOTO_NAME'],['PHOTO_DATE'],['DATE_COMPLETED'],['AV_RULE_PHOTO_UPDATED_AT'],['MATCH_PCT','LOC_MATCH_PCT','MATCH'],['LOC_PHOTO_MATCH','LOC_MATCH_QTY'],['HOLDSTOPCODE','HOLD_STOP_CODE'],['HOLDSTOPREASON','HOLDREASON','HOLD_STOP_REASON'],['HOLDSTOPBEGINDATE']];
    for (const keys of fields) {
        const hold = keys[0].startsWith('HOLD');
        const noteValue = hold ? '' : liveInventoryCardValue(note,...keys);
        const value = noteValue !== '' ? noteValue : liveInventoryCardValue(primary,...keys);
        for (const key of keys) result[key] = result[key.toLowerCase()] = value;
    }
    const set = (value,...keys) => { for (const key of keys) result[key] = result[key.toLowerCase()] = value; };
    set(selected.reduce((sum,item)=>sum+onHand(item),0),'PTRONHAND','ON_HAND');
    set(selected.reduce((sum,item)=>sum+review(item),0),'PTRREVIEWED','REVIEW');
    set(selected.reduce((sum,item)=>sum+available(item),0),'PTRAVAILABLE','AVAILABLE');
    set(atLocation.reduce((sum,item)=>sum+onHand(item),0),'LOC_ON_HAND');
    const summedOpenStock = rows.filter(item=>/^(F1|S1)$/.test(lot(liveInventoryCardValue(item,'LOTCODE','LOT'))))
        .reduce((sum,item)=>sum+available(item),0);
    set(liveInventoryCardValue(primary,'S_LTS','OPEN_STOCK') || summedOpenStock,'S_LTS','OPEN_STOCK');
    set(resolveLiveInventoryCardPhotoMatch(primary,note,number,options.calculateMatch),'LOC_PHOTO_MATCH','LOC_MATCH_QTY');
    return result;
}


function mergeLiveInventoryCardPair(prior, row, getPhotos) {
    const merged = {...prior};
    merged.__physicalInventoryRows = [...(prior.__physicalInventoryRows || [prior]), ...(row.__physicalInventoryRows || [row])];
    for (const [field,value] of Object.entries(row)) {
        if (value != null && String(value).trim() !== '' && (merged[field] == null || String(merged[field]).trim() === '')) merged[field] = value;
    }
    for (const keys of [['SPEC'],['AV_NOTE','AVNOTE'],['LOC_PHOTO_MATCH','LOC_MATCH_QTY'],['PHOTO_DATE'],['PIC_NOTE','PICK_NOTE'],['SALES_NOTE','COMMENTS']]) {
        const value = liveInventoryCardValue(prior,...keys) || liveInventoryCardValue(row,...keys);
        if (value === '') continue;
        for (const key of keys) merged[key] = merged[key.toLowerCase()] = value;
    }
    const photos = [...new Set([prior,row].flatMap(value => getPhotos(liveInventoryCardValue(value,'PHOTO_LINK','PHOTO_URL','PHOTOS'))))];
    if (photos.length) merged.PHOTO_LINK = merged.photo_link = merged.PHOTOS = merged.photos = photos.join(',');
    return merged;
}

function mergeLiveInventoryCardRows(rows = [], getPhotos = parsePhotoCsvValues) {
    if (rows.length && rows.every(row => !row || /^fi_\d+$/.test(String(row.DOM_ID || '')))) return rows;
    const groups = new Map();
    let mergedAny = false;
    for (const row of rows) {
        if (!row) continue;
        const tuple = ['ITEMCODE','LOCATIONCODE','LOTCODE'].map(key => String(liveInventoryCardValue(row,key)).trim().toUpperCase());
        const key = tuple.every(Boolean) ? JSON.stringify(tuple) : row;
        const prior = groups.get(key);
        if (!prior) { groups.set(key,row); continue; }
        mergedAny = true;
        groups.set(key, mergeLiveInventoryCardPair(prior, row, getPhotos));
    }
    return mergedAny ? [...groups.values()] : rows;
}

function firstDockNonEmpty(...values) {
    for (const value of values) {
        if (value !== null && value !== undefined && String(value).trim() !== '') return value;
    }
    return '';
}

function normalizeSocDockIdentifiers(item) {
    item.UNIQUE_ID = firstDockNonEmpty(item.UNIQUE_ID, item.unique_id, item.id, item.ID, '');
    item.SUSPEND = firstDockNonEmpty(item.SUSPEND, item.suspend, item.Suspend, item['Suspend'], '');
    item.SUSPENDTO = firstDockNonEmpty(
        item.SUSPENDTO,
        item.suspendto,
        item.SUSPEND_TO,
        item.suspend_to,
        item['SUSPEND-TO'],
        item['suspend-to'],
        item['SUSPEND TO'],
        item['suspend to'],
        item.SuspendTo,
        item['Suspend-To'],
        item['Suspend To'],
        ''
    );
    item.SUSPEND_TO = firstDockNonEmpty(item.SUSPEND_TO, item.SUSPENDTO, '');
    item.DOCK_NUM = firstDockNonEmpty(
        item.DOCK_NUM,
        item.dock_num,
        item.DOCK_NUMBER,
        item.dock_number,
        item.DOCKNUMBER,
        item.docknumber,
        item.DOCK_NO,
        item.dock_no,
        item.DOCKNO,
        item.dockno,
        item.DOCK,
        item.dock,
        ''
    );
    const rawDock=String(item.DOCK_NUM || '').trim();
    if (/^T[0-9]+/i.test(rawDock) && !firstDockNonEmpty(item.TRIPNUMBER,item.tripnumber,'')) item.TRIPNUMBER=rawDock;
    item.DOCK_NUM = normalizeDockViewDockKey(item.DOCK_NUM);
    item.DOCK = item.DOCK_NUM;
}

function normalizeSocDockStopAndTrip(item) {
    item.STOPNUMBER = firstDockNonEmpty(
        item.STOPNUMBER,
        item.stopnumber, item.DROP_NUMBER, item.drop_number,
        item.STOP_NUMBER,
        item.stop_number,
        item.STOPNO,
        item.stopno,
        item.STOP,
        item.stop,
        item.DROP,
        item.drop,
        ''
    );
    item.STOPNUMBER = normalizeDockViewStopKey(item.STOPNUMBER);
    item.TRIPNUMBER = firstDockNonEmpty(
        item.TRIPNUMBER,
        item.tripnumber,
        item.TRIP_NUMBER,
        item.trip_number,
        item.TRIPNO,
        item.tripno,
        item.TRIP,
        item.trip,
        ''
    );
}

function normalizeSocDockDetails(item) {
    item.SALESREPNAME = firstDockNonEmpty(item.SALESREPNAME, item.salesrepname, item.SALESREP, item.salesrep, item.SALES_REP, item.sales_rep, item.SALESREPID, item.salesrepid, 'Unknown Rep');
    item.CUSTOMERNAME = firstDockNonEmpty(item.CUSTOMERNAME, item.customername, item.CUSTOMER, item.customer, 'Unknown Customer');
    item.CONSIGNEENAME = firstDockNonEmpty(item.CONSIGNEENAME, item.consigneename, item.CONSIGNEE, item.consignee, '');
    for (const [key, aliases] of Object.entries({
        ITEMCODE:['itemcode','itemcode_canonical'], LOCATIONCODE:['locationcode','LOCATION','location'],
        COMMONNAME:['commonname','COMMON_NAME','common_name'], CONTSIZE:['contsize','printedcontainercode','containersort'],
        LOTCODE:['lotcode'], SALEYEAR:['saleyear'], SEASON:['season'], PRIORITY:['priority','PRI','pri'],
        QUANTITYORDERED:['quantityordered','QTY','qty','ORDERED_QTY','ordered_qty'],
        PLANSTART:['planstart','PLAN_START','plan_start'], AV_NOTE:['av_note'], DOCK_NOTE:['dock_note'], SALES_NOTE:['sales_note','salesnote']
    })) item[key] = firstDockNonEmpty(item[key], ...aliases.map(alias => item[alias]), '');
    item._search = [
        item.COMMONNAME,
        item.commonname,
        item.PLANT_NAME,
        item.plant_name,
        item.CUSTOMERNAME,
        item.CONSIGNEENAME,
        item.SALESREPNAME,
        item.DOCK_NUM,
        item.STOPNUMBER,
        item.TRIPNUMBER,
        item.LOCATIONCODE,
        item.locationcode,
        item.ITEMCODE,
        item.itemcode
    ].map((value) => String(value || '').trim()).filter(Boolean).join(' ').toLowerCase();
}

function normalizeSocDockRowAliases(item) {
    if (!item) return item;
    normalizeSocDockIdentifiers(item);
    normalizeSocDockStopAndTrip(item);
    normalizeSocDockDetails(item);
    return item;
}

function setSuspendQuantityAliases(row, aliases, value) {
    if (value === null || value === undefined || String(value).trim() === '') return;
    aliases.forEach(key => { row[key] = value; });
}

function applyDockSuspendQuantityAliases(row, source) {
    if (!row || typeof row !== 'object') return row;
    const sourceSnapshot = source && source.SNAPSHOT && typeof source.SNAPSHOT === 'object' ? source.SNAPSHOT : {};
    const rowSnapshot = row.SNAPSHOT && typeof row.SNAPSHOT === 'object' ? row.SNAPSHOT : {};
    // The active Suspend view owns these exact-tuple metrics. Generic
    // SOC normalization may have supplied a placeholder PTRAVAILABLE=0.
    const exactViewMetrics = source?.IS_SUSPEND_TAG === true || source?.is_suspend_tag === true;
    const setAliases = (aliases, value) => setSuspendQuantityAliases(row, aliases, value);
    applyDockSuspendPrimaryQuantities(row, source, sourceSnapshot, rowSnapshot, exactViewMetrics, setAliases);
    applyDockSuspendAvailableQuantities(row, source, sourceSnapshot, rowSnapshot, exactViewMetrics, setAliases);
    return row;
}

function applyDockSuspendPrimaryQuantities(row, source, sourceSnapshot, rowSnapshot, exactViewMetrics, setAliases) {
    setAliases(['PTRONHAND', 'ptronhand', 'PTR_ON_HAND', 'ptr_on_hand'], firstDockNonEmpty(
        exactViewMetrics ? firstDockNonEmpty(source.ON_HAND, source.on_hand) : null,
        source && source.PTRONHAND,
        source && source.ptronhand,
        source && source.PTR_ON_HAND,
        source && source.ptr_on_hand,
        source && source.EXT_PTRONHAND,
        source && source.ext_ptronhand,
        sourceSnapshot.PTRONHAND,
        sourceSnapshot.ptronhand,
        sourceSnapshot.PTR_ON_HAND,
        sourceSnapshot.ptr_on_hand,
        row.PTRONHAND,
        row.ptronhand,
        rowSnapshot.PTRONHAND,
        rowSnapshot.ptronhand,
        ''
    ));
    setAliases(['PTRREVIEWED', 'ptrreviewed', 'PTR_REVIEWED', 'ptr_reviewed', 'PTRREVIEW', 'ptrreview', 'REVIEWED', 'reviewed'], firstDockNonEmpty(
        exactViewMetrics ? firstDockNonEmpty(source.REVIEW, source.review) : null,
        source && source.PTRREVIEWED,
        source && source.ptrreviewed,
        source && source.PTR_REVIEWED,
        source && source.ptr_reviewed,
        source && source.PTRREVIEW,
        source && source.ptrreview,
        source && source.REVIEWED,
        source && source.reviewed,
        sourceSnapshot.PTRREVIEWED,
        sourceSnapshot.ptrreviewed,
        sourceSnapshot.PTR_REVIEWED,
        sourceSnapshot.ptr_reviewed,
        sourceSnapshot.PTRREVIEW,
        sourceSnapshot.ptrreview,
        row.PTRREVIEWED,
        row.ptrreviewed,
        rowSnapshot.PTRREVIEWED,
        rowSnapshot.ptrreviewed,
        ''
    ));
}

function applyDockSuspendAvailableQuantities(row, source, sourceSnapshot, rowSnapshot, exactViewMetrics, setAliases) {
    setAliases(['PTRAVAILABLE', 'ptravailable', 'PRTAVAILABLE', 'prtavailable', 'LOC_AVAIL', 'loc_avail', 'LOC_AVAILABLE', 'loc_available', 'LOCAVA', 'locava', 'AVAILABLE', 'available'], firstDockNonEmpty(
        exactViewMetrics ? firstDockNonEmpty(source.AVAILABLE, source.available) : null,
        source && source.PTRAVAILABLE,
        source && source.ptravailable,
        source && source.PRTAVAILABLE,
        source && source.prtavailable,
        source && source.LOC_AVAIL,
        source && source.loc_avail,
        source && source.LOC_AVAILABLE,
        source && source.loc_available,
        source && source.LOCAVA,
        source && source.locava,
        source && source.AVAILABLE,
        source && source.available,
        sourceSnapshot.PTRAVAILABLE,
        sourceSnapshot.ptravailable,
        row.PTRAVAILABLE,
        row.ptravailable,
        rowSnapshot.PTRAVAILABLE,
        rowSnapshot.ptravailable,
        ''
    ));
    setAliases(['S_LTS', 's_lts'], firstDockNonEmpty(
        exactViewMetrics ? firstDockNonEmpty(source.OPEN_STOCK, source.open_stock) : null,
        source && source.S_LTS,
        source && source.s_lts,
        sourceSnapshot.S_LTS,
        sourceSnapshot.s_lts,
        row.S_LTS,
        row.s_lts,
        rowSnapshot.S_LTS,
        rowSnapshot.s_lts,
        ''
    ));
}

function getDefaultDockTeamInfo() {
    return { checker: '', inspector: '', mistake: '', status: 'Loading', tripnumber: '', dockNum: '', revision: 0, updatedAt: '' };
}

function normalizeDockTeamTripKey(tripNumber = '') {
    return String(tripNumber || '').trim().toUpperCase();
}

function formatDockViewDockLabel(dockNum = '') {
    const normalized = normalizeDockViewDockKey(dockNum);
    if (!normalized || normalized === 'Unassigned') return normalized || 'Unassigned';
    return /^dock\b/i.test(normalized) ? normalized : `Dock ${normalized}`;
}

function getActiveSuspendDockRows(items = []) {
    const groups = new Set(), orders = new Set();
    return items.filter(row => {
        const state = String(row.suspend_candidate_state || row.SUSPEND_CANDIDATE_STATE || '').toLowerCase();
        const cancellation = state === 'canceled' && !!(row.cancel_reason || row.CANCEL_REASON);
        if (!cancellation && ['replaced', 'denied', 'canceled'].includes(state)) return false;
        const order = getDockOrderBusinessKey(row);
        if (order && orders.has(order)) return false;
        if (order) orders.add(order);
        const group = row.suspend_candidate_group || row.SUSPEND_CANDIDATE_GROUP;
        if (!group || state === 'approved') return true;
        if (groups.has(group)) return false;
        groups.add(group); return true;
    });
}
