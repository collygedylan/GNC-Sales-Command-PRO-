export function getRequestHeaderSearchMode() {
    if (activeReqTab === 'suspend-tag') return 'suspend-tag';
    if (activeReqTab !== 'reps') return 'queue';
    if (requestViewLevel === 0) return 'reps';
    if (requestViewLevel === 1) return 'customers';
    if (requestViewLevel === 2) return 'consignees';
    if (requestViewLevel === 3) return 'folders';
    return 'queue';
}

function getRequestHeaderSearchValue(mode) {
    switch (mode) {
        case 'queue': return getQueHeaderSearchTerm();
        case 'suspend-tag': return requestSuspendTagCommonNameSearchTerm;
        case 'folders': return requestFolderSearchTerm;
        case 'folderDate': return requestFolderDateFilter;
        case 'consignees': return requestConsigneeSearchTerm;
        case 'customers': return requestCustomerSearchTerm;
        case 'reps': return requestRepSearchTerm;
        default: return '';
    }
}

export function syncRequestHeaderSearchChrome(options = {}) {
    syncQueHeaderLayout();
    const mode = getRequestHeaderSearchMode();
    const previousMode = lastRequestHeaderSearchMode;
    lastRequestHeaderSearchMode = mode;
    const container = document.getElementById('request-search-container');
    const input = document.getElementById('request-search');
    const value = getRequestHeaderSearchValue(mode);
    const placeholder = 'Search Que...';
    if (container) container.classList.toggle('hidden', !mode);
    if (input) {
        input.type = mode === 'folderDate' ? 'date' : 'text';
        if (document.activeElement !== input && input.value !== value) input.value = value;
        input.placeholder = placeholder;
        input.setAttribute('aria-label', placeholder.replace(/\.\.\.$/, ''));
    }
    document.getElementById('request-search-clear')?.classList.toggle('hidden', !String(value || '').trim());
    if (options.forceHeader || previousMode !== mode) syncGlobalHeaderChrome({ reason:'request-search', force:true });
}

function setRequestLegacySearchValue(mode, value) {
    switch (mode) {
        case 'customers': requestCustomerSearchTerm = value; break;
        case 'consignees': requestConsigneeSearchTerm = value; break;
        case 'reps': requestRepSearchTerm = value; break;
        case 'folders': requestFolderSearchTerm = String(value || '').trim(); break;
        case 'folderDate': requestFolderDateFilter = value; break;
        default: return false;
    }
    return true;
}

export function handleRequestHeaderSearch() {
    const mode = getRequestHeaderSearchMode();
    const value = document.getElementById('request-search')?.value || '';
    if (mode === 'queue') return setQueHeaderSearch(value);
    if (mode === 'suspend-tag') return setRequestSuspendTagCommonNameSearch(value);
    if (!setRequestLegacySearchValue(mode, value)) return false;
    document.getElementById('request-search-clear')?.classList.toggle('hidden', !String(value).trim());
    if (mode === 'folders' || mode === 'folderDate') {
        const id = mode === 'folders' ? 'request-folder-search-input' : 'request-folder-date-filter';
        const input = document.getElementById(id);
        if (input) input.value = value;
        return applyRequestFolderFilters();
    }
    return scheduleTrackedSearchViewRender('request', 'request-header-search:'+mode, value, { force:true, debounceDelay:1, typingDelay:18 });
}

export function clearRequestHeaderSearch() {
    const input = document.getElementById('request-search');
    if (input) input.value = '';
    document.getElementById('request-search-clear')?.classList.add('hidden');
    if (getRequestHeaderSearchMode() === 'suspend-tag') return clearRequestSuspendTagCommonNameSearch();
    return handleRequestHeaderSearch();
}

export function buildPendingRequestRenderPlan(items) {
    const crumbText = 'All Request Que';
    const candidates = items.filter(matchesQueHeaderSearch).filter(isRequestPendingVisible).filter(isRegularRequestQueueItem);
    const pendingItems = typeof applyInventoryExcelFilters === 'function' ? applyInventoryExcelFilters('request',candidates) : candidates;
    if (typeof rememberOperationalExport === 'function') rememberOperationalExport('request',pendingItems);
    if (!pendingItems.length) return { empty: true, crumbText, items: [], rows: [], pageIndex: 0, renderKey: '', renderSignature: '', footerMarkup: '' };
    pendingItems.sort((a, b) => compareLocationCodeValues(a.LOCATIONCODE, b.LOCATIONCODE)
        || naturalCompare(a.LOTCODE, b.LOTCODE)
        || naturalCompare(getItemUniqueId(a), getItemUniqueId(b)));
    return buildRequestPagedRenderPlan('request:pending', crumbText, pendingItems);
}

