function ensureAvTopControlsShell(container) {
    if (!container) return false;
    ensureAvControlsVisible(container);
    const shellSignature = 'av-top-controls-shell:v14';
    if (container.dataset.avTopControlsShell === shellSignature) {
        ensureAvControlsVisible(container);
        return false;
    }
    container.dataset.avTopControlsShell = shellSignature;
    setContainerHtml(container, buildAvRailMarkup());
    ensureAvControlsVisible(container);
    return true;
}

function buildAvRailMarkup() {
    return `<div id="av-toolbar-primary">
            <div class="task-top-control-shell av-filter-shell rounded-[1.05rem] border border-emerald-100 bg-white/96 shadow-sm" data-av-filter-shell="source">
                <button type="button" data-role="button" ${buildExcelFilterFastAttrs('toggleAvSourceDropdown')}>
                    <i class="ph-bold ph-calendar-blank text-sm"></i>
                    <span class="flex min-w-0 flex-1 flex-col leading-none">
                        <span class="task-top-control-title truncate">Stock</span>
                        <span class="task-top-control-summary truncate" data-role="summary">Season</span>
                    </span>
                    <i class="ph-bold ph-caret-down text-xs opacity-70 transition-transform" data-role="caret"></i>
                </button>
                <div class="task-top-control-panel excel-filter-panel excel-filter-panel--viewport-safe av-excel-filter-panel mt-2 hidden overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm" data-role="panel"><div data-role="body"></div></div>
            </div>
        </div>
        <div id="av-filter-options" class="av-top-controls-row">${buildAvRailViewFields()}${buildAvRailAccountFields()}</div>`;
}

function buildAvRailViewFields() {
    return `
            <div class="task-top-control-shell av-filter-shell rounded-[1.05rem] border border-emerald-100 bg-white/96 shadow-sm" data-av-filter-shell="season">
                <button type="button" data-role="button" ${buildExcelFilterFastAttrs('toggleAvSeasonDropdown')}>
                    <i class="ph-bold ph-images text-sm"></i>
                    <span class="flex min-w-0 flex-1 flex-col leading-none">
                        <span class="task-top-control-title truncate">View</span>
                        <span class="task-top-control-summary truncate" data-role="summary">All</span>
                    </span>
                    <i class="ph-bold ph-caret-down text-xs opacity-70 transition-transform" data-role="caret"></i>
                </button>
                <div class="task-top-control-panel excel-filter-panel excel-filter-panel--viewport-safe av-excel-filter-panel mt-2 hidden overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm" data-role="panel"><div data-role="body"></div></div>
            </div>
            <div class="task-top-control-shell av-filter-shell rounded-[1.05rem] border border-emerald-100 bg-white/96 shadow-sm" data-av-filter-shell="genus">
                <button type="button" data-role="button" ${buildExcelFilterFastAttrs('toggleAvGenusDropdown')}>
                    <i class="ph-bold ph-leaf text-sm"></i>
                    <span class="flex min-w-0 flex-1 flex-col leading-none">
                        <span class="task-top-control-title truncate">Genus</span>
                        <span class="task-top-control-summary truncate" data-role="summary">All Genus</span>
                    </span>
                    <i class="ph-bold ph-caret-down text-xs opacity-70 transition-transform" data-role="caret"></i>
                </button>
                <div class="task-top-control-panel excel-filter-panel excel-filter-panel--viewport-safe av-excel-filter-panel mt-2 hidden overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm" data-role="panel"><div data-role="body"></div></div>
            </div>
            <div class="task-top-control-shell av-filter-shell rounded-[1.05rem] border border-emerald-100 bg-white/96 shadow-sm" data-av-filter-shell="contsize">
                <button type="button" data-role="button" ${buildExcelFilterFastAttrs('toggleAvContSizeDropdown')}>
                    <i class="ph-bold ph-ruler text-sm"></i>
                    <span class="flex min-w-0 flex-1 flex-col leading-none">
                        <span class="task-top-control-title truncate">Contsize</span>
                        <span class="task-top-control-summary truncate" data-role="summary">All Sizes</span>
                    </span>
                    <i class="ph-bold ph-caret-down text-xs opacity-70 transition-transform" data-role="caret"></i>
                </button>
                <div class="task-top-control-panel excel-filter-panel excel-filter-panel--viewport-safe av-excel-filter-panel mt-2 hidden overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm" data-role="panel"><div data-role="body"></div></div>
            </div>
            <div class="task-top-control-shell av-filter-shell rounded-[1.05rem] border border-amber-100 bg-white/96 shadow-sm" data-av-filter-shell="hold">
                <button type="button" data-role="button" ${buildExcelFilterFastAttrs('toggleAvHoldDropdown')}>
                    <i class="ph-bold ph-warning-circle text-sm"></i>
                    <span class="flex min-w-0 flex-1 flex-col leading-none">
                        <span class="task-top-control-title truncate">Holdstop</span>
                        <span class="task-top-control-summary truncate" data-role="summary">All Rows</span>
                    </span>
                    <i class="ph-bold ph-caret-down text-xs opacity-70 transition-transform" data-role="caret"></i>
                </button>
                <div class="task-top-control-panel excel-filter-panel excel-filter-panel--viewport-safe av-excel-filter-panel mt-2 hidden overflow-hidden rounded-2xl border border-amber-100 bg-white shadow-sm" data-role="panel"><div data-role="body"></div></div>
            </div>
    `;
}

