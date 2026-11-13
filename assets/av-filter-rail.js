function renderAvTopControls(items = []) {
    const container = document.getElementById('av-top-filters');
    if (!container) return buildAvSharedFilterState(items);
    ensureAvControlsVisible(container);
    avFilterItemsCache = Array.isArray(items) ? items : [];
    const state = buildAvSharedFilterState(avFilterItemsCache);
    const filterState = resolveAvRailState(container, state);
    const { photoSummary, columnSummary, showSalesRepFilter, showRepCustomerFilter, salesRepSummary, repCustomerSummary } = filterState;
    const markup = buildAvRailOptions(state, filterState);
    const didMountShell = ensureAvTopControlsShell(container);
    syncAvValidPhotosButton(container);
    if (didMountShell) mountInventoryExcelFilters('av');
    ensureAvControlsVisible(container);
    const chips = document.getElementById('av-filter-chips');
    if (chips) {
        const active = [
            getAvPhotoMode() !== 'all' && photoSummary,
            showSalesRepFilter && selectedAvSalesRepName && salesRepSummary,
            showRepCustomerFilter && selectedAvRepCustomerKey && repCustomerSummary,
            getAvColumnFilterActiveCount() && columnSummary,
            avContSizeSelectionMode !== 'all' && getAvContSizeSummaryLabel(state.sizeOptions),
            avHoldFilterMode !== 'all' && getAvHoldFilterSummary(),
            avGenusSelectionMode !== 'all' && getAvGenusSummaryLabel(state.genusOptions),
            getAvSearchBoxValue()
        ].filter(Boolean);
        setContainerHtmlWithSignature(chips, active.map(value => '<span>' + escapeHtml(value) + '</span>').join(''), JSON.stringify(active));
    }
    const renderSignature = buildAvTopControlsSignature(state);
    const openDropdownActive = isAnyAvTopControlDropdownOpen();
    const openPanelNeedsBody = hasOpenAvTopControlPanelWithoutBody(container);
    if (!didMountShell && !openDropdownActive && !openPanelNeedsBody && renderSignature === lastAvTopControlsRenderSignature) {
        ensureAvControlsVisible(container);
        renderAvColumnFilterWindow(state);
        return state;
    }
    syncAvViewFilterPanels(container, state, filterState, markup);
    syncAvAccountFilterPanels(container, filterState, markup);
    lastAvTopControlsRenderSignature = renderSignature;
    ensureAvControlsVisible(container);
    renderAvColumnFilterWindow(state);
    scheduleStickyRailOffsetSync('av-filter-strip', true);
    return state;
}


function isAnyAvTopControlDropdownOpen() {
    return !!(avSourceDropdownOpen || avSeasonDropdownOpen || avGenusFilterOpen || avContSizeFilterOpen
        || avHoldDropdownOpen || avPhotoDropdownOpen || avSalesRepDropdownOpen || avRepCustomerDropdownOpen
        || avColumnFilterDropdownOpen);
}

function hasOpenAvTopControlPanelWithoutBody(container) {
    return Array.from(container.querySelectorAll('[data-av-filter-shell]')).some(shell => {
        const panel = shell.querySelector('[data-role="panel"]');
        if (!panel || panel.classList.contains('hidden')) return false;
        return !shell.querySelector('[data-role="body"]')?.innerHTML.trim();
    });
}

