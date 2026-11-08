import { firstDockNonEmpty } from './dock-order-domain.js';

export function normalizeDockIssueSourceUniqueId(uniqueId = '') {
    return String(uniqueId || '').trim();
}

export function normalizeDockIssueState(state = '') {
    const normalized = String(state || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (normalized === 'resolved') return 'resolved';
    if (['drop_off', 'dropoff', 'drop_off_queue'].includes(normalized)) return 'drop_off';
    if (['cant_resolve', 'cannot_resolve', 'dismissed', 'not_resolved'].includes(normalized)) return 'cant_resolve';
    return 'open';
}

export function buildDockIssueAllocationUniqueId(issueSourceUniqueId = '', altMasterUniqueId = '') {
    const sourceUid = normalizeDockIssueSourceUniqueId(issueSourceUniqueId);
    const masterUid = String(altMasterUniqueId || '').trim();
    if (!sourceUid || !masterUid) return '';
    return `${sourceUid}__ALT__${masterUid}`;
}

export function normalizeDockIssueMatchValue(value = '') {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function buildDockIssueCommonSizeKey(itemOrCommonName = null, explicitContSize = '') {
    if (itemOrCommonName && typeof itemOrCommonName === 'object') {
        return [normalizeDockIssueMatchValue(itemOrCommonName.COMMONNAME), normalizeDockIssueMatchValue(itemOrCommonName.CONTSIZE)].join('||');
    }
    return [normalizeDockIssueMatchValue(itemOrCommonName), normalizeDockIssueMatchValue(explicitContSize)].join('||');
}

export function getDockStopOrDropValue(source = null) {
    if (!source || typeof source !== 'object') return '';
    return firstDockNonEmpty(
        source.STOPNUMBER,
        source.stopNumber,
        source.stop_number,
        source.STOP_NUMBER,
        source.stopnumber,
        source.DROPNUMBER,
        source.dropNumber,
        source.drop_number,
        source.DROP_NUMBER,
        source.dropnumber,
        source.DROP,
        source.drop,
        ''
    );
}

export function buildDockIssueSourceMatchKey(source = null) {
    if (!source || typeof source !== 'object') return '';
    const parts = [
        firstDockNonEmpty(source.DOCK_NUM, source.dockNum, source.dock_num, source.DOCK, source.dock, ''),
        getDockStopOrDropValue(source),
        firstDockNonEmpty(source.CUSTOMERNAME, source.sourceCustomerName, source.source_customername, source.CUSTOMER, ''),
        firstDockNonEmpty(source.CONSIGNEENAME, source.sourceConsigneeName, source.source_consigneename, source.CONSIGNEE, ''),
        firstDockNonEmpty(source.SALESREPNAME, source.sourceSalesRep, source.source_salesrep, source.SALESREP, source.SALES_REP, ''),
        firstDockNonEmpty(source.ITEMCODE, source.sourceItemCode, source.source_itemcode, ''),
        firstDockNonEmpty(source.CONTSIZE, source.sourceContSize, source.source_contsize, ''),
        firstDockNonEmpty(source.LOCATIONCODE, source.sourceLocationCode, source.source_locationcode, ''),
        firstDockNonEmpty(source.LOTCODE, source.sourceLotCode, source.source_lotcode, '')
    ].map((value) => normalizeDockIssueMatchValue(value));
    return parts.some(Boolean) ? parts.join('||') : '';
}

export function stampDockIssueSourceIdentity(item = null, options = {}) {
    if (!item || typeof item !== 'object') return item;
    const opts = options || {};
    const sourceUid = normalizeDockIssueSourceUniqueId(firstDockNonEmpty(
        opts.sourceUid,
        item.DOCK_ISSUE_SOURCE_UID,
        item.ISSUE_SOURCE_UNIQUE_ID,
        item.issue_source_unique_id,
        item.UNIQUE_ID,
        item.unique_id,
        ''
    ));
    item.DOCK_ISSUE_SOURCE_UID = sourceUid;
    item.DOCK_ISSUE_SOURCE_MATCH_KEY = String(firstDockNonEmpty(
        opts.sourceMatchKey,
        item.DOCK_ISSUE_SOURCE_MATCH_KEY,
        buildDockIssueSourceMatchKey(item),
        ''
    )).trim();
    return item;
}

export function buildDockDisplaySearchText(item = null) {
    if (!item) return '';
    return [
        firstDockNonEmpty(item.COMMONNAME, item['PLANT_NAME'], ''),
        firstDockNonEmpty(item.CONTSIZE, ''),
        firstDockNonEmpty(item.CUSTOMERNAME, item.CUSTOMER, ''),
        firstDockNonEmpty(item.CONSIGNEENAME, item.CONSIGNEE, ''),
        firstDockNonEmpty(item.SALESREPNAME, item.SALESREP, item.SALES_REP, ''),
        firstDockNonEmpty(item.GENUSNAME, item.genusname, item.GENUS_NAME, item.genus_name, item.GENUS, item.genus, ''),
        getDockStopOrDropValue(item),
        firstDockNonEmpty(item.TRIPNUMBER, ''),
        firstDockNonEmpty(item.DOCK_NUM, item.DOCK, ''),
        firstDockNonEmpty(item.LOCATIONCODE, ''),
        firstDockNonEmpty(item.LOTCODE, ''),
        firstDockNonEmpty(item.ITEMCODE, ''),
        firstDockNonEmpty(item.DOCK_NOTE, item.DOCK_ISSUE_NOTE, '')
    ].map((value) => String(value || '').trim()).filter(Boolean).join(' ').toLowerCase();
}

export function getDockIssueQueueSearchText(issue = null) {
    if (!issue) return '';
    return [
        firstDockNonEmpty(issue.sourceCommonName, issue.sourceRow && issue.sourceRow.COMMONNAME, ''),
        firstDockNonEmpty(issue.sourceContSize, issue.sourceRow && issue.sourceRow.CONTSIZE, ''),
        firstDockNonEmpty(issue.dockNum, issue.sourceRow && issue.sourceRow.DOCK_NUM, ''),
        firstDockNonEmpty(issue.stopNumber, getDockStopOrDropValue(issue.sourceRow), ''),
        firstDockNonEmpty(issue.sourceLocationCode, issue.sourceRow && issue.sourceRow.LOCATIONCODE, ''),
        firstDockNonEmpty(issue.sourceItemCode, issue.sourceRow && issue.sourceRow.ITEMCODE, ''),
        firstDockNonEmpty(issue.sourceLotCode, issue.sourceRow && issue.sourceRow.LOTCODE, ''),
        firstDockNonEmpty(issue.sourceCustomerName, issue.sourceRow && issue.sourceRow.CUSTOMERNAME, ''),
        firstDockNonEmpty(issue.sourceConsigneeName, issue.sourceRow && issue.sourceRow.CONSIGNEENAME, ''),
        firstDockNonEmpty(issue.sourceSalesRep, issue.sourceRow && issue.sourceRow.SALESREPNAME, ''),
        firstDockNonEmpty(issue.issueNote, '')
    ].map((value) => String(value || '').trim()).filter(Boolean).join(' ').toLowerCase();
}

export function getDockOrderedQtyRaw(item = null) {
    if (!item || typeof item !== 'object') return '';
    const qtyKeys = [
        'ORDER_QTY', 'order_qty', 'ORDERED_QTY', 'ordered_qty', 'ORDERQTY', 'orderqty',
        'REQ_QTY', 'req_qty', 'REQUEST_QTY', 'request_qty',
        'QTY', 'qty', 'QUANTITY', 'quantity',
        'QUANTITYORDERED', 'quantityordered', 'QUANTITY_ORDERED', 'quantity_ordered',
        'QTY_ORDERED', 'qty_ordered', 'CUSTOMER_ORDER_QTY', 'customer_order_qty',
        'CUSTOMERQTY', 'customerqty', 'CUST_QTY', 'cust_qty',
        'DOCK_ORDER_QTY', 'dock_order_qty', 'DOCK_ORDERED_QTY', 'dock_ordered_qty',
        'DOCK_QTY', 'dock_qty'
    ];
    for (const key of qtyKeys) {
        if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
        const value = item[key];
        const text = String(value == null ? '' : value).trim();
        if (text !== '') return value;
    }
    return '';
}