function buildAvRailAccountFields() {
    return `
            <div class="task-top-control-shell av-filter-shell rounded-[1.05rem] border border-emerald-100 bg-white/96 shadow-sm hidden" data-av-filter-shell="salesrep">
                <button type="button" data-role="button" ${buildExcelFilterFastAttrs('toggleAvSalesRepDropdown')}>
                    <i class="ph-bold ph-user-circle text-sm"></i>
                    <span class="flex min-w-0 flex-1 flex-col leading-none">
                        <span class="task-top-control-title truncate">Sales Rep</span>
                        <span class="task-top-control-summary truncate" data-role="summary">All Reps</span>
                    </span>
                    <i class="ph-bold ph-caret-down text-xs opacity-70 transition-transform" data-role="caret"></i>
                </button>
                <div class="task-top-control-panel excel-filter-panel excel-filter-panel--viewport-safe av-excel-filter-panel mt-2 hidden overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm" data-role="panel"><div data-role="body"></div></div>
            </div>
            <div class="task-top-control-shell av-filter-shell rounded-[1.05rem] border border-emerald-100 bg-white/96 shadow-sm hidden" data-av-filter-shell="customer">
                <button type="button" data-role="button" ${buildExcelFilterFastAttrs('toggleAvRepCustomerDropdown')}>
                    <i class="ph-bold ph-users-three text-sm"></i>
                    <span class="flex min-w-0 flex-1 flex-col leading-none">
                        <span class="task-top-control-title truncate">Customer</span>
                        <span class="task-top-control-summary truncate" data-role="summary">All Customers</span>
                    </span>
                    <i class="ph-bold ph-caret-down text-xs opacity-70 transition-transform" data-role="caret"></i>
                </button>
                <div class="task-top-control-panel excel-filter-panel excel-filter-panel--viewport-safe av-excel-filter-panel mt-2 hidden overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm" data-role="panel"><div data-role="body"></div></div>
            </div>
            <div class="ops-view-option-control task-top-control-shell av-filter-shell rounded-[1.05rem] border border-emerald-100 bg-white/96 shadow-sm" data-av-filter-shell="columns">
                <button type="button" data-role="button" ${buildExcelFilterFastAttrs('toggleAvColumnFilterDropdown')}>
                    <i class="ph-bold ph-funnel text-sm"></i>
                    <span class="flex min-w-0 flex-1 flex-col leading-none">
                        <span class="task-top-control-title truncate">Filter</span>
                        <span class="task-top-control-summary truncate" data-role="summary">Columns</span>
                    </span>
                    <i class="ph-bold ph-sliders-horizontal text-xs opacity-80"></i>
                </button>
            </div>
    `;
}


function syncAvTopControlShell(container, shellName, config = {}) {
    if (!container) return;
    const shell = container.querySelector(`[data-av-filter-shell="${shellName}"]`);
    if (!shell) return;
    shell.classList.toggle('hidden', !!config.hidden);
    shell.classList.toggle('av-filter-shell--open', !!config.open);
    const button = shell.querySelector('[data-role="button"]');
    if (button && config.buttonClass) setNodeClassNameIfChanged(button, config.buttonClass);
    const summary = shell.querySelector('[data-role="summary"]');
    if (summary) setNodeTextIfChanged(summary, config.summary || '');
    const caret = shell.querySelector('[data-role="caret"]');
    if (caret) caret.classList.toggle('rotate-180', !!config.open);
    const body = shell.querySelector('[data-role="body"]');
    if (body && typeof config.bodyHtml === 'string') {
        setContainerHtmlWithSignature(body, config.bodyHtml, config.bodySignature || `${shellName}:${config.open ? 'open' : 'closed'}`);
    }
    const panel = shell.querySelector('[data-role="panel"]');
    const hasBodyContent = !!(body && String(body.innerHTML || '').trim());
    if (panel) {
        panel.classList.toggle('hidden', !config.open || !hasBodyContent);
        if (config.open && hasBodyContent) positionAvTopControlFloatingPanel(shellName, shell, panel, button);
        else clearAvTopControlFloatingPanel(panel);
    }
}

function closeAvHoldDropdown() {
    if (!avHoldDropdownOpen) return false;
    avHoldDropdownOpen = false;
    return renderAvTopControlsForDropdownStateChange();
}