function resolveAvRailState(container, state) {
    const sourceSummary = getAvSalesBucketLabel();
    const photoSummary = getAvPhotoSummaryLabel();
    const columnSummary = getAvColumnFilterSummaryLabel();
    const showSalesRepFilter = canUseAvSalesRepFilter();
    const showRepCustomerFilter = shouldShowRepAvCustomerFilter();
    const collapseDetailFilters = shouldCollapseAvDetailedTopFilters();
    if (collapseDetailFilters) {
        avGenusFilterOpen = false;
        avContSizeFilterOpen = false;
        avHoldDropdownOpen = false;
    }
    const needsSalesRepOptions = showSalesRepFilter && (avSalesRepDropdownOpen || !!selectedAvSalesRepName);
    const needsRepCustomerOptions = showRepCustomerFilter && (avRepCustomerDropdownOpen || !!selectedAvRepCustomerKey);
    const salesRepOptions = needsSalesRepOptions ? getAvSalesRepOptions() : [];
    const salesRepSummary = showSalesRepFilter
        ? (needsSalesRepOptions ? getAvSalesRepSummaryLabel(salesRepOptions) : 'All Reps')
        : '';
    const repCustomerOptions = needsRepCustomerOptions ? getAvRepCustomerOptions() : [];
    const repCustomerSummary = showRepCustomerFilter
        ? (needsRepCustomerOptions ? getAvRepCustomerSummaryLabel(repCustomerOptions) : 'All Customers')
        : '';
    const visibleFilterCount = 3 + (collapseDetailFilters ? 0 : 3) + (showSalesRepFilter ? 1 : 0) + (showRepCustomerFilter ? 1 : 0);
    state.detailFiltersCollapsed = collapseDetailFilters;
    container.classList.toggle('av-top-has-salesrep', showSalesRepFilter);
    container.classList.toggle('av-top-has-customer', showRepCustomerFilter);
    [3, 4, 5, 6, 7, 8].forEach((count) => container.classList.toggle(`av-top-filter-count-${count}`, visibleFilterCount === count));
    const salesRepSearchToken = normalizeRepMatchToken(avSalesRepSearchTerm || '');
    const filteredSalesRepOptions = avSalesRepDropdownOpen && salesRepSearchToken
        ? salesRepOptions.filter((option) => doesProgressiveSearchTextMatch(option.searchToken, salesRepSearchToken))
        : (avSalesRepDropdownOpen ? salesRepOptions : []);
    const repCustomerSearchToken = normalizeRepMatchToken(avRepCustomerSearchTerm || '');
    const filteredRepCustomerOptions = avRepCustomerDropdownOpen && repCustomerSearchToken
        ? repCustomerOptions.filter((option) => doesProgressiveSearchTextMatch(option.searchToken, repCustomerSearchToken))
        : (avRepCustomerDropdownOpen ? repCustomerOptions : []);
    state.salesRepCount = salesRepOptions.length;
    state.filteredSalesRepCount = filteredSalesRepOptions.length;
    state.repCustomerCount = repCustomerOptions.length;
    state.filteredRepCustomerCount = filteredRepCustomerOptions.length;
    return { sourceSummary, photoSummary, columnSummary, showSalesRepFilter, showRepCustomerFilter, collapseDetailFilters, salesRepOptions, salesRepSummary, repCustomerOptions, repCustomerSummary, filteredSalesRepOptions, filteredRepCustomerOptions };
}

