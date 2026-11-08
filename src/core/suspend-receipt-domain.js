export function suspendTagReceiptMatchesSource(operation, payload, result) {
    if (!['save', 'complete', 'close'].includes(operation)) return true;
    const sourceUid = String(payload?.sourceUid || '').trim();
    const receiptUid = String(result?.row?.unique_id || '');
    if (!sourceUid || receiptUid !== sourceUid) return false;
    if (operation === 'complete' && !Number.isFinite(Date.parse(result.row.date_completed))) return false;
    return true;
}
