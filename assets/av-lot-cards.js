
let avValidPhotosOnly = false;

function toggleAvValidPhotos() {
    avValidPhotosOnly = !avValidPhotosOnly;
    invalidateResolvedViewStateCaches();
    invalidateAvFilterSelectionCaches();
    scheduleAVRender(0, 16, true);
    return false;
}

function syncAvValidPhotosButton(container) {
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

function getAvDisplayLotGroupKey(row) {
    const table = String(row.SOURCE_TABLE || row.source_table || 'ph_master_inventory').toLowerCase();
    if (table !== 'ph_master_inventory') return row;
    const uid = canonicalInventoryRowUid(row);
    return getCanonicalAvLotKey(row) || (uid ? 'uid:' + uid : row);
}

function collapseCanonicalAvLotRows(rows, resolve = resolveCanonicalInventoryRow) {
    const groups = new Map();
    for (const row of rows) {
        if (!row) continue;
        const key = getAvDisplayLotGroupKey(row);
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

function buildResolvedAVBaseState(options = {}) {
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
            items = items.concat(matching);
        }
    }
    if (safeTab === 'open') items = collapseCanonicalAvLotRows(items);
    avResolvedBaseStateKey = cacheKey;
    avResolvedBaseStateCache = { items, term, filterBaseItems, avFilterState, isPartial: liveCatalogIncomplete || !!(preparedSalesRows && preparedSalesRows.partial) };
    return avResolvedBaseStateCache;
}

function queueAvViewReads() {
    if (activeAVTab === 'open') {
        const openStockDatasetKey = shouldUseRepAvOpenDataset() ? 'avOpen' : 'master';
        if (!isDatasetLoaded(openStockDatasetKey, 'initial')) {
            queueDatasetLoad(openStockDatasetKey, 'initial', isTouchConstrainedDevice() ? 2200 : 900);
        }
    }
    if (activeAVTab === 'reserves' && !isDatasetLoaded('reserves', 'full')) queueDatasetLoad('reserves', 'full', isTouchConstrainedDevice() ? 2200 : 900);
    if (shouldPrepareAvRepCustomerFilterData()) {
        if (!isDatasetLoaded('reserves', 'full')) queueDatasetLoad('reserves', 'full', isTouchConstrainedDevice() ? 2200 : 900);
        if (!isDatasetLoaded('customerRepMap', 'full')) queueDatasetLoad('customerRepMap', 'full', isTouchConstrainedDevice() ? 2200 : 900);
    }
}

function renderEmptyAvInventory(container, crumb, avState, warm) {
    const { term } = avState;
    if (avState.isPartial && !warm) {
        updateAVExportButton(0);
        renderAvPhotoOutreachPanel([]);
        setContainerHtmlWithSignature(container,
            '<div class="p-8 text-center text-gray-400" role="status">Loading latest AV rows…</div>',
            `av-preparing|${activeAvSalesBucket}|${activeAvPhotoMode}|${term}`);
        crumb.innerText = 'Loading AV inventory';
        return;
    }
    const bucketOption = getAvSalesBucketOption();
    const bucketLabel = bucketOption.emptyLabel || String(bucketOption.label || 'AV rows').toLowerCase();
    const emptyLabel = getAvPhotoMode() === 'photos' ? `${bucketLabel} with photos` : bucketLabel;
    updateAVExportButton(0);
    renderAvPhotoOutreachPanel([]);
    const emptySignature = buildRowsRenderSignature(`av-empty|${activeAvSalesBucket}|${activeAvPhotoMode}|${term}|${emptyLabel}`, []);
    setContainerHtmlWithSignature(container, `<div class="p-8 text-center text-gray-400">${['valid_photos','photos'].includes(getAvPhotoMode()) ? 'No rows with valid photos match your search.' : `No ${esc(emptyLabel)} found.`}</div>`, emptySignature);
    crumb.innerText = term.length > 0 ? 'Search Results (0)' : `No ${getAvSalesBucketLabel()} rows`;
    return;
}

function renderOpenAvInventory(container, crumb, items, term, avState) {
    const sourceView = getAvPhotoMode() === 'photos' ? 'av-photo' : 'av';
    const openExportContext = buildAVExportContext(items, term);
    const openRows = openExportContext.rows;
    const bucketLabel = getAvSalesBucketLabel();
    const crumbText = formatAvReadySummary(bucketLabel, openRows.length);
    renderAvPhotoOutreachPanel(avState.isPartial ? [] : openRows);
    const pageKey = buildAVBrowsePageKey(`av-open|${sourceView}|${activeAvSalesBucket}|${activeAvPhotoMode}|${term}|${crumbText}`, openRows);
    const browsePage = getClientBrowsePage('av', pageKey, openRows);
    const pageFooter = renderClientBrowsePageFooter('av', browsePage.key, openRows.length, browsePage);
    if (getAvPhotoMode() !== 'valid_photos' && shouldUseChunkedAVOpenRender(browsePage.rows)) {
        renderAVOpenCardsChunked(container, crumb, browsePage.rows, sourceView, crumbText, pageFooter, {
            firstPreviewCardSync: avState.isPartial === true
        });
        return;
    }
    crumb.innerText = crumbText;
    const renderSignature = buildRowsRenderSignature(pageKey, browsePage.rows, ['CAV_HOT_PRICE','CAV_ITEMCODE','CAV_HOT_PRICE_MATCH_KEY','AV_RESERVE_CUSTOMER_PREVIEW','AV_RESERVE_QTY_TOTAL']);
    setContainerHtmlWithSignature(container, `${browsePage.rows.map((i, rowIndex) => generateCard(i, sourceView, 'status-teal', { rowIndex })).join('')}${pageFooter}`, `${renderSignature}:page:${browsePage.pageIndex}`);
    scheduleDeferredCardPhotoHydration(container);
    return;
}

function renderReserveAvInventory(container, crumb, items, term) {
    const reserveRows = buildAVExportContext(items, term).rows;
    const crumbText = activeAvReserveMode === 'photos'
        ? (term.length > 0 ? `Search Results (${reserveRows.length})` : `Reserve Location Photos (${reserveRows.length} items)`)
        : (term.length > 0 ? `Search Results (${reserveRows.length})` : `All Reserve Locations (${reserveRows.length} items)`);
    const reserveSourceView = 'av';
    const pageKey = buildAVBrowsePageKey(`av-reserves|${reserveSourceView}|${activeAvReserveMode}|${term}|${crumbText}`, reserveRows);
    const reserveBrowsePage = getClientBrowsePage('av', pageKey, reserveRows);
    const reservePageFooter = renderClientBrowsePageFooter('av', reserveBrowsePage.key, reserveRows.length, reserveBrowsePage);
    renderAvPhotoOutreachPanel([]);
    if (shouldUseChunkedAVOpenRender(reserveBrowsePage.rows)) {
        renderAVOpenCardsChunked(container, crumb, reserveBrowsePage.rows, reserveSourceView, crumbText, reservePageFooter);
        return;
    }
    crumb.innerText = crumbText;
    const renderSignature = buildRowsRenderSignature(pageKey, reserveBrowsePage.rows, ['ITEMCODE','LOTCODE','LOCATIONCODE','AV_RESERVE_CUSTOMER_PREVIEW','AV_RESERVE_SALESREP_PREVIEW','AV_RESERVE_ROW_COUNT','AV_RESERVE_CUSTOMER_COUNT']);
    setContainerHtmlWithSignature(container, `${reserveBrowsePage.rows.map((item, rowIndex) => generateCard(item, reserveSourceView, 'status-teal', { rowIndex })).join('')}${reservePageFooter}`, `${renderSignature}:page:${reserveBrowsePage.pageIndex}`);
    scheduleDeferredCardPhotoHydration(container);
    return;
}

function renderAV() {
    syncAvKioskMode();
    const container = document.getElementById('av-content');
    const crumb = document.getElementById('av-crumb');
    const prior = container?.__avPendingChunk;
    if (prior) prior.retained = false;
    else cancelChunkRenderWorkForView('av');
    try {
        const warm = canRenderWarmAvInventory();
        if (ensureViewDataForRender('av')) return;
        applyRepScopedAvState();
        syncAvSecondaryTabs();
        ensureAvDefaultSeasonSelection();
        queueAvViewReads();
        const avState = getCurrentAVBaseItems({ usePreparedSalesRows: activeAVTab === 'open' && !warm });
        renderAvTopControls(avState.filterBaseItems || []);
        const { items, term } = avState;
        if (!items.length) return renderEmptyAvInventory(container, crumb, avState, warm);
        updateAVExportButton(avState.isPartial ? 0 : getAVVisibleExportCount(items));
        if (activeAVTab === 'open') return renderOpenAvInventory(container, crumb, items, term, avState);
        renderReserveAvInventory(container, crumb, items, term);
    } finally {
        if (prior && container.__avPendingChunk === prior && !prior.retained) {
            if (prior.token === avRenderChunkToken) cancelChunkRenderWorkForView('av');
            delete container.__avPendingChunk;
        }
    }
}