function buildAvRailOptions(state, { collapseDetailFilters, filteredSalesRepOptions, filteredRepCustomerOptions }) {
    const controlButtonClass = (isActive = false) => `task-top-control-button inline-flex w-full items-center gap-2 rounded-full border px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.11em] sm:px-3.5 sm:text-[10px] ${isActive ? 'bg-emerald-600 border-emerald-600 text-white shadow-md' : 'bg-white border-emerald-200 text-emerald-700 shadow-sm'}`;
    const sourceChoices = getAvViewChoices();
    const sourceOptionsHtml = buildAvSingleChoiceOptionsHtml(sourceChoices, getAvViewModeKey(), 'setAvSourceFilter');
    const photoOptionsHtml = buildAvSingleChoiceOptionsHtml(AV_PHOTO_VIEW_OPTIONS, getAvPhotoMode(), 'setAvPhotoMode');
    const genusOptionsHtml = avGenusFilterOpen && !collapseDetailFilters
        ? buildAvMultiChoiceOptionsHtml(state.filteredGenusOptions, selectedAvGenusNames, 'toggleAvGenusSelection', 'No matching genus.') : '';
    const contSizeOptionsHtml = avContSizeFilterOpen && !collapseDetailFilters
        ? buildAvMultiChoiceOptionsHtml(state.filteredSizeOptions, selectedAvContSizes, 'toggleAvContSizeSelection', 'No matching sizes.') : '';
    const holdOptionsHtml = buildAvSingleChoiceOptionsHtml([
        { value: 'all', label: 'All Rows', icon: 'ph-bold ph-list-checks' },
        { value: 'hold', label: 'Holdstop Only', icon: 'ph-bold ph-warning-circle' },
        { value: 'clear', label: 'Hide Holdstop', icon: 'ph-bold ph-prohibit' }
    ], avHoldFilterMode, 'setAvHoldFilterMode');
    return {
        controlButtonClass, sourceChoices, sourceOptionsHtml, photoOptionsHtml, genusOptionsHtml, contSizeOptionsHtml, holdOptionsHtml,
        salesRepOptionsHtml: buildAvSalesRepFilterMarkup(filteredSalesRepOptions),
        repCustomerOptionsHtml: buildAvCustomerFilterMarkup(filteredRepCustomerOptions)
    };
}

function buildAvSalesRepFilterMarkup(filteredSalesRepOptions) {
    const salesRepRenderLimit = getAvDropdownOptionRenderLimit();
    const visibleSalesRepOptions = filteredSalesRepOptions.slice(0, salesRepRenderLimit);
    const choices = visibleSalesRepOptions.map((option) => {
            const selected = getAvSalesRepOptionKey(option.label) === getAvSalesRepOptionKey(selectedAvSalesRepName);
            const countLabel = Number(option.count || 0) > 0 ? `<span class="mt-0.5 block truncate text-[10px] font-bold uppercase tracking-[0.08em] ${selected ? 'text-emerald-100' : 'text-slate-400'}">${esc(String(option.count || 0))} reserve rows</span>` : '';
            return `<button type="button" class="flex w-full items-center justify-between gap-3 px-3 py-3 text-left ${selected ? 'bg-emerald-600 text-white' : 'text-slate-700 hover:bg-emerald-50'}" ${buildExcelFilterFastAttrs('setAvSalesRepFilter', option.label)}><span class="min-w-0"><span class="block truncate text-[12px] font-black uppercase tracking-[0.08em]">${esc(option.label)}</span>${countLabel}</span>${selected ? '<i class="ph-bold ph-check text-base"></i>' : ''}</button>`;
        });
    return [
        `<button type="button" class="flex w-full items-center justify-between gap-3 px-3 py-3 text-left text-[12px] font-black uppercase tracking-[0.08em] ${selectedAvSalesRepName ? 'text-slate-700 hover:bg-emerald-50' : 'bg-emerald-50 text-emerald-700'}" ${buildExcelFilterFastAttrs('setAvSalesRepFilter', '')}><span class="inline-flex min-w-0 items-center gap-2"><i class="ph-bold ph-users-three text-base"></i><span class="truncate">All Reps</span></span>${selectedAvSalesRepName ? '' : '<i class="ph-bold ph-check text-base text-emerald-600"></i>'}</button>`,
        ...(choices.length ? choices : ['<div class="px-3 py-4 text-center text-[11px] font-semibold text-gray-400">No matching sales reps.</div>']),
        buildAvDropdownOptionLimitNotice(filteredSalesRepOptions.length, visibleSalesRepOptions.length)
    ].join('');
}

