(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.AgMetricDriveDemandDetail = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const text = (value) => value == null ? '' : String(value).trim();
    function field(row, ...names) {
        for (const name of names) {
            for (const key of [name, name.toUpperCase()]) {
                if (row && text(row[key]) !== '') return row[key];
            }
        }
        return null;
    }
    const season = (value) => /^(?:F1|S1|U[123]|X|Y|Z)$/.test(text(value).toUpperCase()) ? text(value).toUpperCase() : null;
    function normalizeYear(value) {
        const input = text(value);
        if (/^\d{2}$/.test(input)) return 2000 + Number(input);
        return /^20\d{2}$/.test(input) ? Number(input) : null;
    }
    function parseLot(value) {
        const match = text(value).toUpperCase().match(/^(\d{2}|20\d{2})\s*\.\s*(F1|S1|U[123]|X|Y|Z)$/);
        return match ? { season: match[2], salesyear: normalizeYear(match[1]) } : null;
    }
    function itemKey(item) {
        const itemcode = text(field(item, 'itemcode')).toUpperCase();
        const lot = parseLot(field(item, 'lotcode', 'lot'));
        const explicitSeason = field(item, 'season');
        const explicitYear = field(item, 'saleyear', 'salesyear', 'sales_year');
        const itemSeason = explicitSeason === null ? lot?.season : season(explicitSeason);
        const salesyear = explicitYear === null ? lot?.salesyear : normalizeYear(explicitYear);
        return itemcode && itemSeason && salesyear ? { itemcode, season: itemSeason, salesyear } : null;
    }
    function selectRows(rows, item, kind = 'reserves') {
        const key = itemKey(item);
        const result = { rows: [], invalidCount: 0 };
        if (!key) return result;
        for (const row of rows || []) {
            if (text(field(row, 'itemcode')).toUpperCase() !== key.itemcode) continue;
            if (kind === 'open-orders' && text(field(row, 'invoicedate', 'invoice_date'))) continue;
            // Imported demand has no sales year. A valid source lot is mandatory.
            const lot = parseLot(field(row, 'lotcode', 'lot'));
            if (!lot) { result.invalidCount += 1; continue; }
            if (lot.season === key.season && lot.salesyear === key.salesyear) result.rows.push(row);
        }
        return result;
    }
    function buildQuery(item) {
        const key = itemKey(item);
        if (!key) throw new Error('Itemcode, season, and sales year need review.');
        // Fetch case/outer-whitespace variants; selectRows enforces exact identity.
        // A literal PostgREST '*' is widened here, never in the final match.
        const pattern = '%' + key.itemcode.replace(/[\\%_]/g, '\\$&').replace(/\*/g, '%') + '%';
        return `select=*&itemcode=ilike.${encodeURIComponent(pattern)}&order=unique_id.asc`;
    }
    return { normalizeYear, parseLot, itemKey, selectRows, buildQuery, field };
});
