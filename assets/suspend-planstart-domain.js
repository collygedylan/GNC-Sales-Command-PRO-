function dockPlanstartAlias(row, aliases) {
    if (!row || typeof row !== 'object') return '';
    const snapshot = row.SNAPSHOT && typeof row.SNAPSHOT === 'object' ? row.SNAPSHOT : null;
    for (const key of aliases) {
        if (row[key] !== null && row[key] !== undefined && String(row[key]).trim() !== '') return row[key];
        if (snapshot && snapshot[key] !== null && snapshot[key] !== undefined && String(snapshot[key]).trim() !== '') return snapshot[key];
    }
    return '';
}

function dockPlanstartIdentity(row) {
    return [row?.DOCK || row?.dock, row?.STOPNUMBER || row?.stopnumber,
        String(row?.ITEMCODE || row?.itemcode || '').replace(/\.+$/, '').replace(/\.1$/, ''),
        row?.CONSIGNEEIDENTITYID || row?.consigneeidentityid || row?.CONSIGNEENAME || row?.consigneename || row?.CONSIGNEE || row?.consignee]
        .map(value => String(value || '').trim().toUpperCase()).join('|');
}

function buildDockPlanstartIndex(rows, aliases, items = []) {
    const sourceRows = Array.isArray(rows) ? rows : [];
    const sourceObjects = new Set(sourceRows);
    if (items.some(item => sourceObjects.has(item))) return null;
    const index = new Map();
    for (const row of sourceRows) {
        const value = dockPlanstartAlias(row, aliases);
        if (!value) continue;
        const key = dockPlanstartIdentity(row);
        if (!index.has(key)) index.set(key, new Set());
        index.get(key).add(value);
    }
    return index;
}

function resolveDockPlanstartValue(item, source, rows, aliases, index = null) {
    const sourceValue = dockPlanstartAlias(source, aliases);
    const itemValue = dockPlanstartAlias(item, aliases);
    if (sourceValue !== '') return sourceValue;
    if (itemValue !== '') return itemValue;
    const dates = index ? index.get(dockPlanstartIdentity(item)) || new Set()
        : new Set((Array.isArray(rows) ? rows : []).filter(row => dockPlanstartIdentity(row) === dockPlanstartIdentity(item))
            .map(row => dockPlanstartAlias(row, aliases)).filter(Boolean));
    return dates.size === 1 ? dates.values().next().value : '';
}