function buildAvCustomerFilterMarkup(filteredRepCustomerOptions) {
    const repCustomerRenderLimit = getAvDropdownOptionRenderLimit();
    const visibleRepCustomerOptions = filteredRepCustomerOptions.slice(0, repCustomerRenderLimit);
    const choices = visibleRepCustomerOptions.map((option) => {
            const selected = option.key === selectedAvRepCustomerKey;
            const consigneeLabel = option.consigneeName && option.consigneeName !== option.customerName ? `<span class="mt-0.5 block truncate text-[10px] font-bold uppercase tracking-[0.08em] ${selected ? 'text-emerald-100' : 'text-slate-400'}">${esc(option.consigneeName)}</span>` : '';
            return `<button type="button" class="flex w-full items-center justify-between gap-3 px-3 py-3 text-left ${selected ? 'bg-emerald-600 text-white' : 'text-slate-700 hover:bg-emerald-50'}" ${buildExcelFilterFastAttrs('setAvRepCustomerFilter', option.key)}><span class="min-w-0"><span class="block truncate text-[12px] font-black uppercase tracking-[0.08em]">${esc(option.customerName || option.label)}</span>${consigneeLabel}</span>${selected ? '<i class="ph-bold ph-check text-base"></i>' : ''}</button>`;
        });
    return [
        `<button type="button" class="flex w-full items-center justify-between gap-3 px-3 py-3 text-left text-[12px] font-black uppercase tracking-[0.08em] ${selectedAvRepCustomerKey ? 'text-slate-700 hover:bg-emerald-50' : 'bg-emerald-50 text-emerald-700'}" ${buildExcelFilterFastAttrs('setAvRepCustomerFilter', '')}><span class="inline-flex min-w-0 items-center gap-2"><i class="ph-bold ph-users-three text-base"></i><span class="truncate">All Customers</span></span>${selectedAvRepCustomerKey ? '' : '<i class="ph-bold ph-check text-base text-emerald-600"></i>'}</button>`,
        ...(choices.length ? choices : ['<div class="px-3 py-4 text-center text-[11px] font-semibold text-gray-400">No matching customers.</div>']),
        buildAvDropdownOptionLimitNotice(filteredRepCustomerOptions.length, visibleRepCustomerOptions.length)
    ].join('');
}

