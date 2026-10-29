(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.AgMetricInventoryList = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    // V1 positions are a wire contract. Never reorder/extend this array without
    // changing the version; canonical cache identity must include that version.
    const version = 'master-list-v3';
    const columns = Object.freeze([
        'a_lts', 'ai_lts', 'app_tab_assignment', 'assignedto', 'av_note',
        'av_rule_av_note_updated_at', 'av_rule_bundle_updated_at', 'av_rule_caliper_updated_at', 'av_rule_holdstop_snapshot', 'av_rule_last_clear_reason',
        'av_rule_last_cleared_at', 'av_rule_match_updated_at', 'av_rule_photo_updated_at', 'av_rule_priority_snapshot', 'av_rule_spec_updated_at',
        'baseline_on_hand', 'bay', 'blockalpha', 'blocknumber', 'botanicalname', 'brand',
        'bypassloc', 'caliper', 'commonname', 'consigneename', 'containersort',
        'contsize', 'customername', 'date_completed', 'desigcust', 'desigitem',
        'desigloc', 'dock', 'dock_caliper', 'dock_note', 'dock_num',
        'dock_photo_link', 'dock_photo_name', 'dock_spec', 'end_cap_folder', 'end_cap_level',
        'end_cap_qty', 'equiv_unit', 'eval_task_assigned_at', 'eval_task_assigned_by', 'eval_task_completed_at',
        'eval_task_completed_by', 'eval_task_hold_action', 'eval_task_hold_code', 'eval_task_hold_reason', 'eval_task_instructions',
        'eval_task_moved_up_qty', 'eval_task_recount_qty', 'eval_task_result_note', 'eval_task_status', 'eval_task_type',
        'ext_ptronhand', 'field_tag_color', 'fieldtagcolor', 'filename', 'flyer_assigned',
        'flyer_av_note', 'flyer_caliper', 'flyer_cat', 'flyer_completed', 'flyer_initial_ptr',
        'flyer_inst', 'flyer_loc_match_qty', 'flyer_match', 'flyer_notes', 'flyer_photo_link',
        'flyer_photo_name', 'flyer_pick', 'flyer_spec', 'flyer_title', 'fnsalesnote',
        'genusname', 'grower', 'hold_release_approved_at', 'hold_release_approved_by', 'hold_release_approved_by_display',
        'hold_release_approved_holdstopbegindate', 'holdstopbegindate', 'holdstopcode', 'holdstopenddate', 'holdstopreason',
        'hsreasonbegin', 'hz', 'initial_photo_match_qty', 'initial_ptr', 'insurancegroup', 'intercopo',
        'inventorynote', 'itemcode', 'itemspec', 'largeptrqty', 'last_updated',
        'listprice', 'loc_match_pct', 'loc_match_qty', 'loc_photo_match', 'locationcode', 'locationnote', 'locationnotedate',
        'locationptn1', 'locationptn2', 'lochold', 'lotcode', 'match',
        'maxorderquantity', 'mcstatus', 'ncr_approval_message', 'ncr_approval_type', 'ncr_requested_at',
        'ncr_requested_by_display', 'ncr_requested_by_email', 'ncr_requested_by_username', 'oversellpercentage', 'photo_date',
        'photo_link', 'photo_name', 'pic_note', 'picknote', 'planstart', 'plantgroupcode',
        'printedcontainercode', 'priority', 'prisetby', 'priupdated', 'ptravailable',
        'ptronhand', 'ptrreviewed', 'pullerresponsibility', 'pulltagnote1', 'pulltagnote2',
        'qa_code', 'qualitycode', 'reversecommon', 's_lts', 'sales_note',
        'salesnote', 'salesnote_1', 'salesnotebegindate', 'salesrepid', 'salesrepname',
        'saleyear', 'season', 'season_available', 'season_demand', 'season_oh',
        'season_supply', 'si_lts', 'sortnamevariety', 'source', 'spec',
        'specialpuller', 'stopnumber', 'suspend', 'suspend_to', 'suspendto',
        'tripnumber', 'unique_id', 'varietycode', 'warehousei', 'warehouseid',
        'warehousename',
    ]);
    // The audited full-row schema is a separate equality contract, not a list
    // selection. Keep full-only fields available for exact acknowledgement
    // comparison without changing V1 aliases or inventing values in list rows.
    const physicalColumns = Object.freeze([
        ...columns,
        'altshipcomment', 'avg_price_eunit_shipped', 'carrier', 'combinedprice', 'concat',
        'consigneeaddress_1', 'consigneeaddress_2', 'consigneecity', 'consigneeidentityid', 'consigneestate',
        'consigneezip', 'customeridentityid', 'customersku', 'descriptorcode', 'dropweight',
        'equiv_uom', 'ext_eunit_shipped', 'ext_unit_merch_shipped', 'extunitprice', 'formattedupc',
        'freightrateperitem', 'generalloadinstr', 'handlingchargeperitem', 'hardinesszone', 'hlloadinstructions',
        'idgroup', 'internalinvnote', 'invoicedate', 'isreserve', 'landed',
        'nationalaccount', 'ncloadinstructions', 'okloadinstructions', 'ordertotal', 'purchaseordernumber',
        'quantityordered', 'quantityshipped', 'requestdate', 'requestdateweek', 'retailprice',
        'shiptotelephone_1', 'si_available', 'stagename', 'step', 'tagcode',
        'tagdeptnote', 'taggingchargeperitem', 'transactionnumber', 'txloadinstructions', 'unitprice',
        'wingdingunits', 'zonecode',
    ].sort());
    const csvNumericColumns = new Set([
        'flyer_match', 'flyer_loc_match_qty', 'flyer_initial_ptr',
        'eval_task_recount_qty', 'eval_task_moved_up_qty', 'loc_match_pct',
        'baseline_on_hand', 'initial_photo_match_qty', 'loc_photo_match',
    ]);
    const aliases = Object.freeze(columns.map((column, index) => 'f' + index));
    const select = columns.map((column, index) => aliases[index] + ':' + column).join(',');
    const metadataKey = '__inventoryCompleteness';
    const numericColumns = new Set([
        'flyer_match', 'flyer_loc_match_qty', 'flyer_initial_ptr',
        'eval_task_recount_qty', 'eval_task_moved_up_qty'
    ]);
    const csvTimestampColumns = new Set([
        'last_updated', 'date_completed', 'flyer_completed', 'ncr_requested_at',
        'hold_release_approved_at', 'eval_task_assigned_at', 'eval_task_completed_at',
        'av_rule_bundle_updated_at', 'av_rule_av_note_updated_at', 'av_rule_spec_updated_at',
        'av_rule_match_updated_at', 'av_rule_caliper_updated_at', 'av_rule_photo_updated_at',
        'av_rule_last_cleared_at', 'photo_date',
    ]);
    const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
    function invalid(message) {
        const error = new Error('Invalid inventory list contract: ' + message);
        error.code = 'INVENTORY_LIST_CONTRACT_INVALID';
        return error;
    }
    function record(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value)
            && Object.prototype.toString.call(value) === '[object Object]';
    }
    function buildQuery() {
        return 'select=' + select + '&order=unique_id.asc';
    }
    function decodeRow(row) {
        if (!record(row) || Object.keys(row).length !== columns.length) throw invalid('unexpected row shape');
        const decoded = {};
        columns.forEach((column, index) => {
            const alias = aliases[index];
            if (!hasOwn(row, alias)) throw invalid('missing ' + alias);
            const value = row[alias];
            if (value !== null && (numericColumns.has(column)
                ? typeof value !== 'number' || !Number.isFinite(value)
                : typeof value !== 'string')) throw invalid('invalid value type for ' + alias);
            decoded[column] = value;
        });
        if (!decoded.unique_id || !decoded.unique_id.trim()) throw invalid('missing row identity');
        return decoded;
    }
    function decodeRows(rows) {
        if (!Array.isArray(rows)) throw invalid('expected a row array');
        const seen = new Set();
        return Array.from(rows, (row) => {
            const decoded = decodeRow(row);
            if (seen.has(decoded.unique_id)) throw invalid('duplicate row identity');
            seen.add(decoded.unique_id);
            return decoded;
        });
    }
    function decodeCsvRows(text, expectedColumns) {
        if (typeof text !== 'string') throw invalid('expected CSV text');
        if (!Array.isArray(expectedColumns) || !expectedColumns.length
            || expectedColumns.some((column) => typeof column !== 'string' || !physicalColumns.includes(column))
            || new Set(expectedColumns).size !== expectedColumns.length) throw invalid('invalid expected CSV columns');
        const rows = [];
        let row = [], value = '', inQuotes = false, afterQuote = false, fieldQuoted = false;
        const pushField = () => {
            row.push({ value, quoted: fieldQuoted });
            value = '';
            fieldQuoted = false;
            afterQuote = false;
        };
        const pushRow = () => {
            pushField();
            rows.push(row);
            row = [];
        };
        for (let index = 0; index < text.length; index += 1) {
            const character = text[index];
            if (inQuotes) {
                if (character === '"') {
                    if (text[index + 1] === '"') { value += '"'; index += 1; }
                    else { inQuotes = false; afterQuote = true; }
                } else value += character;
                continue;
            }
            if (afterQuote) {
                if (character === ',') pushField();
                else if (character === '\n') pushRow();
                else if (character === '\r' && text[index + 1] === '\n') { index += 1; pushRow(); }
                else throw invalid('unexpected content after quoted CSV field');
                continue;
            }
            if (character === '"') {
                if (value !== '') throw invalid('unexpected quote in unquoted CSV field');
                inQuotes = true;
                fieldQuoted = true;
            } else if (character === ',') pushField();
            else if (character === '\n') pushRow();
            else if (character === '\r' && text[index + 1] === '\n') { index += 1; pushRow(); }
            else value += character;
        }
        if (inQuotes) throw invalid('unterminated quoted CSV field');
        if (afterQuote || value !== '' || row.length || fieldQuoted) pushRow();
        if (!rows.length) throw invalid('missing CSV header');
        const header = rows.shift().map((field, index) => index === 0 ? field.value.replace(/^\uFEFF/, '') : field.value);
        if (header.length !== expectedColumns.length || header.some((column, index) => column !== expectedColumns[index])) {
            throw invalid('unexpected CSV header');
        }
        const timestamp = (column, field) => {
            const raw = field.value;
            if (!raw && !field.quoted) return null;
            if (!csvTimestampColumns.has(column)) return raw;
            const match = raw.match(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)(\.\d+)?([+-]\d\d(?::?\d\d)?)$/);
            if (match) {
                const zone = match[4].includes(':') ? match[4] : `${match[4]}:00`;
                return `${match[1]}T${match[2]}${match[3] || ''}${zone}`;
            }
            const iso = raw.match(/^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)(\.\d+)?(Z|[+-]\d\d:\d\d)$/);
            if (iso) return `${iso[1]}T${iso[2]}${iso[3] || ''}${iso[4]}`;
            throw invalid(`invalid CSV timestamp for ${column}`);
        };
        const seenIds = new Set();
        return rows.map((fields) => {
            if (fields.length !== expectedColumns.length) throw invalid('unexpected CSV row width');
            const decoded = {};
            expectedColumns.forEach((column, index) => {
                const field = fields[index];
                if (!field.value && !field.quoted) { decoded[column] = null; return; }
                if (csvNumericColumns.has(column)) {
                    if (field.value === '') throw invalid(`invalid CSV number for ${column}`);
                    const value = Number(field.value);
                    if (!Number.isFinite(value)) throw invalid(`invalid CSV number for ${column}`);
                    decoded[column] = value;
                    return;
                }
                decoded[column] = timestamp(column, field);
            });
            if (expectedColumns.includes('unique_id')) {
                if (!decoded.unique_id || !decoded.unique_id.trim()) throw invalid('missing row identity');
                if (seenIds.has(decoded.unique_id)) throw invalid('duplicate row identity');
                seenIds.add(decoded.unique_id);
            }
            return decoded;
        });
    }
    function tag(row, metadata) {
        if (!record(row)) throw invalid('expected a canonical row');
        Object.defineProperty(row, metadataKey, { value: Object.freeze(metadata), configurable: true, enumerable: false });
        return row;
    }
    function markListRow(row) {
        return tag(row, { version, kind: 'list' });
    }
    function detailContext(context) {
        if (!record(context) || !['scope', 'permissionVersion', 'revision', 'uniqueId'].every((key) => (
            typeof context[key] === 'string' && context[key].trim()
        )) || !/^\d+$/.test(context.revision)) throw invalid('incomplete detail verification context');
        return { scope: context.scope, permissionVersion: context.permissionVersion, revision: context.revision, uniqueId: context.uniqueId };
    }
    // This records a caller's completed exact-row verification. It does not
    // perform authentication, fetch a row, or establish freshness by itself.
    function markDetailRow(row, context) {
        const fence = detailContext(context);
        const identity = record(row) && (row.unique_id || row.UNIQUE_ID);
        if (identity !== fence.uniqueId) throw invalid('detail identity mismatch');
        return tag(row, { version, kind: 'detail', ...fence });
    }
    function getCompleteness(row) {
        return record(row) && hasOwn(row, metadataKey) ? row[metadataKey] : null;
    }
    function isListRow(row) {
        const metadata = getCompleteness(row);
        return metadata?.version === version && metadata.kind === 'list';
    }
    function isDetailRow(row, context) {
        const metadata = getCompleteness(row);
        if (!metadata || metadata.version !== version || metadata.kind !== 'detail') return false;
        let fence;
        try { fence = detailContext(context); } catch (_) { return false; }
        return (row.unique_id || row.UNIQUE_ID) === fence.uniqueId
            && Object.keys(fence).every((key) => metadata[key] === fence[key]);
    }
    return Object.freeze({ version, columns, physicalColumns, aliases, metadataKey, buildQuery, decodeRow, decodeRows, decodeCsvRows,
        markListRow, markDetailRow, getCompleteness, isListRow, isDetailRow });
});
