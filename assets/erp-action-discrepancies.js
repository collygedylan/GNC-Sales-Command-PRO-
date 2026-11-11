let lastActionDiscrepancyRead = null;

function createActionDiscrepancySource(identity) {
    const current = () => identity === getSupabaseReadIdentityScope() && canAccessView('managers');
    if (lastActionDiscrepancyRead?.identity !== identity) lastActionDiscrepancyRead = null;
    return {
        current,
        cached: () => current() && lastActionDiscrepancyRead?.rows || [],
        remember(rows) { if (current()) lastActionDiscrepancyRead = {identity, rows}; },
        async request(operation, payload, signal) {
            if (!current()) throw Error('Reopen the table with the current account.');
            const response = await postAppFunctionJson(APP_API_FUNCTION_URL, {
                action:'manager_table_management', table:'action-discrepancy', operation, payload
            }, {signal, timeoutMs:30000, label:'Action Discrepancy'});
            if (!current() || !response?.ok || !response.data) throw Error(response?.message || 'Action Discrepancy request failed.');
            return response.data;
        }
    };
}

async function readActionDiscrepancyRows(source, signal, showFirstPage) {
    let cursor;
    const rows = [];
    do {
        const payload = cursor === undefined ? {limit:100} : {limit:100, before_id:cursor};
        const page = await source.request('read', payload, signal);
        if (signal.aborted || !source.current()) throw Error('Table or account changed.');
        if (!Array.isArray(page.rows) || page.rows.length > payload.limit) throw Error('Invalid discrepancy page.');
        for (const row of page.rows) {
            if (!Number.isSafeInteger(row.id) || row.id <= 0 || row.id >= (rows.at(-1)?.id ?? Infinity)) {
                throw Error('Invalid discrepancy row order.');
            }
            rows.push(row);
        }
        if (cursor === undefined && page.next_before_id !== null) showFirstPage(page.rows);
        cursor = page.next_before_id;
        if (cursor !== null && (!page.rows.length || cursor !== page.rows.at(-1).id)) throw Error('Invalid discrepancy cursor.');
    } while (cursor !== null);
    source.remember(rows);
    return rows;
}