function syncAvViewFilterPanels(container, state, filterState, markup) {
    const { sourceSummary, photoSummary, collapseDetailFilters } = filterState;
    const { controlButtonClass, sourceChoices, sourceOptionsHtml, photoOptionsHtml, genusOptionsHtml, contSizeOptionsHtml, holdOptionsHtml } = markup;
    syncAvTopControlShell(container, 'source', {
        buttonClass: controlButtonClass(avSourceDropdownOpen),
        summary: sourceSummary,
        open: avSourceDropdownOpen,
        bodyHtml: avSourceDropdownOpen ? `${buildAvFilterOptionsScrollHtml(sourceOptionsHtml)}${buildAvFilterDoneFooterHtml('closeAvSourceDropdown')}` : '',
        bodySignature: `av-source:${getAvViewModeKey()}:${sourceChoices.map((option) => option.value).join('|')}:${avSourceDropdownOpen ? 'open' : 'closed'}`
    });
    syncAvTopControlShell(container, 'season', {
        buttonClass: controlButtonClass(avSeasonDropdownOpen),
        summary: photoSummary,
        open: avSeasonDropdownOpen,
        bodyHtml: avSeasonDropdownOpen ? `${buildAvFilterOptionsScrollHtml(photoOptionsHtml)}${buildAvFilterDoneFooterHtml('closeAvSeasonDropdown')}` : '',
        bodySignature: `av-photo-mode:${getAvPhotoMode()}:${avSeasonDropdownOpen ? 'open' : 'closed'}`
    });
    syncAvTopControlShell(container, 'genus', {
        hidden: collapseDetailFilters,
        buttonClass: controlButtonClass(avGenusFilterOpen || avGenusSelectionMode !== 'all'),
        summary: getAvGenusSummaryLabel(state.genusOptions),
        open: !collapseDetailFilters && avGenusFilterOpen,
        bodyHtml: (!collapseDetailFilters && avGenusFilterOpen) ? `${buildExcelFilterSearchHtml('av-genus-search', avGenusSearchTerm, 'Search genus...', 'setAvGenusSearchTerm', 'handleAvGenusSearchKeydown')}${buildAvFilterOptionsScrollHtml(genusOptionsHtml)}${buildAvExcelBulkFooterHtml('selectAllAvGenus', 'deselectAllAvGenus', 'closeAvGenusDropdown', !state.genusOptions.length || state.genusAllSelected, !state.genusOptions.length || !selectedAvGenusNames.size)}` : '',
        bodySignature: collapseDetailFilters ? 'av-genus:hidden' : `av-genus:${buildSelectionStateKey(selectedAvGenusNames)}:${String(avGenusSearchTerm || '').trim().toLowerCase()}:${avGenusFilterOpen ? 'open' : 'closed'}:${state.genusOptions.join('|')}`
    });
    syncAvTopControlShell(container, 'contsize', {
        hidden: collapseDetailFilters,
        buttonClass: controlButtonClass(avContSizeFilterOpen || avContSizeSelectionMode !== 'all'),
        summary: getAvContSizeSummaryLabel(state.sizeOptions),
        open: !collapseDetailFilters && avContSizeFilterOpen,
        bodyHtml: (!collapseDetailFilters && avContSizeFilterOpen) ? `${buildExcelFilterSearchHtml('av-contsize-search', avContSizeSearchTerm, 'Search cont size...', 'setAvContSizeSearchTerm', 'handleAvContSizeSearchKeydown')}${buildAvFilterOptionsScrollHtml(contSizeOptionsHtml)}${buildAvExcelBulkFooterHtml('selectAllAvContSizes', 'deselectAllAvContSizes', 'closeAvContSizeDropdown', !state.sizeOptions.length || state.contSizeAllSelected, !state.sizeOptions.length || !selectedAvContSizes.size)}` : '',
        bodySignature: collapseDetailFilters ? 'av-contsize:hidden' : `av-contsize:${buildSelectionStateKey(selectedAvContSizes)}:${String(avContSizeSearchTerm || '').trim().toLowerCase()}:${avContSizeFilterOpen ? 'open' : 'closed'}:${state.sizeOptions.join('|')}`
    });
    syncAvTopControlShell(container, 'hold', {
        hidden: collapseDetailFilters,
        buttonClass: controlButtonClass(avHoldDropdownOpen || avHoldFilterMode !== 'all'),
        summary: getAvHoldFilterSummary(),
        open: !collapseDetailFilters && avHoldDropdownOpen,
        bodyHtml: (!collapseDetailFilters && avHoldDropdownOpen) ? `${buildAvFilterOptionsScrollHtml(holdOptionsHtml)}${buildAvFilterDoneFooterHtml('closeAvHoldDropdown')}` : '',
        bodySignature: collapseDetailFilters ? 'av-hold:hidden' : `av-hold:${avHoldFilterMode}:${avHoldDropdownOpen ? 'open' : 'closed'}`
    });
}