const queHeaderSearchTerms = new Map();

function queHeaderSearchKey() {
    return getSupabaseReadIdentityScope() + ':' + activeReqTab;
}

function getQueHeaderSearchTerm() {
    return queHeaderSearchTerms.get(queHeaderSearchKey()) || '';
}

function matchesQueHeaderSearch(row) {
    const query = getQueHeaderSearchTerm().trim().toLowerCase();
    const text = Object.values(row).filter(value => typeof value === 'string' || typeof value === 'number').join(' ').toLowerCase();
    return query.split(/\s+/).every(word => text.includes(word));
}

function setQueHeaderSearch(value) {
    queHeaderSearchTerms.set(queHeaderSearchKey(), String(value || ''));
    const input = document.getElementById('request-search');
    if (input) input.value = value;
    document.getElementById('request-search-clear')?.classList.toggle('hidden', !value);
    const native = document.querySelector('#request-content input[type="search"], #request-content input[placeholder*="Search" i]');
    if (activeReqTab !== 'pending' && native) {
Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(native, value);
native.dispatchEvent(new Event('input', { bubbles: true }));
return false;
    }
    return scheduleTrackedSearchViewRender('request', 'queue-header-search', value, { force: true, debounceDelay: 1, typingDelay: 18 });
}

export function syncQueHeaderLayout() {
    const row = document.getElementById('global-header-search-row');
    const toolbar = document.getElementById('request-filter-toolbar');
    if (getCurrentVisibleViewId() !== 'request' || !row || !toolbar) return;
    if (toolbar.parentElement !== row) row.appendChild(toolbar);
}

export function renderRequestCategoryToolbar(counts = null) {
    const toolbar = document.getElementById('request-filter-toolbar');
    if (!toolbar) return false;
    counts = counts || getRequestTabQueueCounts();
    let control = toolbar.querySelector('.que-view-control');
    if (!control) {
toolbar.querySelector('.request-category-options')?.setAttribute('hidden', '');
control = document.createElement('label');
control.className = 'que-view-control';
control.innerHTML = '<span class="sr-only">Que View</span><select id="que-view-select" aria-label="Que View" onchange="return setReqTab(this.value)"></select>';
toolbar.prepend(control);
    }
    const legacy = toolbar.querySelector('.request-category-options');
    if (legacy && !legacy.children.length) legacy.innerHTML = getAuthorizedRequestCategories().map(category =>
        '<button type="button" data-request-category="'+escapeHtml(category)+'" onclick="return setReqTab(this.dataset.requestCategory)"></button>').join('');
    const select = control.querySelector('select');
    const markup = getAuthorizedRequestCategories().map(category => '<option value="'+escapeHtml(category)+'">'
+escapeHtml(REQUEST_TAB_LABELS[category])+' ('+formatRequestTabCount(Math.max(0, Number(counts[category]) || 0))+')</option>').join('');
    if (select.innerHTML !== markup) select.innerHTML = markup;
    select.value = activeReqTab;
    if (!toolbar.querySelector('#que-other-owner')) {
const other = document.createElement('select');
other.id = 'que-other-owner';
other.setAttribute('aria-label', 'Assigned / Eval User');
other.disabled = true;
toolbar.appendChild(other);
    }
    const fallback = toolbar.querySelector('#que-other-owner');
    fallback.hidden = ['pending','suspend-tag'].includes(activeReqTab) && queueAccessScope(activeReqTab).all;
    fallback.innerHTML = '<option>'+escapeHtml(queueAccessScope(activeReqTab).all ? 'All Users' : String(currentUser || 'Assigned User'))+'</option>';
    toolbar.dataset.toolbarSingleRow = 'true';
    syncQueHeaderLayout();
    return true;
}
