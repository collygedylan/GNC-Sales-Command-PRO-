import { canonicalInventoryRowUid, getCanonicalAvLotKey } from '../engine/canonical-inventory-evidence.js';

let avValidPhotosOnly = false;

export function toggleAvValidPhotos() {
    avValidPhotosOnly = !avValidPhotosOnly;
    invalidateResolvedViewStateCaches();
    invalidateAvFilterSelectionCaches();
    scheduleAVRender(0, 16, true);
    return false;
}

export function syncAvValidPhotosButton(container) {
    const button = container.querySelector('#av-valid-photos');
    if (!button) return;
    button.setAttribute('aria-pressed', String(avValidPhotosOnly));
    button.style.cssText = `white-space:nowrap;min-height:36px;padding:6px 10px;border-radius:10px;font-weight:800;color:${avValidPhotosOnly ? '#064e3b' : '#FACC15'};background:${avValidPhotosOnly ? '#FACC15' : '#064e3b'}`;
}

function getAvLotGroupSources(row) {
    return row.__canonicalAvLotRows || row.__physicalInventoryRows || [row];
}

function groupAvLotCard(rows, resolve) {
    const display = rows[0];
    const sources = rows.flatMap(getAvLotGroupSources);
    if (sources.length === 1 || !getCanonicalAvLotKey(display)) return display;
    const card = resolve({...display, __canonicalAvLotRows:sources});
    const owner = rows.find(row => canonicalInventoryRowUid(row) === canonicalInventoryRowUid(card));
    return {...card, DOM_ID:owner?.DOM_ID || card.DOM_ID || display.DOM_ID};
}

export function collapseCanonicalAvLotRows(rows, resolve = resolveCanonicalInventoryRow) {
    const groups = new Map();
    for (const row of rows) {
        if (!row) continue;
        const table = String(row.SOURCE_TABLE || row.source_table || 'ph_master_inventory').toLowerCase();
        const uid = canonicalInventoryRowUid(row);
        const key = table === 'ph_master_inventory' && uid ? getCanonicalAvLotKey(row) || 'uid:' + uid : row;
        const group = groups.get(key);
        if (group) group.push(row);
        else groups.set(key, [row]);
    }
    return [...groups.values()].map(group => groupAvLotCard(group, resolve));
}


function getAvResolvedCardCacheKey({term,safeTab,liveCatalogIncomplete,usePreparedSalesRows,preparedIdentity}) {
    return [
        resolvedViewStateEpoch,
        usePreparedSalesRows ? 'prepared-sales-rows' : 'synchronous-sales-rows',
        liveCatalogIncomplete ? 'live-catalog-pending' : 'live-catalog-complete',
        preparedIdentity ? preparedIdentity.signature : '',
        safeTab,
        activeAvOpenTab,
        activeAvHotPriceTab,
        activeAvReserveMode,
        activeAvSalesBucket,
        activeAvPhotoMode,
        avValidPhotosOnly,
        getConfiguredCurrentSeasonCode(),
        String(getConfiguredCurrentSalesYearCode()),
        selectedAvResRep || '',
        selectedAvSalesRepName || '',
        selectedAvRepCustomerKey || '',
        [...selectedAvSeasons].sort().join('|'),
        avHoldFilterMode,
        avGenusSelectionMode,
        [...selectedAvGenusNames].sort().join('|'),
        avContSizeSelectionMode,
        [...selectedAvContSizes].sort().join('|'),
        buildAvColumnFilterStateKey(),
        getRepU3VisibilityScopeKey(),
        term,
        getDatasetLoadSignature('master'),
        getDatasetLoadSignature('avOpen'),
        getDatasetLoadSignature('reserves'),
        getDatasetLoadSignature('avHotPriceKeys')
    ].join('::');
}

export function buildResolvedAVBaseState(options = {}) {
    const term = getAvSearchTerm();
    const safeTab = String(activeAVTab || 'open').trim();
    const liveCatalogIncomplete = isAvLiveCatalogIncomplete();
    const exactSearchRows = safeTab === 'open' && liveCatalogIncomplete
        ? getCurrentExactAvSearchHydrationRows() : [];
    const usePreparedSalesRows = !avValidPhotosOnly && getAvPhotoMode() !== 'valid_photos' && safeTab === 'open' && !exactSearchRows.length
        && !!(options && options.usePreparedSalesRows);
    const preparedIdentity = usePreparedSalesRows ? getAvSalesDerivationIdentity(activeAvSalesBucket) : null;
    const cacheKey = getAvResolvedCardCacheKey({term,safeTab,liveCatalogIncomplete,usePreparedSalesRows,preparedIdentity});
    if (avResolvedBaseStateKey === cacheKey && avResolvedBaseStateCache) {
        incrementInternalPerfCounter('viewStateCacheHits');
        return avResolvedBaseStateCache;
    }
    const preparedSalesRows = usePreparedSalesRows ? getAvSalesRowsForRendering(activeAvSalesBucket, preparedIdentity) : null;
    const exactSalesRows = exactSearchRows.length ? getAvSalesRowsForBucket(activeAvSalesBucket, exactSearchRows) : null;
    const filterBaseItems = avValidPhotosOnly ? getAvSalesRowsForBucket(activeAvSalesBucket, getCanonicalValidPhotoRows()) : getAvRawTabItems(safeTab, preparedSalesRows
        ? { salesRows: preparedSalesRows.rows }
        : exactSalesRows ? { salesRows: exactSalesRows } : {});
    const avFilterState = buildAvSharedFilterState(filterBaseItems);
    let items = avValidPhotosOnly ? avFilterState.filteredItems.filter(hasValidRowPhoto) : avFilterState.filteredItems;
    const searchProfile = isAvCustomerSalesBucket(activeAvSalesBucket) ? 'av_reserves' : 'av_open';
    if (term) items = filterBySearch(items, term, searchProfile);
    if (typeof applyInventoryExcelFilters === 'function') items = applyInventoryExcelFilters('av',items);
    if (!avValidPhotosOnly && term && (!items.length || liveCatalogIncomplete) && safeTab === 'open' && getAvPhotoMode() === 'photos') {
        const extra = getAvNamePhotoSearchRows(term);
        if (extra.length) {
            const eligible = getAvSalesRowsForBucket(activeAvSalesBucket,extra);
            const photos = getAvRawTabItems('open',{salesRows:eligible});
            const filtered = applyAvColumnFiltersToItems(photos).filter(createAvTopFilterPredicate());
            const matching = filterBySearch(filtered,term,searchProfile);
            items = collapseCanonicalAvLotRows(items.concat(matching));
        }
    }
    avResolvedBaseStateKey = cacheKey;
    avResolvedBaseStateCache = { items, term, filterBaseItems, avFilterState, isPartial: liveCatalogIncomplete || !!(preparedSalesRows && preparedSalesRows.partial) };
    return avResolvedBaseStateCache;
}