function syncAvAccountFilterPanels(container, filterState, markup) {
    const { showSalesRepFilter, showRepCustomerFilter, salesRepSummary, repCustomerSummary, salesRepOptions, repCustomerOptions, columnSummary } = filterState;
    const { controlButtonClass, salesRepOptionsHtml, repCustomerOptionsHtml } = markup;
    syncAvTopControlShell(container, 'salesrep', {
        hidden: !showSalesRepFilter,
        buttonClass: controlButtonClass(avSalesRepDropdownOpen || !!selectedAvSalesRepName),
        summary: salesRepSummary,
        open: avSalesRepDropdownOpen,
        bodyHtml: avSalesRepDropdownOpen ? `${buildExcelFilterSearchHtml('av-salesrep-search', avSalesRepSearchTerm, 'Search sales rep...', 'setAvSalesRepSearchTerm', 'handleAvSalesRepSearchKeydown')}${buildAvFilterOptionsScrollHtml(salesRepOptionsHtml)}${buildAvFilterDoneFooterHtml('closeAvSalesRepDropdown')}` : '',
        bodySignature: `av-salesrep:${selectedAvSalesRepName}:${String(avSalesRepSearchTerm || '').trim().toLowerCase()}:${salesRepOptions.map((option) => option.key).join('|')}:${avSalesRepDropdownOpen ? 'open' : 'closed'}`
    });
    syncAvTopControlShell(container, 'customer', {
        hidden: !showRepCustomerFilter,
        buttonClass: controlButtonClass(avRepCustomerDropdownOpen || !!selectedAvRepCustomerKey),
        summary: repCustomerSummary,
        open: avRepCustomerDropdownOpen,
        bodyHtml: avRepCustomerDropdownOpen ? `${buildExcelFilterSearchHtml('av-rep-customer-search', avRepCustomerSearchTerm, 'Search customer...', 'setAvRepCustomerSearchTerm', 'handleAvRepCustomerSearchKeydown')}${buildAvFilterOptionsScrollHtml(repCustomerOptionsHtml)}${buildAvFilterDoneFooterHtml('closeAvRepCustomerDropdown')}` : '',
        bodySignature: `av-rep-customer:${selectedAvRepCustomerKey}:${String(avRepCustomerSearchTerm || '').trim().toLowerCase()}:${repCustomerOptions.map((option) => option.key).join('|')}:${avRepCustomerDropdownOpen ? 'open' : 'closed'}`
    });
    syncAvTopControlShell(container, 'columns', {
        buttonClass: controlButtonClass(avColumnFilterDropdownOpen || !!getAvColumnFilterActiveCount()),
        summary: columnSummary,
        open: false,
        bodyHtml: '',
        bodySignature: `av-columns:${columnSummary}:${avColumnFilterDropdownOpen ? 'open' : 'closed'}:${buildAvColumnFilterStateKey()}`
    });
}
function setAvPhotoMode(mode = 'all') {
    beginDirectNavigationActivity();
    const nextMode = ['valid_photos','photos','no_photos'].includes(mode) ? mode : 'all';
    activeAvPhotoMode = nextMode;
    if (nextMode === 'valid_photos') { activeAVTab = 'open'; activeAvSalesBucket = 'current'; }
    if (activeAVTab === 'reserves') activeAvReserveMode = nextMode;
    else activeAvOpenTab = nextMode === 'photos' ? 'photos' : 'name';
    avPhotoDropdownOpen = false;
    avSeasonDropdownOpen = false;
    syncAvSecondaryTabs();
    avOpenLevel = 0;
    selectedAvOpenName = null;
    selectedAvOpenSize = null;
    selectedAvOpenSeason = null;
    selectedAvOpenLot = null;
    selectedAvReserveDetailCustomerKey = null;
    avResolvedBaseStateKey = '';
    avResolvedBaseStateCache = null;
    const current = getCurrentAVBaseItems();
    renderAvTopControls(current.filterBaseItems || []);
    updateAVExportButton(current.isPartial ? 0 : getAVVisibleExportCount(current.items));
    if (nextMode === 'valid_photos') renderAV();
    else scheduleAVRender(0);
    return false;
}


function setAVTab(tab) {
    lastViewSwitchAt = Date.now();
    const nextTab = tab === 'reserves' ? 'reserves' : 'open';
    return runDirectTrackedNavigation('av', `av-tab:${nextTab}`, () => {
        activeAVTab=nextTab;
        activeAvSalesBucket = nextTab === 'reserves' ? 'customer' : 'current';
        avResLevel=0; selectedAvResRep=null; selectedAvResDriveUid=null; selectedAvResItemCode=null; selectedAvResName=null; selectedAvResSize=null; selectedAvResCustomerKey=null; activeAvReserveMode='all'; activeAvReserveDetailTab='customer'; selectedAvReserveDetailCustomerKey=null;
        avOpenLevel=0; selectedAvOpenName=null; selectedAvOpenSize=null; selectedAvOpenSeason=null; selectedAvOpenLot=null;
        closeAvTopControlDropdowns(false);
        avResolvedBaseStateKey = '';
        avResolvedBaseStateCache = null;
        document.getElementById('tab-av-open').classList.toggle('active',nextTab==='open'); document.getElementById('tab-av-reserves').classList.toggle('active',nextTab==='reserves');
        syncAvSecondaryTabs();
    }, { delay: 0, typingDelay: 32, forceRender: true, resetScrollTopAfterRender: true, scrollResetKey: `av-tab:${nextTab}`, touchDelayMs: 8, interactionDelayMs: 8, scrollDelayMs: 48 });
}

