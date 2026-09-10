(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.AgMetricInventoryList = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    // V1 positions are a wire contract. Never reorder/extend this array without
    // changing the version; canonical cache identity must include that version.
    const version = 'master-list-v1';
    const columns = Object.freeze([
        'a_lts', 'ai_lts', 'app_tab_assignment', 'assignedto', 'av_note',
        'av_rule_av_note_updated_at', 'av_rule_bundle_updated_at', 'av_rule_caliper_updated_at', 'av_rule_holdstop_snapshot', 'av_rule_last_clear_reason',
        'av_rule_last_cleared_at', 'av_rule_match_updated_at', 'av_rule_photo_updated_at', 'av_rule_priority_snapshot', 'av_rule_spec_updated_at',
        'bay', 'blockalpha', 'blocknumber', 'botanicalname', 'brand',
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
        'hsreasonbegin', 'hz', 'initial_ptr', 'insurancegroup', 'intercopo',
        'inventorynote', 'itemcode', 'itemspec', 'largeptrqty', 'last_updated',
        'listprice', 'loc_match_qty', 'locationcode', 'locationnote', 'locationnotedate',
        'locationptn1', 'locationptn2', 'lochold', 'lotcode', 'match',
        'maxorderquantity', 'mcstatus', 'ncr_approval_message', 'ncr_approval_type', 'ncr_requested_at',
        'ncr_requested_by_display', 'ncr_requested_by_email', 'ncr_requested_by_username', 'oversellpercentage', 'photo_link',
        'photo_name', 'pic_note', 'picknote', 'planstart', 'plantgroupcode',
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
    const numericColumns = new Set([
        'flyer_match', 'flyer_loc_match_qty', 'flyer_initial_ptr',
        'eval_task_recount_qty', 'eval_task_moved_up_qty'
    ]);
    const aliases = Object.freeze(columns.map((column, index) => 'f' + index));
    const select = columns.map((column, index) => aliases[index] + ':' + column).join(',');
    const metadataKey = '__inventoryCompleteness';
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
    return Object.freeze({ version, columns, physicalColumns, aliases, metadataKey, buildQuery, decodeRow, decodeRows,
        markListRow, markDetailRow, getCompleteness, isListRow, isDetailRow });
});
