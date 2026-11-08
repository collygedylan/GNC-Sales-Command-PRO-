export function calculateLiveLocPhotoMatch(row = {}, note = null) {
    const number = (...values) => {
        for (const value of values) {
            if (value == null || String(value).trim() === '') continue;
            const parsed = Number(String(value).replace(/,/g, '').replace(/%$/, ''));
            if (Number.isFinite(parsed)) return Math.max(0, parsed);
        }
        return null;
    };
    const preferredOnHand = number(row.PTRONHAND, row.ptronhand, row.ON_HAND, row.on_hand, row.onhand, row.ONHAND, row.ptr_onhand, row.loc_on_hand);
    if (preferredOnHand === 0) return 0;
    const currentOnHand = [row.onhand, row.ONHAND, row.PTRONHAND, row.ptronhand, row.ptr_onhand, row.ON_HAND, row.on_hand, row.loc_on_hand].map(value => number(value)).find(value => value > 0) ?? 0;
    const available = number(row.available, row.AVAILABLE, row.PTRAVAILABLE, row.ptravailable, row.ptr_available, row.LOC_AVAILABLE, row.loc_available) ?? currentOnHand;
    const pct = number(note?.match_pct, note?.loc_match_pct, note?.LOC_MATCH_PCT, note?.MATCH_PCT, note?.MATCH, note?.match, row.LOC_MATCH_PCT, row.loc_match_pct, row.MATCH_PCT, row.match_pct, row.MATCH, row.match) ?? 0;
    const baseline = number(note?.eval_baseline_available, note?.EVAL_BASELINE_AVAILABLE, row.eval_baseline_available, row.EVAL_BASELINE_AVAILABLE) ?? Math.max(currentOnHand, available);
    const initial = number(note?.initial_loc_photo_match, note?.INITIAL_LOC_PHOTO_MATCH, row.initial_loc_photo_match, row.INITIAL_LOC_PHOTO_MATCH)
        ?? number(note?.initial_photo_match_qty, note?.INITIAL_PHOTO_MATCH_QTY, row.INITIAL_PHOTO_MATCH_QTY, row.initial_photo_match_qty)
        ?? number(...[note?.LOC_PHOTO_MATCH,note?.loc_photo_match,note?.LOC_MATCH_QTY,note?.loc_match_qty,row.LOC_PHOTO_MATCH,row.loc_photo_match,row.LOC_MATCH_QTY,row.loc_match_qty].filter(value => Number(value)>0))
        ?? Math.round(Math.min(100, pct) * baseline / 100);
    return Math.max(0, Math.min(available, initial - Math.max(0, baseline - available)));
}