function ensureAvControlsVisible(container) {
    if (!container) return;
    container.classList.add('av-top-inline');
    container.classList.remove('hidden');
    container.removeAttribute('aria-hidden');
    container.style.removeProperty('display');
    container.style.removeProperty('visibility');
    container.style.removeProperty('opacity');

    const controls = container.closest('.av-secondary-controls');
    if (controls) {
        controls.classList.remove('hidden');
        controls.removeAttribute('aria-hidden');
        controls.style.removeProperty('display');
        controls.style.removeProperty('visibility');
        controls.style.removeProperty('opacity');
    }

}

function getAvPhotoSummaryLabel() {
    return AV_PHOTO_VIEW_OPTIONS.find(option => option.value === getAvPhotoMode())?.label || 'No Photo / Expired';
}

function shouldCollapseAvDetailedTopFilters() {
    return false;
}

function toggleAvHoldDropdown() {
    const nextState = !avHoldDropdownOpen;
    closeAvTopControlDropdowns(false);
    avHoldDropdownOpen = nextState;
    return renderAvTopControlsForDropdownStateChange();
}

function buildDependentAvFilterOptions(state) {
    return {
        filteredGenusOptions: avGenusFilterOpen
            ? getAvDependentChoices(state.baseItems, 'genus', state.genusOptions, avGenusSearchTerm, getAvFilterGenusFacetValue)
            : state.genusOptions,
        filteredSizeOptions: avContSizeFilterOpen
            ? getAvDependentChoices(state.baseItems, 'contsize', state.sizeOptions, avContSizeSearchTerm, getAvFilterContSizeFacetValue)
            : state.sizeOptions
    };
}

function getAvDependentChoices(rows, except, options, query, getValue) {
    const term = getAvSearchBoxValue();
    const profile = isAvCustomerSalesBucket(activeAvSalesBucket) ? 'av_reserves' : 'av_open';
    const eligible = applyAvColumnFiltersToItems(rows).filter(createAvTopFilterPredicate({ except }));
    const searchable = term ? filterBySearch(eligible, term, profile) : eligible;
    const state = getInventoryExcelState('av');
    const skipSeason = getAvPhotoMode() === 'valid_photos' ? 'season' : '';
    const matching = searchable.filter(row => inventoryExcelRowMatches(row, state, skipSeason));
    const values = new Set(matching.map(getValue));
    return options.filter(option => values.has(option) && (!query || doesExcelFilterSearchMatchStart(option, query)));
}

function buildDependentDockFilterOptions(source) {
    const eligible = applyDockColumnFiltersToItems(source);
    const repOptions = buildDockFilterOptions(applyDockRepCustomerFiltersOnly(eligible, 'rep'), getDockRepFilterValue);
    const customerOptions = buildDockFilterOptions(applyDockRepCustomerFiltersOnly(eligible, 'customer'), getDockCustomerFilterValue);
    const availableReps = new Set(source.map(getDockRepFilterValue));
    const availableCustomers = new Set(source.map(getDockCustomerFilterValue));
    let optionHash = 2166136261;
    for (const options of [repOptions, customerOptions]) {
        optionHash = updateRenderSignatureHash(optionHash, options.length);
        for (const value of options) optionHash = updateRenderSignatureHash(optionHash, value);
    }
    optionHash = updateRenderSignatureHash(optionHash, buildDockColumnFilterStateKey());
    return { repOptions, customerOptions, availableReps, availableCustomers, optionHash };
}
